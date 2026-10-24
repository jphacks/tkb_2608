// 延焼のプレビュー（E4）の純粋な関数のテスト．
// 基準は docs/04_SPEC/SPEC_02_校舎データの形式.md（SpreadSettings・既定値・「通れる・燃え広がる」・添字 z * width + x），
// docs/04_SPEC/SPEC_01_画面遷移とモジュール構成.md（editor: computeSpread() の結果を時刻のスライダーで見せる．SpreadMap は着かなければ Infinity），
// docs/03_PLAN/PLAN_04_要件定義書.md の E4，Issue #132（plan が変わった時だけ計算し直す・プレビューは plan を変えない・煙が遅い時は注意）
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { CellRef, DrillSetup, SchoolPlan } from "../core/schoolPlan";
import { DEMO_SCHOOL, DEMO_SCHOOL_ROWS } from "../share/samples/demoSchool";
import { validatePlan } from "../share/validatePlan";
import { computeSpread, type SpreadMap } from "../sim";
import { createEditorState, setSpreadSeconds, undo } from "./editorState";
import {
  countSpreadAt,
  createSpreadCache,
  previewMaxSeconds,
  SPREAD_WARNINGS,
  spreadStateAt,
  spreadWarnings,
} from "./spreadPreview";

// computeSpread を呼んだ回数を数えるため，本物を包んだ関数に差し替える（結果は本物と同じ）
vi.mock("../sim", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../sim")>();
  return { ...actual, computeSpread: vi.fn(actual.computeSpread) };
});

/** 入れ子のオブジェクト・配列をすべて凍らせる（書き換えようとすると strict mode で例外になる） */
function deepFreeze<T>(value: T): T {
  if (value !== null && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const v of Object.values(value as object)) deepFreeze(v);
  }
  return value;
}

/** 訓練条件の一部だけ上書きしたデモの校舎（凍らせてある） */
function demo(
  drill: Partial<DrillSetup> = {},
  spread: Partial<DrillSetup["spread"]> = {},
): SchoolPlan {
  return deepFreeze({
    ...DEMO_SCHOOL,
    drill: { ...DEMO_SCHOOL.drill, ...drill, spread: { ...DEMO_SCHOOL.drill.spread, ...spread } },
  });
}

/** 手で作った SpreadMap（1 階・添字ごとの火・煙の時刻） */
function spreadMap(fire: readonly number[], smoke: readonly number[]): SpreadMap {
  return {
    fireSeconds: [fire],
    smokeSeconds: [smoke],
    fireAt: (c: CellRef) => (c.floor === 0 ? (fire[c.x] ?? Infinity) : Infinity),
    smokeAt: (c: CellRef) => (c.floor === 0 ? (smoke[c.x] ?? Infinity) : Infinity),
  };
}

/** デモの校舎の添字（z * width + x） */
const WIDTH = DEMO_SCHOOL_ROWS[0].length;
const idx = (x: number, z: number) => z * WIDTH + x;
/** デモの校舎のマスの文字 */
const charAt = (i: number) => DEMO_SCHOOL_ROWS[Math.floor(i / WIDTH)][i % WIDTH];

describe("テスト用データ", () => {
  it("デモの校舎の延焼の速さは SPEC_02 の既定値（火 6 s・煙 2 s・制限時間 150 s）", () => {
    expect(DEMO_SCHOOL.drill.spread.fireSecondsPerCell).toBe(6);
    expect(DEMO_SCHOOL.drill.spread.smokeSecondsPerCell).toBe(2);
    expect(DEMO_SCHOOL.drill.timeLimitSeconds).toBe(150);
    expect(validatePlan(demo())).toEqual([]);
  });
});

describe("createSpreadCache", () => {
  const spy = vi.mocked(computeSpread);
  beforeEach(() => {
    spy.mockClear();
  });

  it("結果は computeSpread と同じ", () => {
    const p = demo();
    const spread = createSpreadCache()(p);
    const expected = computeSpread(p);
    expect(spread.fireSeconds).toEqual(expected.fireSeconds);
    expect(spread.smokeSeconds).toEqual(expected.smokeSeconds);
  });

  it("同じ校舎（同じ参照）を続けて渡すと計算し直さず，前の結果（同じ参照）を返す", () => {
    const get = createSpreadCache();
    const p = demo();
    const first = get(p);
    for (let n = 0; n < 5; n++) expect(get(p)).toBe(first);
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it("校舎が変わった時だけ計算し直す", () => {
    const get = createSpreadCache();
    const a = demo();
    const b = demo({}, { fireSecondsPerCell: 2 });
    const ra = get(a);
    const rb = get(b);
    expect(spy).toHaveBeenCalledTimes(2);
    expect(rb).not.toBe(ra);
    expect(rb.fireSeconds).toEqual(computeSpread(b).fireSeconds);
    // 戻した後の校舎の結果は元の校舎のもの
    expect(get(a).fireSeconds).toEqual(ra.fireSeconds);
  });

  it("中身が同じでも別の参照の校舎なら計算し直す（参照で比べる）", () => {
    const get = createSpreadCache();
    get(demo());
    get(demo());
    expect(spy).toHaveBeenCalledTimes(2);
  });

  it("別々に作ったキャッシュは互いに影響しない", () => {
    const g1 = createSpreadCache();
    const g2 = createSpreadCache();
    const p = demo();
    g1(p);
    g2(p);
    expect(spy).toHaveBeenCalledTimes(2);
  });

  it("校舎を書き換えない（凍らせた校舎でも例外にならず，中身も変わらない）", () => {
    const p = demo();
    const copy = structuredClone(p);
    expect(() => createSpreadCache()(p)).not.toThrow();
    expect(p).toEqual(copy);
  });
});

describe("spreadStateAt", () => {
  // 添字 0: 火 0 s・煙 0 s，1: 火 10 s・煙 4 s，2: 火なし・煙 5 s，3: どちらも着かない
  const s = spreadMap([0, 10, Infinity, Infinity], [0, 4, 5, Infinity]);

  it.each<[number, number, "fire" | "smoke" | null]>([
    [0, 0, "fire"],
    [0, -1, null],
    [1, 3.999, null],
    [1, 4, "smoke"],
    [1, 9.999, "smoke"],
    [1, 10, "fire"],
    [1, 100, "fire"],
    [2, 4.999, null],
    [2, 5, "smoke"],
    [2, 1e9, "smoke"],
    [3, 0, null],
    [3, 1e9, null],
  ])("添字 %i は %s 秒に %s（着く時刻ちょうどで着いている）", (i, t, expected) => {
    expect(spreadStateAt(s, 0, i, t)).toBe(expected);
  });

  it("火と煙の両方が着いているマスは火", () => {
    expect(spreadStateAt(spreadMap([3], [1]), 0, 0, 5)).toBe("fire");
  });

  it.each([-1, 1, 5, 0.5, Number.NaN])("無い階（%s）は null", (floor) => {
    expect(spreadStateAt(s, floor, 0, 100)).toBeNull();
  });

  it.each([-1, 4, 100, 0.5, Number.NaN])("範囲外の添字（%s）は null", (i) => {
    expect(spreadStateAt(s, 0, i, 100)).toBeNull();
  });

  it("時刻が NaN なら null", () => {
    expect(spreadStateAt(s, 0, 0, Number.NaN)).toBeNull();
  });

  it("着かないマス（Infinity）・範囲外は，時刻が Infinity でも着いていない（SPEC_01: 着かなければ Infinity）", () => {
    expect(spreadStateAt(s, 0, 3, Infinity)).toBeNull();
    expect(spreadStateAt(s, 0, 99, Infinity)).toBeNull();
    expect(spreadStateAt(s, 5, 0, Infinity)).toBeNull();
  });
});

describe("countSpreadAt", () => {
  const s = spreadMap([0, 10, Infinity, Infinity], [0, 4, 5, Infinity]);

  it.each<[number, number, number]>([
    [-1, 0, 0],
    [0, 1, 0],
    [4, 1, 1],
    [5, 1, 2],
    [10, 2, 1],
    [1e9, 2, 1],
  ])("%s 秒には火 %i マス・煙だけ %i マス（煙は火の着いたマスを含めない）", (t, fire, smoke) => {
    expect(countSpreadAt(s, 0, t)).toEqual({ fire, smoke });
  });

  it.each([-1, 1, Number.NaN])("無い階（%s）は 0", (floor) => {
    expect(countSpreadAt(s, floor, 100)).toEqual({ fire: 0, smoke: 0 });
  });

  it("時刻が NaN なら 0", () => {
    expect(countSpreadAt(s, 0, Number.NaN)).toEqual({ fire: 0, smoke: 0 });
  });

  it("spreadStateAt を全マス数えた数と同じ", () => {
    const spread = computeSpread(demo());
    const cells = spread.fireSeconds[0].length;
    for (const t of [0, 3, 6, 17, 30, 60, 150]) {
      let fire = 0;
      let smoke = 0;
      for (let i = 0; i < cells; i++) {
        const st = spreadStateAt(spread, 0, i, t);
        if (st === "fire") fire++;
        if (st === "smoke") smoke++;
      }
      expect(countSpreadAt(spread, 0, t)).toEqual({ fire, smoke });
    }
  });
});

describe("previewMaxSeconds", () => {
  const drill = (timeLimitSeconds: number): DrillSetup => ({
    ...DEMO_SCHOOL.drill,
    timeLimitSeconds,
  });

  it.each([150, 60, 0.5, 1e6])("制限時間が正しい数（%s）ならその値", (v) => {
    expect(previewMaxSeconds(drill(v), 300)).toBe(v);
  });

  it.each([0, -0, -10, Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY])(
    "制限時間が正しくない（%s）なら fallback",
    (v) => {
      expect(previewMaxSeconds(drill(v), 300)).toBe(300);
    },
  );
});

describe("spreadWarnings", () => {
  const drill = (fire: number, smoke: number): DrillSetup => ({
    ...DEMO_SCHOOL.drill,
    spread: { ...DEMO_SCHOOL.drill.spread, fireSecondsPerCell: fire, smokeSecondsPerCell: smoke },
  });

  it("既定値（煙のほうが速い）なら注意は無い", () => {
    expect(spreadWarnings(DEMO_SCHOOL.drill)).toEqual([]);
  });

  it.each<[number, number]>([
    [6, 2],
    [6, 5.999],
    [6, 6],
    [1, 1],
  ])("火 %s 秒・煙 %s 秒（煙が火より遅くない）なら注意は無い", (fire, smoke) => {
    expect(spreadWarnings(drill(fire, smoke))).toEqual([]);
  });

  it.each<[number, number]>([
    [6, 6.001],
    [2, 6],
    [0.5, 100],
  ])("火 %s 秒・煙 %s 秒（煙の秒数が火より長い）なら注意を 1 つ出す", (fire, smoke) => {
    expect(spreadWarnings(drill(fire, smoke))).toEqual([SPREAD_WARNINGS.smokeSlowerThanFire]);
  });

  it("注意を出しても校舎の誤りにはしない（validatePlan は通る）", () => {
    const p = demo({}, { fireSecondsPerCell: 2, smokeSecondsPerCell: 6 });
    expect(spreadWarnings(p.drill)).toHaveLength(1);
    expect(validatePlan(p)).toEqual([]);
  });
});

describe("デモの校舎のプレビュー（Issue #132 の完了条件）", () => {
  const ORIGIN = idx(16, 2); // 理科室の火元

  it("0 秒には理科室の火元の 1 マスだけが燃えている", () => {
    const spread = createSpreadCache()(demo());
    expect(spreadStateAt(spread, 0, ORIGIN, 0)).toBe("fire");
    expect(countSpreadAt(spread, 0, 0)).toEqual({ fire: 1, smoke: 0 });
  });

  it("6 秒（火 1 マス分）には火元と上下左右の 5 マスが燃え，煙は火元から 3 マス以内の理科室に広がる（火元の下の z = 5 の理科室のマスも含む）", () => {
    const spread = createSpreadCache()(demo());
    // 理科室（x 13〜18・z 0〜5．z = 5 の x = 14 はドア）の中で火元からマンハッタン距離 3 以内は 23 マス．うち火が 5 マス
    expect(countSpreadAt(spread, 0, 6)).toEqual({ fire: 5, smoke: 18 });
    for (const [x, z] of [
      [15, 2],
      [17, 2],
      [16, 1],
      [16, 3],
    ]) {
      expect(spreadStateAt(spread, 0, idx(x, z), 6)).toBe("fire");
    }
  });

  it("時刻を進めると火・煙の着いたマス（合計）と火のマスは減らない", () => {
    const spread = createSpreadCache()(demo());
    let prev = { fire: 0, total: 0 };
    for (let t = 0; t <= 150; t += 1) {
      const c = countSpreadAt(spread, 0, t);
      expect(c.fire).toBeGreaterThanOrEqual(prev.fire);
      expect(c.fire + c.smoke).toBeGreaterThanOrEqual(prev.total);
      prev = { fire: c.fire, total: c.fire + c.smoke };
    }
    expect(prev.fire).toBeGreaterThan(1);
  });

  it("制限時間の間に，火・煙はシャッター・屋外・柱・シャッターより西へは広がらない", () => {
    const spread = createSpreadCache()(demo());
    const cells = spread.fireSeconds[0].length;
    for (let i = 0; i < cells; i++) {
      const ch = charAt(i);
      const x = i % WIDTH;
      if (ch === "s" || ch === "o" || ch === "#" || x < 12) {
        expect(spreadStateAt(spread, 0, i, 150)).toBeNull();
      }
    }
  });

  it("火の秒数を短くすると同じ時刻で燃えているマスが増え，元に戻すと元の広がり方に戻る", () => {
    const get = createSpreadCache();
    const s0 = createEditorState(demo());
    const before = countSpreadAt(get(s0.plan), 0, 30);

    const faster = setSpreadSeconds(s0, "fireSecondsPerCell", 2);
    const after = countSpreadAt(get(faster.plan), 0, 30);
    expect(after.fire).toBeGreaterThan(before.fire);

    const undone = undo(faster);
    expect(undone.plan).toBe(s0.plan);
    expect(countSpreadAt(get(undone.plan), 0, 30)).toEqual(before);
  });

  it("煙の秒数を長くすると同じ時刻で煙の着いたマスが減る（火は変わらない）", () => {
    const get = createSpreadCache();
    const s0 = createEditorState(demo());
    const before = countSpreadAt(get(s0.plan), 0, 10);
    const slower = setSpreadSeconds(s0, "smokeSecondsPerCell", 6);
    const after = countSpreadAt(get(slower.plan), 0, 10);
    expect(after.fire).toBe(before.fire);
    expect(after.fire + after.smoke).toBeLessThan(before.fire + before.smoke);
  });

  it("スライダーを動かして読んでも校舎（plan）は変わらない", () => {
    const p = demo();
    const copy = structuredClone(p);
    const get = createSpreadCache();
    for (let t = 0; t <= 150; t += 5) {
      countSpreadAt(get(p), 0, t);
      spreadStateAt(get(p), 0, ORIGIN, t);
    }
    spreadWarnings(p.drill);
    previewMaxSeconds(p.drill, 300);
    expect(p).toEqual(copy);
  });

  it("スライダーの上限は制限時間（150 秒）", () => {
    expect(previewMaxSeconds(demo().drill, 300)).toBe(150);
  });
});
