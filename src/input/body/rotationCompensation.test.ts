// 頭の回転による加速度の見積もり（a_rot = α × r + ω × (ω × r)）を，物理の式と合成の首振りで確かめる
import { describe, expect, it } from "vitest";
import { synthHeadRotation } from "../replay/synthetic";
import {
  createRotationCompState,
  type DeviceVec,
  resetRotationComp,
  updateRotationComp,
} from "./rotationCompensation";

const DEG = Math.PI / 180;
const zero = (): DeviceVec => ({ x: 0, y: 0, z: 0 });

describe("updateRotationComp", () => {
  it("一定の角速度（y 軸まわり 90 deg/s）では向心の項だけ: 中心向きに ω^2 r", () => {
    const s = createRotationCompState();
    const out = zero();
    const lever = { x: 0, y: 0, z: -0.16 };
    updateRotationComp(s, { alpha: 0, beta: 0, gamma: 90 }, 0.016, lever, out);
    expect(updateRotationComp(s, { alpha: 0, beta: 0, gamma: 90 }, 0.016, lever, out)).toBe(true);
    const w = 90 * DEG;
    expect(out.x).toBeCloseTo(0, 12);
    expect(out.y).toBeCloseTo(0, 12);
    // r は -z の向き．向心の加速度は中心（+z）向き
    expect(out.z).toBeCloseTo(w * w * 0.16, 12);
  });

  it("角加速度は前のサンプルとの差分で求め，接線の項 α × r を足す", () => {
    const s = createRotationCompState();
    const out = zero();
    const lever = { x: 0, y: 0, z: -0.16 };
    updateRotationComp(s, { alpha: 0, beta: 0, gamma: 0 }, 0.016, lever, out);
    // x 軸まわり（beta）に 0 → 10 deg/s（16 ms で）
    updateRotationComp(s, { alpha: 0, beta: 10, gamma: 0 }, 0.016, lever, out);
    const ax = (10 * DEG) / 0.016;
    const wx = 10 * DEG;
    // α × r = (ax,0,0) × (0,0,rz) = (0, -ax*rz, 0)．向心の項は (0,0,-wx^2 rz)
    expect(out.x).toBeCloseTo(0, 12);
    expect(out.y).toBeCloseTo(-ax * -0.16, 9);
    expect(out.z).toBeCloseTo(-wx * wx * -0.16, 12);
  });

  it("最初のサンプルでは角加速度を 0 とする（向心の項だけ）", () => {
    const s = createRotationCompState();
    const out = zero();
    updateRotationComp(s, { alpha: 0, beta: 100, gamma: 0 }, 0.016, { x: 0, y: 0, z: -0.16 }, out);
    const wx = 100 * DEG;
    expect(out.y).toBeCloseTo(0, 12);
    expect(out.z).toBeCloseTo(wx * wx * 0.16, 12);
    expect(s.ready).toBe(true);
  });

  it("間隔が短すぎる（4 ms 未満）サンプルでは角加速度を 0 とする", () => {
    const s = createRotationCompState();
    const out = zero();
    const lever = { x: 0, y: 0, z: -0.16 };
    updateRotationComp(s, { alpha: 0, beta: 0, gamma: 0 }, 0.016, lever, out);
    updateRotationComp(s, { alpha: 0, beta: 10, gamma: 0 }, 0.001, lever, out);
    expect(out.y).toBeCloseTo(0, 12);
  });

  it("回転の中心にあれば（てこ 0）何も出ない", () => {
    const s = createRotationCompState();
    const out = zero();
    updateRotationComp(s, { alpha: 30, beta: 40, gamma: 50 }, 0.016, zero(), out);
    updateRotationComp(s, { alpha: 60, beta: -40, gamma: 10 }, 0.016, zero(), out);
    // -0 も 0 とみなす
    expect([out.x, out.y, out.z].map((v) => v + 0)).toEqual([0, 0, 0]);
  });

  it.each<[string, Parameters<typeof updateRotationComp>[1], DeviceVec]>([
    ["角速度が null", null, { x: 0, y: 0, z: -0.16 }],
    ["角速度が NaN", { alpha: Number.NaN, beta: 0, gamma: 0 }, { x: 0, y: 0, z: -0.16 }],
    [
      "角速度が Infinity",
      { alpha: 0, beta: Number.POSITIVE_INFINITY, gamma: 0 },
      { x: 0, y: 0, z: -0.16 },
    ],
    ["てこが NaN", { alpha: 0, beta: 10, gamma: 0 }, { x: Number.NaN, y: 0, z: -0.16 }],
  ])("%s なら out を 0 にして false を返し，状態を捨てる", (_, rot, lever) => {
    const s = createRotationCompState();
    const out: DeviceVec = { x: 1, y: 1, z: 1 };
    updateRotationComp(
      s,
      { alpha: 0, beta: 50, gamma: 0 },
      0.016,
      { x: 0, y: 0, z: -0.16 },
      zero(),
    );
    expect(updateRotationComp(s, rot, 0.016, lever, out)).toBe(false);
    expect(out).toEqual({ x: 0, y: 0, z: 0 });
    expect(s.ready).toBe(false);
  });

  it("resetRotationComp で前の角速度を捨てる", () => {
    const s = createRotationCompState();
    updateRotationComp(s, { alpha: 10, beta: 20, gamma: 30 }, 0.016, zero(), zero());
    resetRotationComp(s);
    expect(s).toEqual(createRotationCompState());
  });

  it.each(["x", "y", "z"] as const)(
    "合成の首振り（%s 軸）の回転による加速度と一致する（2 サンプル目以降，差分の誤差の範囲で）",
    (axis) => {
      const lever = { x: 0.02, y: 0.05, z: -0.16 };
      const samples = synthHeadRotation({
        startMs: 0,
        durationMs: 2000,
        dtMs: 4,
        axis,
        amplitudeDeg: 30,
        freqHz: 1,
        lever,
      });
      const s = createRotationCompState();
      const out = zero();
      let maxErr = 0;
      let maxAcc = 0;
      samples.forEach((m, i) => {
        updateRotationComp(s, m.rot, 0.004, lever, out);
        if (i < 2 || m.acc === null) return;
        maxErr = Math.max(
          maxErr,
          Math.abs(out.x - m.acc.x),
          Math.abs(out.y - m.acc.y),
          Math.abs(out.z - m.acc.z),
        );
        maxAcc = Math.max(maxAcc, Math.abs(m.acc.x), Math.abs(m.acc.y), Math.abs(m.acc.z));
      });
      expect(maxAcc).toBeGreaterThan(0.05);
      // 角加速度を後ろ向きの差分で求めるため，半サンプル分の遅れの誤差が残る（大きさの 5% 未満）
      expect(maxErr).toBeLessThan(maxAcc * 0.05);
    },
  );
});

describe("synthHeadRotation", () => {
  it("長さ ÷ 間隔の数のサンプルを，間隔どおりの時刻で作る", () => {
    const samples = synthHeadRotation({
      startMs: 1000,
      durationMs: 1000,
      dtMs: 20,
      axis: "y",
      amplitudeDeg: 10,
      freqHz: 1,
      lever: zero(),
    });
    expect(samples).toHaveLength(50);
    expect(samples[0].t).toBe(1000);
    expect(samples[1].t - samples[0].t).toBe(20);
  });

  it("振れ 0・てこ 0 なら，acc は体の上下の加速度だけ，accG は重力（y が上）を足したもの", () => {
    const samples = synthHeadRotation({
      startMs: 0,
      durationMs: 100,
      dtMs: 20,
      axis: "x",
      amplitudeDeg: 0,
      freqHz: 1,
      lever: zero(),
      verticalAccel: () => 2,
    });
    for (const m of samples) {
      expect(m.acc).toEqual({ x: 0, y: 2, z: 0 });
      expect(m.accG?.y).toBeCloseTo(2 + 9.81, 12);
      expect(m.rot).toEqual({ alpha: 0, beta: 0, gamma: 0 });
    }
  });

  it.each([
    [0, "空"],
    [-100, "空"],
  ])("長さ %s なら%s", (durationMs) => {
    expect(
      synthHeadRotation({
        startMs: 0,
        durationMs,
        dtMs: 16,
        axis: "x",
        amplitudeDeg: 10,
        freqHz: 1,
        lever: zero(),
      }),
    ).toEqual([]);
  });
});
