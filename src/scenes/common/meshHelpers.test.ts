import * as THREE from "three";
import { describe, expect, it } from "vitest";
import { type BoxPlacement, createInstancedParts, mergeBoxes } from "./meshHelpers";

const PLACEMENTS: BoxPlacement[] = [
  { size: [1, 2, 3], position: [0, 1, 0] },
  { size: [0.5, 0.5, 0.5], position: [4, 0.25, -2], rotationY: Math.PI / 2 },
  { size: [2, 0.1, 0.2], position: [-3, 2, 1], rotationY: Math.PI / 4 },
];

describe("createInstancedParts", () => {
  const geometry = new THREE.BoxGeometry(1, 1, 1);
  const material = new THREE.MeshBasicMaterial();

  it("置き方の数だけインスタンスを持ち，名前が付く", () => {
    const mesh = createInstancedParts(geometry, material, PLACEMENTS, "parts");
    expect(mesh).toBeInstanceOf(THREE.InstancedMesh);
    expect(mesh.count).toBe(3);
    expect(mesh.name).toBe("parts");
    expect(mesh.geometry).toBe(geometry);
    expect(mesh.material).toBe(material);
  });

  it("各インスタンスの行列は位置・Y 軸回りの回転・大きさを表す", () => {
    const mesh = createInstancedParts(geometry, material, PLACEMENTS, "parts");
    PLACEMENTS.forEach((p, i) => {
      const m = new THREE.Matrix4();
      mesh.getMatrixAt(i, m);
      const pos = new THREE.Vector3();
      const quat = new THREE.Quaternion();
      const scale = new THREE.Vector3();
      m.decompose(pos, quat, scale);
      expect(pos.toArray()).toEqual(p.position.map((v) => expect.closeTo(v, 5)));
      expect(scale.toArray()).toEqual(p.size.map((v) => expect.closeTo(v, 5)));
      const euler = new THREE.Euler().setFromQuaternion(quat, "YXZ");
      expect(euler.y).toBeCloseTo(p.rotationY ?? 0);
      expect(euler.x).toBeCloseTo(0);
      expect(euler.z).toBeCloseTo(0);
    });
  });

  it("colors を渡すとインスタンスごとの色を持つ（足りなければくり返す）", () => {
    const mesh = createInstancedParts(
      geometry,
      material,
      PLACEMENTS,
      "parts",
      [0xff0000, 0x00ff00],
    );
    expect(mesh.instanceColor).not.toBeNull();
    const c = new THREE.Color();
    mesh.getColorAt(0, c);
    expect(c.getHex()).toBe(0xff0000);
    mesh.getColorAt(1, c);
    expect(c.getHex()).toBe(0x00ff00);
    mesh.getColorAt(2, c);
    expect(c.getHex()).toBe(0xff0000);
  });

  it("colors を渡さなければインスタンスの色を持たない", () => {
    const mesh = createInstancedParts(geometry, material, PLACEMENTS, "parts");
    expect(mesh.instanceColor).toBeNull();
  });

  it("境界球はすべてのインスタンスを含む", () => {
    const mesh = createInstancedParts(geometry, material, PLACEMENTS, "parts");
    expect(mesh.boundingSphere).not.toBeNull();
    const sphere = mesh.boundingSphere as THREE.Sphere;
    for (const p of PLACEMENTS) {
      expect(sphere.containsPoint(new THREE.Vector3(...p.position))).toBe(true);
    }
  });
});

describe("mergeBoxes", () => {
  it("直方体の数 × 24 頂点の 1 つのジオメトリになる", () => {
    const merged = mergeBoxes(PLACEMENTS);
    expect(merged.getAttribute("position").count).toBe(24 * PLACEMENTS.length);
    expect(merged.getAttribute("uv")).toBeDefined();
    expect(merged.getAttribute("normal")).toBeDefined();
  });

  it("各直方体は置き方どおりの位置・大きさ（回転なしの箱で確認）", () => {
    const merged = mergeBoxes([
      { size: [1, 2, 3], position: [0, 1, 0] },
      { size: [2, 2, 2], position: [5, 1, -4] },
    ]);
    merged.computeBoundingBox();
    const box = merged.boundingBox as THREE.Box3;
    expect(box.min.toArray()).toEqual([-0.5, 0, -5].map((v) => expect.closeTo(v, 9)));
    expect(box.max.toArray()).toEqual([6, 2, 1.5].map((v) => expect.closeTo(v, 9)));
  });

  it("Y 軸回りの回転を反映する", () => {
    const merged = mergeBoxes([{ size: [2, 1, 0.5], position: [0, 0, 0], rotationY: Math.PI / 2 }]);
    merged.computeBoundingBox();
    const box = merged.boundingBox as THREE.Box3;
    expect(box.max.x).toBeCloseTo(0.25);
    expect(box.max.z).toBeCloseTo(1);
  });
});
