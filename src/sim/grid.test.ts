// マス目の位置の計算のテスト．基準は docs/04_SPEC/SPEC_02_校舎データの形式.md「座標」
import { describe, expect, it } from "vitest";
import { createFloorFromRows } from "../share/samples/floorFromRows";
import {
  cellCenter,
  cellIndex,
  isAdjacent,
  isInside,
  kindAt,
  NEIGHBOR_OFFSETS,
  worldToCell,
} from "./grid";

// 幅 3 × 奥行き 2
const floor = createFloorFromRows(1, ["0hd", "eso"]);

describe("isInside", () => {
  it.each([
    [0, 0, true],
    [2, 1, true],
    [3, 0, false],
    [0, 2, false],
    [-1, 0, false],
    [0, -1, false],
  ])("(%d, %d) は %s", (x, z, expected) => {
    expect(isInside(floor, x, z)).toBe(expected);
  });
});

describe("cellIndex", () => {
  it("添字は z * width + x（行ごとの並び）", () => {
    expect(cellIndex(floor, 0, 0)).toBe(0);
    expect(cellIndex(floor, 2, 0)).toBe(2);
    expect(cellIndex(floor, 0, 1)).toBe(3);
    expect(cellIndex(floor, 2, 1)).toBe(5);
  });
});

describe("kindAt", () => {
  it("左上が (0, 0)，x は右，z は下に増える", () => {
    expect(kindAt(floor, 0, 0)).toBe("classroom");
    expect(kindAt(floor, 1, 0)).toBe("corridor");
    expect(kindAt(floor, 2, 0)).toBe("door");
    expect(kindAt(floor, 0, 1)).toBe("exit");
    expect(kindAt(floor, 1, 1)).toBe("shutter");
    expect(kindAt(floor, 2, 1)).toBe("outdoor");
  });

  it("マス目の外は null", () => {
    expect(kindAt(floor, 3, 0)).toBeNull();
    expect(kindAt(floor, -1, 1)).toBeNull();
  });
});

describe("isAdjacent", () => {
  it.each([
    [{ x: 1, z: 1 }, { x: 2, z: 1 }, true],
    [{ x: 1, z: 1 }, { x: 1, z: 0 }, true],
    [{ x: 1, z: 1 }, { x: 1, z: 1 }, false],
    [{ x: 1, z: 1 }, { x: 2, z: 2 }, false],
    [{ x: 1, z: 1 }, { x: 3, z: 1 }, false],
  ])("%o と %o は %s", (a, b, expected) => {
    expect(isAdjacent(a, b)).toBe(expected);
  });
});

describe("NEIGHBOR_OFFSETS", () => {
  it("上下左右の 4 方向だけ", () => {
    expect(NEIGHBOR_OFFSETS).toHaveLength(4);
    for (const d of NEIGHBOR_OFFSETS) expect(Math.abs(d.x) + Math.abs(d.z)).toBe(1);
  });
});

describe("worldToCell・cellCenter", () => {
  it("マス (x, z) の中心は ((x + 0.5) * cellSize, (z + 0.5) * cellSize)", () => {
    expect(cellCenter(1, { x: 2, z: 3 })).toEqual({ x: 2.5, z: 3.5 });
    expect(cellCenter(2, { x: 2, z: 3 })).toEqual({ x: 5, z: 7 });
  });

  it.each([
    [1, 0, 0, 0, 0],
    [1, 0.999, 1.0, 0, 1],
    [1, 2.5, 3.5, 2, 3],
    [2, 3.9, 4.0, 1, 2],
    [1, -0.1, 0.5, -1, 0], // マス目の外でもそのまま返す
  ])("cellSize %d で (%d, %d) m は マス (%d, %d)", (size, wx, wz, x, z) => {
    expect(worldToCell(size, wx, wz)).toEqual({ x, z });
  });

  it("マスの中心はそのマスに戻る", () => {
    for (const size of [0.5, 1, 2]) {
      const c = cellCenter(size, { x: 7, z: 4 });
      expect(worldToCell(size, c.x, c.z)).toEqual({ x: 7, z: 4 });
    }
  });
});
