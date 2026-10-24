import { describe, expect, it } from "vitest";
import type { Quat } from "../core/types";
import {
  angleDifference,
  circularMean,
  deviceOrientationToQuat,
  headYawFromDeviceOrientation,
  multiplyQuat,
  rotateVec,
  wrapAngle,
  yawOfQuat,
} from "./orientation";

const DEG = Math.PI / 180;

/** Y 軸回りに angle（正で左へ回る）のクォータニオン */
function yawQuat(angle: number): Quat {
  return { x: 0, y: Math.sin(angle / 2), z: 0, w: Math.cos(angle / 2) };
}

/** X 軸回りに angle（正で上を向く）のクォータニオン */
function pitchQuat(angle: number): Quat {
  return { x: Math.sin(angle / 2), y: 0, z: 0, w: Math.cos(angle / 2) };
}

describe("wrapAngle", () => {
  it("(-π, π] に収める", () => {
    expect(wrapAngle(0)).toBe(0);
    expect(wrapAngle(Math.PI)).toBeCloseTo(Math.PI);
    expect(wrapAngle(-Math.PI)).toBeCloseTo(Math.PI);
    expect(wrapAngle(3 * Math.PI)).toBeCloseTo(Math.PI);
    expect(wrapAngle(1.5 * Math.PI)).toBeCloseTo(-0.5 * Math.PI);
    for (let a = -40; a <= 40; a += 0.53) {
      const w = wrapAngle(a);
      expect(w).toBeGreaterThan(-Math.PI);
      expect(w).toBeLessThanOrEqual(Math.PI);
      expect(Math.cos(w)).toBeCloseTo(Math.cos(a));
      expect(Math.sin(w)).toBeCloseTo(Math.sin(a));
    }
  });
});

describe("angleDifference", () => {
  it("b - a を返す", () => {
    expect(angleDifference(0.2, 0.5)).toBeCloseTo(0.3);
    expect(angleDifference(0.5, 0.2)).toBeCloseTo(-0.3);
  });

  it("±π をまたぐ時は近い方の差になる", () => {
    expect(angleDifference(170 * DEG, -170 * DEG)).toBeCloseTo(20 * DEG);
    expect(angleDifference(-170 * DEG, 170 * DEG)).toBeCloseTo(-20 * DEG);
  });
});

describe("circularMean", () => {
  it("空なら null", () => {
    expect(circularMean([])).toBeNull();
  });

  it("1 つならその角度", () => {
    expect(circularMean([0.7])).toBeCloseTo(0.7);
  });

  it("±π をまたぐ角度の平均は π 付近（単純平均の 0 にならない）", () => {
    const m = circularMean([170 * DEG, -170 * DEG]);
    expect(m).not.toBeNull();
    expect(Math.abs(angleDifference(Math.PI, m ?? 0))).toBeLessThan(1e-9);
  });

  it("結果は (-π, π] に入る", () => {
    const m = circularMean([3, 3.1, -3.1]);
    expect(m).not.toBeNull();
    expect(m ?? 0).toBeGreaterThan(-Math.PI);
    expect(m ?? 0).toBeLessThanOrEqual(Math.PI);
  });

  it("近い角度の平均", () => {
    expect(circularMean([10 * DEG, 20 * DEG, 30 * DEG])).toBeCloseTo(20 * DEG);
  });
});

describe("multiplyQuat / rotateVec", () => {
  it("単位クォータニオンは回さない", () => {
    const v = rotateVec({ x: 0, y: 0, z: 0, w: 1 }, { x: 1, y: 2, z: 3 });
    expect(v.x).toBeCloseTo(1);
    expect(v.y).toBeCloseTo(2);
    expect(v.z).toBeCloseTo(3);
  });

  it("Y 軸回りに +90° で正面（-Z）が左（-X）を向く", () => {
    const v = rotateVec(yawQuat(Math.PI / 2), { x: 0, y: 0, z: -1 });
    expect(v.x).toBeCloseTo(-1);
    expect(v.y).toBeCloseTo(0);
    expect(v.z).toBeCloseTo(0);
  });

  it("同じ軸の回転の積は角度の和", () => {
    const q = multiplyQuat(yawQuat(0.3), yawQuat(0.4));
    expect(yawOfQuat(q)).toBeCloseTo(0.7);
  });
});

describe("yawOfQuat", () => {
  it("回転なしで 0（-Z が正面）", () => {
    expect(yawOfQuat({ x: 0, y: 0, z: 0, w: 1 })).toBeCloseTo(0);
  });

  it("左回りが正", () => {
    expect(yawOfQuat(yawQuat(0.5))).toBeCloseTo(0.5);
    expect(yawOfQuat(yawQuat(-1.2))).toBeCloseTo(-1.2);
  });

  it("上下の傾きはヨー角に影響しない", () => {
    expect(yawOfQuat(multiplyQuat(yawQuat(0.8), pitchQuat(40 * DEG)))).toBeCloseTo(0.8);
  });

  it("真上・真下を向いている時は 0", () => {
    expect(yawOfQuat(pitchQuat(Math.PI / 2))).toBe(0);
    expect(yawOfQuat(pitchQuat(-Math.PI / 2))).toBe(0);
  });
});

describe("deviceOrientationToQuat / headYawFromDeviceOrientation", () => {
  it("縦向きで端末を立てて持つ（beta 90°）と視線は水平で -Z（ヨー 0）", () => {
    const q = deviceOrientationToQuat(0, 90, 0, 0);
    const f = rotateVec(q, { x: 0, y: 0, z: -1 });
    expect(f.x).toBeCloseTo(0);
    expect(f.y).toBeCloseTo(0);
    expect(f.z).toBeCloseTo(-1);
    expect(headYawFromDeviceOrientation(0, 90, 0, 0)).toBeCloseTo(0);
  });

  it("alpha が増える（左へ回る）とヨー角も同じだけ増える（縦向き）", () => {
    expect(headYawFromDeviceOrientation(90, 90, 0, 0)).toBeCloseTo(Math.PI / 2);
    expect(headYawFromDeviceOrientation(-45, 90, 0, 0)).toBeCloseTo(-Math.PI / 4);
  });

  it("横向き（画面の回転角 90°・270°）でも alpha の差がそのままヨー角の差になる", () => {
    for (const [gamma, screen] of [
      [-90, 90],
      [90, 270],
    ] as const) {
      const base = headYawFromDeviceOrientation(0, 0, gamma, screen);
      const turned = headYawFromDeviceOrientation(30, 0, gamma, screen);
      expect(angleDifference(base, turned)).toBeCloseTo(30 * DEG);
    }
  });

  it("横向きで端末を立てて持つと，画面の上が上（y）を向く", () => {
    for (const [gamma, screen] of [
      [-90, 90],
      [90, 270],
    ] as const) {
      const q = deviceOrientationToQuat(0, 0, gamma, screen);
      const up = rotateVec(q, { x: 0, y: 1, z: 0 });
      expect(up.y).toBeCloseTo(1);
      const f = rotateVec(q, { x: 0, y: 0, z: -1 });
      expect(f.y).toBeCloseTo(0);
    }
  });

  it("机に平らに置く（全て 0）と真下を向く", () => {
    const f = rotateVec(deviceOrientationToQuat(0, 0, 0, 0), { x: 0, y: 0, z: -1 });
    expect(f.y).toBeCloseTo(-1);
  });

  it("結果は単位クォータニオン", () => {
    const q = deviceOrientationToQuat(123, 45, -30, 90);
    expect(Math.hypot(q.x, q.y, q.z, q.w)).toBeCloseTo(1);
  });
});
