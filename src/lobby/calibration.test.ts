import { describe, expect, it } from "vitest";
import type { CalibrationProfile } from "../core/types";
import {
  accelerationMagnitude,
  advanceCalibration,
  type CalibrationState,
  type CalibrationStepId,
  countSteps,
  currentStepId,
  DEFAULT_CALIBRATION_CONFIG,
  DEFAULT_CALIBRATION_VALUES,
  detectPeaks,
  FULL_CALIBRATION_PLAN,
  isCalibrationFinished,
  type MotionSample,
  type OrientationSample,
  remainingAlignSeconds,
  remainingStepSeconds,
  restartCalibrationStep,
  STANDARD_GRAVITY,
  skipCalibrationStep,
  startCalibration,
  toCalibrationProfile,
} from "./calibration";

const DEG = Math.PI / 180;
/** 2 進で正確に表せるフレームの刻み（累積の誤差を避ける） */
const DT = 1 / 32;
/** 1 フレームあたりの devicemotion の回数（64 Hz） */
const MOTION_PER_FRAME = 2;

type MotionGen = (t: number) => number | null;
type YawGen = (t: number) => number | null;

interface Generators {
  /** 時刻 t（その手順に入ってからの秒）の加速度の大きさ（m/s^2） */
  readonly motion?: MotionGen;
  /** 時刻 t の頭のヨー角（度．縦向きで端末を立てた姿勢の alpha として与える） */
  readonly yawDeg?: YawGen;
}

/** 時計（サンプルの t は秒） */
class Clock {
  t = 100;
  /** 今の手順（段階）に入った時刻 */
  phaseStart = 100;
}

function motionSample(t: number, magnitude: number): MotionSample {
  // 大きさだけが意味を持つので向きは適当に分ける
  return { t, x: magnitude * 0.6, y: magnitude * 0.8, z: 0 };
}

function orientationSample(t: number, alphaDeg: number): OrientationSample {
  return { t, alpha: alphaDeg, beta: 90, gamma: 0, screenAngle: 0 };
}

function step(state: CalibrationState, clock: Clock, gen: Generators): CalibrationState {
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
  const next = advanceCalibration(state, { dt: DT, motion, orientation });
  if (next.phase !== state.phase || next.stepIndex !== state.stepIndex) {
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
): { state: CalibrationState; seconds: number } {
  let s = state;
  let frames = 0;
  const maxFrames = Math.ceil(maxSeconds / DT);
  while (!done(s) && frames < maxFrames) {
    s = step(s, clock, gen);
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

/** 指定の手順の最初まで（飛ばして）進める */
function enterStep(id: CalibrationStepId, previous: CalibrationProfile | null = null) {
  let s = startCalibration(previous);
  for (let i = 0; i < 10 && currentStepId(s) !== id; i++) s = skipCalibrationStep(s);
  expect(currentStepId(s)).toBe(id);
  return s;
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

  it("各段階の秒数・制限時間", () => {
    const c = DEFAULT_CALIBRATION_CONFIG;
    expect(c.alignSeconds).toBe(15);
    expect(c.introSeconds).toBe(4);
    expect(c.outroSeconds).toBe(3);
    expect(c.faceFront.holdSeconds).toBe(3);
    expect(c.faceFront.toleranceRad).toBeCloseTo(15 * DEG);
    expect(c.faceFront.timeoutSeconds).toBe(8);
    expect(c.standing.settleSeconds).toBe(1);
    expect(c.standing.holdSeconds).toBe(3);
    expect(c.standing.maxStdDev).toBe(0.8);
    expect(c.standing.timeoutSeconds).toBe(8);
    expect(c.crouching.minSeconds).toBe(4);
    expect(c.crouching.minPeak).toBe(1.0);
    expect(c.crouching.stillSeconds).toBe(1.5);
    expect(c.crouching.timeoutSeconds).toBe(10);
    expect(c.crouchWalking.requiredSteps).toBe(4);
    expect(c.crouchWalking.minPeak).toBe(1.0);
    expect(c.crouchWalking.minIntervalSeconds).toBe(0.25);
    expect(c.crouchWalking.timeoutSeconds).toBe(12);
    expect(c.stepping.requiredSteps).toBe(6);
    expect(c.stepping.minPeak).toBe(1.0);
    expect(c.stepping.minIntervalSeconds).toBe(0.25);
    expect(c.stepping.timeoutSeconds).toBe(12);
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
  it("align は 15 秒，intro は 4 秒で次へ進む", () => {
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
    expect(intro.seconds).toBeCloseTo(4, 1);
  });

  it("align の途中では残り秒数が減っていく", () => {
    const { state } = runUntil(startCalibration(null), () => false, 5);
    expect(state.phase).toBe("align");
    expect(remainingAlignSeconds(state)).toBeCloseTo(10, 5);
    expect(remainingStepSeconds(state)).toBeNull();
    expect(currentStepId(state)).toBeNull();
  });

  it("何もしなくても各手順は制限時間で次へ進み，既定値のまま終わる（詰まらない）", () => {
    let s = startCalibration(null);
    s = runCurrentStep(s, {}).state; // align
    s = runCurrentStep(s, {}).state; // intro
    const timeouts: Record<CalibrationStepId, number> = {
      faceFront: 8,
      standing: 8,
      crouching: 10,
      crouchWalking: 12,
      stepping: 12,
    };
    for (const id of FULL_CALIBRATION_PLAN) {
      expect(currentStepId(s)).toBe(id);
      expect(remainingStepSeconds(s)).toBe(timeouts[id]);
      const r = runCurrentStep(s, {});
      expect(r.seconds).toBeCloseTo(timeouts[id], 1);
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
    expect(profile.segments?.map((x) => [x.kind, x.outcome])).toEqual([
      ["standing", "timeout"],
      ["crouching", "timeout"],
      ["crouchWalking", "timeout"],
      ["stepping", "timeout"],
    ]);
  });

  it("センサーの値が無くても全体は 72 秒以内（15+4+8+8+10+12+12+3）で終わる", () => {
    const r = runUntil(startCalibration(null), isCalibrationFinished, 120);
    expect(isCalibrationFinished(r.state)).toBe(true);
    expect(r.seconds).toBeLessThanOrEqual(72 + 0.2);
    expect(r.seconds).toBeGreaterThan(72 - 0.2);
  });

  it("「もう一度」は align → intro → 正面 → outro で終わり，何もしなければ前回の値のまま", () => {
    const r = runUntil(startCalibration(PREVIOUS), isCalibrationFinished, 120);
    expect(isCalibrationFinished(r.state)).toBe(true);
    expect(r.seconds).toBeLessThanOrEqual(15 + 4 + 8 + 3 + 0.2);
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

  it("状態を書き換えない（不変更新）", () => {
    const s = deepFreeze(enterStep("standing"));
    const snapshot = JSON.parse(JSON.stringify(s));
    const next = advanceCalibration(s, {
      dt: DT,
      motion: [motionSample(1, BASE), motionSample(1.01, BASE)],
      orientation: [orientationSample(1, 0)],
    });
    expect(JSON.parse(JSON.stringify(s))).toEqual(snapshot);
    expect(next.motion.length).toBe(2);
  });
});

describe("正面（faceFront）", () => {
  it("3 秒間 ±15° 以内で向きを保てば，制限時間より前にその向きで終わる", () => {
    const r = runCurrentStep(enterStep("faceFront"), { yawDeg: () => 40 });
    expect(r.state.outcomes.faceFront).toBe("measured");
    expect(r.seconds).toBeGreaterThanOrEqual(3);
    expect(r.seconds).toBeLessThan(8);
    expect(r.state.values.yawOffset).toBeCloseTo(40 * DEG, 3);
  });

  it("小さなぶれ（±5°）は保っているとみなし，平均の向きになる", () => {
    const r = runCurrentStep(enterStep("faceFront"), {
      yawDeg: (t) => 20 + 5 * Math.sin(t * 7),
    });
    expect(r.state.outcomes.faceFront).toBe("measured");
    expect(r.state.values.yawOffset).toBeCloseTo(20 * DEG, 1);
  });

  it("±180° をまたぐ向きでも正しく平均する", () => {
    const r = runCurrentStep(enterStep("faceFront"), {
      yawDeg: (t) => 180 + 3 * Math.sin(t * 7),
    });
    expect(r.state.outcomes.faceFront).toBe("measured");
    expect(Math.abs(Math.cos(r.state.values.yawOffset) + 1)).toBeLessThan(0.01);
  });

  it("向きが大きく動き続けると 8 秒で時間切れになる", () => {
    const r = runCurrentStep(enterStep("faceFront"), {
      yawDeg: (t) => 40 * Math.sin(t * 3),
    });
    expect(r.state.outcomes.faceFront).toBe("timedOut");
    expect(r.seconds).toBeCloseTo(8, 1);
    expect(currentStepId(r.state)).toBe("standing");
  });

  it("向きのサンプルが無ければ 8 秒で時間切れになり，既定値（0）のまま", () => {
    const r = runCurrentStep(enterStep("faceFront"), {});
    expect(r.state.outcomes.faceFront).toBe("timedOut");
    expect(r.seconds).toBeCloseTo(8, 1);
    expect(r.state.values.yawOffset).toBe(0);
  });

  it("前回の値を引き継いだ時の時間切れ（サンプルなし）は前回の値のまま", () => {
    const r = runCurrentStep(enterStep("faceFront", PREVIOUS), {});
    expect(r.state.outcomes.faceFront).toBe("timedOut");
    expect(r.state.values.yawOffset).toBe(0.4);
  });

  it("3 秒より前には終わらない", () => {
    const r = runUntil(enterStep("faceFront"), () => false, 2.5, { yawDeg: () => 0 });
    expect(currentStepId(r.state)).toBe("faceFront");
  });
});

describe("立つ（standing）", () => {
  it("静かに立っていれば基準値を測り，制限時間より前に終わる", () => {
    const r = runCurrentStep(enterStep("standing"), {
      motion: (t) => 9.6 + 0.05 * Math.sin(t * 13),
    });
    expect(r.state.outcomes.standing).toBe("measured");
    expect(r.seconds).toBeGreaterThanOrEqual(4); // 最初の 1 秒を捨てて 3 秒
    expect(r.seconds).toBeLessThan(8);
    expect(r.state.values.standingBaseline).toBeCloseTo(9.6, 1);
  });

  it("最初の 1 秒（姿勢を整える間）の値は基準値に含めない", () => {
    const r = runCurrentStep(enterStep("standing"), {
      motion: (t) => (t < 0.9 ? 15 : 9.6),
    });
    expect(r.state.outcomes.standing).toBe("measured");
    expect(r.state.values.standingBaseline).toBeCloseTo(9.6, 2);
  });

  it("揺れが大きい（標準偏差 0.8 超）と 8 秒で時間切れになり，測れた分の平均を使う", () => {
    const r = runCurrentStep(enterStep("standing"), {
      motion: (t) => (Math.floor(t * 64) % 2 === 0 ? 8.5 : 11.5),
    });
    expect(r.state.outcomes.standing).toBe("timedOut");
    expect(r.seconds).toBeCloseTo(8, 1);
    expect(r.state.values.standingBaseline).toBeCloseTo(10, 0);
    expect(r.state.values.standingBaseline).not.toBe(DEFAULT_CALIBRATION_VALUES.standingBaseline);
  });

  it("サンプルが無ければ 8 秒で時間切れになり既定値のまま", () => {
    const r = runCurrentStep(enterStep("standing"), {});
    expect(r.state.outcomes.standing).toBe("timedOut");
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

describe("しゃがむ（crouching）", () => {
  it("しゃがんで止まれば，4 秒以降にしきい値を測って終わる", () => {
    const r = runCurrentStep(enterStep("crouching"), { motion: crouchMotion });
    expect(r.state.outcomes.crouching).toBe("measured");
    expect(r.seconds).toBeGreaterThanOrEqual(4);
    expect(r.seconds).toBeLessThan(10);
    const v = r.state.values.crouchThreshold;
    expect(v).toBeGreaterThan(0);
    expect(v).not.toBe(DEFAULT_CALIBRATION_VALUES.crouchThreshold);
    const [lo, hi] = DEFAULT_CALIBRATION_CONFIG.limits.crouchThreshold;
    expect(v).toBeGreaterThanOrEqual(lo);
    expect(v).toBeLessThanOrEqual(hi);
  });

  it("4 秒より前には終わらない", () => {
    const r = runUntil(enterStep("crouching"), () => false, 3.9, { motion: crouchMotion });
    expect(currentStepId(r.state)).toBe("crouching");
  });

  it("ずれが 1.0 m/s² 未満なら，しゃがんだとみなさず 10 秒で時間切れ・既定値", () => {
    const r = runCurrentStep(enterStep("crouching"), {
      motion: (t) => (t > 1 && t < 1.5 ? BASE - 0.8 : BASE),
    });
    expect(r.state.outcomes.crouching).toBe("timedOut");
    expect(r.seconds).toBeCloseTo(10, 1);
    expect(r.state.values.crouchThreshold).toBe(1.5);
  });

  it("動き続けて止まらないと 10 秒で時間切れになり，測れたずれからしきい値を作る", () => {
    const r = runCurrentStep(enterStep("crouching"), {
      motion: (t) => BASE + 3 * Math.sin(t * 6),
    });
    expect(r.state.outcomes.crouching).toBe("timedOut");
    expect(r.seconds).toBeCloseTo(10, 1);
    expect(r.state.values.crouchThreshold).not.toBe(1.5);
  });

  it("前回の値を引き継いでいれば，時間切れで前回の値のまま（直接その手順の状態を作って確認）", () => {
    const base = enterStep("crouching");
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

describe("足踏み（stepping）", () => {
  it("6 歩踏めば制限時間より前にしきい値を測って終わる", () => {
    const r = runCurrentStep(enterStep("stepping"), { motion: stepMotion(10, 3) });
    expect(r.state.outcomes.stepping).toBe("measured");
    expect(r.seconds).toBeLessThan(12);
    expect(r.seconds).toBeGreaterThan(0.5 + 5 * 0.5);
    const v = r.state.values.stepPeakThreshold;
    const [lo, hi] = DEFAULT_CALIBRATION_CONFIG.limits.stepPeakThreshold;
    expect(v).toBeGreaterThanOrEqual(lo);
    expect(v).toBeLessThanOrEqual(hi);
    expect(v).not.toBe(DEFAULT_CALIBRATION_VALUES.stepPeakThreshold);
    expect(r.state.phase).toBe("outro");
  });

  it("5 歩では終わらない", () => {
    const r = runUntil(enterStep("stepping"), () => false, 6, { motion: stepMotion(5, 3) });
    expect(currentStepId(r.state)).toBe("stepping");
    expect(countSteps(r.state)).toBe(5);
  });

  it("山が 1.0 m/s² 未満なら歩数に数えず，12 秒で時間切れ・既定値", () => {
    const r = runCurrentStep(enterStep("stepping"), { motion: stepMotion(20, 0.8) });
    expect(r.state.outcomes.stepping).toBe("timedOut");
    expect(r.seconds).toBeCloseTo(12, 1);
    expect(r.state.values.stepPeakThreshold).toBe(2.0);
  });

  it("0.25 秒より近い山は 1 歩として数える", () => {
    const r = runUntil(enterStep("stepping"), () => false, 3, {
      motion: stepMotion(8, 3, 0.15),
    });
    // 0.15 秒間隔の 8 回の山は，0.25 秒以上離れた山だけが数えられる（8 歩にはならない）
    expect(countSteps(r.state)).toBeLessThan(8);
    expect(countSteps(r.state)).toBeGreaterThanOrEqual(1);
  });

  it("時間切れでも数歩測れていれば，その値を使う", () => {
    const r = runCurrentStep(enterStep("stepping"), { motion: stepMotion(3, 3) });
    expect(r.state.outcomes.stepping).toBe("timedOut");
    expect(r.seconds).toBeCloseTo(12, 1);
    expect(r.state.values.stepPeakThreshold).not.toBe(2.0);
  });

  it("サンプルが無ければ 12 秒で時間切れ・既定値", () => {
    const r = runCurrentStep(enterStep("stepping"), {});
    expect(r.state.outcomes.stepping).toBe("timedOut");
    expect(r.state.values.stepPeakThreshold).toBe(2.0);
  });
});

describe("skipCalibrationStep（時間切れと同じ扱い）", () => {
  it("align → intro → 最初の手順 と進む", () => {
    let s = startCalibration(null);
    s = skipCalibrationStep(s);
    expect(s.phase).toBe("intro");
    s = skipCalibrationStep(s);
    expect(currentStepId(s)).toBe("faceFront");
  });

  it("手順の最中は時間切れとして次へ進み，集めた値があればそれを使う", () => {
    const r = runUntil(enterStep("faceFront"), () => false, 1, { yawDeg: () => 50 });
    expect(currentStepId(r.state)).toBe("faceFront");
    const s = skipCalibrationStep(r.state);
    expect(s.outcomes.faceFront).toBe("timedOut");
    expect(currentStepId(s)).toBe("standing");
    expect(s.values.yawOffset).toBeCloseTo(50 * DEG, 3);
  });

  it("サンプルが無ければ既定値のまま進む", () => {
    const s = skipCalibrationStep(enterStep("standing"));
    expect(s.outcomes.standing).toBe("timedOut");
    expect(s.values.standingBaseline).toBe(STANDARD_GRAVITY);
  });

  it("全部飛ばすと outro → finished になり既定値", () => {
    let s = startCalibration(null);
    for (let i = 0; i < 20 && !isCalibrationFinished(s); i++) s = skipCalibrationStep(s);
    expect(isCalibrationFinished(s)).toBe(true);
    expect(s.values).toEqual(DEFAULT_CALIBRATION_VALUES);
  });

  it("新しい手順に入るとサンプルと経過時間は空になる", () => {
    const r = runUntil(enterStep("standing"), () => false, 1, { motion: () => BASE });
    const s = skipCalibrationStep(r.state);
    expect(currentStepId(s)).toBe("crouching");
    expect(s.motion).toEqual([]);
    expect(s.orientation).toEqual([]);
    expect(s.phaseElapsed).toBe(0);
  });
});

describe("remainingStepSeconds", () => {
  it("手順の制限時間から経過時間を引き，0 で止まる", () => {
    const s = enterStep("crouching");
    expect(remainingStepSeconds(s)).toBe(10);
    expect(remainingStepSeconds({ ...s, phaseElapsed: 3 })).toBe(7);
    expect(remainingStepSeconds({ ...s, phaseElapsed: 30 })).toBe(0);
  });

  it("手順の最中でなければ null", () => {
    expect(remainingStepSeconds(startCalibration(null))).toBeNull();
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

describe("しゃがみ歩き（crouchWalking）", () => {
  it("しゃがむの次・足踏みの前に行う", () => {
    const s = skipCalibrationStep(enterStep("crouching"));
    expect(currentStepId(s)).toBe("crouchWalking");
    expect(currentStepId(skipCalibrationStep(s))).toBe("stepping");
  });

  it("4 歩踏めば制限時間より前に終わり，区間は completed．値は作らない", () => {
    const before = enterStep("crouchWalking");
    const r = runCurrentStep(before, { motion: stepMotion(10, 3) });
    expect(currentStepId(r.state)).toBe("stepping");
    expect(r.state.outcomes.crouchWalking).toBe("measured");
    expect(r.seconds).toBeGreaterThan(0.5 + 3 * 0.5);
    expect(r.seconds).toBeLessThan(12);
    expect(r.state.values).toEqual(before.values);
    const seg = r.state.segments.find((x) => x.kind === "crouchWalking");
    expect(seg?.outcome).toBe("completed");
  });

  it("3 歩では終わらない", () => {
    const r = runUntil(enterStep("crouchWalking"), () => false, 6, { motion: stepMotion(3, 3) });
    expect(currentStepId(r.state)).toBe("crouchWalking");
    expect(countSteps(r.state)).toBe(3);
  });

  it("歩かなければ 12 秒で時間切れになり，区間は timeout", () => {
    const before = enterStep("crouchWalking");
    const r = runCurrentStep(before, {});
    expect(r.seconds).toBeCloseTo(12, 1);
    expect(currentStepId(r.state)).toBe("stepping");
    expect(r.state.outcomes.crouchWalking).toBe("timedOut");
    expect(r.state.values).toEqual(before.values);
    const seg = r.state.segments.find((x) => x.kind === "crouchWalking");
    expect(seg?.outcome).toBe("timeout");
    expect(remainingStepSeconds(before)).toBe(12);
  });

  it("山が 1.0 m/s² 未満なら歩数に数えない", () => {
    const r = runUntil(enterStep("crouchWalking"), () => false, 6, {
      motion: stepMotion(10, 0.8),
    });
    expect(countSteps(r.state)).toBe(0);
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
  it("何もしなければ 立つ → しゃがむ → しゃがみ歩き → 足踏み の順に，制限時間どおりの区間を timeout で記録する", () => {
    const r = runUntil(startCalibration(null), isCalibrationFinished, 120);
    // nowMs を渡さない時は dt の累積（0 ms から）で数える．align 15 + intro 4 + 正面 8 = 27 秒から立つが始まる
    expect(r.state.segments).toEqual([
      { kind: "standing", startMs: 27000, endMs: 35000, outcome: "timeout" },
      { kind: "crouching", startMs: 35000, endMs: 45000, outcome: "timeout" },
      { kind: "crouchWalking", startMs: 45000, endMs: 57000, outcome: "timeout" },
      { kind: "stepping", startMs: 57000, endMs: 69000, outcome: "timeout" },
    ]);
  });

  it("正面（faceFront）は区間を記録しない", () => {
    const r = runCurrentStep(enterStep("faceFront"), { yawDeg: () => 10 });
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

  it("立って静止できれば completed", () => {
    const r = runCurrentStep(enterStep("standing"), {
      motion: (t) => 9.6 + 0.05 * Math.sin(t * 13),
    });
    expect(r.state.segments.map((x) => [x.kind, x.outcome])).toEqual([["standing", "completed"]]);
  });

  it("しゃがんで止まれば completed，6 歩踏めば足踏みも completed", () => {
    const c = runCurrentStep(enterStep("crouching"), { motion: crouchMotion });
    expect(c.state.segments.find((x) => x.kind === "crouching")?.outcome).toBe("completed");
    const st = runCurrentStep(enterStep("stepping"), { motion: stepMotion(10, 3) });
    expect(st.state.segments.find((x) => x.kind === "stepping")?.outcome).toBe("completed");
  });

  it("時間切れは timeout（数歩測れて outcomes が timedOut の時も）", () => {
    const r = runCurrentStep(enterStep("stepping"), { motion: stepMotion(3, 3) });
    expect(r.state.outcomes.stepping).toBe("timedOut");
    expect(r.state.segments.find((x) => x.kind === "stepping")?.outcome).toBe("timeout");
  });

  it.each(["standing", "crouching", "crouchWalking", "stepping"] as const)(
    "%s を skipCalibrationStep で飛ばすと skipped",
    (id) => {
      const s = skipCalibrationStep(enterStep(id));
      const seg = s.segments.find((x) => x.kind === id);
      expect(seg?.outcome).toBe("skipped");
      // outcomes は従来どおり timedOut
      expect(s.outcomes[id]).toBe("timedOut");
    },
  );

  it("nowMs を渡すと，区間の時刻はその時刻になる", () => {
    const base = 5_000_000;
    let s = runWithNow(startCalibration(null), (x) => currentStepId(x) === "standing", base);
    expect(s.stepStartMs).toBe(base + 27000);
    s = runWithNow(s, (x) => currentStepId(x) === "crouching", base + 27000);
    expect(s.segments).toEqual([
      { kind: "standing", startMs: base + 27000, endMs: base + 35000, outcome: "timeout" },
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
        { kind: "standing", startMs: 1, endMs: 2, outcome: "completed" },
        { kind: "stepping", startMs: 3, endMs: 4, outcome: "completed" },
      ],
    };
    const s0: CalibrationState = { ...startCalibration(prev), plan: FULL_CALIBRATION_PLAN };
    const r = runUntil(s0, isCalibrationFinished, 120);
    const kinds = r.state.segments.map((x) => x.kind);
    expect(new Set(kinds).size).toBe(kinds.length);
    expect([...kinds].sort()).toEqual(
      ["crouchWalking", "crouching", "standing", "stepping"].sort(),
    );
    expect(r.state.segments.find((x) => x.kind === "standing")?.outcome).toBe("timeout");
  });
});

describe("restartCalibrationStep", () => {
  function midStanding(): CalibrationState {
    const s = runWithNow(startCalibration(null), (x) => currentStepId(x) === "standing", 0);
    return runUntil(s, () => false, 2, { motion: () => BASE, yawDeg: () => 0 }).state;
  }

  it("手順の途中なら，経過時間とサンプルを捨て，開始時刻を再開の時刻にする", () => {
    const s = midStanding();
    expect(s.phaseElapsed).toBeGreaterThan(0);
    expect(s.motion.length).toBeGreaterThan(0);
    const r = restartCalibrationStep(s, 900_000);
    expect(currentStepId(r)).toBe("standing");
    expect(r.phaseElapsed).toBe(0);
    expect(r.motion).toEqual([]);
    expect(r.orientation).toEqual([]);
    expect(r.stepStartMs).toBe(900_000);
    expect(remainingStepSeconds(r)).toBe(8);
  });

  it("やり直した後の区間は再開の時刻から始まる", () => {
    const r = restartCalibrationStep(midStanding(), 900_000);
    const next = skipCalibrationStep(
      advanceCalibration(r, { dt: DT, nowMs: 901_000, motion: [], orientation: [] }),
    );
    expect(next.segments).toEqual([
      { kind: "standing", startMs: 900_000, endMs: 901_000, outcome: "skipped" },
    ]);
  });

  it("やり直した後は制限時間をもう一度最初から数える", () => {
    const r = restartCalibrationStep(midStanding(), 900_000);
    const run = runCurrentStep(r, {});
    expect(run.seconds).toBeCloseTo(8, 1);
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
