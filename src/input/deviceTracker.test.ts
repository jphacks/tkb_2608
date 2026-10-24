import { describe, expect, it } from "vitest";
import { type CalibrationProfile, IDLE_PLAYER_INPUT, UNTRACKED_HAND } from "../core/types";
import { DeviceTracker } from "./deviceTracker";
import { DEG, yawOfQuat } from "./head/quat";
import type { MotionSample, OrientationSample } from "./sensors/types";
import { samplesOf, TEST_PARAMS } from "./testFixtures";

function calib(over: Partial<CalibrationProfile> = {}): CalibrationProfile {
  return {
    createdAt: 0,
    yawOffset: 0,
    stepPeakThreshold: Number.NaN,
    standingBaseline: 0,
    crouchThreshold: Number.NaN,
    ...over,
  };
}

function orientation(t: number, alpha: number): OrientationSample {
  return { t, alpha, beta: 90, gamma: 0, absolute: false };
}

const NO_PRED = { ...TEST_PARAMS, headPredictionMs: 0 };

function walk(tracker: DeviceTracker, t0: number, ms: number): void {
  for (const s of samplesOf(t0, ms, 16, (t) => -3 * Math.cos(2 * Math.PI * 2 * t))) {
    tracker.onMotion(s);
  }
}

describe("DeviceTracker", () => {
  it("サンプルが無い時は止まって立ち，正面を向き，手は UNTRACKED_HAND", () => {
    const tr = new DeviceTracker({ params: TEST_PARAMS });
    const input = tr.read(123);
    expect(input).toEqual({ ...IDLE_PLAYER_INPUT, time: 123 });
    expect(input.hands.left).toEqual(UNTRACKED_HAND);
    expect(input.hands.right).toEqual(UNTRACKED_HAND);
  });

  it("params の上書きはキャリブレーションの後に重ねる", () => {
    const tr = new DeviceTracker({
      calibration: calib({ stepPeakThreshold: 2, crouchThreshold: 0.5 }),
      params: { stepHighStanding: 3 },
    });
    expect(tr.params.stepHighStanding).toBe(3);
    expect(tr.params.crouchDepthM).toBe(0.5);
  });

  it("setParams は一部だけ変え，前の上書きも残す", () => {
    const tr = new DeviceTracker({ params: { strideM: 0.6 } });
    tr.setParams({ maxWalkSpeed: 1.1 });
    expect(tr.params.strideM).toBe(0.6);
    expect(tr.params.maxWalkSpeed).toBe(1.1);
  });

  it("キャリブレーションの値が範囲外なら既定のしきい値で判定する", () => {
    const base = new DeviceTracker({});
    const tr = new DeviceTracker({
      calibration: calib({ stepPeakThreshold: 100, crouchThreshold: -1 }),
    });
    expect(tr.params).toEqual(base.params);
  });

  it("足踏みの合成波形で walking になり，センサーが途切れたら止まる", () => {
    const tr = new DeviceTracker({ params: TEST_PARAMS });
    walk(tr, 0, 3000);
    const last = tr.body.lastT;
    expect(tr.read(last).walking).toBe(true);
    expect(tr.read(last).walkSpeed).toBeGreaterThan(0);
    expect(tr.read(last + TEST_PARAMS.sensorTimeoutMs + 1)).toMatchObject({
      walking: false,
      walkSpeed: 0,
    });
  });

  it("reset で歩きを止め，姿勢と頭の向きは保つ", () => {
    const tr = new DeviceTracker({ params: NO_PRED });
    tr.onOrientation(orientation(0, 10));
    tr.onOrientation(orientation(16, 40));
    walk(tr, 0, 3000);
    tr.body.posture.posture = "crouching";
    const headBefore = tr.read(tr.body.lastT).head;
    tr.reset();
    const after = tr.read(3000);
    expect(after.walking).toBe(false);
    expect(after.posture).toBe("crouching");
    expect(after.head).toEqual(headBefore);
    expect(tr.head.rateT).toBe(Number.NEGATIVE_INFINITY);
  });

  describe("正面", () => {
    it("キャリブレーションが無ければ最初に受け取った向きが正面", () => {
      const tr = new DeviceTracker({ params: NO_PRED });
      tr.onOrientation(orientation(0, 50));
      expect(yawOfQuat(tr.read(0).head)).toBeCloseTo(0, 9);
    });

    it("yawOffset があればそれを正面にし，recenter はそれより優先する．setCalibration で yawOffset に戻す", () => {
      const tr = new DeviceTracker({
        calibration: calib({ yawOffset: 20 * DEG }),
        params: NO_PRED,
      });
      tr.onOrientation(orientation(0, 50));
      expect(yawOfQuat(tr.read(0).head)).toBeCloseTo(30 * DEG, 9);
      tr.recenter();
      expect(yawOfQuat(tr.read(0).head)).toBeCloseTo(0, 9);
      tr.setCalibration(calib({ yawOffset: 40 * DEG }));
      expect(yawOfQuat(tr.read(0).head)).toBeCloseTo(10 * DEG, 9);
    });

    it("画面の向きが変わると仮の正面を取り直す", () => {
      const tr = new DeviceTracker({ params: NO_PRED });
      tr.onOrientation(orientation(0, 50));
      tr.onScreen({ t: 10, angle: 180, orientationType: null });
      tr.onOrientation(orientation(16, 80));
      expect(yawOfQuat(tr.read(16).head)).toBeCloseTo(0, 9);
    });
  });

  describe("例外を外に出さない", () => {
    it("形の壊れたサンプルでも onMotion・onOrientation・onScreen・read が例外を投げない", () => {
      const tr = new DeviceTracker({ params: TEST_PARAMS });
      walk(tr, 0, 1000);
      const broken = [
        {},
        { t: 1100 },
        { t: 1116, acc: 3, accG: "x", rot: 5 },
        { t: 1132, rot: { alpha: "a" } },
        null,
        undefined,
      ] as unknown as MotionSample[];
      for (const b of broken) expect(() => tr.onMotion(b)).not.toThrow();
      expect(() => tr.onOrientation({} as OrientationSample)).not.toThrow();
      expect(() => tr.onOrientation(null as unknown as OrientationSample)).not.toThrow();
      expect(() => tr.onScreen({ t: 0, angle: Number.NaN, orientationType: null })).not.toThrow();
      const input = tr.read(1200);
      expect(Number.isFinite(input.walkSpeed)).toBe(true);
      expect(Number.isFinite(input.head.w)).toBe(true);
    });

    it("壊れたサンプルの後も判定は続く", () => {
      const tr = new DeviceTracker({ params: TEST_PARAMS });
      tr.onMotion({} as MotionSample);
      walk(tr, 0, 3000);
      expect(tr.read(tr.body.lastT).walking).toBe(true);
    });
  });

  it("devicemotion の処理時間を数える", () => {
    const tr = new DeviceTracker({ params: TEST_PARAMS });
    walk(tr, 0, 160);
    expect(tr.timing.count).toBe(10);
    expect(tr.timing.totalMs).toBeGreaterThanOrEqual(0);
    expect(tr.timing.maxMs).toBeLessThanOrEqual(tr.timing.totalMs + 1e-9);
  });

  it("角速度で先読みする（params の headPredictionMs）", () => {
    const tr = new DeviceTracker({ params: { ...TEST_PARAMS, headPredictionMs: 50 } });
    tr.onOrientation(orientation(0, 0));
    const before = tr.read(0).head;
    // 端末を立てた（β=90）時の左右の回転は端末の y 軸まわり（rotationRate.gamma）
    tr.onMotion({
      t: 0,
      acc: null,
      accG: null,
      rot: { alpha: 0, beta: 0, gamma: 100 },
      interval: 16,
    });
    const after = tr.read(10).head;
    expect(Math.abs(yawOfQuat(after) - yawOfQuat(before))).toBeCloseTo(5 * DEG, 6);
    // 角速度が古くなったら先読みしない
    expect(yawOfQuat(tr.read(10 + TEST_PARAMS.headPredictionMaxAgeMs).head)).toBeCloseTo(
      yawOfQuat(before),
      9,
    );
  });
});
