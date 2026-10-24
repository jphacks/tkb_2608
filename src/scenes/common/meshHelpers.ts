// メッシュ作成と解放の共通処理

import * as THREE from "three";
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

/** 配下のジオメトリ・マテリアル・テクスチャを重複なく解放する */
export function disposeObjectTree(root: THREE.Object3D): void {
  const geometries = new Set<THREE.BufferGeometry>();
  const materials = new Set<THREE.Material>();
  root.traverse((object) => {
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
}
