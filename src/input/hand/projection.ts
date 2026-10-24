// 画像の上の 2D の座標を，頭の座標系の 3D の位置に直す純粋な関数（experiment_山﨑/07「2D の座標から 3D の位置へ」）．
// 頭の座標系: x が右，y が上，-z が視線の方向（m）．背面カメラは頭と一緒に動くため，頭の向きは使わない．
// 映像は左右反転していない（背面カメラ）・上下が正しい向き（ブラウザが画面の向きに合わせて回す）前提
import type { Vec3 } from "../../core/types";
import { type Landmark, LM } from "./types";

export interface CameraModel {
  /** 横の画角（度） */
  readonly hfovDeg: number;
  /** 画像の大きさ（px） */
  readonly width: number;
  readonly height: number;
  /** 目から見たカメラの位置（m．頭の座標系） */
  readonly offset: Vec3;
}

/** 焦点距離（px）．画角・大きさがおかしければ NaN */
export function focalLengthPx(cam: Pick<CameraModel, "hfovDeg" | "width">): number {
  const half = (cam.hfovDeg * Math.PI) / 360;
  if (!(half > 0) || !(half < Math.PI / 2) || !(cam.width > 0)) return Number.NaN;
  return cam.width / 2 / Math.tan(half);
}

/**
 * 手のひらの大きさ（手首から中指の付け根の長さ）から，カメラからの奥行き（m．視線の方向の距離）を見積もる．
 * 距離 ≒ 実際の長さ ÷ 画像上の長さ × 焦点距離．手が傾くと画像上で短く見えるため，MediaPipe の z（x と同じ縮尺）も含めた長さを使う．
 * 見積もれない時は NaN．結果は [minM, maxM] に収める
 */
export function estimateDepth(
  lm: readonly Landmark[],
  cam: Pick<CameraModel, "hfovDeg" | "width" | "height">,
  palmLengthM: number,
  minM: number,
  maxM: number,
): number {
  if (lm.length <= LM.MIDDLE_MCP) return Number.NaN;
  const a = lm[LM.WRIST];
  const b = lm[LM.MIDDLE_MCP];
  const lengthPx = Math.hypot(
    (a.x - b.x) * cam.width,
    (a.y - b.y) * cam.height,
    (a.z - b.z) * cam.width,
  );
  const f = focalLengthPx(cam);
  if (!(lengthPx > 1e-3) || !Number.isFinite(f) || !(palmLengthM > 0)) return Number.NaN;
  const d = (palmLengthM * f) / lengthPx;
  if (!Number.isFinite(d)) return Number.NaN;
  return Math.min(Math.max(d, minM), maxM);
}

/**
 * 画像の上の点（x・y は 0〜1）を，奥行き depthM（視線の方向の距離）の所の頭の座標系の位置にする．
 * 値がおかしい時は null
 */
export function imageToHead(p: Landmark, depthM: number, cam: CameraModel): Vec3 | null {
  const f = focalLengthPx(cam);
  if (!Number.isFinite(f) || !(depthM > 0) || !(cam.height > 0)) return null;
  if (!Number.isFinite(p.x) || !Number.isFinite(p.y)) return null;
  const rx = ((p.x - 0.5) * cam.width) / f;
  const ry = (-(p.y - 0.5) * cam.height) / f;
  return {
    x: rx * depthM + cam.offset.x,
    y: ry * depthM + cam.offset.y,
    z: -depthM + cam.offset.z,
  };
}

/** imageToHead の逆（頭の座標系の位置 → 画像の上の 0〜1 の点）．カメラの後ろ・値がおかしい時は null（dev ページの表示用） */
export function headToImage(p: Vec3, cam: CameraModel): { x: number; y: number } | null {
  const f = focalLengthPx(cam);
  const depth = -(p.z - cam.offset.z);
  if (!Number.isFinite(f) || !(depth > 0) || !(cam.width > 0) || !(cam.height > 0)) return null;
  const x = 0.5 + ((p.x - cam.offset.x) * f) / depth / cam.width;
  const y = 0.5 - ((p.y - cam.offset.y) * f) / depth / cam.height;
  return Number.isFinite(x) && Number.isFinite(y) ? { x, y } : null;
}
