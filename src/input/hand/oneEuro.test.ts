// One Euro フィルタと外挿（experiment_山﨑/07「なめらかさ」: 止めた手は震えない・速い動きは遅れない・外挿は上限と減衰付き）
import { describe, expect, it } from "vitest";
import type { Vec3 } from "../../core/types";
import {
  createOneEuroVec3,
  extrapolateVec3,
  type OneEuroParams,
  type OneEuroVec3,
  smoothingAlpha,
  stepOneEuroVec3,
} from "./oneEuro";
import { seededRandom } from "./testHands";

const OE: OneEuroParams = { minCutoffHz: 1.0, beta: 1.5, dCutoffHz: 1.0 };
const EX = { maxMs: 80, decayMs: 60, maxSpeed: 3 };

function state(o: Partial<OneEuroVec3> = {}): OneEuroVec3 {
  return { x: 0, y: 0, z: -0.45, vx: 0, vy: 0, vz: 0, t: 1000, ...o };
}

function std(values: readonly number[]): number {
  const m = values.reduce((a, b) => a + b, 0) / values.length;
  return Math.sqrt(values.reduce((a, b) => a + (b - m) ** 2, 0) / values.length);
}

/** 入力の列（15 回/秒）をフィルタに通し，出力の x の列を返す */
function runFilter(xs: readonly number[], params: OneEuroParams, dtMs = 1000 / 15): number[] {
  let s = createOneEuroVec3({ x: xs[0], y: 0, z: -0.45 }, 0);
  const out = [s.x];
  for (let i = 1; i < xs.length; i++) {
    s = stepOneEuroVec3(s, { x: xs[i], y: 0, z: -0.45 }, i * dtMs, params);
    out.push(s.x);
  }
  return out;
}

describe("smoothingAlpha", () => {
  it.each([
    [0, 0.1],
    [-1, 0.1],
    [Number.NaN, 0.1],
    [1, 0],
    [1, -0.1],
    [1, Number.NaN],
  ])("遮断周波数 %s Hz・間隔 %s s のようにおかしい時は 1（そのまま通す）", (hz, dt) => {
    expect(smoothingAlpha(hz, dt)).toBe(1);
  });

  it("0〜1 の間で，間隔が長いほど・遮断周波数が高いほど大きい", () => {
    const a = smoothingAlpha(1, 1 / 15);
    expect(a).toBeGreaterThan(0);
    expect(a).toBeLessThan(1);
    expect(smoothingAlpha(1, 1 / 7)).toBeGreaterThan(a);
    expect(smoothingAlpha(5, 1 / 15)).toBeGreaterThan(a);
  });
});

describe("createOneEuroVec3", () => {
  it("最初の値と時刻で始め，速さは 0", () => {
    expect(createOneEuroVec3({ x: 1, y: 2, z: 3 }, 50)).toEqual({
      x: 1,
      y: 2,
      z: 3,
      vx: 0,
      vy: 0,
      vz: 0,
      t: 50,
    });
  });
});

describe("stepOneEuroVec3", () => {
  it("同じ値が続けば値は変わらず，速さは 0 のまま", () => {
    const s = stepOneEuroVec3(state(), { x: 0, y: 0, z: -0.45 }, 1066, OE);
    expect(s).toMatchObject({ x: 0, y: 0, z: -0.45, vx: 0, vy: 0, vz: 0, t: 1066 });
  });

  it("止めた手（ノイズのある一定の値）では，出力の震えが入力の震えより十分小さい", () => {
    const rnd = seededRandom(1);
    // ±3 mm の認識のぶれ，15 回/秒で 3 秒
    const xs = Array.from({ length: 45 }, () => 0.1 + (rnd() - 0.5) * 0.006);
    const out = runFilter(xs, OE);
    // 最初の 1 秒はなじむ時間として除く
    const inStd = std(xs.slice(15));
    const outStd = std(out.slice(15));
    expect(outStd).toBeLessThan(inStd * 0.5);
    // 平均は入力の平均から離れない
    const mean = out.slice(15).reduce((a, b) => a + b, 0) / 30;
    expect(mean).toBeCloseTo(0.1, 2);
  });

  it("速く動かす（1 m/s）と，速さで平滑化を弱めない（beta 0）時より遅れが小さい", () => {
    const xs = Array.from({ length: 15 }, (_, i) => (i * 1) / 15);
    const withBeta = runFilter(xs, OE);
    const noBeta = runFilter(xs, { ...OE, beta: 0 });
    const last = xs.length - 1;
    const lagBeta = xs[last] - withBeta[last];
    const lagNoBeta = xs[last] - noBeta[last];
    expect(lagBeta).toBeGreaterThanOrEqual(0);
    expect(lagBeta).toBeLessThan(lagNoBeta * 0.5);
    // 速い動きの遅れは 1 回の間隔分（約 6.7 cm）より小さい
    expect(lagBeta).toBeLessThan(1 / 15);
  });

  it("動いた向きの速さ（単位/s）を見積もり，動かない軸は 0", () => {
    let s = createOneEuroVec3({ x: 0, y: 0, z: 0 }, 0);
    for (let i = 1; i <= 30; i++) s = stepOneEuroVec3(s, { x: i * 0.05, y: 0, z: 0 }, i * 50, OE);
    // 1 m/s で動かし続けた（速さは前回のフィルタ後の値との差で見積もるため，遅れの分だけ大きめに出る）
    expect(s.vx).toBeGreaterThan(0.8);
    expect(Number.isFinite(s.vx)).toBe(true);
    expect(s.vy).toBe(0);
  });

  it.each([
    ["x が NaN", { x: Number.NaN, y: 0, z: 0 }],
    ["y が Infinity", { x: 0, y: Number.POSITIVE_INFINITY, z: 0 }],
    ["z が -Infinity", { x: 0, y: 0, z: Number.NEGATIVE_INFINITY }],
  ])("%s の値は捨てて前の状態のまま", (_, p: Vec3) => {
    const s = state();
    expect(stepOneEuroVec3(s, p, 1100, OE)).toBe(s);
  });

  it.each([
    ["同じ時刻", 1000],
    ["戻った時刻", 900],
    ["NaN の時刻", Number.NaN],
  ])("%s では進めない（前の状態のまま）", (_, t) => {
    const s = state();
    expect(stepOneEuroVec3(s, { x: 1, y: 1, z: 1 }, t, OE)).toBe(s);
  });
});

describe("extrapolateVec3", () => {
  const moving = state({ x: 0, vx: 1, t: 1000 });

  it("今の時刻が最後の更新と同じ・前なら，フィルタ後の位置のまま", () => {
    expect(extrapolateVec3(moving, 1000, EX)).toEqual({ x: 0, y: 0, z: -0.45 });
    expect(extrapolateVec3(moving, 900, EX)).toEqual({ x: 0, y: 0, z: -0.45 });
  });

  it("NaN の時刻では位置のまま", () => {
    expect(extrapolateVec3(moving, Number.NaN, EX)).toEqual({ x: 0, y: 0, z: -0.45 });
  });

  it("速さの向きに進め，減衰のため等速より手前で止まる", () => {
    const p = extrapolateVec3(moving, 1040, EX);
    expect(p.x).toBeGreaterThan(0);
    expect(p.x).toBeLessThan(0.04);
    // 進む距離 = v·τ·(1 − e^(−Δ/τ))
    expect(p.x).toBeCloseTo(1 * 0.06 * (1 - Math.exp(-40 / 60)), 6);
    expect(p.y).toBe(0);
    expect(p.z).toBe(-0.45);
  });

  it("進めるのは上限の時間（80 ms）まで．それより後は同じ位置で止まる", () => {
    const at80 = extrapolateVec3(moving, 1080, EX);
    expect(extrapolateVec3(moving, 1200, EX)).toEqual(at80);
    expect(extrapolateVec3(moving, 1_000_000, EX)).toEqual(at80);
    expect(extrapolateVec3(moving, 1079, EX).x).toBeLessThan(at80.x);
  });

  it("速さは上限（3 m/s）に抑える", () => {
    const fast = state({ x: 0, vx: 30, t: 1000 });
    const capped = state({ x: 0, vx: 3, t: 1000 });
    expect(extrapolateVec3(fast, 1050, EX).x).toBeCloseTo(extrapolateVec3(capped, 1050, EX).x, 9);
  });

  it("速さの上限は向きを保つ（3 軸の大きさで抑える）", () => {
    const s = state({ x: 0, y: 0, z: 0, vx: 30, vy: 40, vz: 0 });
    const p = extrapolateVec3(s, 1050, EX);
    expect(p.y / p.x).toBeCloseTo(4 / 3, 6);
    expect(Math.hypot(p.x, p.y)).toBeCloseTo(3 * 0.06 * (1 - Math.exp(-50 / 60)), 6);
  });

  it("減衰の時定数が 0 なら等速で進める", () => {
    const p = extrapolateVec3(moving, 1050, { ...EX, decayMs: 0 });
    expect(p.x).toBeCloseTo(0.05, 9);
  });

  it("速さが有限でなければ位置のまま", () => {
    const s = state({ vx: Number.NaN });
    expect(extrapolateVec3(s, 1050, EX)).toEqual({ x: 0, y: 0, z: -0.45 });
  });
});
