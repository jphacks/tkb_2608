// キャリブレーションの手順の進行と，各手順の区間（CalibrationProfile.segments）の記録．
// DOM・three.js に依存しない純粋な関数（センサーの購読は sensorFeed.ts，表示は lobbyScene.ts）．
//
// lobby/ は手順の開始と終了（区間）を記録して渡し，しきい値の計算は input/ が行う（Issue #58．SPEC_01「キャリブレーションとの分担」）．
// ここでのセンサーの集計は，手順を早く終える判定（止まった・何歩踏んだ）に要る分だけにする．
// - yawOffset: 正面を向いた時の頭のヨー角（rad）．headYawFromDeviceOrientation() で求めた角度の円周平均（lobby/ が測る）
//
// 以下は非推奨（core/types.ts の CalibrationProfile）．終わりの判定の途中で出る値をそのまま入れている（新しい集計は足さない）
// - standingBaseline: 立って静止している時の加速度の大きさ（|accelerationIncludingGravity|，m/s^2）の平均
// - crouchThreshold: しゃがむ動作で加速度の大きさが standingBaseline から最も離れた量（m/s^2）× 係数
// - stepPeakThreshold: 足踏みで加速度の大きさが standingBaseline を上回った山の高さ（m/s^2）の中央値 × 係数

import type {
  CalibrationProfile,
  CalibrationSegment,
  CalibrationSegmentKind,
  CalibrationSegmentOutcome,
} from "../core/types";
import { angleDifference, circularMean, headYawFromDeviceOrientation } from "./orientation";

/** devicemotion の 1 回分（accelerationIncludingGravity，m/s^2）．t は秒（performance.now() / 1000 等） */
export interface MotionSample {
  readonly t: number;
  readonly x: number;
  readonly y: number;
  readonly z: number;
}

/** deviceorientation の 1 回分（度）．screenAngle は screen.orientation.angle（度） */
export interface OrientationSample {
  readonly t: number;
  readonly alpha: number;
  readonly beta: number;
  readonly gamma: number;
  readonly screenAngle: number;
}

/** CalibrationProfile のうち測る値（区間 segments は別に持つ） */
export type CalibrationValues = Omit<CalibrationProfile, "createdAt" | "segments">;

export const STANDARD_GRAVITY = 9.80665;

/** 測れなかった時（時間切れ・センサーなし）に使う既定値 */
export const DEFAULT_CALIBRATION_VALUES: CalibrationValues = {
  yawOffset: 0,
  standingBaseline: STANDARD_GRAVITY,
  crouchThreshold: 1.5,
  stepPeakThreshold: 2.0,
};

export type CalibrationStepId =
  | "faceFront"
  | "standing"
  | "crouching"
  | "crouchWalking"
  | "stepping";

/**
 * 全手順の順番．しゃがんだ流れのまましゃがみ歩きをし，最後に立ち上がって足踏みする
 * （姿勢の切り替えはしゃがむ・立つの 2 回だけ．立った姿勢で体験に入れる）
 */
export const FULL_CALIBRATION_PLAN: readonly CalibrationStepId[] = [
  "faceFront",
  "standing",
  "crouching",
  "crouchWalking",
  "stepping",
];

/** 区間を記録する手順と，区間の種類（正面は区間を使わないため記録しない） */
const SEGMENT_KIND: Readonly<Record<CalibrationStepId, CalibrationSegmentKind | null>> = {
  faceFront: null,
  standing: "standing",
  crouching: "crouching",
  crouchWalking: "crouchWalking",
  stepping: "stepping",
};

export interface CalibrationConfig {
  /**
   * 見え方の調整（二眼の像が重なるよう，ゴーグル側でスマホの位置・レンズの幅を合わせる）の秒数．
   * 完了の判定は持たず，この秒数たったら次へ進む．CalibrationProfile の値は作らない
   */
  readonly alignSeconds: number;
  /** 最初の説明の秒数 */
  readonly introSeconds: number;
  /** 終わりの案内の秒数 */
  readonly outroSeconds: number;
  readonly faceFront: {
    /** 向きを保つ秒数 */
    readonly holdSeconds: number;
    /** 保っているとみなす平均からのずれの上限（rad） */
    readonly toleranceRad: number;
    readonly minSamples: number;
    readonly timeoutSeconds: number;
  };
  readonly standing: {
    /** 手順の始めに捨てる秒数（指示を聞いて姿勢を整える間） */
    readonly settleSeconds: number;
    readonly holdSeconds: number;
    /** 静止とみなす標準偏差の上限（m/s^2） */
    readonly maxStdDev: number;
    readonly minSamples: number;
    readonly timeoutSeconds: number;
  };
  readonly crouching: {
    /** 手順に入ってから完了とするまでの最短の秒数 */
    readonly minSeconds: number;
    /** しゃがむ動作とみなす，基準からのずれの最小値（m/s^2） */
    readonly minPeak: number;
    /** しゃがんだ後に止まっているかを見る秒数 */
    readonly stillSeconds: number;
    readonly maxStdDev: number;
    /** 測ったずれに掛ける係数 */
    readonly thresholdRatio: number;
    readonly timeoutSeconds: number;
  };
  /** しゃがみ歩き．終わりの判定は足踏みと同じく山を数える（値の集計はしない） */
  readonly crouchWalking: {
    readonly requiredSteps: number;
    /** 1 歩とみなす山の最小の高さ（m/s^2） */
    readonly minPeak: number;
    /** 山と山の最短の間隔（秒） */
    readonly minIntervalSeconds: number;
    readonly timeoutSeconds: number;
  };
  readonly stepping: {
    readonly requiredSteps: number;
    /** 1 歩とみなす山の最小の高さ（m/s^2） */
    readonly minPeak: number;
    /** 山と山の最短の間隔（秒）．これより近い山は大きい方だけを数える */
    readonly minIntervalSeconds: number;
    /** 測った山の高さの中央値に掛ける係数 */
    readonly thresholdRatio: number;
    /** 時間切れの時に，測った値を使う最小の歩数 */
    readonly minStepsAtTimeout: number;
    readonly timeoutSeconds: number;
  };
  /** 測った値の下限・上限 */
  readonly limits: {
    readonly crouchThreshold: readonly [number, number];
    readonly stepPeakThreshold: readonly [number, number];
  };
}

export const DEFAULT_CALIBRATION_CONFIG: CalibrationConfig = {
  alignSeconds: 15,
  introSeconds: 4,
  outroSeconds: 3,
  faceFront: {
    holdSeconds: 3,
    toleranceRad: (15 * Math.PI) / 180,
    minSamples: 5,
    timeoutSeconds: 8,
  },
  standing: { settleSeconds: 1, holdSeconds: 3, maxStdDev: 0.8, minSamples: 10, timeoutSeconds: 8 },
  crouching: {
    minSeconds: 4,
    minPeak: 1.0,
    stillSeconds: 1.5,
    maxStdDev: 0.8,
    thresholdRatio: 0.5,
    timeoutSeconds: 10,
  },
  crouchWalking: { requiredSteps: 4, minPeak: 1.0, minIntervalSeconds: 0.25, timeoutSeconds: 12 },
  stepping: {
    requiredSteps: 6,
    minPeak: 1.0,
    minIntervalSeconds: 0.25,
    thresholdRatio: 0.6,
    minStepsAtTimeout: 2,
    timeoutSeconds: 12,
  },
  limits: { crouchThreshold: [0.5, 5], stepPeakThreshold: [0.8, 6] },
};

/** 各手順の結果．measured = 条件を満たして測れた，timedOut = 時間切れ（測れた分があればその値，無ければ前の値のまま） */
export type StepOutcome = "measured" | "timedOut";

/** 段階の順番: align（見え方の調整）→ intro → step（plan の手順）→ outro → finished */
export type CalibrationPhase = "align" | "intro" | "step" | "outro" | "finished";

export interface CalibrationState {
  /** 行う手順の順番 */
  readonly plan: readonly CalibrationStepId[];
  readonly phase: CalibrationPhase;
  /** phase が "step" の時の plan の位置 */
  readonly stepIndex: number;
  /** 今の phase（手順）に入ってからの秒数 */
  readonly phaseElapsed: number;
  /** 今の手順で集めたサンプル */
  readonly motion: readonly MotionSample[];
  readonly orientation: readonly OrientationSample[];
  /** 今までに決まった値（最初は既定値か前回の値） */
  readonly values: CalibrationValues;
  readonly outcomes: Readonly<Partial<Record<CalibrationStepId, StepOutcome>>>;
  /** 終えた手順の区間（行った順．「もう一度」では前回のもの） */
  readonly segments: readonly CalibrationSegment[];
  /** 最後に進めた時の時刻（performance.now() の ms）．まだ進めていなければ null */
  readonly clockMs: number | null;
  /** 今の手順に入った時刻（performance.now() の ms）．手順の最中でなければ null */
  readonly stepStartMs: number | null;
  /** 前回のキャリブレーションを引き継いだか */
  readonly reused: boolean;
}

/** 1 フレーム分の入力 */
export interface CalibrationFrame {
  readonly dt: number;
  /**
   * 今の時刻（performance.now() の ms．input/ のセンサーのサンプルと同じ時計）．区間の記録に使う．
   * 無い時は前の時刻に dt を足して数える
   */
  readonly nowMs?: number;
  readonly motion: readonly MotionSample[];
  readonly orientation: readonly OrientationSample[];
}

/**
 * キャリブレーションを始める．previous があれば（結果画面の「もう一度」で戻った時），
 * 姿勢と足踏みの値・区間は引き継ぎ，正面のリセットだけをやり直す（付け直しや立つ位置で正面がずれるため）．
 * 区間は前回のものをそのまま渡す（input/ が前回求めた値を保てるように．空にすると既定に戻りうる）
 */
export function startCalibration(previous: CalibrationProfile | null): CalibrationState {
  const values: CalibrationValues =
    previous === null
      ? DEFAULT_CALIBRATION_VALUES
      : {
          yawOffset: previous.yawOffset,
          standingBaseline: previous.standingBaseline,
          crouchThreshold: previous.crouchThreshold,
          stepPeakThreshold: previous.stepPeakThreshold,
        };
  return {
    plan: previous === null ? FULL_CALIBRATION_PLAN : ["faceFront"],
    // 「もう一度」でもゴーグルを付け直す前提で，見え方の調整から行う
    phase: "align",
    stepIndex: 0,
    phaseElapsed: 0,
    motion: [],
    orientation: [],
    values,
    outcomes: {},
    segments: previous?.segments ?? [],
    clockMs: null,
    stepStartMs: null,
    reused: previous !== null,
  };
}

/** 今の手順の ID．手順の最中でなければ null */
export function currentStepId(state: CalibrationState): CalibrationStepId | null {
  return state.phase === "step" ? (state.plan[state.stepIndex] ?? null) : null;
}

/** 今の手順の制限時間の残り秒数．手順の最中でなければ null */
export function remainingStepSeconds(
  state: CalibrationState,
  config: CalibrationConfig = DEFAULT_CALIBRATION_CONFIG,
): number | null {
  const id = currentStepId(state);
  if (id === null) return null;
  return Math.max(0, config[id].timeoutSeconds - state.phaseElapsed);
}

/** 見え方の調整の残り秒数．調整の最中でなければ null */
export function remainingAlignSeconds(
  state: CalibrationState,
  config: CalibrationConfig = DEFAULT_CALIBRATION_CONFIG,
): number | null {
  if (state.phase !== "align") return null;
  return Math.max(0, config.alignSeconds - state.phaseElapsed);
}

/** 1 フレーム進める */
export function advanceCalibration(
  current: CalibrationState,
  frame: CalibrationFrame,
  config: CalibrationConfig = DEFAULT_CALIBRATION_CONFIG,
): CalibrationState {
  const dt = Number.isFinite(frame.dt) && frame.dt > 0 ? frame.dt : 0;
  if (current.phase === "finished") return current;
  const state: CalibrationState = {
    ...current,
    clockMs: nextClock(current.clockMs, frame.nowMs, dt),
  };
  switch (state.phase) {
    case "align": {
      const elapsed = state.phaseElapsed + dt;
      if (elapsed < config.alignSeconds) return { ...state, phaseElapsed: elapsed };
      return { ...state, phase: "intro", phaseElapsed: 0 };
    }
    case "intro": {
      const elapsed = state.phaseElapsed + dt;
      if (elapsed < config.introSeconds) return { ...state, phaseElapsed: elapsed };
      return enterStep(state, 0);
    }
    case "step": {
      const next: CalibrationState = {
        ...state,
        phaseElapsed: state.phaseElapsed + dt,
        motion: frame.motion.length > 0 ? [...state.motion, ...frame.motion] : state.motion,
        orientation:
          frame.orientation.length > 0
            ? [...state.orientation, ...frame.orientation]
            : state.orientation,
      };
      return finishStepIfDone(next, config, false);
    }
    case "outro": {
      const elapsed = state.phaseElapsed + dt;
      if (elapsed < config.outroSeconds) return { ...state, phaseElapsed: elapsed };
      return { ...state, phase: "finished", phaseElapsed: 0 };
    }
    case "finished":
      return state;
  }
}

/** 時刻を進める．nowMs が使えればそれを，無ければ前の時刻に dt を足す（戻らないようにする） */
function nextClock(clockMs: number | null, nowMs: number | undefined, dt: number): number {
  const fallback = (clockMs ?? 0) + dt * 1000;
  if (nowMs === undefined || !Number.isFinite(nowMs)) return fallback;
  return clockMs === null ? nowMs : Math.max(clockMs, nowMs);
}

/**
 * 今の手順を最初からやり直す（縦向きの案内で止めた後に再開した時．lobbyScene が呼ぶ）．
 * 止めている間はゴーグルに入っておらず，その前後の値が混ざると区間の値が正しく求まらないため，
 * 経過時間・サンプルを捨てて，区間の始まりを nowMs（performance.now() の ms）にする．手順の最中でなければそのまま
 */
export function restartCalibrationStep(state: CalibrationState, nowMs: number): CalibrationState {
  if (state.phase !== "step") return state;
  const clockMs = nextClock(state.clockMs, nowMs, 0);
  return {
    ...state,
    phaseElapsed: 0,
    motion: [],
    orientation: [],
    clockMs,
    stepStartMs: clockMs,
  };
}

/**
 * 今の段階を飛ばす（開発用．手順の最中なら時間切れと同じ扱いで次へ進む．区間の outcome は skipped）
 */
export function skipCalibrationStep(
  state: CalibrationState,
  config: CalibrationConfig = DEFAULT_CALIBRATION_CONFIG,
): CalibrationState {
  switch (state.phase) {
    case "align":
      return { ...state, phase: "intro", phaseElapsed: 0 };
    case "intro":
      return enterStep(state, 0);
    case "step":
      return finishStepIfDone(state, config, true);
    case "outro":
      return { ...state, phase: "finished", phaseElapsed: 0 };
    case "finished":
      return state;
  }
}

/** 終わったか */
export function isCalibrationFinished(state: CalibrationState): boolean {
  return state.phase === "finished";
}

/** 今までに決まった値と区間を CalibrationProfile にする */
export function toCalibrationProfile(
  state: CalibrationState,
  createdAt: number,
): CalibrationProfile {
  return { createdAt, ...state.values, segments: state.segments };
}

function enterStep(state: CalibrationState, index: number): CalibrationState {
  if (index >= state.plan.length) {
    return {
      ...state,
      phase: "outro",
      phaseElapsed: 0,
      motion: [],
      orientation: [],
      stepStartMs: null,
    };
  }
  return {
    ...state,
    phase: "step",
    stepIndex: index,
    phaseElapsed: 0,
    motion: [],
    orientation: [],
    stepStartMs: state.clockMs ?? 0,
  };
}

/** 終えた手順の区間を足す（正面は区間を記録しない） */
function appendSegment(
  state: CalibrationState,
  id: CalibrationStepId,
  outcome: CalibrationSegmentOutcome,
): readonly CalibrationSegment[] {
  const kind = SEGMENT_KIND[id];
  if (kind === null) return state.segments;
  const endMs = state.clockMs ?? 0;
  const startMs = Math.min(state.stepStartMs ?? endMs, endMs);
  // 同じ種類は 1 つまで（「もう一度」で前回の区間を持っている時に同じ手順を行えば差し替える）
  const others = state.segments.filter((s) => s.kind !== kind);
  return [...others, { kind, startMs, endMs, outcome }];
}

function finishStepIfDone(
  state: CalibrationState,
  config: CalibrationConfig,
  force: boolean,
): CalibrationState {
  const id = currentStepId(state);
  if (id === null) return state;
  const timedOut = force || state.phaseElapsed >= config[id].timeoutSeconds;
  const result = evaluateStep(id, state, config, timedOut);
  if (result === null) return state;
  const segmentOutcome: CalibrationSegmentOutcome = force
    ? "skipped"
    : result.outcome === "measured"
      ? "completed"
      : "timeout";
  return enterStep(
    {
      ...state,
      values: { ...state.values, ...result.patch },
      outcomes: { ...state.outcomes, [id]: result.outcome },
      segments: appendSegment(state, id, segmentOutcome),
    },
    state.stepIndex + 1,
  );
}

interface StepResult {
  readonly outcome: StepOutcome;
  readonly patch: Partial<CalibrationValues>;
}

/** 手順が終わったかを判定する．終わっていなければ null */
function evaluateStep(
  id: CalibrationStepId,
  state: CalibrationState,
  config: CalibrationConfig,
  timedOut: boolean,
): StepResult | null {
  switch (id) {
    case "faceFront":
      return evaluateFaceFront(state, config, timedOut);
    case "standing":
      return evaluateStanding(state, config, timedOut);
    case "crouching":
      return evaluateCrouching(state, config, timedOut);
    case "crouchWalking":
      return evaluateCrouchWalking(state, config, timedOut);
    case "stepping":
      return evaluateStepping(state, config, timedOut);
  }
}

function evaluateFaceFront(
  state: CalibrationState,
  config: CalibrationConfig,
  timedOut: boolean,
): StepResult | null {
  const c = config.faceFront;
  const window = latestWindow(state.orientation, c.holdSeconds);
  const yaws = window.map((s) =>
    headYawFromDeviceOrientation(s.alpha, s.beta, s.gamma, s.screenAngle),
  );
  const mean = circularMean(yaws);
  if (state.phaseElapsed >= c.holdSeconds && mean !== null && yaws.length >= c.minSamples) {
    const covers = windowSpan(window) >= c.holdSeconds * 0.8;
    const steady = yaws.every((yaw) => Math.abs(angleDifference(mean, yaw)) <= c.toleranceRad);
    if (covers && steady) return { outcome: "measured", patch: { yawOffset: mean } };
  }
  if (!timedOut) return null;
  // 時間切れ: 最後の数秒の向きを使う．値が無ければ前の値のまま
  return { outcome: "timedOut", patch: mean === null ? {} : { yawOffset: mean } };
}

function evaluateStanding(
  state: CalibrationState,
  config: CalibrationConfig,
  timedOut: boolean,
): StepResult | null {
  const c = config.standing;
  const settled = afterSettle(state.motion, c.settleSeconds);
  const window = latestWindow(settled, c.holdSeconds);
  const magnitudes = window.map(accelerationMagnitude);
  if (
    state.phaseElapsed >= c.settleSeconds + c.holdSeconds &&
    magnitudes.length >= c.minSamples &&
    windowSpan(window) >= c.holdSeconds * 0.8 &&
    standardDeviation(magnitudes) <= c.maxStdDev
  ) {
    return { outcome: "measured", patch: { standingBaseline: mean(magnitudes) } };
  }
  if (!timedOut) return null;
  return {
    outcome: "timedOut",
    patch: magnitudes.length === 0 ? {} : { standingBaseline: mean(magnitudes) },
  };
}

function evaluateCrouching(
  state: CalibrationState,
  config: CalibrationConfig,
  timedOut: boolean,
): StepResult | null {
  const c = config.crouching;
  const baseline = state.values.standingBaseline;
  let peak = 0;
  for (const s of state.motion) {
    peak = Math.max(peak, Math.abs(accelerationMagnitude(s) - baseline));
  }
  const detected = peak >= c.minPeak;
  const threshold = clamp(peak * c.thresholdRatio, config.limits.crouchThreshold);
  if (state.phaseElapsed >= c.minSeconds && detected) {
    const still = latestWindow(state.motion, c.stillSeconds);
    const stillMagnitudes = still.map(accelerationMagnitude);
    if (
      stillMagnitudes.length >= 2 &&
      windowSpan(still) >= c.stillSeconds * 0.8 &&
      standardDeviation(stillMagnitudes) <= c.maxStdDev
    ) {
      return { outcome: "measured", patch: { crouchThreshold: threshold } };
    }
  }
  if (!timedOut) return null;
  return { outcome: "timedOut", patch: detected ? { crouchThreshold: threshold } : {} };
}

function evaluateStepping(
  state: CalibrationState,
  config: CalibrationConfig,
  timedOut: boolean,
): StepResult | null {
  const c = config.stepping;
  const baseline = state.values.standingBaseline;
  const peaks = detectPeaks(
    state.motion.map((s) => ({ t: s.t, value: accelerationMagnitude(s) - baseline })),
    c.minPeak,
    c.minIntervalSeconds,
  );
  const threshold = (): number =>
    clamp(median(peaks.map((p) => p.value)) * c.thresholdRatio, config.limits.stepPeakThreshold);
  if (peaks.length >= c.requiredSteps) {
    return { outcome: "measured", patch: { stepPeakThreshold: threshold() } };
  }
  if (!timedOut) return null;
  return {
    outcome: "timedOut",
    patch: peaks.length >= c.minStepsAtTimeout ? { stepPeakThreshold: threshold() } : {},
  };
}

/**
 * しゃがみ歩き: 山を requiredSteps 回数えたら終える．値は作らない（しゃがみ歩きの山の大きさ等は input/ が区間から求める）
 */
function evaluateCrouchWalking(
  state: CalibrationState,
  config: CalibrationConfig,
  timedOut: boolean,
): StepResult | null {
  if (countSteps(state, config) >= config.crouchWalking.requiredSteps) {
    return { outcome: "measured", patch: {} };
  }
  return timedOut ? { outcome: "timedOut", patch: {} } : null;
}

/** 今の手順で数えた歩数（表示・しゃがみ歩きの終わりの判定用）．しゃがみ歩きの最中はその設定で数える */
export function countSteps(
  state: CalibrationState,
  config: CalibrationConfig = DEFAULT_CALIBRATION_CONFIG,
): number {
  const c = currentStepId(state) === "crouchWalking" ? config.crouchWalking : config.stepping;
  const baseline = state.values.standingBaseline;
  return detectPeaks(
    state.motion.map((s) => ({ t: s.t, value: accelerationMagnitude(s) - baseline })),
    c.minPeak,
    c.minIntervalSeconds,
  ).length;
}

// ---- 集計の小さな関数 ----

export interface TimedValue {
  readonly t: number;
  readonly value: number;
}

/**
 * 山（前後より大きく minPeak 以上の点）を探す．minIntervalSeconds より近い山は大きい方だけを残す
 */
export function detectPeaks(
  series: readonly TimedValue[],
  minPeak: number,
  minIntervalSeconds: number,
): TimedValue[] {
  const peaks: TimedValue[] = [];
  for (let i = 1; i < series.length - 1; i++) {
    const prev = series[i - 1];
    const cur = series[i];
    const next = series[i + 1];
    if (prev === undefined || cur === undefined || next === undefined) continue;
    if (cur.value < minPeak || cur.value < prev.value || cur.value <= next.value) continue;
    const last = peaks[peaks.length - 1];
    if (last !== undefined && cur.t - last.t < minIntervalSeconds) {
      if (cur.value > last.value) peaks[peaks.length - 1] = cur;
      continue;
    }
    peaks.push(cur);
  }
  return peaks;
}

export function accelerationMagnitude(s: MotionSample): number {
  return Math.sqrt(s.x * s.x + s.y * s.y + s.z * s.z);
}

/** 最後のサンプルから seconds 秒以内のサンプル */
function latestWindow<T extends { readonly t: number }>(
  samples: readonly T[],
  seconds: number,
): T[] {
  const last = samples[samples.length - 1];
  if (last === undefined) return [];
  return samples.filter((s) => s.t >= last.t - seconds);
}

/** 最初のサンプルから seconds 秒より後のサンプル */
function afterSettle<T extends { readonly t: number }>(
  samples: readonly T[],
  seconds: number,
): T[] {
  const first = samples[0];
  if (first === undefined) return [];
  return samples.filter((s) => s.t >= first.t + seconds);
}

function windowSpan(samples: readonly { readonly t: number }[]): number {
  const first = samples[0];
  const last = samples[samples.length - 1];
  return first === undefined || last === undefined ? 0 : last.t - first.t;
}

function mean(values: readonly number[]): number {
  if (values.length === 0) return 0;
  let sum = 0;
  for (const v of values) sum += v;
  return sum / values.length;
}

function standardDeviation(values: readonly number[]): number {
  if (values.length === 0) return 0;
  const m = mean(values);
  let sum = 0;
  for (const v of values) sum += (v - m) * (v - m);
  return Math.sqrt(sum / values.length);
}

function median(values: readonly number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  const hi = sorted[mid] ?? 0;
  return sorted.length % 2 === 1 ? hi : ((sorted[mid - 1] ?? hi) + hi) / 2;
}

function clamp(value: number, [min, max]: readonly [number, number]): number {
  return Math.min(max, Math.max(min, value));
}
