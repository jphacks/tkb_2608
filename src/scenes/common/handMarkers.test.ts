import * as THREE from "three";
import { describe, expect, it, vi } from "vitest";
import { type HandState, type Quat, UNTRACKED_HAND } from "../../core/types";
import { createHandMarkers, HAND_MARKER_RADIUS } from "./handMarkers";

const FRONT: Quat = { x: 0, y: 0, z: 0, w: 1 };

function hand(overrides: Partial<HandState> = {}): HandState {
  return { tracked: true, position: { x: 0.1, y: -0.2, z: -0.45 }, grip: 0, ...overrides };
}

function hands(left: HandState = UNTRACKED_HAND, right: HandState = UNTRACKED_HAND) {
  return { left, right };
}

function meshes(object: THREE.Object3D): { left: THREE.Mesh; right: THREE.Mesh } {
  const left = object.getObjectByName("hand-left");
  const right = object.getObjectByName("hand-right");
  if (!(left instanceof THREE.Mesh) || !(right instanceof THREE.Mesh)) {
    throw new Error("手の印が見つからない");
  }
  return { left, right };
}

describe("createHandMarkers", () => {
  it("左右の球を 1 つずつ持ち，形と見た目を共有し，最初は隠れている", () => {
    const markers = createHandMarkers();
    const { left, right } = meshes(markers.object);
    expect(markers.object.name).toBe("hand-markers");
    expect(markers.object.children).toHaveLength(2);
    expect(left.geometry).toBe(right.geometry);
    expect(left.material).toBe(right.material);
    expect((left.geometry as THREE.SphereGeometry).parameters.radius).toBe(HAND_MARKER_RADIUS);
    expect(left.visible).toBe(false);
    expect(right.visible).toBe(false);
    markers.dispose();
  });

  it("正面を向いている時は手の位置（頭の座標系）にそのまま出す", () => {
    const markers = createHandMarkers();
    const { right } = meshes(markers.object);
    markers.update(FRONT, hands(UNTRACKED_HAND, hand()), true);
    expect(right.visible).toBe(true);
    expect(right.position.x).toBeCloseTo(0.1);
    expect(right.position.y).toBeCloseTo(-0.2);
    expect(right.position.z).toBeCloseTo(-0.45);
    markers.dispose();
  });

  it("頭の向きで rig の座標に直す（左へ 90° 向くと正面の手は -X に来る）", () => {
    const markers = createHandMarkers();
    const { left } = meshes(markers.object);
    const q = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.PI / 2);
    const head: Quat = { x: q.x, y: q.y, z: q.z, w: q.w };
    markers.update(head, hands(hand({ position: { x: 0, y: 0, z: -0.5 } })), true);
    expect(left.visible).toBe(true);
    expect(left.position.x).toBeCloseTo(-0.5);
    expect(left.position.y).toBeCloseTo(0);
    expect(left.position.z).toBeCloseTo(0);
    markers.dispose();
  });

  it("毎フレーム新しい手の位置に追従する", () => {
    const markers = createHandMarkers();
    const { right } = meshes(markers.object);
    markers.update(FRONT, hands(UNTRACKED_HAND, hand()), true);
    markers.update(
      FRONT,
      hands(UNTRACKED_HAND, hand({ position: { x: -0.3, y: 0.1, z: -0.6 } })),
      true,
    );
    expect(right.position.x).toBeCloseTo(-0.3);
    expect(right.position.y).toBeCloseTo(0.1);
    expect(right.position.z).toBeCloseTo(-0.6);
    markers.dispose();
  });

  it("tracked が false の手は隠し，認識し直すとまた出る", () => {
    const markers = createHandMarkers();
    const { left, right } = meshes(markers.object);
    markers.update(FRONT, hands(hand(), hand()), true);
    expect(left.visible).toBe(true);
    expect(right.visible).toBe(true);
    markers.update(FRONT, hands(hand(), hand({ tracked: false })), true);
    expect(left.visible).toBe(true);
    expect(right.visible).toBe(false);
    markers.update(FRONT, hands(hand(), hand()), true);
    expect(right.visible).toBe(true);
    markers.dispose();
  });

  it("visible が false の時は認識している手も隠す", () => {
    const markers = createHandMarkers();
    const { left, right } = meshes(markers.object);
    markers.update(FRONT, hands(hand(), hand()), false);
    expect(left.visible).toBe(false);
    expect(right.visible).toBe(false);
    markers.dispose();
  });

  it("dispose で共有の形と見た目を 1 回ずつ解放する", () => {
    const markers = createHandMarkers();
    const { left } = meshes(markers.object);
    const geometryDispose = vi.spyOn(left.geometry, "dispose");
    const material = left.material as THREE.Material;
    const materialDispose = vi.spyOn(material, "dispose");
    markers.dispose();
    expect(geometryDispose).toHaveBeenCalledTimes(1);
    expect(materialDispose).toHaveBeenCalledTimes(1);
  });
});
