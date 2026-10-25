// 結果画面の地図の色と凡例（mapStyle.ts）のテスト．
// 基準は docs/04_SPEC/SPEC_01「結果の評価」（正解経路（緑）・自分の経路（青）・外れた区間（橙）・火に近づいた点（赤）を重ねる，
// 煙の中で立っていた区間を地図に示す）と SPEC_02 のマスの種類．
// マス・教室・壁・訓練条件の印の色はエディタ（src/editor/editorStyle.ts）にそろえる（SPEC_01 のモジュール表の debrief/，Issue #175）．
// そろっていることを固定するため，テストからだけエディタの色を import して比べる（本体の debrief/ は editor/ を import しない）
import { describe, expect, it } from "vitest";
import type { CellKind } from "../core/schoolPlan";
import {
  CELL_COLORS as EDITOR_CELL_COLORS,
  EDITOR_COLORS,
  ROOM_COLORS as EDITOR_ROOM_COLORS,
  roomColor as editorRoomColor,
} from "../editor/editorStyle";
import {
  CELL_COLORS,
  cellFillColor,
  MAP_LEGEND,
  OVERLAY_COLORS,
  ROOM_COLORS,
  roomColor,
} from "./mapStyle";

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

describe("ROOM_COLORS", () => {
  it("8 色で重ならず，先頭は教室の色（CELL_COLORS.classroom）", () => {
    expect(ROOM_COLORS).toHaveLength(8);
    expect(new Set(ROOM_COLORS).size).toBe(ROOM_COLORS.length);
    expect(ROOM_COLORS[0]).toBe(CELL_COLORS.classroom);
    for (const c of ROOM_COLORS) expect(c).toMatch(/^#[0-9a-f]{6}$/i);
  });

  it("エディタの ROOM_COLORS と同じ値・同じ並び", () => {
    expect([...ROOM_COLORS]).toEqual([...EDITOR_ROOM_COLORS]);
  });
});

describe("roomColor", () => {
  it.each([0, 1, 2, 3, 4, 5, 6, 7])("添字 %d は ROOM_COLORS のその色", (room) => {
    expect(roomColor(room)).toBe(ROOM_COLORS[room]);
  });

  it.each([
    [8, 0],
    [9, 1],
    [15, 7],
    [16, 0],
    [-1, 7],
    [-8, 0],
    [-9, 7],
  ])("添字 %d は表を巡回して %d 番目の色", (room, index) => {
    expect(roomColor(room)).toBe(ROOM_COLORS[index]);
  });

  it.each([Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY])(
    "数でない添字（%s）は先頭の色",
    (room) => {
      expect(roomColor(room)).toBe(ROOM_COLORS[0]);
    },
  );

  it.each([-17, -9, -1, 0, 1, 2.7, 7, 8, 100, Number.NaN, Number.POSITIVE_INFINITY])(
    "エディタの roomColor と同じ色（%s）",
    (room) => {
      expect(roomColor(room)).toBe(editorRoomColor(room));
    },
  );
});

describe("cellFillColor", () => {
  it("教室は教室ごとの色（roomColor）", () => {
    expect(cellFillColor("classroom", 0)).toBe(ROOM_COLORS[0]);
    expect(cellFillColor("classroom", 3)).toBe(ROOM_COLORS[3]);
    expect(cellFillColor("classroom", 10)).toBe(ROOM_COLORS[2]);
    expect(cellFillColor("classroom", Number.NaN)).toBe(ROOM_COLORS[0]);
  });

  it("隣り合う添字の教室は違う色", () => {
    expect(cellFillColor("classroom", 0)).not.toBe(cellFillColor("classroom", 1));
  });

  it("void は塗らない（null）", () => {
    expect(cellFillColor("void", 0)).toBeNull();
    expect(cellFillColor("void", -1)).toBeNull();
  });

  it.each(CELL_KINDS.filter((k) => k !== "classroom" && k !== "void"))(
    "%s は教室の添字によらず CELL_COLORS の色",
    (kind) => {
      expect(cellFillColor(kind, -1)).toBe(CELL_COLORS[kind]);
      expect(cellFillColor(kind, 3)).toBe(CELL_COLORS[kind]);
    },
  );
});

describe("エディタの見た目との一致", () => {
  it("マスの種類ごとの色はエディタの CELL_COLORS と同じ", () => {
    expect({ ...CELL_COLORS }).toEqual({ ...EDITOR_CELL_COLORS });
  });

  it("下地・マスの境目・void の境目・壁・教室の名前・印の縁取りの色はエディタと同じ", () => {
    expect(OVERLAY_COLORS.background).toBe(EDITOR_COLORS.background);
    expect(OVERLAY_COLORS.grid).toBe(EDITOR_COLORS.grid);
    expect(OVERLAY_COLORS.voidGrid).toBe(EDITOR_COLORS.voidGrid);
    expect(OVERLAY_COLORS.wall).toBe(EDITOR_COLORS.wall);
    expect(OVERLAY_COLORS.label).toBe(EDITOR_COLORS.label);
    expect(OVERLAY_COLORS.markerOutline).toBe(EDITOR_COLORS.markerOutline);
  });

  it("火元の炎（外側・内側）・開始地点・集合場所の色はエディタと同じ", () => {
    expect(OVERLAY_COLORS.fire).toBe(EDITOR_COLORS.fire);
    expect(OVERLAY_COLORS.fireCore).toBe(EDITOR_COLORS.fireCore);
    expect(OVERLAY_COLORS.start).toBe(EDITOR_COLORS.start);
    expect(OVERLAY_COLORS.assembly).toBe(EDITOR_COLORS.assembly);
  });

  it("Issue #175 の火元の色（外側 #e23b2e・内側 #ffb020，白い縁取り）", () => {
    expect(OVERLAY_COLORS.fire.toLowerCase()).toBe("#e23b2e");
    expect(OVERLAY_COLORS.fireCore.toLowerCase()).toBe("#ffb020");
    expect(OVERLAY_COLORS.markerOutline.toLowerCase()).toBe("#ffffff");
  });

  it("正解経路・外れた区間の色はエディタの経路の色と同じ", () => {
    expect(OVERLAY_COLORS.correctRoute).toBe(EDITOR_COLORS.route);
    expect(OVERLAY_COLORS.offRoute).toBe(EDITOR_COLORS.routeBadStep);
  });

  it("火元のマスを半透明で塗る色（fireOrigin）はもう持たない", () => {
    expect(Object.keys(OVERLAY_COLORS)).not.toContain("fireOrigin");
  });
});

describe("MAP_LEGEND の訓練条件の印", () => {
  const item = (label: string) => MAP_LEGEND.find((i) => i.label === label);

  it("火元は炎の形（flame）で，炎の外側の色", () => {
    expect(item("火元")).toEqual({ label: "火元", color: OVERLAY_COLORS.fire, shape: "flame" });
  });

  it("スタートは人の印（person）で，開始地点の色", () => {
    expect(item("スタート")).toEqual({
      label: "スタート",
      color: OVERLAY_COLORS.start,
      shape: "person",
    });
  });

  it("集合場所は枠（frame）で，集合場所の色", () => {
    expect(item("集合場所")).toEqual({
      label: "集合場所",
      color: OVERLAY_COLORS.assembly,
      shape: "frame",
    });
  });

  it("マスを塗る形（cell）・輪（ring）の項目は無い", () => {
    const shapes: readonly string[] = MAP_LEGEND.map((i) => i.shape);
    expect(shapes).not.toContain("cell");
    expect(shapes).not.toContain("ring");
  });

  it("経路・区間・点の 5 項目が先，訓練条件の印の 3 項目が後に並ぶ", () => {
    expect(MAP_LEGEND.map((i) => i.label)).toEqual([
      "正解経路",
      "自分の経路",
      "外れた所",
      "煙の中で立っていた所",
      "火に近づいた所",
      "火元",
      "スタート",
      "集合場所",
    ]);
  });

  it("凡例の色はどれも違う（地図の上で見分けられる）", () => {
    expect(new Set(MAP_LEGEND.map((i) => i.color)).size).toBe(MAP_LEGEND.length);
  });
});
