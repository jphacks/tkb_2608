// 進行エンジンの契約（docs/04_SPEC/SPEC_01「シナリオ定義の形式」）のテスト
import { describe, expect, it } from "vitest";
import type { Cue } from "../core/cue";
import type { GameEvent } from "../core/events";
import { advance, startScenario, toResult, validateScenario } from "./engine";
import type {
  Condition,
  ScenarioDefinition,
  ScenarioEffect,
  ScenarioInput,
  ScenarioState,
  StepDefinition,
} from "./types";

// ---- テスト用の小道具 ----

const input = (over: Partial<ScenarioInput> = {}): ScenarioInput => ({
  posture: "standing",
  walking: false,
  areaIds: [],
  ...over,
});

const narration = (id: string): Cue => ({ type: "narration", id });

const never: Condition = { type: "signal", name: "never" };

function def(steps: StepDefinition[], extra: Partial<ScenarioDefinition> = {}): ScenarioDefinition {
  return { id: "test", title: "テスト", steps, ...extra };
}

/** 同じ入力で n フレーム進め，状態とすべての effects を返す */
function run(
  d: ScenarioDefinition,
  state: ScenarioState,
  frames: number,
  dt: number,
  inp: ScenarioInput = input(),
  events: readonly GameEvent[] = [],
): { state: ScenarioState; effects: ScenarioEffect[] } {
  const effects: ScenarioEffect[] = [];
  let s = state;
  for (let i = 0; i < frames; i++) {
    const r = advance(d, s, inp, events, dt);
    s = r.state;
    effects.push(...r.effects);
  }
  return { state: s, effects };
}

const cueIds = (effects: readonly ScenarioEffect[]): string[] =>
  effects.flatMap((e) => (e.type === "cue" && "id" in e.cue ? [e.cue.id] : []));

const effectTypes = (effects: readonly ScenarioEffect[]): string[] => effects.map((e) => e.type);

function deepFreeze<T>(value: T): T {
  if (value !== null && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const v of Object.values(value)) deepFreeze(v);
  }
  return value;
}

// ---- startScenario ----

describe("startScenario", () => {
  it("最初の場面に入った状態と，stepEntered・onEnter の演出を返す", () => {
    const d = def([
      { id: "a", onEnter: [narration("a1"), narration("a2")], goal: never },
      { id: "b", goal: never },
    ]);
    const { state, effects } = startScenario(d);

    expect(state.status).toBe("running");
    expect(state.stepId).toBe("a");
    expect(state.stepElapsed).toBe(0);
    expect(state.totalElapsed).toBe(0);
    expect(state.steps).toEqual([]);
    expect(state.evaluations).toEqual([]);
    expect(state.aborted).toBe(false);
    expect(effects).toEqual([
      { type: "stepEntered", stepId: "a" },
      { type: "cue", cue: narration("a1") },
      { type: "cue", cue: narration("a2") },
    ]);
  });

  it("場面が空のシナリオはすぐ終了する", () => {
    const { state, effects } = startScenario(def([]));
    expect(state.status).toBe("finished");
    expect(state.stepId).toBeNull();
    expect(effectTypes(effects)).toEqual(["finished"]);
  });
});

// ---- advance: 基本 ----

describe("advance の基本", () => {
  it("目標を満たすまでは同じ場面にとどまり，経過時間が増える", () => {
    const d = def([{ id: "a", goal: never }]);
    const { state, effects } = run(d, startScenario(d).state, 3, 0.5);
    expect(state.stepId).toBe("a");
    expect(state.stepElapsed).toBeCloseTo(1.5);
    expect(state.totalElapsed).toBeCloseTo(1.5);
    expect(effects).toEqual([]);
  });

  it("目標を満たすと onComplete → stepFinished(completed) → 次の stepEntered → onEnter の順に出す", () => {
    const d = def([
      { id: "a", goal: { type: "elapsed", seconds: 1 }, onComplete: [narration("good")] },
      { id: "b", onEnter: [narration("b-enter")], goal: never },
    ]);
    const s0 = startScenario(d).state;
    const { state, effects } = advance(d, s0, input(), [], 1);

    expect(effectTypes(effects)).toEqual(["cue", "stepFinished", "stepEntered", "cue"]);
    expect(cueIds(effects)).toEqual(["good", "b-enter"]);
    const finished = effects[1];
    expect(finished.type === "stepFinished" && finished.record.outcome).toBe("completed");
    expect(state.stepId).toBe("b");
    expect(state.stepElapsed).toBe(0);
    expect(state.totalElapsed).toBe(1);
  });

  it("next を省略すると配列の次の場面へ，最後の場面の後は終了する", () => {
    const d = def([
      { id: "a", goal: { type: "elapsed", seconds: 0 } },
      { id: "b", goal: { type: "elapsed", seconds: 0 } },
    ]);
    let s = startScenario(d).state;
    s = advance(d, s, input(), [], 0.1).state;
    expect(s.stepId).toBe("b");
    const r = advance(d, s, input(), [], 0.1);
    expect(r.state.status).toBe("finished");
    expect(r.state.stepId).toBeNull();
    expect(r.state.aborted).toBe(false);
    expect(effectTypes(r.effects)).toEqual(["stepFinished", "finished"]);
  });

  it("next に ID を書くとその場面へ飛ぶ", () => {
    const d = def([
      { id: "a", goal: { type: "elapsed", seconds: 0 }, next: "c" },
      { id: "b", goal: never },
      { id: "c", goal: never },
    ]);
    const s = advance(d, startScenario(d).state, input(), [], 0.1).state;
    expect(s.stepId).toBe("c");
  });

  it("next: null で配列の途中でも終了する", () => {
    const d = def([
      { id: "a", goal: { type: "elapsed", seconds: 0 }, next: null },
      { id: "b", goal: never },
    ]);
    const r = advance(d, startScenario(d).state, input(), [], 0.1);
    expect(r.state.status).toBe("finished");
    expect(r.state.steps.map((x) => x.stepId)).toEqual(["a"]);
  });

  it("終了後に advance しても状態は変わらず effects も出ない", () => {
    const d = def([{ id: "a", goal: { type: "elapsed", seconds: 0 } }]);
    const done = advance(d, startScenario(d).state, input(), [], 0.1).state;
    expect(done.status).toBe("finished");
    const r = advance(d, done, input(), [{ type: "signal", name: "x" }], 1);
    expect(r.state).toEqual(done);
    expect(r.effects).toEqual([]);
  });

  it("場面の切り替えは 1 フレームに 1 回まで（次の場面の目標がすぐ満たせても同じフレームでは進まない）", () => {
    const d = def([
      { id: "a", goal: { type: "elapsed", seconds: 0 } },
      { id: "b", goal: { type: "elapsed", seconds: 0 } },
      { id: "c", goal: never },
    ]);
    let s = startScenario(d).state;
    const r1 = advance(d, s, input(), [], 0.1);
    s = r1.state;
    expect(s.stepId).toBe("b");
    expect(r1.effects.filter((e) => e.type === "stepEntered")).toHaveLength(1);
    s = advance(d, s, input(), [], 0.1).state;
    expect(s.stepId).toBe("c");
  });

  it("場面に入ると途中経過（継続時間・ラッチ・助言・評価）がリセットされる", () => {
    const d = def([
      {
        id: "a",
        goal: { type: "signal", name: "go" },
        hints: [{ afterSeconds: 0, cues: [narration("h")] }],
        checks: [{ id: "c", label: "c", polarity: "good", when: { type: "walking" } }],
      },
      {
        id: "b",
        goal: { type: "signal", name: "go" },
        hints: [{ afterSeconds: 0, cues: [narration("h")] }],
        checks: [{ id: "c", label: "c", polarity: "good", when: { type: "walking" } }],
      },
    ]);
    let s = startScenario(d).state;
    const r1 = advance(d, s, input({ walking: true }), [], 0.1);
    expect(cueIds(r1.effects)).toEqual(["h"]);
    s = advance(d, r1.state, input(), [{ type: "signal", name: "go" }], 0.1).state;
    expect(s.stepId).toBe("b");
    expect(s.firedHints).toEqual([]);
    expect(s.firedChecks).toEqual([]);
    expect(s.progress.holdTimers).toEqual({});
    expect(s.progress.latched).toEqual({});

    // 次の場面でも助言・評価がもう一度出る（場面ごとに 1 回）
    const r2 = advance(d, s, input({ walking: true }), [], 0.1);
    expect(cueIds(r2.effects)).toEqual(["h"]);
    expect(r2.state.evaluations.map((e) => e.stepId)).toEqual(["a", "b"]);
  });
});

// ---- 判定条件 ----

describe("判定条件", () => {
  const single = (goal: Condition) =>
    def([
      { id: "a", goal },
      { id: "b", goal: never },
    ]);

  it("posture: 指定の姿勢を holdSeconds 秒続けると満たす", () => {
    const d = single({ type: "posture", posture: "crouching", holdSeconds: 3 });
    const crouch = input({ posture: "crouching" });
    let s = run(d, startScenario(d).state, 2, 1, crouch).state;
    expect(s.stepId).toBe("a");
    s = run(d, s, 1, 1, crouch).state;
    expect(s.stepId).toBe("b");
  });

  it("posture: 継続が途切れると継続時間は 0 に戻る", () => {
    const d = single({ type: "posture", posture: "crouching", holdSeconds: 3 });
    const crouch = input({ posture: "crouching" });
    let s = run(d, startScenario(d).state, 2, 1, crouch).state;
    s = run(d, s, 1, 1, input({ posture: "standing" })).state;
    s = run(d, s, 2, 1, crouch).state;
    expect(s.stepId).toBe("a");
    s = run(d, s, 1, 1, crouch).state;
    expect(s.stepId).toBe("b");
  });

  it("posture: holdSeconds を省略するとその瞬間に満たす", () => {
    const d = single({ type: "posture", posture: "crouching" });
    const s = advance(d, startScenario(d).state, input({ posture: "crouching" }), [], 0.016).state;
    expect(s.stepId).toBe("b");
  });

  it("posture: 違う姿勢では満たさない", () => {
    const d = single({ type: "posture", posture: "crouching" });
    const s = run(d, startScenario(d).state, 10, 1, input({ posture: "standing" })).state;
    expect(s.stepId).toBe("a");
  });

  it("walking: 足踏みを holdSeconds 秒続けると満たし，途切れると数え直す", () => {
    const d = single({ type: "walking", holdSeconds: 2 });
    const walk = input({ walking: true });
    let s = run(d, startScenario(d).state, 1, 1, walk).state;
    s = run(d, s, 1, 1, input()).state;
    s = run(d, s, 1, 1, walk).state;
    expect(s.stepId).toBe("a");
    s = run(d, s, 1, 1, walk).state;
    expect(s.stepId).toBe("b");
  });

  it("inArea: 指定のエリアに holdSeconds 秒いると満たし，他のエリアでは満たさない", () => {
    const d = single({ type: "inArea", areaId: "hall", holdSeconds: 1 });
    let s = run(d, startScenario(d).state, 5, 0.5, input({ areaIds: ["kitchen"] })).state;
    expect(s.stepId).toBe("a");
    s = run(d, s, 1, 0.5, input({ areaIds: ["kitchen", "hall"] })).state;
    expect(s.stepId).toBe("a");
    s = run(d, s, 1, 0.5, input({ areaIds: ["hall"] })).state;
    expect(s.stepId).toBe("b");
  });

  it("touch: 指定の物の objectTouched で満たす（他の物・他の種類では満たさない）", () => {
    const d = single({ type: "touch", objectId: "door" });
    let s = startScenario(d).state;
    s = advance(
      d,
      s,
      input(),
      [{ type: "objectTouched", objectId: "desk", hand: "left" }],
      0.1,
    ).state;
    s = advance(d, s, input(), [{ type: "signal", name: "door" }], 0.1).state;
    s = advance(d, s, input(), [{ type: "areaEntered", areaId: "door" }], 0.1).state;
    expect(s.stepId).toBe("a");
    s = advance(
      d,
      s,
      input(),
      [{ type: "objectTouched", objectId: "door", hand: "right" }],
      0.1,
    ).state;
    expect(s.stepId).toBe("b");
  });

  it("signal: 指定の名前の signal で満たす", () => {
    const d = single({ type: "signal", name: "narration-ended:intro" });
    let s = startScenario(d).state;
    s = advance(d, s, input(), [{ type: "signal", name: "narration-ended:other" }], 0.1).state;
    expect(s.stepId).toBe("a");
    s = advance(d, s, input(), [{ type: "signal", name: "narration-ended:intro" }], 0.1).state;
    expect(s.stepId).toBe("b");
  });

  it("elapsed: 場面に入ってから seconds 秒たつと満たす", () => {
    const d = single({ type: "elapsed", seconds: 2 });
    let s = run(d, startScenario(d).state, 3, 0.5).state;
    expect(s.stepId).toBe("a");
    s = run(d, s, 1, 0.5).state;
    expect(s.stepId).toBe("b");
  });

  it("all: すべて満たすと満たす", () => {
    const d = single({
      type: "all",
      conditions: [
        { type: "inArea", areaId: "desk" },
        { type: "posture", posture: "crouching" },
      ],
    });
    let s = advance(d, startScenario(d).state, input({ areaIds: ["desk"] }), [], 0.1).state;
    // inArea はラッチされたまま．しゃがむと all を満たす
    expect(s.stepId).toBe("a");
    s = advance(d, s, input({ areaIds: ["desk"], posture: "crouching" }), [], 0.1).state;
    expect(s.stepId).toBe("b");
  });

  it("all: 一度満たした条件はその場面の間は満たしたまま（それぞれ一度は満たせばよい）", () => {
    const d = single({
      type: "all",
      conditions: [
        { type: "signal", name: "x" },
        { type: "signal", name: "y" },
      ],
    });
    let s = advance(d, startScenario(d).state, input(), [{ type: "signal", name: "x" }], 0.1).state;
    s = run(d, s, 5, 0.1).state;
    expect(s.stepId).toBe("a");
    s = advance(d, s, input(), [{ type: "signal", name: "y" }], 0.1).state;
    expect(s.stepId).toBe("b");
  });

  it("any: どれかを満たすと満たす", () => {
    const d = single({
      type: "any",
      conditions: [
        { type: "signal", name: "x" },
        { type: "elapsed", seconds: 8 },
      ],
    });
    let s = advance(d, startScenario(d).state, input(), [{ type: "signal", name: "x" }], 0.1).state;
    expect(s.stepId).toBe("b");

    s = run(d, startScenario(d).state, 7, 1).state;
    expect(s.stepId).toBe("a");
    s = run(d, s, 1, 1).state;
    expect(s.stepId).toBe("b");
  });

  it("any の中の継続時間は他の子が満たされていなくても数えられる", () => {
    const d = single({
      type: "any",
      conditions: [never, { type: "walking", holdSeconds: 2 }],
    });
    const s = run(d, startScenario(d).state, 2, 1, input({ walking: true })).state;
    expect(s.stepId).toBe("b");
  });

  it("入れ子の all / any を評価できる", () => {
    const d = single({
      type: "all",
      conditions: [
        { type: "any", conditions: [never, { type: "touch", objectId: "bell" }] },
        { type: "inArea", areaId: "hall" },
      ],
    });
    let s = advance(
      d,
      startScenario(d).state,
      input(),
      [{ type: "objectTouched", objectId: "bell", hand: "left" }],
      0.1,
    ).state;
    expect(s.stepId).toBe("a");
    s = advance(d, s, input({ areaIds: ["hall"] }), [], 0.1).state;
    expect(s.stepId).toBe("b");
  });

  it("空の all は満たし，空の any は満たさない", () => {
    let d = single({ type: "all", conditions: [] });
    expect(advance(d, startScenario(d).state, input(), [], 0.1).state.stepId).toBe("b");
    d = single({ type: "any", conditions: [] });
    expect(run(d, startScenario(d).state, 10, 1).state.stepId).toBe("a");
  });
});

// ---- 制限時間 ----

describe("場面の制限時間 (timeout)", () => {
  it("時間切れになると timeout の演出 → stepFinished(timedOut) → 次の場面へ進む", () => {
    const d = def([
      { id: "a", goal: never, timeout: { seconds: 2, cues: [narration("late")] } },
      { id: "b", onEnter: [narration("b")], goal: never },
    ]);
    let s = run(d, startScenario(d).state, 1, 1).state;
    expect(s.stepId).toBe("a");
    const r = advance(d, s, input(), [], 1);
    s = r.state;
    expect(effectTypes(r.effects)).toEqual(["cue", "stepFinished", "stepEntered", "cue"]);
    expect(cueIds(r.effects)).toEqual(["late", "b"]);
    expect(s.stepId).toBe("b");
    expect(s.steps).toHaveLength(1);
    expect(s.steps[0].outcome).toBe("timedOut");
    expect(s.status).toBe("running");
  });

  it("timeout.next を指定すると時間切れの時はそこへ進む", () => {
    const d = def([
      { id: "a", goal: never, timeout: { seconds: 1, next: "c" } },
      { id: "b", goal: never },
      { id: "c", goal: never },
    ]);
    const s = run(d, startScenario(d).state, 1, 1).state;
    expect(s.stepId).toBe("c");
  });

  it("timeout.next を省略すると場面の next へ進む", () => {
    const d = def([
      { id: "a", goal: never, timeout: { seconds: 1 }, next: "c" },
      { id: "b", goal: never },
      { id: "c", goal: never },
    ]);
    const s = run(d, startScenario(d).state, 1, 1).state;
    expect(s.stepId).toBe("c");
  });

  it("timeout.next: null なら時間切れで終了する（打ち切りではない）", () => {
    const d = def([
      { id: "a", goal: never, timeout: { seconds: 1, next: null } },
      { id: "b", goal: never },
    ]);
    const s = run(d, startScenario(d).state, 1, 1).state;
    expect(s.status).toBe("finished");
    expect(s.aborted).toBe(false);
  });

  it("目標の達成と時間切れが同じフレームなら，達成（completed）を優先する", () => {
    const d = def([
      {
        id: "a",
        goal: { type: "elapsed", seconds: 1 },
        timeout: { seconds: 1, cues: [narration("late")] },
        onComplete: [narration("good")],
      },
      { id: "b", goal: never },
    ]);
    const r = advance(d, startScenario(d).state, input(), [], 1);
    expect(r.state.steps[0].outcome).toBe("completed");
    expect(cueIds(r.effects)).toEqual(["good"]);
  });

  it("timeout が無い場面は時間がたっても進まない", () => {
    const d = def([{ id: "a", goal: never }]);
    const s = run(d, startScenario(d).state, 100, 1).state;
    expect(s.stepId).toBe("a");
    expect(s.status).toBe("running");
  });
});

describe("全体の制限時間 (timeLimitSeconds)", () => {
  it("全体の制限時間を過ぎると打ち切り，aborted: true・その場面は timedOut になる", () => {
    const d = def(
      [
        { id: "a", goal: { type: "elapsed", seconds: 1 } },
        { id: "b", goal: never },
      ],
      { timeLimitSeconds: 3 },
    );
    let s = run(d, startScenario(d).state, 1, 1).state; // a を完了
    expect(s.stepId).toBe("b");
    s = run(d, s, 1, 1).state;
    expect(s.status).toBe("running");
    const r = advance(d, s, input(), [], 1);
    expect(r.state.status).toBe("finished");
    expect(r.state.aborted).toBe(true);
    expect(r.state.stepId).toBeNull();
    expect(r.state.steps.map((x) => [x.stepId, x.outcome])).toEqual([
      ["a", "completed"],
      ["b", "timedOut"],
    ]);
    expect(effectTypes(r.effects)).toEqual(["stepFinished", "finished"]);
  });

  it("場面の時間切れと全体の打ち切りが同じフレームでも，次の場面に入らず打ち切る", () => {
    const d = def(
      [
        { id: "a", goal: never, timeout: { seconds: 2 } },
        { id: "b", onEnter: [narration("b")], goal: never },
      ],
      { timeLimitSeconds: 2 },
    );
    const r = run(d, startScenario(d).state, 2, 1);
    expect(r.state.status).toBe("finished");
    expect(r.state.aborted).toBe(true);
    expect(r.effects.some((e) => e.type === "stepEntered")).toBe(false);
    expect(r.state.steps.map((x) => x.outcome)).toEqual(["timedOut"]);
  });

  it("制限時間内に最後まで進めば aborted: false", () => {
    const d = def([{ id: "a", goal: { type: "elapsed", seconds: 1 } }], { timeLimitSeconds: 10 });
    const s = run(d, startScenario(d).state, 1, 1).state;
    expect(s.status).toBe("finished");
    expect(s.aborted).toBe(false);
  });
});

// ---- 助言 ----

describe("助言 (hints)", () => {
  it("afterSeconds を過ぎた時に 1 回だけ演出を出す", () => {
    const d = def([
      { id: "a", goal: never, hints: [{ afterSeconds: 2, cues: [narration("hint")] }] },
    ]);
    let s = startScenario(d).state;
    const r1 = run(d, s, 1, 1);
    expect(cueIds(r1.effects)).toEqual([]);
    const r2 = run(d, r1.state, 1, 1);
    expect(cueIds(r2.effects)).toEqual(["hint"]);
    s = r2.state;
    const r3 = run(d, s, 10, 1);
    expect(cueIds(r3.effects)).toEqual([]);
  });

  it("複数の助言はそれぞれの時刻に出る．大きな dt で同時に過ぎれば同じフレームでまとめて出る", () => {
    const d = def([
      {
        id: "a",
        goal: never,
        hints: [
          { afterSeconds: 1, cues: [narration("h1")] },
          { afterSeconds: 3, cues: [narration("h2")] },
        ],
      },
    ]);
    const step = run(d, startScenario(d).state, 4, 1);
    expect(cueIds(step.effects)).toEqual(["h1", "h2"]);

    const jump = advance(d, startScenario(d).state, input(), [], 5);
    expect(cueIds(jump.effects)).toEqual(["h1", "h2"]);
  });

  it("助言 → 評価 → 目標の順に判定され，同じフレームの effects もこの順になる", () => {
    const d = def([
      {
        id: "a",
        goal: { type: "elapsed", seconds: 1 },
        onComplete: [narration("done")],
        hints: [{ afterSeconds: 1, cues: [narration("hint")] }],
        checks: [{ id: "c", label: "c", polarity: "good", when: { type: "elapsed", seconds: 1 } }],
      },
      { id: "b", goal: never },
    ]);
    const r = advance(d, startScenario(d).state, input(), [], 1);
    expect(effectTypes(r.effects)).toEqual([
      "cue", // hint
      "evaluated",
      "cue", // onComplete
      "stepFinished",
      "stepEntered",
    ]);
    expect(cueIds(r.effects)).toEqual(["hint", "done"]);
  });
});

// ---- 行動の評価 ----

describe("行動の評価 (checks)", () => {
  const withCheck = (when: Condition) =>
    def([
      {
        id: "a",
        goal: { type: "signal", name: "go" },
        checks: [{ id: "walked", label: "歩いた", polarity: "bad", when, advice: "歩かない" }],
      },
    ]);

  it("条件を満たすと evaluated を出し，EvaluationRecord を記録する", () => {
    const d = withCheck({ type: "walking", holdSeconds: 2 });
    const r = run(d, startScenario(d).state, 3, 1, input({ walking: true }));
    const evaluated = r.effects.filter((e) => e.type === "evaluated");
    expect(evaluated).toHaveLength(1);
    expect(r.state.evaluations).toEqual([
      {
        id: "walked",
        stepId: "a",
        label: "歩いた",
        polarity: "bad",
        advice: "歩かない",
        atSeconds: 2,
      },
    ]);
    expect(r.state.firedChecks).toEqual(["walked"]);
  });

  it("1 場面で 1 回だけ記録する（条件を満たし続けても，満たし直しても増えない）", () => {
    const d = withCheck({ type: "walking" });
    let s = run(d, startScenario(d).state, 3, 1, input({ walking: true })).state;
    s = run(d, s, 2, 1, input()).state;
    s = run(d, s, 3, 1, input({ walking: true })).state;
    expect(s.evaluations).toHaveLength(1);
  });

  it("評価は目標の判定とは別に数える（評価の条件を満たしても場面は進まない）", () => {
    const d = withCheck({ type: "walking" });
    const s = run(d, startScenario(d).state, 3, 1, input({ walking: true })).state;
    expect(s.stepId).toBe("a");
  });

  it("目標と同じ条件を評価に使っても，それぞれ独立に継続時間を数える", () => {
    const cond: Condition = { type: "walking", holdSeconds: 2 };
    const d = def([
      {
        id: "a",
        goal: cond,
        checks: [{ id: "w", label: "w", polarity: "bad", when: cond }],
      },
      { id: "b", goal: never },
    ]);
    const r = run(d, startScenario(d).state, 2, 1, input({ walking: true }));
    expect(r.state.stepId).toBe("b");
    expect(r.state.evaluations.map((e) => e.id)).toEqual(["w"]);
  });

  it("場面の終わりのフレームで満たした評価も記録される", () => {
    const d = def([
      {
        id: "a",
        goal: { type: "signal", name: "go" },
        checks: [{ id: "t", label: "t", polarity: "good", when: { type: "touch", objectId: "x" } }],
      },
      { id: "b", goal: never },
    ]);
    const r = advance(
      d,
      startScenario(d).state,
      input(),
      [
        { type: "objectTouched", objectId: "x", hand: "left" },
        { type: "signal", name: "go" },
      ],
      0.1,
    );
    expect(r.state.stepId).toBe("b");
    expect(r.state.evaluations.map((e) => e.id)).toEqual(["t"]);
  });

  it("評価の atSeconds は体験開始からの経過秒数", () => {
    const d = def([
      { id: "a", goal: { type: "elapsed", seconds: 2 } },
      {
        id: "b",
        goal: never,
        checks: [{ id: "c", label: "c", polarity: "good", when: { type: "elapsed", seconds: 1 } }],
      },
    ]);
    const s = run(d, startScenario(d).state, 4, 1).state;
    expect(s.evaluations[0].atSeconds).toBe(3);
  });
});

// ---- StepRecord と toResult ----

describe("場面の記録と toResult", () => {
  const d = def(
    [
      { id: "intro", goal: { type: "elapsed", seconds: 1 } },
      {
        id: "quake",
        goal: { type: "posture", posture: "crouching", holdSeconds: 2 },
        report: { label: "頭を守る", advice: "机の下へ" },
        checks: [{ id: "w", label: "歩いた", polarity: "bad", when: { type: "walking" } }],
      },
      { id: "end", goal: never, timeout: { seconds: 3 } },
    ],
    { id: "scn", title: "タイトル" },
  );

  function playThrough(): ScenarioState {
    let s = startScenario(d).state;
    s = run(d, s, 1, 1).state; // intro 完了（t=1）
    s = run(d, s, 1, 1, input({ walking: true })).state; // 評価 w（t=2）
    s = run(d, s, 2, 1, input({ posture: "crouching" })).state; // quake 完了（t=4）
    s = run(d, s, 3, 1).state; // end 時間切れ（t=7）
    return s;
  }

  it("StepRecord に場面の見出し・助言・結果・開始時刻・所要時間が入る", () => {
    const s = playThrough();
    expect(s.status).toBe("finished");
    expect(s.steps).toEqual([
      {
        stepId: "intro",
        label: undefined,
        advice: undefined,
        outcome: "completed",
        startedAt: 0,
        durationSeconds: 1,
      },
      {
        stepId: "quake",
        label: "頭を守る",
        advice: "机の下へ",
        outcome: "completed",
        startedAt: 1,
        durationSeconds: 3,
      },
      {
        stepId: "end",
        label: undefined,
        advice: undefined,
        outcome: "timedOut",
        startedAt: 4,
        durationSeconds: 3,
      },
    ]);
  });

  it("toResult は定義の ID・タイトルと状態の記録を ScenarioResult にまとめる", () => {
    const s = playThrough();
    const result = toResult(d, s);
    expect(result).toEqual({
      scenarioId: "scn",
      title: "タイトル",
      totalSeconds: 7,
      aborted: false,
      steps: s.steps,
      evaluations: s.evaluations,
    });
    expect(result.evaluations.map((e) => e.id)).toEqual(["w"]);
  });

  it("toResult は打ち切りを aborted に反映する", () => {
    const limited = { ...d, timeLimitSeconds: 2 };
    const s = run(limited, startScenario(limited).state, 2, 1).state;
    expect(toResult(limited, s).aborted).toBe(true);
  });
});

// ---- 純粋さ ----

describe("純粋な関数であること", () => {
  const d = def([
    {
      id: "a",
      onEnter: [narration("a")],
      goal: { type: "all", conditions: [{ type: "walking", holdSeconds: 1 }, never] },
      hints: [{ afterSeconds: 0.5, cues: [narration("h")] }],
      checks: [{ id: "c", label: "c", polarity: "good", when: { type: "walking" } }],
      timeout: { seconds: 5 },
    },
    { id: "b", goal: never },
  ]);

  it("引数（定義・状態・入力・出来事）を書き換えない", () => {
    const frozenDef = deepFreeze(structuredClone(d));
    const state = deepFreeze(run(frozenDef, startScenario(frozenDef).state, 1, 0.3).state);
    const snapshot = structuredClone(state);
    const inp = deepFreeze(input({ walking: true, areaIds: ["x"] }));
    const events = deepFreeze([{ type: "signal", name: "never" }] as GameEvent[]);

    expect(() => advance(frozenDef, state, inp, events, 0.4)).not.toThrow();
    expect(state).toEqual(snapshot);
    expect(frozenDef).toEqual(d);
  });

  it("同じ入力には同じ結果を返す", () => {
    const s0 = run(d, startScenario(d).state, 1, 0.3, input({ walking: true })).state;
    const a = advance(d, s0, input({ walking: true }), [], 0.4);
    const b = advance(d, s0, input({ walking: true }), [], 0.4);
    expect(a).toEqual(b);
  });

  it("古い状態から進め直しても，新しい状態の進行に影響されない", () => {
    const s0 = startScenario(d).state;
    const s1 = advance(d, s0, input({ walking: true }), [], 0.6).state;
    advance(d, s1, input({ walking: true }), [], 0.6);
    const again = advance(d, s0, input({ walking: true }), [], 0.6).state;
    expect(again).toEqual(s1);
  });
});

// ---- validateScenario ----

describe("validateScenario", () => {
  it("正しい定義では空配列を返す", () => {
    const d = def(
      [
        { id: "a", goal: never, next: "c", timeout: { seconds: 1, next: "b" } },
        { id: "b", goal: never, next: null },
        { id: "c", goal: never, timeout: { seconds: 1, next: null } },
      ],
      { timeLimitSeconds: 60 },
    );
    expect(validateScenario(d)).toEqual([]);
  });

  it("場面が空ならエラー", () => {
    expect(validateScenario(def([]))).toHaveLength(1);
  });

  it("場面 ID の重複をエラーにする", () => {
    const errors = validateScenario(
      def([
        { id: "a", goal: never },
        { id: "a", goal: never },
      ]),
    );
    expect(errors).toHaveLength(1);
    expect(errors[0]).toContain("a");
  });

  it("存在しない next をエラーにする", () => {
    const errors = validateScenario(def([{ id: "a", goal: never, next: "nowhere" }]));
    expect(errors).toHaveLength(1);
    expect(errors[0]).toContain("nowhere");
  });

  it("存在しない timeout.next をエラーにする", () => {
    const errors = validateScenario(
      def([{ id: "a", goal: never, timeout: { seconds: 1, next: "nowhere" } }]),
    );
    expect(errors).toHaveLength(1);
    expect(errors[0]).toContain("nowhere");
  });

  const invalidSeconds = [0, -1, Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY];

  it.each(invalidSeconds)("場面の制限時間が %s ならエラー", (seconds) => {
    const errors = validateScenario(def([{ id: "a", goal: never, timeout: { seconds } }]));
    expect(errors).toHaveLength(1);
  });

  it.each(invalidSeconds)("全体の制限時間（timeLimitSeconds）が %s ならエラー", (seconds) => {
    const errors = validateScenario(def([{ id: "a", goal: never }], { timeLimitSeconds: seconds }));
    expect(errors).toHaveLength(1);
  });

  it.each([0.001, 1, 180])("制限時間が正の有限な数 %s なら誤りではない", (seconds) => {
    const errors = validateScenario(
      def([{ id: "a", goal: never, timeout: { seconds } }], { timeLimitSeconds: seconds }),
    );
    expect(errors).toEqual([]);
  });

  it("1 場面の中の評価 ID の重複をエラーにする", () => {
    const check = { id: "c", label: "c", polarity: "good" as const, when: never };
    const errors = validateScenario(def([{ id: "a", goal: never, checks: [check, check] }]));
    expect(errors).toHaveLength(1);
  });

  it("複数の誤りはすべて返す", () => {
    const errors = validateScenario(
      def([
        { id: "a", goal: never, next: "x" },
        { id: "a", goal: never, timeout: { seconds: 0, next: "y" } },
      ]),
    );
    expect(errors.length).toBeGreaterThanOrEqual(4);
  });
});

// ---- together ----

describe("together（同時に満たす）", () => {
  const single = (goal: Condition) =>
    def([
      { id: "a", goal },
      { id: "b", goal: never },
    ]);
  const deskCrouch: Condition = {
    type: "together",
    conditions: [
      { type: "inArea", areaId: "desk" },
      { type: "posture", posture: "crouching" },
    ],
    holdSeconds: 3,
  };
  const atDeskCrouching = input({ areaIds: ["desk"], posture: "crouching" });

  it("子を同時に満たしている状態が holdSeconds 秒続くと成立する", () => {
    const d = single(deskCrouch);
    let s = run(d, startScenario(d).state, 2, 1, atDeskCrouching).state;
    expect(s.stepId).toBe("a");
    s = run(d, s, 1, 1, atDeskCrouching).state;
    expect(s.stepId).toBe("b");
  });

  it("同時の状態が途切れると継続時間は 0 に戻る", () => {
    const d = single(deskCrouch);
    let s = run(d, startScenario(d).state, 2, 1, atDeskCrouching).state;
    s = run(d, s, 1, 1, input({ areaIds: [], posture: "crouching" })).state; // 机の外
    s = run(d, s, 2, 1, atDeskCrouching).state;
    expect(s.stepId).toBe("a");
    s = run(d, s, 1, 1, atDeskCrouching).state;
    expect(s.stepId).toBe("b");
  });

  it("holdSeconds を省略すると同時に満たした瞬間に成立する", () => {
    const d = single({
      type: "together",
      conditions: [
        { type: "inArea", areaId: "desk" },
        { type: "posture", posture: "crouching" },
      ],
    });
    let s = advance(d, startScenario(d).state, input({ areaIds: ["desk"] }), [], 0.1).state;
    expect(s.stepId).toBe("a");
    s = advance(d, s, atDeskCrouching, [], 0.1).state;
    expect(s.stepId).toBe("b");
  });

  it("仕様の例: 机の下に入る → 机の外に出る → しゃがむ，で all は成立し together は成立しない", () => {
    const moves = (d: ScenarioDefinition) => {
      let s = startScenario(d).state;
      s = run(d, s, 1, 1, input({ areaIds: ["desk"] })).state;
      s = run(d, s, 1, 1, input()).state;
      s = run(d, s, 3, 1, input({ posture: "crouching" })).state;
      return s;
    };
    const allDef = single({
      type: "all",
      conditions: [
        { type: "inArea", areaId: "desk" },
        { type: "posture", posture: "crouching", holdSeconds: 3 },
      ],
    });
    const togetherDef = single(deskCrouch);
    expect(moves(allDef).stepId).toBe("b");
    expect(moves(togetherDef).stepId).toBe("a");
  });

  it("一度成立したら，その場面の間は満たしたまま（ラッチ）", () => {
    const d = single({
      type: "all",
      conditions: [deskCrouch, { type: "signal", name: "go" }],
    });
    let s = run(d, startScenario(d).state, 3, 1, atDeskCrouching).state; // together 成立
    s = run(d, s, 5, 1, input()).state; // 状態が途切れる
    expect(s.stepId).toBe("a");
    s = advance(d, s, input(), [{ type: "signal", name: "go" }], 1).state;
    expect(s.stepId).toBe("b");
  });

  it("checks の together は成立した時に 1 回だけ記録し，途切れて再び成立しても増えない", () => {
    const d = def([
      {
        id: "a",
        goal: never,
        checks: [{ id: "c", label: "c", polarity: "good", when: deskCrouch }],
      },
    ]);
    let s = run(d, startScenario(d).state, 3, 1, atDeskCrouching).state;
    expect(s.evaluations.map((e) => e.id)).toEqual(["c"]);
    s = run(d, s, 1, 1, input()).state;
    s = run(d, s, 3, 1, atDeskCrouching).state;
    expect(s.evaluations).toHaveLength(1);
  });

  it("子の touch・signal はそのフレームに届いた時だけ満たす（ラッチしない）", () => {
    const d = single({
      type: "together",
      conditions: [
        { type: "signal", name: "x" },
        { type: "posture", posture: "crouching" },
      ],
    });
    // signal の後のフレームでしゃがんでも成立しない
    let s = advance(d, startScenario(d).state, input(), [{ type: "signal", name: "x" }], 0.1).state;
    s = advance(d, s, input({ posture: "crouching" }), [], 0.1).state;
    expect(s.stepId).toBe("a");
    // 同じフレームなら成立する
    s = advance(d, s, input({ posture: "crouching" }), [{ type: "signal", name: "x" }], 0.1).state;
    expect(s.stepId).toBe("b");
  });

  it("子の touch もそのフレームだけ満たす", () => {
    const d = single({
      type: "together",
      conditions: [
        { type: "touch", objectId: "door" },
        { type: "inArea", areaId: "hall" },
      ],
    });
    const touch: GameEvent = { type: "objectTouched", objectId: "door", hand: "left" };
    let s = advance(d, startScenario(d).state, input(), [touch], 0.1).state;
    s = advance(d, s, input({ areaIds: ["hall"] }), [], 0.1).state;
    expect(s.stepId).toBe("a");
    s = advance(d, s, input({ areaIds: ["hall"] }), [touch], 0.1).state;
    expect(s.stepId).toBe("b");
  });

  it("子の holdSeconds は子自身の継続時間を今満たしていることを意味する", () => {
    const d = single({
      type: "together",
      conditions: [
        { type: "inArea", areaId: "desk" },
        { type: "posture", posture: "crouching", holdSeconds: 2 },
      ],
    });
    // 机の外で 2 秒しゃがんでから机の下へ（しゃがみ続けている）→ 子の継続時間は満たしている
    let s = run(d, startScenario(d).state, 2, 1, input({ posture: "crouching" })).state;
    expect(s.stepId).toBe("a");
    s = advance(d, s, atDeskCrouching, [], 1).state;
    expect(s.stepId).toBe("b");

    // しゃがみが途切れると子の継続時間も 0 に戻る
    s = startScenario(d).state;
    s = run(d, s, 1, 1, atDeskCrouching).state;
    s = run(d, s, 1, 1, input({ areaIds: ["desk"] })).state;
    s = run(d, s, 1, 1, atDeskCrouching).state;
    expect(s.stepId).toBe("a");
    s = run(d, s, 1, 1, atDeskCrouching).state;
    expect(s.stepId).toBe("b");
  });

  it("子の elapsed は場面に入ってから指定の秒数を過ぎていれば満たす", () => {
    const d = single({
      type: "together",
      conditions: [
        { type: "elapsed", seconds: 2 },
        { type: "posture", posture: "crouching" },
      ],
    });
    let s = run(d, startScenario(d).state, 1, 1, input({ posture: "crouching" })).state;
    s = run(d, s, 1, 1, input()).state; // 2 秒たったが立っている
    expect(s.stepId).toBe("a");
    s = run(d, s, 1, 1, input({ posture: "crouching" })).state;
    expect(s.stepId).toBe("b");
  });

  it("together の中の all はラッチしない（子を今の状態で評価する）", () => {
    const inner: Condition = {
      type: "all",
      conditions: [
        { type: "inArea", areaId: "desk" },
        { type: "posture", posture: "crouching" },
      ],
    };
    const d = single({ type: "together", conditions: [inner] });
    let s = advance(d, startScenario(d).state, input({ areaIds: ["desk"] }), [], 0.1).state;
    s = advance(d, s, input({ posture: "crouching" }), [], 0.1).state;
    expect(s.stepId).toBe("a"); // 外の all ならここで成立していた
    s = advance(d, s, atDeskCrouching, [], 0.1).state;
    expect(s.stepId).toBe("b");
  });

  it("together の中の any は今どれかを満たしているか", () => {
    const d = single({
      type: "together",
      conditions: [
        {
          type: "any",
          conditions: [
            { type: "inArea", areaId: "desk" },
            { type: "inArea", areaId: "table" },
          ],
        },
        { type: "posture", posture: "crouching" },
      ],
      holdSeconds: 2,
    });
    let s = run(d, startScenario(d).state, 1, 1, input({ areaIds: ["desk"] })).state;
    s = run(d, s, 1, 1, input({ posture: "crouching" })).state;
    expect(s.stepId).toBe("a");
    s = run(d, s, 1, 1, input({ areaIds: ["desk"], posture: "crouching" })).state;
    s = run(d, s, 1, 1, input({ areaIds: ["table"], posture: "crouching" })).state;
    expect(s.stepId).toBe("b");
  });

  it("入れ子の together は自身の継続時間を数え，ラッチしない", () => {
    const d = single({
      type: "together",
      conditions: [
        {
          type: "together",
          conditions: [{ type: "posture", posture: "crouching" }],
          holdSeconds: 2,
        },
        { type: "inArea", areaId: "desk" },
      ],
    });
    // 内側は 2 秒しゃがみで成立するが，外の条件（机の下）がそろう前にしゃがみが途切れる
    let s = run(d, startScenario(d).state, 2, 1, input({ posture: "crouching" })).state;
    s = run(d, s, 1, 1, input({ areaIds: ["desk"] })).state;
    expect(s.stepId).toBe("a"); // 内側がラッチされていればここで成立してしまう
    s = run(d, s, 1, 1, atDeskCrouching).state;
    expect(s.stepId).toBe("a");
    s = run(d, s, 1, 1, atDeskCrouching).state;
    expect(s.stepId).toBe("b");
  });
});

// ---- 出来事の持ち越し ----

describe("出来事の持ち越し (pendingEvents)", () => {
  const touchDoor: GameEvent = { type: "objectTouched", objectId: "door", hand: "right" };
  const sig = (name: string): GameEvent => ({ type: "signal", name });

  it("始めた時と終わった時の pendingEvents は空", () => {
    const d = def([{ id: "a", goal: { type: "elapsed", seconds: 0 } }]);
    const s0 = startScenario(d).state;
    expect(s0.pendingEvents).toEqual([]);
    const s1 = advance(d, s0, input(), [sig("x")], 0.1).state;
    expect(s1.status).toBe("finished");
    expect(s1.pendingEvents).toEqual([]);
  });

  it("切り替わったフレームの出来事のうち前の場面で使われなかったものを持ち越し，次の advance で新しい場面に使う", () => {
    const d = def([
      { id: "a", goal: { type: "signal", name: "go" } },
      { id: "b", goal: { type: "signal", name: "narration-ended:b" } },
      { id: "c", goal: never },
    ]);
    const r1 = advance(
      d,
      startScenario(d).state,
      input(),
      [sig("go"), sig("narration-ended:b")],
      0.1,
    );
    expect(r1.state.stepId).toBe("b");
    expect(r1.state.pendingEvents).toEqual([sig("narration-ended:b")]);

    const r2 = advance(d, r1.state, input(), [], 0.1);
    expect(r2.state.stepId).toBe("c");
  });

  it("1 回の接触で次の場面まで達成されない（goal で使われた出来事は持ち越さない）", () => {
    const d = def([
      { id: "a", goal: { type: "touch", objectId: "door" } },
      { id: "b", goal: { type: "touch", objectId: "door" } },
      { id: "c", goal: never },
    ]);
    const r1 = advance(d, startScenario(d).state, input(), [touchDoor], 0.1);
    expect(r1.state.stepId).toBe("b");
    expect(r1.state.pendingEvents).toEqual([]);
    const s = run(d, r1.state, 5, 0.1).state;
    expect(s.stepId).toBe("b");
    expect(advance(d, s, input(), [touchDoor], 0.1).state.stepId).toBe("c");
  });

  it("checks で使われた出来事も持ち越さない", () => {
    const d = def([
      {
        id: "a",
        goal: { type: "elapsed", seconds: 1 },
        checks: [
          { id: "t", label: "t", polarity: "good", when: { type: "touch", objectId: "door" } },
        ],
      },
      { id: "b", goal: { type: "touch", objectId: "door" } },
      { id: "c", goal: never },
    ]);
    const r1 = advance(d, startScenario(d).state, input(), [touchDoor], 1);
    expect(r1.state.stepId).toBe("b");
    expect(r1.state.evaluations.map((e) => e.id)).toEqual(["t"]);
    expect(r1.state.pendingEvents).toEqual([]);
    expect(advance(d, r1.state, input(), [], 0.1).state.stepId).toBe("b");
  });

  it("ラッチ済みで判定されなかった条件に一致する出来事は使われておらず，持ち越す", () => {
    const d = def([
      {
        id: "a",
        goal: {
          type: "all",
          conditions: [
            { type: "touch", objectId: "door" },
            { type: "signal", name: "go" },
          ],
        },
      },
      { id: "b", goal: { type: "touch", objectId: "door" } },
      { id: "c", goal: never },
    ]);
    let s = advance(d, startScenario(d).state, input(), [touchDoor], 0.1).state; // touch をラッチ
    const r = advance(d, s, input(), [touchDoor, sig("go")], 0.1);
    expect(r.state.stepId).toBe("b");
    expect(r.state.pendingEvents).toEqual([touchDoor]);
    s = advance(d, r.state, input(), [], 0.1).state;
    expect(s.stepId).toBe("c");
  });

  it("どの条件にも一致しない出来事（areaEntered 等）も持ち越す", () => {
    const d = def([
      { id: "a", goal: { type: "signal", name: "go" } },
      { id: "b", goal: never },
    ]);
    const area: GameEvent = { type: "areaEntered", areaId: "hall" };
    const r = advance(d, startScenario(d).state, input(), [area, sig("go"), touchDoor], 0.1);
    expect(r.state.pendingEvents).toEqual([area, touchDoor]);
  });

  it("時間切れで切り替わったフレームの出来事も持ち越す", () => {
    const d = def([
      { id: "a", goal: never, timeout: { seconds: 1 } },
      { id: "b", goal: { type: "touch", objectId: "door" } },
      { id: "c", goal: never },
    ]);
    const r = advance(d, startScenario(d).state, input(), [touchDoor], 1);
    expect(r.state.stepId).toBe("b");
    expect(r.state.pendingEvents).toEqual([touchDoor]);
    expect(advance(d, r.state, input(), [], 0.1).state.stepId).toBe("c");
  });

  it("持ち越しは 1 フレーム分だけで，次のフレームで評価した後は捨てる", () => {
    const d = def([
      { id: "a", goal: { type: "signal", name: "go" } },
      {
        id: "b",
        goal: {
          type: "together",
          conditions: [
            { type: "signal", name: "x" },
            { type: "posture", posture: "crouching" },
          ],
        },
      },
      { id: "c", goal: never },
    ]);
    const r1 = advance(d, startScenario(d).state, input(), [sig("go"), sig("x")], 0.1);
    expect(r1.state.pendingEvents).toEqual([sig("x")]);
    const r2 = advance(d, r1.state, input(), [], 0.1); // 立っているので成立しない
    expect(r2.state.stepId).toBe("b");
    expect(r2.state.pendingEvents).toEqual([]);
    const r3 = advance(d, r2.state, input({ posture: "crouching" }), [], 0.1);
    expect(r3.state.stepId).toBe("b"); // 捨てられた x は使われない
  });

  it("持ち越した出来事のフレームでさらに場面が切り替われば，同じ規則でまた持ち越す", () => {
    const d = def([
      { id: "a", goal: { type: "signal", name: "go" } },
      { id: "b", goal: { type: "elapsed", seconds: 0 } },
      { id: "c", goal: { type: "signal", name: "y" } },
      { id: "d", goal: never },
    ]);
    let s = advance(d, startScenario(d).state, input(), [sig("go"), sig("y")], 0.1).state;
    expect(s.stepId).toBe("b");
    s = advance(d, s, input(), [], 0.1).state;
    expect(s.stepId).toBe("c");
    expect(s.pendingEvents).toEqual([sig("y")]);
    s = advance(d, s, input(), [], 0.1).state;
    expect(s.stepId).toBe("d");
  });

  it("持ち越しを含めても advance は純粋（同じ状態から同じ結果）", () => {
    const d = def([
      { id: "a", goal: { type: "signal", name: "go" } },
      { id: "b", goal: { type: "signal", name: "x" } },
      { id: "c", goal: never },
    ]);
    const s1 = deepFreeze(
      advance(d, startScenario(d).state, input(), [sig("go"), sig("x")], 0.1).state,
    );
    const a = advance(d, s1, input(), [], 0.1);
    const b = advance(d, s1, input(), [], 0.1);
    expect(a).toEqual(b);
    expect(s1.pendingEvents).toEqual([sig("x")]);
  });
});

// ---- 全体の制限時間と場面の終わりが重なった時 ----

describe("全体の制限時間と場面の終わりが同じフレーム", () => {
  it("最後の場面の達成なら completed かつ aborted: false", () => {
    const d = def([{ id: "a", goal: { type: "elapsed", seconds: 2 } }], { timeLimitSeconds: 2 });
    const r = run(d, startScenario(d).state, 2, 1);
    expect(r.state.status).toBe("finished");
    expect(r.state.aborted).toBe(false);
    expect(r.state.steps.map((x) => x.outcome)).toEqual(["completed"]);
    expect(toResult(d, r.state).aborted).toBe(false);
  });

  it("next: null の場面の達成なら（配列に場面が残っていても）aborted: false", () => {
    const d = def(
      [
        { id: "a", goal: { type: "elapsed", seconds: 2 }, next: null },
        { id: "b", goal: never },
      ],
      { timeLimitSeconds: 2 },
    );
    const s = run(d, startScenario(d).state, 2, 1).state;
    expect(s.status).toBe("finished");
    expect(s.aborted).toBe(false);
  });

  it("場面が残っていれば completed かつ aborted: true で，次の場面に入らない", () => {
    const d = def(
      [
        { id: "a", goal: { type: "elapsed", seconds: 2 }, onComplete: [narration("good")] },
        { id: "b", onEnter: [narration("b")], goal: never },
      ],
      { timeLimitSeconds: 2 },
    );
    const r = run(d, startScenario(d).state, 2, 1);
    expect(r.state.status).toBe("finished");
    expect(r.state.aborted).toBe(true);
    expect(r.state.steps.map((x) => x.outcome)).toEqual(["completed"]);
    expect(r.effects.some((e) => e.type === "stepEntered")).toBe(false);
    expect(cueIds(r.effects)).toEqual(["good"]);
    expect(effectTypes(r.effects).at(-1)).toBe("finished");
  });

  it("最後の場面の時間切れと重なったら timedOut かつ aborted: false", () => {
    const d = def([{ id: "a", goal: never, timeout: { seconds: 2 } }], { timeLimitSeconds: 2 });
    const s = run(d, startScenario(d).state, 2, 1).state;
    expect(s.status).toBe("finished");
    expect(s.aborted).toBe(false);
    expect(s.steps.map((x) => x.outcome)).toEqual(["timedOut"]);
  });

  it("時間切れの行き先が null（timeout.next: null）なら aborted: false", () => {
    const d = def(
      [
        { id: "a", goal: never, timeout: { seconds: 2, next: null } },
        { id: "b", goal: never },
      ],
      { timeLimitSeconds: 2 },
    );
    const s = run(d, startScenario(d).state, 2, 1).state;
    expect(s.aborted).toBe(false);
  });

  it("場面の時間切れと重なり行き先が残っていれば timedOut かつ aborted: true", () => {
    const d = def(
      [
        { id: "a", goal: never, timeout: { seconds: 2 } },
        { id: "b", goal: never },
      ],
      { timeLimitSeconds: 2 },
    );
    const s = run(d, startScenario(d).state, 2, 1).state;
    expect(s.status).toBe("finished");
    expect(s.aborted).toBe(true);
    expect(s.steps.map((x) => x.outcome)).toEqual(["timedOut"]);
  });

  it("場面の途中で全体の制限時間を過ぎたら（目標も時間切れもなし）timedOut かつ aborted: true", () => {
    const d = def([{ id: "a", goal: never }], { timeLimitSeconds: 2 });
    const s = run(d, startScenario(d).state, 2, 1).state;
    expect(s.aborted).toBe(true);
    expect(s.steps.map((x) => x.outcome)).toEqual(["timedOut"]);
  });
});
