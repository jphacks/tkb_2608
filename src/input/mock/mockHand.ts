// モック入力の手の純粋な部分（SPEC_01「モック入力」: マウスで手の位置，クリックで握る）．
// 画面の上のマウスの位置を，頭の座標系で目の前 depth m の所の右手の位置にする（マウスの下に手が見えるようにする）
import type { HandState } from "../../core/types";
import { mockHandLandmarks } from "./mockHandShape";

export interface MockHandState {
  /** マウスが画面（対象の要素）の上にあるか．外に出たら手を隠す */
  readonly visible: boolean;
  /** 画面の上の位置（-1〜1．右・上が正．NDC と同じ） */
  readonly ndcX: number;
  readonly ndcY: number;
  /** 画面の幅/高さ */
  readonly aspect: number;
  /** 目からの距離（m．ホイールで変える） */
  readonly depth: number;
  /** 握っているか（右ボタン・F キーを押している間） */
  readonly gripping: boolean;
}

export const INITIAL_MOCK_HAND: MockHandState = {
  visible: false,
  ndcX: 0,
  ndcY: -0.3,
  aspect: 16 / 9,
  depth: 0.45,
  gripping: false,
};

export interface MockHandOptions {
  /** 表示のカメラの縦の画角（度）．app/ と main.ts の PerspectiveCamera と同じ 70 */
  readonly vfovDeg: number;
  readonly minDepth: number;
  readonly maxDepth: number;
  /** ホイール 1 回分（deltaY 100）あたりの距離の変化（m） */
  readonly depthPerWheel: number;
}

export const DEFAULT_MOCK_HAND_OPTIONS: MockHandOptions = {
  vfovDeg: 70,
  minDepth: 0.2,
  maxDepth: 0.8,
  depthPerWheel: 0.05,
};

/**
 * マウスの位置（要素の中の px）を反映する．要素の大きさが分からない・値が有限でない時は変えない
 */
export function applyMockHandPointer(
  s: MockHandState,
  x: number,
  y: number,
  width: number,
  height: number,
): MockHandState {
  if (![x, y, width, height].every(Number.isFinite) || !(width > 0) || !(height > 0)) return s;
  const clamp = (v: number) => Math.max(-1, Math.min(1, v));
  return {
    ...s,
    visible: true,
    ndcX: clamp((x / width) * 2 - 1),
    ndcY: clamp(1 - (y / height) * 2),
    aspect: width / height,
  };
}

/** ホイールで距離を変える（下へ回すと手前，上へ回すと奥） */
export function applyMockHandWheel(
  s: MockHandState,
  deltaY: number,
  options: MockHandOptions = DEFAULT_MOCK_HAND_OPTIONS,
): MockHandState {
  if (!Number.isFinite(deltaY) || deltaY === 0) return s;
  const depth = s.depth - (deltaY / 100) * options.depthPerWheel;
  return { ...s, depth: Math.max(options.minDepth, Math.min(options.maxDepth, depth)) };
}

/**
 * 外に出す右手の状態．見えていない時は tracked: false（位置は直前のまま）．
 * 21 点は開いた手・握った手の決め打ちの形（mockHandShape.ts）を手のひらの位置に置く．
 * 判定点はマウスの位置（indexTip を省くので，ボタンは手のひらの中心で判定される）
 */
export function mockHandState(
  s: MockHandState,
  options: MockHandOptions = DEFAULT_MOCK_HAND_OPTIONS,
): HandState {
  const t = Math.tan((options.vfovDeg * Math.PI) / 360);
  const position = {
    x: s.ndcX * t * s.aspect * s.depth,
    y: s.ndcY * t * s.depth,
    z: -s.depth,
  };
  const grip = s.visible && s.gripping ? 1 : 0;
  const landmarks = mockHandLandmarks(position, grip);
  return landmarks === null
    ? { tracked: s.visible, position, grip }
    : { tracked: s.visible, position, grip, landmarks };
}
