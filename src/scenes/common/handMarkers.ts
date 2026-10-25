// 認識した手（PlayerInput.hands）の形を描く共通部品（関節の球と骨の円柱．Issue #160）．プレイヤーの体（rig）に足して使う．
// 校舎の空間（main.ts のビューア）が直接使い，ロビー（lobby/）には app/ が作る関数を渡す（画面を持つモジュール同士は import しないため）

import * as THREE from "three";
import type { Handedness, HandState, Quat, Vec3 } from "../../core/types";

/** 手の印．object を rig に足し，毎フレーム update で動かす */
export interface HandMarkers {
  /** rig に足す（目の位置が原点．手の位置を rig の座標にして置く） */
  readonly object: THREE.Object3D;
  /**
   * 認識している手の形（21 点）を描く．hands の位置は頭の座標系なので，頭の向き head で rig の座標に直す．
   * 21 点が無い手（古い入力・記録の再生等）は手のひらの中心に球だけ出す．
   * tracked が false の手と，visible が false の時は隠す
   */
  update(head: Quat, hands: Readonly<Record<Handedness, HandState>>, visible: boolean): void;
  /** 形と見た目を解放する（rig から外すのは足した側が行う） */
  dispose(): void;
}

/** 21 点が無い時に手のひらの中心に出す球の半径（m） */
export const HAND_MARKER_RADIUS = 0.022;
/** 関節の球の半径（m） */
export const HAND_JOINT_RADIUS = 0.008;
/** 骨の円柱の半径（m） */
export const HAND_BONE_RADIUS = 0.005;
/** 手の 21 点の数（MediaPipe の HandLandmarker と同じ） */
export const HAND_JOINT_COUNT = 21;

/**
 * 21 点をつなぐ骨（MediaPipe の HAND_CONNECTIONS と同じ．input/hand/types.ts と同じ並び）．
 * scenes/ は input/ を import しないため写しを持つ
 */
export const HAND_BONES: readonly (readonly [number, number])[] = [
  [0, 1],
  [1, 2],
  [2, 3],
  [3, 4],
  [0, 5],
  [5, 6],
  [6, 7],
  [7, 8],
  [5, 9],
  [9, 10],
  [10, 11],
  [11, 12],
  [9, 13],
  [13, 14],
  [14, 15],
  [15, 16],
  [13, 17],
  [0, 17],
  [17, 18],
  [18, 19],
  [19, 20],
];

/** 左右の色（取り違えに気付きやすいよう変える．右は今までの手の印と同じ青，左は緑） */
export const HAND_COLORS: Readonly<Record<Handedness, number>> = {
  left: 0x9cf0b0,
  right: 0x9cc8ff,
};

/** 毎フレーム new しないための作業用の値 */
const work = {
  quat: new THREE.Quaternion(),
  a: new THREE.Vector3(),
  b: new THREE.Vector3(),
  dir: new THREE.Vector3(),
  scale: new THREE.Vector3(),
  matrix: new THREE.Matrix4(),
};
const UP = new THREE.Vector3(0, 1, 0);
const IDENTITY_QUAT = new THREE.Quaternion();

function isFiniteVec3(p: Vec3 | undefined): p is Vec3 {
  return p !== undefined && Number.isFinite(p.x) && Number.isFinite(p.y) && Number.isFinite(p.z);
}

/** 描ける 21 点か（数が足りない・有限でない点がある時は形を描かず球に落とす） */
export function isDrawableLandmarks(
  landmarks: readonly Vec3[] | undefined,
): landmarks is readonly Vec3[] {
  if (landmarks === undefined || landmarks.length < HAND_JOINT_COUNT) return false;
  for (let i = 0; i < HAND_JOINT_COUNT; i++) if (!isFiniteVec3(landmarks[i])) return false;
  return true;
}

interface HandView {
  /** 頭の向きで回す入れ物（中身は頭の座標系の位置に置く） */
  readonly group: THREE.Group;
  readonly joints: THREE.InstancedMesh;
  readonly bones: THREE.InstancedMesh;
  readonly palm: THREE.Mesh;
}

interface Shared {
  readonly jointGeometry: THREE.SphereGeometry;
  readonly boneGeometry: THREE.CylinderGeometry;
  readonly palmGeometry: THREE.SphereGeometry;
}

function createHandView(side: Handedness, shared: Shared, material: THREE.Material): HandView {
  const group = new THREE.Group();
  group.name = `hand-${side}`;
  group.visible = false;
  const joints = new THREE.InstancedMesh(shared.jointGeometry, material, HAND_JOINT_COUNT);
  const bones = new THREE.InstancedMesh(shared.boneGeometry, material, HAND_BONES.length);
  const palm = new THREE.Mesh(shared.palmGeometry, material);
  joints.name = `hand-${side}-joints`;
  bones.name = `hand-${side}-bones`;
  palm.name = `hand-${side}-palm`;
  // 位置は毎フレーム instanceMatrix で動かすため，形の原点での範囲で見切れないよう視野外の省略を切る
  joints.frustumCulled = false;
  bones.frustumCulled = false;
  joints.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  bones.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  group.add(joints, bones, palm);
  return { group, joints, bones, palm };
}

/** 21 点の位置に関節の球を，骨の両端の間に円柱（高さ 1 の円柱を伸ばして向ける）を置く */
function placeSkeleton(view: HandView, landmarks: readonly Vec3[]): void {
  for (let i = 0; i < HAND_JOINT_COUNT; i++) {
    const p = landmarks[i];
    work.matrix.makeTranslation(p.x, p.y, p.z);
    view.joints.setMatrixAt(i, work.matrix);
  }
  for (let i = 0; i < HAND_BONES.length; i++) {
    const [from, to] = HAND_BONES[i];
    const a = work.a.set(landmarks[from].x, landmarks[from].y, landmarks[from].z);
    const b = work.b.set(landmarks[to].x, landmarks[to].y, landmarks[to].z);
    const length = work.dir.subVectors(b, a).length();
    if (length > 1e-6) {
      work.quat.setFromUnitVectors(UP, work.dir.divideScalar(length));
      work.scale.set(1, length, 1);
    } else {
      work.quat.identity();
      work.scale.set(1, 0, 1);
    }
    work.matrix.compose(a.add(b).multiplyScalar(0.5), work.quat, work.scale);
    view.bones.setMatrixAt(i, work.matrix);
  }
  view.joints.instanceMatrix.needsUpdate = true;
  view.bones.instanceMatrix.needsUpdate = true;
}

function placeHand(view: HandView, head: Quat, hand: HandState, visible: boolean): void {
  view.group.visible = visible && hand.tracked && isFiniteVec3(hand.position);
  if (!view.group.visible) return;
  view.group.quaternion.set(head.x, head.y, head.z, head.w);
  const skeleton = isDrawableLandmarks(hand.landmarks);
  view.joints.visible = skeleton;
  view.bones.visible = skeleton;
  view.palm.visible = !skeleton;
  if (skeleton && hand.landmarks !== undefined) {
    placeSkeleton(view, hand.landmarks);
  } else {
    view.palm.position.set(hand.position.x, hand.position.y, hand.position.z);
  }
}

/**
 * 左右の手の形（関節の球 21 個と骨の円柱 21 本を InstancedMesh で 1 つずつ）を作る．
 * 形は左右で共有し，見た目（色）は左右で分ける
 */
export function createHandMarkers(): HandMarkers {
  const root = new THREE.Group();
  root.name = "hand-markers";
  const shared: Shared = {
    jointGeometry: new THREE.SphereGeometry(HAND_JOINT_RADIUS, 8, 6),
    // 高さ 1 の円柱（y の向き）を骨の長さに伸ばす．蓋は見えないので付けない
    boneGeometry: new THREE.CylinderGeometry(HAND_BONE_RADIUS, HAND_BONE_RADIUS, 1, 6, 1, true),
    palmGeometry: new THREE.SphereGeometry(HAND_MARKER_RADIUS, 12, 8),
  };
  const materials: Record<Handedness, THREE.MeshBasicMaterial> = {
    left: new THREE.MeshBasicMaterial({ color: HAND_COLORS.left }),
    right: new THREE.MeshBasicMaterial({ color: HAND_COLORS.right }),
  };
  const views: Record<Handedness, HandView> = {
    left: createHandView("left", shared, materials.left),
    right: createHandView("right", shared, materials.right),
  };
  // 最初の描画で原点に集まって見えないよう，置く前の instanceMatrix は大きさ 0 にしておく
  work.matrix.compose(work.a.set(0, 0, 0), IDENTITY_QUAT, work.scale.set(0, 0, 0));
  for (const v of [views.left, views.right]) {
    for (let i = 0; i < HAND_JOINT_COUNT; i++) v.joints.setMatrixAt(i, work.matrix);
    for (let i = 0; i < HAND_BONES.length; i++) v.bones.setMatrixAt(i, work.matrix);
  }
  root.add(views.left.group, views.right.group);

  return {
    object: root,
    update(head, hands, visible) {
      placeHand(views.left, head, hands.left, visible);
      placeHand(views.right, head, hands.right, visible);
    },
    dispose() {
      for (const v of [views.left, views.right]) {
        v.joints.dispose();
        v.bones.dispose();
      }
      shared.jointGeometry.dispose();
      shared.boneGeometry.dispose();
      shared.palmGeometry.dispose();
      materials.left.dispose();
      materials.right.dispose();
    },
  };
}
