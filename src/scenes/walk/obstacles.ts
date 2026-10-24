// 壁・開口部・家具の定義から障害物を作る（three に依存しない純粋な関数）．
// 壁はどれも X か Z に沿う前提（部屋・電車・エレベーターの壁はすべてそうなっている）

import type { Footprint, FurnitureOrigin } from "../common/furniture";
import { type WallDef, type WallRect, wallPointToWorld } from "../common/wallLayout";
import type { Obstacle } from "./collision";

/**
 * 壁上の矩形（開口部を除いた壁の板・閉じたドアの開口部）を，壁の面から外側へ thickness の
 * 厚みを持つ障害物にする
 */
export function wallRectObstacle(
  wall: WallDef,
  rect: WallRect,
  thickness: number,
  id: string,
): Obstacle {
  const a = wallPointToWorld(wall, rect.u0, rect.v0, 0);
  const b = wallPointToWorld(wall, rect.u1, rect.v1, -thickness);
  return {
    id,
    minX: Math.min(a[0], b[0]),
    maxX: Math.max(a[0], b[0]),
    minY: Math.min(a[1], b[1]),
    maxY: Math.max(a[1], b[1]),
    minZ: Math.min(a[2], b[2]),
    maxZ: Math.max(a[2], b[2]),
  };
}

/** 壁 1 面の板（splitWallAroundOpening(s) で開口部を除いた矩形）を障害物にする．id は `${wall.id}-${i}` */
export function wallObstacles(
  wall: WallDef,
  rects: readonly WallRect[],
  thickness: number,
): Obstacle[] {
  return rects.map((rect, i) => wallRectObstacle(wall, rect, thickness, `${wall.id}-${i}`));
}

/** 壁 1 面の全体（開口部なし）の矩形 */
export function fullWallRect(wall: WallDef, height: number): WallRect {
  return { u0: 0, u1: wall.length, v0: 0, v1: height };
}

/**
 * 家具の高さの範囲．y は Group 原点の高さ，height は size.y．
 * 原点が底面（bottom）・天井取付点（top）・中心（center）のどれかで決まる
 */
export function furnitureVerticalRange(
  origin: FurnitureOrigin,
  y: number,
  height: number,
): { readonly minY: number; readonly maxY: number } {
  if (origin === "top") return { minY: y - height, maxY: y };
  if (origin === "center") return { minY: y - height / 2, maxY: y + height / 2 };
  return { minY: y, maxY: y + height };
}

/** 床占有範囲（回転後の外接 AABB）と高さの範囲から障害物を作る */
export function footprintObstacle(
  id: string,
  footprint: Footprint,
  minY: number,
  maxY: number,
): Obstacle {
  return {
    id,
    minX: footprint.centerX - footprint.halfX,
    maxX: footprint.centerX + footprint.halfX,
    minZ: footprint.centerZ - footprint.halfZ,
    maxZ: footprint.centerZ + footprint.halfZ,
    minY,
    maxY,
  };
}

/**
 * Group のローカル座標の点 (x, z) を，親から見た Group の位置・Y 軸回りの回転で親の座標に変換する
 * （three の Object3D と同じ回転の向き）
 */
export function localToParentXZ(
  position: { readonly x: number; readonly z: number },
  rotationY: number,
  local: { readonly x: number; readonly z: number },
): { readonly x: number; readonly z: number } {
  const c = Math.cos(rotationY);
  const s = Math.sin(rotationY);
  return {
    x: position.x + local.x * c + local.z * s,
    z: position.z - local.x * s + local.z * c,
  };
}
