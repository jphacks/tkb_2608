import { describe, expect, it } from "vitest";
import type { Vec3 } from "../../core/types";
import type { MotionSample } from "../sensors/types";
import { createVerticalState, gyroMagnitude, resetVertical, updateVertical } from "./vertical";

const G = 9.81;

function unit(x: number, y: number, z: number): Vec3 {
  const n = Math.hypot(x, y, z);
  return { x: x / n, y: y / n, z: z / n };
}

function scale(v: Vec3, k: number): Vec3 {
  return { x: v.x * k, y: v.y * k, z: v.z * k };
}

/** 端末の座標での「上」の向き up に，上下の加速度 a（上が正）が加わったサンプル．sign=-1 は符号が反転する端末 */
function sampleAt(
  t: number,
  up: Vec3,
  a: number,
  opts: { acc?: boolean; sign?: 1 | -1 } = {},
): MotionSample {
  const sign = opts.sign ?? 1;
  return {
    t,
    acc: opts.acc === false ? null : scale(up, a * sign),
    accG: scale(up, (G + a) * sign),
    rot: null,
    interval: 16,
  };
}

/** 静止で重力の向きを落ち着かせてから，上下の加速度 a のサンプルを 1 つ通した値 */
function settledValue(up: Vec3, a: number, opts: { acc?: boolean; sign?: 1 | -1 } = {}): number {
  const s = createVerticalState();
  let t = 0;
  for (let i = 0; i < 600; i++) {
    updateVertical(s, sampleAt(t, up, 0, opts), i === 0 ? 0 : 0.016, 0.3);
    t += 16;
  }
  return updateVertical(s, sampleAt(t, up, a, opts), 0.016, 0.3);
}

describe("updateVertical（重力の向きへの射影）", () => {
  it.each([
    ["縦に持つ（y が上）", unit(0, 1, 0)],
    ["前に 30° 傾ける", unit(0, Math.cos(Math.PI / 6), Math.sin(Math.PI / 6))],
    ["横に 45° 傾ける", unit(1, 1, 0)],
    ["平らに置く（z が上）", unit(0, 0, 1)],
    ["斜め", unit(-0.3, 0.8, 0.5)],
  ])("端末を傾けても上下の値は変わらない: %s", (_, up) => {
    expect(settledValue(up, 2)).toBeCloseTo(2, 6);
    expect(settledValue(up, -1.5)).toBeCloseTo(-1.5, 6);
  });

  it("acceleration が null なら accelerationIncludingGravity − 重力で代える", () => {
    for (const up of [unit(0, 1, 0), unit(0.4, 0.7, 0.3)]) {
      // 低域通過が今のサンプルを少し取り込む分（数 %）だけ小さくなる
      expect(Math.abs(settledValue(up, 2, { acc: false }) - 2)).toBeLessThan(0.1);
      expect(Math.abs(settledValue(up, -1, { acc: false }) + 1)).toBeLessThan(0.05);
    }
  });

  it("端末が加速度の符号を反転して届けても，上下の値は同じ", () => {
    const up = unit(0.2, 0.9, 0.1);
    expect(settledValue(up, 2, { sign: -1 })).toBeCloseTo(settledValue(up, 2), 6);
    expect(settledValue(up, 2, { sign: -1, acc: false })).toBeCloseTo(
      settledValue(up, 2, { acc: false }),
      6,
    );
  });

  it("重力の向きは低域通過でゆっくり追う（向きを変えた直後は前の向きが残る）", () => {
    const s = createVerticalState();
    for (let i = 0; i < 300; i++) updateVertical(s, sampleAt(i * 16, unit(0, 1, 0), 0), 0.016, 0.3);
    updateVertical(s, sampleAt(300 * 16, unit(0, 0, 1), 0), 0.016, 0.3);
    expect(s.gy).toBeGreaterThan(9);
    for (let i = 301; i < 1500; i++)
      updateVertical(s, sampleAt(i * 16, unit(0, 0, 1), 0), 0.016, 0.3);
    expect(s.gz).toBeCloseTo(G, 2);
    expect(Math.abs(s.gy)).toBeLessThan(0.01);
  });

  it("dt が 0 なら重力の見積もりを動かさない", () => {
    const s = createVerticalState();
    updateVertical(s, sampleAt(0, unit(0, 1, 0), 0), 0, 0.3);
    const g = { ...s };
    updateVertical(s, sampleAt(0, unit(1, 0, 0), 0), 0, 0.3);
    expect(s).toEqual(g);
  });

  it("重力の加速度が無い・まだ求まらない時は NaN（例外を投げない）", () => {
    const s = createVerticalState();
    const v = updateVertical(
      s,
      { t: 0, acc: { x: 0, y: 1, z: 0 }, accG: null, rot: null, interval: null },
      0,
      0.3,
    );
    expect(v).toBeNaN();
    expect(s.ready).toBe(false);
  });

  it("重力の見積もりが小さすぎる（自由落下等）時は NaN", () => {
    const s = createVerticalState();
    const v = updateVertical(
      s,
      { t: 0, acc: { x: 0, y: 0, z: 0 }, accG: { x: 0, y: 0.5, z: 0 }, rot: null, interval: null },
      0,
      0.3,
    );
    expect(v).toBeNaN();
  });

  it("resetVertical で最初からやり直す", () => {
    const s = createVerticalState();
    updateVertical(s, sampleAt(0, unit(0, 1, 0), 0), 0, 0.3);
    resetVertical(s);
    expect(s).toEqual(createVerticalState());
  });
});

describe("gyroMagnitude", () => {
  it("角速度の大きさ（deg/s）．無ければ NaN", () => {
    expect(
      gyroMagnitude({
        t: 0,
        acc: null,
        accG: null,
        rot: { alpha: 3, beta: 4, gamma: 12 },
        interval: null,
      }),
    ).toBeCloseTo(13, 12);
    expect(gyroMagnitude({ t: 0, acc: null, accG: null, rot: null, interval: null })).toBeNaN();
  });
});
