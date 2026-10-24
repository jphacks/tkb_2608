// 校内放送のチャイム（Issue #120 の決定事項: 校内放送は前後にチャイム．ド・ミ・ソ・ド）のテスト
import { describe, expect, it } from "vitest";
import { ANNOUNCEMENT_CHIME, chimeWaitSeconds } from "./chime";

describe("ANNOUNCEMENT_CHIME", () => {
  it("前は 4 音で上がる（ド・ミ・ソ・ド）", () => {
    const hz = ANNOUNCEMENT_CHIME.start.map((n) => n.hz);
    expect(hz).toHaveLength(4);
    for (let i = 1; i < hz.length; i++) expect(hz[i]).toBeGreaterThan(hz[i - 1]);
    // 最後のドは最初のドの 1 オクターブ上
    expect(hz[3] / hz[0]).toBeCloseTo(2, 2);
  });

  it("後は前を逆にした 4 音で下がる", () => {
    expect(ANNOUNCEMENT_CHIME.end.map((n) => n.hz)).toEqual(
      [...ANNOUNCEMENT_CHIME.start.map((n) => n.hz)].reverse(),
    );
  });

  it.each(["start", "end"] as const)("%s の音は 0 秒から始まり，時刻が増えていく", (kind) => {
    const at = ANNOUNCEMENT_CHIME[kind].map((n) => n.at);
    expect(at[0]).toBe(0);
    for (let i = 1; i < at.length; i++) expect(at[i]).toBeGreaterThan(at[i - 1]);
  });
});

describe("chimeWaitSeconds", () => {
  it.each(["start", "end"] as const)("%s は最後の音より後で，有限の正の数", (kind) => {
    const last = Math.max(...ANNOUNCEMENT_CHIME[kind].map((n) => n.at));
    const s = chimeWaitSeconds(kind);
    expect(Number.isFinite(s)).toBe(true);
    expect(s).toBeGreaterThan(last);
  });
});
