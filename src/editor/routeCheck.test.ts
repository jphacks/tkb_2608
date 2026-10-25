// 正解経路（E5）の確かめ（routeStepRejection・checkRoute・isEmptyRouteUnreachable）のテスト．
// 基準は docs/04_SPEC/SPEC_02「型」（経路は開始地点から集合場所まで上下左右に隣り合うマスの列）・「壁の自動配置」「通れる・燃え広がる」
// （人は void・wall・マス目の外に入れない．壁をまたぐ経路は validatePlan ではなくエディタが sim/ の関数で確かめる）・
// SPEC_01「結果の評価」（経路が空なら proposeRoute() の提案を使う）・「経路の提案」（経路が無ければ null）．Issue #133
import { describe, expect, it } from "vitest";
import type { CellRef, DrillSetup, SchoolPlan } from "../core/schoolPlan";
import { DEMO_SCHOOL } from "../share/samples/demoSchool";
import { createFloorFromRows } from "../share/samples/floorFromRows";
import { validatePlan } from "../share/validatePlan";
import { canPersonStep, computeSpread, NEIGHBOR_OFFSETS } from "../sim";
import type { CellXZ } from "../sim/grid";
import {
  checkRoute,
  isEmptyRouteUnreachable,
  ROUTE_REASONS,
  routeStepRejection,
} from "./routeCheck";

// テスト用のマス目（5 × 5）:
//   z=0: 教室 教室 教室 廊下 廊下
//   z=1: 教室 教室 教室 ドア 廊下
//   z=2: 廊下 廊下 廊下 廊下 廊下
//   z=3: 柱   出口 柱   柱   何もない
//   z=4: 屋外 屋外 屋外 屋外 屋外
const ROWS = ["000hh", "000dh", "hhhhh", "#e##.", "ooooo"];
/** 出口を柱にして，校庭へ出られなくしたマス目 */
const ENCLOSED_ROWS = ["000hh", "000dh", "hhhhh", "####.", "ooooo"];

const ref = (x: number, z: number, floor = 0): CellRef => ({ floor, x, z });
const at = (x: number, z: number): CellXZ => ({ x, z });

/** 教室のドア → 廊下 → 出口 → 集合場所（壁をまたがない） */
const GOOD_ROUTE: readonly CellRef[] = [
  ref(1, 1),
  ref(2, 1),
  ref(3, 1), // ドア
  ref(3, 2),
  ref(2, 2),
  ref(1, 2),
  ref(1, 3), // 出口
  ref(1, 4),
  ref(2, 4),
  ref(3, 4), // 集合場所
];

const DRILL: DrillSetup = {
  ...DEMO_SCHOOL.drill,
  fireOrigins: [ref(4, 0)],
  start: ref(1, 1),
  assembly: [ref(3, 4)],
  route: GOOD_ROUTE,
};

function testPlan(drill: Partial<DrillSetup> = {}, rows: readonly string[] = ROWS): SchoolPlan {
  return {
    ...DEMO_SCHOOL,
    name: "経路のテスト校舎",
    floors: [createFloorFromRows(1, rows)],
    rooms: [{ name: "1年1組" }],
    drill: { ...DRILL, ...drill },
  };
}
const floor = testPlan().floors[0];
const drillWith = (route: readonly CellRef[]): DrillSetup => ({ ...DRILL, route });

describe("テスト用のデータ", () => {
  it("テスト用の校舎は validatePlan の誤りが無い（以降のテストの前提）", () => {
    expect(validatePlan(testPlan())).toEqual([]);
  });
});

describe("routeStepRejection", () => {
  it("ドアを通って教室から廊下へ進む一歩は置ける（null）", () => {
    expect(routeStepRejection(floor, at(2, 1), at(3, 1))).toBeNull();
    expect(routeStepRejection(floor, at(3, 1), at(3, 2))).toBeNull();
  });

  it("同じ教室の中・廊下の中・出口から屋外への一歩は置ける", () => {
    expect(routeStepRejection(floor, at(1, 1), at(2, 1))).toBeNull();
    expect(routeStepRejection(floor, at(1, 2), at(2, 2))).toBeNull();
    expect(routeStepRejection(floor, at(1, 3), at(1, 4))).toBeNull();
  });

  it("ドアを通らずに教室から廊下へ抜ける一歩は壁の理由", () => {
    expect(routeStepRejection(floor, at(1, 1), at(1, 2))).toBe(
      ROUTE_REASONS.wall(at(1, 1), at(1, 2)),
    );
    expect(routeStepRejection(floor, at(2, 0), at(3, 0))).toBe(
      ROUTE_REASONS.wall(at(2, 0), at(3, 0)),
    );
  });

  it.each<[string, CellXZ, CellXZ]>([
    ["2 マス先", at(1, 1), at(3, 1)],
    ["斜め", at(1, 1), at(2, 2)],
    ["同じマス", at(1, 1), at(1, 1)],
  ])("隣り合わない一歩（%s）は隣り合わない理由", (_label, from, to) => {
    expect(routeStepRejection(floor, from, to)).toBe(ROUTE_REASONS.notAdjacent(from));
  });

  it.each<[string, CellXZ, CellXZ]>([
    ["柱（wall）", at(0, 2), at(0, 3)],
    ["何もない（void）", at(4, 2), at(4, 3)],
    ["マス目の外（左）", at(0, 2), at(-1, 2)],
    ["マス目の外（下）", at(2, 4), at(2, 5)],
  ])("人が入れないマス（%s）への一歩は置けない", (_label, from, to) => {
    expect(routeStepRejection(floor, from, to)).not.toBeNull();
  });

  it("隣り合う一歩はすべて，置けるかが canPersonStep（sim/ の人の規則）と一致する", () => {
    for (let z = 0; z < floor.depth; z++) {
      for (let x = 0; x < floor.width; x++) {
        for (const d of NEIGHBOR_OFFSETS) {
          const from = at(x, z);
          const to = at(x + d.x, z + d.z);
          expect(routeStepRejection(floor, from, to) === null).toBe(canPersonStep(floor, from, to));
        }
      }
    }
  });
});

describe("checkRoute", () => {
  it("経路が空なら empty で，問題は無い（空は生徒側で提案を使うので誤りではない）", () => {
    expect(checkRoute(drillWith([]), 0, floor)).toEqual({
      empty: true,
      startsAtStart: false,
      endsAtAssembly: false,
      badSteps: [],
      problems: [],
    });
  });

  it("開始地点から集合場所まで壁をまたがない経路は問題なし", () => {
    expect(checkRoute(drillWith(GOOD_ROUTE), 0, floor)).toEqual({
      empty: false,
      startsAtStart: true,
      endsAtAssembly: true,
      badSteps: [],
      problems: [],
    });
  });

  it("デモの校舎の経路は問題なし", () => {
    const demoFloor = DEMO_SCHOOL.floors[0];
    const result = checkRoute(DEMO_SCHOOL.drill, 0, demoFloor);
    expect(result.problems).toEqual([]);
    expect(result.badSteps).toEqual([]);
  });

  it("最初のマスが開始地点でないと startsAtStart が false で問題が出る", () => {
    const result = checkRoute(drillWith(GOOD_ROUTE.slice(1)), 0, floor);
    expect(result.startsAtStart).toBe(false);
    expect(result.endsAtAssembly).toBe(true);
    expect(result.problems.length).toBeGreaterThan(0);
  });

  it("最後のマスが集合場所でないと endsAtAssembly が false で問題が出る", () => {
    const result = checkRoute(drillWith(GOOD_ROUTE.slice(0, -1)), 0, floor);
    expect(result.startsAtStart).toBe(true);
    expect(result.endsAtAssembly).toBe(false);
    expect(result.badSteps).toEqual([]);
    expect(result.problems.length).toBe(1);
  });

  it("開始地点だけの経路は集合場所で終わっていない", () => {
    const result = checkRoute(drillWith([ref(1, 1)]), 0, floor);
    expect(result.empty).toBe(false);
    expect(result.startsAtStart).toBe(true);
    expect(result.endsAtAssembly).toBe(false);
  });

  it("集合場所が複数なら，どれかで終われば endsAtAssembly", () => {
    const drill: DrillSetup = { ...drillWith(GOOD_ROUTE), assembly: [ref(4, 4), ref(3, 4)] };
    expect(checkRoute(drill, 0, floor).endsAtAssembly).toBe(true);
  });

  it("ドアを通らず教室から廊下へ抜ける一歩は badSteps にその位置（route[i-1]→route[i] の i）が入る", () => {
    // (1,1) → (1,2) が壁をまたぐ
    const route = [ref(1, 1), ref(1, 2), ref(1, 3), ref(1, 4), ref(2, 4), ref(3, 4)];
    const result = checkRoute(drillWith(route), 0, floor);
    expect(result.badSteps).toEqual([1]);
    expect(result.startsAtStart).toBe(true);
    expect(result.endsAtAssembly).toBe(true);
    expect(result.problems).toHaveLength(1);
  });

  it("隣り合わない一歩（1 マス飛ぶ）は badSteps に入る", () => {
    // (3,1) を抜くと (2,1) → (3,2) が斜め
    const route = GOOD_ROUTE.filter((_, i) => i !== 2);
    const result = checkRoute(drillWith(route), 0, floor);
    expect(result.badSteps).toEqual([2]);
    expect(result.problems).toHaveLength(1);
  });

  it("人の入れないマスへの一歩は badSteps に入る", () => {
    // 廊下 (0,2) から柱 (0,3) へ
    const route = [...GOOD_ROUTE.slice(0, 6), ref(0, 2), ref(0, 3)];
    const result = checkRoute(drillWith(route), 0, floor);
    expect(result.badSteps).toEqual([7]);
  });

  it("最初のマスが人の入れないマスなら問題が出る", () => {
    const result = checkRoute(drillWith([ref(0, 3), ref(0, 4)]), 0, floor);
    expect(result.startsAtStart).toBe(false);
    // 開始地点のずれと，1 マス目の問題
    expect(result.problems.length).toBeGreaterThanOrEqual(2);
  });

  it("別の階のマスがあると問題が出る", () => {
    const route = GOOD_ROUTE.map((r, i) => (i === 4 ? ref(r.x, r.z, 1) : r));
    const result = checkRoute(drillWith(route), 0, floor);
    expect(result.problems.length).toBeGreaterThan(0);
  });

  it("置けない一歩の問題が 3 件を超えると，3 件だけ並べて残りは「ほか n 件」にまとめる（badSteps はすべて）", () => {
    // (1,1) ⇄ (1,2) の往復で，壁をまたぐ一歩が 5 つ．最後は集合場所でない
    const route = [ref(1, 1), ref(1, 2), ref(1, 1), ref(1, 2), ref(1, 1), ref(1, 2)];
    const result = checkRoute(drillWith(route), 0, floor);
    expect(result.badSteps).toEqual([1, 2, 3, 4, 5]);
    expect(result.endsAtAssembly).toBe(false);
    // 集合場所の 1 件 + 一歩の 3 件 + 「ほか 2 件」
    expect(result.problems).toHaveLength(5);
    expect(result.problems[result.problems.length - 1]).toBe("ほか 2 件");
  });

  it("置けない一歩がちょうど 3 件なら「ほか」は出ない", () => {
    const route = [ref(1, 1), ref(1, 2), ref(1, 1), ref(1, 2)];
    const result = checkRoute(drillWith(route), 0, floor);
    expect(result.badSteps).toEqual([1, 2, 3]);
    expect(result.problems.some((p) => p.startsWith("ほか"))).toBe(false);
  });

  it("入力の経路を書き換えない", () => {
    const route = Object.freeze([...GOOD_ROUTE.slice(1)]);
    const drill = Object.freeze(drillWith(route));
    expect(() => checkRoute(drill, 0, floor)).not.toThrow();
    expect(drill.route).toEqual(GOOD_ROUTE.slice(1));
  });
});

describe("isEmptyRouteUnreachable", () => {
  const check = (p: SchoolPlan): boolean => isEmptyRouteUnreachable(p, computeSpread(p));

  it("経路が空でも，提案でたどり着けるなら false", () => {
    expect(check(testPlan({ route: [] }))).toBe(false);
    expect(check({ ...DEMO_SCHOOL, drill: { ...DEMO_SCHOOL.drill, route: [] } })).toBe(false);
  });

  it("経路が空で，提案でもたどり着けない（閉じ込め）なら true", () => {
    expect(check(testPlan({ route: [] }, ENCLOSED_ROWS))).toBe(true);
  });

  it("経路が空で，同じ階に集合場所が無いなら true（提案は null）", () => {
    expect(check(testPlan({ route: [], assembly: [] }))).toBe(true);
  });

  it("経路が空でなければ，たどり着けない校舎でも false", () => {
    expect(check(testPlan({}, ENCLOSED_ROWS))).toBe(false);
    expect(check(testPlan())).toBe(false);
  });
});
