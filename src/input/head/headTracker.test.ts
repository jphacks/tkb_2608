import { Euler, MathUtils, Quaternion, Vector3 } from "three";
import { describe, expect, it } from "vitest";
import type { Quat } from "../../core/types";
import type { MotionSample, OrientationSample } from "../sensors/types";
import { testParams } from "../testFixtures";
import {
  applyScreenAngleInto,
  cloneHeadState,
  createHeadState,
  deviceOrientationToQuat,
  deviceQuatInto,
  frontYaw,
  predictQuatInto,
  readHead,
  recenterHead,
  stepHeadOrientation,
  stepHeadRotation,
  updateHeadOrientation,
  updateHeadRotation,
  updateHeadScreenAngle,
} from "./headTracker";
import { angleBetweenQuats, DEG, identityQuat, yawOfQuat } from "./quat";

/** three.js の旧 DeviceOrientationControls（r133 まで）の setObjectQuaternion と同じ計算 */
function threeDeviceOrientation(
  alpha: number,
  beta: number,
  gamma: number,
  orient: number,
): Quaternion {
  const zee = new Vector3(0, 0, 1);
  const q1 = new Quaternion(-Math.sqrt(0.5), 0, 0, Math.sqrt(0.5));
  const q = new Quaternion().setFromEuler(
    new Euler(
      MathUtils.degToRad(beta),
      MathUtils.degToRad(alpha),
      -MathUtils.degToRad(gamma),
      "YXZ",
    ),
  );
  q.multiply(q1);
  q.multiply(new Quaternion().setFromAxisAngle(zee, -MathUtils.degToRad(orient)));
  return q;
}

function expectSameRotation(a: Quat, b: Quat, eps = 1e-9): void {
  const dot = Math.abs(a.x * b.x + a.y * b.y + a.z * b.z + a.w * b.w);
  expect(1 - dot).toBeLessThan(eps);
}

function orientation(t: number, alpha: number, beta: number, gamma: number): OrientationSample {
  return { t, alpha, beta, gamma, absolute: false };
}

function rotation(t: number, alpha: number, beta: number, gamma: number): MotionSample {
  return { t, acc: null, accG: null, rot: { alpha, beta, gamma }, interval: 16 };
}

/** ヨーの差を (-π, π] に */
function wrap(a: number): number {
  return Math.atan2(Math.sin(a), Math.cos(a));
}

const P = testParams({
  headPredictionMs: 30,
  headPredictionMinDps: 5,
  headPredictionMaxAgeMs: 100,
});
const NO_PRED = testParams({ headPredictionMs: 0 });

describe("deviceOrientationToQuat", () => {
  it.each([
    [0, 0, 0, 0],
    [0, 90, 0, 0],
    [0, 90, 0, 90],
    [10, 60, -20, 270],
    [200, -30, 45, 180],
    [359, 179, -89, 90],
  ])("three.js の旧 DeviceOrientationControls と同じ（α=%s β=%s γ=%s 画面=%s）", (a, b, g, o) => {
    expectSameRotation(deviceOrientationToQuat(a, b, g, o), threeDeviceOrientation(a, b, g, o));
  });

  it("deviceQuatInto と applyScreenAngleInto を続けたものと同じ", () => {
    const q = deviceQuatInto(identityQuat(), 30, 70, 10);
    const got = applyScreenAngleInto(identityQuat(), q, 90);
    expectSameRotation(got, deviceOrientationToQuat(30, 70, 10, 90));
  });

  it("端末を立てて（β=90）正面に向けると，視線は -z で上下を向かない", () => {
    const q = deviceOrientationToQuat(0, 90, 0, 0);
    const forward = new Vector3(0, 0, -1).applyQuaternion(new Quaternion(q.x, q.y, q.z, q.w));
    expect(forward.x).toBeCloseTo(0, 9);
    expect(forward.y).toBeCloseTo(0, 9);
    expect(forward.z).toBeCloseTo(-1, 9);
  });

  it("α が増えると左を向く（ヨーが正に増える）", () => {
    const yaw = yawOfQuat(deviceOrientationToQuat(30, 90, 0, 0));
    expect(yaw).toBeCloseTo(30 * DEG, 9);
  });
});

describe("predictQuatInto", () => {
  const LEAD = 30;
  const RATE = 100; // deg/s → 3°

  it.each([
    ["gamma（端末の y 軸）", 0, 0, RATE, [20, 70, 10 + (RATE * LEAD) / 1000]],
    ["beta（端末の x 軸）", 0, RATE, 0, [20, 70 + (RATE * LEAD) / 1000, 0]],
    ["alpha（端末の z 軸）", RATE, 0, 0, [20 + (RATE * LEAD) / 1000, 0, 0]],
  ] as const)(
    "%s の角速度で先読みすると，その分だけ角度が進んだ向きになる",
    (_, ra, rb, rg, [ea, eb, eg]) => {
      // gamma は β・γ を，beta は γ=0 の時，alpha は β=γ=0 の時に W3C の角度がそのまま増える
      const base = rg !== 0 ? [20, 70, 10] : rb !== 0 ? [20, 70, 0] : [20, 0, 0];
      const q = deviceQuatInto(identityQuat(), base[0], base[1], base[2]);
      const got = predictQuatInto(identityQuat(), q, ra, rb, rg, LEAD, 5);
      const expected = deviceQuatInto(identityQuat(), ea, eb, eg);
      expectSameRotation(got, expected, 1e-9);
      expect(angleBetweenQuats(got, q)).toBeCloseTo((RATE * LEAD * DEG) / 1000, 6);
    },
  );

  it("headPredictionMinDps より遅い回転・先読み 0・非有限では元のまま", () => {
    const q = deviceQuatInto(identityQuat(), 10, 80, 5);
    expect(predictQuatInto(identityQuat(), q, 0, 0, 4.9, LEAD, 5)).toEqual({ ...q });
    expect(predictQuatInto(identityQuat(), q, 0, 0, 100, 0, 5)).toEqual({ ...q });
    expect(predictQuatInto(identityQuat(), q, 0, 0, 100, -10, 5)).toEqual({ ...q });
    expect(predictQuatInto(identityQuat(), q, Number.NaN, 0, 100, LEAD, 5)).toEqual({ ...q });
    expect(predictQuatInto(identityQuat(), q, 0, 0, 0, LEAD, 0)).toEqual({ ...q });
  });

  it("out が q と同じでもよい", () => {
    const q = deviceQuatInto(identityQuat(), 10, 80, 5);
    const expected = predictQuatInto(identityQuat(), q, 50, 20, 100, LEAD, 5);
    predictQuatInto(q, q, 50, 20, 100, LEAD, 5);
    expectSameRotation(q, expected, 1e-14);
  });
});

describe("頭の状態（readHead）", () => {
  it("向きのサンプルが無ければ単位元（正面）", () => {
    expect(readHead(createHeadState(), 0, P, null)).toEqual({ x: 0, y: 0, z: 0, w: 1 });
  });

  it("最初に受け取った向きのヨーを正面にする", () => {
    const s = createHeadState();
    updateHeadOrientation(s, orientation(0, 40, 90, 0));
    expect(yawOfQuat(readHead(s, 0, NO_PRED, null))).toBeCloseTo(0, 9);
    updateHeadOrientation(s, orientation(16, 70, 90, 0));
    expect(yawOfQuat(readHead(s, 16, NO_PRED, null))).toBeCloseTo(30 * DEG, 9);
  });

  it("正面のリセットはヨーだけを差し引き，ピッチは残す", () => {
    const s = createHeadState();
    updateHeadOrientation(s, orientation(0, 40, 90, 0));
    updateHeadOrientation(s, orientation(16, 40, 120, 0));
    const raw = deviceOrientationToQuat(40, 120, 0, 0);
    const got = readHead(s, 16, NO_PRED, null);
    const e1 = new Euler().setFromQuaternion(new Quaternion(raw.x, raw.y, raw.z, raw.w), "YXZ");
    const e2 = new Euler().setFromQuaternion(new Quaternion(got.x, got.y, got.z, got.w), "YXZ");
    expect(e2.x).toBeCloseTo(e1.x, 9);
    expect(e2.z).toBeCloseTo(e1.z, 9);
    expect(Math.hypot(got.x, got.y, got.z, got.w)).toBeCloseTo(1, 12);
  });

  it("CalibrationProfile.yawOffset があれば，最初の向きより優先する", () => {
    const s = createHeadState();
    updateHeadOrientation(s, orientation(0, 40, 90, 0));
    const offset = 10 * DEG;
    expect(yawOfQuat(readHead(s, 0, NO_PRED, offset))).toBeCloseTo(30 * DEG, 9);
    expect(frontYaw(s, offset)).toBe(offset);
  });

  it("recenter は CalibrationProfile.yawOffset より優先する", () => {
    const s = createHeadState();
    updateHeadOrientation(s, orientation(0, 40, 90, 0));
    updateHeadOrientation(s, orientation(16, 100, 90, 0));
    recenterHead(s);
    expect(yawOfQuat(readHead(s, 16, NO_PRED, 10 * DEG))).toBeCloseTo(0, 9);
    updateHeadOrientation(s, orientation(32, 110, 90, 0));
    expect(yawOfQuat(readHead(s, 32, NO_PRED, 10 * DEG))).toBeCloseTo(10 * DEG, 9);
  });

  it("向きのサンプルの前に recenter したら，次の向きを正面にする", () => {
    const s = createHeadState();
    recenterHead(s);
    updateHeadOrientation(s, orientation(0, 77, 90, 0));
    expect(yawOfQuat(readHead(s, 0, NO_PRED, 5 * DEG))).toBeCloseTo(0, 9);
  });

  it("非有限の yawOffset は無いものとして扱う", () => {
    const s = createHeadState();
    updateHeadOrientation(s, orientation(0, 40, 90, 0));
    expect(yawOfQuat(readHead(s, 0, NO_PRED, Number.NaN))).toBeCloseTo(0, 9);
  });

  it("画面の向きが変わったら仮の正面を取り直す", () => {
    const s = createHeadState();
    updateHeadOrientation(s, orientation(0, 40, 90, 0));
    updateHeadScreenAngle(s, 90);
    updateHeadOrientation(s, orientation(16, 80, 90, 0));
    expect(yawOfQuat(readHead(s, 16, NO_PRED, null))).toBeCloseTo(0, 9);
    // 同じ向きの通知では取り直さない
    updateHeadScreenAngle(s, 90);
    updateHeadOrientation(s, orientation(32, 100, 90, 0));
    expect(wrap(yawOfQuat(readHead(s, 32, NO_PRED, null)))).toBeCloseTo(20 * DEG, 6);
  });

  it("画面の向きの補正をした向きを返す（three.js の式と同じ・正面のずれを除けば）", () => {
    const s = createHeadState();
    updateHeadScreenAngle(s, 270);
    updateHeadOrientation(s, orientation(0, 10, 60, -20));
    const expected = threeDeviceOrientation(10, 60, -20, 270);
    const got = readHead(s, 0, NO_PRED, 0); // 正面 0（yawOffset=0）なら補正なし
    expectSameRotation(got, expected);
  });

  it("新しい角速度があれば先読みし，headPredictionMaxAgeMs より古ければ先読みしない", () => {
    const s = createHeadState();
    updateHeadOrientation(s, orientation(0, 0, 90, 0));
    updateHeadRotation(s, rotation(0, 0, 0, 100));
    const still = readHead(s, 0, NO_PRED, null);
    const fresh = readHead(s, 100, P, null);
    expect(angleBetweenQuats(fresh, still)).toBeCloseTo(3 * DEG, 6);
    const stale = readHead(s, 100.5, P, null);
    expect(angleBetweenQuats(stale, still)).toBeCloseTo(0, 6);
  });

  it("角速度が無いサンプル（rot: null）は角速度を変えない", () => {
    const s = createHeadState();
    updateHeadRotation(s, rotation(0, 1, 2, 3));
    updateHeadRotation(s, { t: 16, acc: null, accG: null, rot: null, interval: null });
    expect([s.rateAlpha, s.rateBeta, s.rateGamma, s.rateT]).toEqual([1, 2, 3, 0]);
  });

  it.each([
    [null, 90, 0],
    [0, null, 0],
    [0, 90, null],
    [Number.NaN, 90, 0],
    [0, Number.POSITIVE_INFINITY, 0],
  ])("角度が欠けた・非有限のサンプル（%s, %s, %s）は捨てて直前の向きを保つ", (a, b, g) => {
    const s = createHeadState();
    updateHeadOrientation(s, orientation(0, 40, 90, 0));
    const before = cloneHeadState(s);
    expect(() =>
      updateHeadOrientation(s, { t: 16, alpha: a, beta: b, gamma: g, absolute: false }),
    ).not.toThrow();
    expect(s).toEqual(before);
  });

  it("非有限の画面の向きは無視する", () => {
    const s = createHeadState();
    updateHeadOrientation(s, orientation(0, 40, 90, 0));
    const before = cloneHeadState(s);
    updateHeadScreenAngle(s, Number.NaN);
    expect(s).toEqual(before);
  });
});

describe("書き換える版と返す版", () => {
  it("stepHeadOrientation・stepHeadRotation は元の状態を変えず，update* と同じ結果になる", () => {
    const s0 = createHeadState();
    const snapshot = cloneHeadState(s0);
    const o = orientation(0, 40, 90, 10);
    const m = rotation(5, 10, 20, 30);
    const returned = stepHeadRotation(stepHeadOrientation(s0, o), m);
    expect(s0).toEqual(snapshot);

    const mutated = createHeadState();
    updateHeadOrientation(mutated, o);
    updateHeadRotation(mutated, m);
    expect(returned).toEqual(mutated);
    expect(returned.device).not.toBe(s0.device);
  });
});
