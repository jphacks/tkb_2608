// 効果音の鳴らし方の約束（Issue #120 の決定事項: 環境音・非常ベル・炎は既定でループ，警告音とチャイムはループ不可）のテスト
import { describe, expect, it } from "vitest";
import { SOUND_ID, type SoundId } from "./audioIds";
import {
  resolveLoop,
  resolveStopAt,
  SOUND_DEFINITIONS,
  type SoundDefinition,
} from "./soundCatalog";

const LOOPING: readonly SoundId[] = [
  SOUND_ID.classroomAmbience,
  SOUND_ID.fireAlarm,
  SOUND_ID.fireBurning,
];
const ONE_SHOT: readonly SoundId[] = [
  SOUND_ID.nearFireWarning,
  SOUND_ID.announcementChimeStart,
  SOUND_ID.announcementChimeEnd,
];

function definition(over: Partial<SoundDefinition> = {}): SoundDefinition {
  return {
    loopable: true,
    defaultLoop: true,
    oneShotSeconds: 3,
    duckDuringNarration: true,
    ...over,
  };
}

describe("SOUND_DEFINITIONS", () => {
  it.each(LOOPING)("%s はループでき，既定でループする", (id) => {
    expect(SOUND_DEFINITIONS[id].loopable).toBe(true);
    expect(SOUND_DEFINITIONS[id].defaultLoop).toBe(true);
  });

  it.each(ONE_SHOT)("%s はループできない", (id) => {
    expect(SOUND_DEFINITIONS[id].loopable).toBe(false);
    expect(SOUND_DEFINITIONS[id].defaultLoop).toBe(false);
  });

  it.each(Object.values(SOUND_ID))("%s の 1 回だけの長さは有限の正の数", (id) => {
    const s = SOUND_DEFINITIONS[id].oneShotSeconds;
    expect(Number.isFinite(s)).toBe(true);
    expect(s).toBeGreaterThan(0);
  });

  it("チャイムはナレーションの間に小さくしない（放送の一部のため）", () => {
    expect(SOUND_DEFINITIONS[SOUND_ID.announcementChimeStart].duckDuringNarration).toBe(false);
    expect(SOUND_DEFINITIONS[SOUND_ID.announcementChimeEnd].duckDuringNarration).toBe(false);
  });
});

describe("resolveLoop", () => {
  it.each(LOOPING)("%s は loop を省くとループ", (id) => {
    expect(resolveLoop(SOUND_DEFINITIONS[id], undefined)).toBe(true);
  });

  it.each(LOOPING)("%s は loop: false なら 1 回だけ", (id) => {
    expect(resolveLoop(SOUND_DEFINITIONS[id], false)).toBe(false);
  });

  it.each(LOOPING)("%s は loop: true ならループ", (id) => {
    expect(resolveLoop(SOUND_DEFINITIONS[id], true)).toBe(true);
  });

  it.each(ONE_SHOT)("%s は loop を指定しても 1 回だけ", (id) => {
    expect(resolveLoop(SOUND_DEFINITIONS[id], true)).toBe(false);
    expect(resolveLoop(SOUND_DEFINITIONS[id], false)).toBe(false);
    expect(resolveLoop(SOUND_DEFINITIONS[id], undefined)).toBe(false);
  });

  it("ループできて既定でループしない音は，loop を省くと 1 回だけ", () => {
    expect(resolveLoop(definition({ defaultLoop: false }), undefined)).toBe(false);
    expect(resolveLoop(definition({ defaultLoop: false }), true)).toBe(true);
  });
});

describe("resolveStopAt", () => {
  it("ループで切れ目の無い音は止めない（null）", () => {
    expect(resolveStopAt(definition(), true, 10, null)).toBeNull();
  });

  it("1 回だけの切れ目の無い音は oneShotSeconds 後に止める", () => {
    expect(resolveStopAt(definition({ oneShotSeconds: 3 }), false, 10, null)).toBe(13);
  });

  it("ひとりでに終わる音はその時刻に止める", () => {
    expect(resolveStopAt(definition(), false, 10, 12.5)).toBe(12.5);
    expect(resolveStopAt(definition(), true, 10, 12.5)).toBe(12.5);
  });

  it("長さの指定があればその長さで止める（ループでも）", () => {
    expect(resolveStopAt(definition(), true, 10, null, 2)).toBe(12);
    expect(resolveStopAt(definition(), false, 10, null, 2)).toBe(12);
  });

  it("長さの指定とひとりでに終わる時刻は早い方", () => {
    expect(resolveStopAt(definition(), false, 10, 11, 5)).toBe(11);
    expect(resolveStopAt(definition(), false, 10, 20, 5)).toBe(15);
  });

  it.each([0, -1, Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY])(
    "長さの指定が %s なら使わない",
    (duration) => {
      expect(resolveStopAt(definition(), true, 10, null, duration)).toBeNull();
      expect(resolveStopAt(definition({ oneShotSeconds: 3 }), false, 10, null, duration)).toBe(13);
    },
  );
});
