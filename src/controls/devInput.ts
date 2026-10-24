// 確認用の仮の入力から PlayerInput を作る（DOM に依存しない純粋な関数）．
// 本物の検知（担当D の src/input/）が入ったら差し替える

import type { PlayerInput, Quat } from "../core/types";
import { IDLE_PLAYER_INPUT } from "../core/types";
import type { LookAngles } from "./lookAngles";

/** 「歩く」ボタンを押している間の前進の速さ（m/s．ゴーグルで酔いにくいよう普通の歩きより遅め） */
export const DEV_WALK_SPEED = 1.0;

/** 仮の入力の状態 */
export interface DevInputState {
  /** 頭の向き（体の向きから見た yaw / pitch．ドラッグ操作） */
  readonly look: LookAngles;
  /** 「歩く」ボタンを押しているか */
  readonly walking: boolean;
  /** 「しゃがむ」ボタンでしゃがんだ状態か */
  readonly crouching: boolean;
}

/** yaw → pitch の順に回すクォータニオン（three の Euler "YXZ" と同じ） */
export function lookToQuat(look: LookAngles): Quat {
  const sy = Math.sin(look.yaw / 2);
  const cy = Math.cos(look.yaw / 2);
  const sp = Math.sin(look.pitch / 2);
  const cp = Math.cos(look.pitch / 2);
  return { x: cy * sp, y: sy * cp, z: -sy * sp, w: cy * cp };
}

/** 仮の入力の状態から 1 フレーム分の PlayerInput を作る（手は未認識） */
export function devPlayerInput(state: DevInputState, time: number): PlayerInput {
  return {
    ...IDLE_PLAYER_INPUT,
    time,
    head: lookToQuat(state.look),
    posture: state.crouching ? "crouching" : "standing",
    walking: state.walking,
    walkSpeed: state.walking ? DEV_WALK_SPEED : 0,
  };
}
