// 生徒側で使う正解経路を校舎に入れる withResolvedRoute のテスト．
// 基準は docs/04_SPEC/SPEC_01「結果の評価」（教員が決めた経路 plan.drill.route があればそれを使い，空なら proposeRoute() の提案を使う．
// どれを使ったかは resolveReferenceRoute() で引ける）・「経路の提案」（経路が無ければ null）と，Issue #133 で決めた仕様変更
// （app/ が校舎を読んだ直後に空の経路を埋めて Session.plan に書く．空でない時・提案でも着けない時は同じ参照）
import { describe, expect, it } from "vitest";
import type { CellRef, DrillSetup, SchoolPlan } from "../core/schoolPlan";
import { DEMO_SCHOOL, DEMO_SCHOOL_ROWS } from "../share/samples/demoSchool";
import { createFloorFromRows } from "../share/samples/floorFromRows";
import { validatePlan } from "../share/validatePlan";
import { canPersonStep, computeSpread, proposeRoute, resolveReferenceRoute } from "../sim";
import { withResolvedRoute } from "./resolvedRoute";

/** 入れ子のオブジェクト・配列をすべて凍らせる（書き換えようとすると strict mode で例外になる） */
function deepFreeze<T>(value: T): T {
  if (value !== null && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const v of Object.values(value as object)) deepFreeze(v);
  }
  return value;
}

const demoWith = (drill: Partial<DrillSetup>, rows?: readonly string[]): SchoolPlan =>
  deepFreeze({
    ...DEMO_SCHOOL,
    floors: rows === undefined ? DEMO_SCHOOL.floors : [createFloorFromRows(1, rows)],
    drill: { ...DEMO_SCHOOL.drill, ...drill },
  });

/** デモの校舎の昇降口（e）をすべて柱にして，校庭へ出られなくしたマス目 */
const ENCLOSED_ROWS = DEMO_SCHOOL_ROWS.map((row) => row.replaceAll("e", "#"));

const sameRef = (a: CellRef, b: CellRef): boolean =>
  a.floor === b.floor && a.x === b.x && a.z === b.z;

describe("withResolvedRoute", () => {
  it("経路が空でなければ同じ参照を返す（教員の経路を使う）", () => {
    const p = demoWith({});
    expect(withResolvedRoute(p)).toBe(p);
  });

  it("経路が 1 マスだけでも空でなければ同じ参照を返す（書き換えない）", () => {
    const p = demoWith({ route: [DEMO_SCHOOL.drill.start] });
    expect(withResolvedRoute(p)).toBe(p);
  });

  it("経路が空なら resolveReferenceRoute()（proposeRoute() の提案）の経路を入れる", () => {
    const p = demoWith({ route: [] });
    const spread = computeSpread(p);
    const resolved = withResolvedRoute(p);
    const expected = resolveReferenceRoute(p, spread);
    expect(expected.source).toBe("proposed");
    expect(resolved.drill.route).toEqual(expected.route);
    expect(resolved.drill.route).toEqual(proposeRoute(p, spread));
  });

  it("埋めた経路は開始地点から集合場所までの，人が一歩ずつ進める列で，validatePlan の誤りが無い", () => {
    const resolved = withResolvedRoute(demoWith({ route: [] }));
    const { route, start, assembly } = resolved.drill;
    const floor = resolved.floors[0];
    expect(route.length).toBeGreaterThan(1);
    expect(sameRef(route[0], start)).toBe(true);
    expect(assembly.some((a) => sameRef(a, route[route.length - 1]))).toBe(true);
    for (let i = 1; i < route.length; i++) {
      expect(canPersonStep(floor, route[i - 1], route[i])).toBe(true);
    }
    expect(validatePlan(resolved)).toEqual([]);
  });

  it("埋めた後は resolveReferenceRoute() が校舎の経路（plan）を返す（床の矢印・結果画面・評価が同じ経路を読む）", () => {
    const resolved = withResolvedRoute(demoWith({ route: [] }));
    const ref = resolveReferenceRoute(resolved, computeSpread(resolved));
    expect(ref.source).toBe("plan");
    expect(ref.route).toBe(resolved.drill.route);
  });

  it("経路以外（マス目・教室・訓練条件の他の項目）は変えない", () => {
    const p = demoWith({ route: [] });
    const resolved = withResolvedRoute(p);
    expect(resolved).not.toBe(p);
    expect(resolved.floors).toBe(p.floors);
    expect(resolved.rooms).toBe(p.rooms);
    expect(resolved.name).toBe(p.name);
    expect({ ...resolved.drill, route: [] }).toEqual(p.drill);
  });

  it("元の校舎を書き換えない（凍らせた入力でも例外にならず，元の経路は空のまま）", () => {
    const p = demoWith({ route: [] });
    expect(() => withResolvedRoute(p)).not.toThrow();
    expect(p.drill.route).toEqual([]);
  });

  it("提案でもたどり着けない（閉じ込め）時は空のまま同じ参照を返す", () => {
    const p = demoWith({ route: [] }, ENCLOSED_ROWS);
    expect(proposeRoute(p, computeSpread(p))).toBeNull();
    expect(withResolvedRoute(p)).toBe(p);
  });

  it("同じ階に集合場所が無い時は空のまま同じ参照を返す", () => {
    const p = demoWith({ route: [], assembly: [] });
    expect(withResolvedRoute(p)).toBe(p);
  });
});
