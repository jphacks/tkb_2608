// ロビーの開始ボタンの判定（DOM・three.js に依存しない純粋な関数）．
// ゴーグルを付ける時間を取るため，ボタンが押されるまでキャリブレーションを始めない．
// 開始の方法は StartGateConfig.startMode の 1 か所で切り替える
// - "auto"（今の本番の既定）: ゴーグルを付ける時間として autoStartSeconds たったら自動で始める
//   （input/ の手がまだ無いための暫定）
// - "hand"（最終的な本番）: 手で開始ボタンに触れたら始める．自動では始めない
// 切り替え方: input/ の手（PlayerInput.hands）が揃ったら，DEFAULT_START_GATE_CONFIG.startMode を "hand" にする
// （手での開始が有効になり，自動開始が止まる）
// - 手（startMode が "hand" の時）: input/ の PlayerInput.hands で，tracked な手の手のひらがボタンの範囲に入った状態が
//   handHoldSeconds 続いたら開始
// - 注視（デバッグ用．本実装は input/ の PlayerInput.hands）: 視線がボタンを捉えた状態が
//   gazeHoldSeconds 続いたら開始．装着中に誤って始まらないよう，
//   端末が横向きでほぼ水平（ゴーグルに入れて前を向いた姿勢）の時だけ数える
//   （向きのセンサーが無い時（PC 等）は姿勢を問わない）
// 座標は rig（目の位置が原点，回転なし）の座標系．-z が正面，y が上

import type { Handedness, HandState, Quat, Vec3 } from "../core/types";
import type { OrientationSample } from "./calibration";
import { deviceOrientationToQuat, rotateVec } from "./orientation";

/** 開始の方法．auto = 一定時間で自動，hand = 手で開始ボタンに触れる */
export type StartMode = "auto" | "hand";

export interface StartGateConfig {
  /**
   * 開始の方法．input/ の手（PlayerInput.hands）が揃ったら "hand" にする
   * （手での開始を有効にし，自動開始を止める）
   */
  readonly startMode: StartMode;
  /** startMode が "auto" の時，ロビーに入ってから自動で始めるまでの秒数（ゴーグルを付ける時間） */
  readonly autoStartSeconds: number;
  /** ボタンの中心（rig の座標．ヨー角 0 の時）．正面 0.5 m，目の高さ */
  readonly buttonOffset: Vec3;
  /** 手がボタンに触れているとみなす，手のひらの中心からボタンの中心までの距離の上限（m） */
  readonly handRadius: number;
  readonly handHoldSeconds: number;
  /** 注視しているとみなす，視線とボタンの方向のなす角の上限（rad） */
  readonly gazeToleranceRad: number;
  readonly gazeHoldSeconds: number;
  /** 端末がほぼ水平とみなす，視線の上下の傾きの上限（rad） */
  readonly levelToleranceRad: number;
}

export const DEFAULT_START_GATE_CONFIG: StartGateConfig = {
  // input/ の手が揃ったら "hand" にする（手での開始を有効にし，自動開始を止める）
  startMode: "auto",
  autoStartSeconds: 15,
  buttonOffset: { x: 0, y: 0, z: -0.5 },
  handRadius: 0.12,
  handHoldSeconds: 1,
  gazeToleranceRad: (10 * Math.PI) / 180,
  gazeHoldSeconds: 3,
  levelToleranceRad: (20 * Math.PI) / 180,
};

export type StartTrigger = "auto" | "hand" | "gaze" | "skip";

export interface StartGateState {
  /** ロビーに入ってからの秒数（自動開始までの累積） */
  readonly waited: number;
  /** 手がボタンに触れ続けている秒数（離れたら 0） */
  readonly handHeld: number;
  /** 注視し続けている秒数（外れたら 0） */
  readonly gazeHeld: number;
  /** 開始した方法．開始前は null */
  readonly startedBy: StartTrigger | null;
}

export const INITIAL_START_GATE: StartGateState = {
  waited: 0,
  handHeld: 0,
  gazeHeld: 0,
  startedBy: null,
};

/** 開始に使う追加の入力源（手と自動開始は StartGateConfig.startMode で決まる） */
export interface StartGateSources {
  /** 注視（デバッグ用．本番では false にする．本実装は input/ の PlayerInput.hands） */
  readonly gaze: boolean;
}

export interface StartGateFrame {
  readonly dt: number;
  readonly sources: StartGateSources;
  /** 頭の向き（PlayerInput.head） */
  readonly head: Quat;
  readonly hands: Readonly<Record<Handedness, HandState>>;
  /** ボタンの今のヨー角（rad．指示板と一緒に頭の向きへ追従する） */
  readonly buttonYaw: number;
  /** 端末が横向きでほぼ水平か．向きのセンサーが無ければ null（姿勢を問わない） */
  readonly deviceLevel: boolean | null;
}

/** ヨー角 yaw の時のボタンの中心（rig の座標） */
export function buttonCenter(
  buttonYaw: number,
  config: StartGateConfig = DEFAULT_START_GATE_CONFIG,
): Vec3 {
  const { x, y, z } = config.buttonOffset;
  const c = Math.cos(buttonYaw);
  const s = Math.sin(buttonYaw);
  // Y 軸回りの回転（正で左へ回る）
  return { x: x * c + z * s, y, z: -x * s + z * c };
}

/** 手（頭の座標系）がボタンの範囲に入っているか */
export function isHandOnButton(
  head: Quat,
  hand: HandState,
  center: Vec3,
  config: StartGateConfig = DEFAULT_START_GATE_CONFIG,
): boolean {
  if (!hand.tracked) return false;
  const p = rotateVec(head, hand.position);
  const dx = p.x - center.x;
  const dy = p.y - center.y;
  const dz = p.z - center.z;
  return dx * dx + dy * dy + dz * dz <= config.handRadius * config.handRadius;
}

/** 視線がボタンを捉えているか */
export function isGazingAtButton(
  head: Quat,
  center: Vec3,
  config: StartGateConfig = DEFAULT_START_GATE_CONFIG,
): boolean {
  const f = rotateVec(head, { x: 0, y: 0, z: -1 });
  const len = Math.hypot(center.x, center.y, center.z);
  if (len === 0) return false;
  const cos = (f.x * center.x + f.y * center.y + f.z * center.z) / len;
  return cos >= Math.cos(config.gazeToleranceRad);
}

/**
 * deviceorientation の値から，端末が横向きでほぼ水平（ゴーグルに入れて前を向いた姿勢）かを判定する
 */
export function isDeviceLevel(
  sample: OrientationSample,
  config: StartGateConfig = DEFAULT_START_GATE_CONFIG,
): boolean {
  const angle = ((Math.round(sample.screenAngle) % 360) + 360) % 360;
  if (angle !== 90 && angle !== 270) return false;
  const q = deviceOrientationToQuat(sample.alpha, sample.beta, sample.gamma, sample.screenAngle);
  const f = rotateVec(q, { x: 0, y: 0, z: -1 });
  const pitch = Math.asin(Math.max(-1, Math.min(1, f.y)));
  return Math.abs(pitch) <= config.levelToleranceRad;
}

/** 1 フレーム進める．開始した後は変えない */
export function advanceStartGate(
  state: StartGateState,
  frame: StartGateFrame,
  config: StartGateConfig = DEFAULT_START_GATE_CONFIG,
): StartGateState {
  if (state.startedBy !== null) return state;
  const dt = Number.isFinite(frame.dt) && frame.dt > 0 ? frame.dt : 0;
  const center = buttonCenter(frame.buttonYaw, config);
  const waited = state.waited + dt;
  const handOn =
    config.startMode === "hand" &&
    (isHandOnButton(frame.head, frame.hands.left, center, config) ||
      isHandOnButton(frame.head, frame.hands.right, center, config));
  const gazing =
    frame.sources.gaze &&
    frame.deviceLevel !== false &&
    isGazingAtButton(frame.head, center, config);
  const handHeld = handOn ? state.handHeld + dt : 0;
  const gazeHeld = gazing ? state.gazeHeld + dt : 0;
  const startedBy: StartTrigger | null =
    handHeld >= config.handHoldSeconds
      ? "hand"
      : gazeHeld >= config.gazeHoldSeconds
        ? "gaze"
        : config.startMode === "auto" && waited >= config.autoStartSeconds
          ? "auto"
          : null;
  return { waited, handHeld, gazeHeld, startedBy };
}

/** 開始ボタンを押したことにする（デバッグ用の Enter / Space．本実装は input/ の PlayerInput.hands） */
export function skipStartGate(state: StartGateState): StartGateState {
  return state.startedBy !== null ? state : { ...state, startedBy: "skip" };
}

/** 自動開始までの残り秒数．startMode が "auto" でない時・開始した後は null */
export function autoStartRemainingSeconds(
  state: StartGateState,
  config: StartGateConfig = DEFAULT_START_GATE_CONFIG,
): number | null {
  if (config.startMode !== "auto" || state.startedBy !== null) return null;
  return Math.max(0, config.autoStartSeconds - state.waited);
}

/** ボタン上に出す進み具合（0〜1）．自動開始までのカウントダウン・手・注視のうち進んでいる方 */
export function startGateProgress(
  state: StartGateState,
  config: StartGateConfig = DEFAULT_START_GATE_CONFIG,
): number {
  if (state.startedBy !== null) return 1;
  const auto =
    config.startMode === "auto" && config.autoStartSeconds > 0
      ? state.waited / config.autoStartSeconds
      : 0;
  const p = Math.max(
    auto,
    state.handHeld / config.handHoldSeconds,
    state.gazeHeld / config.gazeHoldSeconds,
  );
  return Math.min(1, Math.max(0, p));
}
