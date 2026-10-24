// 壁の配置と分割の計算（three に依存しない純粋な関数）．
// 壁上の位置は「部屋の内側から見て u（左端からの距離），v（床からの高さ）」で表す

import type { Vec3Tuple } from "./furniture";

/** 壁 1 面の定義（内側から見た左下の端が origin） */
export interface WallDef {
  readonly id: string;
  /** 内側から見た左下の端（ワールド座標） */
  readonly origin: Vec3Tuple;
  /** u が増える向き（単位ベクトル） */
  readonly dir: Vec3Tuple;
  /** 部屋の内側を向く法線（単位ベクトル） */
  readonly normal: Vec3Tuple;
  /** +Z を向く板を内側へ向けるための Y 軸回りの回転（rad） */
  readonly rotationY: number;
  readonly length: number;
}

/** 壁上の矩形（u0 < u1，v0 < v1．m） */
export interface WallRect {
  readonly u0: number;
  readonly u1: number;
  readonly v0: number;
  readonly v1: number;
}

/**
 * 開口部（窓・ドア）を空けて壁を矩形に分割する．
 * 左右は全高，上下は開口部の幅だけの矩形になる．幅や高さが 0 の矩形は含めない
 */
export function splitWallAroundOpening(
  length: number,
  height: number,
  opening: WallRect,
): WallRect[] {
  const rects: WallRect[] = [
    { u0: 0, u1: opening.u0, v0: 0, v1: height },
    { u0: opening.u1, u1: length, v0: 0, v1: height },
    { u0: opening.u0, u1: opening.u1, v0: 0, v1: opening.v0 },
    { u0: opening.u0, u1: opening.u1, v0: opening.v1, v1: height },
  ];
  return rects.filter((r) => r.u1 - r.u0 > 0 && r.v1 - r.v0 > 0);
}

/**
 * 複数の開口部（窓・ドア）を空けて壁を矩形に分割する．開口部どうしは u の範囲が重ならない前提．
 * 開口部の間と両端は全高，各開口部の上下は開口部の幅だけの矩形になる（u の小さい順）．
 * 幅や高さが 0 の矩形は含めない
 */
export function splitWallAroundOpenings(
  length: number,
  height: number,
  openings: readonly WallRect[],
): WallRect[] {
  const sorted = [...openings].sort((a, b) => a.u0 - b.u0);
  const rects: WallRect[] = [];
  let cursor = 0;
  for (const o of sorted) {
    rects.push({ u0: cursor, u1: o.u0, v0: 0, v1: height });
    rects.push({ u0: o.u0, u1: o.u1, v0: 0, v1: o.v0 });
    rects.push({ u0: o.u0, u1: o.u1, v0: o.v1, v1: height });
    cursor = o.u1;
  }
  rects.push({ u0: cursor, u1: length, v0: 0, v1: height });
  return rects.filter((r) => r.u1 - r.u0 > 0 && r.v1 - r.v0 > 0);
}

/** ワールド座標の点 (x, z) を壁に沿う位置 u に変換する（壁の線上にない点は線へ射影した位置） */
export function wallUAt(wall: WallDef, x: number, z: number): number {
  return (x - wall.origin[0]) * wall.dir[0] + (z - wall.origin[2]) * wall.dir[2];
}

/** ワールド座標の中心 (x, z) と幅から，壁上の u の範囲を求める */
export function wallSpanAt(
  wall: WallDef,
  x: number,
  z: number,
  width: number,
): { u0: number; u1: number } {
  const center = wallUAt(wall, x, z);
  return { u0: center - width / 2, u1: center + width / 2 };
}

/** 壁上の点 (u, v) を，法線方向に offset だけ内側へずらしたワールド座標に変換する */
export function wallPointToWorld(wall: WallDef, u: number, v: number, offset = 0): Vec3Tuple {
  return [
    wall.origin[0] + wall.dir[0] * u + wall.normal[0] * offset,
    wall.origin[1] + v + wall.normal[1] * offset,
    wall.origin[2] + wall.dir[2] * u + wall.normal[2] * offset,
  ];
}

/** 壁上の矩形の中心のワールド座標 */
export function wallRectCenter(wall: WallDef, rect: WallRect, offset = 0): Vec3Tuple {
  return wallPointToWorld(wall, (rect.u0 + rect.u1) / 2, (rect.v0 + rect.v1) / 2, offset);
}

/**
 * 壁上の矩形のテクスチャ座標の範囲．壁上の位置（m）をタイル 1 枚の大きさで割るため，
 * 分割した壁どうしでも模様がつながる
 */
export function wallRectUv(rect: WallRect, tileSize: number): WallRect {
  return {
    u0: rect.u0 / tileSize,
    u1: rect.u1 / tileSize,
    v0: rect.v0 / tileSize,
    v1: rect.v1 / tileSize,
  };
}
