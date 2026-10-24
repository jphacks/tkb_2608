import { describe, expect, it } from "vitest";
import { DEFAULT_VOLUME_CUES, VOLUME_CHECK_NARRATION } from "./volumeCheck";

describe("VOLUME_CHECK_NARRATION", () => {
  it("ナレーションの例の文は空でない", () => {
    expect(VOLUME_CHECK_NARRATION.trim().length).toBeGreaterThan(0);
  });

  it("本体の音量ボタンで合わせる案内である", () => {
    expect(VOLUME_CHECK_NARRATION).toContain("音量ボタン");
  });
});

describe("DEFAULT_VOLUME_CUES", () => {
  it("警報と揺れの効果音の例を含む", () => {
    const kinds = DEFAULT_VOLUME_CUES.map((c) => c.kind);
    expect(kinds).toContain("alarm");
    expect(kinds).toContain("rumble");
  });

  it("時刻は有限の 0 以上の数で，昇順に並ぶ", () => {
    for (const cue of DEFAULT_VOLUME_CUES) {
      expect(Number.isFinite(cue.at)).toBe(true);
      expect(cue.at).toBeGreaterThanOrEqual(0);
    }
    const times = DEFAULT_VOLUME_CUES.map((c) => c.at);
    expect(times).toEqual([...times].sort((a, b) => a - b));
    expect(new Set(times).size).toBe(times.length);
  });

  it("警報は 5.5 秒目，揺れは 8.5 秒目（警報 → 揺れの順）", () => {
    expect(DEFAULT_VOLUME_CUES).toEqual([
      { at: 5.5, kind: "alarm" },
      { at: 8.5, kind: "rumble" },
    ]);
  });
});
