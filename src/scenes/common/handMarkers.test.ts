import * as THREE from "three";
import { describe, expect, it, vi } from "vitest";
import { type HandState, type Quat, UNTRACKED_HAND, type Vec3 } from "../../core/types";
import {
  createHandMarkers,
  HAND_BONES,
  HAND_COLORS,
  HAND_JOINT_COUNT,
  HAND_MARKER_RADIUS,
  isDrawableLandmarks,
} from "./handMarkers";

const FRONT: Quat = { x: 0, y: 0, z: 0, w: 1 };

/** 手のひらの位置 p を中心に，点 i を (i·1cm, i·0.5cm, 0) ずらした 21 点 */
function landmarksAround(p: Vec3): Vec3[] {
  return Array.from({ length: HAND_JOINT_COUNT }, (_, i) => ({
    x: p.x + i * 0.01,
    y: p.y + i * 0.005,
    z: p.z,
  }));
}

function hand(overrides: Partial<HandState> = {}): HandState {
  return { tracked: true, position: { x: 0.1, y: -0.2, z: -0.45 }, grip: 0, ...overrides };
}

function handWithShape(position: Vec3 = { x: 0.1, y: -0.2, z: -0.45 }): HandState {
  return hand({ position, landmarks: landmarksAround(position) });
}

function hands(left: HandState = UNTRACKED_HAND, right: HandState = UNTRACKED_HAND) {
  return { left, right };
}

interface View {
  readonly group: THREE.Object3D;
  readonly joints: THREE.InstancedMesh;
  readonly bones: THREE.InstancedMesh;
  readonly palm: THREE.Mesh;
}

function view(object: THREE.Object3D, side: "left" | "right"): View {
  const group = object.getObjectByName(`hand-${side}`);
  const joints = object.getObjectByName(`hand-${side}-joints`);
  const bones = object.getObjectByName(`hand-${side}-bones`);
  const palm = object.getObjectByName(`hand-${side}-palm`);
  if (
    group === undefined ||
    !(joints instanceof THREE.InstancedMesh) ||
    !(bones instanceof THREE.InstancedMesh) ||
    !(palm instanceof THREE.Mesh)
  ) {
    throw new Error("手の形が見つからない");
  }
  return { group, joints, bones, palm };
}

/** 頭の向きを含めた rig の座標での，関節 i の位置 */
function jointInRig(markers: { object: THREE.Object3D }, v: View, i: number): THREE.Vector3 {
  markers.object.updateMatrixWorld(true);
  const m = new THREE.Matrix4();
  v.joints.getMatrixAt(i, m);
  return new THREE.Vector3().setFromMatrixPosition(m).applyMatrix4(v.joints.matrixWorld);
}

function boneLength(v: View, i: number): number {
  const m = new THREE.Matrix4();
  v.bones.getMatrixAt(i, m);
  // 円柱の高さ（y）の向きの列の長さ（decompose は大きさ 0 の行列で 1 を返すため使わない）
  const e = m.elements;
  return Math.hypot(e[4], e[5], e[6]);
}

describe("isDrawableLandmarks", () => {
  it("21 点すべてが有限なら描ける", () => {
    expect(isDrawableLandmarks(landmarksAround({ x: 0, y: 0, z: -0.4 }))).toBe(true);
  });

  it.each([
    ["無い", undefined],
    ["点が足りない", landmarksAround({ x: 0, y: 0, z: -0.4 }).slice(0, 20)],
    ["空", []],
  ])("%s時は描けない", (_, lm) => {
    expect(isDrawableLandmarks(lm)).toBe(false);
  });

  it.each([Number.NaN, Number.POSITIVE_INFINITY])("有限でない点（%s）がある時は描けない", (bad) => {
    const lm = landmarksAround({ x: 0, y: 0, z: -0.4 });
    lm[12] = { x: 0, y: bad, z: 0 };
    expect(isDrawableLandmarks(lm)).toBe(false);
  });
});

describe("createHandMarkers", () => {
  it("左右それぞれ関節 21 個・骨 21 本・手のひらの球を持ち，形は共有し，色は左右で分け，最初は隠れている", () => {
    const markers = createHandMarkers();
    const left = view(markers.object, "left");
    const right = view(markers.object, "right");
    expect(markers.object.name).toBe("hand-markers");
    expect(markers.object.children).toHaveLength(2);
    expect(left.joints.count).toBe(HAND_JOINT_COUNT);
    expect(left.bones.count).toBe(HAND_BONES.length);
    expect(HAND_BONES).toHaveLength(21);
    expect(left.joints.geometry).toBe(right.joints.geometry);
    expect(left.bones.geometry).toBe(right.bones.geometry);
    expect(left.palm.geometry).toBe(right.palm.geometry);
    expect((left.palm.geometry as THREE.SphereGeometry).parameters.radius).toBe(HAND_MARKER_RADIUS);
    const lm = left.joints.material as THREE.MeshBasicMaterial;
    const rm = right.joints.material as THREE.MeshBasicMaterial;
    expect(lm).not.toBe(rm);
    expect(lm.color.getHex()).toBe(HAND_COLORS.left);
    expect(rm.color.getHex()).toBe(HAND_COLORS.right);
    expect(HAND_COLORS.left).not.toBe(HAND_COLORS.right);
    expect(left.bones.material).toBe(lm);
    expect(left.palm.material).toBe(lm);
    expect(left.group.visible).toBe(false);
    expect(right.group.visible).toBe(false);
    markers.dispose();
  });

  it("骨は 21 点の番号の範囲でつなぐ", () => {
    for (const [a, b] of HAND_BONES) {
      expect(a).toBeGreaterThanOrEqual(0);
      expect(b).toBeLessThan(HAND_JOINT_COUNT);
      expect(a).not.toBe(b);
    }
  });

  it("21 点がある手は関節を 21 点の位置に置き，手のひらの球は隠す", () => {
    const markers = createHandMarkers();
    const right = view(markers.object, "right");
    const h = handWithShape();
    markers.update(FRONT, hands(UNTRACKED_HAND, h), true);
    expect(right.group.visible).toBe(true);
    expect(right.joints.visible).toBe(true);
    expect(right.bones.visible).toBe(true);
    expect(right.palm.visible).toBe(false);
    for (const i of [0, 8, 20]) {
      const p = jointInRig(markers, right, i);
      expect(p.x).toBeCloseTo(h.landmarks?.[i].x ?? Number.NaN);
      expect(p.y).toBeCloseTo(h.landmarks?.[i].y ?? Number.NaN);
      expect(p.z).toBeCloseTo(h.landmarks?.[i].z ?? Number.NaN);
    }
    markers.dispose();
  });

  it("骨の円柱の長さは両端の点の距離", () => {
    const markers = createHandMarkers();
    const right = view(markers.object, "right");
    const h = handWithShape();
    markers.update(FRONT, hands(UNTRACKED_HAND, h), true);
    // landmarksAround の点 i と j の距離は |i−j|·√(0.01² + 0.005²)
    const step = Math.hypot(0.01, 0.005);
    HAND_BONES.forEach(([a, b], i) => {
      expect(boneLength(right, i)).toBeCloseTo(Math.abs(a - b) * step, 6);
    });
    markers.dispose();
  });

  it("両端が重なった骨は長さ 0 にする（NaN にしない）", () => {
    const markers = createHandMarkers();
    const right = view(markers.object, "right");
    const position = { x: 0, y: 0, z: -0.4 };
    const lm = landmarksAround(position).map(() => position);
    markers.update(FRONT, hands(UNTRACKED_HAND, hand({ position, landmarks: lm })), true);
    expect(boneLength(right, 0)).toBe(0);
    const m = new THREE.Matrix4();
    right.bones.getMatrixAt(0, m);
    expect(m.elements.every(Number.isFinite)).toBe(true);
    markers.dispose();
  });

  it("21 点が無い手（古い入力・記録の再生）は手のひらの中心に球だけ出す", () => {
    const markers = createHandMarkers();
    const right = view(markers.object, "right");
    markers.update(FRONT, hands(UNTRACKED_HAND, hand()), true);
    expect(right.group.visible).toBe(true);
    expect(right.palm.visible).toBe(true);
    expect(right.joints.visible).toBe(false);
    expect(right.bones.visible).toBe(false);
    expect(right.palm.position.x).toBeCloseTo(0.1);
    expect(right.palm.position.y).toBeCloseTo(-0.2);
    expect(right.palm.position.z).toBeCloseTo(-0.45);
    markers.dispose();
  });

  it("頭の向きで rig の座標に直す（左へ 90° 向くと正面の手は -X に来る）", () => {
    const markers = createHandMarkers();
    const left = view(markers.object, "left");
    const q = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.PI / 2);
    const head: Quat = { x: q.x, y: q.y, z: q.z, w: q.w };
    const position = { x: 0, y: 0, z: -0.5 };
    markers.update(head, hands(hand({ position, landmarks: landmarksAround(position) })), true);
    const p = jointInRig(markers, left, 0);
    expect(p.x).toBeCloseTo(-0.5);
    expect(p.y).toBeCloseTo(0);
    expect(p.z).toBeCloseTo(0);
    markers.update(head, hands(hand({ position })), true);
    markers.object.updateMatrixWorld(true);
    const palm = left.palm.getWorldPosition(new THREE.Vector3());
    expect(palm.x).toBeCloseTo(-0.5);
    expect(palm.z).toBeCloseTo(0);
    markers.dispose();
  });

  it("毎フレーム新しい手の形に追従する", () => {
    const markers = createHandMarkers();
    const right = view(markers.object, "right");
    markers.update(FRONT, hands(UNTRACKED_HAND, handWithShape()), true);
    const next = { x: -0.3, y: 0.1, z: -0.6 };
    markers.update(FRONT, hands(UNTRACKED_HAND, handWithShape(next)), true);
    const p = jointInRig(markers, right, 0);
    expect(p.x).toBeCloseTo(-0.3);
    expect(p.y).toBeCloseTo(0.1);
    expect(p.z).toBeCloseTo(-0.6);
    markers.dispose();
  });

  it("片手だけ認識している時はその手だけ出し，tracked が false の手は隠し，認識し直すとまた出る", () => {
    const markers = createHandMarkers();
    const left = view(markers.object, "left");
    const right = view(markers.object, "right");
    markers.update(FRONT, hands(UNTRACKED_HAND, handWithShape()), true);
    expect(left.group.visible).toBe(false);
    expect(right.group.visible).toBe(true);
    markers.update(FRONT, hands(handWithShape(), handWithShape()), true);
    expect(left.group.visible).toBe(true);
    expect(right.group.visible).toBe(true);
    markers.update(FRONT, hands(handWithShape(), { ...handWithShape(), tracked: false }), true);
    expect(left.group.visible).toBe(true);
    expect(right.group.visible).toBe(false);
    markers.update(FRONT, hands(handWithShape(), handWithShape()), true);
    expect(right.group.visible).toBe(true);
    markers.dispose();
  });

  it("visible が false の時は認識している手も隠す", () => {
    const markers = createHandMarkers();
    markers.update(FRONT, hands(handWithShape(), handWithShape()), false);
    expect(view(markers.object, "left").group.visible).toBe(false);
    expect(view(markers.object, "right").group.visible).toBe(false);
    markers.dispose();
  });

  it("手のひらの位置が有限でない手は隠す", () => {
    const markers = createHandMarkers();
    markers.update(FRONT, hands(hand({ position: { x: Number.NaN, y: 0, z: 0 } })), true);
    expect(view(markers.object, "left").group.visible).toBe(false);
    markers.dispose();
  });

  it("dispose で共有の形と左右の見た目を 1 回ずつ解放する", () => {
    const markers = createHandMarkers();
    const left = view(markers.object, "left");
    const right = view(markers.object, "right");
    const spies = [
      left.joints.geometry,
      left.bones.geometry,
      left.palm.geometry,
      left.joints.material as THREE.Material,
      right.joints.material as THREE.Material,
    ].map((o) => vi.spyOn(o, "dispose"));
    markers.dispose();
    for (const s of spies) expect(s).toHaveBeenCalledTimes(1);
  });
});
