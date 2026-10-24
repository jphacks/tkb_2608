import { describe, expect, it } from "vitest";
import { biquadStep, biquadStepAt, createBiquad, designBiquad, resetBiquad } from "./biquad";

/** 1 Hz の高域通過 → 3 Hz の低域通過（experiment_山﨑/04 ②）に正弦波を通し，落ち着いた後の振幅の比を返す */
function bandGain(freqHz: number, fs: number): number {
  const hp = createBiquad("highpass", 1);
  const lp = createBiquad("lowpass", 3);
  const n = Math.round(fs * 12);
  let peak = 0;
  for (let i = 0; i < n; i++) {
    const x = Math.sin(2 * Math.PI * freqHz * (i / fs));
    const y = biquadStepAt(lp, biquadStepAt(hp, x, fs, 1), fs, 3);
    if (i > n / 2) peak = Math.max(peak, Math.abs(y));
  }
  return peak;
}

function singleGain(
  kind: "lowpass" | "highpass",
  cutoff: number,
  freqHz: number,
  fs: number,
): number {
  const f = createBiquad(kind, cutoff);
  const n = Math.round(fs * 12);
  let peak = 0;
  for (let i = 0; i < n; i++) {
    const y = biquadStepAt(f, Math.sin(2 * Math.PI * freqHz * (i / fs)), fs, cutoff);
    if (i > n / 2) peak = Math.max(peak, Math.abs(y));
  }
  return peak;
}

describe("帯域通過（1 Hz 高域通過 + 3 Hz 低域通過）", () => {
  it.each([30, 60, 100])("fs=%s Hz: 2 Hz（足踏み）を通し，0.5 Hz と 8 Hz を落とす", (fs) => {
    expect(bandGain(2, fs)).toBeGreaterThan(0.8);
    expect(bandGain(0.5, fs)).toBeLessThan(0.3);
    expect(bandGain(8, fs)).toBeLessThan(0.2);
  });

  it("サンプルの周期が違っても同じ特性になる（係数を fs から求める）", () => {
    for (const f of [0.5, 1, 1.5, 2, 2.5, 3, 5, 8]) {
      expect(Math.abs(bandGain(f, 60) - bandGain(f, 100))).toBeLessThan(0.05);
    }
  });

  it("遮断周波数で約 -3 dB（Q=1/√2 のバターワース）", () => {
    expect(singleGain("lowpass", 3, 3, 100)).toBeCloseTo(Math.SQRT1_2, 1);
    expect(singleGain("highpass", 1, 1, 100)).toBeCloseTo(Math.SQRT1_2, 1);
  });

  it("低域通過は直流を通し，高域通過は直流を落とす", () => {
    const lp = createBiquad("lowpass", 3);
    const hp = createBiquad("highpass", 1);
    let yl = 0;
    let yh = 0;
    for (let i = 0; i < 1000; i++) {
      yl = biquadStepAt(lp, 9.81, 60, 3);
      yh = biquadStepAt(hp, 9.81, 60, 1);
    }
    expect(yl).toBeCloseTo(9.81, 6);
    expect(yh).toBeCloseTo(0, 6);
  });
});

describe("biquadStepAt の係数の求め直し", () => {
  it("fs の変化が 1% 以内なら求め直さず，1% を超えたら求め直す", () => {
    const f = createBiquad("lowpass", 3);
    biquadStepAt(f, 0, 60, 3);
    expect(f.fs).toBe(60);
    const b0 = f.b0;
    biquadStepAt(f, 0, 60.5, 3);
    expect(f.fs).toBe(60);
    expect(f.b0).toBe(b0);
    biquadStepAt(f, 0, 61, 3);
    expect(f.fs).toBe(61);
    expect(f.b0).not.toBe(b0);
  });

  it("遮断周波数が変わったら求め直す", () => {
    const f = createBiquad("highpass", 1);
    biquadStepAt(f, 0, 60, 1);
    const b0 = f.b0;
    biquadStepAt(f, 0, 60, 1.5);
    expect(f.cutoffHz).toBe(1.5);
    expect(f.b0).not.toBe(b0);
  });

  it("fs・遮断周波数が 0 以下なら係数を変えない（例外も NaN も出さない）", () => {
    const f = createBiquad("lowpass", 3);
    designBiquad(f, 60);
    const before = { ...f };
    designBiquad(f, 0);
    designBiquad(f, -1);
    designBiquad(f, Number.NaN);
    designBiquad(f, 60, 0);
    expect(f).toEqual(before);
  });

  it("ナイキスト周波数に近い遮断周波数でも発散しない", () => {
    const f = createBiquad("lowpass", 3);
    let y = 0;
    for (let i = 0; i < 500; i++) y = biquadStepAt(f, i % 2 === 0 ? 1 : -1, 5, 3);
    expect(Number.isFinite(y)).toBe(true);
    expect(Math.abs(y)).toBeLessThan(10);
  });
});

describe("resetBiquad", () => {
  it("過去の値を 0 にし，係数は保つ", () => {
    const f = createBiquad("lowpass", 3);
    for (let i = 0; i < 10; i++) biquadStepAt(f, 1, 60, 3);
    const coef = [f.b0, f.b1, f.b2, f.a1, f.a2, f.fs];
    resetBiquad(f);
    expect([f.x1, f.x2, f.y1, f.y2]).toEqual([0, 0, 0, 0]);
    expect([f.b0, f.b1, f.b2, f.a1, f.a2, f.fs]).toEqual(coef);
    expect(biquadStep(f, 0)).toBe(0);
  });
});
