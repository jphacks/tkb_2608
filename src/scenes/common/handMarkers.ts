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
   * tracked が false の手と，visible が false の時は隠す．
   * dt（前のフレームからの秒数）を渡すと，21 点を目標へ指数的に寄せ（時定数 HAND_SMOOTHING_SEC），
   * 見失った手の形は HAND_FADE_SEC で薄くして消す．省くと寄せずに目標に置き，見失ったらすぐ隠す．
   * 一度 21 点を描いた手は，tracked のまま 21 点が無くなっても球にせず，同じように薄くして消す
   */
  update(
    head: Quat,
    hands: Readonly<Record<Handedness, HandState>>,
    visible: boolean,
    dt?: number,
  ): void;
  /** 形と見た目を解放する（rig から外すのは足した側が行う） */
  dispose(): void;
}

/** 21 点が無い時に手のひらの中心に出す球の半径（m） */
export const HAND_MARKER_RADIUS = 0.022;
/** 関節の球の半径（m） */
export const HAND_JOINT_RADIUS = 0.008;
/** 骨の円柱の半径（m） */
export const HAND_BONE_RADIUS = 0.005;
/** 人差し指の先の印（highlightIndexTip）の球の半径（m）．関節の球より大きくして指先を見つけやすくする */
export const INDEX_TIP_MARKER_RADIUS = 0.02;
/** 人差し指の先の印の色．手の青・ロビーの開始ボタンの橙・部屋の灰色のどれとも見分けやすいピンク */
export const INDEX_TIP_COLOR = 0xff4fd8;
/** 人差し指の先の番号（MediaPipe の HandLandmarker と同じ） */
export const INDEX_TIP_INDEX = 8;
/** 21 点を目標へ寄せる時定数（秒）．描くフレームごとに k = 1 - exp(-dt / これ) だけ寄せる */
export const HAND_SMOOTHING_SEC = 0.05;
/** 見失った手の形を薄くして消すまでの秒数 */
export const HAND_FADE_SEC = 0.15;
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

/**
 * 左右の色．左右の振り分けが入れ替わった時に色が変わって気になるため，左右とも今までの手の印と同じ青にする
 * （見失った時の濃さは片手ずつ変えるため，見た目は左右で分けて持つ）
 */
export const HAND_COLORS: Readonly<Record<Handedness, number>> = {
  left: 0x9cc8ff,
  right: 0x9cc8ff,
};

/** createHandMarkers の設定 */
export interface HandMarkersOptions {
  /**
   * 人差し指の先に目立つ色の球を出すか（手で押すボタンがある画面用．既定は false）．
   * 手の形は固定の奥行き（約 1.2 m）に描くため，手前のボタンに指先が隠れないよう深度を無視して最前面に描く
   */
  readonly highlightIndexTip?: boolean;
}

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
  readonly material: THREE.Material;
  /** 人差し指の先の印（highlightIndexTip が false なら null） */
  readonly tip: THREE.Mesh | null;
  readonly tipMaterial: THREE.MeshBasicMaterial | null;
  /** 補間した 21 点（頭の座標系） */
  readonly current: THREE.Vector3[];
  /** 形の濃さ（0〜1）．0 なら形を出していない（次に現れた時は補間せず目標に置く） */
  presence: number;
  /** 一度でも 21 点を描いたか．描いた手は 21 点が無くなっても球に切り替えず，最後の形のまま薄くして消す */
  hadSkeleton: boolean;
}

interface Shared {
  readonly jointGeometry: THREE.SphereGeometry;
  readonly boneGeometry: THREE.CylinderGeometry;
  readonly palmGeometry: THREE.SphereGeometry;
  readonly tipGeometry: THREE.SphereGeometry | null;
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
  let tip: THREE.Mesh | null = null;
  let tipMaterial: THREE.MeshBasicMaterial | null = null;
  if (shared.tipGeometry !== null) {
    tipMaterial = new THREE.MeshBasicMaterial({
      color: INDEX_TIP_COLOR,
      transparent: true,
      depthTest: false,
      depthWrite: false,
    });
    tip = new THREE.Mesh(shared.tipGeometry, tipMaterial);
    tip.name = `hand-${side}-tip`;
    tip.renderOrder = 10;
    tip.visible = false;
    group.add(tip);
  }
  const current = Array.from({ length: HAND_JOINT_COUNT }, () => new THREE.Vector3());
  return {
    group,
    joints,
    bones,
    palm,
    material,
    tip,
    tipMaterial,
    current,
    presence: 0,
    hadSkeleton: false,
  };
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

/** 使える dt（0 以上の有限の秒数）か．使えなければ null（寄せない・すぐ隠す） */
function usableDt(dt: number | undefined): number | null {
  return dt !== undefined && Number.isFinite(dt) && dt >= 0 ? dt : null;
}

function hideHand(view: HandView): void {
  view.group.visible = false;
  view.presence = 0;
}

/** 21 点を目標 target へ寄せる．形を出していなかった時・dt が無い時は寄せずに目標に置く */
function approachSkeleton(view: HandView, target: readonly Vec3[], dt: number | undefined): void {
  const step = usableDt(dt);
  const k = view.presence > 0 && step !== null ? 1 - Math.exp(-step / HAND_SMOOTHING_SEC) : 1;
  for (let i = 0; i < HAND_JOINT_COUNT; i++) {
    const c = view.current[i];
    const p = target[i];
    c.set(c.x + (p.x - c.x) * k, c.y + (p.y - c.y) * k, c.z + (p.z - c.z) * k);
  }
}

function placeHand(
  view: HandView,
  head: Quat,
  hand: HandState,
  visible: boolean,
  dt: number | undefined,
): void {
  if (!visible) {
    hideHand(view);
    return;
  }
  const live = hand.tracked && isFiniteVec3(hand.position);
  const skeleton = live && isDrawableLandmarks(hand.landmarks);
  // 21 点を描いたことのある手は，tracked のまま 21 点が無くなっても（直近の認識で見えなかった）球にしない
  if (!skeleton && (!live || view.hadSkeleton)) {
    // 形を出していた手は，最後の形のまま薄くして消す（球だけの手・dt が無い時はすぐ隠す）
    const step = usableDt(dt);
    view.presence = view.presence > 0 && step !== null ? view.presence - step / HAND_FADE_SEC : 0;
    if (view.presence <= 0) {
      hideHand(view);
      return;
    }
    view.material.opacity = view.presence;
    if (view.tipMaterial !== null) view.tipMaterial.opacity = view.presence;
    view.group.quaternion.set(head.x, head.y, head.z, head.w);
    return;
  }
  view.group.visible = true;
  view.material.opacity = 1;
  if (view.tipMaterial !== null) view.tipMaterial.opacity = 1;
  view.group.quaternion.set(head.x, head.y, head.z, head.w);
  view.joints.visible = skeleton;
  view.bones.visible = skeleton;
  view.palm.visible = !skeleton;
  if (skeleton && hand.landmarks !== undefined) {
    approachSkeleton(view, hand.landmarks, dt);
    view.presence = 1;
    view.hadSkeleton = true;
    placeSkeleton(view, view.current);
    if (view.tip !== null) {
      view.tip.visible = true;
      view.tip.position.copy(view.current[INDEX_TIP_INDEX]);
    }
  } else {
    if (view.tip !== null) view.tip.visible = false;
    view.presence = 0;
    view.palm.position.set(hand.position.x, hand.position.y, hand.position.z);
  }
}

/**
 * 左右の手の形（関節の球 21 個と骨の円柱 21 本を InstancedMesh で 1 つずつ）を作る．
 * 形は左右で共有し，見た目は左右で分ける（色は同じ．見失った時の濃さを片手ずつ変えるため）
 */
export function createHandMarkers(options: HandMarkersOptions = {}): HandMarkers {
  const root = new THREE.Group();
  root.name = "hand-markers";
  const shared: Shared = {
    jointGeometry: new THREE.SphereGeometry(HAND_JOINT_RADIUS, 8, 6),
    // 高さ 1 の円柱（y の向き）を骨の長さに伸ばす．蓋は見えないので付けない
    boneGeometry: new THREE.CylinderGeometry(HAND_BONE_RADIUS, HAND_BONE_RADIUS, 1, 6, 1, true),
    palmGeometry: new THREE.SphereGeometry(HAND_MARKER_RADIUS, 12, 8),
    tipGeometry:
      options.highlightIndexTip === true
        ? new THREE.SphereGeometry(INDEX_TIP_MARKER_RADIUS, 16, 12)
        : null,
  };
  const materials: Record<Handedness, THREE.MeshBasicMaterial> = {
    // 見失った時に薄くして消すため，最初から半透明の扱いにしておく（濃さは update で opacity を変える）
    left: new THREE.MeshBasicMaterial({ color: HAND_COLORS.left, transparent: true }),
    right: new THREE.MeshBasicMaterial({ color: HAND_COLORS.right, transparent: true }),
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
    update(head, hands, visible, dt) {
      placeHand(views.left, head, hands.left, visible, dt);
      placeHand(views.right, head, hands.right, visible, dt);
    },
    dispose() {
      for (const v of [views.left, views.right]) {
        v.joints.dispose();
        v.bones.dispose();
        v.tipMaterial?.dispose();
      }
      shared.jointGeometry.dispose();
      shared.tipGeometry?.dispose();
      shared.boneGeometry.dispose();
      shared.palmGeometry.dispose();
      materials.left.dispose();
      materials.right.dispose();
    },
  };
}
