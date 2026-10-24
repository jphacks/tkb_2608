// マスの種類と 1 文字の対応（CELL_KIND_TO_CHAR・CHAR_TO_CELL_KIND・cellsToChars・charsToCells）のテスト．
// 基準は docs/04_SPEC/SPEC_02「URL と QR への埋め込み」の表と「型」の CellKind
import { describe, expect, it } from "vitest";
import type { CellKind } from "../core/schoolPlan";
import { CELL_KIND_TO_CHAR, CHAR_TO_CELL_KIND, cellsToChars, charsToCells } from "./cellChars";

/** SPEC_02 の表の書き写し */
const SPEC_TABLE: readonly (readonly [CellKind, string])[] = [
  ["void", "."],
  ["classroom", "c"],
  ["corridor", "h"],
  ["wall", "#"],
  ["door", "d"],
  ["exit", "e"],
  ["shutter", "s"],
  ["outdoor", "o"],
];

const ALL_KINDS: readonly CellKind[] = SPEC_TABLE.map(([kind]) => kind);

describe("CELL_KIND_TO_CHAR", () => {
  it.each(SPEC_TABLE)("%s は SPEC_02 の表どおり %s", (kind, ch) => {
    expect(CELL_KIND_TO_CHAR[kind]).toBe(ch);
  });

  it("CellKind の 8 種類だけを持ち，文字はすべて違う 1 文字", () => {
    expect(Object.keys(CELL_KIND_TO_CHAR).sort()).toEqual([...ALL_KINDS].sort());
    const chars = Object.values(CELL_KIND_TO_CHAR);
    expect(new Set(chars).size).toBe(chars.length);
    for (const ch of chars) expect(ch).toHaveLength(1);
  });
});

describe("CHAR_TO_CELL_KIND", () => {
  it.each(SPEC_TABLE)("%s の文字 %s は元の種類に戻る", (kind, ch) => {
    expect(CHAR_TO_CELL_KIND.get(ch)).toBe(kind);
  });

  it("表の 8 文字だけを持つ", () => {
    expect(CHAR_TO_CELL_KIND.size).toBe(8);
  });
});

describe("cellsToChars", () => {
  it("空の配列は空の文字列", () => {
    expect(cellsToChars([])).toBe("");
  });

  it("1 マス 1 文字で，配列の並びのまま並べる", () => {
    expect(cellsToChars(ALL_KINDS)).toBe(".ch#deso");
    expect(cellsToChars(["corridor", "corridor", "outdoor"])).toBe("hho");
  });

  it("文字列の長さはマスの数と同じ", () => {
    const cells: CellKind[] = Array.from({ length: 1800 }, (_, i) => ALL_KINDS[i % 8]);
    expect(cellsToChars(cells)).toHaveLength(1800);
  });
});

describe("charsToCells", () => {
  it("空の文字列は空の配列", () => {
    expect(charsToCells("")).toEqual([]);
  });

  it("cellsToChars と往復する（全種類・並びの組み合わせ）", () => {
    const cells: CellKind[] = [];
    for (const a of ALL_KINDS) for (const b of ALL_KINDS) cells.push(a, b);
    expect(charsToCells(cellsToChars(cells))).toEqual(cells);
  });

  it.each([
    ["表に無い英字", "chx"],
    ["大文字", "C"],
    ["数字（教室の添字は表に無い）", "h0h"],
    ["空白", "h h"],
    ["日本語", "廊下"],
    ["絵文字", "h😀"],
  ])("表に無い文字（%s）があると null", (_label, text) => {
    expect(charsToCells(text)).toBeNull();
  });
});
