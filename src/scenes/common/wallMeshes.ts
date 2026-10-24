// 壁の板と壁に沿う部品のメッシュ作成（壁上の位置 u・v で置く）

import * as THREE from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import { createBox } from "./meshHelpers";
import {
  type WallDef,
  type WallRect,
  wallPointToWorld,
  wallRectCenter,
  wallRectUv,
} from "./wallLayout";

/**
 * 壁上の位置で直方体を置く．size は（壁に沿う向き，高さ，壁の法線方向）の大きさ，
 * offset は壁面から内側への距離（中心まで）
 */
export function wallBox(
  unitBox: THREE.BufferGeometry,
  material: THREE.Material,
  wall: WallDef,
  u: number,
  v: number,
  offset: number,
  size: readonly [number, number, number],
  name = "",
): THREE.Mesh {
  const mesh = createBox(unitBox, material, size, wallPointToWorld(wall, u, v, offset), name);
  mesh.rotation.y = wall.rotationY;
  return mesh;
}

/** 壁上の矩形の大きさの板（原点が中心）．UV は壁上の位置をタイル 1 枚の大きさで割って求める */
function createWallPlane(rect: WallRect, tileSize: number): THREE.PlaneGeometry {
  const geometry = new THREE.PlaneGeometry(rect.u1 - rect.u0, rect.v1 - rect.v0);
  const uv = wallRectUv(rect, tileSize);
  const attr = geometry.getAttribute("uv");
  for (let i = 0; i < attr.count; i++) {
    attr.setXY(i, uv.u0 + attr.getX(i) * (uv.u1 - uv.u0), uv.v0 + attr.getY(i) * (uv.v1 - uv.v0));
  }
  return geometry;
}

/**
 * 壁の 1 片のジオメトリ（内側を向いた片面の板．ワールド座標に配置済み）．
 * UV は壁上の位置をタイル 1 枚の大きさで割って求め，分割しても模様がつながる
 */
export function createWallPieceGeometry(
  wall: WallDef,
  rect: WallRect,
  tileSize: number,
): THREE.PlaneGeometry {
  const geometry = createWallPlane(rect, tileSize);
  const [x, y, z] = wallRectCenter(wall, rect);
  geometry.applyMatrix4(
    new THREE.Matrix4().compose(
      new THREE.Vector3(x, y, z),
      new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), wall.rotationY),
      new THREE.Vector3(1, 1, 1),
    ),
  );
  return geometry;
}

/** 壁の 1 片の Mesh（1 片ずつ別の Mesh にする．部屋で使う） */
export function createWallPiece(
  wall: WallDef,
  rect: WallRect,
  material: THREE.Material,
  tileSize: number,
): THREE.Mesh {
  const geometry = createWallPlane(rect, tileSize);
  const mesh = new THREE.Mesh(geometry, material);
  const [x, y, z] = wallRectCenter(wall, rect);
  mesh.position.set(x, y, z);
  mesh.rotation.y = wall.rotationY;
  mesh.name = wall.id;
  return mesh;
}

/**
 * 複数の壁の片を 1 つの Mesh にまとめる（描画数を減らすため）．
 * 片が無ければ null
 */
export function createMergedWall(
  pieces: readonly (readonly [WallDef, readonly WallRect[]])[],
  material: THREE.Material,
  tileSize: number,
  name: string,
): THREE.Mesh | null {
  const geometries = pieces.flatMap(([wall, rects]) =>
    rects.map((rect) => createWallPieceGeometry(wall, rect, tileSize)),
  );
  if (geometries.length === 0) return null;
  const merged = mergeGeometries(geometries);
  for (const g of geometries) g.dispose();
  const mesh = new THREE.Mesh(merged, material);
  mesh.name = name;
  return mesh;
}
