// audio/ の ID の判定と，担当D のシナリオ（src/scenario/drill.ts）の ID との一致のテスト
// （Issue #120「音の ID の対応表: DRILL_CUE_ID に合わせる」）
import { describe, expect, it } from "vitest";
import type { Cue } from "../core/cue";
import {
  buildDrillScenario,
  DRILL_CUE_ID,
  FIRE_ANNOUNCEMENT_ENDED_SIGNAL,
} from "../scenario/drill";
import { DEMO_SCHOOL } from "../share/samples/demoSchool";
import { isNarrationId, isSoundId, NARRATION_ID, narrationEndedSignal, SOUND_ID } from "./audioIds";
import { NARRATION_SCRIPTS } from "./narrationText";
import { SOUND_DEFINITIONS } from "./soundCatalog";

describe("isSoundId", () => {
  it.each(Object.values(SOUND_ID))("%s は効果音", (id) => {
    expect(isSoundId(id)).toBe(true);
  });

  it.each(["", "unknown", "FIRE-ALARM", " fire-alarm", "classroom-intro", "fire-start"])(
    "%j は効果音ではない",
    (id) => {
      expect(isSoundId(id)).toBe(false);
    },
  );
});

describe("isNarrationId", () => {
  it.each(Object.values(NARRATION_ID))("%s はナレーション", (id) => {
    expect(isNarrationId(id)).toBe(true);
  });

  it.each(["", "unknown", "fire-alarm", "fire-start", "Classroom-Intro"])(
    "%j はナレーションではない",
    (id) => {
      expect(isNarrationId(id)).toBe(false);
    },
  );
});

describe("DRILL_CUE_ID との一致", () => {
  it("シナリオの効果音の ID は SOUND_ID にある", () => {
    expect(SOUND_ID.classroomAmbience).toBe(DRILL_CUE_ID.classroomAmbience);
    expect(SOUND_ID.fireAlarm).toBe(DRILL_CUE_ID.fireAlarm);
  });

  it("シナリオのナレーションの ID は NARRATION_ID にある", () => {
    expect(NARRATION_ID.classroomIntro).toBe(DRILL_CUE_ID.classroomIntro);
    expect(NARRATION_ID.fireAnnouncement).toBe(DRILL_CUE_ID.fireAnnouncement);
    expect(NARRATION_ID.evacuateStart).toBe(DRILL_CUE_ID.evacuateStart);
    expect(NARRATION_ID.ending).toBe(DRILL_CUE_ID.ending);
  });

  it("fire-start（出来事）以外の DRILL_CUE_ID はすべて audio/ の ID", () => {
    for (const [key, id] of Object.entries(DRILL_CUE_ID)) {
      if (key === "fireStart") continue;
      expect(isSoundId(id) || isNarrationId(id), id).toBe(true);
    }
  });

  it("校内放送の終わりの signal は FIRE_ANNOUNCEMENT_ENDED_SIGNAL と同じ", () => {
    expect(narrationEndedSignal(NARRATION_ID.fireAnnouncement)).toBe(
      FIRE_ANNOUNCEMENT_ENDED_SIGNAL,
    );
  });
});

describe("火災訓練のシナリオが出す Cue", () => {
  const scenario = buildDrillScenario(DEMO_SCHOOL);
  const cues: Cue[] = scenario.steps.flatMap((step) => [
    ...(step.onEnter ?? []),
    ...(step.onComplete ?? []),
    ...(step.timeout?.cues ?? []),
    ...(step.hints ?? []).flatMap((hint) => hint.cues),
  ]);

  it("音とナレーションの Cue がある", () => {
    expect(cues.some((c) => c.type === "sound")).toBe(true);
    expect(cues.some((c) => c.type === "narration")).toBe(true);
  });

  it("効果音の Cue の ID はすべて鳴らし方の表にある", () => {
    for (const cue of cues) {
      if (cue.type !== "sound") continue;
      expect(isSoundId(cue.id), cue.id).toBe(true);
      expect(Object.hasOwn(SOUND_DEFINITIONS, cue.id), cue.id).toBe(true);
    }
  });

  it("ナレーションの Cue の ID はすべて文面の表にある", () => {
    for (const cue of cues) {
      if (cue.type !== "narration") continue;
      expect(isNarrationId(cue.id), cue.id).toBe(true);
      expect(Object.hasOwn(NARRATION_SCRIPTS, cue.id), cue.id).toBe(true);
    }
  });

  it("校内放送の Cue は params.roomName に火元の名前を持つ", () => {
    const announcement = cues.find(
      (c) => c.type === "narration" && c.id === NARRATION_ID.fireAnnouncement,
    );
    expect(announcement?.type).toBe("narration");
    if (announcement?.type !== "narration") return;
    expect(typeof announcement.params?.roomName).toBe("string");
    expect(announcement.params?.roomName).not.toBe("");
  });
});

describe("表の網羅", () => {
  it("SOUND_ID のすべてに鳴らし方がある", () => {
    expect(new Set(Object.keys(SOUND_DEFINITIONS))).toEqual(new Set(Object.values(SOUND_ID)));
  });

  it("NARRATION_ID のすべてに文面がある", () => {
    expect(new Set(Object.keys(NARRATION_SCRIPTS))).toEqual(new Set(Object.values(NARRATION_ID)));
  });
});
