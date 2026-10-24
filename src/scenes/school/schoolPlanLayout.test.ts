// SchoolPlan から校舎のパーツの並べ方を求める関数（schoolPlanLayout.ts）のテスト．
// 基準は SPEC_02「座標」「壁の自動配置」（壁の有無は wallBetween() と一致すること）と Issue #92 の完了条件
// （マスの境目に隙間や重なりなく組み上がる）

import { describe, expect, it } from "vitest";
import type { CellKind, Floor, SchoolPlan } from "../../core/schoolPlan";
import { DEMO_SCHOOL } from "../../share/samples/demoSchool";
import { createFloorFromRows } from "../../share/samples/floorFromRows";
import { cellIndex, kindAt } from "../../sim/grid";
import { wallBetween } from "../../sim/walls";
import { DOOR, EXIT, minEdgeLength } from "./schoolLayout";
import {
  type CellRect,
  cellRects,
  SCHOOL_CEILING_HEIGHT,
  type SchoolPlanLayout,
  schoolPlanLayout,
} from "./schoolPlanLayout";

/** マス目（1 文字 1 マス）から校舎を作る．開始地点は start のマス，それ以外の訓練条件はデモと同じ */
function planFromRows(
  rows: readonly string[],
  overrides: { cellSize?: number; start?: { x: number; z: number }; startYaw?: number } = {},
): SchoolPlan {
  const start = overrides.start ?? { x: 0, z: 0 };
  return {
    ...DEMO_SCHOOL,
    cellSize: overrides.cellSize ?? 1,
    floors: [createFloorFromRows(1, rows)],
    drill: {
      ...DEMO_SCHOOL.drill,
      start: { floor: 0, ...start },
      startYaw: overrides.startYaw ?? 0,
    },
  };
}

function cellsOf(rect: CellRect): { x: number; z: number }[] {
  const cells: { x: number; z: number }[] = [];
  for (let z = rect.z0; z < rect.z1; z++) {
    for (let x = rect.x0; x < rect.x1; x++) cells.push({ x, z });
  }
  return cells;
}

/** 矩形の一覧が，条件に合うマスをちょうど 1 回ずつ覆うか（覆った回数の表） */
function coverCount(floor: Floor, rects: readonly CellRect[]): number[] {
  const count = new Array<number>(floor.width * floor.depth).fill(0);
  for (const r of rects) {
    for (const c of cellsOf(r))
      count[cellIndex(floor, c.x, c.z)] = (count[cellIndex(floor, c.x, c.z)] ?? 0) + 1;
  }
  return count;
}

/** 線分を長さ 1 マスの辺に分けた時のキー（"x:line:i" は線 z = line の x = i〜i+1，"z:line:i" は線 x = line の z = i〜i+1） */
function unitEdgeKeys(
  from: { x: number; z: number },
  to: { x: number; z: number },
  cellSize: number,
) {
  const keys: string[] = [];
  if (from.z === to.z) {
    const line = Math.round(from.z / cellSize);
    const a = Math.round(Math.min(from.x, to.x) / cellSize);
    const b = Math.round(Math.max(from.x, to.x) / cellSize);
    for (let i = a; i < b; i++) keys.push(`x:${line}:${i}`);
  } else {
    const line = Math.round(from.x / cellSize);
    const a = Math.round(Math.min(from.z, to.z) / cellSize);
    const b = Math.round(Math.max(from.z, to.z) / cellSize);
    for (let i = a; i < b; i++) keys.push(`z:${line}:${i}`);
  }
  return keys;
}

/** wallBetween() が壁を置くとする辺のキーの一覧（マス目の外との辺を含む） */
function expectedWallKeys(floor: Floor): Set<string> {
  const keys = new Set<string>();
  for (let line = 0; line <= floor.depth; line++) {
    for (let i = 0; i < floor.width; i++) {
      if (wallBetween(floor, { x: i, z: line - 1 }, { x: i, z: line })) keys.add(`x:${line}:${i}`);
    }
  }
  for (let line = 0; line <= floor.width; line++) {
    for (let i = 0; i < floor.depth; i++) {
      if (wallBetween(floor, { x: line - 1, z: i }, { x: line, z: i })) keys.add(`z:${line}:${i}`);
    }
  }
  return keys;
}

const demo = (): SchoolPlanLayout => schoolPlanLayout(DEMO_SCHOOL);
const demoFloor = DEMO_SCHOOL.floors[0] as Floor;

describe("cellRects", () => {
  it("同じキーのマスを重ならない矩形に分け，すべてのマスを 1 回ずつ覆う（L 字）", () => {
    const floor = createFloorFromRows(1, ["hhh", "h..", "hhh"]);
    const rects = cellRects(floor, (x, z) => (kindAt(floor, x, z) === "corridor" ? "h" : null));
    const count = coverCount(
      floor,
      rects.map((r) => r.cells),
    );
    floor.cells.forEach((kind, i) => {
      expect(count[i]).toBe(kind === "corridor" ? 1 : 0);
    });
    // 上の行 3 マス → 左の列の残り → 下の行の残り
    expect(rects.map((r) => r.cells)).toEqual([
      { x0: 0, z0: 0, x1: 3, z1: 1 },
      { x0: 0, z0: 1, x1: 1, z1: 3 },
      { x0: 1, z0: 2, x1: 3, z1: 3 },
    ]);
  });

  it("長方形は 1 つの矩形にまとめる", () => {
    const floor = createFloorFromRows(1, ["00", "00", "00"]);
    const rects = cellRects(floor, () => "a");
    expect(rects).toEqual([{ key: "a", cells: { x0: 0, z0: 0, x1: 2, z1: 3 } }]);
  });

  it("キーが違うマスは別の矩形にする", () => {
    const floor = createFloorFromRows(1, ["01"]);
    const rects = cellRects(floor, (x) => String(x));
    expect(rects.map((r) => r.key)).toEqual(["0", "1"]);
  });

  it("キーがすべて null なら空", () => {
    const floor = createFloorFromRows(1, ["..", ".."]);
    expect(cellRects(floor, () => null)).toEqual([]);
  });
});

describe("schoolPlanLayout（デモの校舎）", () => {
  it("マス目全体の範囲・天井の高さ・マスの大きさ", () => {
    const layout = demo();
    expect(layout.cellSize).toBe(1);
    expect(layout.ceilingHeight).toBe(SCHOOL_CEILING_HEIGHT);
    expect(SCHOOL_CEILING_HEIGHT).toBe(3);
    expect(layout.bounds).toEqual({ minX: 0, maxX: 19, minZ: 0, maxZ: 13 });
  });

  it("屋内の床の面は，教室・廊下・ドア・出口・シャッターのマスをちょうど 1 回ずつ覆う（屋外・柱・void は覆わない）", () => {
    const layout = demo();
    const count = coverCount(
      demoFloor,
      layout.floors.map((f) => f.cells),
    );
    const indoor: ReadonlySet<CellKind> = new Set([
      "classroom",
      "corridor",
      "door",
      "exit",
      "shutter",
    ]);
    demoFloor.cells.forEach((kind, i) => {
      expect(count[i]).toBe(indoor.has(kind) ? 1 : 0);
    });
  });

  it("床の面は 1 つの空間のマスだけをまとめる（教室は教室ごと，ドア等は廊下の見た目）", () => {
    for (const f of demo().floors) {
      const kinds = new Set(cellsOf(f.cells).map((c) => kindAt(demoFloor, c.x, c.z)));
      const rooms = new Set(
        cellsOf(f.cells).map((c) => demoFloor.roomOf[cellIndex(demoFloor, c.x, c.z)]),
      );
      if (f.kind === "classroom") {
        expect([...kinds]).toEqual(["classroom"]);
        expect([...rooms]).toEqual([f.room]);
      } else {
        expect(f.room).toBe(-1);
        expect(kinds.has("classroom")).toBe(false);
      }
      expect(f.rect).toEqual({
        minX: f.cells.x0,
        maxX: f.cells.x1,
        minZ: f.cells.z0,
        maxZ: f.cells.z1,
      });
    }
  });

  it("床の面の id は重ならない", () => {
    const ids = demo().floors.map((f) => f.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("屋外の矩形は屋外のマスをちょうど 1 回ずつ覆う", () => {
    const layout = demo();
    const rects = layout.outdoor.map((r) => ({ x0: r.minX, z0: r.minZ, x1: r.maxX, z1: r.maxZ }));
    const count = coverCount(demoFloor, rects);
    demoFloor.cells.forEach((kind, i) => {
      expect(count[i]).toBe(kind === "outdoor" ? 1 : 0);
    });
  });

  it("マスをふさぐ直方体は wall のマスをちょうど 1 回ずつ覆う", () => {
    const layout = demo();
    const count = coverCount(
      demoFloor,
      layout.blocks.map((b) => b.cells),
    );
    demoFloor.cells.forEach((kind, i) => {
      expect(count[i]).toBe(kind === "wall" ? 1 : 0);
    });
    // x = 12 の z = 0〜5 の柱と，シャッターの下の z = 8 の柱
    expect(layout.blocks.map((b) => b.cells)).toEqual([
      { x0: 12, z0: 0, x1: 13, z1: 6 },
      { x0: 12, z0: 8, x1: 13, z1: 9 },
    ]);
  });

  it("壁は wallBetween() が置くとする辺をちょうど 1 回ずつ覆い，それ以外の辺には置かない（隙間も重なりも無い）", () => {
    const layout = demo();
    const expected = expectedWallKeys(demoFloor);
    const placed: string[] = layout.walls.flatMap((w) => unitEdgeKeys(w.from, w.to, 1));
    expect(new Set(placed).size).toBe(placed.length);
    expect(new Set(placed)).toEqual(expected);
  });

  it("壁はマス目の格子線に沿う（軸に平行で，端は格子点）", () => {
    for (const w of demo().walls) {
      expect(w.from.x === w.to.x || w.from.z === w.to.z).toBe(true);
      for (const v of [w.from.x, w.from.z, w.to.x, w.to.z]) expect(Number.isInteger(v)).toBe(true);
      expect(Math.hypot(w.to.x - w.from.x, w.to.z - w.from.z)).toBeGreaterThan(0);
    }
  });

  it("壁の両端には柱がある．柱は同じ点に 2 本置かない", () => {
    const layout = demo();
    const posts = new Set(layout.posts.map((p) => `${p.x},${p.z}`));
    expect(posts.size).toBe(layout.posts.length);
    for (const w of layout.walls) {
      expect(posts.has(`${w.from.x},${w.from.z}`)).toBe(true);
      expect(posts.has(`${w.to.x},${w.to.z}`)).toBe(true);
    }
  });

  it("壁が交わる点（T 字）で壁を区切る．教室どうしの間の壁（x = 6）と廊下側の壁（z = 6）は (6, 6) で分かれる", () => {
    const layout = demo();
    const touches = layout.walls.filter(
      (w) => (w.from.x === 6 && w.from.z === 6) || (w.to.x === 6 && w.to.z === 6),
    );
    // 西（z = 6 の x = 5〜6），東（x = 6〜7），北（x = 6 の z = 0〜6）の 3 本
    expect(touches).toHaveLength(3);
  });

  it("教室と廊下・廊下と屋外の間は窓付きの壁，教室どうし・void・柱・マス目の外との間は無地の壁", () => {
    const layout = demo();
    const at = (from: { x: number; z: number }, to: { x: number; z: number }) =>
      layout.walls.find(
        (w) => w.from.x === from.x && w.from.z === from.z && w.to.x === to.x && w.to.z === to.z,
      );
    // 1年1組と廊下の間（ドアの西）
    expect(at({ x: 0, z: 6 }, { x: 4, z: 6 })?.kind).toBe("windowWall");
    // 廊下と校庭の間（西の昇降口の西）
    expect(at({ x: 0, z: 8 }, { x: 2, z: 8 })?.kind).toBe("windowWall");
    // 1年1組と 1年2組の間
    expect(at({ x: 6, z: 0 }, { x: 6, z: 6 })?.kind).toBe("wall");
    // マス目の外との間（北の外壁）
    expect(at({ x: 0, z: 0 }, { x: 6, z: 0 })?.kind).toBe("wall");
  });

  it("ドア 3 つ・出口 2 つの開口部の上に垂れ壁を置く（ドアは DOOR.height，出口は EXIT.height から上）", () => {
    const lintels = demo().lintels.map((l) => ({ from: l.from, to: l.to, bottom: l.bottom }));
    expect(lintels).toHaveLength(5);
    expect(lintels).toEqual(
      expect.arrayContaining([
        { from: { x: 4, z: 6 }, to: { x: 5, z: 6 }, bottom: DOOR.height },
        { from: { x: 7, z: 6 }, to: { x: 8, z: 6 }, bottom: DOOR.height },
        { from: { x: 14, z: 6 }, to: { x: 15, z: 6 }, bottom: DOOR.height },
        { from: { x: 2, z: 8 }, to: { x: 3, z: 8 }, bottom: EXIT.height },
        { from: { x: 16, z: 8 }, to: { x: 17, z: 8 }, bottom: EXIT.height },
      ]),
    );
  });

  it("垂れ壁を置く辺には壁を置かない（開口部は通れる）", () => {
    const layout = demo();
    const walls = new Set(layout.walls.flatMap((w) => unitEdgeKeys(w.from, w.to, 1)));
    for (const l of layout.lintels) {
      for (const key of unitEdgeKeys(l.from, l.to, 1)) expect(walls.has(key)).toBe(false);
    }
  });

  it("防火シャッターは x = 12 の 2 マスの中心線に沿う 1 枚（長さ 2 m）．両端に柱を置く", () => {
    const layout = demo();
    expect(layout.shutters).toHaveLength(1);
    const s = layout.shutters[0];
    expect(s?.kind).toBe("fireShutter");
    expect(s?.from).toEqual({ x: 12.5, z: 6 });
    expect(s?.to).toEqual({ x: 12.5, z: 8 });
    expect(s?.cells).toEqual([
      { x: 12, z: 6 },
      { x: 12, z: 7 },
    ]);
    const posts = new Set(layout.posts.map((p) => `${p.x},${p.z}`));
    expect(posts.has("12.5,6")).toBe(true);
    expect(posts.has("12.5,8")).toBe(true);
  });

  it("開始地点は 1年1組の (2, 2) のマスの中心，向きは 0（-Z）", () => {
    expect(demo().start).toEqual({ x: 2.5, z: 2.5, yaw: 0 });
  });
});

describe("schoolPlanLayout（マス目の組み合わせ）", () => {
  it("マスの大きさに比例してワールド座標を広げる", () => {
    const layout = schoolPlanLayout(
      planFromRows(["00", "dh"], { cellSize: 2, start: { x: 1, z: 0 } }),
    );
    expect(layout.bounds).toEqual({ minX: 0, maxX: 4, minZ: 0, maxZ: 4 });
    expect(layout.start).toEqual({ x: 3, z: 1, yaw: 0 });
    for (const f of layout.floors) {
      expect(f.rect.minX).toBe(f.cells.x0 * 2);
      expect(f.rect.maxZ).toBe(f.cells.z1 * 2);
    }
  });

  it("開始時の向きは SchoolPlan（右回り）から Space の約束（左回り）に符号を反転する", () => {
    const layout = schoolPlanLayout(planFromRows(["0"], { startYaw: Math.PI / 2 }));
    expect(layout.start.yaw).toBeCloseTo(-Math.PI / 2);
  });

  it("屋外だけのマス目には壁も天井（屋内の床の面）も置かない", () => {
    const layout = schoolPlanLayout(planFromRows(["oo", "oo"]));
    expect(layout.walls).toEqual([]);
    expect(layout.floors).toEqual([]);
    expect(layout.posts).toEqual([]);
    expect(layout.outdoor).toEqual([{ minX: 0, maxX: 2, minZ: 0, maxZ: 2 }]);
  });

  it("1 マスの教室は四方を壁で囲み，四隅に柱を置く（角で壁を区切る）", () => {
    const layout = schoolPlanLayout(planFromRows(["0"]));
    expect(layout.walls).toHaveLength(4);
    expect(layout.posts.map((p) => `${p.x},${p.z}`).sort()).toEqual(["0,0", "0,1", "1,0", "1,1"]);
  });

  it("1 つだけのシャッターは，左右が通れるなら Z に沿わせる．1 マス（1 m）では下限に足りず壁にする", () => {
    const layout = schoolPlanLayout(planFromRows(["###", "hsh", "###"]));
    expect(layout.shutters).toHaveLength(1);
    const s = layout.shutters[0];
    expect(s?.from).toEqual({ x: 1.5, z: 1 });
    expect(s?.to).toEqual({ x: 1.5, z: 2 });
    expect(minEdgeLength("fireShutter")).toBeGreaterThan(1);
    expect(s?.kind).toBe("wall");
  });

  it("マスが下限より大きければ 1 つだけのシャッターも防火シャッターにする", () => {
    const layout = schoolPlanLayout(planFromRows(["###", "hsh", "###"], { cellSize: 2 }));
    expect(layout.shutters[0]?.kind).toBe("fireShutter");
  });

  it("左右に並ぶシャッターは X に沿う 1 枚にする", () => {
    const layout = schoolPlanLayout(planFromRows(["hhhh", "#ss#", "hhhh"]));
    expect(layout.shutters).toHaveLength(1);
    expect(layout.shutters[0]?.from).toEqual({ x: 1, z: 1.5 });
    expect(layout.shutters[0]?.to).toEqual({ x: 3, z: 1.5 });
  });

  it("壁の列に空いていないドア（両端の辺に壁が無い）には垂れ壁を置かない", () => {
    // ドアが廊下の中にあり，周りに壁の列が無い
    const layout = schoolPlanLayout(planFromRows(["hhh", "hdh", "hhh"]));
    expect(layout.lintels).toEqual([]);
  });

  it("2 マス幅のドアは 1 枚の垂れ壁にまとめる", () => {
    const layout = schoolPlanLayout(planFromRows(["0000", "0dd0", "hhhh"]));
    expect(layout.lintels).toEqual([
      { id: "lintel-0", from: { x: 1, z: 2 }, to: { x: 3, z: 2 }, bottom: DOOR.height },
    ]);
  });

  it("階が無ければ RangeError", () => {
    expect(() => schoolPlanLayout(DEMO_SCHOOL, 1)).toThrow(RangeError);
    expect(() => schoolPlanLayout(DEMO_SCHOOL, -1)).toThrow(RangeError);
  });
});
