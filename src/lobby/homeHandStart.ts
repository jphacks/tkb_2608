// ホーム（1 画面の HTML）の「スタート」を手をかざして押すための純粋な関数（DOM に依存しない．Issue #147）．
// 頭の座標系の手のひらの位置を画面の上の位置（CSS ピクセル）に直し，ボタンの四角に重なっているかを決める．
// 押した判定（かざし続けた秒数）は app/ が渡す（scenes/common/handButtonPress.ts．lobby/ は scenes/ を import しないため）

import type { Handedness, HandState, Vec3 } from "../core/types";

/**
 * 手の位置を画面に写す時の見え方．画面いっぱいに，目（originZ の所）から fovDeg の画角で見えている範囲を写す．
 * 実機（device）は背面カメラの画角（input/ の cameraHfovDeg）を横に合わせ，カメラの映った範囲を画面に重ねる．
 * PC の mock はマウスの位置から手を作るので，表示のカメラ（縦 70 度）に合わせるとマウスの下に印が出る
 */
export interface HandScreenView {
  /** 画角（度）．axis の向きの全体の角度 */
  readonly fovDeg: number;
  /** fovDeg が画面の横の画角か縦の画角か */
  readonly axis: "horizontal" | "vertical";
  /**
   * 見る点の z（m．頭の座標系）．背面カメラは目より前にあるため，カメラの位置から見た向きで写す
   * （input/ の cameraOffsetZM と同じ値にすると，カメラの映像の上の位置とそろう）
   */
  readonly originZ: number;
}

/** 画面の上の点（CSS ピクセル．左上が原点，右・下が正） */
export interface ScreenPoint {
  readonly x: number;
  readonly y: number;
}

/** 画面の上の四角（CSS ピクセル．getBoundingClientRect と同じ向き） */
export interface ScreenRect {
  readonly left: number;
  readonly top: number;
  readonly right: number;
  readonly bottom: number;
}

/** 画角の半分の tan．画角がおかしければ NaN */
function halfTan(fovDeg: number): number {
  const half = (fovDeg * Math.PI) / 360;
  if (!(half > 0) || !(half < Math.PI / 2)) return Number.NaN;
  return Math.tan(half);
}

/**
 * 頭の座標系の位置（m）を，画面の上の点（CSS ピクセル）にする．
 * 見る点より後ろ・画角や画面の大きさがおかしい・値が有限でない時は null．画面の外の点もそのまま返す（isOnScreen で見る）
 */
export function handToScreen(
  position: Vec3,
  view: HandScreenView,
  width: number,
  height: number,
): ScreenPoint | null {
  if (!(width > 0) || !(height > 0) || !Number.isFinite(width) || !Number.isFinite(height)) {
    return null;
  }
  const t = halfTan(view.fovDeg);
  const depth = view.originZ - position.z;
  if (!Number.isFinite(t) || !(depth > 0) || !Number.isFinite(depth)) return null;
  // 横・縦の画角の半分の tan（画面の縦横比で片方から求める）
  const tanX = view.axis === "horizontal" ? t : (t * width) / height;
  const tanY = view.axis === "horizontal" ? (t * height) / width : t;
  const x = (0.5 + position.x / depth / tanX / 2) * width;
  const y = (0.5 - position.y / depth / tanY / 2) * height;
  return Number.isFinite(x) && Number.isFinite(y) ? { x, y } : null;
}

/** 点が画面（0〜width，0〜height）の中にあるか */
export function isOnScreen(point: ScreenPoint, width: number, height: number): boolean {
  return point.x >= 0 && point.x <= width && point.y >= 0 && point.y <= height;
}

/** 点が四角を margin（px）だけ広げた範囲に入っているか．値がおかしい時は入っていない扱い */
export function isPointInRect(point: ScreenPoint, rect: ScreenRect, margin = 0): boolean {
  const m = Number.isFinite(margin) && margin > 0 ? margin : 0;
  return (
    point.x >= rect.left - m &&
    point.x <= rect.right + m &&
    point.y >= rect.top - m &&
    point.y <= rect.bottom + m
  );
}

/**
 * 左右の手の，画面の上の手のひらの中心（印を出す所）．見失った手・画面の外の手・写せない手は null
 */
export function handScreenPoints(
  hands: Readonly<Record<Handedness, HandState>>,
  view: HandScreenView,
  width: number,
  height: number,
): Record<Handedness, ScreenPoint | null> {
  const one = (hand: HandState): ScreenPoint | null => {
    if (!hand.tracked) return null;
    const p = handToScreen(hand.position, view, width, height);
    return p !== null && isOnScreen(p, width, height) ? p : null;
  };
  return { left: one(hands.left), right: one(hands.right) };
}

/** 左右どちらかの手の点（handScreenPoints の結果）が，ボタンの四角に入っているか */
export function isAnyPointInRect(
  points: Readonly<Record<Handedness, ScreenPoint | null>>,
  rect: ScreenRect,
  margin = 0,
): boolean {
  return (
    (points.left !== null && isPointInRect(points.left, rect, margin)) ||
    (points.right !== null && isPointInRect(points.right, rect, margin))
  );
}

/** ボタンの押した判定 1 つ分（app/ が scenes/common/handButtonPress.ts から作って渡す） */
export interface HomeHandPress {
  /** 1 フレーム進める（dt は秒．handOver はこのフレームで手がボタンに重なっているか）．押したら true */
  advance(dt: number, handOver: boolean): boolean;
  /** かざした時間の進み具合（0〜1） */
  readonly progress: number;
}

/** ホームの「スタート」を手で押すために app/ が渡すもの（無ければタッチだけで押す） */
export interface HomeHandStart {
  /** 手の位置を画面に写す時の見え方 */
  readonly view: HandScreenView;
  /** 手を認識できるか（カメラが使えない時は false．手の案内・印を出さず，タッチだけにする） */
  handsUsable(): boolean;
  /** 押した判定を作る（ホームの最初の表示に戻るたびに作り直す） */
  createPress(): HomeHandPress;
  /** 手の判定を止めるか（縦向きの案内が出ている間等） */
  isPaused?(): boolean;
  /**
   * 「スタート」をクリックで押せなくし，マウスの動きを下の 3D の画面（input/ の mock の手）へ通す．
   * PC の mock でマウスをかざして試すため（実機では false にし，タッチで押せるようにする）
   */
  readonly pointerThrough?: boolean;
}
