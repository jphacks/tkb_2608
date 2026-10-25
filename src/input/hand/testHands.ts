// hand/ のテスト用の材料（本番のコードからは import しない）．
// 既定値を持ち，一部だけ上書きできる作成関数にする（.claude/rules/testing.md「書き方」）．
// しきい値は DEFAULT_HAND_PARAMS（仮の値）に依存させず，仕様（experiment_山﨑/07・SPEC_01）の値を明示する
import type { Handedness } from "../../core/types";
import type { HandParams } from "./handParams";
import { HAND_LANDMARK_COUNT, type HandObservation, type Landmark } from "./types";

/** テストで使う手のしきい値（全項目を明示する） */
export const TEST_HAND_PARAMS: HandParams = {
  cameraHfovDeg: 65,
  palmLengthM: 0.095,
  minDepthM: 0.15,
  maxDepthM: 1.0,
  cameraOffsetXM: 0,
  cameraOffsetYM: 0,
  cameraOffsetZM: -0.08,
  skeletonDepthM: 1.2,
  skeletonDepthScale: 1.5,

  oneEuroMinCutoffHz: 1.0,
  oneEuroBeta: 1.5,
  oneEuroDCutoffHz: 1.0,
  extrapolateMaxMs: 80,
  extrapolateDecayMs: 60,
  extrapolateMaxSpeed: 3,

  trackAppearCount: 2,
  trackLostMs: 300,
  gripHoldMs: 800,
  skeletonHoldMs: 120,

  fingerOpenRatio: 1.6,
  fingerClosedRatio: 0.8,
  gripOn: 0.6,
  gripOff: 0.4,
  pinchOnRatio: 0.25,
  pinchOffRatio: 0.4,
  pointIndexMaxCurl: 0.35,
  pointOthersMinCurl: 0.55,
  pointConfirmCount: 2,

  recognizeWidthPx: 640,

  rateLevelsHz: [15, 10, 7],
  rateDownFps: 30,
  rateUpFps: 50,
  rateDownHoldMs: 1000,
  rateUpHoldMs: 5000,
};

export function testHandParams(o: Partial<HandParams> = {}): HandParams {
  return { ...TEST_HAND_PARAMS, ...o };
}

/** 認識した画像の大きさ（px．認識に渡す 320x240） */
export const IMG_W = 320;
export const IMG_H = 240;

export interface HandPoseOptions {
  /** 指の曲がり（0: 伸ばす，1: 手のひらに折りたたむ）．人差し指・中指・薬指・小指の順 */
  readonly curls: readonly [number, number, number, number];
  /** 親指の先を人差し指の先に付ける（つまむ） */
  readonly pinch: boolean;
  /** 中指の付け根の画像の上の位置（0〜1） */
  readonly cx: number;
  readonly cy: number;
  /** 手首から中指の付け根までの画像の上の長さ（画像の高さを 1 とした値） */
  readonly size: number;
  /** 画像の幅/高さ */
  readonly aspect: number;
  /** すべての点の z（MediaPipe の相対の奥行き） */
  readonly z: number;
}

const DEFAULT_POSE: HandPoseOptions = {
  curls: [0, 0, 0, 0],
  pinch: false,
  cx: 0.5,
  cy: 0.45,
  size: 0.2,
  aspect: IMG_W / IMG_H,
  z: 0,
};

/** 4 本の指の付け根（手の大きさを 1 とした縦横同じ縮尺．中指の付け根が原点，手首は真下に 1）と付け根の番号・指の先の番号 */
const FINGERS: readonly { mcp: [number, number]; base: number }[] = [
  { mcp: [-0.3, 0.05], base: 5 },
  { mcp: [0, 0], base: 9 },
  { mcp: [0.3, 0.05], base: 13 },
  { mcp: [0.55, 0.2], base: 17 },
];
/** 伸ばした指の先・折りたたんだ指の先（付け根から．手の大きさを 1 とした値） */
const TIP_OPEN: [number, number] = [0, -1.5];
const TIP_CLOSED: [number, number] = [0, 0.4];

/**
 * 画像の上の 21 点を作る（MediaPipe と同じ番号）．
 * 既定は開いた右手（指をそろえて上に伸ばし，親指は横に開く）を画像の中央より少し上にかざした形
 */
export function handLandmarks(o: Partial<HandPoseOptions> = {}): Landmark[] {
  const p = { ...DEFAULT_POSE, ...o };
  const pts: [number, number][] = new Array(HAND_LANDMARK_COUNT).fill([0, 0]);
  pts[0] = [0, 1];
  FINGERS.forEach((f, i) => {
    const c = p.curls[i];
    const tip: [number, number] = [
      f.mcp[0] + TIP_OPEN[0] + (TIP_CLOSED[0] - TIP_OPEN[0]) * c,
      f.mcp[1] + TIP_OPEN[1] + (TIP_CLOSED[1] - TIP_OPEN[1]) * c,
    ];
    pts[f.base] = f.mcp;
    for (let k = 1; k <= 3; k++) {
      const r = k / 3;
      pts[f.base + k] = [f.mcp[0] + (tip[0] - f.mcp[0]) * r, f.mcp[1] + (tip[1] - f.mcp[1]) * r];
    }
  });
  const thumbTip: [number, number] = p.pinch ? [pts[8][0] + 0.02, pts[8][1]] : [-1.0, 0.3];
  for (let k = 1; k <= 4; k++) {
    const r = k / 4;
    pts[k] = [pts[0][0] + (thumbTip[0] - pts[0][0]) * r, pts[0][1] + (thumbTip[1] - pts[0][1]) * r];
  }
  return pts.map(([x, y]) => ({
    x: p.cx + (x * p.size) / p.aspect,
    y: p.cy + y * p.size,
    z: p.z,
  }));
}

export const OPEN: HandPoseOptions["curls"] = [0, 0, 0, 0];
export const FIST: HandPoseOptions["curls"] = [1, 1, 1, 1];
export const POINT: HandPoseOptions["curls"] = [0, 1, 1, 1];

/** 認識した 1 つの手 */
export function observation(
  o: Partial<HandPoseOptions> & { label?: Handedness; score?: number } = {},
): HandObservation {
  const { label = "left", score = 0.9, ...pose } = o;
  return { label, score, landmarks: handLandmarks(pose) };
}

/** 種付きの乱数（0〜1）．mulberry32 */
export function seededRandom(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
