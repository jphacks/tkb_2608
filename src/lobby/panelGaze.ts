// 指示の板を正面に捉えているかと，枠の明るさの変化（DOM・three.js に依存しない純粋な関数）

import type { Quat, Vec3 } from "../core/types";
import { rotateVec } from "./orientation";

/** 板を正面に捉えているとみなす，視線と板の中心の方向の角度の差の上限（rad）．板の幅の半分ほど */
export const PANEL_GAZE_TOLERANCE_RAD = (15 * Math.PI) / 180;
/** 枠の明るさが目標に近づく速さ（1/秒） */
export const PANEL_HIGHLIGHT_RATE = 4;

/**
 * 頭の向き（head）の視線が，ヨー角 panelYaw（rad．正で左）だけ回した板の中心（center．目の位置からの m）の方向に向いているか
 */
export function isGazingAtPanel(
  head: Quat,
  panelYaw: number,
  center: Vec3,
  toleranceRad: number = PANEL_GAZE_TOLERANCE_RAD,
): boolean {
  if (!Number.isFinite(panelYaw)) return false;
  const half = panelYaw / 2;
  const target = rotateVec({ x: 0, y: Math.sin(half), z: 0, w: Math.cos(half) }, center);
  const len = Math.hypot(target.x, target.y, target.z);
  if (len === 0) return false;
  const f = rotateVec(head, { x: 0, y: 0, z: -1 });
  const cos = (f.x * target.x + f.y * target.y + f.z * target.z) / len;
  return cos >= Math.cos(toleranceRad);
}

/** 枠の明るさ（0〜1）を，注視していれば 1，していなければ 0 へ dt（秒）だけ近づける */
export function approachHighlight(
  current: number,
  gazing: boolean,
  dt: number,
  rate: number = PANEL_HIGHLIGHT_RATE,
): number {
  const base = Number.isFinite(current) ? Math.min(1, Math.max(0, current)) : 0;
  const step = Number.isFinite(dt) && dt > 0 ? Math.min(1, dt * rate) : 0;
  return base + ((gazing ? 1 : 0) - base) * step;
}
