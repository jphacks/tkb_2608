// 足踏みの状態機械と速さ（experiment_山﨑/04 ⑤⑥）．
// 止まる → （1 歩目）仮に歩く（低速）→（間隔の合う 2 歩目）歩く → （山が途切れる）止まる．
// 速さは臨界減衰のバネとダンパーで目標に追わせ，加速度に上限を付ける（急な加減速は酔いの原因になる）
import type { InputParams } from "../params";

export type LocomotionMode = "stopped" | "tentative" | "walking";

export interface LocomotionState {
  mode: LocomotionMode;
  /** 最後の歩の時刻（ms） */
  lastStepT: number;
  /** 直近の歩の周期（秒）．歩くになるまでは NaN */
  periodSec: number;
  /** 今の速さ（m/s）と，その変化の速さ（m/s^2） */
  speed: number;
  speedRate: number;
}

export function createLocomotionState(): LocomotionState {
  return {
    mode: "stopped",
    lastStepT: Number.NEGATIVE_INFINITY,
    periodSec: Number.NaN,
    speed: 0,
    speedRate: 0,
  };
}

/** 止める（速さもすぐに 0 にする．センサーが途切れた時等の安全側の初期化） */
export function resetLocomotion(s: LocomotionState): void {
  s.mode = "stopped";
  s.lastStepT = Number.NEGATIVE_INFINITY;
  s.periodSec = Number.NaN;
  s.speed = 0;
  s.speedRate = 0;
}

type LocomotionParams = Pick<
  InputParams,
  | "stepMinIntervalMs"
  | "stepTentativeTimeoutMs"
  | "stepStopPeriodFactor"
  | "stepStopMaxMs"
  | "strideM"
  | "maxWalkSpeed"
  | "tentativeWalkSpeed"
  | "speedSpringOmega"
  | "speedMaxAccel"
  | "speedMaxDecel"
>;

/** 周期の見積もりに使う間隔の範囲（秒）．外れた間隔は周期を乱さないよう丸める */
const MIN_PERIOD_SEC = 0.25;
const MAX_PERIOD_SEC = 1.5;

/** 1 歩を数えた時に呼ぶ（t は山の時刻．ms） */
export function onLocomotionStep(s: LocomotionState, t: number, params: LocomotionParams): void {
  const intervalMs = t - s.lastStepT;
  switch (s.mode) {
    case "stopped":
      s.mode = "tentative";
      s.lastStepT = t;
      return;
    case "tentative":
      if (intervalMs < params.stepMinIntervalMs) return; // 速すぎる 2 歩目は数えない（1 歩目の揺れの続き）
      if (intervalMs > params.stepTentativeTimeoutMs) {
        // 時間切れの後の歩は，新しい 1 歩目として扱う
        s.lastStepT = t;
        return;
      }
      s.mode = "walking";
      s.periodSec = intervalMs / 1000;
      s.lastStepT = t;
      return;
    case "walking": {
      const sec = Math.max(MIN_PERIOD_SEC, Math.min(MAX_PERIOD_SEC, intervalMs / 1000));
      // 周期は直近の間隔に寄せた指数移動平均（1 歩のずれで速さが跳ねないように）
      s.periodSec = Number.isFinite(s.periodSec) ? s.periodSec * 0.5 + sec * 0.5 : sec;
      s.lastStepT = t;
      return;
    }
  }
}

/** 止まるまでの待ち（ms）．直近の周期の stepStopPeriodFactor 倍（最長 stepStopMaxMs） */
export function stopTimeoutMs(s: LocomotionState, params: LocomotionParams): number {
  if (s.mode === "tentative") return params.stepTentativeTimeoutMs;
  if (!Number.isFinite(s.periodSec)) return params.stepStopMaxMs;
  return Math.min(params.stepStopMaxMs, s.periodSec * 1000 * params.stepStopPeriodFactor);
}

/** 今の状態で目指す速さ（m/s） */
export function targetSpeed(s: LocomotionState, params: LocomotionParams): number {
  switch (s.mode) {
    case "stopped":
      return 0;
    case "tentative":
      return Math.min(params.tentativeWalkSpeed, params.maxWalkSpeed);
    case "walking": {
      if (!(s.periodSec > 0)) return params.tentativeWalkSpeed;
      return Math.min(params.maxWalkSpeed, params.strideM / s.periodSec);
    }
  }
}

/**
 * 速さを目標へ dtSec 秒だけ進める（臨界減衰のバネとダンパー．加速度は上限で切る）．
 * 状態を書き換える．target・dt が有限でなければ何もしない
 */
export function smoothSpeed(
  s: { speed: number; speedRate: number },
  target: number,
  dtSec: number,
  params: Pick<InputParams, "speedSpringOmega" | "speedMaxAccel" | "speedMaxDecel">,
): void {
  if (!(dtSec > 0) || !Number.isFinite(target)) return;
  const w = params.speedSpringOmega;
  const accel = w * w * (target - s.speed) - 2 * w * s.speedRate;
  let rate = s.speedRate + accel * dtSec;
  rate = Math.max(-params.speedMaxDecel, Math.min(params.speedMaxAccel, rate));
  let speed = s.speed + rate * dtSec;
  // 目標を行き過ぎない（臨界減衰でも dt が粗いと越えることがある）
  if ((s.speed <= target && speed > target) || (s.speed >= target && speed < target)) {
    speed = target;
    rate = 0;
  }
  if (speed < 0) {
    speed = 0;
    rate = 0;
  }
  s.speed = speed;
  s.speedRate = rate;
}

/** walking とみなす最小の速さ（m/s）．止まった後，速さがこれを下回るまでは walking を true のままにする */
export const WALKING_MIN_SPEED = 0.02;

/**
 * 1 サンプル分進める: 止まる条件を確かめ，速さを目標へ動かす．t は今の時刻（ms）
 * 戻り値は状態が変わったか
 */
export function updateLocomotion(
  s: LocomotionState,
  t: number,
  dtSec: number,
  params: LocomotionParams,
): boolean {
  const before = s.mode;
  if (s.mode !== "stopped" && t - s.lastStepT > stopTimeoutMs(s, params)) {
    s.mode = "stopped";
    s.periodSec = Number.NaN;
  }
  smoothSpeed(s, targetSpeed(s, params), dtSec, params);
  return s.mode !== before;
}

/** 外に出す walking．止まる状態になっても，減速し終わるまでは true */
export function isWalking(s: LocomotionState): boolean {
  return s.mode !== "stopped" || s.speed > WALKING_MIN_SPEED;
}
