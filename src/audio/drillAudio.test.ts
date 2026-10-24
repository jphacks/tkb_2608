// audio/ の入口（バスの cue → 読み上げ → 終わりの signal）のテスト．
// AudioContext は渡さず（効果音は鳴らさない），読み上げの口を差し替えて signal がバスに流れることを確かめる
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NARRATION_ID, narrationCue, SOUND_ID, soundCue } from "../core/audioIds";
import { createEventBus } from "../core/event-bus";
import type { AppEvent } from "../core/events";
import { FIRE_ANNOUNCEMENT_ENDED_SIGNAL } from "../scenario/drill";
import { createDrillAudio } from "./drillAudio";
import type { SpeechPort } from "./speech";

/** 読み上げの口の代わり．available: false なら始められない */
function fakeSpeech(available = true) {
  const spoken: { text: string; rate: number; onEnd: () => void }[] = [];
  let cancels = 0;
  const port: SpeechPort = {
    speak(text, rate, onEnd) {
      if (!available) return false;
      spoken.push({ text, rate, onEnd });
      return true;
    },
    cancel() {
      cancels++;
    },
  };
  return { port, spoken, cancels: () => cancels };
}

function setup(available = true) {
  const bus = createEventBus<AppEvent>();
  const speech = fakeSpeech(available);
  const signals: string[] = [];
  bus.on("signal", (e) => signals.push(e.name));
  const audio = createDrillAudio({ bus, audioContext: () => null, speech: speech.port });
  return { bus, speech, signals, audio };
}

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("createDrillAudio", () => {
  it("バスの cue でナレーションを読み，end で終わりの signal をバスに流す", () => {
    const { bus, speech, signals, audio } = setup();
    bus.emit({ type: "cue", cue: narrationCue(NARRATION_ID.classroomIntro) });
    expect(speech.spoken.map((s) => s.text)).toEqual(["授業中です．周りを見てみましょう"]);
    expect(signals).toEqual([]);
    speech.spoken[0].onEnd();
    expect(signals).toEqual(["narration-ended:classroom-intro"]);
    vi.advanceTimersByTime(60_000);
    expect(signals).toHaveLength(1);
    audio.dispose();
  });

  it("校内放送は火元の名前を入れてチャイムの後に読み，後のチャイムの後に FIRE_ANNOUNCEMENT_ENDED_SIGNAL を流す", () => {
    const { bus, speech, signals, audio } = setup();
    bus.emit({
      type: "cue",
      cue: narrationCue(NARRATION_ID.fireAnnouncement, { roomName: "3年1組" }),
    });
    expect(speech.spoken).toHaveLength(0);
    vi.advanceTimersByTime(3000);
    expect(speech.spoken.map((s) => s.text)).toEqual([
      "3年1組で火事です．先生の指示に従って避難してください",
    ]);
    speech.spoken[0].onEnd();
    expect(signals).toEqual([]);
    vi.advanceTimersByTime(5000);
    expect(signals).toEqual([FIRE_ANNOUNCEMENT_ENDED_SIGNAL]);
    audio.dispose();
  });

  it("読み上げが使えなくても時間がたてば signal を流す", () => {
    const { bus, signals, audio } = setup(false);
    bus.emit({ type: "cue", cue: narrationCue(NARRATION_ID.fireAnnouncement) });
    vi.advanceTimersByTime(60_000);
    expect(signals).toEqual([FIRE_ANNOUNCEMENT_ENDED_SIGNAL]);
    audio.dispose();
  });

  it("end が届かない端末でも見積もり＋4 秒で signal を流す", () => {
    const { bus, signals, audio } = setup();
    bus.emit({ type: "cue", cue: narrationCue(NARRATION_ID.evacuateStart) });
    // 「火と煙を避けて，校庭へ避難しましょう」は 17 文字 → 約 2.4 秒＋4 秒
    vi.advanceTimersByTime(6000);
    expect(signals).toEqual([]);
    vi.advanceTimersByTime(1000);
    expect(signals).toEqual(["narration-ended:evacuate-start"]);
    audio.dispose();
  });

  it("文面の無い ID はすぐ signal を流す", () => {
    const { bus, signals, speech, audio } = setup();
    bus.emit({ type: "cue", cue: { type: "narration", id: "unknown" } });
    expect(signals).toEqual(["narration-ended:unknown"]);
    expect(speech.spoken).toHaveLength(0);
    audio.dispose();
  });

  it("AudioContext が無くても効果音の cue で例外を出さない", () => {
    const { bus, audio } = setup();
    expect(() => {
      bus.emit({ type: "cue", cue: soundCue(SOUND_ID.fireAlarm, "play") });
      bus.emit({ type: "cue", cue: soundCue(SOUND_ID.nearFireWarning, "play") });
      bus.emit({ type: "cue", cue: soundCue(SOUND_ID.fireAlarm, "stop") });
      bus.emit({ type: "cue", cue: { type: "sound", id: "unknown", action: "play" } });
      bus.emit({ type: "cue", cue: { type: "happening", id: "fire-start" } });
    }).not.toThrow();
    audio.dispose();
  });

  it("stopAll は読み上げを止め，signal を流さない（購読は続ける）", () => {
    const { bus, speech, signals, audio } = setup();
    bus.emit({ type: "cue", cue: narrationCue(NARRATION_ID.classroomIntro) });
    audio.stopAll();
    expect(speech.cancels()).toBeGreaterThan(0);
    speech.spoken[0].onEnd();
    vi.advanceTimersByTime(60_000);
    expect(signals).toEqual([]);
    bus.emit({ type: "cue", cue: narrationCue(NARRATION_ID.ending) });
    speech.spoken[1].onEnd();
    expect(signals).toEqual(["narration-ended:drill-ending"]);
    audio.dispose();
  });

  it("dispose の後は cue を受けない（何度呼んでもよい）", () => {
    const { bus, speech, signals, audio } = setup();
    audio.dispose();
    audio.dispose();
    bus.emit({ type: "cue", cue: narrationCue(NARRATION_ID.classroomIntro) });
    audio.handleCue(narrationCue(NARRATION_ID.classroomIntro));
    vi.advanceTimersByTime(60_000);
    expect(speech.spoken).toHaveLength(0);
    expect(signals).toEqual([]);
  });

  it("handleCue でもバスの cue と同じように読む", () => {
    const { speech, signals, audio } = setup();
    audio.handleCue(narrationCue(NARRATION_ID.ending));
    speech.spoken[0].onEnd();
    expect(signals).toEqual(["narration-ended:drill-ending"]);
    audio.dispose();
  });
});
