// 画像の上の 2D の座標を，頭の座標系の 3D の位置に直す純粋な関数（experiment_山﨑/07「2D の座標から 3D の位置へ」）．
// 頭の座標系: x が右，y が上，-z が視線の方向（m）．背面カメラは頭と一緒に動くため，頭の向きは使わない．
// 映像は左右反転していない（背面カメラ）・上下が正しい向き（ブラウザが画面の向きに合わせて回す）前提
import type { Vec3 } from "../../core/types";
import { type Landmark, LM } from "./types";

export interface CameraModel {
  /**
   * 画像の長い辺の向きの画角（度）．横向きの画面（ゴーグル）では横の画角．
   * 縦向きで映像が縦長（例: 480x640）になっても，ブラウザが回すだけで写る範囲は同じなので，長い辺に当てる
   */
  readonly hfovDeg: number;
  /** 画像の大きさ（px） */
  readonly width: number;
  readonly height: number;
  /** 目から見たカメラの位置（m．頭の座標系） */
  readonly offset: Vec3;
}

/**
 * 焦点距離（px）．画角 hfovDeg を画像の長い辺（width と height の大きい方．height を省くと width）に当てて求める．
 * 画角・大きさがおかしければ NaN
 */
export function focalLengthPx(
  cam: Pick<CameraModel, "hfovDeg" | "width"> & { readonly height?: number },
): number {
  const half = (cam.hfovDeg * Math.PI) / 360;
  if (!(half > 0) || !(half < Math.PI / 2) || !(cam.width > 0)) return Number.NaN;
  const h = cam.height;
  const longSide = h !== undefined && Number.isFinite(h) && h > cam.width ? h : cam.width;
  return longSide / 2 / Math.tan(half);
}

/** 届く範囲の倍率として使える値にする（有限の正の数でなければ 1．倍率を掛けない） */
export function sanitizeReachGain(gain: number): number {
  return Number.isFinite(gain) && gain > 0 ? gain : 1;
}

/**
 * 手全体を，画像の中心から離す向きに平行に動かす量（画像の上の 0〜1 の単位）．
 * 手のひらの中心 center の画像の中心からのずれを gain 倍にする分だけ動かす（手の形・大きさは変えない）．
 * 背面カメラの画角は表示の画角より狭く，そのままではカメラの端の手も視界の中ほどにしか出ないため，
 * 手の印が視界の端の近くまで届くように広げる（Issue #163）．gain が 1 なら動かさない
 */
export function reachShift(
  center: { readonly x: number; readonly y: number },
  gainX: number,
  gainY: number,
): { x: number; y: number } {
  return {
    x: (sanitizeReachGain(gainX) - 1) * (center.x - 0.5),
    y: (sanitizeReachGain(gainY) - 1) * (center.y - 0.5),
  };
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
