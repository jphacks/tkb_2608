import * as THREE from "three";
import { describe, expect, it, vi } from "vitest";
import { type HandState, type Quat, UNTRACKED_HAND, type Vec3 } from "../../core/types";
import {
  createHandMarkers,
  HAND_BONES,
  HAND_COLORS,
  HAND_FADE_SEC,
  HAND_JOINT_COUNT,
  HAND_MARKER_RADIUS,
  HAND_SMOOTHING_SEC,
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
  it("左右それぞれ関節 21 個・骨 21 本・手のひらの球を持ち，形は共有し，見た目は左右で分けて色は同じ，最初は隠れている", () => {
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
    // 左右の振り分けが入れ替わっても色が変わらないよう，左右とも同じ青
    expect(HAND_COLORS.left).toBe(0x9cc8ff);
    expect(HAND_COLORS.right).toBe(0x9cc8ff);
    // 見失った時の濃さを片手ずつ変えるため半透明の扱い
    expect(lm.transparent).toBe(true);
    expect(rm.transparent).toBe(true);
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
    markers.dispose();
  });

  it("頭の向きで手のひらの球も rig の座標に直す", () => {
    const markers = createHandMarkers();
    const left = view(markers.object, "left");
    const q = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.PI / 2);
    const head: Quat = { x: q.x, y: q.y, z: q.z, w: q.w };
    markers.update(head, hands(hand({ position: { x: 0, y: 0, z: -0.5 } })), true);
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

/** 関節の見た目の濃さ */
function opacity(v: View): number {
  return (v.joints.material as THREE.MeshBasicMaterial).opacity;
}

/** 21 点をすべて p に置いた手 */
function handAtPoint(p: Vec3): HandState {
  return hand({ position: p, landmarks: Array.from({ length: HAND_JOINT_COUNT }, () => p) });
}

describe("createHandMarkers（補間とフェード）", () => {
  it("仕様の値: 寄せる時定数 0.05 秒・薄くして消すまで 0.15 秒", () => {
    expect(HAND_SMOOTHING_SEC).toBe(0.05);
    expect(HAND_FADE_SEC).toBe(0.15);
  });

  it("現れた直後（dt あり）は補間せず目標にそのまま置く", () => {
    const markers = createHandMarkers();
    const right = view(markers.object, "right");
    const p = { x: 0.2, y: -0.1, z: -1.2 };
    markers.update(FRONT, hands(UNTRACKED_HAND, handAtPoint(p)), true, 0.016);
    const j = jointInRig(markers, right, 5);
    expect(j.x).toBeCloseTo(0.2, 6);
    expect(j.y).toBeCloseTo(-0.1, 6);
    expect(j.z).toBeCloseTo(-1.2, 6);
    expect(opacity(right)).toBe(1);
    markers.dispose();
  });

  it.each([0.016, 0.05, 0.1])(
    "dt = %s 秒の時，21 点を目標へ k = 1 - exp(-dt / 0.05) だけ寄せる",
    (dt) => {
      const markers = createHandMarkers();
      const right = view(markers.object, "right");
      markers.update(FRONT, hands(UNTRACKED_HAND, handAtPoint({ x: 0, y: 0, z: -1 })), true, dt);
      markers.update(
        FRONT,
        hands(UNTRACKED_HAND, handAtPoint({ x: 0.1, y: 0.2, z: -1.3 })),
        true,
        dt,
      );
      const k = 1 - Math.exp(-dt / HAND_SMOOTHING_SEC);
      for (const i of [0, 8, 20]) {
        const j = jointInRig(markers, right, i);
        expect(j.x).toBeCloseTo(0.1 * k, 6);
        expect(j.y).toBeCloseTo(0.2 * k, 6);
        expect(j.z).toBeCloseTo(-1 - 0.3 * k, 6);
      }
      markers.dispose();
    },
  );

  it("dt = 0 なら動かさない", () => {
    const markers = createHandMarkers();
    const right = view(markers.object, "right");
    markers.update(FRONT, hands(UNTRACKED_HAND, handAtPoint({ x: 0, y: 0, z: -1 })), true, 0.016);
    markers.update(FRONT, hands(UNTRACKED_HAND, handAtPoint({ x: 0.5, y: 0, z: -1 })), true, 0);
    expect(jointInRig(markers, right, 0).x).toBeCloseTo(0, 6);
    markers.dispose();
  });

  it("同じ目標を描き続けると目標に近づいていく", () => {
    const markers = createHandMarkers();
    const right = view(markers.object, "right");
    markers.update(FRONT, hands(UNTRACKED_HAND, handAtPoint({ x: 0, y: 0, z: -1 })), true, 0.016);
    const target = handAtPoint({ x: 0.3, y: 0, z: -1 });
    let prev = 0;
    for (let i = 0; i < 30; i++) {
      markers.update(FRONT, hands(UNTRACKED_HAND, target), true, 0.016);
      const x = jointInRig(markers, right, 0).x;
      expect(x).toBeGreaterThan(prev);
      expect(x).toBeLessThanOrEqual(0.3 + 1e-12);
      prev = x;
    }
    expect(prev).toBeCloseTo(0.3, 3);
    markers.dispose();
  });

  it("dt を省くと補間せず即座に目標に置く", () => {
    const markers = createHandMarkers();
    const right = view(markers.object, "right");
    markers.update(FRONT, hands(UNTRACKED_HAND, handAtPoint({ x: 0, y: 0, z: -1 })), true, 0.016);
    markers.update(FRONT, hands(UNTRACKED_HAND, handAtPoint({ x: 0.4, y: 0, z: -1 })), true);
    expect(jointInRig(markers, right, 0).x).toBeCloseTo(0.4, 6);
    markers.dispose();
  });

  it("見失った（tracked が false）手は最後の形のまま dt / 0.15 ずつ薄くし，0 になったら隠す", () => {
    const markers = createHandMarkers();
    const right = view(markers.object, "right");
    const shown = handAtPoint({ x: 0.1, y: 0, z: -1 });
    markers.update(FRONT, hands(UNTRACKED_HAND, shown), true, 0.016);
    const lost = { ...handAtPoint({ x: 0.9, y: 0.9, z: -0.3 }), tracked: false };
    markers.update(FRONT, hands(UNTRACKED_HAND, lost), true, 0.05);
    expect(right.group.visible).toBe(true);
    expect(right.joints.visible).toBe(true);
    expect(right.palm.visible).toBe(false);
    expect(opacity(right)).toBeCloseTo(1 - 0.05 / HAND_FADE_SEC, 9);
    // 形は最後に描いた所のまま（見失った手の値には寄せない）
    expect(jointInRig(markers, right, 0).x).toBeCloseTo(0.1, 6);
    markers.update(FRONT, hands(UNTRACKED_HAND, lost), true, 0.05);
    expect(right.group.visible).toBe(true);
    expect(opacity(right)).toBeCloseTo(1 - 0.1 / HAND_FADE_SEC, 9);
    markers.update(FRONT, hands(UNTRACKED_HAND, lost), true, 0.06);
    expect(right.group.visible).toBe(false);
    markers.dispose();
  });

  it("薄くしている途中にまた現れたら濃さを 1 に戻し，補間を続ける", () => {
    const markers = createHandMarkers();
    const right = view(markers.object, "right");
    markers.update(FRONT, hands(UNTRACKED_HAND, handAtPoint({ x: 0, y: 0, z: -1 })), true, 0.016);
    markers.update(FRONT, hands(UNTRACKED_HAND, UNTRACKED_HAND), true, 0.05);
    markers.update(FRONT, hands(UNTRACKED_HAND, handAtPoint({ x: 0.2, y: 0, z: -1 })), true, 0.05);
    expect(opacity(right)).toBe(1);
    const k = 1 - Math.exp(-0.05 / HAND_SMOOTHING_SEC);
    expect(jointInRig(markers, right, 0).x).toBeCloseTo(0.2 * k, 6);
    markers.dispose();
  });

  it("消えきった後にまた現れた手は，前の形から滑らず目標にそのまま置く", () => {
    const markers = createHandMarkers();
    const right = view(markers.object, "right");
    markers.update(FRONT, hands(UNTRACKED_HAND, handAtPoint({ x: 0, y: 0, z: -1 })), true, 0.016);
    markers.update(FRONT, hands(UNTRACKED_HAND, UNTRACKED_HAND), true, 0.2);
    expect(right.group.visible).toBe(false);
    markers.update(FRONT, hands(UNTRACKED_HAND, handAtPoint({ x: 0.5, y: 0, z: -1 })), true, 0.016);
    expect(right.group.visible).toBe(true);
    expect(opacity(right)).toBe(1);
    expect(jointInRig(markers, right, 0).x).toBeCloseTo(0.5, 6);
    markers.dispose();
  });

  it("手のひらの位置が有限でなくなった手も見失ったとして薄くする", () => {
    const markers = createHandMarkers();
    const right = view(markers.object, "right");
    markers.update(FRONT, hands(UNTRACKED_HAND, handAtPoint({ x: 0, y: 0, z: -1 })), true, 0.016);
    const bad = { ...handAtPoint({ x: 0, y: 0, z: -1 }), position: { x: Number.NaN, y: 0, z: 0 } };
    markers.update(FRONT, hands(UNTRACKED_HAND, bad), true, 0.05);
    expect(right.group.visible).toBe(true);
    expect(opacity(right)).toBeLessThan(1);
    markers.dispose();
  });

  it("21 点を描いた手は，tracked のまま 21 点が無くなっても球にせず薄くする", () => {
    const markers = createHandMarkers();
    const right = view(markers.object, "right");
    markers.update(FRONT, hands(UNTRACKED_HAND, handAtPoint({ x: 0, y: 0, z: -1 })), true, 0.016);
    markers.update(FRONT, hands(UNTRACKED_HAND, hand()), true, 0.05);
    expect(right.group.visible).toBe(true);
    expect(right.palm.visible).toBe(false);
    expect(right.joints.visible).toBe(true);
    expect(opacity(right)).toBeCloseTo(1 - 0.05 / HAND_FADE_SEC, 9);
    markers.update(FRONT, hands(UNTRACKED_HAND, hand()), true, 0.2);
    expect(right.group.visible).toBe(false);
    // 消えた後も 21 点の無い手を球にしない
    markers.update(FRONT, hands(UNTRACKED_HAND, hand()), true, 0.016);
    expect(right.group.visible).toBe(false);
    markers.dispose();
  });

  it("21 点を描いた手は dt を省くと，21 点が無くなった時にすぐ隠す（球にしない）", () => {
    const markers = createHandMarkers();
    const right = view(markers.object, "right");
    markers.update(FRONT, hands(UNTRACKED_HAND, handWithShape()), true);
    markers.update(FRONT, hands(UNTRACKED_HAND, hand()), true);
    expect(right.group.visible).toBe(false);
    markers.dispose();
  });

  it("21 点を一度も受け取っていない手は，dt があっても手のひらの球を濃さ 1 で出す", () => {
    const markers = createHandMarkers();
    const right = view(markers.object, "right");
    markers.update(FRONT, hands(UNTRACKED_HAND, hand()), true, 0.016);
    expect(right.group.visible).toBe(true);
    expect(right.palm.visible).toBe(true);
    expect(right.joints.visible).toBe(false);
    expect(opacity(right)).toBe(1);
    markers.dispose();
  });

  it("球だけの手は見失ったら dt があってもすぐ隠す", () => {
    const markers = createHandMarkers();
    const right = view(markers.object, "right");
    markers.update(FRONT, hands(UNTRACKED_HAND, hand()), true, 0.016);
    markers.update(FRONT, hands(UNTRACKED_HAND, UNTRACKED_HAND), true, 0.016);
    expect(right.group.visible).toBe(false);
    markers.dispose();
  });

  it("dt を省くと見失った手はすぐ隠す", () => {
    const markers = createHandMarkers();
    const right = view(markers.object, "right");
    markers.update(FRONT, hands(UNTRACKED_HAND, handWithShape()), true, 0.016);
    markers.update(FRONT, hands(UNTRACKED_HAND, UNTRACKED_HAND), true);
    expect(right.group.visible).toBe(false);
    markers.dispose();
  });

  it("visible が false の時は dt があってもすぐ隠し，次に出す時は補間せず目標に置く", () => {
    const markers = createHandMarkers();
    const right = view(markers.object, "right");
    markers.update(FRONT, hands(UNTRACKED_HAND, handAtPoint({ x: 0, y: 0, z: -1 })), true, 0.016);
    markers.update(FRONT, hands(UNTRACKED_HAND, handAtPoint({ x: 0, y: 0, z: -1 })), false, 0.016);
    expect(right.group.visible).toBe(false);
    markers.update(FRONT, hands(UNTRACKED_HAND, handAtPoint({ x: 0.3, y: 0, z: -1 })), true, 0.016);
    expect(right.group.visible).toBe(true);
    expect(jointInRig(markers, right, 0).x).toBeCloseTo(0.3, 6);
    markers.dispose();
  });

  it("濃さは片手ずつ変える（片手が薄くなっても他の手は濃いまま）", () => {
    const markers = createHandMarkers();
    const left = view(markers.object, "left");
    const right = view(markers.object, "right");
    const h = handAtPoint({ x: 0, y: 0, z: -1 });
    markers.update(FRONT, hands(h, h), true, 0.016);
    markers.update(FRONT, hands(h, UNTRACKED_HAND), true, 0.05);
    expect(opacity(left)).toBe(1);
    expect(opacity(right)).toBeLessThan(1);
    markers.dispose();
  });
});
