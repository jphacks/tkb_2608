// メッシュ作成と解放の共通処理

import * as THREE from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import type { Vec3Tuple } from "./furniture";

/**
 * 共有の単位立方体（1×1×1）を scale で拡大した Mesh を作る．
 * size は (x, y, z) の大きさ，position は親から見た中心の位置
 */
export function createBox(
  unitBox: THREE.BufferGeometry,
  material: THREE.Material,
  size: Vec3Tuple,
  position: Vec3Tuple,
  name = "",
): THREE.Mesh {
  const mesh = new THREE.Mesh(unitBox, material);
  mesh.scale.set(size[0], size[1], size[2]);
  mesh.position.set(position[0], position[1], position[2]);
  mesh.name = name;
  return mesh;
}

/** 配下のジオメトリ・マテリアル・テクスチャ（と InstancedMesh のバッファ）を重複なく解放する */
export function disposeObjectTree(root: THREE.Object3D): void {
  const geometries = new Set<THREE.BufferGeometry>();
  const materials = new Set<THREE.Material>();
  const instanced: THREE.InstancedMesh[] = [];
  root.traverse((object) => {
    if (object instanceof THREE.InstancedMesh) instanced.push(object);
    if (!(object instanceof THREE.Mesh)) return;
    geometries.add(object.geometry);
    const list: THREE.Material[] = Array.isArray(object.material)
      ? object.material
      : [object.material];
    for (const material of list) materials.add(material);
  });
  const textures = new Set<THREE.Texture>();
  for (const material of materials) {
    for (const value of Object.values(material)) {
      if (value instanceof THREE.Texture) textures.add(value);
    }
  }
  for (const geometry of geometries) geometry.dispose();
  for (const material of materials) material.dispose();
  for (const texture of textures) texture.dispose();
  // InstancedMesh はインスタンスごとの行列・色の GPU バッファを持つため別に解放する
  for (const mesh of instanced) mesh.dispose();
}

/** 直方体 1 つの置き方（大きさ・中心の位置・Y 軸回りの回転） */
export interface BoxPlacement {
  readonly size: Vec3Tuple;
  readonly position: Vec3Tuple;
  readonly rotationY?: number;
}

function placementMatrix(p: BoxPlacement): THREE.Matrix4 {
  return new THREE.Matrix4().compose(
    new THREE.Vector3(...p.position),
    new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), p.rotationY ?? 0),
    new THREE.Vector3(...p.size),
  );
}

/**
 * 同じ形・同じマテリアルの動かない部品を InstancedMesh 1 つ（描画 1 回）にまとめる．
 * geometry は単位の大きさ（1×1×1 の箱や 1×1 の板）とし，placement.size で拡大する．
 * colors を渡すとインスタンスごとに色を変える
 */
export function createInstancedParts(
  geometry: THREE.BufferGeometry,
  material: THREE.Material,
  placements: readonly BoxPlacement[],
  name: string,
  colors?: readonly THREE.ColorRepresentation[],
): THREE.InstancedMesh {
  const mesh = new THREE.InstancedMesh(geometry, material, placements.length);
  placements.forEach((p, i) => {
    mesh.setMatrixAt(i, placementMatrix(p));
    if (colors) mesh.setColorAt(i, new THREE.Color(colors[i % colors.length]));
  });
  mesh.instanceMatrix.needsUpdate = true;
  if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
  mesh.computeBoundingSphere();
  mesh.name = name;
  return mesh;
}

/**
 * 複数の直方体を 1 つのジオメトリにまとめる（同じマテリアルの部品を 1 Mesh にして描画数を減らす）．
 * 各直方体の UV は 0〜1 のまま残る
 */
export function mergeBoxes(placements: readonly BoxPlacement[]): THREE.BufferGeometry {
  const parts = placements.map((p) =>
    new THREE.BoxGeometry(1, 1, 1).applyMatrix4(placementMatrix(p)),
  );
  const merged = mergeGeometries(parts);
  for (const part of parts) part.dispose();
  return merged;
}
