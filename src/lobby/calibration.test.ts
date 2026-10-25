// キャリブレーションの手順の進行と区間の記録（calibration.ts）のテスト．
// 各手順は「指示の読み上げ → 3 秒の準備（3・2・1．その間のセンサー値は捨てる）→ 計測」．
// 立つ・しゃがむ・しゃがみ歩き・足踏みは計測を 10 秒の固定にし（条件を満たしても早く終えない），
// 正面は 3 秒の間ずれが ±15° 以内なら終わる（制限時間 8 秒）（Issue #111 でユーザーが決めた仕様）

import { describe, expect, it } from "vitest";
import type { CalibrationProfile } from "../core/types";
import {
  accelerationMagnitude,
  advanceCalibration,
  type CalibrationConfig,
  type CalibrationState,
  type CalibrationStepId,
  countSteps,
  currentStepId,
  DEFAULT_CALIBRATION_CONFIG,
  DEFAULT_CALIBRATION_VALUES,
  detectPeaks,
  FULL_CALIBRATION_PLAN,
  faceFrontHoldElapsed,
  finishAlignment,
  isCalibrationFinished,
  type MotionSample,
  type OrientationSample,
  prepSignal,
  remainingAlignSeconds,
  remainingHoldSeconds,
  remainingPrepSeconds,
  remainingStepSeconds,
  restartCalibrationStep,
  STANDARD_GRAVITY,
  skipCalibrationStep,
  startCalibration,
  stepSeconds,
  toCalibrationProfile,
} from "./calibration";

const DEG = Math.PI / 180;
/** 2 進で正確に表せるフレームの刻み（累積の誤差を避ける） */
const DT = 1 / 32;
/** 1 フレームあたりの devicemotion の回数（64 Hz） */
const MOTION_PER_FRAME = 2;
const PREP = DEFAULT_CALIBRATION_CONFIG.prepSeconds;
/** 固定の計測の秒数 */
const MEASURE = 10;

type MotionGen = (t: number) => number | null;
type YawGen = (t: number) => number | null;

interface Generators {
  /** 時刻 t（その段階（準備・計測）に入ってからの秒）の加速度の大きさ（m/s^2） */
  readonly motion?: MotionGen;
  /** 時刻 t の頭のヨー角（度．縦向きで端末を立てた姿勢の alpha として与える） */
  readonly yawDeg?: YawGen;
}

/** 時計（サンプルの t は秒） */
class Clock {
  t = 100;
  /** 今の段階（phase・手順・準備／計測）に入った時刻 */
  phaseStart = 100;
}

function motionSample(t: number, magnitude: number): MotionSample {
  // 大きさだけが意味を持つので向きは適当に分ける
  return { t, x: magnitude * 0.6, y: magnitude * 0.8, z: 0 };
}

function orientationSample(t: number, alphaDeg: number): OrientationSample {
  return { t, alpha: alphaDeg, beta: 90, gamma: 0, screenAngle: 0 };
}

function step(
  state: CalibrationState,
  clock: Clock,
  gen: Generators,
  config: CalibrationConfig = DEFAULT_CALIBRATION_CONFIG,
): CalibrationState {
  const motion: MotionSample[] = [];
  const orientation: OrientationSample[] = [];
  for (let i = 1; i <= MOTION_PER_FRAME; i++) {
    const t = clock.t + (DT * i) / MOTION_PER_FRAME;
    const m = gen.motion?.(t - clock.phaseStart);
    if (m !== undefined && m !== null) motion.push(motionSample(t, m));
  }
  const tEnd = clock.t + DT;
  const yaw = gen.yawDeg?.(tEnd - clock.phaseStart);
  if (yaw !== undefined && yaw !== null) orientation.push(orientationSample(tEnd, yaw));
  clock.t = tEnd;
  const next = advanceCalibration(state, { dt: DT, motion, orientation }, config);
  if (
    next.phase !== state.phase ||
    next.stepIndex !== state.stepIndex ||
    next.stepStage !== state.stepStage
  ) {
    clock.phaseStart = clock.t;
  }
  return next;
}

/** 条件を満たすか maxSeconds たつまで進める．かかった秒数も返す */
function runUntil(
  state: CalibrationState,
  done: (s: CalibrationState) => boolean,
  maxSeconds: number,
  gen: Generators = {},
  clock: Clock = new Clock(),
  config: CalibrationConfig = DEFAULT_CALIBRATION_CONFIG,
): { state: CalibrationState; seconds: number } {
  let s = state;
  let frames = 0;
  const maxFrames = Math.ceil(maxSeconds / DT);
  while (!done(s) && frames < maxFrames) {
    s = step(s, clock, gen, config);
    frames++;
  }
  return { state: s, seconds: frames * DT };
}

/** 今の手順が終わる（次の段階・手順に移る）まで進める */
function runCurrentStep(
  state: CalibrationState,
  gen: Generators,
  maxSeconds = 60,
): { state: CalibrationState; seconds: number } {
  const startPhase = state.phase;
  const startIndex = state.stepIndex;
  return runUntil(
    state,
    (s) => s.phase !== startPhase || s.stepIndex !== startIndex,
    maxSeconds,
    gen,
  );
}

/** 指定の手順の最初（準備に入ったところ）まで飛ばして進める */
function enterStep(id: CalibrationStepId, previous: CalibrationProfile | null = null) {
  let s = startCalibration(previous);
  for (let i = 0; i < 10 && currentStepId(s) !== id; i++) s = skipCalibrationStep(s);
  expect(currentStepId(s)).toBe(id);
  expect(s.stepStage).toBe("prep");
  return s;
}

/** 準備を 1 フレームで終えて計測に入る */
function passPrep(state: CalibrationState, nowMs?: number): CalibrationState {
  const next = advanceCalibration(state, { dt: PREP, nowMs, motion: [], orientation: [] });
  expect(next.stepStage).toBe("measure");
  return next;
}

/** 指定の手順の計測の最初まで進める */
function enterMeasure(id: CalibrationStepId, previous: CalibrationProfile | null = null) {
  return passPrep(enterStep(id, previous));
}

function deepFreeze<T>(value: T): T {
  if (value !== null && typeof value === "object") {
    for (const v of Object.values(value)) deepFreeze(v);
    Object.freeze(value);
  }
  return value;
}

const PREVIOUS: CalibrationProfile = {
  createdAt: 1,
  yawOffset: 0.4,
  standingBaseline: 9.5,
  crouchThreshold: 2.2,
  stepPeakThreshold: 1.7,
};

const BASE = STANDARD_GRAVITY;

describe("既定値・設定（決定事項）", () => {
  it("既定値", () => {
    expect(DEFAULT_CALIBRATION_VALUES).toEqual({
      yawOffset: 0,
      standingBaseline: 9.80665,
      crouchThreshold: 1.5,
      stepPeakThreshold: 2.0,
    });
  });

  it("各段階の秒数: 準備 3 秒，正面は保持 3 秒・±15°・制限時間 8 秒，ほかの計測は 10 秒の固定", () => {
    const c = DEFAULT_CALIBRATION_CONFIG;
    expect(c.alignSeconds).toBe(15);
    expect(c.introSeconds).toBe(4);
    expect(c.outroSeconds).toBe(3);
    expect(c.prepSeconds).toBe(3);
    expect(c.faceFront.holdSeconds).toBe(3);
    expect(c.faceFront.toleranceRad).toBeCloseTo(15 * DEG);
    expect(c.faceFront.timeoutSeconds).toBe(8);
    expect(c.standing.measureSeconds).toBe(10);
    expect(c.crouching.measureSeconds).toBe(10);
    expect(c.crouchWalking.measureSeconds).toBe(10);
    expect(c.stepping.measureSeconds).toBe(10);
    expect(c.standing.settleSeconds).toBe(1);
    expect(c.standing.holdSeconds).toBe(3);
    expect(c.standing.maxStdDev).toBe(0.8);
    expect(c.crouching.minPeak).toBe(1.0);
    expect(c.crouching.stillSeconds).toBe(1.5);
    expect(c.crouchWalking.requiredSteps).toBe(4);
    expect(c.crouchWalking.minPeak).toBe(1.0);
    expect(c.crouchWalking.minIntervalSeconds).toBe(0.25);
    expect(c.stepping.requiredSteps).toBe(6);
    expect(c.stepping.minPeak).toBe(1.0);
    expect(c.stepping.minIntervalSeconds).toBe(0.25);
  });
});

describe("stepSeconds", () => {
  it.each([
    ["faceFront", 8],
    ["standing", 10],
    ["crouching", 10],
    ["crouchWalking", 10],
    ["stepping", 10],
  ] as const)("%s は %d 秒", (id, seconds) => {
    expect(stepSeconds(id, DEFAULT_CALIBRATION_CONFIG)).toBe(seconds);
  });

  it("正面は制限時間（timeoutSeconds），ほかは計測の秒数（measureSeconds）を設定から読む", () => {
    const c: CalibrationConfig = {
      ...DEFAULT_CALIBRATION_CONFIG,
      faceFront: { ...DEFAULT_CALIBRATION_CONFIG.faceFront, timeoutSeconds: 5 },
      stepping: { ...DEFAULT_CALIBRATION_CONFIG.stepping, measureSeconds: 7 },
    };
    expect(stepSeconds("faceFront", c)).toBe(5);
    expect(stepSeconds("stepping", c)).toBe(7);
    expect(stepSeconds("standing", c)).toBe(10);
  });
});

describe("startCalibration", () => {
  it("初回は全手順を既定値から始め，見え方の調整（align）から入る", () => {
    const s = startCalibration(null);
    expect(s.phase).toBe("align");
    expect(s.plan).toEqual(["faceFront", "standing", "crouching", "crouchWalking", "stepping"]);
    expect(FULL_CALIBRATION_PLAN).toEqual(s.plan);
    expect(s.values).toEqual(DEFAULT_CALIBRATION_VALUES);
    expect(s.reused).toBe(false);
    expect(s.outcomes).toEqual({});
    expect(s.segments).toEqual([]);
  });

  it("「もう一度」（前回の値あり）は正面だけを行い，前回の値を引き継ぐ", () => {
    const s = startCalibration(PREVIOUS);
    expect(s.phase).toBe("align");
    expect(s.plan).toEqual(["faceFront"]);
    expect(s.reused).toBe(true);
    expect(s.values).toEqual({
      yawOffset: 0.4,
      standingBaseline: 9.5,
      crouchThreshold: 2.2,
      stepPeakThreshold: 1.7,
    });
  });
});

describe("段階の進行", () => {
  it("align は 15 秒，intro は 4 秒で次へ進み，最初の手順は準備から始まる", () => {
    let s = startCalibration(null);
    expect(remainingAlignSeconds(s)).toBe(15);
    const align = runCurrentStep(s, {});
    expect(align.state.phase).toBe("intro");
    expect(align.seconds).toBeCloseTo(15, 1);
    s = align.state;
    expect(remainingAlignSeconds(s)).toBeNull();
    const intro = runCurrentStep(s, {});
    expect(intro.state.phase).toBe("step");
    expect(currentStepId(intro.state)).toBe("faceFront");
    expect(intro.state.stepStage).toBe("prep");
    expect(intro.state.prepElapsed).toBe(0);
    expect(intro.seconds).toBeCloseTo(4, 1);
  });

  it("align の途中では残り秒数が減っていく", () => {
    const { state } = runUntil(startCalibration(null), () => false, 5);
    expect(state.phase).toBe("align");
    expect(remainingAlignSeconds(state)).toBeCloseTo(10, 5);
    expect(remainingStepSeconds(state)).toBeNull();
    expect(remainingPrepSeconds(state)).toBeNull();
    expect(currentStepId(state)).toBeNull();
  });

  it("何もしなくても各手順は準備 3 秒 ＋ 計測（正面 8 秒・ほか 10 秒）で次へ進み，既定値のまま終わる（詰まらない）", () => {
    let s = startCalibration(null);
    s = runCurrentStep(s, {}).state; // align
    s = runCurrentStep(s, {}).state; // intro
    const measure: Record<CalibrationStepId, number> = {
      faceFront: 8,
      standing: 10,
      crouching: 10,
      crouchWalking: 10,
      stepping: 10,
    };
    for (const id of FULL_CALIBRATION_PLAN) {
      expect(currentStepId(s)).toBe(id);
      expect(s.stepStage).toBe("prep");
      expect(remainingPrepSeconds(s)).toBe(3);
      expect(remainingStepSeconds(s)).toBeNull();
      const r = runCurrentStep(s, {});
      expect(r.seconds).toBeCloseTo(PREP + measure[id], 1);
      s = r.state;
      expect(s.outcomes[id]).toBe("timedOut");
    }
    expect(s.phase).toBe("outro");
    const outro = runCurrentStep(s, {});
    expect(outro.seconds).toBeCloseTo(3, 1);
    expect(isCalibrationFinished(outro.state)).toBe(true);
    const profile = toCalibrationProfile(outro.state, 123);
    expect(profile).toEqual({
      createdAt: 123,
      ...DEFAULT_CALIBRATION_VALUES,
      segments: profile.segments,
    });
    // 10 秒たてば区間は completed（使えるかは input/ が区間のサンプルで決める）
    expect(profile.segments?.map((x) => [x.kind, x.outcome])).toEqual([
      ["standing", "completed"],
      ["crouching", "completed"],
      ["crouchWalking", "completed"],
      ["stepping", "completed"],
    ]);
  });

  it("センサーの値が無ければ全体は 85 秒（15+4+(3+8)+4×(3+10)+3）で終わる", () => {
    const r = runUntil(startCalibration(null), isCalibrationFinished, 120);
    expect(isCalibrationFinished(r.state)).toBe(true);
    expect(r.seconds).toBeCloseTo(85, 1);
  });

  it("「もう一度」は align → intro → 正面（準備 3 秒 ＋ 8 秒）→ outro で終わり，何もしなければ前回の値のまま", () => {
    const r = runUntil(startCalibration(PREVIOUS), isCalibrationFinished, 120);
    expect(isCalibrationFinished(r.state)).toBe(true);
    expect(r.seconds).toBeCloseTo(15 + 4 + 3 + 8 + 3, 1);
    expect(Object.keys(r.state.outcomes)).toEqual(["faceFront"]);
    const profile = toCalibrationProfile(r.state, 999);
    // 前回の区間が無ければ（segments 省略）区間は空のまま
    expect(profile).toEqual({ ...PREVIOUS, createdAt: 999, segments: [] });
  });

  it("「もう一度」で正面を向けば yawOffset だけ測り直し，他は保つ", () => {
    const r = runUntil(startCalibration(PREVIOUS), isCalibrationFinished, 120, {
      yawDeg: () => -30,
      motion: (t) => BASE + Math.sin(t * 20) * 3,
    });
    expect(r.state.outcomes.faceFront).toBe("measured");
    expect(r.state.values.yawOffset).toBeCloseTo(-30 * DEG, 3);
    expect(r.state.values.standingBaseline).toBe(9.5);
    expect(r.state.values.crouchThreshold).toBe(2.2);
    expect(r.state.values.stepPeakThreshold).toBe(1.7);
  });

  it("finished の後は状態を変えない", () => {
    const r = runUntil(startCalibration(null), isCalibrationFinished, 120);
    const next = advanceCalibration(r.state, { dt: 1, motion: [], orientation: [] });
    expect(next).toBe(r.state);
    expect(skipCalibrationStep(r.state)).toBe(r.state);
  });

  it("dt が不正（NaN・負・Infinity）なら時間を進めない", () => {
    const s = startCalibration(null);
    for (const dt of [Number.NaN, -1, Number.POSITIVE_INFINITY]) {
      const next = advanceCalibration(s, { dt, motion: [], orientation: [] });
      expect(next.phaseElapsed).toBe(0);
      expect(next.phase).toBe("align");
    }
  });

  it("準備の間も dt が不正なら準備を進めない", () => {
    const s = enterStep("standing");
    for (const dt of [Number.NaN, -1, Number.POSITIVE_INFINITY]) {
      const next = advanceCalibration(s, { dt, motion: [], orientation: [] });
      expect(next.stepStage).toBe("prep");
      expect(next.prepElapsed).toBe(0);
    }
  });

  it("状態を書き換えない（不変更新．計測の間）", () => {
    const s = deepFreeze(enterMeasure("standing"));
    const snapshot = JSON.parse(JSON.stringify(s));
    const next = advanceCalibration(s, {
      dt: DT,
      motion: [motionSample(1, BASE), motionSample(1.01, BASE)],
      orientation: [orientationSample(1, 0)],
    });
    expect(JSON.parse(JSON.stringify(s))).toEqual(snapshot);
    expect(next.motion.length).toBe(2);
  });

  it("状態を書き換えない（不変更新．準備の間と準備から計測に入る時）", () => {
    const s = deepFreeze(enterStep("standing"));
    const snapshot = JSON.parse(JSON.stringify(s));
    advanceCalibration(s, { dt: DT, motion: [motionSample(1, BASE)], orientation: [] });
    advanceCalibration(s, { dt: PREP, motion: [motionSample(1, BASE)], orientation: [] });
    expect(JSON.parse(JSON.stringify(s))).toEqual(snapshot);
  });
});

describe("準備（3・2・1）", () => {
  it("手順に入ると準備から始まり，3 秒たつと計測に入る", () => {
    const s = enterStep("standing");
    expect(remainingPrepSeconds(s)).toBe(3);
    const r = runUntil(s, (x) => x.stepStage === "measure", 10);
    expect(r.seconds).toBeCloseTo(3, 5);
    expect(currentStepId(r.state)).toBe("standing");
    expect(r.state.phaseElapsed).toBe(0);
    expect(remainingStepSeconds(r.state)).toBe(10);
    expect(remainingPrepSeconds(r.state)).toBeNull();
  });

  it("準備の間のセンサーの値は捨てる（計測のサンプルにも区間にも入れない）", () => {
    let s = enterStep("standing");
    s = advanceCalibration(s, {
      dt: 1,
      nowMs: 10_000,
      motion: [motionSample(1, 30)],
      orientation: [orientationSample(1, 40)],
    });
    expect(s.stepStage).toBe("prep");
    expect(s.motion).toEqual([]);
    expect(s.orientation).toEqual([]);
    s = advanceCalibration(s, {
      dt: 2,
      nowMs: 12_000,
      motion: [motionSample(3, 30)],
      orientation: [orientationSample(3, 40)],
    });
    expect(s.stepStage).toBe("measure");
    expect(s.motion).toEqual([]);
    expect(s.orientation).toEqual([]);
    // 区間は計測に入った時刻から始まる
    expect(s.stepStartMs).toBe(12_000);
    const done = skipCalibrationStep(
      advanceCalibration(s, { dt: 1, nowMs: 13_000, motion: [], orientation: [] }),
    );
    expect(done.segments).toEqual([
      { kind: "standing", startMs: 12_000, endMs: 13_000, outcome: "skipped" },
    ]);
  });

  it("準備の間の大きな揺れは，立つの基準値に入らない", () => {
    // 準備の間は 30 m/s^2（激しく動く），計測の間は 9.6 で静止
    let s = enterStep("standing");
    s = runUntil(s, (x) => x.stepStage === "measure", 10, { motion: () => 30 }).state;
    const r = runCurrentStep(s, { motion: (t) => 9.6 + 0.05 * Math.sin(t * 13) });
    expect(r.state.outcomes.standing).toBe("measured");
    expect(r.state.values.standingBaseline).toBeCloseTo(9.6, 1);
  });

  it("読み上げの間（dt = 0）は準備を数えず，サンプルも捨てる", () => {
    let s = enterStep("crouching");
    for (let i = 0; i < 100; i++) {
      s = advanceCalibration(s, { dt: 0, motion: [motionSample(i, 20)], orientation: [] });
    }
    expect(s.stepStage).toBe("prep");
    expect(s.prepElapsed).toBe(0);
    expect(remainingPrepSeconds(s)).toBe(3);
    expect(s.motion).toEqual([]);
  });

  it("正面の準備の間は，正面を向いていても終わらない（準備の後の計測で判定する）", () => {
    const r = runUntil(enterStep("faceFront"), () => false, 2.9, { yawDeg: () => 0 });
    expect(currentStepId(r.state)).toBe("faceFront");
    expect(r.state.stepStage).toBe("prep");
    expect(r.state.orientation).toEqual([]);
  });
});

describe("remainingPrepSeconds", () => {
  it("準備の残り秒数（3 − 数えた秒数．0 で止まる）", () => {
    const s = enterStep("standing");
    expect(remainingPrepSeconds(s)).toBe(3);
    expect(remainingPrepSeconds({ ...s, prepElapsed: 1.25 })).toBe(1.75);
    expect(remainingPrepSeconds({ ...s, prepElapsed: 5 })).toBe(0);
  });

  it("計測の間・手順の最中でない時は null", () => {
    expect(remainingPrepSeconds(enterMeasure("standing"))).toBeNull();
    expect(remainingPrepSeconds(startCalibration(null))).toBeNull();
    expect(remainingPrepSeconds(skipCalibrationStep(startCalibration(null)))).toBeNull();
  });
});

describe("prepSignal", () => {
  const prep = enterStep("standing");
  const at = (prepElapsed: number): CalibrationState => ({ ...prep, prepElapsed });

  it("読み上げの間（数え始める前）は鳴らさない", () => {
    expect(prepSignal(at(0), at(0))).toBeNull();
  });

  it("数え始めたフレームで tick（3）", () => {
    expect(prepSignal(at(0), at(0.1))).toBe("tick");
  });

  it("同じ数字の間は鳴らさない", () => {
    expect(prepSignal(at(0.1), at(0.5))).toBeNull();
    expect(prepSignal(at(1.1), at(1.9))).toBeNull();
  });

  it("数字が 3 → 2 → 1 と変わったフレームで tick", () => {
    expect(prepSignal(at(0.9), at(1.1))).toBe("tick");
    expect(prepSignal(at(1.9), at(2.1))).toBe("tick");
  });

  it("準備を終えて計測に入ったフレームで go", () => {
    expect(prepSignal(at(2.9), passPrep(at(2.9)))).toBe("go");
  });

  it("計測の間は鳴らさない", () => {
    const m = enterMeasure("standing");
    expect(prepSignal(m, { ...m, phaseElapsed: 1 })).toBeNull();
  });

  it("前の手順の計測から次の手順の準備に入ったフレームでは鳴らさず，数え始めたら tick", () => {
    const m = enterMeasure("standing");
    const next = skipCalibrationStep(m);
    expect(currentStepId(next)).toBe("crouching");
    expect(prepSignal(m, next)).toBeNull();
    expect(prepSignal(next, { ...next, prepElapsed: 0.1 })).toBe("tick");
  });

  it("手順でない段階（align・intro・outro）では鳴らさない", () => {
    const align = startCalibration(null);
    const intro = skipCalibrationStep(align);
    expect(prepSignal(align, intro)).toBeNull();
    expect(prepSignal(align, { ...align, phaseElapsed: 1 })).toBeNull();
  });

  it("準備を 1 フレームずつ通して数えると，tick が 3 回・go が 1 回", () => {
    const signals: string[] = [];
    let s = prep;
    for (let i = 0; i < 200 && s.stepStage === "prep"; i++) {
      const next = advanceCalibration(s, { dt: DT, motion: [], orientation: [] });
      const sig = prepSignal(s, next);
      if (sig !== null) signals.push(sig);
      s = next;
    }
    expect(signals).toEqual(["tick", "tick", "tick", "go"]);
  });
});

describe("正面（faceFront）", () => {
  it("3 秒間 ±15° 以内で向きを保てば，制限時間より前にその向きで終わる", () => {
    const r = runCurrentStep(enterMeasure("faceFront"), { yawDeg: () => 40 });
    expect(r.state.outcomes.faceFront).toBe("measured");
    expect(r.seconds).toBeGreaterThanOrEqual(3);
    expect(r.seconds).toBeLessThan(8);
    expect(r.state.values.yawOffset).toBeCloseTo(40 * DEG, 3);
  });

  it("小さなぶれ（±5°）は保っているとみなし，平均の向きになる", () => {
    const r = runCurrentStep(enterMeasure("faceFront"), {
      yawDeg: (t) => 20 + 5 * Math.sin(t * 7),
    });
    expect(r.state.outcomes.faceFront).toBe("measured");
    expect(r.state.values.yawOffset).toBeCloseTo(20 * DEG, 1);
  });

  it("±180° をまたぐ向きでも正しく平均する", () => {
    const r = runCurrentStep(enterMeasure("faceFront"), {
      yawDeg: (t) => 180 + 3 * Math.sin(t * 7),
    });
    expect(r.state.outcomes.faceFront).toBe("measured");
    expect(Math.abs(Math.cos(r.state.values.yawOffset) + 1)).toBeLessThan(0.01);
  });

  it("向きが大きく動き続けると計測の 8 秒で時間切れになる", () => {
    const r = runCurrentStep(enterMeasure("faceFront"), {
      yawDeg: (t) => 40 * Math.sin(t * 3),
    });
    expect(r.state.outcomes.faceFront).toBe("timedOut");
    expect(r.seconds).toBeCloseTo(8, 1);
    expect(currentStepId(r.state)).toBe("standing");
  });

  it("向きのサンプルが無ければ計測の 8 秒で時間切れになり，既定値（0）のまま", () => {
    const r = runCurrentStep(enterMeasure("faceFront"), {});
    expect(r.state.outcomes.faceFront).toBe("timedOut");
    expect(r.seconds).toBeCloseTo(8, 1);
    expect(r.state.values.yawOffset).toBe(0);
  });

  it("前回の値を引き継いだ時の時間切れ（サンプルなし）は前回の値のまま", () => {
    const r = runCurrentStep(enterMeasure("faceFront", PREVIOUS), {});
    expect(r.state.outcomes.faceFront).toBe("timedOut");
    expect(r.state.values.yawOffset).toBe(0.4);
  });

  it("計測に入って 3 秒より前には終わらない", () => {
    const r = runUntil(enterMeasure("faceFront"), () => false, 2.5, { yawDeg: () => 0 });
    expect(currentStepId(r.state)).toBe("faceFront");
  });
});

describe("faceFrontHoldElapsed・remainingHoldSeconds", () => {
  it("正面の計測の最中でなければ 0・null（準備の間・ほかの手順・手順の外）", () => {
    for (const s of [enterStep("faceFront"), enterMeasure("standing"), startCalibration(null)]) {
      expect(faceFrontHoldElapsed(s)).toBe(0);
      expect(remainingHoldSeconds(s)).toBeNull();
    }
  });

  it("計測に入った直後（サンプルなし）は保持 0・残り 3 秒", () => {
    const s = enterMeasure("faceFront");
    expect(faceFrontHoldElapsed(s)).toBe(0);
    expect(remainingHoldSeconds(s)).toBe(3);
  });

  it("向きを保っている間は保持が伸び，残りが減る", () => {
    const r = runUntil(enterMeasure("faceFront"), () => false, 2, { yawDeg: () => 10 });
    expect(currentStepId(r.state)).toBe("faceFront");
    expect(faceFrontHoldElapsed(r.state)).toBeCloseTo(2, 1);
    expect(remainingHoldSeconds(r.state)).toBeCloseTo(1, 1);
  });

  it("±15° を超えてずれると保持は 0 に戻り，残りは 3 秒に戻る", () => {
    // 2 秒は 0°，その後 40° へ向きを変える
    const r = runUntil(enterMeasure("faceFront"), () => false, 2 + DT, {
      yawDeg: (t) => (t <= 2 ? 0 : 40),
    });
    expect(currentStepId(r.state)).toBe("faceFront");
    expect(faceFrontHoldElapsed(r.state)).toBeCloseTo(0, 5);
    expect(remainingHoldSeconds(r.state)).toBeCloseTo(3, 5);
  });

  it("ずれた後に向きを保てば，ずれた所から数え直す", () => {
    const r = runUntil(enterMeasure("faceFront"), () => false, 3.5, {
      yawDeg: (t) => (t <= 2 ? 0 : 40),
    });
    expect(currentStepId(r.state)).toBe("faceFront");
    expect(faceFrontHoldElapsed(r.state)).toBeCloseTo(1.5, 1);
  });

  it("保持は holdSeconds（3 秒）と計測の経過秒数を超えない", () => {
    const s = enterMeasure("faceFront");
    const orientation = Array.from({ length: 200 }, (_, i) => orientationSample(i * 0.05, 0));
    // サンプルが 10 秒分あっても，計測の経過が 1 秒なら 1 秒まで
    expect(faceFrontHoldElapsed({ ...s, orientation, phaseElapsed: 1 })).toBe(1);
    expect(faceFrontHoldElapsed({ ...s, orientation, phaseElapsed: 20 })).toBeLessThanOrEqual(3);
    expect(remainingHoldSeconds({ ...s, orientation, phaseElapsed: 20 })).toBeGreaterThanOrEqual(0);
  });

  it("保てた時に終わる（保持の残りが 0 になる所で measured）", () => {
    const r = runCurrentStep(enterMeasure("faceFront"), { yawDeg: () => 0 });
    expect(r.state.outcomes.faceFront).toBe("measured");
    expect(r.seconds).toBeGreaterThanOrEqual(3);
    expect(r.seconds).toBeLessThan(3.5);
  });
});

describe("立つ（standing）．計測は 10 秒の固定", () => {
  it("静かに立っていれば基準値を測るが，10 秒たつまで終えない（measured・区間は completed）", () => {
    const r = runCurrentStep(enterMeasure("standing"), {
      motion: (t) => 9.6 + 0.05 * Math.sin(t * 13),
    });
    expect(r.state.outcomes.standing).toBe("measured");
    expect(r.seconds).toBeCloseTo(MEASURE, 1);
    expect(r.state.values.standingBaseline).toBeCloseTo(9.6, 1);
    expect(r.state.segments.map((x) => [x.kind, x.outcome])).toEqual([["standing", "completed"]]);
  });

  it("条件を満たした後も 9.9 秒の時点ではまだ立つの手順のまま", () => {
    const r = runUntil(enterMeasure("standing"), () => false, 9.9, {
      motion: (t) => 9.6 + 0.05 * Math.sin(t * 13),
    });
    expect(currentStepId(r.state)).toBe("standing");
    expect(r.state.outcomes.standing).toBeUndefined();
  });

  it("最初の 1 秒（姿勢を整える間）の値は基準値に含めない", () => {
    const r = runCurrentStep(enterMeasure("standing"), {
      motion: (t) => (t < 0.9 ? 15 : 9.6),
    });
    expect(r.state.outcomes.standing).toBe("measured");
    expect(r.state.values.standingBaseline).toBeCloseTo(9.6, 2);
  });

  it("揺れが大きい（標準偏差 0.8 超）と時間切れの扱い（timedOut）で測れた分の平均を使い，区間は completed", () => {
    const r = runCurrentStep(enterMeasure("standing"), {
      motion: (t) => (Math.floor(t * 64) % 2 === 0 ? 8.5 : 11.5),
    });
    expect(r.state.outcomes.standing).toBe("timedOut");
    expect(r.seconds).toBeCloseTo(MEASURE, 1);
    expect(r.state.values.standingBaseline).toBeCloseTo(10, 0);
    expect(r.state.values.standingBaseline).not.toBe(DEFAULT_CALIBRATION_VALUES.standingBaseline);
    expect(r.state.segments.find((x) => x.kind === "standing")?.outcome).toBe("completed");
  });

  it("サンプルが無ければ 10 秒で timedOut になり既定値のまま", () => {
    const r = runCurrentStep(enterMeasure("standing"), {});
    expect(r.state.outcomes.standing).toBe("timedOut");
    expect(r.seconds).toBeCloseTo(MEASURE, 1);
    expect(r.state.values.standingBaseline).toBe(STANDARD_GRAVITY);
  });
});

/** しゃがむ動き: 1 秒静止 → 沈み込み（-4）→ 戻り（+2）→ 静止 */
const crouchMotion: MotionGen = (t) => {
  if (t < 1) return BASE;
  if (t < 1.5) return BASE - 4;
  if (t < 2) return BASE + 2;
  return BASE;
};

describe("しゃがむ（crouching）．計測は 10 秒の固定", () => {
  it("しゃがんで止まればしきい値を測るが，10 秒たつまで終えない（measured・区間は completed）", () => {
    const r = runCurrentStep(enterMeasure("crouching"), { motion: crouchMotion });
    expect(r.state.outcomes.crouching).toBe("measured");
    expect(r.seconds).toBeCloseTo(MEASURE, 1);
    const v = r.state.values.crouchThreshold;
    expect(v).not.toBe(DEFAULT_CALIBRATION_VALUES.crouchThreshold);
    const [lo, hi] = DEFAULT_CALIBRATION_CONFIG.limits.crouchThreshold;
    expect(v).toBeGreaterThanOrEqual(lo);
    expect(v).toBeLessThanOrEqual(hi);
    expect(r.state.segments.find((x) => x.kind === "crouching")?.outcome).toBe("completed");
  });

  it("ずれが 1.0 m/s² 未満なら，しゃがんだとみなさず 10 秒で timedOut・既定値", () => {
    const r = runCurrentStep(enterMeasure("crouching"), {
      motion: (t) => (t > 1 && t < 1.5 ? BASE - 0.8 : BASE),
    });
    expect(r.state.outcomes.crouching).toBe("timedOut");
    expect(r.seconds).toBeCloseTo(MEASURE, 1);
    expect(r.state.values.crouchThreshold).toBe(1.5);
  });

  it("動き続けて止まらないと 10 秒で timedOut になり，測れたずれからしきい値を作る", () => {
    const r = runCurrentStep(enterMeasure("crouching"), {
      motion: (t) => BASE + 3 * Math.sin(t * 6),
    });
    expect(r.state.outcomes.crouching).toBe("timedOut");
    expect(r.seconds).toBeCloseTo(MEASURE, 1);
    expect(r.state.values.crouchThreshold).not.toBe(1.5);
  });

  it("前回の値を引き継いでいれば，timedOut で前回の値のまま（直接その手順の状態を作って確認）", () => {
    const base = enterMeasure("crouching");
    const s: CalibrationState = {
      ...base,
      values: { ...base.values, crouchThreshold: 2.2 },
    };
    const r = runCurrentStep(s, {});
    expect(r.state.outcomes.crouching).toBe("timedOut");
    expect(r.state.values.crouchThreshold).toBe(2.2);
  });
});

/** 0.5 秒ごとに高さ height の山（幅 0.1 秒の三角形）を count 回 */
function stepMotion(count: number, height: number, interval = 0.5): MotionGen {
  return (t) => {
    const k = Math.floor((t - 0.5) / interval);
    if (t < 0.5 || k >= count) return BASE;
    const local = t - 0.5 - k * interval;
    if (local > 0.1) return BASE;
    return BASE + height * (1 - Math.abs(local - 0.05) / 0.05);
  };
}

describe("足踏み（stepping）．計測は 10 秒の固定", () => {
  it("6 歩以上踏めばしきい値を測るが，歩数がそろっても早く終えず 10 秒で次へ（measured・区間は completed）", () => {
    const r = runCurrentStep(enterMeasure("stepping"), { motion: stepMotion(10, 3) });
    expect(r.state.outcomes.stepping).toBe("measured");
    expect(r.seconds).toBeCloseTo(MEASURE, 1);
    const v = r.state.values.stepPeakThreshold;
    const [lo, hi] = DEFAULT_CALIBRATION_CONFIG.limits.stepPeakThreshold;
    expect(v).toBeGreaterThanOrEqual(lo);
    expect(v).toBeLessThanOrEqual(hi);
    expect(v).not.toBe(DEFAULT_CALIBRATION_VALUES.stepPeakThreshold);
    expect(r.state.phase).toBe("outro");
    expect(r.state.segments.find((x) => x.kind === "stepping")?.outcome).toBe("completed");
  });

  it("6 歩踏んだ後（約 3.5 秒）もまだ足踏みの手順のまま", () => {
    const r = runUntil(enterMeasure("stepping"), () => false, 6, { motion: stepMotion(10, 3) });
    expect(currentStepId(r.state)).toBe("stepping");
    expect(countSteps(r.state)).toBeGreaterThanOrEqual(6);
  });

  it("山が 1.0 m/s² 未満なら歩数に数えず，10 秒で timedOut・既定値", () => {
    const r = runCurrentStep(enterMeasure("stepping"), { motion: stepMotion(20, 0.8) });
    expect(r.state.outcomes.stepping).toBe("timedOut");
    expect(r.seconds).toBeCloseTo(MEASURE, 1);
    expect(r.state.values.stepPeakThreshold).toBe(2.0);
  });

  it("0.25 秒より近い山は 1 歩として数える", () => {
    const r = runUntil(enterMeasure("stepping"), () => false, 3, {
      motion: stepMotion(8, 3, 0.15),
    });
    // 0.15 秒間隔の 8 回の山は，0.25 秒以上離れた山だけが数えられる（8 歩にはならない）
    expect(countSteps(r.state)).toBeLessThan(8);
    expect(countSteps(r.state)).toBeGreaterThanOrEqual(1);
  });

  it("6 歩に届かなくても数歩（2 歩以上）測れていれば timedOut でその値を使う", () => {
    const r = runCurrentStep(enterMeasure("stepping"), { motion: stepMotion(3, 3) });
    expect(r.state.outcomes.stepping).toBe("timedOut");
    expect(r.seconds).toBeCloseTo(MEASURE, 1);
    expect(r.state.values.stepPeakThreshold).not.toBe(2.0);
    // 10 秒たったので区間は completed
    expect(r.state.segments.find((x) => x.kind === "stepping")?.outcome).toBe("completed");
  });

  it("1 歩だけなら値を使わず既定値", () => {
    const r = runCurrentStep(enterMeasure("stepping"), { motion: stepMotion(1, 3) });
    expect(r.state.outcomes.stepping).toBe("timedOut");
    expect(r.state.values.stepPeakThreshold).toBe(2.0);
  });

  it("サンプルが無ければ 10 秒で timedOut・既定値", () => {
    const r = runCurrentStep(enterMeasure("stepping"), {});
    expect(r.state.outcomes.stepping).toBe("timedOut");
    expect(r.state.values.stepPeakThreshold).toBe(2.0);
  });
});

describe("しゃがみ歩き（crouchWalking）．計測は 10 秒の固定", () => {
  it("しゃがむの次・足踏みの前に行う", () => {
    const s = skipCalibrationStep(enterStep("crouching"));
    expect(currentStepId(s)).toBe("crouchWalking");
    expect(currentStepId(skipCalibrationStep(s))).toBe("stepping");
  });

  it("4 歩踏めば measured だが 10 秒たつまで終えず，区間は completed．値は作らない", () => {
    const before = enterMeasure("crouchWalking");
    const r = runCurrentStep(before, { motion: stepMotion(10, 3) });
    expect(currentStepId(r.state)).toBe("stepping");
    expect(r.state.outcomes.crouchWalking).toBe("measured");
    expect(r.seconds).toBeCloseTo(MEASURE, 1);
    expect(r.state.values).toEqual(before.values);
    const seg = r.state.segments.find((x) => x.kind === "crouchWalking");
    expect(seg?.outcome).toBe("completed");
  });

  it("3 歩なら 10 秒で timedOut（区間は completed）", () => {
    const r = runCurrentStep(enterMeasure("crouchWalking"), { motion: stepMotion(3, 3) });
    expect(r.state.outcomes.crouchWalking).toBe("timedOut");
    expect(r.seconds).toBeCloseTo(MEASURE, 1);
    expect(r.state.segments.find((x) => x.kind === "crouchWalking")?.outcome).toBe("completed");
  });

  it("歩かなければ 10 秒で timedOut になり，区間は completed", () => {
    const before = enterMeasure("crouchWalking");
    expect(remainingStepSeconds(before)).toBe(10);
    const r = runCurrentStep(before, {});
    expect(r.seconds).toBeCloseTo(MEASURE, 1);
    expect(currentStepId(r.state)).toBe("stepping");
    expect(r.state.outcomes.crouchWalking).toBe("timedOut");
    expect(r.state.values).toEqual(before.values);
    expect(r.state.segments.find((x) => x.kind === "crouchWalking")?.outcome).toBe("completed");
  });

  it("山が 1.0 m/s² 未満なら歩数に数えない", () => {
    const r = runUntil(enterMeasure("crouchWalking"), () => false, 6, {
      motion: stepMotion(10, 0.8),
    });
    expect(countSteps(r.state)).toBe(0);
  });
});

describe("skipCalibrationStep（時間切れと同じ扱い．区間は skipped）", () => {
  it("align → intro → 最初の手順（準備） と進む", () => {
    let s = startCalibration(null);
    s = skipCalibrationStep(s);
    expect(s.phase).toBe("intro");
    s = skipCalibrationStep(s);
    expect(currentStepId(s)).toBe("faceFront");
    expect(s.stepStage).toBe("prep");
  });

  it("正面の計測の最中は時間切れとして次へ進み，集めた値があればそれを使う", () => {
    const r = runUntil(enterMeasure("faceFront"), () => false, 1, { yawDeg: () => 50 });
    expect(currentStepId(r.state)).toBe("faceFront");
    const s = skipCalibrationStep(r.state);
    expect(s.outcomes.faceFront).toBe("timedOut");
    expect(currentStepId(s)).toBe("standing");
    expect(s.values.yawOffset).toBeCloseTo(50 * DEG, 3);
  });

  it("足踏みの計測の途中で飛ばしても，6 歩測れていれば measured（区間は skipped）", () => {
    const r = runUntil(enterMeasure("stepping"), () => false, 5, { motion: stepMotion(10, 3) });
    const s = skipCalibrationStep(r.state);
    expect(s.outcomes.stepping).toBe("measured");
    expect(s.segments.find((x) => x.kind === "stepping")?.outcome).toBe("skipped");
  });

  it("サンプルが無ければ既定値のまま進む", () => {
    const s = skipCalibrationStep(enterMeasure("standing"));
    expect(s.outcomes.standing).toBe("timedOut");
    expect(s.values.standingBaseline).toBe(STANDARD_GRAVITY);
  });

  it("準備の間に飛ばしても次の手順へ進む（timedOut・区間は skipped）", () => {
    const s = skipCalibrationStep(enterStep("standing"));
    expect(currentStepId(s)).toBe("crouching");
    expect(s.outcomes.standing).toBe("timedOut");
    expect(s.segments.find((x) => x.kind === "standing")?.outcome).toBe("skipped");
  });

  it("全部飛ばすと outro → finished になり既定値", () => {
    let s = startCalibration(null);
    for (let i = 0; i < 20 && !isCalibrationFinished(s); i++) s = skipCalibrationStep(s);
    expect(isCalibrationFinished(s)).toBe(true);
    expect(s.values).toEqual(DEFAULT_CALIBRATION_VALUES);
  });

  it("新しい手順に入るとサンプルと経過時間は空になり，準備から始まる", () => {
    const r = runUntil(enterMeasure("standing"), () => false, 1, { motion: () => BASE });
    expect(r.state.motion.length).toBeGreaterThan(0);
    const s = skipCalibrationStep(r.state);
    expect(currentStepId(s)).toBe("crouching");
    expect(s.motion).toEqual([]);
    expect(s.orientation).toEqual([]);
    expect(s.phaseElapsed).toBe(0);
    expect(s.stepStage).toBe("prep");
    expect(s.prepElapsed).toBe(0);
  });
});

describe("remainingStepSeconds", () => {
  it("計測の秒数から経過時間を引き，0 で止まる", () => {
    const s = enterMeasure("crouching");
    expect(remainingStepSeconds(s)).toBe(10);
    expect(remainingStepSeconds({ ...s, phaseElapsed: 3 })).toBe(7);
    expect(remainingStepSeconds({ ...s, phaseElapsed: 30 })).toBe(0);
  });

  it("正面は制限時間 8 秒から数える", () => {
    expect(remainingStepSeconds(enterMeasure("faceFront"))).toBe(8);
  });

  it("準備の間・手順の最中でなければ null", () => {
    expect(remainingStepSeconds(enterStep("crouching"))).toBeNull();
    expect(remainingStepSeconds(startCalibration(null))).toBeNull();
  });
});

describe("finishAlignment", () => {
  it("見え方の調整の最中なら導入へ進み，導入の経過は 0 から", () => {
    const align = runUntil(startCalibration(null), () => false, 5).state;
    expect(align.phase).toBe("align");
    const s = finishAlignment(align);
    expect(s.phase).toBe("intro");
    expect(s.phaseElapsed).toBe(0);
    // 導入は 4 秒で最初の手順へ
    const intro = runCurrentStep(s, {});
    expect(intro.seconds).toBeCloseTo(4, 1);
    expect(currentStepId(intro.state)).toBe("faceFront");
  });

  it("制限時間に関係なく，始めた直後でも押せば進む", () => {
    expect(finishAlignment(startCalibration(null)).phase).toBe("intro");
  });

  it("見え方の調整の最中でなければ状態を変えない（同じもの）", () => {
    const intro = skipCalibrationStep(startCalibration(null));
    expect(finishAlignment(intro)).toBe(intro);
    const stepState = enterStep("standing");
    expect(finishAlignment(stepState)).toBe(stepState);
    let s = startCalibration(null);
    for (let i = 0; i < 20 && !isCalibrationFinished(s); i++) s = skipCalibrationStep(s);
    expect(finishAlignment(s)).toBe(s);
  });

  it("値・区間・計画は変えない．状態を書き換えない", () => {
    const align = deepFreeze(startCalibration(PREVIOUS));
    const snapshot = JSON.parse(JSON.stringify(align));
    const s = finishAlignment(align);
    expect(JSON.parse(JSON.stringify(align))).toEqual(snapshot);
    expect(s.values).toEqual(align.values);
    expect(s.plan).toEqual(align.plan);
    expect(s.segments).toEqual(align.segments);
  });
});

describe("toCalibrationProfile", () => {
  it("CalibrationProfile の全項目が入る", () => {
    const p = toCalibrationProfile(startCalibration(null), 42);
    expect(Object.keys(p).sort()).toEqual(
      [
        "createdAt",
        "crouchThreshold",
        "segments",
        "stepPeakThreshold",
        "standingBaseline",
        "yawOffset",
      ].sort(),
    );
    expect(p.createdAt).toBe(42);
    for (const v of [p.createdAt, p.yawOffset, p.crouchThreshold, p.stepPeakThreshold]) {
      expect(Number.isFinite(v)).toBe(true);
    }
    expect(Number.isFinite(p.standingBaseline)).toBe(true);
    expect(p.segments).toEqual([]);
  });
});

describe("detectPeaks", () => {
  const series = (values: number[], dt = 0.1) => values.map((value, i) => ({ t: i * dt, value }));

  it("前後より大きく minPeak 以上の点を山とする", () => {
    const peaks = detectPeaks(series([0, 2, 0, 0.5, 0, 3, 0]), 1, 0.05);
    expect(peaks.map((p) => p.value)).toEqual([2, 3]);
  });

  it("minPeak 未満の山は無視する", () => {
    expect(detectPeaks(series([0, 0.9, 0]), 1, 0)).toEqual([]);
  });

  it("minIntervalSeconds より近い山は大きい方だけを残す", () => {
    const peaks = detectPeaks(series([0, 2, 0, 3, 0]), 1, 0.25);
    expect(peaks.length).toBe(1);
    expect(peaks[0]?.value).toBe(3);
    expect(peaks[0]?.t).toBeCloseTo(0.3);
  });

  it("両端の点は山にしない", () => {
    expect(detectPeaks(series([5, 0, 5]), 1, 0)).toEqual([]);
  });

  it("空や短い列でも落ちない", () => {
    expect(detectPeaks([], 1, 0)).toEqual([]);
    expect(detectPeaks(series([3]), 1, 0)).toEqual([]);
  });
});

describe("accelerationMagnitude", () => {
  it("3 軸の大きさ", () => {
    expect(accelerationMagnitude({ t: 0, x: 3, y: 4, z: 0 })).toBeCloseTo(5);
    expect(accelerationMagnitude({ t: 0, x: 0, y: 0, z: -9.8 })).toBeCloseTo(9.8);
  });
});

// lobbyScene の isPaused（縦向きの案内中）は advanceCalibration を呼ばないことで時間を止める．
// 制限時間が dt の累積で数えられ，呼ばない間は進まないことを確かめる
describe("advanceCalibration（止めている間）", () => {
  const frame = (dt: number) => ({ dt, motion: [], orientation: [] });
  /** paused[i] が true のフレームは lobbyScene と同じく advance を呼ばない */
  function runWithPause(paused: readonly boolean[], dt: number): CalibrationState {
    let s = startCalibration(null);
    for (const p of paused) {
      if (!p) s = advanceCalibration(s, frame(dt));
    }
    return s;
  }

  it("止めている間のフレームは見え方の調整の残り時間を減らさない", () => {
    const dt = 0.5;
    const pausedHalf = Array.from({ length: 40 }, (_, i) => i % 2 === 0);
    const s = runWithPause(pausedHalf, dt);
    // 進んだのは 20 フレーム分（10 秒）だけ
    expect(s.phase).toBe("align");
    expect(remainingAlignSeconds(s)).toBeCloseTo(DEFAULT_CALIBRATION_CONFIG.alignSeconds - 10);
  });

  it("止めている間ずっと進まず，再開すると続きから数える（やり直さない）", () => {
    const dt = 0.25;
    const before = Array.from({ length: 8 }, () => false); // 2 秒進める
    const pausedLong = Array.from({ length: 400 }, () => true); // 100 秒止める
    const after = Array.from({ length: 4 }, () => false); // 1 秒進める
    const s = runWithPause([...before, ...pausedLong, ...after], dt);
    expect(s.phase).toBe("align");
    expect(remainingAlignSeconds(s)).toBeCloseTo(DEFAULT_CALIBRATION_CONFIG.alignSeconds - 3);
  });
});

/** nowMs を渡して進める（時刻は base + 経過 ms） */
function runWithNow(
  state: CalibrationState,
  done: (s: CalibrationState) => boolean,
  baseMs: number,
  maxSeconds = 120,
): CalibrationState {
  let s = state;
  const maxFrames = Math.ceil(maxSeconds / DT);
  for (let i = 1; i <= maxFrames && !done(s); i++) {
    s = advanceCalibration(s, {
      dt: DT,
      nowMs: baseMs + i * DT * 1000,
      motion: [],
      orientation: [],
    });
  }
  return s;
}

describe("区間（segments）の記録", () => {
  it("何もしなければ 立つ → しゃがむ → しゃがみ歩き → 足踏み の順に，準備を除いた 10 秒の区間を completed で記録する", () => {
    const r = runUntil(startCalibration(null), isCalibrationFinished, 120);
    // nowMs を渡さない時は dt の累積（0 ms から）で数える．
    // align 15 + intro 4 + 正面（準備 3 + 8）= 30 秒から立つの準備，33 秒から計測
    expect(r.state.segments).toEqual([
      { kind: "standing", startMs: 33000, endMs: 43000, outcome: "completed" },
      { kind: "crouching", startMs: 46000, endMs: 56000, outcome: "completed" },
      { kind: "crouchWalking", startMs: 59000, endMs: 69000, outcome: "completed" },
      { kind: "stepping", startMs: 72000, endMs: 82000, outcome: "completed" },
    ]);
  });

  it("正面（faceFront）は区間を記録しない", () => {
    const r = runCurrentStep(enterMeasure("faceFront"), { yawDeg: () => 10 });
    expect(r.state.outcomes.faceFront).toBe("measured");
    expect(r.state.segments).toEqual([]);
    const skipped = skipCalibrationStep(enterStep("faceFront"));
    expect(skipped.segments).toEqual([]);
  });

  it("各区間は startMs ≤ endMs で，前の区間の終わりより前に始まらない（時刻が戻らない）", () => {
    const s = runWithNow(startCalibration(null), isCalibrationFinished, 1_000_000);
    expect(s.segments.length).toBe(4);
    let prevEnd = Number.NEGATIVE_INFINITY;
    for (const seg of s.segments) {
      expect(seg.startMs).toBeLessThanOrEqual(seg.endMs);
      expect(seg.startMs).toBeGreaterThanOrEqual(prevEnd);
      prevEnd = seg.endMs;
    }
  });

  it.each(["standing", "crouching", "crouchWalking", "stepping"] as const)(
    "%s を skipCalibrationStep で飛ばすと skipped",
    (id) => {
      const s = skipCalibrationStep(enterMeasure(id));
      const seg = s.segments.find((x) => x.kind === id);
      expect(seg?.outcome).toBe("skipped");
      // outcomes は従来どおり timedOut（サンプルが無いため）
      expect(s.outcomes[id]).toBe("timedOut");
    },
  );

  it("nowMs を渡すと，区間の時刻はその時刻になる（始まりは準備の後）", () => {
    const base = 5_000_000;
    let s = runWithNow(startCalibration(null), (x) => currentStepId(x) === "standing", base);
    // 立つに入った時刻（準備の始まり）
    expect(s.stepStartMs).toBe(base + 30000);
    s = runWithNow(s, (x) => currentStepId(x) === "crouching", base + 30000);
    expect(s.segments).toEqual([
      { kind: "standing", startMs: base + 33000, endMs: base + 43000, outcome: "completed" },
    ]);
  });

  it("nowMs を省略すると，前の時刻に dt × 1000 を足して数える", () => {
    let s = startCalibration(null);
    s = advanceCalibration(s, { dt: 0.5, nowMs: 10_000, motion: [], orientation: [] });
    expect(s.clockMs).toBe(10_000);
    s = advanceCalibration(s, { dt: 0.25, motion: [], orientation: [] });
    expect(s.clockMs).toBe(10_250);
    // 一度も時刻が無ければ 0 から数える
    const first = advanceCalibration(startCalibration(null), {
      dt: 0.5,
      motion: [],
      orientation: [],
    });
    expect(first.clockMs).toBe(500);
  });

  it("nowMs が前の時刻より戻っても時刻は戻らない", () => {
    let s = startCalibration(null);
    s = advanceCalibration(s, { dt: DT, nowMs: 10_000, motion: [], orientation: [] });
    s = advanceCalibration(s, { dt: DT, nowMs: 9_000, motion: [], orientation: [] });
    expect(s.clockMs).toBeGreaterThanOrEqual(10_000);
  });

  it.each([Number.NaN, Number.POSITIVE_INFINITY])("nowMs が不正（%s）なら dt で数える", (nowMs) => {
    let s = startCalibration(null);
    s = advanceCalibration(s, { dt: DT, nowMs: 10_000, motion: [], orientation: [] });
    s = advanceCalibration(s, { dt: 0.5, nowMs, motion: [], orientation: [] });
    expect(s.clockMs).toBe(10_500);
  });

  it("nowMs が戻った時も区間は startMs ≤ endMs", () => {
    const base = 100_000;
    let s = runWithNow(startCalibration(null), (x) => currentStepId(x) === "standing", base);
    s = passPrep(s, base + 40_000);
    // 時刻が戻ったフレームの後に飛ばす
    s = advanceCalibration(s, { dt: DT, nowMs: 0, motion: [], orientation: [] });
    s = skipCalibrationStep(s);
    const seg = s.segments[0];
    expect(seg?.kind).toBe("standing");
    if (seg === undefined) throw new Error("区間が無い");
    expect(seg.startMs).toBeLessThanOrEqual(seg.endMs);
  });

  it("同じ種類の区間は 1 つまで（前回の区間を持って同じ手順を行えば差し替える）", () => {
    const prev: CalibrationProfile = {
      ...PREVIOUS,
      segments: [
        { kind: "standing", startMs: 1, endMs: 2, outcome: "skipped" },
        { kind: "stepping", startMs: 3, endMs: 4, outcome: "skipped" },
      ],
    };
    const s0: CalibrationState = { ...startCalibration(prev), plan: FULL_CALIBRATION_PLAN };
    const r = runUntil(s0, isCalibrationFinished, 120);
    const kinds = r.state.segments.map((x) => x.kind);
    expect(new Set(kinds).size).toBe(kinds.length);
    expect([...kinds].sort()).toEqual(
      ["crouchWalking", "crouching", "standing", "stepping"].sort(),
    );
    const standing = r.state.segments.find((x) => x.kind === "standing");
    expect(standing?.outcome).toBe("completed");
    expect(standing?.startMs).not.toBe(1);
  });
});

describe("restartCalibrationStep（準備からやり直す）", () => {
  function midStanding(): CalibrationState {
    let s = runWithNow(startCalibration(null), (x) => currentStepId(x) === "standing", 0);
    s = passPrep(s);
    return runUntil(s, () => false, 2, { motion: () => BASE, yawDeg: () => 0 }).state;
  }

  it("手順の途中なら，経過時間とサンプルを捨てて準備に戻す", () => {
    const s = midStanding();
    expect(s.stepStage).toBe("measure");
    expect(s.phaseElapsed).toBeGreaterThan(0);
    expect(s.motion.length).toBeGreaterThan(0);
    const r = restartCalibrationStep(s, 900_000);
    expect(currentStepId(r)).toBe("standing");
    expect(r.stepStage).toBe("prep");
    expect(r.prepElapsed).toBe(0);
    expect(r.phaseElapsed).toBe(0);
    expect(r.motion).toEqual([]);
    expect(r.orientation).toEqual([]);
    expect(remainingPrepSeconds(r)).toBe(3);
    expect(remainingStepSeconds(r)).toBeNull();
  });

  it("準備の途中でやり直しても，準備を最初から数える", () => {
    const prep = { ...enterStep("standing"), prepElapsed: 2 };
    const r = restartCalibrationStep(prep, 900_000);
    expect(r.stepStage).toBe("prep");
    expect(r.prepElapsed).toBe(0);
  });

  it("やり直した後の区間は，やり直した後の準備を終えた時刻から始まる", () => {
    let r = restartCalibrationStep(midStanding(), 900_000);
    r = passPrep(r, 903_000);
    const next = skipCalibrationStep(
      advanceCalibration(r, { dt: DT, nowMs: 904_000, motion: [], orientation: [] }),
    );
    expect(next.segments).toEqual([
      { kind: "standing", startMs: 903_000, endMs: 904_000, outcome: "skipped" },
    ]);
  });

  it("やり直した後は準備 3 秒 ＋ 計測 10 秒をもう一度最初から数える", () => {
    const r = restartCalibrationStep(midStanding(), 900_000);
    const run = runCurrentStep(r, {});
    expect(run.seconds).toBeCloseTo(PREP + MEASURE, 1);
  });

  it("再開の時刻が前の時刻より前でも，時刻は戻らない", () => {
    const s = midStanding();
    const r = restartCalibrationStep(s, 0);
    expect(r.stepStartMs).toBeGreaterThanOrEqual(s.clockMs ?? 0);
  });

  it("手順の最中でなければ（align・intro・outro・finished）状態を変えない", () => {
    const align = startCalibration(null);
    expect(restartCalibrationStep(align, 1000)).toBe(align);
    const intro = skipCalibrationStep(align);
    expect(restartCalibrationStep(intro, 1000)).toBe(intro);
    let s = align;
    for (let i = 0; i < 20 && s.phase !== "outro"; i++) s = skipCalibrationStep(s);
    expect(restartCalibrationStep(s, 1000)).toBe(s);
    const fin = skipCalibrationStep(s);
    expect(restartCalibrationStep(fin, 1000)).toBe(fin);
  });

  it("状態を書き換えない（不変更新）", () => {
    const s = deepFreeze(midStanding());
    const snapshot = JSON.parse(JSON.stringify(s));
    restartCalibrationStep(s, 900_000);
    expect(JSON.parse(JSON.stringify(s))).toEqual(snapshot);
  });
});

describe("「もう一度」と区間", () => {
  const prevWithSegments: CalibrationProfile = {
    ...PREVIOUS,
    segments: [
      { kind: "standing", startMs: 100, endMs: 200, outcome: "completed" },
      { kind: "crouching", startMs: 200, endMs: 300, outcome: "timeout" },
      { kind: "crouchWalking", startMs: 300, endMs: 400, outcome: "skipped" },
      { kind: "stepping", startMs: 400, endMs: 500, outcome: "completed" },
    ],
  };

  it("前回の区間をそのまま引き継ぎ，正面だけを行っても区間は変わらない", () => {
    expect(startCalibration(prevWithSegments).segments).toEqual(prevWithSegments.segments);
    const r = runUntil(startCalibration(prevWithSegments), isCalibrationFinished, 120, {
      yawDeg: () => 30,
    });
    const profile = toCalibrationProfile(r.state, 999);
    expect(profile.segments).toEqual(prevWithSegments.segments);
    expect(profile.yawOffset).toBeCloseTo(30 * DEG, 3);
  });
});
