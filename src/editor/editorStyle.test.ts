// エディタの色のテスト（教室の添字から色を選ぶ roomColor と，道具箱の並び）
import { describe, expect, it } from "vitest";
import type { CellKind } from "../core/schoolPlan";
import { FACINGS, type MarkerKind } from "./editorState";
import {
  CELL_COLORS,
  CELL_KIND_LABELS,
  DRILL_MODES,
  EDITOR_COLORS,
  FACING_LABELS,
  MARKER_LABELS,
  MARKER_TOOLS,
  PART_TOOLS,
  ROOM_COLORS,
  roomColor,
} from "./editorStyle";

describe("roomColor", () => {
  it("教室の添字の順に ROOM_COLORS を使う", () => {
    ROOM_COLORS.forEach((color, i) => {
      expect(roomColor(i)).toBe(color);
    });
  });

  it("隣り合う添字の教室は色が違う", () => {
    for (let i = 0; i < ROOM_COLORS.length * 2; i++) {
      expect(roomColor(i)).not.toBe(roomColor(i + 1));
    }
  });

  it.each<[number, number]>([
    [8, 0],
    [9, 1],
    [15, 7],
    [16, 0],
    [1_000_000_001, 1],
  ])("足りなければ最初に戻る（%s → %s 番目）", (room, index) => {
    expect(ROOM_COLORS).toHaveLength(8);
    expect(roomColor(room)).toBe(ROOM_COLORS[index]);
  });

  it.each<[number, number]>([
    [-1, 7],
    [-8, 0],
    [-9, 7],
    [-17, 7],
  ])("負の数（%s）でも色を返す（%s 番目）", (room, index) => {
    expect(roomColor(room)).toBe(ROOM_COLORS[index]);
  });

  it.each([Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY])(
    "整数にならない添字（%s）は先頭の色",
    (room) => {
      expect(roomColor(room)).toBe(ROOM_COLORS[0]);
    },
  );

  it("小数は整数に切り捨てた添字の色", () => {
    expect(roomColor(1.9)).toBe(ROOM_COLORS[1]);
  });
});

describe("CELL_COLORS / PART_TOOLS / CELL_KIND_LABELS", () => {
  const kinds: CellKind[] = [
    "void",
    "classroom",
    "corridor",
    "wall",
    "door",
    "exit",
    "shutter",
    "outdoor",
  ];

  it("道具箱には教室以外のすべてのパーツが 1 つずつある", () => {
    const toolKinds = PART_TOOLS.map((t) => t.kind);
    expect(new Set(toolKinds).size).toBe(toolKinds.length);
    expect(new Set(toolKinds)).toEqual(new Set(kinds.filter((k) => k !== "classroom")));
  });

  it("void 以外のマスの種類には色と名前がある", () => {
    for (const k of kinds) {
      expect(CELL_KIND_LABELS[k]).toBeTruthy();
      if (k === "void") expect(CELL_COLORS[k]).toBeNull();
      else expect(CELL_COLORS[k]).toMatch(/^#[0-9a-f]{6}$/i);
    }
  });
});

describe("MARKER_TOOLS / MARKER_LABELS / FACING_LABELS", () => {
  const markerKinds: MarkerKind[] = ["fireOrigin", "start", "assembly"];

  it("道具箱には火元・開始地点・集合場所が 1 つずつある", () => {
    const kinds = MARKER_TOOLS.map((t) => t.kind);
    expect(kinds).toHaveLength(3);
    expect(new Set(kinds)).toEqual(new Set(markerKinds));
  });

  it("道具には名前と色見本（#rrggbb）がある．3 つの色は違う", () => {
    for (const t of MARKER_TOOLS) {
      expect(t.label).toBeTruthy();
      expect(t.color).toMatch(/^#[0-9a-f]{6}$/i);
    }
    expect(new Set(MARKER_TOOLS.map((t) => t.color)).size).toBe(3);
  });

  it("道具の色見本は印の色と同じ", () => {
    const byKind = Object.fromEntries(MARKER_TOOLS.map((t) => [t.kind, t.color]));
    expect(byKind.fireOrigin).toBe(EDITOR_COLORS.fire);
    expect(byKind.start).toBe(EDITOR_COLORS.start);
    expect(byKind.assembly).toBe(EDITOR_COLORS.assembly);
  });

  it("印の種類すべてに名前がある", () => {
    for (const k of markerKinds) expect(MARKER_LABELS[k]).toBeTruthy();
  });

  it("上下左右すべてに向きのボタンの文字があり，重ならない", () => {
    for (const f of FACINGS) expect(FACING_LABELS[f]).toBeTruthy();
    expect(new Set(FACINGS.map((f) => FACING_LABELS[f])).size).toBe(4);
  });
});

describe("DRILL_MODES", () => {
  it("学習とテストの 2 つのモードがこの順に 1 つずつある", () => {
    expect(DRILL_MODES.map((m) => m.mode)).toEqual(["learn", "test"]);
  });

  it("どのモードにも名前と説明があり，名前は重ならない", () => {
    for (const m of DRILL_MODES) {
      expect(m.label).toBeTruthy();
      expect(m.hint).toBeTruthy();
    }
    expect(new Set(DRILL_MODES.map((m) => m.label)).size).toBe(DRILL_MODES.length);
  });
});
