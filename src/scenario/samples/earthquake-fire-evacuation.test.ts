// サンプルのシナリオ（docs/04_SPEC/SPEC_01「書き方の例（サンプル）」）のテスト
import { describe, expect, it } from "vitest";
import type { GameEvent } from "../../core/events";
import { advance, startScenario, toResult, validateScenario } from "../engine";
import type { ScenarioEffect, ScenarioInput, ScenarioState } from "../types";
import { earthquakeFireEvacuation as sample } from "./earthquake-fire-evacuation";

const input = (over: Partial<ScenarioInput> = {}): ScenarioInput => ({
  posture: "standing",
  walking: false,
  areaIds: [],
  ...over,
});

const DT = 0.5;

function run(
  state: ScenarioState,
  seconds: number,
  inp: ScenarioInput = input(),
  events: readonly GameEvent[] = [],
): { state: ScenarioState; effects: ScenarioEffect[] } {
  const effects: ScenarioEffect[] = [];
  let s = state;
  for (let i = 0; i < Math.round(seconds / DT); i++) {
    const r = advance(sample, s, inp, events, DT);
    s = r.state;
    effects.push(...r.effects);
  }
  return { state: s, effects };
}

const once = (state: ScenarioState, inp: ScenarioInput, events: readonly GameEvent[] = []) =>
  advance(sample, state, inp, events, DT);

const cueIds = (effects: readonly ScenarioEffect[]): string[] =>
  effects.flatMap((e) => (e.type === "cue" ? [e.cue.id] : []));

/** 場面 ID まで進める（想定どおりの動作で） */
function reachStep(stepId: string): ScenarioState {
  let s = startScenario(sample).state;
  const crouchDesk = input({ posture: "crouching", areaIds: ["under-desk"] });
  const plan: Array<[string, () => ScenarioState]> = [
    ["intro", () => once(s, input(), [{ type: "signal", name: "narration-ended:intro" }]).state],
    ["earthquake", () => run(s, 3, crouchDesk).state],
    ["fire", () => once(s, input({ posture: "crouching", areaIds: ["hallway"] })).state],
    [
      "open-door",
      () =>
        once(s, input(), [{ type: "objectTouched", objectId: "exit-door", hand: "right" }]).state,
    ],
    ["evacuate", () => run(s, 1, input({ areaIds: ["assembly-point"] })).state],
  ];
  for (const [id, step] of plan) {
    if (s.stepId === stepId) return s;
    expect(s.stepId).toBe(id);
    s = step();
  }
  expect(s.stepId).toBe(stepId);
  return s;
}

describe("サンプル: 地震 → 火災 → 避難", () => {
  it("validateScenario が空配列を返す", () => {
    expect(validateScenario(sample)).toEqual([]);
  });

  it("想定どおりの入力で最後まで進み，すべての場面が completed になる", () => {
    let s = startScenario(sample).state;
    expect(s.stepId).toBe("intro");

    // intro: ナレーションの終わり
    s = once(s, input(), [{ type: "signal", name: "narration-ended:intro" }]).state;
    expect(s.stepId).toBe("earthquake");

    // earthquake: 机の下でしゃがみを 3 秒
    const crouchDesk = input({ posture: "crouching", areaIds: ["under-desk"] });
    s = run(s, 2.5, crouchDesk).state;
    expect(s.stepId).toBe("earthquake");
    s = run(s, 0.5, crouchDesk).state;
    expect(s.stepId).toBe("fire");

    // fire: 低い姿勢で 5 秒進んでから廊下へ
    s = run(s, 5, input({ posture: "crouching", walking: true })).state;
    expect(s.stepId).toBe("fire");
    s = once(s, input({ posture: "crouching", walking: true, areaIds: ["hallway"] })).state;
    expect(s.stepId).toBe("open-door");

    // open-door: ドアに触れる
    s = once(s, input(), [{ type: "objectTouched", objectId: "exit-door", hand: "right" }]).state;
    expect(s.stepId).toBe("evacuate");

    // evacuate: 集合場所に 1 秒
    s = run(s, 1, input({ areaIds: ["assembly-point"] })).state;
    expect(s.stepId).toBe("ending");

    // ending: 5 秒
    s = run(s, 4.5).state;
    expect(s.stepId).toBe("ending");
    s = run(s, 0.5).state;

    expect(s.status).toBe("finished");
    expect(s.aborted).toBe(false);
    expect(s.steps.map((r) => [r.stepId, r.outcome])).toEqual([
      ["intro", "completed"],
      ["earthquake", "completed"],
      ["fire", "completed"],
      ["open-door", "completed"],
      ["evacuate", "completed"],
      ["ending", "completed"],
    ]);
    expect(s.evaluations.map((e) => [e.id, e.polarity])).toEqual([["kept-low-in-smoke", "good"]]);

    const result = toResult(sample, s);
    expect(result.scenarioId).toBe(sample.id);
    expect(result.aborted).toBe(false);
    expect(result.steps.filter((r) => r.label !== undefined).map((r) => r.stepId)).toEqual([
      "earthquake",
      "fire",
      "open-door",
      "evacuate",
    ]);
  });

  it("何もしなくても時間切れで先へ進み，全体の制限時間内に終わる（詰まらない）", () => {
    let s = startScenario(sample).state;
    for (let i = 0; i < 1000 && s.status === "running"; i++) s = once(s, input()).state;

    expect(s.status).toBe("finished");
    expect(s.aborted).toBe(false);
    expect(s.totalElapsed).toBeLessThanOrEqual(sample.timeLimitSeconds ?? Infinity);
    expect(s.steps.map((r) => [r.stepId, r.outcome])).toEqual([
      ["intro", "completed"], // 8 秒で次へ
      ["earthquake", "timedOut"],
      ["fire", "timedOut"],
      ["open-door", "timedOut"],
      ["evacuate", "timedOut"],
      ["ending", "completed"],
    ]);
  });

  it("intro はナレーションが終わらなくても 8 秒で次へ進む", () => {
    let s = startScenario(sample).state;
    s = run(s, 7.5).state;
    expect(s.stepId).toBe("intro");
    s = run(s, 0.5).state;
    expect(s.stepId).toBe("earthquake");
  });

  it("earthquake: 6 秒で助言，15 秒で時間切れの演出を出して fire へ進む", () => {
    const s = reachStep("earthquake");
    const r1 = run(s, 6);
    expect(cueIds(r1.effects)).toEqual(["hint-desk"]);
    const r2 = run(r1.state, 9);
    expect(cueIds(r2.effects)).toContain("take-cover-timeout");
    expect(r2.state.stepId).toBe("fire");
  });

  it("earthquake: 揺れの最中に 3 秒歩くと危険な行動として記録される", () => {
    const s = reachStep("earthquake");
    const r = run(s, 3, input({ walking: true }));
    expect(r.state.evaluations.map((e) => [e.id, e.polarity])).toEqual([
      ["walked-during-shaking", "bad"],
    ]);
  });

  it("fire: 立ったまま 3 秒歩くと危険な行動として記録される", () => {
    const s = reachStep("fire");
    const r = run(s, 3, input({ posture: "standing", walking: true }));
    expect(r.state.evaluations.map((e) => e.id)).toEqual(["walked-upright-in-smoke"]);
  });

  it("evacuate: 集合場所に 1 秒いないと完了しない", () => {
    const s = reachStep("evacuate");
    const r = once(s, input({ areaIds: ["assembly-point"] }));
    expect(r.state.stepId).toBe("evacuate");
  });

  // ---- 同時に満たすこと（together）が必要な判定（以前は all のラッチで誤って成立していた） ----

  it("earthquake: 机の下を通り過ぎただけで，別の場所でしゃがみ 3 秒では完了しない（「机の下のエリアで，しゃがみを 3 秒」）", () => {
    let s = reachStep("earthquake");
    s = once(s, input({ areaIds: ["under-desk"] })).state; // 机の下を通り過ぎる
    s = run(s, 3, input({ posture: "crouching", areaIds: [] })).state; // 机の外でしゃがむ
    expect(s.stepId).toBe("earthquake");
  });

  it("fire: 立ち止まった後にしゃがんで歩いても「立ったまま歩いた」とは記録されない", () => {
    let s = reachStep("fire");
    s = run(s, 3, input({ posture: "standing", walking: false })).state; // 立って止まる
    s = run(s, 3, input({ posture: "crouching", walking: true })).state; // しゃがんで歩く
    expect(s.evaluations.map((e) => e.id)).not.toContain("walked-upright-in-smoke");
  });

  it("earthquake: 机の下でのしゃがみが途中で途切れたら（机から出た）数え直す", () => {
    let s = reachStep("earthquake");
    const crouchDesk = input({ posture: "crouching", areaIds: ["under-desk"] });
    s = run(s, 2, crouchDesk).state;
    s = once(s, input({ posture: "crouching", areaIds: [] })).state; // 机から出る
    s = run(s, 2.5, crouchDesk).state;
    expect(s.stepId).toBe("earthquake");
    s = run(s, 0.5, crouchDesk).state;
    expect(s.stepId).toBe("fire");
  });

  it("earthquake: 机の下で立ったままでは完了しない", () => {
    let s = reachStep("earthquake");
    s = run(s, 10, input({ areaIds: ["under-desk"] })).state;
    expect(s.stepId).toBe("earthquake");
  });

  it("fire: 立って歩く・しゃがんで歩くを交互にして，立ったまま歩く状態が 3 秒続かなければ記録されない", () => {
    let s = reachStep("fire");
    s = run(s, 2, input({ posture: "standing", walking: true })).state;
    s = run(s, 1, input({ posture: "crouching", walking: true })).state;
    s = run(s, 2, input({ posture: "standing", walking: true })).state;
    expect(s.evaluations.map((e) => e.id)).not.toContain("walked-upright-in-smoke");
    s = run(s, 1, input({ posture: "standing", walking: true })).state;
    expect(s.evaluations.map((e) => e.id)).toContain("walked-upright-in-smoke");
  });

  it("intro: ナレーションの終わりと同時に届いた別の出来事は earthquake に持ち越されるが，intro の signal は持ち越されない", () => {
    const s0 = startScenario(sample).state;
    const area: GameEvent = { type: "areaEntered", areaId: "under-desk" };
    const r = once(s0, input(), [{ type: "signal", name: "narration-ended:intro" }, area]);
    expect(r.state.stepId).toBe("earthquake");
    expect(r.state.pendingEvents).toEqual([area]);
  });
});
