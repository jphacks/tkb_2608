// 結果画面の地図の色と凡例（mapStyle.ts）のテスト．
// 基準は docs/04_SPEC/SPEC_01「結果の評価」（正解経路（緑）・自分の経路（青）・外れた区間（橙）・火に近づいた点（赤）を重ねる，
// 煙の中で立っていた区間を地図に示す）と SPEC_02 のマスの種類
import { describe, expect, it } from "vitest";
import type { CellKind } from "../core/schoolPlan";
import { CELL_COLORS, MAP_LEGEND, OVERLAY_COLORS } from "./mapStyle";

const CELL_KINDS: readonly CellKind[] = [
  "void",
  "classroom",
  "corridor",
  "wall",
  "door",
  "exit",
  "shutter",
  "outdoor",
];

/** #rrggbb の色を [r, g, b] にする */
const rgb = (hex: string): [number, number, number] => {
  const m = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex);
  if (m === null) throw new Error(`#rrggbb ではありません: ${hex}`);
  return [Number.parseInt(m[1], 16), Number.parseInt(m[2], 16), Number.parseInt(m[3], 16)];
};

describe("CELL_COLORS", () => {
  it("すべてのマスの種類に色があり，void だけ塗らない", () => {
    expect(Object.keys(CELL_COLORS).sort()).toEqual([...CELL_KINDS].sort());
    for (const kind of CELL_KINDS) {
      if (kind === "void") expect(CELL_COLORS[kind]).toBeNull();
      else expect(CELL_COLORS[kind]).toMatch(/^#[0-9a-f]{6}$/i);
    }
  });
});

describe("OVERLAY_COLORS", () => {
  it("正解経路は緑（g が最も大きい）", () => {
    const [r, g, b] = rgb(OVERLAY_COLORS.correctRoute);
    expect(g).toBeGreaterThan(r);
    expect(g).toBeGreaterThan(b);
  });

  it("自分の経路は青（b が最も大きい）", () => {
    const [r, g, b] = rgb(OVERLAY_COLORS.ownPath);
    expect(b).toBeGreaterThan(r);
    expect(b).toBeGreaterThan(g);
  });

  it("外れた区間は橙（r が最も大きく，g が b より大きい）", () => {
    const [r, g, b] = rgb(OVERLAY_COLORS.offRoute);
    expect(r).toBeGreaterThan(g);
    expect(g).toBeGreaterThan(b);
  });

  it("火に近づいた点は赤（r が最も大きく，g・b はその半分未満）", () => {
    const [r, g, b] = rgb(OVERLAY_COLORS.nearFire);
    expect(g).toBeLessThan(r / 2);
    expect(b).toBeLessThan(r / 2);
  });

  it("4 つの線・点の色はそれぞれ違う", () => {
    const colors = [
      OVERLAY_COLORS.correctRoute,
      OVERLAY_COLORS.ownPath,
      OVERLAY_COLORS.offRoute,
      OVERLAY_COLORS.nearFire,
    ];
    expect(new Set(colors).size).toBe(4);
  });
});

describe("MAP_LEGEND", () => {
  it("8 項目で，地図に重ねるものをすべて含む", () => {
    expect(MAP_LEGEND).toHaveLength(8);
    expect(MAP_LEGEND.map((i) => i.label)).toEqual(
      expect.arrayContaining([
        "正解経路",
        "自分の経路",
        "外れた所",
        "煙の中で立っていた所",
        "火に近づいた所",
      ]),
    );
  });

  it("凡例の色は地図に重ねる色と同じ", () => {
    const colorOf = (label: string): string | undefined =>
      MAP_LEGEND.find((i) => i.label === label)?.color;
    expect(colorOf("正解経路")).toBe(OVERLAY_COLORS.correctRoute);
    expect(colorOf("自分の経路")).toBe(OVERLAY_COLORS.ownPath);
    expect(colorOf("外れた所")).toBe(OVERLAY_COLORS.offRoute);
    expect(colorOf("煙の中で立っていた所")).toBe(OVERLAY_COLORS.smokeStanding);
    expect(colorOf("火に近づいた所")).toBe(OVERLAY_COLORS.nearFire);
  });

  it("項目名は重ならない", () => {
    expect(new Set(MAP_LEGEND.map((i) => i.label)).size).toBe(MAP_LEGEND.length);
  });
});
