import { describe, expect, it } from "vitest";
import { applyLookDelta, DEFAULT_LOOK_OPTIONS, wrapAngle } from "./lookAngles";

const LIMIT = (85 * Math.PI) / 180;

describe("wrapAngle", () => {
  it("範囲内はそのまま", () => {
    expect(wrapAngle(0)).toBe(0);
    expect(wrapAngle(1)).toBeCloseTo(1);
    expect(wrapAngle(-3)).toBeCloseTo(-3);
  });

  it("π はそのまま，-π は π になる（(-π, π]）", () => {
    expect(wrapAngle(Math.PI)).toBeCloseTo(Math.PI);
    expect(wrapAngle(-Math.PI)).toBeCloseTo(Math.PI);
  });

  it("範囲外は 2π 単位で戻す", () => {
    expect(wrapAngle(Math.PI * 2)).toBeCloseTo(0);
    expect(wrapAngle(Math.PI * 1.5)).toBeCloseTo(-Math.PI / 2);
    expect(wrapAngle(-Math.PI * 1.5)).toBeCloseTo(Math.PI / 2);
    expect(wrapAngle(Math.PI * 7 + 0.1)).toBeCloseTo(-Math.PI + 0.1);
  });

  it("結果は常に (-π, π]", () => {
    for (let a = -50; a <= 50; a += 0.37) {
      const w = wrapAngle(a);
      expect(w).toBeGreaterThan(-Math.PI);
      expect(w).toBeLessThanOrEqual(Math.PI);
      // 2π の整数倍の差
      const k = (a - w) / (Math.PI * 2);
      expect(Math.abs(k - Math.round(k))).toBeLessThan(1e-9);
    }
  });
});

describe("applyLookDelta", () => {
  it("既定の感度は 0.004 rad/px，pitch の上限は 85°", () => {
    expect(DEFAULT_LOOK_OPTIONS.sensitivity).toBe(0.004);
    expect(DEFAULT_LOOK_OPTIONS.pitchLimit).toBeCloseTo(LIMIT);
  });

  it("右ドラッグで yaw が減る", () => {
    const r = applyLookDelta({ yaw: 0, pitch: 0 }, 100, 0);
    expect(r.yaw).toBeCloseTo(-0.4);
    expect(r.pitch).toBe(0);
  });

  it("左ドラッグで yaw が増える", () => {
    expect(applyLookDelta({ yaw: 0, pitch: 0 }, -50, 0).yaw).toBeCloseTo(0.2);
  });

  it("上ドラッグ（dy < 0）で上を向く（pitch が増える）", () => {
    const r = applyLookDelta({ yaw: 0, pitch: 0 }, 0, -100);
    expect(r.pitch).toBeCloseTo(0.4);
    expect(r.yaw).toBe(0);
  });

  it("下ドラッグで下を向く", () => {
    expect(applyLookDelta({ yaw: 0, pitch: 0 }, 0, 100).pitch).toBeCloseTo(-0.4);
  });

  it("pitch は ±85° に制限される", () => {
    expect(applyLookDelta({ yaw: 0, pitch: 0 }, 0, -100000).pitch).toBeCloseTo(LIMIT);
    expect(applyLookDelta({ yaw: 0, pitch: 0 }, 0, 100000).pitch).toBeCloseTo(-LIMIT);
  });

  it("yaw は (-π, π] に折り返す", () => {
    const r = applyLookDelta({ yaw: Math.PI - 0.1, pitch: 0 }, -100, 0);
    expect(r.yaw).toBeCloseTo(-Math.PI + 0.3);
  });

  it("入力を書き換えない", () => {
    const look = { yaw: 0.1, pitch: 0.2 };
    applyLookDelta(look, 10, 10);
    expect(look).toEqual({ yaw: 0.1, pitch: 0.2 });
  });

  it("options を指定できる", () => {
    const r = applyLookDelta({ yaw: 0, pitch: 0 }, 10, -10, {
      sensitivity: 0.01,
      pitchLimit: 0.05,
    });
    expect(r.yaw).toBeCloseTo(-0.1);
    expect(r.pitch).toBeCloseTo(0.05);
  });
});
