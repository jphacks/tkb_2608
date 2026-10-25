// 校舎のエリア（schoolAreas.ts）のテスト．基準は SPEC_01「エリアの ID」の表と，Issue #155 の完了条件
// （集合場所に入った判定と evaluateDrill() の到着の判定のマスが食い違わない）

import { describe, expect, it } from "vitest";
import type { CellRef, SchoolPlan } from "../../core/schoolPlan";
import { DEMO_SCHOOL } from "../../share/samples/demoSchool";
import { createFloorFromRows } from "../../share/samples/floorFromRows";
import { evaluateDrill } from "../../sim/evaluate";
import { computeSpread } from "../../sim/spread";
import { areasAt } from "../walk/areas";
import {
  AREA_EDGE_INSET,
  ASSEMBLY_AREA,
  assemblyCellsOnFloor,
  CORRIDOR_AREA,
  OUTDOOR_AREA,
  roomAreaId,
  schoolPlanAreas,
} from "./schoolAreas";

const at = (x: number, z: number, floor = 0): CellRef => ({ floor, x, z });

/** 小さな校舎（既定は 教室 0・廊下・出口・校庭）．一部だけ上書きできる */
function plan(
  overrides: { rows?: readonly string[]; cellSize?: number; assembly?: readonly CellRef[] } = {},
): SchoolPlan {
  const rows = overrides.rows ?? ["00d0", "hhhh", "#eh#", "oooo"];
  return {
    ...DEMO_SCHOOL,
    cellSize: overrides.cellSize ?? 1,
    floors: [createFloorFromRows(1, rows)],
    rooms: [{ name: "1年1組" }, { name: "1年2組" }],
    drill: {
      ...DEMO_SCHOOL.drill,
      fireOrigins: [at(0, 0)],
      start: at(1, 0),
      assembly: overrides.assembly ?? [at(2, 3)],
      route: [],
    },
  };
}

const ids = (p: SchoolPlan, x: number, z: number) =>
  [...new Set(areasAt(schoolPlanAreas(p), x, z))].sort();

describe("roomAreaId", () => {
  it.each([
    [0, "room:0"],
    [12, "room:12"],
  ])("教室の添字 %i は %s", (index, id) => {
    expect(roomAreaId(index)).toBe(id);
  });
});

describe("schoolPlanAreas", () => {
  it("デモの校舎に SPEC_01 の 4 種類のエリアがそろう", () => {
    const areaIds = new Set(schoolPlanAreas(DEMO_SCHOOL).map((a) => a.id));
    expect([...areaIds].sort()).toEqual(
      [ASSEMBLY_AREA, CORRIDOR_AREA, OUTDOOR_AREA, "room:0", "room:1", "room:2"].sort(),
    );
  });

  it("集合場所の ID は scenario/ の inArea の値と同じ assembly", () => {
    expect(ASSEMBLY_AREA).toBe("assembly");
    expect(CORRIDOR_AREA).toBe("corridor");
    expect(OUTDOOR_AREA).toBe("outdoor");
  });

  it.each([
    ["教室のマス", 0.5, 0.5, ["room:0"]],
    ["ドアのマスはどのエリアでもない", 2.5, 0.5, []],
    ["廊下のマス", 3.5, 1.5, [CORRIDOR_AREA]],
    ["出口のマスはどのエリアでもない", 1.5, 2.5, []],
    ["柱のマスはどのエリアでもない", 0.5, 2.5, []],
    ["屋外のマス", 0.5, 3.5, [OUTDOOR_AREA]],
    ["集合場所のマスは assembly と outdoor の両方", 2.5, 3.5, [ASSEMBLY_AREA, OUTDOOR_AREA]],
    ["マス目の外", 5, 5, []],
  ])("%s", (_, x, z, expected) => {
    expect(ids(plan(), x, z)).toEqual([...expected].sort());
  });

  it("教室ごとに別の room のエリアになる", () => {
    const p = plan({ rows: ["0011", "hhhh"], assembly: [] });
    expect(ids(p, 0.5, 0.5)).toEqual(["room:0"]);
    expect(ids(p, 3.5, 0.5)).toEqual(["room:1"]);
  });

  it("マスの大きさ（cellSize）に合わせて広がる", () => {
    const p = plan({ cellSize: 2 });
    expect(ids(p, 5, 7)).toEqual([ASSEMBLY_AREA, OUTDOOR_AREA]);
    expect(ids(p, 3.9, 7)).toEqual([OUTDOOR_AREA]);
  });

  it("矩形の大きい側は AREA_EDGE_INSET だけ内側に寄せ，小さい側はマスの境界のまま", () => {
    const area = schoolPlanAreas(plan()).find((a) => a.id === ASSEMBLY_AREA);
    expect(area).toEqual({
      id: ASSEMBLY_AREA,
      minX: 2,
      maxX: 3 - AREA_EDGE_INSET,
      minZ: 3,
      maxZ: 4 - AREA_EDGE_INSET,
    });
  });

  it("同じ ID の矩形は重ならない（areasAt が同じ ID を 2 回返さない）", () => {
    const areas = schoolPlanAreas(DEMO_SCHOOL);
    for (let z = 0; z <= 13; z += 0.5) {
      for (let x = 0; x <= 19; x += 0.5) {
        const found = areasAt(areas, x, z);
        expect(new Set(found).size).toBe(found.length);
      }
    }
  });

  it("集合場所が無ければ assembly のエリアは無い", () => {
    const areas = schoolPlanAreas(plan({ assembly: [] }));
    expect(areas.some((a) => a.id === ASSEMBLY_AREA)).toBe(false);
  });

  it("階が無ければ空", () => {
    expect(schoolPlanAreas(plan(), 3)).toEqual([]);
  });
});

describe("assemblyCellsOnFloor", () => {
  it("別の階・マス目の外・整数でないマスは除く", () => {
    const p = plan({
      assembly: [at(2, 3), at(1, 3, 1), at(4, 3), at(-1, 3), at(Number.NaN, 3), at(1.5, 3)],
    });
    expect(assemblyCellsOnFloor(p)).toEqual([at(2, 3)]);
  });

  it("階が無ければ空", () => {
    expect(assemblyCellsOnFloor(plan(), 1)).toEqual([]);
  });
});

describe("集合場所のエリアと evaluateDrill() の到着の判定", () => {
  /** その位置の記録 1 件だけで evaluateDrill() が到着とみなすか */
  function arrivedAt(p: SchoolPlan, x: number, z: number): boolean {
    const spread = computeSpread(p);
    const track = { samples: [{ t: 0, floor: 0, x, z, posture: "standing" as const }] };
    return !evaluateDrill(p, spread, track).lateEscape;
  }

  it.each([
    ["デモの校舎", DEMO_SCHOOL],
    [
      "マスが 2 m の校舎（L 字の集合場所）",
      plan({ cellSize: 2, assembly: [at(1, 3), at(2, 3), at(2, 2)] }),
    ],
  ])("%s: マスの境界の線の上を含め，どの位置でも食い違わない", (_, p) => {
    const areas = schoolPlanAreas(p);
    const floor = p.floors[0];
    const step = p.cellSize / 4;
    const spread = computeSpread(p);
    for (let z = 0; z <= floor.depth * p.cellSize; z += step) {
      for (let x = 0; x <= floor.width * p.cellSize; x += step) {
        const inArea = areasAt(areas, x, z).includes(ASSEMBLY_AREA);
        const track = { samples: [{ t: 0, floor: 0, x, z, posture: "standing" as const }] };
        const arrived = !evaluateDrill(p, spread, track).lateEscape;
        expect({ x, z, inArea }).toEqual({ x, z, inArea: arrived });
      }
    }
  });

  it("マス目の端（屋外の端に押し付けられた位置）では，マス目の外とみなす evaluateDrill() と同じく入らない", () => {
    const p = plan({ assembly: [at(3, 3)] });
    expect(arrivedAt(p, 4, 3.5)).toBe(false);
    expect(areasAt(schoolPlanAreas(p), 4, 3.5)).not.toContain(ASSEMBLY_AREA);
    expect(arrivedAt(p, 3, 3.5)).toBe(true);
    expect(areasAt(schoolPlanAreas(p), 3, 3.5)).toContain(ASSEMBLY_AREA);
  });
});
