// 火災訓練のシナリオ（docs/04_SPEC/SPEC_01「VR 避難の規則」「火災訓練のシナリオ」）のテスト．
// 期待値は仕様（SPEC_01・SPEC_02・PLAN_04「体験の流れ」）から決める
import { describe, expect, it } from "vitest";
import type { Cue } from "../core/cue";
import type { GameEvent } from "../core/events";
import type { CellRef, SchoolPlan } from "../core/schoolPlan";
import { DEMO_SCHOOL } from "../share/samples/demoSchool";
import { createFloorFromRows } from "../share/samples/floorFromRows";
import {
  ASSEMBLY_AREA_ID,
  buildDrillScenario,
  DRILL_CUE_ID,
  DRILL_STEP,
  FIRE_ANNOUNCEMENT_ENDED_SIGNAL,
  fireOriginName,
} from "./drill";
import { advance, startScenario, toResult, validateScenario } from "./engine";
import type {
  ScenarioDefinition,
  ScenarioEffect,
  ScenarioInput,
  ScenarioState,
  StepDefinition,
} from "./types";

// ---- テスト用のデータ ----

const at = (x: number, z: number, floor = 0): CellRef => ({ floor, x, z });

/** デモの校舎を元に，一部だけ上書きした校舎を作る */
function plan(
  over: Partial<Omit<SchoolPlan, "drill">> & { drill?: Partial<SchoolPlan["drill"]> } = {},
): SchoolPlan {
  const { drill, ...rest } = over;
  return { ...DEMO_SCHOOL, ...rest, drill: { ...DEMO_SCHOOL.drill, ...drill } };
}

/**
 * 小さな校舎（1 階．x: 0〜6，z: 0〜2）．
 * 0・1 は教室，h 廊下，d ドア，s シャッター，e 出口，o 屋外，# 壁，. 何もない
 */
const SMALL_ROWS = [
  "001#11.", // z = 0
  "hdhshe#", // z = 1
  "ooooooo", // z = 2
];

function smallPlan(
  fireOrigins: readonly CellRef[],
  rooms: SchoolPlan["rooms"] = [{ name: "3年1組" }, { name: "音楽室" }],
): SchoolPlan {
  return plan({
    floors: [createFloorFromRows(1, SMALL_ROWS)],
    rooms,
    drill: { fireOrigins, start: at(0, 0), assembly: [at(3, 2)], route: [] },
  });
}

const input = (over: Partial<ScenarioInput> = {}): ScenarioInput => ({
  posture: "standing",
  walking: false,
  areaIds: [],
  ...over,
});

const DT = 0.1;
const AT_ASSEMBLY = input({ areaIds: [ASSEMBLY_AREA_ID] });

/** シナリオを毎フレーム進めた記録 */
interface Run {
  state: ScenarioState;
  effects: ScenarioEffect[];
}

/** 条件を満たすか終了するまで（最大 maxSeconds 秒）進める */
function runUntil(
  def: ScenarioDefinition,
  from: Run,
  stop: (s: ScenarioState) => boolean,
  inp: (s: ScenarioState) => ScenarioInput = () => input(),
  events: (s: ScenarioState) => readonly GameEvent[] = () => [],
  maxSeconds = 600,
): Run {
  let s = from.state;
  const effects = [...from.effects];
  for (let i = 0; i < Math.round(maxSeconds / DT); i++) {
    if (stop(s) || s.status === "finished") break;
    const r = advance(def, s, inp(s), events(s), DT);
    s = r.state;
    effects.push(...r.effects);
  }
  return { state: s, effects };
}

function start(def: ScenarioDefinition): Run {
  const r = startScenario(def);
  return { state: r.state, effects: [...r.effects] };
}

const stepOf = (def: ScenarioDefinition, id: string): StepDefinition => {
  const step = def.steps.find((s) => s.id === id);
  if (step === undefined) throw new Error(`場面 ${id} がありません`);
  return step;
};

/** 場面に入った時に出た Cue（stepEntered の直後から次の stepEntered／stepFinished までの cue） */
function cuesOnEnter(effects: readonly ScenarioEffect[], stepId: string): Cue[] {
  const index = effects.findIndex((e) => e.type === "stepEntered" && e.stepId === stepId);
  if (index < 0) return [];
  const cues: Cue[] = [];
  for (const e of effects.slice(index + 1)) {
    if (e.type !== "cue") break;
    cues.push(e.cue);
  }
  return cues;
}

const cues = (effects: readonly ScenarioEffect[]): Cue[] =>
  effects.flatMap((e) => (e.type === "cue" ? [e.cue] : []));

/** 到着するまで: ③ に入ってから waitSeconds 秒たったら集合場所に立つ */
function arriveAfter(waitSeconds: number) {
  let evacuateFrames = 0;
  return (s: ScenarioState): ScenarioInput => {
    if (s.stepId !== DRILL_STEP.evacuate) return input();
    evacuateFrames++;
    return evacuateFrames * DT > waitSeconds ? AT_ASSEMBLY : input();
  };
}

const finished = (s: ScenarioState) => s.status === "finished";

// ---- テスト ----

describe("buildDrillScenario", () => {
  describe("定義の整合性", () => {
    it("デモの校舎で validateScenario が空配列を返す", () => {
      expect(validateScenario(buildDrillScenario(DEMO_SCHOOL))).toEqual([]);
    });

    it("場面は classroom → alarm → evacuate → ending の順に並ぶ", () => {
      const def = buildDrillScenario(DEMO_SCHOOL);
      expect(def.steps.map((s) => s.id)).toEqual(["classroom", "alarm", "evacuate", "ending"]);
      expect(DRILL_STEP).toEqual({
        classroom: "classroom",
        alarm: "alarm",
        evacuate: "evacuate",
        ending: "ending",
      });
    });

    it("id は fire-drill，題名に校舎の名前が入る", () => {
      const def = buildDrillScenario(DEMO_SCHOOL);
      expect(def.id).toBe("fire-drill");
      expect(def.title).toContain(DEMO_SCHOOL.name);
    });

    it("校舎の名前が空なら題名は「火災避難訓練」", () => {
      expect(buildDrillScenario(plan({ name: "" })).title).toBe("火災避難訓練");
    });

    it("シナリオ全体の制限時間は付けない（③ の制限時間で打ち切る）", () => {
      expect(buildDrillScenario(DEMO_SCHOOL).timeLimitSeconds).toBeUndefined();
    });

    it("③ の求める動作は集合場所（assembly）に 1 秒いる", () => {
      expect(stepOf(buildDrillScenario(DEMO_SCHOOL), "evacuate").goal).toEqual({
        type: "inArea",
        areaId: "assembly",
        holdSeconds: 1,
      });
    });

    it("③ の時間切れの行き先は null（締めに進まない），締めの行き先も null", () => {
      const def = buildDrillScenario(DEMO_SCHOOL);
      expect(stepOf(def, "evacuate").timeout?.next).toBeNull();
      expect(stepOf(def, "ending").next).toBeNull();
    });

    it("結果画面の見出し（report）は evacuate にだけ付く", () => {
      const def = buildDrillScenario(DEMO_SCHOOL);
      expect(def.steps.filter((s) => s.report !== undefined).map((s) => s.id)).toEqual([
        "evacuate",
      ]);
      expect(stepOf(def, "evacuate").report?.label).not.toBe("");
    });

    it("煙・火の評価は checks に書かない（evaluateDrill で求める）", () => {
      for (const step of buildDrillScenario(DEMO_SCHOOL).steps) {
        expect(step.checks ?? []).toEqual([]);
      }
    });

    it.each([
      { timeLimitSeconds: 150, expected: 142 },
      { timeLimitSeconds: 9, expected: 1 },
      { timeLimitSeconds: 8.5, expected: 1 },
      { timeLimitSeconds: 8, expected: 1 },
      { timeLimitSeconds: 1, expected: 1 },
      { timeLimitSeconds: 0, expected: 1 },
    ])(
      "③ の制限時間は timeLimitSeconds（$timeLimitSeconds）から 8 秒を引き，下限 1 秒（$expected）",
      ({ timeLimitSeconds, expected }) => {
        const def = buildDrillScenario(plan({ drill: { timeLimitSeconds } }));
        expect(stepOf(def, "evacuate").timeout?.seconds).toBe(expected);
        expect(validateScenario(def)).toEqual([]);
      },
    );
  });

  describe("各場面の開始時の演出", () => {
    it("① 教室: 環境音をループで鳴らし，導入のナレーション", () => {
      const r = start(buildDrillScenario(DEMO_SCHOOL));
      expect(r.state.stepId).toBe("classroom");
      expect(cuesOnEnter(r.effects, "classroom")).toEqual([
        { type: "sound", id: DRILL_CUE_ID.classroomAmbience, action: "play", loop: true },
        { type: "narration", id: DRILL_CUE_ID.classroomIntro },
      ]);
    });

    it("② 非常ベル: 環境音を止め，ベルをループで鳴らし，出火・校内放送を出す", () => {
      const def = buildDrillScenario(DEMO_SCHOOL);
      const r = runUntil(def, start(def), (s) => s.stepId === "alarm");
      const entered = cuesOnEnter(r.effects, "alarm");
      expect(entered).toContainEqual({
        type: "sound",
        id: DRILL_CUE_ID.classroomAmbience,
        action: "stop",
      });
      expect(entered).toContainEqual({
        type: "sound",
        id: DRILL_CUE_ID.fireAlarm,
        action: "play",
        loop: true,
      });
      expect(entered.some((c) => c.type === "happening" && c.id === "fire-start")).toBe(true);
      expect(entered.some((c) => c.type === "narration" && c.id === "fire-announcement")).toBe(
        true,
      );
    });

    // 仮の形（ユーザー承認済み）: 本来は SPEC_01 のとおり fire-announcement の narration の params に
    // 火元の名前を載せるが，core の Cue の narration にまだ params が無いため fire-start の params に載せている
    it("② 非常ベル: 【仮の形】fire-start の params.roomName に火元の名前（デモは理科室）が入る", () => {
      const def = buildDrillScenario(DEMO_SCHOOL);
      const fireStart = stepOf(def, "alarm").onEnter?.find(
        (c) => c.type === "happening" && c.id === "fire-start",
      );
      expect(fireStart).toEqual({
        type: "happening",
        id: "fire-start",
        params: { roomName: "理科室" },
      });
    });

    it("② 非常ベル: 【仮の形】fire-start の roomName は fireOriginName と同じ", () => {
      const p = smallPlan([at(4, 0), at(0, 0)]);
      const fireStart = stepOf(buildDrillScenario(p), "alarm").onEnter?.find(
        (c) => c.type === "happening",
      );
      expect(fireStart?.type === "happening" && fireStart.params?.roomName).toBe(fireOriginName(p));
    });

    it("③ 避難: 「火と煙を避けて校庭へ」のナレーション", () => {
      const def = buildDrillScenario(DEMO_SCHOOL);
      const r = runUntil(def, start(def), (s) => s.stepId === "evacuate");
      expect(cuesOnEnter(r.effects, "evacuate")).toEqual([
        { type: "narration", id: DRILL_CUE_ID.evacuateStart },
      ]);
    });

    it("締め: 非常ベルを止めて締めのナレーション", () => {
      const def = buildDrillScenario(DEMO_SCHOOL);
      const r = runUntil(def, start(def), (s) => s.stepId === "ending", arriveAfter(0));
      expect(cuesOnEnter(r.effects, "ending")).toEqual([
        { type: "sound", id: DRILL_CUE_ID.fireAlarm, action: "stop" },
        { type: "narration", id: DRILL_CUE_ID.ending },
      ]);
    });
  });

  describe("進み方", () => {
    it("① は 10 秒たつと ② に進む（10 秒より前は進まない）", () => {
      const def = buildDrillScenario(DEMO_SCHOOL);
      const before = runUntil(def, start(def), (s) => s.totalElapsed >= 9.85);
      expect(before.state.stepId).toBe("classroom");
      const r = runUntil(def, before, (s) => s.stepId !== "classroom");
      expect(r.state.stepId).toBe("alarm");
      // 浮動小数の誤差で 1 フレーム長くなることがある
      expect(r.state.steps[0].durationSeconds).toBeGreaterThanOrEqual(10 - 1e-9);
      expect(r.state.steps[0].durationSeconds).toBeLessThanOrEqual(10 + DT + 1e-9);
      expect(r.state.steps[0].outcome).toBe("completed");
    });

    it("② は放送の終わり（signal）が届かなければ 8 秒で ③ に進む", () => {
      const def = buildDrillScenario(DEMO_SCHOOL);
      const r = runUntil(def, start(def), (s) => s.stepId === "evacuate");
      const alarm = r.state.steps.find((s) => s.stepId === "alarm");
      expect(alarm?.outcome).toBe("completed");
      expect(alarm?.durationSeconds).toBeGreaterThanOrEqual(8 - 1e-9);
      expect(alarm?.durationSeconds).toBeLessThanOrEqual(8 + DT + 1e-9);
    });

    it("② は放送の終わり（narration-ended:fire-announcement）が届くと 8 秒より前に ③ に進む", () => {
      expect(FIRE_ANNOUNCEMENT_ENDED_SIGNAL).toBe("narration-ended:fire-announcement");
      const def = buildDrillScenario(DEMO_SCHOOL);
      let r = runUntil(def, start(def), (s) => s.stepId === "alarm");
      // 2 秒たってから放送の終わりを送る
      r = runUntil(def, r, (s) => s.stepElapsed >= 2 - 1e-9);
      expect(r.state.stepId).toBe("alarm");
      const sent = advance(
        def,
        r.state,
        input(),
        [{ type: "signal", name: FIRE_ANNOUNCEMENT_ENDED_SIGNAL }],
        DT,
      );
      expect(sent.state.stepId).toBe("evacuate");
      const alarm = sent.state.steps.find((s) => s.stepId === "alarm");
      expect(alarm?.outcome).toBe("completed");
      expect(alarm?.durationSeconds).toBeLessThan(3);
    });

    it("② で別の signal が届いても進まない", () => {
      const def = buildDrillScenario(DEMO_SCHOOL);
      let r = runUntil(def, start(def), (s) => s.stepId === "alarm");
      r = runUntil(
        def,
        r,
        (s) => s.stepElapsed >= 3,
        () => input(),
        () => [{ type: "signal", name: "narration-ended:classroom-intro" }],
      );
      expect(r.state.stepId).toBe("alarm");
    });

    it("集合場所に着くと 4 場面が順に completed になって終わる（打ち切りではない）", () => {
      const def = buildDrillScenario(DEMO_SCHOOL);
      const r = runUntil(def, start(def), finished, arriveAfter(60));
      expect(r.state.status).toBe("finished");
      expect(r.state.aborted).toBe(false);
      expect(r.state.steps.map((s) => [s.stepId, s.outcome])).toEqual([
        ["classroom", "completed"],
        ["alarm", "completed"],
        ["evacuate", "completed"],
        ["ending", "completed"],
      ]);
      // 10 + 8 + (60 + 1) + 3 ≒ 82 秒（フレームの分の誤差を許す）
      expect(r.state.totalElapsed).toBeGreaterThan(82 - 0.5);
      expect(r.state.totalElapsed).toBeLessThan(82 + 1);
      const ending = r.state.steps[3];
      expect(ending.durationSeconds).toBeGreaterThanOrEqual(3 - 1e-9);
      expect(ending.durationSeconds).toBeLessThanOrEqual(3 + DT + 1e-9);
      expect(r.effects.at(-1)).toEqual({ type: "finished" });
    });

    it("集合場所に 1 秒いないと避難完了にならない（入ってすぐ出たら ③ のまま）", () => {
      const def = buildDrillScenario(DEMO_SCHOOL);
      let r = runUntil(def, start(def), (s) => s.stepId === "evacuate");
      r = runUntil(
        def,
        r,
        (s) => s.stepElapsed >= 0.5 - 1e-9,
        () => AT_ASSEMBLY,
      );
      r = runUntil(def, r, (s) => s.stepElapsed >= 5);
      expect(r.state.stepId).toBe("evacuate");
    });

    it("集合場所以外のエリア（outdoor 等）にいても避難完了にならない", () => {
      const def = buildDrillScenario(DEMO_SCHOOL);
      const r = runUntil(
        def,
        start(def),
        (s) => s.stepId === "evacuate" && s.stepElapsed >= 10,
        () => input({ areaIds: ["outdoor", "corridor", "room:0"] }),
      );
      expect(r.state.stepId).toBe("evacuate");
    });

    it("着かなければ ③ の制限時間で evacuate が timedOut になり，締めに進まず終わる", () => {
      const def = buildDrillScenario(DEMO_SCHOOL);
      const r = runUntil(def, start(def), finished);
      expect(r.state.status).toBe("finished");
      expect(r.state.aborted).toBe(false);
      expect(r.state.steps.map((s) => [s.stepId, s.outcome])).toEqual([
        ["classroom", "completed"],
        ["alarm", "completed"],
        ["evacuate", "timedOut"],
      ]);
      expect(r.effects.some((e) => e.type === "stepEntered" && e.stepId === "ending")).toBe(false);
      expect(cues(r.effects).some((c) => c.id === DRILL_CUE_ID.ending)).toBe(false);
      const evacuate = r.state.steps[2];
      expect(evacuate.durationSeconds).toBeGreaterThanOrEqual(142 - 1e-9);
      expect(evacuate.durationSeconds).toBeLessThanOrEqual(142 + DT + 1e-9);
      // 非常ベル（② の開始）から timeLimitSeconds（150 秒）で打ち切られる
      const fromAlarm = r.state.totalElapsed - r.state.steps[1].startedAt;
      expect(fromAlarm).toBeGreaterThan(150 - 0.5);
      expect(fromAlarm).toBeLessThan(150 + 0.5);
    });

    it("時間切れの時は非常ベルを止める", () => {
      const def = buildDrillScenario(DEMO_SCHOOL);
      let r = runUntil(def, start(def), (s) => s.stepId === "evacuate");
      const beforeTimeout = r.effects.length;
      r = runUntil(def, r, finished);
      expect(cues(r.effects.slice(beforeTimeout))).toContainEqual({
        type: "sound",
        id: DRILL_CUE_ID.fireAlarm,
        action: "stop",
      });
    });

    it("結果（toResult）で逃げ遅れが evacuate の timedOut として読め，report の見出しが付く", () => {
      const def = buildDrillScenario(DEMO_SCHOOL);
      const r = runUntil(def, start(def), finished);
      const result = toResult(def, r.state);
      expect(result.scenarioId).toBe("fire-drill");
      expect(result.aborted).toBe(false);
      const evacuate = result.steps.find((s) => s.stepId === "evacuate");
      expect(evacuate?.outcome).toBe("timedOut");
      expect(evacuate?.label).toBe(stepOf(def, "evacuate").report?.label);
    });

    it("③ の制限時間ちょうどに避難完了した（達成と時間切れが同じフレーム）なら completed で締めに進む", () => {
      // timeLimitSeconds 10 → ③ の制限時間 2 秒．dt = 1 で，1 秒目は外，2 秒目に集合場所（1 秒いた）
      const def = buildDrillScenario(plan({ drill: { timeLimitSeconds: 10 } }));
      const r = runUntil(def, start(def), (s) => s.stepId === "evacuate");
      const outside = advance(def, r.state, input(), [], 1).state;
      expect(outside.stepId).toBe("evacuate");
      const arrived = advance(def, outside, AT_ASSEMBLY, [], 1);
      expect(arrived.state.stepId).toBe("ending");
      const evacuate = arrived.state.steps.find((s) => s.stepId === "evacuate");
      expect(evacuate?.outcome).toBe("completed");
      expect(evacuate?.durationSeconds).toBe(2);
    });

    it("timeLimitSeconds が 8 以下でも ③ が 1 秒で時間切れになり止まらない", () => {
      const def = buildDrillScenario(plan({ drill: { timeLimitSeconds: 5 } }));
      const r = runUntil(def, start(def), finished);
      expect(r.state.status).toBe("finished");
      const evacuate = r.state.steps.find((s) => s.stepId === "evacuate");
      expect(evacuate?.outcome).toBe("timedOut");
      expect(evacuate?.durationSeconds).toBeGreaterThanOrEqual(1 - 1e-9);
      expect(evacuate?.durationSeconds).toBeLessThanOrEqual(1 + DT + 1e-9);
    });
  });

  describe("純粋性", () => {
    it("入力の plan を変更しない", () => {
      const p = structuredClone(smallPlan([at(4, 0), at(0, 0)]));
      const before = structuredClone(p);
      buildDrillScenario(p);
      fireOriginName(p);
      expect(p).toEqual(before);
    });

    it("凍結した plan でも例外を投げない", () => {
      const deepFreeze = <T>(o: T): T => {
        if (o !== null && typeof o === "object") {
          Object.values(o as object).forEach(deepFreeze);
          Object.freeze(o);
        }
        return o;
      };
      const p = deepFreeze(structuredClone(DEMO_SCHOOL));
      expect(() => buildDrillScenario(p)).not.toThrow();
    });

    it("同じ plan から同じ定義を作る", () => {
      expect(buildDrillScenario(DEMO_SCHOOL)).toEqual(buildDrillScenario(DEMO_SCHOOL));
    });
  });
});

describe("fireOriginName", () => {
  it("デモの校舎の火元は「理科室」", () => {
    expect(fireOriginName(DEMO_SCHOOL)).toBe("理科室");
  });

  it.each([
    { name: "教室の火元は教室名", origins: [at(4, 0)], expected: "音楽室" },
    {
      name: "複数の教室は火元の順に「と」でつなぐ",
      origins: [at(4, 0), at(0, 0)],
      expected: "音楽室と3年1組",
    },
    {
      name: "同じ教室に複数の火元があっても名前は 1 回",
      origins: [at(0, 0), at(1, 0), at(0, 0)],
      expected: "3年1組",
    },
    {
      name: "同じ教室の重なりを除いて順を保つ",
      origins: [at(0, 0), at(4, 0), at(1, 0)],
      expected: "3年1組と音楽室",
    },
    {
      name: "教室と廊下が混ざれば教室名だけ",
      origins: [at(0, 1), at(5, 0)],
      expected: "音楽室",
    },
    { name: "廊下は「廊下」", origins: [at(0, 1)], expected: "廊下" },
    { name: "ドアは「廊下」", origins: [at(1, 1)], expected: "廊下" },
    { name: "シャッターは「廊下」", origins: [at(3, 1)], expected: "廊下" },
    { name: "出口は「昇降口」", origins: [at(5, 1)], expected: "昇降口" },
    { name: "屋外は「校庭」", origins: [at(0, 2)], expected: "校庭" },
    { name: "壁は「校舎の中」", origins: [at(3, 0)], expected: "校舎の中" },
    { name: "何もないマスは「校舎の中」", origins: [at(6, 0)], expected: "校舎の中" },
    {
      name: "教室でない火元が複数なら最初の火元で決める",
      origins: [at(5, 1), at(0, 2)],
      expected: "昇降口",
    },
    { name: "x が範囲外は「校舎の中」", origins: [at(7, 0)], expected: "校舎の中" },
    { name: "x が負は「校舎の中」", origins: [at(-1, 0)], expected: "校舎の中" },
    { name: "z が範囲外は「校舎の中」", origins: [at(0, 3)], expected: "校舎の中" },
    { name: "存在しない階は「校舎の中」", origins: [at(0, 0, 1)], expected: "校舎の中" },
    { name: "火元が空なら「校舎の中」", origins: [], expected: "校舎の中" },
    {
      name: "範囲外の火元は飛ばして教室の火元の名前を使う",
      origins: [at(99, 99), at(4, 0)],
      expected: "音楽室",
    },
  ])("$name", ({ origins, expected }) => {
    expect(fireOriginName(smallPlan(origins))).toBe(expected);
  });

  it("教室名が空なら教室の火元として扱わず，マスの種類の名前にもならない", () => {
    const p = smallPlan([at(0, 0)], [{ name: "" }, { name: "音楽室" }]);
    const name = fireOriginName(p);
    expect(name).not.toBe("");
    expect(name).not.toContain("と");
  });

  it("教室名が空の教室と名前のある教室なら，名前のある教室だけ", () => {
    const p = smallPlan([at(0, 0), at(4, 0)], [{ name: "" }, { name: "音楽室" }]);
    expect(fireOriginName(p)).toBe("音楽室");
  });

  it("roomOf が rooms の範囲外を指しても例外を投げない", () => {
    const p = smallPlan([at(4, 0)], [{ name: "3年1組" }]);
    expect(() => fireOriginName(p)).not.toThrow();
    expect(fireOriginName(p)).not.toBe("");
  });
});
