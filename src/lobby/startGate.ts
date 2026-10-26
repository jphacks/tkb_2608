// ロビーの開始ボタンの判定（DOM・three.js に依存しない純粋な関数）．
// ゴーグルを付ける時間を取るため，ボタンが押されるまでキャリブレーションを始めない．
// 開始の方法は StartGateConfig.startMode の 1 か所で切り替える
// - "hand"（本番の既定．Issue #110）: 手で開始ボタンに触れたら始める．自動では始めない
//   （カメラが使えない時は開始画面で止めるため，ロビーに来る時は手を認識できる．startPolicy.ts）
// - "auto"（手が無かった頃の方式．残しておく）: ゴーグルを付ける時間として autoStartSeconds たったら自動で始める
// - 手（startMode が "hand" の時）: input/ の PlayerInput.hands で，tracked な手の人差し指の先（指先が無い入力では
//   手のひらの中心）がボタンの範囲に入った状態が handHoldSeconds 続いたら開始．範囲は目から見た向きで判定する
//   （見た目どおり，指先がボタンに重なって見えれば押せる．isHandOnButton）
// - 注視（デバッグ用．本実装は input/ の PlayerInput.hands）: 視線がボタンを捉えた状態が
//   gazeHoldSeconds 続いたら開始．装着中に誤って始まらないよう，
//   端末が横向きでほぼ水平（ゴーグルに入れて前を向いた姿勢）の時だけ数える
//   （向きのセンサーが無い時（PC 等）は姿勢を問わない）
// 見え方の調整を終えるボタンも，startMode が "hand" の時は同じ判定（buttonOffset だけ ALIGN_BUTTON_OFFSET）で押す
// 座標は rig（目の位置が原点，回転なし）の座標系．-z が正面，y が上

import type { Handedness, HandState, Quat, Vec3 } from "../core/types";
import type { OrientationSample } from "./calibration";
import { deviceOrientationToQuat, rotateVec } from "./orientation";

/** 開始の方法．auto = 一定時間で自動，hand = 手で開始ボタンに触れる */
export type StartMode = "auto" | "hand";

export interface StartGateConfig {
  /** 開始の方法（hand = 手で開始ボタンに触れる，auto = 一定時間で自動） */
  readonly startMode: StartMode;
  /** startMode が "auto" の時，ロビーに入ってから自動で始めるまでの秒数（ゴーグルを付ける時間） */
  readonly autoStartSeconds: number;
  /** ボタンの中心（rig の座標．ヨー角 0 の時）．正面 0.5 m，目の高さ */
  readonly buttonOffset: Vec3;
  /**
   * 手がボタンに触れているとみなす範囲（m）．目から判定点（handSightPoint）への線が，ボタンの中心を通り視線に垂直な面と
   * 交わる点から，ボタンの中心までの距離の上限
   */
  readonly handRadius: number;
  readonly handHoldSeconds: number;
  /** 注視しているとみなす，視線とボタンの方向のなす角の上限（rad） */
  readonly gazeToleranceRad: number;
  readonly gazeHoldSeconds: number;
  /** 端末がほぼ水平とみなす，視線の上下の傾きの上限（rad） */
  readonly levelToleranceRad: number;
}

export const DEFAULT_START_GATE_CONFIG: StartGateConfig = {
  startMode: "hand",
  autoStartSeconds: 15,
  buttonOffset: { x: 0, y: 0, z: -0.5 },
  handRadius: 0.12,
  handHoldSeconds: 1,
  gazeToleranceRad: (10 * Math.PI) / 180,
  gazeHoldSeconds: 3,
  levelToleranceRad: (20 * Math.PI) / 180,
};

/**
 * 見え方の調整を終えるボタンの中心（rig の座標．ヨー角 0 の時，m）．開始ボタンと同じ判定（advanceStartGate）を
 * buttonOffset だけ差し替えて使う．視野の中心の丸を隠さないよう，開始ボタン（目の高さの正面）より 0.15 m 下に置く
 * （約 17° 下．ボタンの上端でも丸から約 7° 離れる．背面カメラの縦の画角にも収まる範囲）．
 * 開始ボタンの位置から 0.15 m 離れ，handRadius（0.12 m）より遠いため，開始ボタンにかざしたままの手では押されない
 */
export const ALIGN_BUTTON_OFFSET: Vec3 = { x: 0, y: -0.15, z: -0.5 };

/**
 * 見え方の調整を始めてから，終えるボタンを出して押せるようにするまでの秒数（s）．
 * 開始ボタンからかざしっぱなしの手ですぐに押されるのを防ぎ，丸を見て合わせる間を取る
 */
export const ALIGN_BUTTON_ARM_SECONDS = 3;

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

/**
 * 手で押す判定点（頭の座標系）．人差し指の先があればそれを，無い・値が有限でない時（記録の再生等）は手のひらの中心を使う．
 * scenes/common/handButtonPress.ts の handPressPoint と同じ（画面を持つモジュール同士は import しないため持つ）
 */
export function handPressPoint(hand: HandState): Vec3 {
  const t = hand.indexTip;
  return t !== undefined && Number.isFinite(t.x) && Number.isFinite(t.y) && Number.isFinite(t.z)
    ? t
    : hand.position;
}

/** 描いた手の形（21 点）の人差し指の先の番号（MediaPipe の HandLandmarker と同じ） */
const INDEX_TIP_LANDMARK = 8;

/**
 * 見た目で重ねる判定点（頭の座標系）．描いた手の形（landmarks）の人差し指の先があればそれを，
 * 無い・値が有限でない時は handPressPoint を使う．
 * 手の形は固定の奥行きに描き，indexTip は見積もった奥行きに置くため，見えている指先の向きには landmarks の方が合う
 */
export function handSightPoint(hand: HandState): Vec3 {
  const t = hand.landmarks?.[INDEX_TIP_LANDMARK];
  return t !== undefined && Number.isFinite(t.x) && Number.isFinite(t.y) && Number.isFinite(t.z)
    ? t
    : handPressPoint(hand);
}

/**
 * 手（頭の座標系）の判定点（handSightPoint）がボタンの範囲に入っているか．
 * 目から見た向きで判定する（目から判定点への線がボタンの面（中心を通り，目からの向きに垂直）と交わる点と，
 * ボタンの中心との距離を比べる．ボタンと同じ面にある点はそのまま比べるのと同じ）．
 * 手の形はボタンより奥の固定の奥行きに描き，指先の奥行きの見積もりも揺れるため，3 次元の距離で比べると
 * 指先がボタンに重なって見えていても押せないことがある
 */
export function isHandOnButton(
  head: Quat,
  hand: HandState,
  center: Vec3,
  config: StartGateConfig = DEFAULT_START_GATE_CONFIG,
): boolean {
  if (!hand.tracked) return false;
  const p = rotateVec(head, handSightPoint(hand));
  const along = p.x * center.x + p.y * center.y + p.z * center.z;
  // 目より後ろ・真横の点はボタンの面と交わらない
  if (!(along > 0)) return false;
  const k = (center.x * center.x + center.y * center.y + center.z * center.z) / along;
  const dx = p.x * k - center.x;
  const dy = p.y * k - center.y;
  const dz = p.z * k - center.z;
  const d2 = dx * dx + dy * dy + dz * dz;
  return Number.isFinite(d2) && d2 <= config.handRadius * config.handRadius;
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
