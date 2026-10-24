// 結果画面の地図の座標の変換と縮尺（mapLayout.ts）のテスト．
// 基準は docs/04_SPEC/SPEC_02「座標」（マス (x, z) の中心はワールドの ((x + 0.5) * cellSize, (z + 0.5) * cellSize)）と，
// Issue #91 の決定（地図はマスの単位．1 マスは整数 px・最小 1・最大 40 px・余白 8 px）
import { describe, expect, it } from "vitest";
import {
  cellCenter,
  DEFAULT_MAP_FIT,
  fitMapCanvas,
  type MapLayout,
  mapToCanvas,
  worldToMap,
} from "./mapLayout";

describe("worldToMap", () => {
  it("ワールド座標を cellSize で割ってマスの単位にする", () => {
    expect(worldToMap(3, 4, 1)).toEqual({ u: 3, v: 4 });
    expect(worldToMap(3, 4, 2)).toEqual({ u: 1.5, v: 2 });
    expect(worldToMap(0, 0, 0.5)).toEqual({ u: 0, v: 0 });
  });

  it.each([
    [1, 2, 3],
    [0, 0, 1],
    [4, 7, 2.5],
  ])(
    "マス (%d, %d) の中心のワールド座標（cellSize %d）はマスの中心の地図の座標になる",
    (x, z, size) => {
      const point = worldToMap((x + 0.5) * size, (z + 0.5) * size, size);
      expect(point?.u).toBeCloseTo(x + 0.5);
      expect(point?.v).toBeCloseTo(z + 0.5);
      expect(point).not.toBeNull();
      expect(cellCenter({ x, z })).toEqual({ u: x + 0.5, v: z + 0.5 });
    },
  );

  it("マス (x, z) の中のワールドの点は u ∈ [x, x + 1)・v ∈ [z, z + 1) に入る", () => {
    const size = 2;
    for (const [wx, wz] of [
      [6, 8], // マス (3, 4) の左上の角
      [7.99, 9.99], // 右下の角の手前
    ]) {
      const p = worldToMap(wx, wz, size);
      expect(p).not.toBeNull();
      expect(Math.floor(p?.u ?? Number.NaN)).toBe(3);
      expect(Math.floor(p?.v ?? Number.NaN)).toBe(4);
    }
  });

  it("負の座標もそのまま変換する（校舎の外の点）", () => {
    expect(worldToMap(-1, -2, 1)).toEqual({ u: -1, v: -2 });
  });

  it.each([
    [Number.NaN, 0, 1],
    [0, Number.NaN, 1],
    [Number.POSITIVE_INFINITY, 0, 1],
    [0, Number.NEGATIVE_INFINITY, 1],
  ])("座標が有限でない時は null（x=%s, z=%s）", (x, z, size) => {
    expect(worldToMap(x, z, size)).toBeNull();
  });

  it.each([0, -1, Number.NaN, Number.POSITIVE_INFINITY])(
    "cellSize が正の有限の数でない時は null（%s）",
    (size) => {
      expect(worldToMap(1, 1, size)).toBeNull();
    },
  );
});

describe("cellCenter", () => {
  it("マスの中心は (x + 0.5, z + 0.5)", () => {
    expect(cellCenter({ x: 0, z: 0 })).toEqual({ u: 0.5, v: 0.5 });
    expect(cellCenter({ x: 18, z: 12 })).toEqual({ u: 18.5, v: 12.5 });
  });
});

describe("DEFAULT_MAP_FIT", () => {
  it("余白は 8 px・1 マスの上限は 40 px", () => {
    expect(DEFAULT_MAP_FIT).toEqual({ paddingPx: 8, maxCellPx: 40 });
  });
});

describe("fitMapCanvas", () => {
  it("縦横比を保ち，短い側に合わせて最も大きく収める（1 マスは整数の px に切り捨て）", () => {
    // デモの校舎（19 × 13）をスマホの横向き（640 × 350）に: 幅 (640 - 16) / 19 = 32.8，高さ (350 - 16) / 13 = 25.7 → 25
    const fit = fitMapCanvas(19, 13, 640, 350);
    expect(fit.layout.cellPx).toBe(25);
    expect(fit.layout.widthPx).toBe(25 * 19);
    expect(fit.layout.heightPx).toBe(25 * 13);
    expect(fit.layout.offsetX).toBe(8);
    expect(fit.layout.offsetY).toBe(8);
    expect(fit.cssWidth).toBe(25 * 19 + 16);
    expect(fit.cssHeight).toBe(25 * 13 + 16);
  });

  it("幅のほうが狭い時は幅に合わせる", () => {
    // 幅 (116 - 16) / 10 = 10，高さ (1000 - 16) / 10 = 98.4 → 10
    const fit = fitMapCanvas(10, 10, 116, 1000);
    expect(fit.layout.cellPx).toBe(10);
    expect(fit.cssWidth).toBeLessThanOrEqual(116);
    expect(fit.cssHeight).toBeLessThanOrEqual(1000);
  });

  it("収まる大きさのとき Canvas は欄の大きさを超えない", () => {
    for (const [w, d, mw, mh] of [
      [19, 13, 640, 350],
      [7, 3, 333, 201],
      [30, 30, 500, 499],
    ]) {
      const fit = fitMapCanvas(w, d, mw, mh);
      expect(fit.cssWidth).toBeLessThanOrEqual(mw);
      expect(fit.cssHeight).toBeLessThanOrEqual(mh);
      expect(Number.isInteger(fit.layout.cellPx)).toBe(true);
    }
  });

  it("1 マスは 40 px を超えない（広い画面で間延びしない）", () => {
    const fit = fitMapCanvas(2, 2, 2000, 2000);
    expect(fit.layout.cellPx).toBe(40);
    expect(fit.cssWidth).toBe(40 * 2 + 16);
    expect(fit.cssHeight).toBe(40 * 2 + 16);
  });

  it("ちょうど 40 px に収まる時は 40 px", () => {
    expect(fitMapCanvas(1, 1, 56, 56).layout.cellPx).toBe(40);
    expect(fitMapCanvas(1, 1, 55, 56).layout.cellPx).toBe(39);
  });

  it("欄が小さすぎても 1 マスは 1 px より小さくしない", () => {
    expect(fitMapCanvas(100, 100, 50, 50).layout.cellPx).toBe(1);
    // 余白だけで欄を超える時も 1 px
    expect(fitMapCanvas(10, 10, 10, 10).layout.cellPx).toBe(1);
  });

  it("余白と上限は options で変えられる", () => {
    const fit = fitMapCanvas(10, 5, 100, 100, { paddingPx: 0, maxCellPx: 100 });
    expect(fit.layout.cellPx).toBe(10);
    expect(fit.layout.offsetX).toBe(0);
    expect(fit.cssWidth).toBe(100);
    expect(fit.cssHeight).toBe(50);
  });

  it.each([
    ["幅のマスが 0", 0, 13, 640, 350],
    ["奥行きのマスが負", 19, -1, 640, 350],
    ["マスの数が NaN", Number.NaN, 13, 640, 350],
    ["欄の幅が 0", 19, 13, 0, 350],
    ["欄の高さが負", 19, 13, 640, -10],
    ["欄の幅が NaN", 19, 13, Number.NaN, 350],
    ["欄の高さが Infinity", 19, 13, 640, Number.POSITIVE_INFINITY],
  ])("%s の時は 1 マス 0 px（描かない）", (_name, w, d, mw, mh) => {
    const fit = fitMapCanvas(w, d, mw, mh);
    expect(fit.layout.cellPx).toBe(0);
    expect(fit.layout.widthPx).toBe(0);
    expect(fit.layout.heightPx).toBe(0);
    expect(fit.cssWidth).toBe(0);
    expect(fit.cssHeight).toBe(0);
  });
});

describe("mapToCanvas", () => {
  const layout: MapLayout = { cellPx: 20, offsetX: 8, offsetY: 8, widthPx: 380, heightPx: 260 };

  it("offset + 地図の座標 × 1 マスの px", () => {
    expect(mapToCanvas(layout, { u: 0, v: 0 })).toEqual({ x: 8, y: 8 });
    expect(mapToCanvas(layout, { u: 2.5, v: 1.5 })).toEqual({ x: 58, y: 38 });
  });

  it("地図の右下の角は offset + 地図の幅・高さ", () => {
    expect(mapToCanvas(layout, { u: 19, v: 13 })).toEqual({ x: 8 + 380, y: 8 + 260 });
  });

  it("fitMapCanvas の結果と組み合わせると地図の点が Canvas の中に入る", () => {
    const fit = fitMapCanvas(19, 13, 640, 350);
    const p = mapToCanvas(fit.layout, cellCenter({ x: 18, z: 12 }));
    expect(p.x).toBeGreaterThan(0);
    expect(p.x).toBeLessThan(fit.cssWidth);
    expect(p.y).toBeGreaterThan(0);
    expect(p.y).toBeLessThan(fit.cssHeight);
  });
});
