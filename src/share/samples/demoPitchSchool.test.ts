// 発表のデモ用の校舎（DEMO_PITCH_SCHOOL）のテスト．
// 基準は SPEC_01「起動の切り替え」（#p= が無い時の既定の校舎．火元が開始地点の隣の理科室・西の昇降口をふさぐ・
// 防火シャッターのくぐり戸を経路に置く）と SPEC_02（形式・validatePlan）．
// 教室名は [1年1組, 理科室, 1年2組]，火元 (11,0) は理科室，開始地点 (2,2) は 1年1組，正解経路は x = 12 のシャッター (12,7) を通る
import { describe, expect, it } from "vitest";
import type { CellKind, CellRef, Floor } from "../../core/schoolPlan";
import { validatePlan } from "../validatePlan";
import { DEMO_PITCH_SCHOOL, DEMO_PITCH_SCHOOL_ROWS } from "./demoPitchSchool";
import { DEMO_SCHOOL, DEMO_SCHOOL_ROWS } from "./demoSchool";

const plan = DEMO_PITCH_SCHOOL;
const { drill } = plan;

const floorOf = (ref: CellRef): Floor => plan.floors[ref.floor];
const kindOf = (ref: CellRef): CellKind | undefined =>
  floorOf(ref).cells[ref.z * floorOf(ref).width + ref.x];
const roomNameOf = (ref: CellRef): string | undefined =>
  plan.rooms[floorOf(ref).roomOf[ref.z * floorOf(ref).width + ref.x]]?.name;
const key = (ref: CellRef): string => `${ref.floor}:${ref.x},${ref.z}`;

describe("DEMO_PITCH_SCHOOL_ROWS", () => {
  it("19 × 13 で，すべての行の長さがそろっている", () => {
    expect(DEMO_PITCH_SCHOOL_ROWS).toHaveLength(13);
    for (const row of DEMO_PITCH_SCHOOL_ROWS) expect(row).toHaveLength(19);
  });

  it("DEMO_SCHOOL_ROWS との違いは西の昇降口 (2,7) をふさいだことだけ", () => {
    const diffs: string[] = [];
    DEMO_PITCH_SCHOOL_ROWS.forEach((row, z) => {
      for (let x = 0; x < row.length; x++) {
        if (row[x] !== DEMO_SCHOOL_ROWS[z][x]) diffs.push(`${x},${z}`);
      }
    });
    expect(diffs).toEqual(["2,7"]);
    expect(DEMO_SCHOOL.floors[0].cells[7 * 19 + 2]).toBe("exit");
    expect(plan.floors[0].cells[7 * 19 + 2]).toBe("corridor");
  });
});

describe("DEMO_PITCH_SCHOOL", () => {
  it("validatePlan で誤りが無い", () => {
    expect(validatePlan(plan)).toEqual([]);
  });

  it("教室名は [1年1組, 理科室, 1年2組] の順", () => {
    expect(plan.rooms.map((r) => r.name)).toEqual(["1年1組", "理科室", "1年2組"]);
  });

  it("火元は (11,0) の 1 つで，理科室の教室のマス", () => {
    expect(drill.fireOrigins).toEqual([{ floor: 0, x: 11, z: 0 }]);
    const origin = drill.fireOrigins[0];
    expect(kindOf(origin)).toBe("classroom");
    expect(roomNameOf(origin)).toBe("理科室");
  });

  it("開始地点は (2,2) で，1年1組の教室のマス", () => {
    expect(drill.start).toEqual({ floor: 0, x: 2, z: 2 });
    expect(kindOf(drill.start)).toBe("classroom");
    expect(roomNameOf(drill.start)).toBe("1年1組");
  });

  it("理科室は開始地点の 1年1組の隣（同じ並びで東に接する）", () => {
    const floor = plan.floors[0];
    const science = plan.rooms.findIndex((r) => r.name === "理科室");
    const first = plan.rooms.findIndex((r) => r.name === "1年1組");
    // 1年1組のマスの東隣に理科室のマスがある
    let adjacent = false;
    for (let z = 0; z < floor.depth; z++) {
      for (let x = 0; x + 1 < floor.width; x++) {
        const a = floor.roomOf[z * floor.width + x];
        const b = floor.roomOf[z * floor.width + x + 1];
        if (a === first && b === science) adjacent = true;
      }
    }
    expect(adjacent).toBe(true);
  });

  it("正解経路は開始地点から始まり，集合場所で終わる", () => {
    expect(drill.route[0]).toEqual(drill.start);
    expect(drill.assembly.map(key)).toContain(key(drill.route[drill.route.length - 1]));
  });

  it("正解経路は x = 12 の防火シャッターのマス (12,7) を通る", () => {
    expect(drill.route.map(key)).toContain(key({ floor: 0, x: 12, z: 7 }));
    expect(kindOf({ floor: 0, x: 12, z: 7 })).toBe("shutter");
  });

  it("正解経路は上下左右に隣り合うマスで続き，同じマスを 2 度通らない", () => {
    for (let i = 1; i < drill.route.length; i++) {
      const a = drill.route[i - 1];
      const b = drill.route[i];
      expect(Math.abs(a.x - b.x) + Math.abs(a.z - b.z), `${key(a)} → ${key(b)}`).toBe(1);
    }
    expect(new Set(drill.route.map(key)).size).toBe(drill.route.length);
  });

  it("正解経路は出口（東の昇降口）を通って屋外へ出る．西の昇降口は通らない", () => {
    expect(drill.route.some((c) => kindOf(c) === "exit")).toBe(true);
    expect(drill.route.map(key)).not.toContain(key({ floor: 0, x: 2, z: 7 }));
    expect(plan.floors[0].cells.filter((k) => k === "exit")).toHaveLength(1);
  });

  it("集合場所はどれも屋外のマス", () => {
    expect(drill.assembly.length).toBeGreaterThan(0);
    for (const c of drill.assembly) expect(kindOf(c)).toBe("outdoor");
  });
});
