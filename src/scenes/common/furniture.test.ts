import { describe, expect, it } from "vitest";
import { computeFootprint, massFromDensity } from "./furniture";

describe("computeFootprint", () => {
  const size = { x: 2, z: 1 };

  it("回転なしなら size の半分", () => {
    const fp = computeFootprint({ x: 1, z: -2 }, 0, size);
    expect(fp.centerX).toBe(1);
    expect(fp.centerZ).toBe(-2);
    expect(fp.halfX).toBeCloseTo(1);
    expect(fp.halfZ).toBeCloseTo(0.5);
  });

  it("90° 回転で x と z が入れ替わる（正負どちらでも）", () => {
    for (const r of [Math.PI / 2, -Math.PI / 2]) {
      const fp = computeFootprint({ x: 0, z: 0 }, r, size);
      expect(fp.halfX).toBeCloseTo(0.5);
      expect(fp.halfZ).toBeCloseTo(1);
    }
  });

  it("180° 回転では回転なしと同じ", () => {
    const fp = computeFootprint({ x: 0, z: 0 }, Math.PI, size);
    expect(fp.halfX).toBeCloseTo(1);
    expect(fp.halfZ).toBeCloseTo(0.5);
  });

  it("45° 回転では外接 AABB が広がる", () => {
    const fp = computeFootprint({ x: 0, z: 0 }, Math.PI / 4, size);
    const expected = ((2 + 1) * Math.SQRT1_2) / 2;
    expect(fp.halfX).toBeCloseTo(expected);
    expect(fp.halfZ).toBeCloseTo(expected);
  });

  it("任意の角度で回転後の 4 隅を内包する", () => {
    for (let i = 0; i < 36; i++) {
      const r = (i / 36) * Math.PI * 2 - Math.PI;
      const fp = computeFootprint({ x: 0.3, z: -0.7 }, r, size);
      for (const [lx, lz] of [
        [1, 0.5],
        [-1, 0.5],
        [1, -0.5],
        [-1, -0.5],
      ]) {
        // three の Y 軸回転: x' = x cos + z sin, z' = -x sin + z cos
        const wx = 0.3 + lx * Math.cos(r) + lz * Math.sin(r);
        const wz = -0.7 - lx * Math.sin(r) + lz * Math.cos(r);
        expect(Math.abs(wx - fp.centerX)).toBeLessThanOrEqual(fp.halfX + 1e-9);
        expect(Math.abs(wz - fp.centerZ)).toBeLessThanOrEqual(fp.halfZ + 1e-9);
      }
    }
  });
});

describe("massFromDensity", () => {
  it("体積 × 密度", () => {
    expect(massFromDensity({ x: 0.5, y: 0.2, z: 0.1 }, 600)).toBeCloseTo(6);
  });

  it("寸法が 0 なら 0", () => {
    expect(massFromDensity({ x: 0, y: 1, z: 1 }, 1000)).toBe(0);
  });
});
