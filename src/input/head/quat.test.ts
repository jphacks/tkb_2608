import { Euler, Quaternion } from "three";
import { describe, expect, it } from "vitest";
import type { Quat } from "../../core/types";
import {
  angleBetweenQuats,
  axisAngleQuatInto,
  copyQuat,
  DEG,
  eulerYXZQuatInto,
  identityQuat,
  multiplyQuat,
  multiplyQuatInto,
  normalizeQuatInto,
  pitchOfQuat,
  quatFromYawPitch,
  yawOfQuat,
} from "./quat";

function three(q: Quat): Quaternion {
  return new Quaternion(q.x, q.y, q.z, q.w);
}

function expectSameRotation(a: Quat, b: Quat, eps = 1e-9): void {
  // q と -q は同じ回転
  const dot = Math.abs(a.x * b.x + a.y * b.y + a.z * b.z + a.w * b.w);
  expect(1 - dot).toBeLessThan(eps);
}

/** 決まった種の擬似乱数（テストの再現性のため） */
function rng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 2 ** 32;
  };
}

function randomQuat(r: () => number): Quat {
  const q = { x: r() * 2 - 1, y: r() * 2 - 1, z: r() * 2 - 1, w: r() * 2 - 1 };
  return normalizeQuatInto(identityQuat(), q);
}

describe("multiplyQuat", () => {
  it("three.js の multiplyQuaternions(a, b) と同じ", () => {
    const r = rng(1);
    for (let i = 0; i < 20; i++) {
      const a = randomQuat(r);
      const b = randomQuat(r);
      const expected = new Quaternion().multiplyQuaternions(three(a), three(b));
      const got = multiplyQuat(a, b);
      expect(got.x).toBeCloseTo(expected.x, 12);
      expect(got.y).toBeCloseTo(expected.y, 12);
      expect(got.z).toBeCloseTo(expected.z, 12);
      expect(got.w).toBeCloseTo(expected.w, 12);
    }
  });

  it("out が a・b と同じでも正しい", () => {
    const r = rng(2);
    const a = randomQuat(r);
    const b = randomQuat(r);
    const expected = multiplyQuat(a, b);
    const outA = copyQuat(identityQuat(), a);
    multiplyQuatInto(outA, outA, b);
    expectSameRotation(outA, expected, 1e-14);
    const outB = copyQuat(identityQuat(), b);
    multiplyQuatInto(outB, a, outB);
    expectSameRotation(outB, expected, 1e-14);
  });

  it("新しく返す版は引数を書き換えない", () => {
    const a = { x: 0.1, y: 0.2, z: 0.3, w: 0.9 };
    const b = { x: -0.2, y: 0.1, z: 0, w: 0.97 };
    const a0 = { ...a };
    const b0 = { ...b };
    multiplyQuat(a, b);
    expect(a).toEqual(a0);
    expect(b).toEqual(b0);
  });
});

describe("normalizeQuatInto", () => {
  it("長さを 1 にする", () => {
    const q = normalizeQuatInto(identityQuat(), { x: 1, y: 2, z: 3, w: 4 });
    expect(Math.hypot(q.x, q.y, q.z, q.w)).toBeCloseTo(1, 14);
  });

  it.each([
    { x: 0, y: 0, z: 0, w: 0 },
    { x: Number.NaN, y: 0, z: 0, w: 1 },
    { x: Number.POSITIVE_INFINITY, y: 0, z: 0, w: 1 },
  ])("長さが 0・非有限なら単位元（%o）", (q) => {
    expect(normalizeQuatInto(identityQuat(), q)).toEqual({ x: 0, y: 0, z: 0, w: 1 });
  });
});

describe("axisAngleQuatInto・eulerYXZQuatInto", () => {
  it("three.js の setFromAxisAngle と同じ", () => {
    const got = axisAngleQuatInto(identityQuat(), 0, 0, 1, 1.2);
    const e = new Quaternion().setFromAxisAngle({ x: 0, y: 0, z: 1 } as never, 1.2);
    expectSameRotation(got, e);
  });

  it("three.js の setFromEuler(YXZ) と同じ", () => {
    const r = rng(3);
    for (let i = 0; i < 20; i++) {
      const [x, y, z] = [r() * 6 - 3, r() * 6 - 3, r() * 6 - 3];
      const got = eulerYXZQuatInto(identityQuat(), x, y, z);
      const e = new Quaternion().setFromEuler(new Euler(x, y, z, "YXZ"));
      expect(got.x).toBeCloseTo(e.x, 12);
      expect(got.y).toBeCloseTo(e.y, 12);
      expect(got.z).toBeCloseTo(e.z, 12);
      expect(got.w).toBeCloseTo(e.w, 12);
    }
  });
});

describe("yawOfQuat・pitchOfQuat", () => {
  it("three.js の Euler.setFromQuaternion(q, YXZ) の y・x と同じ（乱数の向き）", () => {
    const r = rng(4);
    for (let i = 0; i < 50; i++) {
      const q = randomQuat(r);
      const e = new Euler().setFromQuaternion(three(q), "YXZ");
      expect(yawOfQuat(q)).toBeCloseTo(e.y, 9);
      expect(pitchOfQuat(q)).toBeCloseTo(e.x, 9);
    }
  });

  it.each([90, -90])("真上・真下（ピッチ %s°）でも three.js と同じ", (pitchDeg) => {
    for (const yawDeg of [0, 30, -120, 179]) {
      for (const rollDeg of [0, 20]) {
        const q = eulerYXZQuatInto(identityQuat(), pitchDeg * DEG, yawDeg * DEG, rollDeg * DEG);
        const e = new Euler().setFromQuaternion(three(q), "YXZ");
        expect(yawOfQuat(q)).toBeCloseTo(e.y, 6);
        expect(pitchOfQuat(q)).toBeCloseTo(e.x, 6);
        expect(Math.abs(pitchOfQuat(q))).toBeCloseTo(Math.PI / 2, 6);
      }
    }
  });

  it("ヨーは 0 で -z，正で左（+y まわりの回転）．ピッチは上が正", () => {
    expect(yawOfQuat(identityQuat())).toBe(0);
    const left = axisAngleQuatInto(identityQuat(), 0, 1, 0, 0.5);
    expect(yawOfQuat(left)).toBeCloseTo(0.5, 12);
    const up = axisAngleQuatInto(identityQuat(), 1, 0, 0, 0.3);
    expect(pitchOfQuat(up)).toBeCloseTo(0.3, 12);
    expect(yawOfQuat(up)).toBeCloseTo(0, 12);
  });
});

describe("quatFromYawPitch", () => {
  it("ヨー・ピッチがそのまま読み戻せる（ロール 0）", () => {
    for (const [yaw, pitch] of [
      [0, 0],
      [1, 0.3],
      [-2.5, -1.2],
      [3, 1.4],
    ]) {
      const q = quatFromYawPitch(yaw, pitch);
      expect(yawOfQuat(q)).toBeCloseTo(yaw, 9);
      expect(pitchOfQuat(q)).toBeCloseTo(pitch, 9);
      const e = new Euler().setFromQuaternion(three(q), "YXZ");
      expect(e.z).toBeCloseTo(0, 9);
    }
  });
});

describe("angleBetweenQuats", () => {
  it("同じ向きは 0，q と -q も 0", () => {
    const q = quatFromYawPitch(0.4, 0.2);
    expect(angleBetweenQuats(q, q)).toBeCloseTo(0, 6);
    expect(angleBetweenQuats(q, { x: -q.x, y: -q.y, z: -q.z, w: -q.w })).toBeCloseTo(0, 6);
  });

  it("軸まわりに θ 回した向きとの間は θ（0〜π）", () => {
    const a = identityQuat();
    for (const th of [0.1, 1, 2, Math.PI]) {
      const b = axisAngleQuatInto(identityQuat(), 0, 0, 1, th);
      expect(angleBetweenQuats(a, b)).toBeCloseTo(th, 6);
    }
    const c = axisAngleQuatInto(identityQuat(), 0, 1, 0, 1.5 * Math.PI);
    expect(angleBetweenQuats(a, c)).toBeCloseTo(0.5 * Math.PI, 6);
  });
});
