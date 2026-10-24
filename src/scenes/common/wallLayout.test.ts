import { describe, expect, it } from "vitest";
import {
  splitWallAroundOpening,
  type WallDef,
  type WallRect,
  wallPointToWorld,
  wallRectCenter,
  wallRectUv,
} from "./wallLayout";

function area(r: WallRect): number {
  return (r.u1 - r.u0) * (r.v1 - r.v0);
}

describe("splitWallAroundOpening", () => {
  it("中央の窓では 左・右・下・上 の 4 枚になる", () => {
    const rects = splitWallAroundOpening(6, 2.4, { u0: 2, u1: 4, v0: 0.8, v1: 2 });
    expect(rects).toEqual([
      { u0: 0, u1: 2, v0: 0, v1: 2.4 },
      { u0: 4, u1: 6, v0: 0, v1: 2.4 },
      { u0: 2, u1: 4, v0: 0, v1: 0.8 },
      { u0: 2, u1: 4, v0: 2, v1: 2.4 },
    ]);
  });

  it("面積の合計 + 開口部 = 壁全体", () => {
    const opening = { u0: 2.575, u1: 3.425, v0: 0, v1: 2 };
    const rects = splitWallAroundOpening(6, 2.4, opening);
    const total = rects.reduce((s, r) => s + area(r), 0);
    expect(total + area(opening)).toBeCloseTo(6 * 2.4);
  });

  it("床まであるドアでは下の片が除かれ 3 枚（左・右・上）", () => {
    const rects = splitWallAroundOpening(6, 2.4, { u0: 2.575, u1: 3.425, v0: 0, v1: 2 });
    expect(rects).toHaveLength(3);
    expect(rects[0]).toEqual({ u0: 0, u1: 2.575, v0: 0, v1: 2.4 });
    expect(rects[1]).toEqual({ u0: 3.425, u1: 6, v0: 0, v1: 2.4 });
    expect(rects[2]).toEqual({ u0: 2.575, u1: 3.425, v0: 2, v1: 2.4 });
  });

  it("壁の端・天井に接する開口部では幅 0・高さ 0 の片を除く", () => {
    const rects = splitWallAroundOpening(4, 2.4, { u0: 0, u1: 1, v0: 1, v1: 2.4 });
    expect(rects).toEqual([
      { u0: 1, u1: 4, v0: 0, v1: 2.4 },
      { u0: 0, u1: 1, v0: 0, v1: 1 },
    ]);
  });

  it("片どうしは重ならず，開口部とも重ならない", () => {
    const opening = { u0: 1.2, u1: 2.3, v0: 0.5, v1: 1.9 };
    const rects = [...splitWallAroundOpening(5, 2.4, opening), opening];
    for (let i = 0; i < rects.length; i++) {
      for (let j = i + 1; j < rects.length; j++) {
        const a = rects[i];
        const b = rects[j];
        const ox = Math.min(a.u1, b.u1) - Math.max(a.u0, b.u0);
        const oy = Math.min(a.v1, b.v1) - Math.max(a.v0, b.v0);
        expect(ox <= 1e-12 || oy <= 1e-12).toBe(true);
      }
    }
  });
});

const NORTH: WallDef = {
  id: "n",
  origin: [-3, 0, -2.5],
  dir: [1, 0, 0],
  normal: [0, 0, 1],
  rotationY: 0,
  length: 6,
};
const SOUTH: WallDef = {
  id: "s",
  origin: [3, 0, 2.5],
  dir: [-1, 0, 0],
  normal: [0, 0, -1],
  rotationY: Math.PI,
  length: 6,
};

describe("wallPointToWorld", () => {
  it("u は dir 方向，v は高さ", () => {
    expect(wallPointToWorld(NORTH, 3, 1.4)).toEqual([0, 1.4, -2.5]);
    expect(wallPointToWorld(SOUTH, 1, 0.5)).toEqual([2, 0.5, 2.5]);
  });

  it("offset は法線方向（内側）へずらす", () => {
    const p = wallPointToWorld(NORTH, 0, 0, 0.1);
    expect(p[0]).toBeCloseTo(-3);
    expect(p[1]).toBeCloseTo(0);
    expect(p[2]).toBeCloseTo(-2.4);
    const q = wallPointToWorld(SOUTH, 0, 0, 0.1);
    expect(q[2]).toBeCloseTo(2.4);
  });

  it("offset の既定値は 0", () => {
    expect(wallPointToWorld(NORTH, 2, 1)).toEqual(wallPointToWorld(NORTH, 2, 1, 0));
  });
});

describe("wallRectCenter", () => {
  it("矩形の中心のワールド座標", () => {
    const c = wallRectCenter(NORTH, { u0: 2, u1: 4, v0: 0.8, v1: 2 });
    expect(c[0]).toBeCloseTo(0);
    expect(c[1]).toBeCloseTo(1.4);
    expect(c[2]).toBeCloseTo(-2.5);
  });

  it("offset を渡せる", () => {
    const c = wallRectCenter(SOUTH, { u0: 0, u1: 2, v0: 0, v1: 2 }, 0.05);
    expect(c[0]).toBeCloseTo(2);
    expect(c[1]).toBeCloseTo(1);
    expect(c[2]).toBeCloseTo(2.45);
  });
});

describe("wallRectUv", () => {
  it("壁上の位置をタイルの大きさで割る", () => {
    expect(wallRectUv({ u0: 1, u1: 3, v0: 0.5, v1: 2.4 }, 0.5)).toEqual({
      u0: 2,
      u1: 6,
      v0: 1,
      v1: 4.8,
    });
  });

  it("隣り合う片は境界で同じ UV になり模様がつながる", () => {
    const [left, , bottom] = splitWallAroundOpening(6, 2.4, { u0: 2, u1: 4, v0: 0.8, v1: 2 });
    expect(wallRectUv(left, 0.5).u1).toBe(wallRectUv(bottom, 0.5).u0);
  });
});
