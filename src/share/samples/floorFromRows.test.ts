// createFloorFromRows（1 文字 1 マスの行から Floor を作る）のテスト．
// 基準は docs/04_SPEC/SPEC_02「座標」（添字は z * width + x）・「型」（長さ width * depth・教室以外の roomOf は -1）・
// 「URL と QR への埋め込み」の 1 マス 1 文字の表
import { describe, expect, it } from "vitest";
import type { CellKind } from "../../core/schoolPlan";
import { createFloorFromRows, ROW_CHAR_TO_KIND } from "./floorFromRows";

describe("ROW_CHAR_TO_KIND", () => {
  it.each<[string, CellKind]>([
    [".", "void"],
    ["h", "corridor"],
    ["#", "wall"],
    ["d", "door"],
    ["e", "exit"],
    ["s", "shutter"],
    ["o", "outdoor"],
  ])("文字 %s は SPEC_02 の表どおり %s", (ch, kind) => {
    expect(ROW_CHAR_TO_KIND[ch]).toBe(kind);
  });

  it("教室以外の 7 種類だけを持つ（教室は数字で書く）", () => {
    expect(Object.keys(ROW_CHAR_TO_KIND).sort()).toEqual(
      [".", "#", "d", "e", "h", "o", "s"].sort(),
    );
    expect(Object.values(ROW_CHAR_TO_KIND)).not.toContain("classroom");
  });
});

describe("createFloorFromRows", () => {
  it("幅は行の長さ，奥行きは行の数，階は引数のまま", () => {
    const floor = createFloorFromRows(2, ["0hh", "deo", "..#", "s1h"]);
    expect(floor.level).toBe(2);
    expect(floor.width).toBe(3);
    expect(floor.depth).toBe(4);
  });

  it("cells と roomOf の長さは width * depth", () => {
    const floor = createFloorFromRows(1, ["0hh", "deo", "..#", "s1h"]);
    expect(floor.cells).toHaveLength(12);
    expect(floor.roomOf).toHaveLength(12);
  });

  it("(x, z) のマスは添字 z * width + x に入る（上の行が z = 0，左の文字が x = 0）", () => {
    const rows = ["0h.", "#de", "so1"];
    const floor = createFloorFromRows(1, rows);
    const expected: Record<string, CellKind> = {
      "0": "classroom",
      "1": "classroom",
      ...ROW_CHAR_TO_KIND,
    };
    for (let z = 0; z < rows.length; z++) {
      for (let x = 0; x < rows[z].length; x++) {
        expect(floor.cells[z * floor.width + x]).toBe(expected[rows[z][x]]);
      }
    }
    // 非正方形でも x と z を取り違えない
    const wide = createFloorFromRows(1, ["hhhh", "ooo0"]);
    expect(wide.cells[1 * 4 + 3]).toBe("classroom");
    expect(wide.roomOf[1 * 4 + 3]).toBe(0);
    expect(wide.cells[0 * 4 + 3]).toBe("corridor");
  });

  it.each(["0", "1", "5", "9"])("数字 %s は教室で，roomOf がその数字", (digit) => {
    const floor = createFloorFromRows(1, [`h${digit}`]);
    expect(floor.cells[1]).toBe("classroom");
    expect(floor.roomOf[1]).toBe(Number(digit));
  });

  it("教室以外のマスの roomOf はすべて -1", () => {
    const floor = createFloorFromRows(1, [".h#deso"]);
    expect(floor.roomOf).toEqual([-1, -1, -1, -1, -1, -1, -1]);
  });

  it("教室のマスと教室以外のマスが混ざっても，それぞれ正しい roomOf になる", () => {
    const floor = createFloorFromRows(1, ["00#11", "0d#d1", "hhhhh"]);
    expect(floor.roomOf).toEqual([0, 0, -1, 1, 1, 0, -1, -1, -1, 1, -1, -1, -1, -1, -1]);
    floor.cells.forEach((kind, i) => {
      expect(floor.roomOf[i] >= 0).toBe(kind === "classroom");
    });
  });

  it("行が無ければ 0 × 0 の Floor", () => {
    const floor = createFloorFromRows(1, []);
    expect(floor.width).toBe(0);
    expect(floor.depth).toBe(0);
    expect(floor.cells).toEqual([]);
    expect(floor.roomOf).toEqual([]);
  });

  it("1 マスだけでも作れる", () => {
    expect(createFloorFromRows(1, ["o"])).toEqual({
      level: 1,
      width: 1,
      depth: 1,
      cells: ["outdoor"],
      roomOf: [-1],
    });
  });

  it.each([
    ["2 行目が短い", ["hhh", "hh"]],
    ["2 行目が長い", ["hhh", "hhhh"]],
    ["途中の行が空", ["hhh", "", "hhh"]],
    ["最後の行だけ違う", ["hh", "hh", "h"]],
  ])("行の長さがそろっていない（%s）と Error", (_label, rows) => {
    expect(() => createFloorFromRows(1, rows)).toThrow(Error);
  });

  it.each([
    ["c（教室は数字で書く）", "hc"],
    ["空白", "h h"],
    ["大文字", "H"],
    ["知らない記号", "h*"],
    ["全角数字", "h０"],
    ["マイナス", "-1"],
  ])("知らない文字（%s）があると Error", (_label, row) => {
    expect(() => createFloorFromRows(1, [row])).toThrow(Error);
  });
});
