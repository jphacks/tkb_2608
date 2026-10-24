// 校舎の動かない Mesh を，マテリアルごとに 1 つのジオメトリへ結合する（描画の回数をマテリアルの数程度に減らす）．
// パーツを並べ終えた後に 1 回だけ呼ぶ．パーツの Group（userData）は残すため，当たり判定はそのまま取り出せる

import * as THREE from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";

/** 結合の結果（確認用の表示や性能の目安に使う） */
export interface MergeStats {
  /** 結合した元の Mesh の数 */
  readonly mergedMeshes: number;
  /** 結合して作った Mesh の数 */
  readonly createdMeshes: number;
}

function hasDynamicAncestor(
  object: THREE.Object3D,
  root: THREE.Object3D,
  isDynamic: (object: THREE.Object3D) => boolean,
): boolean {
  for (let o: THREE.Object3D | null = object; o && o !== root; o = o.parent) {
    if (isDynamic(o)) return true;
  }
  return false;
}

/** 結合できる組み合わせか（属性の名前と index の有無がそろうものだけを 1 つにする） */
function geometrySignature(geometry: THREE.BufferGeometry): string {
  const names = Object.keys(geometry.attributes).sort().join(",");
  return `${names}|${geometry.index ? "indexed" : "flat"}`;
}

/**
 * root の配下の動かない Mesh（InstancedMesh と isDynamic の物とその子孫を除く）を，マテリアルと属性の
 * 組み合わせごとに 1 つの Mesh に結合して root の直下に置く．元の Mesh は外し，使われなくなったジオメトリは解放する．
 * root の配下の Object3D は以後動かさない前提（結合した形は今の位置で固定される）
 */
export function mergeStaticMeshes(
  root: THREE.Object3D,
  isDynamic: (object: THREE.Object3D) => boolean,
): MergeStats {
  root.updateMatrixWorld(true);
  const rootInverse = root.matrixWorld.clone().invert();
  const groups = new Map<string, { material: THREE.Material; meshes: THREE.Mesh[] }>();
  root.traverse((object) => {
    if (!(object instanceof THREE.Mesh) || object instanceof THREE.InstancedMesh) return;
    if (Array.isArray(object.material)) return;
    if (hasDynamicAncestor(object, root, isDynamic)) return;
    const material = object.material as THREE.Material;
    const key = `${material.uuid}|${geometrySignature(object.geometry)}`;
    const entry = groups.get(key) ?? { material, meshes: [] };
    entry.meshes.push(object);
    groups.set(key, entry);
  });

  const removedGeometries = new Set<THREE.BufferGeometry>();
  let mergedMeshes = 0;
  let createdMeshes = 0;
  const matrix = new THREE.Matrix4();
  for (const { material, meshes } of groups.values()) {
    if (meshes.length < 2) continue;
    const parts = meshes.map((mesh) => {
      matrix.multiplyMatrices(rootInverse, mesh.matrixWorld);
      return mesh.geometry.clone().applyMatrix4(matrix);
    });
    const merged = mergeGeometries(parts);
    for (const part of parts) part.dispose();
    if (!merged) continue;
    const mesh = new THREE.Mesh(merged, material);
    mesh.name = `merged-${material.name || material.type}-${createdMeshes}`;
    root.add(mesh);
    for (const original of meshes) {
      original.removeFromParent();
      removedGeometries.add(original.geometry);
    }
    mergedMeshes += meshes.length;
    createdMeshes += 1;
  }

  // 共有のジオメトリ（単位立方体等）がまだ使われていれば残す
  const used = new Set<THREE.BufferGeometry>();
  root.traverse((object) => {
    if (object instanceof THREE.Mesh) used.add(object.geometry);
  });
  for (const geometry of removedGeometries) if (!used.has(geometry)) geometry.dispose();
  return { mergedMeshes, createdMeshes };
}
