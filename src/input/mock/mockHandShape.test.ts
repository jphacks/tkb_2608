// モック入力の手の 21 点の決め打ちの形（Issue #160: 開いた手・握った手）
import { describe, expect, it } from "vitest";
import { MOCK_FIST_HAND, MOCK_OPEN_HAND, mockHandLandmarks } from "./mockHandShape";

const PALM = { x: 0.1, y: -0.2, z: -0.45 };
const PALM_IDS = [0, 5, 9, 13, 17];

describe("MOCK_OPEN_HAND・MOCK_FIST_HAND", () => {
  it.each([
    ["開いた手", MOCK_OPEN_HAND],
    ["握った手", MOCK_FIST_HAND],
  ])("%sは 21 点で，手のひらの中心（手首と 4 本の指の付け根の平均）が原点", (_, shape) => {
    expect(shape).toHaveLength(21);
    for (let k = 0; k < 3; k++) {
      const mean = PALM_IDS.reduce((a, i) => a + shape[i][k], 0) / PALM_IDS.length;
      expect(mean).toBeCloseTo(0, 12);
    }
  });

  it("開いた手は指の先が付け根より上，右手なので親指の先は左（-x）", () => {
    for (const [mcp, tip] of [
      [5, 8],
      [9, 12],
      [13, 16],
      [17, 20],
    ]) {
      expect(MOCK_OPEN_HAND[tip][1]).toBeGreaterThan(MOCK_OPEN_HAND[mcp][1]);
    }
    expect(MOCK_OPEN_HAND[4][0]).toBeLessThan(MOCK_OPEN_HAND[0][0]);
  });

  it("握った手は指の先が付け根より下にある", () => {
    for (const [mcp, tip] of [
      [5, 8],
      [9, 12],
      [13, 16],
      [17, 20],
    ]) {
      expect(MOCK_FIST_HAND[tip][1]).toBeLessThan(MOCK_FIST_HAND[mcp][1]);
    }
  });
});

describe("mockHandLandmarks", () => {
  it("grip 0 は開いた手，grip 1 は握った手を手のひらの位置に置く", () => {
    const open = mockHandLandmarks(PALM, 0);
    const fist = mockHandLandmarks(PALM, 1);
    expect(open?.[12].x).toBeCloseTo(PALM.x + MOCK_OPEN_HAND[12][0], 12);
    expect(open?.[12].y).toBeCloseTo(PALM.y + MOCK_OPEN_HAND[12][1], 12);
    expect(fist?.[12].z).toBeCloseTo(PALM.z + MOCK_FIST_HAND[12][2], 12);
  });

  it("grip 0.5 は開いた手と握った手の中間", () => {
    const half = mockHandLandmarks(PALM, 0.5);
    const mid = (MOCK_OPEN_HAND[8][1] + MOCK_FIST_HAND[8][1]) / 2;
    expect(half?.[8].y).toBeCloseTo(PALM.y + mid, 12);
  });

  it.each([
    [-1, 0],
    [2, 1],
    [Number.NaN, 0],
  ])("grip %s は %s として扱う", (grip, as) => {
    expect(mockHandLandmarks(PALM, grip)).toEqual(mockHandLandmarks(PALM, as));
  });

  it("手のひらの位置が有限でない時は null", () => {
    expect(mockHandLandmarks({ x: Number.NaN, y: 0, z: 0 }, 0)).toBeNull();
    expect(mockHandLandmarks({ x: 0, y: 0, z: Number.POSITIVE_INFINITY }, 0)).toBeNull();
  });
});
