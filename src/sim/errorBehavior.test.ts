// 体験中のエラー行動の判定（detectErrorBehaviors・errorBehaviorsAt・isInSmoke・positionCell）のテスト．
// 基準は docs/04_SPEC/SPEC_01_画面遷移とモジュール構成.md「VR 避難の規則」の「赤い表示（エラー行動の評価）」と「結果の評価」，
// docs/03_PLAN/PLAN_04_要件定義書.md「体験中の評価（エラー行動の赤い表示）」，docs/04_SPEC/SPEC_02_校舎データの形式.md「座標」
import { describe, expect, it } from "vitest";
import type { DrillSample, DrillTrack } from "../core/drill";
import type { CellRef, SchoolPlan, SpreadSettings } from "../core/schoolPlan";
import type { Posture } from "../core/types";
import { DEMO_SCHOOL } from "../share/samples/demoSchool";
import { createFloorFromRows } from "../share/samples/floorFromRows";
import {
  detectErrorBehaviors,
  type ErrorBehaviors,
  errorBehaviorsAt,
  isInSmoke,
  positionCell,
} from "./errorBehavior";
import { evaluateDrill } from "./evaluate";
import { computeSpread, type SpreadMap } from "./spread";

const at = (x: number, z: number, floor = 0): CellRef => ({ floor, x, z });

interface PlanOverrides {
  readonly fireOrigins?: readonly CellRef[];
  readonly start?: CellRef;
  readonly assembly?: readonly CellRef[];
  readonly timeLimitSeconds?: number;
  readonly cellSize?: number;
  readonly spread?: Partial<SpreadSettings>;
}

function makePlan(rows: readonly string[], overrides: PlanOverrides = {}): SchoolPlan {
  const { spread, cellSize = 1, ...drill } = overrides;
  return {
    version: 1,
    name: "テスト校舎",
    cellSize,
    floors: [createFloorFromRows(1, rows)],
    rooms: [{ name: "教室A" }],
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

/** 1 回分の記録（既定はデモの校舎の (2,2) の中心・0 秒・立っている） */
function sample(overrides: Partial<DrillSample> = {}): DrillSample {
  return { t: 0, floor: 0, x: 2.5, z: 2.5, posture: "standing", ...overrides };
}

/** マスの中心にいる記録 */
function sampleAt(cell: CellRef, t: number, posture: Posture = "standing", cellSize = 1) {
  return sample({
    t,
    floor: cell.floor,
    x: (cell.x + 0.5) * cellSize,
    z: (cell.z + 0.5) * cellSize,
    posture,
  });
}

const NONE = { smokeStanding: false, nearFire: false, any: false };
const SMOKE_ONLY = { smokeStanding: true, nearFire: false, any: true };
const FIRE_ONLY = { smokeStanding: false, nearFire: true, any: true };
const BOTH = { smokeStanding: true, nearFire: true, any: true };

// 廊下 1 列（幅 10）．東の端 (9,0) が火元で，火は遅く（100 秒／マス），煙は 1 秒／マスで西へ来る．
// (x,0) に煙が着くのは 9 - x 秒．(8,0) が燃えるのは 100 秒
const LINE = makePlan(["hhhhhhhhhh"], {
  fireOrigins: [at(9, 0)],
  spread: { fireSecondsPerCell: 100, smokeSecondsPerCell: 1 },
});
const LINE_SPREAD = computeSpread(LINE);

// 廊下 5 × 5．中央 (2,2) が火元．火も煙も遅い（100 秒／マス）ので，0〜99 秒は火元のマスだけが燃えている
const SQUARE = makePlan(["hhhhh", "hhhhh", "hhhhh", "hhhhh", "hhhhh"], {
  fireOrigins: [at(2, 2)],
  spread: { fireSecondsPerCell: 100, smokeSecondsPerCell: 100 },
});
const SQUARE_SPREAD = computeSpread(SQUARE);

const DEMO_SPREAD = computeSpread(DEMO_SCHOOL);

describe("positionCell", () => {
  it.each([
    [2.5, 2.5, 2, 2],
    [0, 0, 0, 0],
    [0.999, 0.999, 0, 0],
    [1, 1, 1, 1], // マスの境目は + 側のマス
    [5, 0.5, 5, 0],
    [-0.5, 0.5, -1, 0], // マス目の外もそのまま返す
    [100.2, -3.1, 100, -4],
  ])("cellSize 1 の (%d, %d) は (%d, %d) のマス", (wx, wz, x, z) => {
    expect(positionCell(DEMO_SCHOOL, 0, wx, wz)).toEqual({ floor: 0, x, z });
  });

  it.each([
    [1, 1, 0, 0], // マス (0,0) の中心は ((0 + 0.5) * 2, (0 + 0.5) * 2)
    [2, 2, 1, 1], // 境目は + 側
    [1.999, 3.999, 0, 1],
    [7, 5, 3, 2],
  ])("cellSize 2 の (%d, %d) は (%d, %d) のマス", (wx, wz, x, z) => {
    const plan = makePlan(["hhhh", "hhhh", "hhhh"], { cellSize: 2 });
    expect(positionCell(plan, 0, wx, wz)).toEqual({ floor: 0, x, z });
  });

  it("cellSize 0.5 でもマスの中心（SPEC_02「座標」）からそのマスに戻る", () => {
    const plan = makePlan(["hhhh"], { cellSize: 0.5 });
    for (let x = 0; x < 4; x++) {
      expect(positionCell(plan, 0, (x + 0.5) * 0.5, 0.25)).toEqual({ floor: 0, x, z: 0 });
    }
  });

  it("階はそのまま付ける（存在しない階でも）", () => {
    expect(positionCell(DEMO_SCHOOL, 3, 2.5, 2.5)).toEqual({ floor: 3, x: 2, z: 2 });
  });

  it("座標が NaN の時は NaN のマスを返し，例外を投げない", () => {
    const cell = positionCell(DEMO_SCHOOL, 0, Number.NaN, 1);
    expect(Number.isNaN(cell.x)).toBe(true);
    expect(cell.z).toBe(1);
  });
});

describe("isInSmoke", () => {
  it("煙が着く時刻ちょうどから煙の中（<=）", () => {
    expect(isInSmoke(LINE_SPREAD, at(5, 0), 3.999)).toBe(false);
    expect(isInSmoke(LINE_SPREAD, at(5, 0), 4)).toBe(true);
    expect(isInSmoke(LINE_SPREAD, at(5, 0), 60)).toBe(true);
  });

  it("火元のマスは 0 秒から煙の中", () => {
    expect(isInSmoke(LINE_SPREAD, at(9, 0), 0)).toBe(true);
  });

  it.each([
    ["西の外", at(-1, 0)],
    ["東の外", at(10, 0)],
    ["南の外", at(9, 1)],
    ["存在しない階", at(9, 0, 1)],
    ["負の階", at(9, 0, -1)],
  ])("%s は煙なし", (_, cell) => {
    expect(isInSmoke(LINE_SPREAD, cell, 1000)).toBe(false);
  });

  it.each([
    ["負の時刻", -1],
    ["NaN の時刻", Number.NaN],
  ])("%s は煙なし", (_, t) => {
    expect(isInSmoke(LINE_SPREAD, at(9, 0), t)).toBe(false);
  });

  it("煙が届かないマス（壁の向こう）は煙なし", () => {
    // 教室 (0,0) が火元．壁で仕切られた廊下 (0,1) と校庭（屋外へは広がらない）
    const plan = makePlan(["0", "h"], {
      fireOrigins: [at(0, 0)],
      spread: { fireSecondsPerCell: 1, smokeSecondsPerCell: 1 },
    });
    expect(isInSmoke(computeSpread(plan), at(0, 1), 1000)).toBe(false);
  });
});

describe("errorBehaviorsAt", () => {
  describe("4 通りの組み合わせ", () => {
    it.each<[string, CellRef, number, Posture, ErrorBehaviors]>([
      ["煙も火も無い", at(0, 0), 5, "standing", NONE],
      ["煙の中で立っている（火から遠い）", at(3, 0), 10, "standing", SMOKE_ONLY],
      ["煙の中でしゃがんでいる（火から遠い）", at(3, 0), 10, "crouching", NONE],
      ["火の 1 マス以内でしゃがんでいる（煙の中）", at(8, 0), 10, "crouching", FIRE_ONLY],
      ["火の 1 マス以内で立っている（煙の中）", at(8, 0), 10, "standing", BOTH],
    ])("%s", (_, cell, t, posture, expected) => {
      expect(errorBehaviorsAt(LINE_SPREAD, cell, t, posture)).toEqual(expected);
    });

    it("火の 1 マス以内で煙がまだ無いマスでは nearFire だけ（壁で煙が来ない廊下）", () => {
      // 教室 (0,0) が火元．廊下 (0,1) は壁で仕切られ煙は来ないが，壁は見ないので火の 1 マス以内
      const plan = makePlan(["0", "h"], {
        fireOrigins: [at(0, 0)],
        spread: { fireSecondsPerCell: 1, smokeSecondsPerCell: 1 },
      });
      const spread = computeSpread(plan);
      expect(errorBehaviorsAt(spread, at(0, 1), 0, "standing")).toEqual(FIRE_ONLY);
      expect(errorBehaviorsAt(spread, at(0, 1), 0, "crouching")).toEqual(FIRE_ONLY);
    });
  });

  it("any は smokeStanding か nearFire のどちらかが true の時だけ true", () => {
    for (const posture of ["standing", "crouching"] as const) {
      for (let x = -2; x <= 11; x++) {
        for (const t of [-1, 0, 0.5, 3, 4, 8.9, 9, 50, 100, 200]) {
          const e = errorBehaviorsAt(LINE_SPREAD, at(x, 0), t, posture);
          expect(e.any).toBe(e.smokeStanding || e.nearFire);
        }
      }
    }
  });

  it("しゃがんでいれば，煙の中でも smokeStanding は false（どの時刻・マスでも）", () => {
    for (let x = 0; x < 10; x++) {
      for (const t of [0, 5, 9, 50, 150]) {
        expect(errorBehaviorsAt(LINE_SPREAD, at(x, 0), t, "crouching").smokeStanding).toBe(false);
      }
    }
  });

  it("smokeStanding は「煙の中」かつ「しゃがんでいない」と一致する", () => {
    for (let x = 0; x < 10; x++) {
      for (const t of [0, 3, 4, 9]) {
        expect(errorBehaviorsAt(LINE_SPREAD, at(x, 0), t, "standing").smokeStanding).toBe(
          isInSmoke(LINE_SPREAD, at(x, 0), t),
        );
      }
    }
  });

  describe("煙が着く時刻の境目", () => {
    it("煙が着く時刻ちょうどから smokeStanding（<=）", () => {
      // (5,0) に煙が着くのは 4 秒
      expect(errorBehaviorsAt(LINE_SPREAD, at(5, 0), 3.99, "standing").smokeStanding).toBe(false);
      expect(errorBehaviorsAt(LINE_SPREAD, at(5, 0), 4, "standing").smokeStanding).toBe(true);
    });
  });

  describe("火の 1 マス以内（nearFire）", () => {
    it("火が着く時刻ちょうどから，その隣は nearFire（<=）", () => {
      // (8,0) が燃えるのは 100 秒．(7,0) はその隣
      expect(errorBehaviorsAt(LINE_SPREAD, at(7, 0), 99.99, "crouching").nearFire).toBe(false);
      expect(errorBehaviorsAt(LINE_SPREAD, at(7, 0), 100, "crouching").nearFire).toBe(true);
    });

    it("火元の隣は 0 秒ちょうどから nearFire", () => {
      expect(errorBehaviorsAt(LINE_SPREAD, at(8, 0), 0, "crouching").nearFire).toBe(true);
    });

    it.each([
      [1, 1],
      [2, 1],
      [3, 1],
      [1, 2],
      [3, 2],
      [1, 3],
      [2, 3],
      [3, 3],
      [2, 2], // 燃えているマスそのもの
    ])("燃えているマスの周り 8 マス（斜め含む）と本人のマス: (%d, %d) は nearFire", (x, z) => {
      expect(errorBehaviorsAt(SQUARE_SPREAD, at(x, z), 50, "crouching").nearFire).toBe(true);
    });

    it.each([
      [0, 0],
      [0, 2],
      [2, 0],
      [4, 4],
      [4, 1],
    ])("2 マス離れた (%d, %d) は nearFire でない", (x, z) => {
      expect(errorBehaviorsAt(SQUARE_SPREAD, at(x, z), 50, "crouching").nearFire).toBe(false);
    });

    it("壁は見ない（燃えている教室の横の廊下でも nearFire）", () => {
      const plan = makePlan(["00", "hh"], {
        fireOrigins: [at(0, 0)],
        spread: { fireSecondsPerCell: 1000, smokeSecondsPerCell: 1000 },
      });
      const spread = computeSpread(plan);
      expect(errorBehaviorsAt(spread, at(0, 1), 0, "crouching").nearFire).toBe(true);
      expect(errorBehaviorsAt(spread, at(1, 1), 0, "crouching").nearFire).toBe(true); // 斜め
    });

    it("マス目の外でも，端のマスが燃えていれば 1 マス以内は nearFire（煙はなし）", () => {
      expect(errorBehaviorsAt(LINE_SPREAD, at(10, 0), 0, "standing")).toEqual(FIRE_ONLY);
      expect(errorBehaviorsAt(LINE_SPREAD, at(10, 1), 0, "standing")).toEqual(FIRE_ONLY);
      expect(errorBehaviorsAt(LINE_SPREAD, at(11, 0), 0, "standing")).toEqual(NONE);
    });

    it("別の階の同じ位置は nearFire でない（存在しない階はエラーなし）", () => {
      expect(errorBehaviorsAt(LINE_SPREAD, at(9, 0, 1), 50, "standing")).toEqual(NONE);
      expect(errorBehaviorsAt(LINE_SPREAD, at(9, 0, -1), 50, "standing")).toEqual(NONE);
    });
  });

  it.each([
    ["負の時刻", -0.001],
    ["-1 秒", -1],
    ["NaN の時刻", Number.NaN],
  ])("%s はエラーなし（火元のマスで立っていても）", (_, t) => {
    expect(errorBehaviorsAt(LINE_SPREAD, at(9, 0), t, "standing")).toEqual(NONE);
  });

  it("NaN のマスはエラーなし", () => {
    expect(errorBehaviorsAt(LINE_SPREAD, at(Number.NaN, 0), 50, "standing")).toEqual(NONE);
    expect(errorBehaviorsAt(LINE_SPREAD, at(9, Number.NaN), 50, "standing")).toEqual(NONE);
  });
});

describe("detectErrorBehaviors", () => {
  describe("デモの校舎（cellSize 1．理科室 (16,2) が火元）", () => {
    it.each<[string, Partial<DrillSample>, ErrorBehaviors]>([
      ["開始地点 (2.5,2.5) で 30 秒に立っている → なし", { x: 2.5, z: 2.5, t: 30 }, NONE],
      [
        "(14.5,5.5) で 15 秒に立っている → 煙の中で立っているだけ",
        { x: 14.5, z: 5.5, t: 15 },
        SMOKE_ONLY,
      ],
      [
        "(14.5,5.5) で 15 秒にしゃがんでいる → なし",
        { x: 14.5, z: 5.5, t: 15, posture: "crouching" },
        NONE,
      ],
      [
        "(16.5,5.5) で 20 秒にしゃがんでいる → 火に近いだけ",
        { x: 16.5, z: 5.5, t: 20, posture: "crouching" },
        FIRE_ONLY,
      ],
      ["(14.5,4.5) で 20 秒に立っている → 両方", { x: 14.5, z: 4.5, t: 20 }, BOTH],
      ["火元のそば (16.5,3.5) でも -1 秒（非常ベルの前）→ なし", { x: 16.5, z: 3.5, t: -1 }, NONE],
    ])("%s", (_, overrides, expected) => {
      expect(detectErrorBehaviors(DEMO_SCHOOL, DEMO_SPREAD, sample(overrides))).toEqual(expected);
    });

    it("(14,5) のマスに煙が着く 10 秒ちょうどから smokeStanding", () => {
      const s = (t: number) => sample({ x: 14.5, z: 5.5, t });
      expect(DEMO_SPREAD.smokeAt(at(14, 5))).toBe(10);
      expect(detectErrorBehaviors(DEMO_SCHOOL, DEMO_SPREAD, s(9.99)).smokeStanding).toBe(false);
      expect(detectErrorBehaviors(DEMO_SCHOOL, DEMO_SPREAD, s(10)).smokeStanding).toBe(true);
    });

    it("存在しない階・マス目の外の遠い位置はエラーなし", () => {
      const cases = [
        sample({ floor: 1, x: 16.5, z: 2.5, t: 100 }),
        sample({ floor: -1, x: 16.5, z: 2.5, t: 100 }),
        sample({ x: -5, z: -5, t: 100 }),
        sample({ x: 500, z: 500, t: 100 }),
      ];
      for (const s of cases) {
        expect(detectErrorBehaviors(DEMO_SCHOOL, DEMO_SPREAD, s)).toEqual(NONE);
      }
    });

    it.each([
      ["x が NaN", { x: Number.NaN }],
      ["z が NaN", { z: Number.NaN }],
      ["t が NaN", { t: Number.NaN }],
    ])("%s でもエラーなし（例外を投げない）", (_, overrides) => {
      const s = sample({ x: 16.5, z: 3.5, t: 100, ...overrides });
      expect(detectErrorBehaviors(DEMO_SCHOOL, DEMO_SPREAD, s)).toEqual(NONE);
    });
  });

  describe("マスの境目（SPEC_02「座標」．境目は + 側のマス）", () => {
    // LINE: (4,0) に煙が着くのは 5 秒，(5,0) は 4 秒．4.5 秒では x=5.0 の境目は (5,0) 側で煙の中
    it("x = 5.0 ちょうどは (5,0) として判定する", () => {
      const s = (x: number) => sample({ x, z: 0.5, t: 4.5 });
      expect(detectErrorBehaviors(LINE, LINE_SPREAD, s(5)).smokeStanding).toBe(true);
      expect(detectErrorBehaviors(LINE, LINE_SPREAD, s(4.999)).smokeStanding).toBe(false);
    });

    it("x = 8.0 ちょうどは (8,0) として火の 1 マス以内，7.999 は (7,0) で 2 マス離れる", () => {
      // (8,0) は 100 秒まで燃えないので，0〜99 秒の 1 マス以内は (8,0)〜(10,0)．x = 8.0 の境目で切り替わる
      const s = (x: number) => sample({ x, z: 0.5, t: 50, posture: "crouching" });
      expect(detectErrorBehaviors(LINE, LINE_SPREAD, s(8)).nearFire).toBe(true);
      expect(detectErrorBehaviors(LINE, LINE_SPREAD, s(7.999)).nearFire).toBe(false);
    });

    it("z の境目も + 側（z = 1.0 はマス目の外の (x,1)）", () => {
      // (5,0) は煙の中，z = 1.0 は (5,1)（マス目の外）なので煙なし
      expect(
        detectErrorBehaviors(LINE, LINE_SPREAD, sample({ x: 5.5, z: 0.999, t: 50 })).smokeStanding,
      ).toBe(true);
      expect(
        detectErrorBehaviors(LINE, LINE_SPREAD, sample({ x: 5.5, z: 1, t: 50 })).smokeStanding,
      ).toBe(false);
    });
  });

  describe("cellSize が 1 以外", () => {
    const LINE2 = makePlan(["hhhhhhhhhh"], {
      cellSize: 2,
      fireOrigins: [at(9, 0)],
      spread: { fireSecondsPerCell: 100, smokeSecondsPerCell: 1 },
    });
    const LINE2_SPREAD = computeSpread(LINE2);

    it("マスの中心 ((x + 0.5) * 2) で cellSize 1 と同じ判定になる", () => {
      for (let x = 0; x < 10; x++) {
        for (const t of [0, 3, 4, 50, 100]) {
          for (const posture of ["standing", "crouching"] as const) {
            expect(
              detectErrorBehaviors(LINE2, LINE2_SPREAD, sampleAt(at(x, 0), t, posture, 2)),
            ).toEqual(errorBehaviorsAt(LINE_SPREAD, at(x, 0), t, posture));
          }
        }
      }
    });

    it("ワールド座標 10.0（マス (5,0) の西の端）は (5,0)．9.999 は (4,0)", () => {
      // 4.5 秒: (5,0) は煙の中（4 秒），(4,0) はまだ（5 秒）
      expect(
        detectErrorBehaviors(LINE2, LINE2_SPREAD, sample({ x: 10, z: 1, t: 4.5 })).smokeStanding,
      ).toBe(true);
      expect(
        detectErrorBehaviors(LINE2, LINE2_SPREAD, sample({ x: 9.999, z: 1, t: 4.5 })).smokeStanding,
      ).toBe(false);
    });

    it("cellSize 1 のつもりの座標（5.5）は cellSize 2 では (2,0) として判定する", () => {
      // (2,0) に煙が着くのは 7 秒．(5,0) なら 4 秒
      expect(
        detectErrorBehaviors(LINE2, LINE2_SPREAD, sample({ x: 5.5, z: 0.5, t: 5 })).smokeStanding,
      ).toBe(false);
    });
  });

  it("errorBehaviorsAt(positionCell(...)) と同じ結果", () => {
    for (let i = 0; i < 200; i++) {
      const s = sample({
        x: (i * 0.37) % 20,
        z: (i * 0.53) % 13,
        t: (i * 0.9) % 120,
        posture: i % 3 === 0 ? "crouching" : "standing",
      });
      expect(detectErrorBehaviors(DEMO_SCHOOL, DEMO_SPREAD, s)).toEqual(
        errorBehaviorsAt(DEMO_SPREAD, positionCell(DEMO_SCHOOL, s.floor, s.x, s.z), s.t, s.posture),
      );
    }
  });

  describe("戻り値を書き換えられない", () => {
    const results = [
      detectErrorBehaviors(DEMO_SCHOOL, DEMO_SPREAD, sample({ t: 30 })),
      detectErrorBehaviors(DEMO_SCHOOL, DEMO_SPREAD, sample({ x: 14.5, z: 5.5, t: 15 })),
      detectErrorBehaviors(
        DEMO_SCHOOL,
        DEMO_SPREAD,
        sample({ x: 16.5, z: 5.5, t: 20, posture: "crouching" }),
      ),
      detectErrorBehaviors(DEMO_SCHOOL, DEMO_SPREAD, sample({ x: 14.5, z: 4.5, t: 20 })),
    ];

    it("4 通りの組み合わせのどれも凍結されている", () => {
      expect(results.map((r) => r.any)).toEqual([false, true, true, true]);
      for (const r of results) expect(Object.isFrozen(r)).toBe(true);
    });

    it("書き換えようとすると TypeError になり，次の呼び出しの結果は変わらない", () => {
      const r = results[0] as { smokeStanding: boolean; any: boolean };
      expect(() => {
        r.any = true;
      }).toThrow(TypeError);
      expect(() => {
        r.smokeStanding = true;
      }).toThrow(TypeError);
      expect(detectErrorBehaviors(DEMO_SCHOOL, DEMO_SPREAD, sample({ t: 30 }))).toEqual(NONE);
    });
  });
});

// ---- 体験中の赤い表示と結果画面の印が食い違わないこと（SPEC_01「赤い表示」: 判定は「結果の評価」と同じ定義） ----

/** 種付きの乱数（0 以上 1 未満） */
function seededRandom(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 2 ** 32;
  };
}

/**
 * 評価の窓（SPEC_01「結果の評価」: 非常ベル（0 秒）から集合場所に入るまで．着かなければ制限時間まで）に入る記録か．
 * 集合場所に入った記録は窓の端（その記録を含む）
 */
function windowFlags(plan: SchoolPlan, samples: readonly DrillSample[]): boolean[] {
  const limit = plan.drill.timeLimitSeconds;
  const assembly = new Set(plan.drill.assembly.map((c) => `${c.floor}:${c.x}:${c.z}`));
  let end = limit;
  for (const s of samples) {
    const c = positionCell(plan, s.floor, s.x, s.z);
    if (s.t >= 0 && s.t <= limit && assembly.has(`${c.floor}:${c.x}:${c.z}`)) {
      end = s.t;
      break;
    }
  }
  return samples.map((s) => s.t >= 0 && s.t <= end);
}

/** 毎フレームの判定（detectErrorBehaviors）から，結果画面に出るはずの印を組み立てる */
function expectedMarks(plan: SchoolPlan, spread: SpreadMap, samples: readonly DrillSample[]) {
  const inWindow = windowFlags(plan, samples);
  const live = samples.map((s) => detectErrorBehaviors(plan, spread, s));
  const nearFire: { index: number; t: number; floor: number; x: number; z: number }[] = [];
  let wasNear = false;
  live.forEach((e, i) => {
    const near = inWindow[i] && e.nearFire;
    // 「火に近づいた」は範囲に入った瞬間だけ記録する（入り直せば再び記録する）
    if (near && !wasNear) {
      const s = samples[i];
      nearFire.push({ index: i, t: s.t, floor: s.floor, x: s.x, z: s.z });
    }
    wasNear = near;
  });
  const smokeStanding: {
    fromIndex: number;
    toIndex: number;
    fromSeconds: number;
    toSeconds: number;
  }[] = [];
  let from = -1;
  for (let i = 0; i <= live.length; i++) {
    const on = i < live.length && inWindow[i] && live[i].smokeStanding;
    if (on && from < 0) from = i;
    if (!on && from >= 0) {
      smokeStanding.push({
        fromIndex: from,
        toIndex: i - 1,
        fromSeconds: samples[from].t,
        toSeconds: samples[i - 1].t,
      });
      from = -1;
    }
  }
  return { nearFire, smokeStanding };
}

/** 種付きの乱数で歩き回る記録（0.2 秒ごと．時々しゃがみを切り替え，時々大きく跳ぶ） */
function randomTrack(
  plan: SchoolPlan,
  seed: number,
  fromSeconds: number,
  toSeconds: number,
  startX: number,
  startZ: number,
): DrillTrack {
  const random = seededRandom(seed);
  const width = plan.floors[0].width * plan.cellSize;
  const depth = plan.floors[0].depth * plan.cellSize;
  const samples: DrillSample[] = [];
  let x = startX;
  let z = startZ;
  let posture: Posture = "standing";
  for (let t = fromSeconds; t <= toSeconds + 1e-9; t += 0.2) {
    if (random() < 0.08) posture = posture === "standing" ? "crouching" : "standing";
    if (random() < 0.02) {
      x = random() * (width + 2) - 1;
      z = random() * (depth + 2) - 1;
    } else {
      x += (random() - 0.5) * 0.6 * plan.cellSize;
      z += (random() - 0.5) * 0.6 * plan.cellSize;
    }
    samples.push({ t: Math.round(t * 1000) / 1000, floor: 0, x, z, posture });
  }
  return { samples };
}

describe("体験中の赤い表示と結果画面の印が一致する（evaluateDrill との整合）", () => {
  it("デモの校舎で火のそばを出入りする記録: 火に近づいた点・煙の中で立っていた区間が一致する", () => {
    // (13,6) 〜 (18,6) の廊下を東西に往復し，途中でしゃがむ・立つを切り替える
    const samples: DrillSample[] = [];
    let t = -1;
    for (let lap = 0; lap < 6; lap++) {
      for (let x = 13; x <= 18; x++) {
        samples.push(sampleAt(at(x, 6), t, lap % 2 === 0 ? "standing" : "crouching"));
        t += 0.2;
        samples.push(sampleAt(at(x, 5), t, x % 2 === 0 ? "standing" : "crouching"));
        t += 0.2;
      }
      for (let x = 18; x >= 13; x--) {
        samples.push(sampleAt(at(x, 7), t, "standing"));
        t += 2;
      }
    }
    const result = evaluateDrill(DEMO_SCHOOL, DEMO_SPREAD, { samples });
    const expected = expectedMarks(DEMO_SCHOOL, DEMO_SPREAD, samples);
    // 往復しているので，火に近づいた点は複数（入り直すたびに記録）
    expect(expected.nearFire.length).toBeGreaterThan(1);
    expect(expected.smokeStanding.length).toBeGreaterThan(0);
    expect(result.nearFire).toEqual(expected.nearFire);
    expect(result.smokeStanding).toEqual(expected.smokeStanding);
  });

  it("「火に近づいた」はいる間は 1 つ．出て入り直すと再び記録する", () => {
    // LINE: 0〜99 秒の火の 1 マス以内は (8,0)〜
    const samples = [
      sampleAt(at(6, 0), 1),
      sampleAt(at(8, 0), 2), // 入る
      sampleAt(at(8, 0), 3),
      sampleAt(at(9, 0), 4),
      sampleAt(at(7, 0), 5), // 出る
      sampleAt(at(8, 0), 6, "crouching"), // 入り直す
      sampleAt(at(8, 0), 7),
    ];
    const live = samples.map((s) => detectErrorBehaviors(LINE, LINE_SPREAD, s).nearFire);
    expect(live).toEqual([false, true, true, true, false, true, true]);
    const result = evaluateDrill(LINE, LINE_SPREAD, { samples }, { route: [] });
    expect(result.nearFire.map((m) => m.index)).toEqual([1, 5]);
    expect(result.nearFire).toEqual(expectedMarks(LINE, LINE_SPREAD, samples).nearFire);
  });

  it("煙の中で立っていた区間は，毎フレームの smokeStanding が続いた区間（しゃがむと切れる）", () => {
    const samples = [
      sampleAt(at(3, 0), 5), // 煙はまだ（6 秒）
      sampleAt(at(3, 0), 6), // 着く時刻ちょうど
      sampleAt(at(3, 0), 6.2),
      sampleAt(at(3, 0), 6.4, "crouching"),
      sampleAt(at(3, 0), 6.6),
      sampleAt(at(0, 0), 6.8), // 煙はまだ（9 秒）
    ];
    const live = samples.map((s) => detectErrorBehaviors(LINE, LINE_SPREAD, s).smokeStanding);
    expect(live).toEqual([false, true, true, false, true, false]);
    const result = evaluateDrill(LINE, LINE_SPREAD, { samples }, { route: [] });
    expect(result.smokeStanding).toEqual([
      { fromIndex: 1, toIndex: 2, fromSeconds: 6, toSeconds: 6.2 },
      { fromIndex: 4, toIndex: 4, fromSeconds: 6.6, toSeconds: 6.6 },
    ]);
    expect(result.smokeStanding).toEqual(expectedMarks(LINE, LINE_SPREAD, samples).smokeStanding);
  });

  it("評価の窓の外（非常ベルの前・集合場所に入った後）は結果画面に出ない", () => {
    // 集合場所 (0,0)．入った後に煙・火のそばへ戻っても，結果画面には出ない
    const plan = makePlan(["hhhhhhhhhh"], {
      fireOrigins: [at(9, 0)],
      assembly: [at(0, 0)],
      spread: { fireSecondsPerCell: 100, smokeSecondsPerCell: 1 },
    });
    const spread = computeSpread(plan);
    const samples = [
      sampleAt(at(8, 0), -0.4),
      sampleAt(at(8, 0), 0), // 窓の始まり．火の 1 マス以内（煙はまだ）
      sampleAt(at(5, 0), 5),
      sampleAt(at(0, 0), 10), // 集合場所に入る
      sampleAt(at(8, 0), 11), // 入った後（体験中なら赤い表示は出るが，評価の窓の外）
      sampleAt(at(8, 0), 12),
    ];
    const result = evaluateDrill(plan, spread, { samples }, { route: [] });
    expect(detectErrorBehaviors(plan, spread, samples[4])).toEqual(BOTH);
    expect(result.nearFire).toEqual([{ index: 1, t: 0, floor: 0, x: 8.5, z: 0.5 }]);
    expect(result.smokeStanding).toEqual([
      // (8,0) の煙は 1 秒なので 0 秒はまだ．(5,0) は 4 秒，集合場所 (0,0) は 9 秒で煙の中（入った記録も窓に含む）
      { fromIndex: 2, toIndex: 3, fromSeconds: 5, toSeconds: 10 },
    ]);
    expect(result).toMatchObject(expectedMarks(plan, spread, samples));
  });

  it("制限時間を過ぎた記録は結果画面に出ない（窓の中だけ一致する）", () => {
    const plan = makePlan(["hhhhhhhhhh"], {
      fireOrigins: [at(9, 0)],
      timeLimitSeconds: 10,
      spread: { fireSecondsPerCell: 100, smokeSecondsPerCell: 1 },
    });
    const spread = computeSpread(plan);
    const samples = [sampleAt(at(5, 0), 9), sampleAt(at(5, 0), 10), sampleAt(at(8, 0), 10.2)];
    const result = evaluateDrill(plan, spread, { samples }, { route: [] });
    expect(result.nearFire).toEqual([]);
    expect(result.smokeStanding).toEqual([
      { fromIndex: 0, toIndex: 1, fromSeconds: 9, toSeconds: 10 },
    ]);
    expect(result).toMatchObject(expectedMarks(plan, spread, samples));
  });

  it.each([1, 2, 3, 4, 5, 6, 7, 8])(
    "デモの校舎を種 %d の乱数で歩き回る記録（非常ベルの前から制限時間の後まで）でも一致する",
    (seed) => {
      const track = randomTrack(DEMO_SCHOOL, seed, -2, 160, 15, 6);
      const result = evaluateDrill(DEMO_SCHOOL, DEMO_SPREAD, track);
      const expected = expectedMarks(DEMO_SCHOOL, DEMO_SPREAD, track.samples);
      expect(result.nearFire).toEqual(expected.nearFire);
      expect(result.smokeStanding).toEqual(expected.smokeStanding);
    },
  );

  it.each([11, 12, 13])("cellSize 2 の校舎を種 %d の乱数で歩き回る記録でも一致する", (seed) => {
    const plan = makePlan(["0000hhhh", "0000hhhh", "000dhhhh", "hhhhhhhh", "oooeoooo"], {
      cellSize: 2,
      fireOrigins: [at(1, 1)],
      assembly: [at(7, 4)],
      spread: { fireSecondsPerCell: 5, smokeSecondsPerCell: 1 },
    });
    const spread = computeSpread(plan);
    const track = randomTrack(plan, seed, -1, 160, 9, 7);
    const result = evaluateDrill(plan, spread, track, { route: [] });
    const expected = expectedMarks(plan, spread, track.samples);
    expect(result.nearFire).toEqual(expected.nearFire);
    expect(result.smokeStanding).toEqual(expected.smokeStanding);
  });

  it("乱数の記録には，火に近づいた点・煙の中で立っていた区間がどちらも含まれる（テストが空振りしていない）", () => {
    let near = 0;
    let smoke = 0;
    for (const seed of [1, 2, 3, 4, 5, 6, 7, 8]) {
      const track = randomTrack(DEMO_SCHOOL, seed, -2, 160, 15, 6);
      const e = expectedMarks(DEMO_SCHOOL, DEMO_SPREAD, track.samples);
      near += e.nearFire.length;
      smoke += e.smokeStanding.length;
    }
    expect(near).toBeGreaterThan(0);
    expect(smoke).toBeGreaterThan(0);
  });
});

describe("処理速度（毎フレーム呼ぶ）", () => {
  it("detectErrorBehaviors() を 10,000 回呼んでも十分速い（ゆるい上限 100 ms．1 回あたり 0.01 ms）", () => {
    const samples = Array.from({ length: 10_000 }, (_, i) =>
      sample({
        x: (i * 0.137) % 19,
        z: (i * 0.071) % 13,
        t: (i * 0.02) % 150,
        posture: i % 2 === 0 ? "standing" : "crouching",
      }),
    );
    const ms: number[] = [];
    for (let k = 0; k < 5; k++) {
      const t0 = performance.now();
      for (const s of samples) detectErrorBehaviors(DEMO_SCHOOL, DEMO_SPREAD, s);
      ms.push(performance.now() - t0);
    }
    expect(ms.sort((a, b) => a - b)[2]).toBeLessThan(100);
  });
});
