// 正解経路の提案（proposeRoute）のテスト．
// 基準は PLAN_04 の E5（延焼を考慮して火と煙を避けた最短の避難経路），SPEC_02「通れる・燃え広がる」
// （人は燃えているマスに入れない）・「型」（route は開始地点から集合場所まで上下左右に隣り合うマスの列），
// SPEC_01「VR 避難の規則」（② は最長 8 秒・歩く速さの倍率 1.5）
import { describe, expect, it } from "vitest";
import type { CellRef, DrillSetup, SchoolPlan, SpreadSettings } from "../core/schoolPlan";
import { DEMO_SCHOOL } from "../share/samples/demoSchool";
import { createFloorFromRows } from "../share/samples/floorFromRows";
import { isAdjacent } from "./grid";
import { ROUTE_DEPART_SECONDS, ROUTE_FIRE_MARGIN_SECONDS, ROUTE_WALK_SPEED } from "./params";
import { proposeRoute } from "./route";
import { computeSpread, type SpreadMap } from "./spread";
import { canPersonStep } from "./walls";

const at = (x: number, z: number, floor = 0): CellRef => ({ floor, x, z });
const key = (c: CellRef): string => `${c.floor}:${c.x},${c.z}`;
const has = (route: readonly CellRef[], cell: CellRef): boolean =>
  route.some((c) => key(c) === key(cell));
const indexOf = (route: readonly CellRef[], cell: CellRef): number =>
  route.findIndex((c) => key(c) === key(cell));

interface PlanOverrides extends Partial<Omit<DrillSetup, "spread">> {
  readonly spread?: Partial<SpreadSettings>;
  readonly floors?: number;
}

function makePlan(rows: readonly string[], overrides: PlanOverrides = {}): SchoolPlan {
  const { spread, floors = 1, ...drill } = overrides;
  return {
    version: 1,
    name: "テスト校舎",
    cellSize: 1,
    floors: Array.from({ length: floors }, (_, i) => createFloorFromRows(i + 1, rows)),
    rooms: [{ name: "教室A" }, { name: "教室B" }],
    drill: {
      mode: "learn",
      fireOrigins: [],
      start: at(0, 0),
      startYaw: 0,
      assembly: [],
      route: [],
      timeLimitSeconds: 150,
      ...drill,
      spread: { fireSecondsPerCell: 6, smokeSecondsPerCell: 2, extraFires: [], ...spread },
    },
  };
}

/**
 * 経路が仕様どおりの形か: 最初が開始地点，最後が集合場所，上下左右に隣り合い，人が移れる辺だけを通り，
 * k 歩目のマスに着く時刻（departSeconds + k * cellSize / walkSpeed）にそのマスが燃えていない
 */
function expectValidRoute(
  plan: SchoolPlan,
  spread: SpreadMap,
  route: readonly CellRef[] | null,
  {
    start = plan.drill.start,
    departSeconds = ROUTE_DEPART_SECONDS,
    walkSpeed = ROUTE_WALK_SPEED,
  }: { start?: CellRef; departSeconds?: number; walkSpeed?: number } = {},
): asserts route is readonly CellRef[] {
  expect(route).not.toBeNull();
  if (route === null) return;
  expect(key(route[0])).toBe(key(start));
  expect(plan.drill.assembly.map(key)).toContain(key(route[route.length - 1]));
  const floor = plan.floors[start.floor];
  for (let k = 1; k < route.length; k++) {
    expect(route[k].floor).toBe(start.floor);
    expect(isAdjacent(route[k - 1], route[k])).toBe(true);
    expect(canPersonStep(floor, route[k - 1], route[k])).toBe(true);
    const t = departSeconds + (k * plan.cellSize) / walkSpeed;
    expect(spread.fireAt(route[k])).toBeGreaterThan(t);
  }
  // 集合場所に着いたら終わる（途中に集合場所を含まない）
  const assembly = new Set(plan.drill.assembly.map(key));
  for (let k = 0; k < route.length - 1; k++) expect(assembly.has(key(route[k]))).toBe(false);
}

// 廊下（z=0）の西と東に昇降口（z=1），その下に校庭（z=2）．開始は廊下の (2, 0)，集合場所は (4, 2)
const TWO_EXITS = ["hhhhhhhhh", "e#######e", "ooooooooo"];
const twoExits = (overrides: PlanOverrides = {}): SchoolPlan =>
  makePlan(TWO_EXITS, { start: at(2, 0), assembly: [at(4, 2)], ...overrides });

describe("proposeRoute", () => {
  describe("経路の形", () => {
    it("火が無ければ最短（歩数が最も少ない）の経路で，西の昇降口を通る", () => {
      const plan = twoExits();
      const spread = computeSpread(plan);
      const route = proposeRoute(plan, spread);
      expectValidRoute(plan, spread, route);
      // (2,0) → (0,0) → (0,1) → (0,2) → (4,2) の 8 歩
      expect(route).toHaveLength(9);
      expect(has(route, at(0, 1))).toBe(true);
    });

    it("どれかの集合場所に着けばよい（近いほうに着く）", () => {
      const plan = twoExits({ assembly: [at(8, 2), at(1, 2)] });
      const spread = computeSpread(plan);
      const route = proposeRoute(plan, spread);
      expectValidRoute(plan, spread, route);
      expect(key(route[route.length - 1])).toBe(key(at(1, 2)));
    });

    it("教室からはドアを通り，壁を抜けない", () => {
      // z=0 が教室 0，z=1 の x=0 がドアで残りが廊下，z=2 の x=0 が昇降口
      const plan = makePlan(["0000", "dhhh", "e###", "oooo"], {
        start: at(1, 0),
        assembly: [at(3, 3)],
      });
      const spread = computeSpread(plan);
      const route = proposeRoute(plan, spread);
      expectValidRoute(plan, spread, route);
      expect(has(route, at(0, 1))).toBe(true);
    });

    it("同じ条件からは毎回同じ経路（決定的）", () => {
      const spread = computeSpread(DEMO_SCHOOL);
      expect(proposeRoute(DEMO_SCHOOL, spread)).toEqual(proposeRoute(DEMO_SCHOOL, spread));
    });
  });

  describe("火と煙を避ける", () => {
    it("火が最短路（西の昇降口の側）を塞ぐと，東の昇降口へ回る", () => {
      const plan = twoExits({
        fireOrigins: [at(0, 0)],
        spread: { fireSecondsPerCell: 30, smokeSecondsPerCell: 30 },
      });
      const spread = computeSpread(plan);
      const route = proposeRoute(plan, spread);
      expectValidRoute(plan, spread, route);
      expect(has(route, at(0, 0))).toBe(false);
      expect(has(route, at(0, 1))).toBe(false);
      expect(has(route, at(8, 1))).toBe(true);
    });

    it("同じ歩数の 2 つの道があれば，煙の着いた側を避ける", () => {
      // 開始 (2,0) から西 (0,1)・東 (4,1) の昇降口まで同じ歩数．火元は東の遠く（11,0）で，煙だけが東から来る
      const plan = makePlan(["hhhhhhhhhhhh", "e###e#######", "oooooooooooo"], {
        start: at(2, 0),
        assembly: [at(2, 2)],
        fireOrigins: [at(11, 0)],
        spread: { fireSecondsPerCell: 1000, smokeSecondsPerCell: 1 },
      });
      const spread = computeSpread(plan);
      const route = proposeRoute(plan, spread);
      expectValidRoute(plan, spread, route);
      expect(has(route, at(0, 1))).toBe(true);
      expect(has(route, at(4, 1))).toBe(false);
    });

    it("唯一の出口が燃えていれば経路は無い（null）", () => {
      const plan = makePlan(["hhe", "##o"], {
        start: at(0, 0),
        assembly: [at(2, 1)],
        fireOrigins: [at(2, 0)],
      });
      expect(proposeRoute(plan, computeSpread(plan))).toBeNull();
    });
  });

  describe("経路が無い（null）", () => {
    it("ドアの無い教室からは出られない", () => {
      const plan = makePlan(["000", "hhh", "e##", "ooo"], {
        start: at(1, 0),
        assembly: [at(1, 3)],
      });
      expect(proposeRoute(plan, computeSpread(plan))).toBeNull();
    });

    it("集合場所が無い", () => {
      const plan = twoExits({ assembly: [] });
      expect(proposeRoute(plan, computeSpread(plan))).toBeNull();
    });

    it("集合場所が開始地点と別の階にしか無い（段階 1 は 1 フロア）", () => {
      const plan = twoExits({ floors: 2, assembly: [at(4, 2, 1)] });
      expect(proposeRoute(plan, computeSpread(plan))).toBeNull();
    });

    it("開始地点がマス目の外・無い階なら例外を投げず null", () => {
      const plan = twoExits();
      const spread = computeSpread(plan);
      expect(proposeRoute(plan, spread, { start: at(20, 0) })).toBeNull();
      expect(proposeRoute(plan, spread, { start: at(-1, 0) })).toBeNull();
      expect(proposeRoute(plan, spread, { start: at(2, 0, 5) })).toBeNull();
    });
  });

  describe("条件（RouteOptions）", () => {
    it("開始地点が既に集合場所なら，そのマスだけの経路", () => {
      const plan = twoExits();
      const spread = computeSpread(plan);
      expect(proposeRoute(plan, spread, { start: at(4, 2) })).toEqual([at(4, 2)]);
    });

    it("start を渡すと plan.drill.start ではなくそこから求める", () => {
      const plan = twoExits();
      const spread = computeSpread(plan);
      const route = proposeRoute(plan, spread, { start: at(7, 0) });
      expectValidRoute(plan, spread, route, { start: at(7, 0) });
      expect(has(route, at(8, 1))).toBe(true); // 東の昇降口のほうが近い
    });

    // 火が後ろから 1 マス 1 秒で追ってくる廊下．開始 (1,0)，昇降口 (4,0)，集合場所 (4,1)
    const chase = makePlan(["hhhhe", "####o"], {
      start: at(1, 0),
      assembly: [at(4, 1)],
      fireOrigins: [at(0, 0)],
      spread: { fireSecondsPerCell: 1, smokeSecondsPerCell: 1 },
    });
    const chaseSpread = computeSpread(chase);

    it("歩く速さが火より速ければ逃げ切れる経路を返す", () => {
      const options = { departSeconds: 0, walkSpeed: 1.5 };
      const route = proposeRoute(chase, chaseSpread, options);
      expectValidRoute(chase, chaseSpread, route, options);
    });

    it("walkSpeed を遅くすると，着いた時に燃えているマスばかりになり経路は無い", () => {
      expect(proposeRoute(chase, chaseSpread, { departSeconds: 0, walkSpeed: 0.5 })).toBeNull();
    });

    it("departSeconds を遅くすると，火に追いつかれて経路は無い", () => {
      expect(proposeRoute(chase, chaseSpread, { departSeconds: 2, walkSpeed: 1.5 })).toBeNull();
    });

    it("既定は 8 秒に出発・1.5 m/s（SPEC_01 の ② の最長と校舎用の倍率）", () => {
      expect(ROUTE_DEPART_SECONDS).toBe(8);
      expect(ROUTE_WALK_SPEED).toBe(1.5);
      const plan = twoExits({
        fireOrigins: [at(0, 0)],
        spread: { fireSecondsPerCell: 30, smokeSecondsPerCell: 30 },
      });
      const spread = computeSpread(plan);
      expect(proposeRoute(plan, spread)).toEqual(
        proposeRoute(plan, spread, { departSeconds: 8, walkSpeed: 1.5 }),
      );
    });
  });

  describe("デモの校舎", () => {
    const spread = computeSpread(DEMO_SCHOOL);
    const science = at(14, 2);

    it("1年1組 (2, 2) からは西の昇降口 (2, 7) を通って集合場所 (8, 10) へ", () => {
      const route = proposeRoute(DEMO_SCHOOL, spread);
      expectValidRoute(DEMO_SCHOOL, spread, route);
      expect(has(route, at(4, 5))).toBe(true); // 1年1組のドア
      expect(has(route, at(2, 7))).toBe(true);
      expect(has(route, at(16, 7))).toBe(false);
      expect(key(route[route.length - 1])).toBe(key(at(8, 10)));
      // 教員の経路（plan.drill.route）と同じく最短の歩数
      expect(route).toHaveLength(DEMO_SCHOOL.drill.route.length);
    });

    it("理科室 (14, 2) からは (14, 6) → (12, 6) と西へ進み，西の昇降口から出る", () => {
      const route = proposeRoute(DEMO_SCHOOL, spread, { start: science });
      expectValidRoute(DEMO_SCHOOL, spread, route, { start: science });
      const i146 = indexOf(route, at(14, 6));
      const i136 = indexOf(route, at(13, 6));
      const i126 = indexOf(route, at(12, 6));
      expect(i146).toBeGreaterThan(0);
      expect(i136).toBe(i146 + 1);
      expect(i126).toBe(i146 + 2);
      expect(has(route, at(2, 7))).toBe(true);
      expect(has(route, at(16, 7))).toBe(false); // 火元の側の東の昇降口は使わない
    });

    /** 余裕の秒数のうちに燃えるマスを通るか（通るなら余裕ありでは着けず，余裕なしで探し直した経路） */
    const usesNoMargin = (route: readonly CellRef[], departSeconds: number): boolean =>
      route.some((cell, k) => {
        if (k === 0) return false;
        const t = departSeconds + k / ROUTE_WALK_SPEED;
        return spread.fireAt(cell) <= t + ROUTE_FIRE_MARGIN_SECONDS;
      });

    it("1年1組からの経路は，どのマスにも着いてから余裕の秒数より後にしか火が来ない", () => {
      const route = proposeRoute(DEMO_SCHOOL, spread);
      expect(route).not.toBeNull();
      expect(usesNoMargin(route ?? [], ROUTE_DEPART_SECONDS)).toBe(false);
    });

    it("理科室は隣のマスがすべて 18 秒に燃えるため，既定の 8 秒の出発でも余裕なしで探し直した経路になる", () => {
      for (const cell of [at(14, 1), at(13, 2), at(14, 3)]) expect(spread.fireAt(cell)).toBe(18);
      const route = proposeRoute(DEMO_SCHOOL, spread, { start: science });
      expectValidRoute(DEMO_SCHOOL, spread, route, { start: science });
      expect(usesNoMargin(route, ROUTE_DEPART_SECONDS)).toBe(true);
    });

    it("理科室から 17 秒に出発すると，余裕なしで探し直した経路を返す", () => {
      const departSeconds = 17;
      const route = proposeRoute(DEMO_SCHOOL, spread, { start: science, departSeconds });
      expectValidRoute(DEMO_SCHOOL, spread, route, { start: science, departSeconds });
      expect(usesNoMargin(route, departSeconds)).toBe(true);
    });

    it.each([18, 20, 60])("理科室から %d 秒に出発すると経路は無い（null）", (departSeconds) => {
      expect(proposeRoute(DEMO_SCHOOL, spread, { start: science, departSeconds })).toBeNull();
    });

    it("1年1組は火が届かないので，遅く出発しても経路は変わらない", () => {
      const base = proposeRoute(DEMO_SCHOOL, spread);
      expect(proposeRoute(DEMO_SCHOOL, spread, { departSeconds: 17 })).toEqual(base);
      expect(proposeRoute(DEMO_SCHOOL, spread, { departSeconds: 100 })).toEqual(base);
    });
  });
});
