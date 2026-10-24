// Cue → audio/ の指示（Issue #120 の決定事項・SPEC_01「受け渡すデータ」の Cue）のテスト
import { describe, expect, it } from "vitest";
import { narrationCue, SOUND_ID, soundCue } from "../core/audioIds";
import type { Cue } from "../core/cue";
import { type CuePlanState, INITIAL_CUE_PLAN_STATE, planCue } from "./cuePlan";

/** Cue を順に流し，最後の状態とすべての指示を返す */
function run(cues: readonly Cue[], state: CuePlanState = INITIAL_CUE_PLAN_STATE) {
  let s = state;
  const commands = [];
  for (const cue of cues) {
    const r = planCue(s, cue);
    s = r.state;
    commands.push(...r.commands);
  }
  return { state: s, commands };
}

describe("planCue（効果音）", () => {
  it("ループの音の play は playSound（loop: true）でループ中に入る", () => {
    const r = planCue(INITIAL_CUE_PLAN_STATE, soundCue(SOUND_ID.fireAlarm, "play"));
    expect(r.commands).toEqual([{ type: "playSound", id: "fire-alarm", loop: true }]);
    expect(r.state.loopingIds).toEqual(["fire-alarm"]);
  });

  it("鳴っているループにもう一度 play が来ても鳴らし直さない", () => {
    const r = run([
      soundCue(SOUND_ID.fireAlarm, "play", { loop: true }),
      soundCue(SOUND_ID.fireAlarm, "play", { loop: true }),
      soundCue(SOUND_ID.fireAlarm, "play"),
    ]);
    expect(r.commands).toEqual([{ type: "playSound", id: "fire-alarm", loop: true }]);
    expect(r.state.loopingIds).toEqual(["fire-alarm"]);
  });

  it("stop の後の play はもう一度鳴らす", () => {
    const r = run([
      soundCue(SOUND_ID.fireAlarm, "play"),
      soundCue(SOUND_ID.fireAlarm, "stop"),
      soundCue(SOUND_ID.fireAlarm, "play"),
    ]);
    expect(r.commands).toEqual([
      { type: "playSound", id: "fire-alarm", loop: true },
      { type: "stopSound", id: "fire-alarm" },
      { type: "playSound", id: "fire-alarm", loop: true },
    ]);
    expect(r.state.loopingIds).toEqual(["fire-alarm"]);
  });

  it("stop はその ID の音をすべて止める指示を出し，ループ中から外す（他の ID は残る）", () => {
    const r = run([
      soundCue(SOUND_ID.fireAlarm, "play"),
      soundCue(SOUND_ID.fireBurning, "play"),
      soundCue(SOUND_ID.fireAlarm, "stop"),
    ]);
    expect(r.commands.at(-1)).toEqual({ type: "stopSound", id: "fire-alarm" });
    expect(r.state.loopingIds).toEqual(["fire-burning"]);
  });

  it("鳴っていない音の stop も止める指示を出す（1 回だけの音を止めるため）", () => {
    const r = planCue(INITIAL_CUE_PLAN_STATE, soundCue(SOUND_ID.nearFireWarning, "stop"));
    expect(r.commands).toEqual([{ type: "stopSound", id: "near-fire-warning" }]);
    expect(r.state.loopingIds).toEqual([]);
  });

  it("1 回だけの音は loop: true でも 1 回だけで，続けて来れば毎回鳴らす", () => {
    const r = run([
      soundCue(SOUND_ID.nearFireWarning, "play", { loop: true }),
      soundCue(SOUND_ID.nearFireWarning, "play"),
    ]);
    expect(r.commands).toEqual([
      { type: "playSound", id: "near-fire-warning", loop: false },
      { type: "playSound", id: "near-fire-warning", loop: false },
    ]);
    expect(r.state.loopingIds).toEqual([]);
  });

  it("ループの音を loop: false で鳴らすと 1 回だけで，ループ中には入らない", () => {
    const r = run([
      soundCue(SOUND_ID.classroomAmbience, "play", { loop: false }),
      soundCue(SOUND_ID.classroomAmbience, "play", { loop: false }),
    ]);
    expect(r.commands).toEqual([
      { type: "playSound", id: "classroom-ambience", loop: false },
      { type: "playSound", id: "classroom-ambience", loop: false },
    ]);
    expect(r.state.loopingIds).toEqual([]);
  });

  it.each(["", "unknown", "fire-start", "classroom-intro"])(
    "未知の効果音の ID %j は何もしない",
    (id) => {
      const r = planCue(INITIAL_CUE_PLAN_STATE, { type: "sound", id, action: "play" });
      expect(r.commands).toEqual([]);
      expect(r.state).toBe(INITIAL_CUE_PLAN_STATE);
      expect(
        planCue(INITIAL_CUE_PLAN_STATE, { type: "sound", id, action: "stop" }).commands,
      ).toEqual([]);
    },
  );

  it("anchorId があっても鳴らす", () => {
    const r = planCue(
      INITIAL_CUE_PLAN_STATE,
      soundCue(SOUND_ID.fireBurning, "play", { anchorId: "fire-1" }),
    );
    expect(r.commands).toEqual([{ type: "playSound", id: "fire-burning", loop: true }]);
  });

  it("状態を書き換えない（元の状態はそのまま）", () => {
    const state: CuePlanState = { loopingIds: ["fire-alarm"] };
    planCue(state, soundCue(SOUND_ID.fireBurning, "play"));
    planCue(state, soundCue(SOUND_ID.fireAlarm, "stop"));
    expect(state.loopingIds).toEqual(["fire-alarm"]);
  });
});

describe("planCue（ナレーション・出来事）", () => {
  it("ナレーションは narrate（params を省くと空）", () => {
    const r = planCue(INITIAL_CUE_PLAN_STATE, narrationCue("classroom-intro"));
    expect(r.commands).toEqual([{ type: "narrate", id: "classroom-intro", params: {} }]);
    expect(r.state).toBe(INITIAL_CUE_PLAN_STATE);
  });

  it("params をそのまま渡す", () => {
    const r = planCue(
      INITIAL_CUE_PLAN_STATE,
      narrationCue("fire-announcement", { roomName: "3年1組" }),
    );
    expect(r.commands).toEqual([
      { type: "narrate", id: "fire-announcement", params: { roomName: "3年1組" } },
    ]);
  });

  it("未知のナレーションの ID も narrate にする（読まずに終わった signal を流すため）", () => {
    const r = planCue(INITIAL_CUE_PLAN_STATE, { type: "narration", id: "unknown" });
    expect(r.commands).toEqual([{ type: "narrate", id: "unknown", params: {} }]);
  });

  it("同じナレーションが続いても毎回 narrate にする", () => {
    const r = run([narrationCue("classroom-intro"), narrationCue("classroom-intro")]);
    expect(r.commands).toHaveLength(2);
  });

  it.each(["fire-start", "fire-alarm"])("出来事（happening: %s）は何もしない", (id) => {
    const r = planCue(INITIAL_CUE_PLAN_STATE, { type: "happening", id });
    expect(r.commands).toEqual([]);
    expect(r.state).toBe(INITIAL_CUE_PLAN_STATE);
  });
});
