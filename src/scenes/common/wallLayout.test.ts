import { describe, expect, it } from "vitest";
import {
  splitWallAroundOpening,
  splitWallAroundOpenings,
  type WallDef,
  type WallRect,
  wallPointToWorld,
  wallRectCenter,
  wallRectUv,
  wallSpanAt,
  wallUAt,
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

describe("splitWallAroundOpenings", () => {
  function overlaps(a: WallRect, b: WallRect): boolean {
    const ox = Math.min(a.u1, b.u1) - Math.max(a.u0, b.u0);
    const oy = Math.min(a.v1, b.v1) - Math.max(a.v0, b.v0);
    return ox > 1e-12 && oy > 1e-12;
  }

  it("開口部 1 つなら splitWallAroundOpening と同じ片の集合", () => {
    const opening = { u0: 2, u1: 4, v0: 0.8, v1: 2 };
    const a = splitWallAroundOpenings(6, 2.4, [opening]);
    const b = splitWallAroundOpening(6, 2.4, opening);
    expect(a).toHaveLength(b.length);
    expect(a).toEqual(expect.arrayContaining(b));
  });

  it("開口部なしなら壁全体 1 枚", () => {
    expect(splitWallAroundOpenings(6, 2.4, [])).toEqual([{ u0: 0, u1: 6, v0: 0, v1: 2.4 }]);
  });

  it("ドアと窓: 間と両端は全高，開口部の上下は開口部の幅（u の小さい順）", () => {
    const door = { u0: 1, u1: 2, v0: 0, v1: 2 };
    const window = { u0: 3, u1: 5, v0: 0.9, v1: 1.8 };
    const rects = splitWallAroundOpenings(6, 2.4, [window, door]);
    expect(rects).toEqual([
      { u0: 0, u1: 1, v0: 0, v1: 2.4 },
      { u0: 1, u1: 2, v0: 2, v1: 2.4 },
      { u0: 2, u1: 3, v0: 0, v1: 2.4 },
      { u0: 3, u1: 5, v0: 0, v1: 0.9 },
      { u0: 3, u1: 5, v0: 1.8, v1: 2.4 },
      { u0: 5, u1: 6, v0: 0, v1: 2.4 },
    ]);
    for (let i = 1; i < rects.length; i++) {
      expect(rects[i].u0).toBeGreaterThanOrEqual(rects[i - 1].u0);
    }
  });

  it("面積の合計 + 開口部 = 壁全体で，片どうし・開口部とも重ならない", () => {
    const openings = [
      { u0: 0.5, u1: 1.8, v0: 0, v1: 1.85 },
      { u0: 2.2, u1: 4.2, v0: 0.95, v1: 1.75 },
      { u0: 4.6, u1: 5.9, v0: 0, v1: 1.85 },
      { u0: 6.3, u1: 7.3, v0: 0.95, v1: 1.75 },
    ];
    const rects = splitWallAroundOpenings(10, 2.3, openings);
    const area = (r: WallRect) => (r.u1 - r.u0) * (r.v1 - r.v0);
    const total = [...rects, ...openings].reduce((s, r) => s + area(r), 0);
    expect(total).toBeCloseTo(10 * 2.3);
    const all = [...rects, ...openings];
    for (let i = 0; i < all.length; i++) {
      for (let j = i + 1; j < all.length; j++) {
        expect(overlaps(all[i], all[j])).toBe(false);
      }
    }
  });

  it("隣接する開口部・壁の端・床や天井に接する場合は幅 0・高さ 0 の片を含めない", () => {
    const rects = splitWallAroundOpenings(4, 2.4, [
      { u0: 0, u1: 1, v0: 0, v1: 2 },
      { u0: 1, u1: 2, v0: 1, v1: 2.4 },
    ]);
    for (const r of rects) {
      expect(r.u1 - r.u0).toBeGreaterThan(0);
      expect(r.v1 - r.v0).toBeGreaterThan(0);
    }
    expect(rects).toEqual([
      { u0: 0, u1: 1, v0: 2, v1: 2.4 },
      { u0: 1, u1: 2, v0: 0, v1: 1 },
      { u0: 2, u1: 4, v0: 0, v1: 2.4 },
    ]);
  });

  it("渡した配列を並べ替えない", () => {
    const openings = [
      { u0: 3, u1: 4, v0: 1, v1: 2 },
      { u0: 1, u1: 2, v0: 1, v1: 2 },
    ];
    const copy = openings.map((o) => ({ ...o }));
    splitWallAroundOpenings(6, 2.4, openings);
    expect(openings).toEqual(copy);
  });
});

describe("wallUAt / wallSpanAt", () => {
  it("壁上の点は wallPointToWorld の逆変換になる", () => {
    for (const wall of [NORTH, SOUTH]) {
      for (const u of [0, 1.3, 6]) {
        const [x, , z] = wallPointToWorld(wall, u, 1);
        expect(wallUAt(wall, x, z)).toBeCloseTo(u);
      }
    }
  });

  it("壁の線上にない点は線へ射影した位置", () => {
    expect(wallUAt(NORTH, 0, 1)).toBeCloseTo(3);
    expect(wallUAt(SOUTH, 2, -1)).toBeCloseTo(1);
  });

  it("中心と幅から u の範囲を求める", () => {
    const span = wallSpanAt(NORTH, 0, -2.5, 1.3);
    expect(span.u0).toBeCloseTo(2.35);
    expect(span.u1).toBeCloseTo(3.65);
    const s2 = wallSpanAt(SOUTH, 2, 2.5, 0.8);
    expect(s2.u0).toBeCloseTo(0.6);
    expect(s2.u1).toBeCloseTo(1.4);
    expect(s2.u0).toBeLessThan(s2.u1);
  });
});
