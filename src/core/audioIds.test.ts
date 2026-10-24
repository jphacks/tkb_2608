// 音とナレーションの ID・Cue を作る関数（Issue #120 の決定事項，SPEC_01「受け渡すデータ」の Cue）のテスト
import { describe, expect, it } from "vitest";
import { NARRATION_ID, narrationCue, narrationEndedSignal, SOUND_ID, soundCue } from "./audioIds";

describe("SOUND_ID・NARRATION_ID", () => {
  it("効果音の ID は決めた 6 つ", () => {
    expect(new Set(Object.values(SOUND_ID))).toEqual(
      new Set([
        "classroom-ambience",
        "fire-alarm",
        "fire-burning",
        "near-fire-warning",
        "announcement-chime-start",
        "announcement-chime-end",
      ]),
    );
  });

  it("ナレーションの ID は決めた 4 つ", () => {
    expect(new Set(Object.values(NARRATION_ID))).toEqual(
      new Set(["classroom-intro", "fire-announcement", "evacuate-start", "drill-ending"]),
    );
  });

  it("効果音とナレーションの ID は重ならない", () => {
    const sounds = new Set<string>(Object.values(SOUND_ID));
    for (const id of Object.values(NARRATION_ID)) expect(sounds.has(id)).toBe(false);
  });
});

describe("narrationEndedSignal", () => {
  it.each([
    ["fire-announcement", "narration-ended:fire-announcement"],
    ["classroom-intro", "narration-ended:classroom-intro"],
    ["unknown-id", "narration-ended:unknown-id"],
    ["", "narration-ended:"],
  ])("%s は %s", (id, name) => {
    expect(narrationEndedSignal(id)).toBe(name);
  });
});

describe("soundCue", () => {
  it("loop・anchorId を省くとキー自体が無い", () => {
    const cue = soundCue(SOUND_ID.fireAlarm, "play");
    expect(cue).toEqual({ type: "sound", id: "fire-alarm", action: "play" });
    expect(Object.keys(cue).sort()).toEqual(["action", "id", "type"]);
  });

  it("空の options でもキーは増えない", () => {
    expect(Object.keys(soundCue(SOUND_ID.fireAlarm, "stop", {})).sort()).toEqual([
      "action",
      "id",
      "type",
    ]);
  });

  it("loop を指定した時だけ loop が入る（false も入る）", () => {
    expect(soundCue(SOUND_ID.fireAlarm, "play", { loop: true })).toEqual({
      type: "sound",
      id: "fire-alarm",
      action: "play",
      loop: true,
    });
    const off = soundCue(SOUND_ID.fireAlarm, "play", { loop: false });
    expect(off).toHaveProperty("loop", false);
    expect(off).not.toHaveProperty("anchorId");
  });

  it("anchorId を指定した時だけ anchorId が入る（空の文字列も入る）", () => {
    const cue = soundCue(SOUND_ID.fireBurning, "play", { anchorId: "fire-1" });
    expect(cue).toEqual({ type: "sound", id: "fire-burning", action: "play", anchorId: "fire-1" });
    expect(cue).not.toHaveProperty("loop");
    expect(soundCue(SOUND_ID.fireBurning, "play", { anchorId: "" })).toHaveProperty("anchorId", "");
  });

  it("stop の Cue を作れる", () => {
    expect(soundCue(SOUND_ID.classroomAmbience, "stop")).toEqual({
      type: "sound",
      id: "classroom-ambience",
      action: "stop",
    });
  });
});

describe("narrationCue", () => {
  it("params を省くとキー自体が無い", () => {
    const cue = narrationCue(NARRATION_ID.classroomIntro);
    expect(cue).toEqual({ type: "narration", id: "classroom-intro" });
    expect(Object.keys(cue).sort()).toEqual(["id", "type"]);
  });

  it("params をそのまま入れる", () => {
    expect(narrationCue(NARRATION_ID.fireAnnouncement, { roomName: "3年1組" })).toEqual({
      type: "narration",
      id: "fire-announcement",
      params: { roomName: "3年1組" },
    });
  });

  it("空の params も入れる", () => {
    expect(narrationCue(NARRATION_ID.ending, {})).toEqual({
      type: "narration",
      id: "drill-ending",
      params: {},
    });
  });
});
