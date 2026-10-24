import { describe, expect, it } from "vitest";
import {
  createStepDetectorState,
  effectiveThresholdsInto,
  resetStepDetector,
  type StepDetectorParams,
  type StepDetectorState,
  StepResult,
  updateStepDetector,
  updateStepNoise,
} from "./stepDetector";

const TH = { high: 1.0, low: 0.3 };
const PARAMS: StepDetectorParams = {
  stepRefractoryMs: 250,
  stepGyroRejectDps: 100,
  stepGyroRelaxWalking: 1.5,
  stepGyroWindowMs: 200,
};

type Point = [t: number, bp: number, gyro?: number];

function run(
  s: StepDetectorState,
  points: Point[],
  opts: { params?: StepDetectorParams; suppress?: boolean; relaxed?: boolean } = {},
): StepResult[] {
  return points.map(([t, bp, gyro]) =>
    updateStepDetector(s, t, bp, gyro ?? 0, TH, opts.params ?? PARAMS, opts.suppress, opts.relaxed),
  );
}

/** 時刻 t0 に山（最大 peak）がある 1 つの山: 0 → peak → 0（16 ms ごと） */
function peakAt(t0: number, peak = 2, gyro: (t: number) => number = () => 0): Point[] {
  const pts: Point[] = [];
  for (let i = -5; i <= 5; i++) {
    const t = t0 + i * 16;
    pts.push([t, peak * Math.max(0, 1 - Math.abs(i) / 5), gyro(t)]);
  }
  return pts;
}

function results(r: StepResult[]): StepResult[] {
  return r.filter((x) => x !== StepResult.None);
}

describe("シュミットトリガ", () => {
  it("T_high を超えてから T_low を下回った時に 1 歩を数える", () => {
    const s = createStepDetectorState();
    const r = run(s, [
      [0, 0],
      [16, 1.2],
      [32, 0.5],
      [48, 0.29],
    ]);
    expect(r).toEqual([StepResult.None, StepResult.None, StepResult.None, StepResult.Step]);
    expect(s.stepCount).toBe(1);
    expect(s.lastStepT).toBe(16);
    expect(s.lastStepPeak).toBe(1.2);
  });

  it("T_high と T_low の間で揺れても何回も数えない", () => {
    const s = createStepDetectorState();
    const r = run(s, [
      [0, 1.1],
      [16, 0.5],
      [32, 1.5],
      [48, 0.4],
      [64, 1.2],
      [80, 0.2],
    ]);
    expect(results(r)).toEqual([StepResult.Step]);
    // 山の最大値とその時刻を山の時刻にする
    expect(s.lastStepT).toBe(32);
    expect(s.lastStepPeak).toBe(1.5);
  });

  it("T_high を超えない山は数えない（T_high ちょうども超えていない）", () => {
    const s = createStepDetectorState();
    expect(
      results(
        run(s, [
          [0, 0.9],
          [16, 1.0],
          [32, 0],
        ]),
      ),
    ).toEqual([]);
  });

  it("非有限の値は無視し，山の途中の状態を壊さない", () => {
    const s = createStepDetectorState();
    const r = run(s, [
      [0, 1.5],
      [16, Number.NaN],
      [32, Number.POSITIVE_INFINITY],
      [48, 0],
    ]);
    expect(results(r)).toEqual([StepResult.Step]);
    expect(s.lastStepPeak).toBe(1.5);
  });
});

describe("不応期", () => {
  it("前の歩の山から stepRefractoryMs 未満の山は数えない", () => {
    const s = createStepDetectorState();
    const r = results(run(s, [...peakAt(1000), ...peakAt(1200)]));
    expect(r).toEqual([StepResult.Step, StepResult.RejectedRefractory]);
    expect(s.stepCount).toBe(1);
    expect(s.rejectedCount).toBe(1);
  });

  it("stepRefractoryMs ちょうど以上なら数える", () => {
    const s = createStepDetectorState();
    expect(results(run(s, [...peakAt(1000), ...peakAt(1250)]))).toEqual([
      StepResult.Step,
      StepResult.Step,
    ]);
  });
});

describe("頭の回転による除外", () => {
  it("山の stepGyroWindowMs 前から今までに速い回転があれば数えない", () => {
    // 山（1000 ms）の 150 ms 前だけ 120 deg/s
    const s = createStepDetectorState();
    const r = run(s, [[850, 0, 120], ...peakAt(1000)]);
    expect(results(r)).toEqual([StepResult.RejectedGyro]);
  });

  it("山の後（終わるまで）の速い回転でも数えない", () => {
    const s = createStepDetectorState();
    const r = run(
      s,
      peakAt(1000, 2, (t) => (t === 1048 ? 150 : 0)),
    );
    expect(results(r)).toEqual([StepResult.RejectedGyro]);
  });

  it("窓より前（山の 250 ms 前）の回転は見ない", () => {
    const s = createStepDetectorState();
    const r = run(s, [[750, 0, 300], ...peakAt(1000)]);
    expect(results(r)).toEqual([StepResult.Step]);
  });

  it("しきい値より遅い回転は除外しない", () => {
    const s = createStepDetectorState();
    expect(
      results(
        run(
          s,
          peakAt(1000, 2, () => 99),
        ),
      ),
    ).toEqual([StepResult.Step]);
  });

  it("relaxed（仮に歩く・歩く）の時は stepGyroRelaxWalking 倍まで緩める", () => {
    const gyro = () => 130; // 100 × 1.5 = 150 未満
    expect(
      results(run(createStepDetectorState(), peakAt(1000, 2, gyro), { relaxed: true })),
    ).toEqual([StepResult.Step]);
    expect(
      results(run(createStepDetectorState(), peakAt(1000, 2, gyro), { relaxed: false })),
    ).toEqual([StepResult.RejectedGyro]);
    expect(
      results(
        run(
          createStepDetectorState(),
          peakAt(1000, 2, () => 150),
          { relaxed: true },
        ),
      ),
    ).toEqual([StepResult.RejectedGyro]);
  });

  it("止まっている（relaxed でない）時は倍率が効かない", () => {
    const params = { ...PARAMS, stepGyroRelaxWalking: 10 };
    expect(
      results(
        run(
          createStepDetectorState(),
          peakAt(1000, 2, () => 100),
          { params },
        ),
      ),
    ).toEqual([StepResult.RejectedGyro]);
  });

  it("倍率が 1 未満なら 1 として扱う（relaxed でも厳しくしない）", () => {
    const params = { ...PARAMS, stepGyroRelaxWalking: 0.5 };
    expect(
      results(
        run(
          createStepDetectorState(),
          peakAt(1000, 2, () => 80),
          { params, relaxed: true },
        ),
      ),
    ).toEqual([StepResult.Step]);
    expect(
      results(
        run(
          createStepDetectorState(),
          peakAt(1000, 2, () => 100),
          { params, relaxed: true },
        ),
      ),
    ).toEqual([StepResult.RejectedGyro]);
  });

  it("角速度が無い（NaN）端末では除外しない", () => {
    expect(
      results(
        run(
          createStepDetectorState(),
          peakAt(1000, 2, () => Number.NaN),
        ),
      ),
    ).toEqual([StepResult.Step]);
  });
});

describe("抑止", () => {
  it("suppress の間に終わった山は数えない（不応期も進めない）", () => {
    const s = createStepDetectorState();
    expect(results(run(s, peakAt(1000), { suppress: true }))).toEqual([
      StepResult.RejectedSuppressed,
    ]);
    expect(s.stepCount).toBe(0);
    expect(results(run(s, peakAt(1100)))).toEqual([StepResult.Step]);
  });
});

describe("ノイズによるしきい値の底上げ", () => {
  it("ノイズが無ければ基準のしきい値のまま", () => {
    const s = createStepDetectorState();
    expect(effectiveThresholdsInto({ high: 0, low: 0 }, s, 1, 0.3, 3)).toEqual({
      high: 1,
      low: 0.3,
    });
  });

  it("T_high = max(基準, 倍率 × ノイズの RMS)．T_low は同じ比で上げる", () => {
    const s = createStepDetectorState();
    s.noiseVar = 0.5 * 0.5; // RMS 0.5 → 3 倍で 1.5
    const th = effectiveThresholdsInto({ high: 0, low: 0 }, s, 1, 0.3, 3);
    expect(th.high).toBeCloseTo(1.5, 12);
    expect(th.low).toBeCloseTo(0.45, 12);
  });

  it("updateStepNoise は T_high 未満の値でノイズを見積もり，大きい値と山の途中は入れない", () => {
    const s = createStepDetectorState();
    for (let i = 0; i < 2000; i++) updateStepNoise(s, i % 2 === 0 ? 0.2 : -0.2, 1, 0.016, 3);
    expect(Math.sqrt(s.noiseVar)).toBeCloseTo(0.2, 3);
    const before = s.noiseVar;
    updateStepNoise(s, 5, 1, 0.016, 3);
    updateStepNoise(s, Number.NaN, 1, 0.016, 3);
    updateStepNoise(s, 0.1, 1, 0, 3);
    s.inPeak = true;
    updateStepNoise(s, 0.9, 1, 0.016, 3);
    expect(s.noiseVar).toBe(before);
  });

  it("底上げしたしきい値ではノイズ程度の山を数えない", () => {
    const s = createStepDetectorState();
    s.noiseVar = 0.6 * 0.6;
    const th = effectiveThresholdsInto({ high: 0, low: 0 }, s, 1, 0.3, 3);
    const r = peakAt(1000, 1.5).map(([t, bp]) => updateStepDetector(s, t, bp, 0, th, PARAMS));
    expect(results(r)).toEqual([]);
  });
});

describe("resetStepDetector", () => {
  it("山の途中を捨て，数えた数とノイズの見積もりは残す", () => {
    const s = createStepDetectorState();
    run(s, [...peakAt(1000), [1200, 1.5]]);
    s.noiseVar = 0.1;
    resetStepDetector(s);
    expect(s.inPeak).toBe(false);
    expect(s.stepCount).toBe(1);
    expect(s.noiseVar).toBe(0.1);
    // 不応期もリセットされる
    expect(results(run(s, peakAt(1100)))).toEqual([StepResult.Step]);
  });
});
