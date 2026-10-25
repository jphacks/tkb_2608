// エディタの上から見た図の配置の計算のテスト．
// 基準は docs/04_SPEC/SPEC_02_校舎データの形式.md（座標: x は右，z は下，左上が (0, 0)・「壁の自動配置」は sim/ の wallBetween），Issue #108
import { describe, expect, it } from "vitest";
import type { CellRef, DrillSetup, Floor, Room } from "../core/schoolPlan";
import { DEMO_SCHOOL, DEMO_SCHOOL_ROWS } from "../share/samples/demoSchool";
import { createFloorFromRows } from "../share/samples/floorFromRows";
import { wallBetween } from "../sim/walls";
import {
  assemblyZones,
  canvasToCell,
  computeGridLayout,
  drillMarkers,
  GRID_MARGIN_PX,
  type GridEdge,
  type GridLayout,
  MAX_CELL_PX,
  roomLabels,
  wallEdges,
} from "./editorLayout";

const floor = (rows: readonly string[]): Floor => createFloorFromRows(1, rows);
const size = (width: number, depth: number) => ({ width, depth });

describe("computeGridLayout", () => {
  it("余白を除いた中に収まる最大の整数のマスにし，真ん中に置く", () => {
    // 使える幅 768・高さ 568．19 × 13 マスなら min(40.4, 43.6) → 40 px
    const layout = computeGridLayout(size(19, 13), 800, 600);
    expect(layout).toEqual({ cellPx: 40, offsetX: 20, offsetY: 40 });
  });

  it("マス目は余白の内側に収まる", () => {
    for (const [w, d, cw, ch] of [
      [19, 13, 800, 600],
      [80, 80, 1024, 768],
      [7, 30, 500, 900],
      [33, 5, 1280, 400],
    ]) {
      const l = computeGridLayout(size(w, d), cw, ch);
      expect(Number.isInteger(l.cellPx)).toBe(true);
      expect(l.offsetX).toBeGreaterThanOrEqual(GRID_MARGIN_PX);
      expect(l.offsetY).toBeGreaterThanOrEqual(GRID_MARGIN_PX);
      expect(l.offsetX + l.cellPx * w).toBeLessThanOrEqual(cw - GRID_MARGIN_PX);
      expect(l.offsetY + l.cellPx * d).toBeLessThanOrEqual(ch - GRID_MARGIN_PX);
      // 左右・上下の空きの差は 1 px 以内（真ん中）
      const left = l.offsetX;
      const right = cw - (l.offsetX + l.cellPx * w);
      expect(Math.abs(left - right)).toBeLessThanOrEqual(1);
    }
  });

  it(`小さい校舎でもマスは ${MAX_CELL_PX} px まで`, () => {
    expect(MAX_CELL_PX).toBe(48);
    const l = computeGridLayout(size(2, 2), 800, 600);
    expect(l.cellPx).toBe(48);
    expect(l.offsetX).toBe(Math.floor((800 - 96) / 2));
    expect(l.offsetY).toBe(Math.floor((600 - 96) / 2));
  });

  it.each([
    [10, 10],
    [0, 0],
    [-100, 50],
    [Number.NaN, 600],
  ])("収まらないほど狭い（%s × %s）時も 1 px は確保する", (cw, ch) => {
    expect(computeGridLayout(size(19, 13), cw, ch).cellPx).toBe(1);
  });
});

describe("canvasToCell", () => {
  const f = size(19, 13);
  const layout: GridLayout = computeGridLayout(f, 800, 600);

  it("各マスの中心・左上の角の位置はそのマスに戻る", () => {
    for (let z = 0; z < f.depth; z++) {
      for (let x = 0; x < f.width; x++) {
        const left = layout.offsetX + x * layout.cellPx;
        const top = layout.offsetY + z * layout.cellPx;
        expect(canvasToCell(layout, f, left + layout.cellPx / 2, top + layout.cellPx / 2)).toEqual({
          x,
          z,
        });
        expect(canvasToCell(layout, f, left, top)).toEqual({ x, z });
        expect(
          canvasToCell(layout, f, left + layout.cellPx - 0.01, top + layout.cellPx - 0.01),
        ).toEqual({ x, z });
      }
    }
  });

  it("x は右へ，z は下へ増える（左上が (0, 0)）", () => {
    expect(canvasToCell(layout, f, layout.offsetX, layout.offsetY)).toEqual({ x: 0, z: 0 });
    const right = layout.offsetX + layout.cellPx * 18.5;
    const bottom = layout.offsetY + layout.cellPx * 12.5;
    expect(canvasToCell(layout, f, right, bottom)).toEqual({ x: 18, z: 12 });
  });

  it.each<[string, number, number]>([
    ["左の外", -0.01, 0.5],
    ["上の外", 0.5, -0.01],
    ["右の外（右端の線の上）", 19, 0.5],
    ["下の外（下端の線の上）", 0.5, 13],
    ["遠く", 1000, 1000],
  ])("%s は null", (_, cx, cz) => {
    const px = layout.offsetX + cx * layout.cellPx;
    const py = layout.offsetY + cz * layout.cellPx;
    expect(canvasToCell(layout, f, px, py)).toBeNull();
  });

  it.each([
    [Number.NaN, 100],
    [100, Number.NaN],
    [Number.POSITIVE_INFINITY, 100],
    [-1, -1],
  ])("(%s, %s) は null", (px, py) => {
    expect(canvasToCell(layout, f, px, py)).toBeNull();
  });
});

/** 辺を向きによらない文字列にする（集合で比べるため） */
const edgeKey = (e: GridEdge): string => {
  const a = `${e.x1},${e.z1}`;
  const b = `${e.x2},${e.z2}`;
  return a < b ? `${a}-${b}` : `${b}-${a}`;
};

/** 全マスの上下左右（マス目の外を含む）について wallBetween を直接呼んで，壁の立つ辺を集める */
function expectedWallKeys(f: Floor): Set<string> {
  const keys = new Set<string>();
  for (let z = 0; z < f.depth; z++) {
    for (let x = 0; x < f.width; x++) {
      const a = { x, z };
      // 右の辺（x + 1 の縦線）・左の辺（x の縦線）・下の辺（z + 1 の横線）・上の辺（z の横線）
      if (wallBetween(f, a, { x: x + 1, z }))
        keys.add(edgeKey({ x1: x + 1, z1: z, x2: x + 1, z2: z + 1 }));
      if (wallBetween(f, a, { x: x - 1, z })) keys.add(edgeKey({ x1: x, z1: z, x2: x, z2: z + 1 }));
      if (wallBetween(f, a, { x, z: z + 1 }))
        keys.add(edgeKey({ x1: x, z1: z + 1, x2: x + 1, z2: z + 1 }));
      if (wallBetween(f, a, { x, z: z - 1 })) keys.add(edgeKey({ x1: x, z1: z, x2: x + 1, z2: z }));
    }
  }
  return keys;
}

describe("wallEdges", () => {
  it.each<[string, readonly string[]]>([
    ["デモの校舎", DEMO_SCHOOL_ROWS],
    ["教室と廊下とドア", ["00d1", "hhhh", "#hho"]],
    ["屋外だけ", ["oo", "oo"]],
    ["void と壁だけ", [".#", "#."]],
    ["開口どうし", ["des", "s.e"]],
  ])("%s: wallBetween の結果と一致する（外周も含む）", (_, rows) => {
    const f = floor(rows);
    const edges = wallEdges(f);
    const keys = edges.map(edgeKey);
    // 重複が無い
    expect(new Set(keys).size).toBe(keys.length);
    expect(new Set(keys)).toEqual(expectedWallKeys(f));
    // 線分は長さ 1 の縦か横で，格子の線の上にある
    for (const e of edges) {
      expect(Math.abs(e.x2 - e.x1) + Math.abs(e.z2 - e.z1)).toBe(1);
      for (const v of [e.x1, e.z1, e.x2, e.z2]) expect(Number.isInteger(v)).toBe(true);
    }
  });

  it("教室 1 マスだけなら，マス目の外との 4 辺すべてに壁が立つ", () => {
    const keys = new Set(wallEdges(floor(["0"])).map(edgeKey));
    expect(keys).toEqual(
      new Set(
        [
          { x1: 0, z1: 0, x2: 1, z2: 0 },
          { x1: 0, z1: 1, x2: 1, z2: 1 },
          { x1: 0, z1: 0, x2: 0, z2: 1 },
          { x1: 1, z1: 0, x2: 1, z2: 1 },
        ].map(edgeKey),
      ),
    );
  });

  it("屋外 1 マスだけなら壁は立たない（校庭の端）", () => {
    expect(wallEdges(floor(["o"]))).toEqual([]);
  });

  it("void だけなら壁は立たない", () => {
    expect(wallEdges(floor(["...", "..."]))).toEqual([]);
  });

  it("教室と廊下の間の辺に壁が立ち，同じ教室の中には立たない", () => {
    // 0 0
    // h h
    const keys = new Set(wallEdges(floor(["00", "hh"])).map(edgeKey));
    expect(keys.has(edgeKey({ x1: 0, z1: 1, x2: 1, z2: 1 }))).toBe(true);
    expect(keys.has(edgeKey({ x1: 1, z1: 1, x2: 2, z2: 1 }))).toBe(true);
    expect(keys.has(edgeKey({ x1: 1, z1: 0, x2: 1, z2: 1 }))).toBe(false); // 教室どうし
    expect(keys.has(edgeKey({ x1: 1, z1: 1, x2: 1, z2: 2 }))).toBe(false); // 廊下どうし
  });
});

describe("roomLabels", () => {
  const rooms: Room[] = [{ name: "A" }, { name: "B" }, { name: "C" }];

  it("教室のマスの中心の平均に名前を置く", () => {
    // 0 0 1
    // 0 0 h
    const labels = roomLabels(floor(["001", "00h"]), rooms);
    expect(labels).toEqual([
      { room: 0, name: "A", x: 1, z: 1 },
      { room: 1, name: "B", x: 2.5, z: 0.5 },
    ]);
  });

  it("マスの無い教室は出さない", () => {
    const labels = roomLabels(floor(["2h"]), rooms);
    expect(labels).toEqual([{ room: 2, name: "C", x: 0.5, z: 0.5 }]);
  });

  it("教室が無ければ空", () => {
    expect(roomLabels(floor(["hh"]), [])).toEqual([]);
  });

  it("rooms に無い添字のマスは数えない", () => {
    const labels = roomLabels(floor(["05"]), rooms.slice(0, 1));
    expect(labels).toEqual([{ room: 0, name: "A", x: 0.5, z: 0.5 }]);
  });

  it("デモの校舎では 3 つの教室の名前がそれぞれの教室の中にある", () => {
    const f = DEMO_SCHOOL.floors[0];
    const labels = roomLabels(f, DEMO_SCHOOL.rooms);
    expect(labels.map((l) => l.name)).toEqual(DEMO_SCHOOL.rooms.map((r) => r.name));
    for (const l of labels) {
      const i = Math.floor(l.z) * f.width + Math.floor(l.x);
      expect(f.cells[i]).toBe("classroom");
      expect(f.roomOf[i]).toBe(l.room);
    }
  });
});

describe("drillMarkers", () => {
  const r = (x: number, z: number, f = 0): CellRef => ({ floor: f, x, z });
  // 4 × 3 マスの階
  const f4x3 = floor(["00hh", "01hh", "oooo"]);
  const drill = (d: Partial<DrillSetup>): DrillSetup => ({
    ...DEMO_SCHOOL.drill,
    fireOrigins: [],
    start: r(1, 1),
    assembly: [],
    route: [],
    ...d,
  });

  it("その階のマス目の中の火元・開始地点・集合場所を (x, z) で返す（順番を保つ）", () => {
    const m = drillMarkers(
      drill({ fireOrigins: [r(3, 0), r(0, 0)], start: r(1, 1), assembly: [r(0, 2), r(3, 2)] }),
      0,
      f4x3,
    );
    expect(m.fireOrigins).toEqual([
      { x: 3, z: 0 },
      { x: 0, z: 0 },
    ]);
    expect(m.start).toEqual({ x: 1, z: 1 });
    expect(m.assembly).toEqual([
      { x: 0, z: 2 },
      { x: 3, z: 2 },
    ]);
  });

  it("他の階の物は除く（開始地点は null）", () => {
    const m = drillMarkers(
      drill({ fireOrigins: [r(0, 0, 1), r(1, 0)], start: r(1, 1, 1), assembly: [r(0, 2, 1)] }),
      0,
      f4x3,
    );
    expect(m.fireOrigins).toEqual([{ x: 1, z: 0 }]);
    expect(m.start).toBeNull();
    expect(m.assembly).toEqual([]);
  });

  it("floorIndex の階の物だけを返す（2 階を描く時は 2 階の物）", () => {
    const m = drillMarkers(
      drill({ fireOrigins: [r(0, 0, 0), r(2, 1, 1)], start: r(1, 0, 1) }),
      1,
      f4x3,
    );
    expect(m.fireOrigins).toEqual([{ x: 2, z: 1 }]);
    expect(m.start).toEqual({ x: 1, z: 0 });
  });

  it.each<[number, number]>([
    [-1, 0],
    [0, -1],
    [4, 0],
    [0, 3],
    [0.5, 1],
    [Number.NaN, 0],
    [0, Number.POSITIVE_INFINITY],
  ])("マス目の外・整数でない位置 (%s, %s) は除く", (x, z) => {
    const m = drillMarkers(
      drill({ fireOrigins: [r(x, z)], start: r(x, z), assembly: [r(x, z)] }),
      0,
      f4x3,
    );
    expect(m.fireOrigins).toEqual([]);
    expect(m.start).toBeNull();
    expect(m.assembly).toEqual([]);
  });

  it("マス目の端（右下）は含む", () => {
    const m = drillMarkers(drill({ fireOrigins: [r(3, 2)], start: r(3, 2) }), 0, f4x3);
    expect(m.fireOrigins).toEqual([{ x: 3, z: 2 }]);
    expect(m.start).toEqual({ x: 3, z: 2 });
  });

  it("デモの校舎の印はすべてマス目の中にある", () => {
    const m = drillMarkers(DEMO_SCHOOL.drill, 0, DEMO_SCHOOL.floors[0]);
    expect(m.fireOrigins).toHaveLength(DEMO_SCHOOL.drill.fireOrigins.length);
    expect(m.start).toEqual({ x: DEMO_SCHOOL.drill.start.x, z: DEMO_SCHOOL.drill.start.z });
    expect(m.assembly).toHaveLength(DEMO_SCHOOL.drill.assembly.length);
  });
});

describe("assemblyZones", () => {
  const c = (x: number, z: number) => ({ x, z });
  /** 辺を向きによらず比べられる文字列にする（並び順も問わない） */
  const edgeSet = (edges: readonly GridEdge[]) =>
    edges
      .map((e) => {
        const [a, b] = [`${e.x1},${e.z1}`, `${e.x2},${e.z2}`].sort();
        return `${a}-${b}`;
      })
      .sort();

  it("空なら何も無い", () => {
    expect(assemblyZones([])).toEqual([]);
  });

  it("1 マスは 4 辺の枠と，そのマスの旗", () => {
    const [zone, ...rest] = assemblyZones([c(2, 1)]);
    expect(rest).toEqual([]);
    expect(zone.cells).toEqual([c(2, 1)]);
    expect(zone.flag).toEqual(c(2, 1));
    expect(edgeSet(zone.edges)).toEqual(
      edgeSet([
        { x1: 2, z1: 1, x2: 3, z2: 1 },
        { x1: 2, z1: 2, x2: 3, z2: 2 },
        { x1: 2, z1: 1, x2: 2, z2: 2 },
        { x1: 3, z1: 1, x2: 3, z2: 2 },
      ]),
    );
  });

  it("つながった矩形は 1 つのまとまりで，内側の辺を含まない外周だけを持つ", () => {
    // 3 × 2 マスの矩形（順不同で渡す）
    const cells = [c(3, 3), c(1, 2), c(2, 3), c(3, 2), c(1, 3), c(2, 2)];
    const zones = assemblyZones(cells);
    expect(zones).toHaveLength(1);
    const [zone] = zones;
    expect(zone.cells).toEqual([c(1, 2), c(2, 2), c(3, 2), c(1, 3), c(2, 3), c(3, 3)]);
    expect(zone.flag).toEqual(c(1, 2));
    // 外周の長さ = 2 × (3 + 2) = 10 辺
    expect(zone.edges).toHaveLength(10);
    // 内側の辺（(2, 2) と (2, 3) の間など）は含まない
    expect(edgeSet(zone.edges)).not.toContain("2,3-3,3");
    for (const e of zone.edges) {
      const onBorder = e.x1 === e.x2 ? e.x1 === 1 || e.x1 === 4 : e.z1 === 2 || e.z1 === 4;
      expect(onBorder).toBe(true);
    }
  });

  it("離れたマス・斜めにだけ接するマスは別のまとまり（旗の位置が上・左の順）", () => {
    const zones = assemblyZones([c(5, 0), c(1, 1), c(0, 0), c(6, 0)]);
    expect(zones.map((z) => z.flag)).toEqual([c(0, 0), c(5, 0), c(1, 1)]);
    expect(zones.map((z) => z.cells.length)).toEqual([1, 2, 1]);
  });

  it("L 字のまとまりの旗は最も上の行の最も左のマス", () => {
    const zones = assemblyZones([c(0, 1), c(1, 1), c(2, 1), c(2, 0)]);
    expect(zones).toHaveLength(1);
    expect(zones[0].flag).toEqual(c(2, 0));
    // 外周は 10 辺（4 マス × 4 辺 − 内側の 3 辺 × 2）
    expect(zones[0].edges).toHaveLength(10);
  });

  it("穴のあるまとまりは穴の縁も辺に含む", () => {
    const ring = [c(0, 0), c(1, 0), c(2, 0), c(0, 1), c(2, 1), c(0, 2), c(1, 2), c(2, 2)];
    const [zone] = assemblyZones(ring);
    // 外側 12 辺 + 穴の 4 辺
    expect(zone.edges).toHaveLength(16);
  });

  it("同じマスが重なって入っていても 1 つとして数える", () => {
    const [zone] = assemblyZones([c(1, 1), c(1, 1)]);
    expect(zone.cells).toEqual([c(1, 1)]);
    expect(zone.edges).toHaveLength(4);
  });
});
