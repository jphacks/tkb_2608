// 認識した手（PlayerInput.hands）の位置に出す小さな球．プレイヤーの体（rig）に足して使う共通部品．
// 校舎の空間（main.ts のビューア）が直接使い，ロビー（lobby/）には app/ が作る関数を渡す（画面を持つモジュール同士は import しないため）

import * as THREE from "three";
import type { Handedness, HandState, Quat } from "../../core/types";

/** 手の印．object を rig に足し，毎フレーム update で動かす */
export interface HandMarkers {
  /** rig に足す（目の位置が原点．手の位置を rig の座標にして置く） */
  readonly object: THREE.Object3D;
  /**
   * 認識している手の位置に印を出す．hands の position は頭の座標系なので，頭の向き head で rig の座標に直す．
   * tracked が false の手と，visible が false の時は隠す
   */
  update(head: Quat, hands: Readonly<Record<Handedness, HandState>>, visible: boolean): void;
  /** 形と見た目を解放する（rig から外すのは足した側が行う） */
  dispose(): void;
}

/** 球の半径（m） */
export const HAND_MARKER_RADIUS = 0.022;
/** 毎フレーム new しないための作業用の値 */
const handQuat = new THREE.Quaternion();

/**
 * 手のひらの中心に出す小さな球（左右で 1 つずつ．形と見た目は共有する）．
 * 骨格（21 点）は描かない（iPhone で 30 fps を保つため．Issue #136）
 */
export function createHandMarkers(): HandMarkers {
  const group = new THREE.Group();
  group.name = "hand-markers";
  const geometry = new THREE.SphereGeometry(HAND_MARKER_RADIUS, 12, 8);
  const material = new THREE.MeshBasicMaterial({ color: 0x9cc8ff });
  const left = new THREE.Mesh(geometry, material);
  const right = new THREE.Mesh(geometry, material);
  left.name = "hand-left";
  right.name = "hand-right";
  left.visible = false;
  right.visible = false;
  group.add(left, right);

  const place = (mesh: THREE.Mesh, hand: HandState, visible: boolean): void => {
    mesh.visible = visible && hand.tracked;
    if (!mesh.visible) return;
    mesh.position.set(hand.position.x, hand.position.y, hand.position.z).applyQuaternion(handQuat);
  };

  return {
    object: group,
    update(head, hands, visible) {
      handQuat.set(head.x, head.y, head.z, head.w);
      place(left, hands.left, visible);
      place(right, hands.right, visible);
    },
    dispose() {
      geometry.dispose();
      material.dispose();
    },
  };
}
