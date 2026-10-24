// 確認用の仮の入力（「歩く」「しゃがむ」ボタンとドラッグの視点）から PlayerInput を作る処理のテスト．
// Issue #31「歩く・しゃがむボタンで walking・walkSpeed・posture を出し，PlayerInput を作る」

import * as THREE from "three";
import { describe, expect, it } from "vitest";
import { headYaw } from "../scenes/walk/locomotion";
import { DEV_WALK_SPEED, devPlayerInput, lookToQuat } from "./devInput";

describe("lookToQuat", () => {
  it("three の Euler（YXZ: yaw → pitch）と同じ回転になる", () => {
    for (const [yaw, pitch] of [
      [0, 0],
      [0.7, 0],
      [0, -0.4],
      [-1.3, 0.9],
      [2.8, -1.2],
    ] as const) {
      const q = lookToQuat({ yaw, pitch });
      const expected = new THREE.Quaternion().setFromEuler(new THREE.Euler(pitch, yaw, 0, "YXZ"));
      // 同じ回転なら q と -q のどちらか
      const dot = q.x * expected.x + q.y * expected.y + q.z * expected.z + q.w * expected.w;
      expect(Math.abs(dot)).toBeCloseTo(1, 6);
    }
  });

  it("頭の yaw は見上げ・見下ろしに関わらず元の yaw に戻る（歩く向きに使う）", () => {
    for (const pitch of [-1.2, -0.3, 0, 0.5, 1.4]) {
      expect(headYaw(lookToQuat({ yaw: 0.9, pitch }))).toBeCloseTo(0.9, 6);
    }
  });
});

describe("devPlayerInput", () => {
  const look = { yaw: 0.3, pitch: -0.2 };

  it("「歩く」を押している間は walking で，walkSpeed が正", () => {
    const input = devPlayerInput({ look, walking: true, crouching: false }, 1000);
    expect(input.walking).toBe(true);
    expect(input.walkSpeed).toBe(DEV_WALK_SPEED);
    expect(input.walkSpeed).toBeGreaterThan(0);
    expect(input.posture).toBe("standing");
    expect(input.time).toBe(1000);
  });

  it("押していなければ walking ではなく，walkSpeed は 0", () => {
    const input = devPlayerInput({ look, walking: false, crouching: false }, 0);
    expect(input.walking).toBe(false);
    expect(input.walkSpeed).toBe(0);
  });

  it("「しゃがむ」の状態なら posture は crouching", () => {
    expect(devPlayerInput({ look, walking: false, crouching: true }, 0).posture).toBe("crouching");
    expect(devPlayerInput({ look, walking: true, crouching: true }, 0).walking).toBe(true);
  });

  it("頭の向きはドラッグの向き，手は未認識", () => {
    const input = devPlayerInput({ look, walking: false, crouching: false }, 0);
    const q = lookToQuat(look);
    expect(input.head).toEqual(q);
    expect(input.hands.left.tracked).toBe(false);
    expect(input.hands.right.tracked).toBe(false);
  });
});
