// 動かない Mesh の結合（schoolMerge.ts）のテスト．基準は引継ぎメモ: 開閉で動く物（DYNAMIC_KINDS．
// 扉・シャッターの幕・座板）は userData の kind で結合から外す．パーツの Group（userData）は残す

import * as THREE from "three";
import { afterAll, describe, expect, it } from "vitest";
import { mergeStaticMeshes } from "./schoolMerge";

const unit = new THREE.BoxGeometry(1, 1, 1);
const red = new THREE.MeshBasicMaterial({ name: "red" });
const blue = new THREE.MeshBasicMaterial({ name: "blue" });

afterAll(() => {
  unit.dispose();
  red.dispose();
  blue.dispose();
});

function box(material: THREE.Material, x: number, name: string, geometry = unit): THREE.Mesh {
  const mesh = new THREE.Mesh(geometry, material);
  mesh.position.set(x, 0, 0);
  mesh.name = name;
  return mesh;
}

const isDynamic = (o: THREE.Object3D) => (o.userData as { kind?: string }).kind === "moving";

function meshes(root: THREE.Object3D): THREE.Mesh[] {
  const list: THREE.Mesh[] = [];
  root.traverse((o) => {
    if (o instanceof THREE.Mesh) list.push(o);
  });
  return list;
}

describe("mergeStaticMeshes", () => {
  it("同じマテリアルの動かない Mesh を 1 つにまとめて root の直下に置き，元の Mesh は外す", () => {
    const root = new THREE.Group();
    const part = new THREE.Group();
    part.userData = { kind: "schoolEdge", id: "e" };
    part.add(box(red, 0, "a"), box(red, 2, "b"), box(blue, 4, "c"), box(blue, 6, "d"));
    root.add(part);
    const stats = mergeStaticMeshes(root, isDynamic);
    expect(stats).toEqual({ mergedMeshes: 4, createdMeshes: 2 });
    expect(part.children).toEqual([]);
    expect(part.parent).toBe(root);
    expect(part.userData).toEqual({ kind: "schoolEdge", id: "e" });
    const merged = meshes(root);
    expect(merged).toHaveLength(2);
    expect(merged.every((m) => m.parent === root)).toBe(true);
    expect(merged.map((m) => m.material).sort()).toEqual([red, blue].sort());
    for (const m of merged) m.geometry.dispose();
  });

  it("結合した形は元の位置（root の座標）のまま", () => {
    const root = new THREE.Group();
    root.position.set(100, 0, 0);
    const part = new THREE.Group();
    part.position.set(10, 0, 0);
    part.add(box(red, 0, "a"), box(red, 2, "b"));
    root.add(part);
    mergeStaticMeshes(root, isDynamic);
    const [merged] = meshes(root);
    if (!merged) throw new Error("結合されていない");
    merged.geometry.computeBoundingBox();
    const bb = merged.geometry.boundingBox;
    expect(bb?.min.x).toBeCloseTo(9.5);
    expect(bb?.max.x).toBeCloseTo(12.5);
    merged.geometry.dispose();
  });

  it("動く物とその子孫の Mesh は結合せず，元の親の下に残す", () => {
    const root = new THREE.Group();
    const door = new THREE.Group();
    const leaf = new THREE.Group();
    leaf.userData = { kind: "moving" };
    const leafBody = box(red, 0, "leaf-body");
    const nested = new THREE.Group();
    const leafKnob = box(red, 0.1, "leaf-knob");
    nested.add(leafKnob);
    leaf.add(leafBody, nested);
    door.add(box(red, 1, "wall-a"), box(red, 3, "wall-b"), leaf);
    root.add(door);
    const stats = mergeStaticMeshes(root, isDynamic);
    expect(stats.mergedMeshes).toBe(2);
    expect(leafBody.parent).toBe(leaf);
    expect(leafKnob.parent).toBe(nested);
    expect(leaf.parent).toBe(door);
    for (const m of meshes(root)) if (m.parent === root) m.geometry.dispose();
  });

  it("InstancedMesh と，マテリアルが 1 つしか使われない Mesh はそのまま残す", () => {
    const root = new THREE.Group();
    const instanced = new THREE.InstancedMesh(unit, red, 3);
    const single = box(blue, 0, "single");
    root.add(instanced, single, box(red, 5, "r1"));
    const stats = mergeStaticMeshes(root, isDynamic);
    expect(stats).toEqual({ mergedMeshes: 0, createdMeshes: 0 });
    expect(instanced.parent).toBe(root);
    expect(single.parent).toBe(root);
    instanced.dispose();
  });

  it("まだ使われている共有のジオメトリは解放せず，使われなくなったジオメトリは解放する", () => {
    const root = new THREE.Group();
    const shared = new THREE.BoxGeometry(1, 1, 1);
    const own = new THREE.BoxGeometry(1, 1, 1);
    let sharedDisposed = false;
    let ownDisposed = false;
    shared.addEventListener("dispose", () => {
      sharedDisposed = true;
    });
    own.addEventListener("dispose", () => {
      ownDisposed = true;
    });
    const moving = new THREE.Group();
    moving.userData = { kind: "moving" };
    moving.add(box(red, 0, "keep", shared));
    root.add(box(red, 1, "m1", shared), box(red, 2, "m2", own), moving);
    mergeStaticMeshes(root, isDynamic);
    expect(sharedDisposed).toBe(false);
    expect(ownDisposed).toBe(true);
    shared.dispose();
    for (const m of meshes(root)) if (m.parent === root) m.geometry.dispose();
  });
});
