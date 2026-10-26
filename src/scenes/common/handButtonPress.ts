// 手で押すボタン（VR の中）の押した判定（three.js・DOM に依存しない純粋な関数．Issue #145）．
// 人差し指の先（指先が無い入力では手のひらの中心）がボタンの範囲に入った状態が holdSeconds 続いたら押した扱いにする（離れたら数え直す）．
// 範囲は目から見た向きで判定する（見た目どおり，指先がボタンに重なって見えれば押せる．isHandOverButton）．
// 判定はロビーの開始ボタン（lobby/startGate.ts の advanceStartGate の手の判定）と同じ．
// 座標は rig（目の位置が原点，回転なし）の座標系．-z が正面，y が上

import type { Handedness, HandState, Quat, Vec3 } from "../../core/types";

export interface HandButtonPressConfig {
  /** 手をかざし続けたら押した扱いにする秒数（s） */
  readonly holdSeconds: number;
  /**
   * 手がボタンに触れているとみなす範囲（m）．目から判定点（handSightPoint）への線が，ボタンの中心を通り視線に垂直な面と
   * 交わる点から，ボタンの中心までの距離の上限
   */
  readonly radius: number;
  /**
   * ボタンを出してから押せるようにするまでの秒数（s）．前の画面からかざしたままの手で
   * すぐに押されるのを防ぐ（その間はボタンを隠し，かざした時間も数えない）
   */
  readonly armSeconds: number;
}

/** 既定値．かざす秒数と範囲はロビーの開始ボタン（DEFAULT_START_GATE_CONFIG）と同じ */
export const DEFAULT_HAND_BUTTON_PRESS_CONFIG: HandButtonPressConfig = {
  holdSeconds: 1,
  radius: 0.12,
  armSeconds: 0,
};

/** 押した方法．hand = 手をかざした，manual = 画面を持つ側が押したことにした（タップ・キー等の代わりの操作） */
export type HandButtonTrigger = "hand" | "manual";

export interface HandButtonPressState {
  /** ボタンを出してからの秒数（s．押せるようになるまでの待ちに使う） */
  readonly shown: number;
  /** 手がボタンに触れ続けている秒数（s．離れたら 0） */
  readonly held: number;
  /** 押した方法．押す前は null */
  readonly pressedBy: HandButtonTrigger | null;
}

export const INITIAL_HAND_BUTTON_PRESS: HandButtonPressState = {
  shown: 0,
  held: 0,
  pressedBy: null,
};

export interface HandButtonPressFrame {
  /** 前のフレームからの秒数（s） */
  readonly dt: number;
  /** このフレームで手がボタンの範囲に入っているか（isAnyHandOverButton） */
  readonly handOver: boolean;
}

/** ベクトルをクォータニオンで回す（lobby/orientation.ts の rotateVec と同じ式．画面を持つモジュール同士は import しないため持つ） */
export function rotateByQuat(q: Quat, v: Vec3): Vec3 {
  const tx = 2 * (q.y * v.z - q.z * v.y);
  const ty = 2 * (q.z * v.x - q.x * v.z);
  const tz = 2 * (q.x * v.y - q.y * v.x);
  return {
    x: v.x + q.w * tx + (q.y * tz - q.z * ty),
    y: v.y + q.w * ty + (q.z * tx - q.x * tz),
    z: v.z + q.w * tz + (q.x * ty - q.y * tx),
  };
}

/**
 * ボタンの中心（rig の座標）．offset は親（目の位置が原点で Y 軸回りだけに回る板の pivot 等）の座標，
 * parentYaw は親のヨー角（rad．正で左へ回る）．親が rig そのものなら 0
 */
export function handButtonCenter(offset: Vec3, parentYaw: number): Vec3 {
  const yaw = Number.isFinite(parentYaw) ? parentYaw : 0;
  const c = Math.cos(yaw);
  const s = Math.sin(yaw);
  return { x: offset.x * c + offset.z * s, y: offset.y, z: -offset.x * s + offset.z * c };
}

/**
 * 手で押す判定点（頭の座標系）．人差し指の先があればそれを，無い・値が有限でない時（記録の再生等）は手のひらの中心を使う．
 * lobby/startGate.ts の handPressPoint と同じ（画面を持つモジュール同士は import しないため持つ）
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
 * 手の形は固定の奥行きに描き，indexTip は見積もった奥行きに置くため，見えている指先の向きには landmarks の方が合う．
 * lobby/startGate.ts の handSightPoint と同じ（画面を持つモジュール同士は import しないため持つ）
 */
export function handSightPoint(hand: HandState): Vec3 {
  const t = hand.landmarks?.[INDEX_TIP_LANDMARK];
  return t !== undefined && Number.isFinite(t.x) && Number.isFinite(t.y) && Number.isFinite(t.z)
    ? t
    : handPressPoint(hand);
}

/**
 * 手（頭の座標系）の判定点（handSightPoint）がボタンの範囲に入っているか．見失った手・値が壊れた手は入っていない扱い．
 * 目から見た向きで判定する（目から判定点への線がボタンの面（中心を通り，目からの向きに垂直）と交わる点と，
 * ボタンの中心との距離を比べる．ボタンと同じ面にある点はそのまま比べるのと同じ）．
 * 手の形はボタンより奥の固定の奥行きに描き，指先の奥行きの見積もりも揺れるため，3 次元の距離で比べると
 * 指先がボタンに重なって見えていても押せないことがある．lobby/startGate.ts の isHandOnButton と同じ
 */
export function isHandOverButton(
  head: Quat,
  hand: HandState,
  center: Vec3,
  radius: number,
): boolean {
  if (!hand.tracked) return false;
  const p = rotateByQuat(head, handSightPoint(hand));
  const along = p.x * center.x + p.y * center.y + p.z * center.z;
  // 目より後ろ・真横の点はボタンの面と交わらない
  if (!(along > 0)) return false;
  const k = (center.x * center.x + center.y * center.y + center.z * center.z) / along;
  const dx = p.x * k - center.x;
  const dy = p.y * k - center.y;
  const dz = p.z * k - center.z;
  const d2 = dx * dx + dy * dy + dz * dz;
  return Number.isFinite(d2) && d2 <= radius * radius;
}

/** 左右どちらかの手がボタンの範囲に入っているか */
export function isAnyHandOverButton(
  head: Quat,
  hands: Readonly<Record<Handedness, HandState>>,
  center: Vec3,
  radius: number,
): boolean {
  return (
    isHandOverButton(head, hands.left, center, radius) ||
    isHandOverButton(head, hands.right, center, radius)
  );
}

/** 押せるようになっているか（出してから armSeconds たった） */
export function isHandButtonArmed(
  state: HandButtonPressState,
  config: HandButtonPressConfig = DEFAULT_HAND_BUTTON_PRESS_CONFIG,
): boolean {
  return state.shown >= config.armSeconds;
}

/** 1 フレーム進める．押した後は変えない */
export function advanceHandButtonPress(
  state: HandButtonPressState,
  frame: HandButtonPressFrame,
  config: HandButtonPressConfig = DEFAULT_HAND_BUTTON_PRESS_CONFIG,
): HandButtonPressState {
  if (state.pressedBy !== null) return state;
  const dt = Number.isFinite(frame.dt) && frame.dt > 0 ? frame.dt : 0;
  // 待ちの秒数は armSeconds で止める（長く出していても数が増え続けないため）
  const shown = Math.min(state.shown + dt, Math.max(state.shown, config.armSeconds));
  // 押せるようになった次のフレームから数える（押せるようになる前にかざしていた分は含めない）
  const armed = isHandButtonArmed(state, config);
  const held = armed && frame.handOver ? state.held + dt : 0;
  const pressedBy: HandButtonTrigger | null =
    armed && frame.handOver && held >= config.holdSeconds ? "hand" : null;
  return { shown, held, pressedBy };
}

/** 押したことにする（タップ・キー等の代わりの操作）．押した後は変えない */
export function pressHandButton(state: HandButtonPressState): HandButtonPressState {
  return state.pressedBy !== null ? state : { ...state, pressedBy: "manual" };
}

/** ボタンの周りに出す進み具合（0〜1）．押した後は 1 */
export function handButtonProgress(
  state: HandButtonPressState,
  config: HandButtonPressConfig = DEFAULT_HAND_BUTTON_PRESS_CONFIG,
): number {
  if (state.pressedBy !== null) return 1;
  if (!(config.holdSeconds > 0)) return 0;
  return Math.min(1, Math.max(0, state.held / config.holdSeconds));
}
