// 避難の評価（evaluateDrill・resolveReferenceRoute）のテスト．
// 基準は docs/04_SPEC/SPEC_01_画面遷移とモジュール構成.md「結果の評価」「VR 避難の規則」「受け渡すデータ」と
// PLAN_04 の F8（経路・煙の中での姿勢・避難時間），SPEC_02「型」（timeLimitSeconds を過ぎたら逃げ遅れ）
import { describe, expect, it } from "vitest";
import type { DrillSample, DrillTrack } from "../core/drill";
import type { CellRef, DrillSetup, SchoolPlan, SpreadSettings } from "../core/schoolPlan";
import type { Posture } from "../core/types";
import { DEMO_SCHOOL } from "../share/samples/demoSchool";
import { createFloorFromRows } from "../share/samples/floorFromRows";
import { evaluateDrill, resolveReferenceRoute } from "./evaluate";
import { SMOKE_CROUCH_GOOD_RATIO, TRACK_MAX_SAMPLE_GAP_SECONDS } from "./params";
import { proposeRoute } from "./route";
import { computeSpread } from "./spread";

const at = (x: number, z: number, floor = 0): CellRef => ({ floor, x, z });

interface PlanOverrides extends Partial<Omit<DrillSetup, "spread">> {
  readonly spread?: Partial<SpreadSettings>;
  readonly cellSize?: number;
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

/** マスの中心にいる 1 回分の記録 */
function sample(
  cell: CellRef,
  t: number,
  posture: Posture = "standing",
  cellSize = 1,
): DrillSample {
  return {
    t,
    floor: cell.floor,
    x: (cell.x + 0.5) * cellSize,
    z: (cell.z + 0.5) * cellSize,
    posture,
  };
}

const track = (samples: readonly DrillSample[]): DrillTrack => ({ samples });

/** 開始地点で departSeconds まで 0.2 秒ごとに立って待ち，その後に経路を 1 マス secondsPerCell 秒で歩く記録 */
function walk(route: readonly CellRef[], departSeconds = 8, secondsPerCell = 0.6): DrillTrack {
  const samples: DrillSample[] = [];
  for (let i = 0; i * 0.2 < departSeconds; i++) samples.push(sample(route[0], i * 0.2));
  route.forEach((cell, k) => {
    samples.push(sample(cell, departSeconds + k * secondsPerCell));
  });
  return track(samples);
}

// 煙の評価用の校舎: 廊下（z=0）の東の端 (9,0) が火元．火は遅く（100 秒／マス），煙は 1 秒／マスで西へ来る．
// 廊下の (x, 0) に煙が着くのは 9 - x 秒．西の昇降口 (0,1) から校庭 (0,2) の集合場所へ出る
const SMOKY = makePlan(["hhhhhhhhhh", "e#########", "oooooooooo"], {
  start: at(5, 0),
  assembly: [at(0, 2)],
  fireOrigins: [at(9, 0)],
  spread: { fireSecondsPerCell: 100, smokeSecondsPerCell: 1 },
});
const SMOKY_ROUTE = [
  at(5, 0),
  at(4, 0),
  at(3, 0),
  at(2, 0),
  at(1, 0),
  at(0, 0),
  at(0, 1),
  at(0, 2),
];
const smoky = (samples: readonly DrillSample[], plan = SMOKY) =>
  evaluateDrill(plan, computeSpread(plan), track(samples), { route: SMOKY_ROUTE });

const DEMO_SPREAD = computeSpread(DEMO_SCHOOL);
const demoWithoutRoute: SchoolPlan = {
  ...DEMO_SCHOOL,
  drill: { ...DEMO_SCHOOL.drill, route: [] },
};

describe("resolveReferenceRoute", () => {
  it("経路を渡せば，それを使う（given）", () => {
    const given = [at(2, 2), at(3, 2)];
    expect(resolveReferenceRoute(DEMO_SCHOOL, DEMO_SPREAD, given)).toEqual({
      route: given,
      source: "given",
    });
  });

  it("空の経路を渡しても，校舎の経路や提案に戻らず空のまま使う（given）", () => {
    expect(resolveReferenceRoute(DEMO_SCHOOL, DEMO_SPREAD, [])).toEqual({
      route: [],
      source: "given",
    });
  });

  it("渡さなければ，教員が直した plan.drill.route を使う（plan）", () => {
    expect(resolveReferenceRoute(DEMO_SCHOOL, DEMO_SPREAD)).toEqual({
      route: DEMO_SCHOOL.drill.route,
      source: "plan",
    });
  });

  it("plan.drill.route が空なら経路の提案を使う（proposed）", () => {
    const resolved = resolveReferenceRoute(demoWithoutRoute, DEMO_SPREAD);
    expect(resolved.source).toBe("proposed");
    expect(resolved.route).toEqual(proposeRoute(demoWithoutRoute, DEMO_SPREAD));
    expect(resolved.route.length).toBeGreaterThan(0);
  });

  it("提案でも着けなければ空の経路（proposed）", () => {
    const closed = makePlan(["000", "###", "ooo"], { start: at(1, 0), assembly: [at(1, 2)] });
    expect(resolveReferenceRoute(closed, computeSpread(closed))).toEqual({
      route: [],
      source: "proposed",
    });
  });
});

describe("evaluateDrill", () => {
  describe("正解経路のとおりに歩いた時", () => {
    it("デモの校舎の plan.drill.route を歩くと，外れも火への接近も煙も無く，着いた時刻が避難時間", () => {
      const route = DEMO_SCHOOL.drill.route;
      const t = walk(route);
      const result = evaluateDrill(DEMO_SCHOOL, DEMO_SPREAD, t);
      const arrival = t.samples[t.samples.length - 1].t;
      expect(result).toEqual({
        offRoute: [],
        nearFire: [],
        smokeSeconds: 0,
        smokeCrouchRatio: null,
        smokePostureGood: null,
        smokeStanding: [],
        evacuationSeconds: arrival,
        timeLimitSeconds: 150,
        lateEscape: false,
      });
    });

    it("plan.drill.route が空なら，提案の経路を歩けば外れは無い", () => {
      const proposed = proposeRoute(demoWithoutRoute, DEMO_SPREAD) ?? [];
      const result = evaluateDrill(demoWithoutRoute, DEMO_SPREAD, walk(proposed));
      expect(result.offRoute).toEqual([]);
      expect(result.lateEscape).toBe(false);
    });

    it("提案の経路を渡して，それを歩けば外れは無い", () => {
      const proposed = proposeRoute(DEMO_SCHOOL, DEMO_SPREAD) ?? [];
      const result = evaluateDrill(DEMO_SCHOOL, DEMO_SPREAD, walk(proposed), { route: proposed });
      expect(result.offRoute).toEqual([]);
    });
  });

  describe("外れた区間（offRoute）", () => {
    const route = DEMO_SCHOOL.drill.route;

    it("正解経路のマスから 1 マスより離れた連続する記録を区間にする（斜めの 1 マスは外れではない）", () => {
      const samples = [
        sample(at(2, 2), 0), // 経路の上
        sample(at(5, 3), 1), // (4,4) の斜め隣 → 外れではない
        sample(at(6, 2), 2), // 2 マス以上離れた
        sample(at(7, 1), 3),
        sample(at(3, 3), 4), // (2,2)・(3,4) の隣
        sample(at(6, 3), 5), // 再び離れた
        sample(at(3, 4), 6),
      ];
      const result = evaluateDrill(DEMO_SCHOOL, DEMO_SPREAD, track(samples), { route });
      expect(result.offRoute).toEqual([
        { fromIndex: 2, toIndex: 3, fromSeconds: 2, toSeconds: 3 },
        { fromIndex: 5, toIndex: 5, fromSeconds: 5, toSeconds: 5 },
      ]);
    });

    it("上下左右に 1 マス隣は外れではない", () => {
      const samples = [sample(at(1, 2), 0), sample(at(2, 1), 1), sample(at(5, 6), 2)];
      const result = evaluateDrill(DEMO_SCHOOL, DEMO_SPREAD, track(samples), { route });
      expect(result.offRoute).toEqual([]);
    });

    it("比べる経路が空なら，どこにいても外れた区間は無い", () => {
      const samples = [sample(at(15, 1), 0), sample(at(17, 11), 1)];
      const result = evaluateDrill(DEMO_SCHOOL, DEMO_SPREAD, track(samples), { route: [] });
      expect(result.offRoute).toEqual([]);
    });

    it("別の階にいれば，同じ (x, z) でも経路から外れている", () => {
      const samples = [sample(at(2, 2), 0), sample(at(2, 2, 1), 1)];
      const result = evaluateDrill(DEMO_SCHOOL, DEMO_SPREAD, track(samples), { route });
      expect(result.offRoute).toEqual([{ fromIndex: 1, toIndex: 1, fromSeconds: 1, toSeconds: 1 }]);
    });
  });

  describe("評価する範囲（0 秒から到着・制限時間まで）", () => {
    const route = DEMO_SCHOOL.drill.route;
    const goal = at(8, 10);

    it("非常ベルの前（t < 0）の記録は評価しない（集合場所にいても到着にしない）", () => {
      const samples = [
        sample(at(17, 1), -2), // 経路から遠い
        sample(goal, -1), // 集合場所
        sample(at(2, 2), 0),
        sample(goal, 40),
      ];
      const result = evaluateDrill(DEMO_SCHOOL, DEMO_SPREAD, track(samples), { route });
      expect(result.offRoute).toEqual([]);
      expect(result.evacuationSeconds).toBe(40);
      expect(result.lateEscape).toBe(false);
    });

    it("到着は集合場所にいる最初の記録の時刻．その後の記録は評価しない", () => {
      const samples = [
        sample(at(2, 2), 0),
        sample(goal, 30),
        sample(at(17, 1), 31), // 到着後に経路から離れても数えない
        sample(goal, 35),
      ];
      const result = evaluateDrill(DEMO_SCHOOL, DEMO_SPREAD, track(samples), { route });
      expect(result.evacuationSeconds).toBe(30);
      expect(result.offRoute).toEqual([]);
    });

    it("集合場所のどのマスに入っても到着", () => {
      const samples = [sample(at(2, 2), 0), sample(at(9, 11), 25)];
      const result = evaluateDrill(DEMO_SCHOOL, DEMO_SPREAD, track(samples), { route });
      expect(result.evacuationSeconds).toBe(25);
    });

    it("ちょうど制限時間に着けば逃げ遅れではない", () => {
      const samples = [sample(at(2, 2), 0), sample(goal, 150)];
      const result = evaluateDrill(DEMO_SCHOOL, DEMO_SPREAD, track(samples), { route });
      expect(result.evacuationSeconds).toBe(150);
      expect(result.lateEscape).toBe(false);
    });

    it("制限時間を過ぎてから着いたら逃げ遅れ（避難時間は null）", () => {
      const samples = [
        sample(at(2, 2), 0),
        sample(at(17, 1), 100), // 制限時間内の外れは数える
        sample(at(17, 2), 151), // 制限時間後の外れは数えない
        sample(goal, 152),
      ];
      const result = evaluateDrill(DEMO_SCHOOL, DEMO_SPREAD, track(samples), { route });
      expect(result.evacuationSeconds).toBeNull();
      expect(result.lateEscape).toBe(true);
      expect(result.timeLimitSeconds).toBe(150);
      expect(result.offRoute).toEqual([
        { fromIndex: 1, toIndex: 1, fromSeconds: 100, toSeconds: 100 },
      ]);
    });

    it("集合場所に入らないまま終われば逃げ遅れ", () => {
      const samples = [sample(at(2, 2), 0), sample(at(2, 7), 60)];
      const result = evaluateDrill(DEMO_SCHOOL, DEMO_SPREAD, track(samples), { route });
      expect(result.evacuationSeconds).toBeNull();
      expect(result.lateEscape).toBe(true);
    });

    it("別の階の同じ (x, z) は集合場所ではない", () => {
      const samples = [sample(at(2, 2), 0), sample(at(8, 10, 1), 30)];
      expect(evaluateDrill(DEMO_SCHOOL, DEMO_SPREAD, track(samples)).lateEscape).toBe(true);
    });

    it("記録が空なら逃げ遅れで，ほかの評価は空", () => {
      expect(evaluateDrill(DEMO_SCHOOL, DEMO_SPREAD, track([]))).toEqual({
        offRoute: [],
        nearFire: [],
        smokeSeconds: 0,
        smokeCrouchRatio: null,
        smokePostureGood: null,
        smokeStanding: [],
        evacuationSeconds: null,
        timeLimitSeconds: 150,
        lateEscape: true,
      });
    });

    it("timeLimitSeconds は plan.drill.timeLimitSeconds の写し", () => {
      const plan = { ...DEMO_SCHOOL, drill: { ...DEMO_SCHOOL.drill, timeLimitSeconds: 90 } };
      expect(evaluateDrill(plan, DEMO_SPREAD, track([])).timeLimitSeconds).toBe(90);
    });

    it("記録のワールド座標は cellSize でマスに直す", () => {
      const plan = makePlan(["hhe", "##o"], {
        cellSize: 2,
        start: at(0, 0),
        assembly: [at(2, 1)],
      });
      // (2,1) のマスは x 4〜6 m・z 2〜4 m
      const samples: DrillSample[] = [
        { t: 0, floor: 0, x: 1, z: 1, posture: "standing" },
        { t: 5, floor: 0, x: 3.9, z: 3.9, posture: "standing" }, // (1,1)．集合場所ではない
        { t: 6, floor: 0, x: 4.1, z: 2.1, posture: "standing" }, // (2,1)
      ];
      const result = evaluateDrill(plan, computeSpread(plan), track(samples));
      expect(result.evacuationSeconds).toBe(6);
    });
  });

  describe("火に近づいた点（nearFire）", () => {
    it("燃えているマスから 1 マス以内に入った瞬間だけを記録する（いる間は続けて数えない）", () => {
      const samples = [
        sample(at(6, 0), 10), // 遠い
        sample(at(8, 0), 10.2), // 火元 (9,0) の隣に入った
        sample(at(8, 0), 10.4),
        sample(at(7, 0), 10.6), // 離れた
        sample(at(8, 0), 10.8), // また入った
        sample(at(8, 0), 11),
      ];
      expect(smoky(samples).nearFire).toEqual([
        { index: 1, t: 10.2, floor: 0, x: 8.5, z: 0.5 },
        { index: 4, t: 10.8, floor: 0, x: 8.5, z: 0.5 },
      ]);
    });

    it("まだ燃えていないマスの隣は近づいたことにならない", () => {
      // (8,0) が燃えるのは 100 秒
      const result = smoky([sample(at(7, 0), 20), sample(at(7, 0), 100)]);
      expect(result.nearFire).toEqual([{ index: 1, t: 100, floor: 0, x: 7.5, z: 0.5 }]);
    });

    it("t < 0 の記録は数えず，0 秒の時点で近くにいればそこで記録する", () => {
      const result = smoky([sample(at(8, 0), -1), sample(at(8, 0), 0), sample(at(8, 0), 1)]);
      expect(result.nearFire).toEqual([{ index: 1, t: 0, floor: 0, x: 8.5, z: 0.5 }]);
    });

    it("集合場所に着いた後の記録は数えない", () => {
      const result = smoky([sample(at(0, 0), 0), sample(at(0, 2), 5), sample(at(8, 0), 6)]);
      expect(result.nearFire).toEqual([]);
    });

    it("制限時間を過ぎた後の記録は数えない", () => {
      const plan = makePlan(["hhhhhhhhhh", "e#########", "oooooooooo"], {
        ...SMOKY.drill,
        timeLimitSeconds: 20,
        spread: SMOKY.drill.spread,
      });
      expect(smoky([sample(at(6, 0), 19), sample(at(8, 0), 21)], plan).nearFire).toEqual([]);
    });
  });

  describe("煙の中での姿勢", () => {
    it("煙の中にいた時間を次の記録までの間隔で数え，しゃがんでいた割合を出す", () => {
      // (5,0) に煙が着くのは 4 秒
      const result = smoky([
        sample(at(5, 0), 10, "crouching"),
        sample(at(5, 0), 11, "crouching"),
        sample(at(4, 0), 12, "crouching"),
        sample(at(4, 0), 13, "standing"),
        sample(at(0, 2), 14), // 集合場所（煙なし）
      ]);
      expect(result.smokeSeconds).toBe(4);
      expect(result.smokeCrouchRatio).toBe(0.75);
      expect(result.smokePostureGood).toBe(true);
      expect(result.smokeStanding).toEqual([
        { fromIndex: 3, toIndex: 3, fromSeconds: 13, toSeconds: 13 },
      ]);
      expect(result.evacuationSeconds).toBe(14);
    });

    it(`記録の間隔は ${TRACK_MAX_SAMPLE_GAP_SECONDS} 秒までしか数えない`, () => {
      expect(TRACK_MAX_SAMPLE_GAP_SECONDS).toBe(1);
      const result = smoky([
        sample(at(5, 0), 10, "crouching"), // 次まで 5 秒 → 1 秒
        sample(at(5, 0), 15, "standing"), // 次まで 0.5 秒
        sample(at(0, 2), 15.5),
      ]);
      expect(result.smokeSeconds).toBeCloseTo(1.5);
      expect(result.smokeCrouchRatio).toBeCloseTo(2 / 3);
      expect(result.smokePostureGood).toBe(false);
    });

    it("煙が着く前の時刻にそのマスにいても，煙の中ではない", () => {
      // (5,0) は 4 秒に煙が着く．3.5〜4 秒は煙の外，4 秒からは煙の中
      const result = smoky([
        sample(at(5, 0), 3.5, "standing"),
        sample(at(5, 0), 4, "crouching"),
        sample(at(0, 2), 4.5),
      ]);
      expect(result.smokeSeconds).toBe(0.5);
      expect(result.smokeCrouchRatio).toBe(1);
      expect(result.smokeStanding).toEqual([]);
    });

    it(`しゃがんでいた割合がちょうど ${SMOKE_CROUCH_GOOD_RATIO} なら「できた」`, () => {
      expect(SMOKE_CROUCH_GOOD_RATIO).toBe(0.7);
      const samples: DrillSample[] = [];
      for (let i = 0; i < 10; i++) {
        samples.push(sample(at(5, 0), 10 + i * 0.5, i < 7 ? "crouching" : "standing"));
      }
      samples.push(sample(at(0, 2), 15));
      const result = smoky(samples);
      expect(result.smokeSeconds).toBe(5);
      expect(result.smokeCrouchRatio).toBe(0.7);
      expect(result.smokePostureGood).toBe(true);
      expect(result.smokeStanding).toEqual([
        { fromIndex: 7, toIndex: 9, fromSeconds: 13.5, toSeconds: 14.5 },
      ]);
    });

    it("しゃがんでいた割合が 0.7 に届かなければ「できた」ではない", () => {
      const samples: DrillSample[] = [];
      for (let i = 0; i < 10; i++) {
        samples.push(sample(at(5, 0), 10 + i * 0.5, i < 6 ? "crouching" : "standing"));
      }
      samples.push(sample(at(0, 2), 15));
      const result = smoky(samples);
      expect(result.smokeCrouchRatio).toBeCloseTo(0.6);
      expect(result.smokePostureGood).toBe(false);
    });

    it("煙の中にいなければ，割合と「できた」は null", () => {
      const result = smoky([sample(at(5, 0), 0), sample(at(5, 0), 1), sample(at(0, 2), 2)]);
      expect(result.smokeSeconds).toBe(0);
      expect(result.smokeCrouchRatio).toBeNull();
      expect(result.smokePostureGood).toBeNull();
      expect(result.smokeStanding).toEqual([]);
    });

    it("集合場所に着いた後に煙の中にいても数えない", () => {
      const result = smoky([
        sample(at(5, 0), 10, "crouching"),
        sample(at(0, 2), 11),
        sample(at(5, 0), 12, "standing"),
        sample(at(5, 0), 13, "standing"),
      ]);
      expect(result.smokeSeconds).toBe(1);
      expect(result.smokeCrouchRatio).toBe(1);
      expect(result.smokeStanding).toEqual([]);
    });

    it("制限時間の後の煙の中の時間は数えない", () => {
      const plan = makePlan(["hhhhhhhhhh", "e#########", "oooooooooo"], {
        ...SMOKY.drill,
        timeLimitSeconds: 20,
        spread: SMOKY.drill.spread,
      });
      const result = smoky(
        [
          sample(at(5, 0), 19, "crouching"),
          sample(at(5, 0), 20, "crouching"),
          sample(at(5, 0), 21, "standing"),
          sample(at(5, 0), 22, "standing"),
        ],
        plan,
      );
      expect(result.smokeSeconds).toBe(1);
      expect(result.smokeCrouchRatio).toBe(1);
      expect(result.smokeStanding).toEqual([]);
      expect(result.lateEscape).toBe(true);
    });
  });
});
