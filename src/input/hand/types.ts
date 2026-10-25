// 手の認識の結果を表す input/ の中だけの型（three.js・ブラウザ API に依存しない素のデータ）
import type { Handedness, Vec3 } from "../../core/types";

/** 手の 21 点の数 */
export const HAND_LANDMARK_COUNT = 21;

/** 21 点の番号（MediaPipe の HandLandmarker と同じ） */
export const LM = {
  WRIST: 0,
  THUMB_TIP: 4,
  INDEX_MCP: 5,
  INDEX_PIP: 6,
  INDEX_TIP: 8,
  MIDDLE_MCP: 9,
  MIDDLE_TIP: 12,
  RING_MCP: 13,
  RING_TIP: 16,
  PINKY_MCP: 17,
  PINKY_TIP: 20,
} as const;

/** 21 点をつなぐ線（dev ページの表示用．MediaPipe の HAND_CONNECTIONS と同じ） */
export const HAND_CONNECTIONS: readonly (readonly [number, number])[] = [
  [0, 1],
  [1, 2],
  [2, 3],
  [3, 4],
  [0, 5],
  [5, 6],
  [6, 7],
  [7, 8],
  [5, 9],
  [9, 10],
  [10, 11],
  [11, 12],
  [9, 13],
  [13, 14],
  [14, 15],
  [15, 16],
  [13, 17],
  [0, 17],
  [17, 18],
  [18, 19],
  [19, 20],
];

/**
 * 画像の上の 1 点．x・y は 0〜1（左上が原点．x は右，y は下が正）．
 * z は手首を基準にした相対の奥行き（MediaPipe の値．x とおおよそ同じ縮尺で，カメラに近いほど小さい）
 */
export interface Landmark {
  readonly x: number;
  readonly y: number;
  readonly z: number;
}

/** 認識した 1 つの手（画像の上の 21 点） */
export interface HandObservation {
  /** MediaPipe が付けた左右（自撮り＝左右反転した画像を前提にした値．handedness.ts で直す） */
  readonly label: Handedness;
  /** 左右の確からしさ（0〜1） */
  readonly score: number;
  /** 21 点 */
  readonly landmarks: readonly Landmark[];
}

/** 1 回の認識の結果 */
export interface HandFrameResult {
  /** 認識した映像を受け取った時刻（performance.now() の ms） */
  readonly t: number;
  /** 結果が届いた時刻（performance.now() の ms） */
  readonly doneAt: number;
  /** 認識そのものにかかった時間（ms） */
  readonly inferMs: number;
  /** 認識した画像の大きさ（px） */
  readonly width: number;
  readonly height: number;
  readonly hands: readonly HandObservation[];
}

/** 頭の座標系の手の形と位置（PlayerInput に載せない項目も含む．Issue #64 で HandState に足すかを決める） */
export interface HandReading {
  readonly tracked: boolean;
  /** 手のひらの中心（頭の座標系．m） */
  readonly position: Vec3;
  /** 人差し指の先（頭の座標系．m） */
  readonly indexTip: Vec3;
  /**
   * 描く用の 21 点（頭の座標系．m．番号は LM と同じ）．固定の奥行き（HandParams の skeletonDepthM）に置いた最後の認識の値で，
   * フィルタ・外挿はしない（position・indexTip とは奥行きが違う）．まだ一度も認識していなければ null
   */
  readonly landmarks: readonly Vec3[] | null;
  /** 握り具合（0〜1．握った状態の間は gripOn 以上，開いた状態の間は gripOff 以下） */
  readonly grip: number;
  /** つまむ具合（0〜1） */
  readonly pinch: number;
  /** つまんでいるか（ヒステリシス付き） */
  readonly pinching: boolean;
  /** 指を差しているか（続けて確かめた後の値） */
  readonly pointing: boolean;
  /** 最後に認識できた映像の時刻から今までの時間（ms）．認識していなければ Infinity */
  readonly ageMs: number;
}
