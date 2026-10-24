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
  // 頭の回転の平均による除外・弱い山の 2 つ続きは既定では無効にする（使うテストで有効にする）
  stepGyroMeanRejectDps: 0,
  stepWeakRatio: 1,
  stepMinIntervalMs: 300,
  stepTentativeTimeoutMs: 1000,
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

describe("弱い山の 2 つ続きで歩き出す（stepWeakRatio）", () => {
  const WEAK: StepDetectorParams = { ...PARAMS, stepWeakRatio: 0.65 };

  it("T_high × stepWeakRatio を超えた弱い山が歩く間隔（500 ms）で 2 つ続いたら，2 つ目を 1 歩とする", () => {
    const s = createStepDetectorState();
    const r = run(s, [...peakAt(1000, 0.8), ...peakAt(1500, 0.8)], { params: WEAK });
    expect(results(r)).toEqual([StepResult.Step]);
    expect(s.stepCount).toBe(1);
    expect(s.lastStepT).toBe(1500);
    expect(s.rejectedCount).toBe(0);
  });

  it("弱い山が 1 つだけでは何も返さない（歩も数えなかった山も増えない）", () => {
    const s = createStepDetectorState();
    expect(results(run(s, peakAt(1000, 0.8), { params: WEAK }))).toEqual([]);
    expect(s.stepCount).toBe(0);
    expect(s.rejectedCount).toBe(0);
  });

  it.each([
    [200, "stepMinIntervalMs 未満"],
    [1100, "stepTentativeTimeoutMs 超"],
  ])("間隔が %s ms（%s）の弱い山は歩き出さない", (gap) => {
    const s = createStepDetectorState();
    expect(
      results(run(s, [...peakAt(1000, 0.8), ...peakAt(1000 + gap, 0.8)], { params: WEAK })),
    ).toEqual([]);
    expect(s.stepCount).toBe(0);
  });

  it.each([300, 1000])("間隔の境目（%s ms ちょうど）は歩き出す", (gap) => {
    const s = createStepDetectorState();
    expect(
      results(run(s, [...peakAt(1000, 0.8), ...peakAt(1000 + gap, 0.8)], { params: WEAK })),
    ).toEqual([StepResult.Step]);
  });

  it("間隔の合わない弱い山の後でも，次の弱い山と間隔が合えば歩き出す（直前の弱い山と比べる）", () => {
    const s = createStepDetectorState();
    const r = run(s, [...peakAt(1000, 0.8), ...peakAt(2500, 0.8), ...peakAt(3000, 0.8)], {
      params: WEAK,
    });
    expect(results(r)).toEqual([StepResult.Step]);
    expect(s.lastStepT).toBe(3000);
  });

  it("T_high × stepWeakRatio 以下の山は弱い山にもならない", () => {
    const s = createStepDetectorState();
    expect(results(run(s, [...peakAt(1000, 0.6), ...peakAt(1500, 0.6)], { params: WEAK }))).toEqual(
      [],
    );
  });

  it("relaxed（仮に歩く・歩く）の時は弱い山を見ない", () => {
    const s = createStepDetectorState();
    expect(
      results(
        run(s, [...peakAt(1000, 0.8), ...peakAt(1500, 0.8)], { params: WEAK, relaxed: true }),
      ),
    ).toEqual([]);
  });

  it.each([1, 0, -0.5, 1.5])("stepWeakRatio=%s（1 以上・0 以下）なら無効", (ratio) => {
    const s = createStepDetectorState();
    expect(
      results(
        run(s, [...peakAt(1000, 0.8), ...peakAt(1500, 0.8)], {
          params: { ...PARAMS, stepWeakRatio: ratio },
        }),
      ),
    ).toEqual([]);
  });

  it("弱い山でも頭の回転が速ければ数えない", () => {
    const s = createStepDetectorState();
    const r = run(s, [...peakAt(1000, 0.8, () => 150), ...peakAt(1500, 0.8, () => 150)], {
      params: WEAK,
    });
    expect(results(r)).toEqual([StepResult.RejectedGyro, StepResult.RejectedGyro]);
    expect(s.stepCount).toBe(0);
  });
});

describe("頭の回転の平均による除外（stepGyroMeanRejectDps）", () => {
  const MEAN: StepDetectorParams = { ...PARAMS, stepGyroMeanRejectDps: 70 };
  /** 0〜2000 ms の間，一定の角速度 gyro（除外のしきい値 100 未満）を流し，2000 ms に山 */
  function turningThenPeak(gyro: number): Point[] {
    const pts: Point[] = [];
    for (let t = 0; t < 1900; t += 16) pts.push([t, 0, gyro]);
    return [...pts, ...peakAt(2000, 2, () => gyro)];
  }

  it("止まっている時に，山の前の回転の平均が stepGyroMeanRejectDps 以上なら数えない", () => {
    const s = createStepDetectorState();
    expect(results(run(s, turningThenPeak(80), { params: MEAN }))).toEqual([
      StepResult.RejectedGyro,
    ]);
    expect(s.stepCount).toBe(0);
  });

  it("回転の平均が stepGyroMeanRejectDps 未満なら数える", () => {
    const s = createStepDetectorState();
    expect(results(run(s, turningThenPeak(50), { params: MEAN }))).toEqual([StepResult.Step]);
  });

  it("relaxed（仮に歩く・歩く）の時は回転の平均では除外しない", () => {
    const s = createStepDetectorState();
    expect(results(run(s, turningThenPeak(80), { params: MEAN, relaxed: true }))).toEqual([
      StepResult.Step,
    ]);
  });

  it("stepGyroMeanRejectDps=0 なら無効", () => {
    const s = createStepDetectorState();
    expect(results(run(s, turningThenPeak(80)))).toEqual([StepResult.Step]);
  });

  it("平均は約 1 秒でならす（回転が止まって 3 秒たてば数える）", () => {
    const s = createStepDetectorState();
    const pts: Point[] = [];
    for (let t = 0; t < 2000; t += 16) pts.push([t, 0, 90]);
    for (let t = 2000; t < 4900; t += 16) pts.push([t, 0, 0]);
    expect(results(run(s, [...pts, ...peakAt(5000)], { params: MEAN }))).toEqual([StepResult.Step]);
  });

  it("角速度が NaN のサンプルは平均に入れない（平均で除外しない）", () => {
    const s = createStepDetectorState();
    const pts: Point[] = [];
    for (let t = 0; t < 1900; t += 16) pts.push([t, 0, Number.NaN]);
    const r = run(s, [...pts, ...peakAt(2000, 2, () => Number.NaN)], { params: MEAN });
    expect(results(r)).toEqual([StepResult.Step]);
  });
});

describe("数えた歩の山の平均（stepPeakMean）", () => {
  it("止まっている時の歩（歩き出し）はその山の大きさから始める", () => {
    const s = createStepDetectorState();
    s.stepPeakMean = 5;
    run(s, peakAt(1000, 2));
    expect(s.stepPeakMean).toBe(2);
  });

  it("relaxed の時は指数移動平均（係数 0.3）で進める", () => {
    const s = createStepDetectorState();
    run(s, peakAt(1000, 2));
    run(s, peakAt(1500, 3), { relaxed: true });
    expect(s.stepPeakMean).toBeCloseTo(2 + (3 - 2) * 0.3, 12);
  });

  it("数えなかった山では変わらない", () => {
    const s = createStepDetectorState();
    run(s, peakAt(1000, 2));
    run(
      s,
      peakAt(1500, 4, () => 300),
      { relaxed: true },
    );
    expect(s.stepPeakMean).toBe(2);
  });
});
