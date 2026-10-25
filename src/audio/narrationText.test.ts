// ナレーションの文面と読み上げ時間の見積もり（SPEC_01「火災訓練のシナリオ」・Issue #120 の決定事項）のテスト
import { describe, expect, it } from "vitest";
import { NARRATION_ID } from "./audioIds";
import {
  buildNarration,
  DEFAULT_SPEECH_PACING,
  estimateSpeechSeconds,
  fillTemplate,
  NARRATION_SCRIPTS,
  SPEECH_PITCH,
  SPEECH_RATE,
  speechTimeoutSeconds,
} from "./narrationText";

describe("buildNarration（文面）", () => {
  it.each([
    [NARRATION_ID.classroomIntro, "授業中です．周りを見てみましょう"],
    [NARRATION_ID.evacuateStart, "火と煙を避けて，校庭へ避難しましょう"],
    [NARRATION_ID.ending, "集合場所に着きました．訓練を終わります"],
  ])("%s は「%s」で普通のナレーション", (id, text) => {
    expect(buildNarration(id)).toEqual({ text, style: "narration" });
  });

  it("校内放送は roomName を差し込み，放送として読む", () => {
    expect(buildNarration(NARRATION_ID.fireAnnouncement, { roomName: "3年1組" })).toEqual({
      text: "3年1組で火事です．先生の指示に従って避難してください",
      style: "announcement",
    });
  });

  it("校内放送の roomName の前後の空白は除く", () => {
    expect(buildNarration(NARRATION_ID.fireAnnouncement, { roomName: "  理科室 " })?.text).toBe(
      "理科室で火事です．先生の指示に従って避難してください",
    );
  });

  it.each([
    ["params が無い", undefined],
    ["roomName が無い", {}],
    ["roomName が空", { roomName: "" }],
    ["roomName が空白だけ", { roomName: "   " }],
    ["roomName が NaN", { roomName: Number.NaN }],
    ["roomName が Infinity", { roomName: Number.POSITIVE_INFINITY }],
    ["関係の無い params だけ", { other: "x" }],
  ])("校内放送で %s なら場所を省いた文", (_, params) => {
    expect(buildNarration(NARRATION_ID.fireAnnouncement, params)).toEqual({
      text: "火事です．先生の指示に従って避難してください",
      style: "announcement",
    });
  });

  it("roomName が数値なら文字にして差し込む", () => {
    expect(buildNarration(NARRATION_ID.fireAnnouncement, { roomName: 101 })?.text).toBe(
      "101で火事です．先生の指示に従って避難してください",
    );
    expect(buildNarration(NARRATION_ID.fireAnnouncement, { roomName: 0 })?.text).toBe(
      "0で火事です．先生の指示に従って避難してください",
    );
  });

  it("文面に {名前} の無いナレーションは params があっても変わらない", () => {
    expect(buildNarration(NARRATION_ID.classroomIntro, { roomName: "3年1組" })?.text).toBe(
      "授業中です．周りを見てみましょう",
    );
  });

  it.each(["", "unknown", "fire-alarm", "fire-start"])("未知の ID %j は null", (id) => {
    expect(buildNarration(id)).toBeNull();
    expect(buildNarration(id, { roomName: "3年1組" })).toBeNull();
  });

  it("どの文面も埋めた後に {名前} が残らない", () => {
    for (const id of Object.keys(NARRATION_SCRIPTS)) {
      const built = buildNarration(id, { roomName: "3年1組" });
      expect(built?.text).not.toMatch(/[{}]/);
      expect(built?.text.length ?? 0).toBeGreaterThan(0);
    }
  });
});

describe("fillTemplate", () => {
  it("すべての {名前} を埋める", () => {
    expect(fillTemplate("{a}と{b}と{a}", { a: "x", b: 2 })).toBe("xと2とx");
  });

  it("{名前} が無ければそのまま", () => {
    expect(fillTemplate("そのまま", {})).toBe("そのまま");
    expect(fillTemplate("", {})).toBe("");
  });

  it.each([
    ["無い", {}],
    ["空", { a: "" }],
    ["NaN", { a: Number.NaN }],
  ])("埋められない {名前} があれば null（値が%s）", (_, params) => {
    expect(fillTemplate("{a}です", params)).toBeNull();
  });

  it("真偽値は文字にして埋める", () => {
    expect(fillTemplate("{a}", { a: true })).toBe("true");
    expect(fillTemplate("{a}", { a: false })).toBe("false");
  });

  it("Object の持つ名前（toString 等）は params に無ければ埋めない", () => {
    expect(fillTemplate("{toString}", {})).toBeNull();
  });
});

describe("SPEECH_PITCH", () => {
  it("普通のナレーションは 1.0，校内放送はそれより少し低い", () => {
    expect(SPEECH_PITCH.narration).toBe(1.0);
    expect(SPEECH_PITCH.announcement).toBeLessThan(SPEECH_PITCH.narration);
    expect(SPEECH_PITCH.announcement).toBeGreaterThan(0);
  });
});

describe("SPEECH_RATE", () => {
  it("普通のナレーションは 1.0，校内放送はそれより遅い", () => {
    expect(SPEECH_RATE.narration).toBe(1.0);
    expect(SPEECH_RATE.announcement).toBeLessThan(SPEECH_RATE.narration);
    expect(SPEECH_RATE.announcement).toBeGreaterThan(0);
  });
});

describe("estimateSpeechSeconds", () => {
  it("rate 1.05 で 1 秒 7 文字", () => {
    expect(estimateSpeechSeconds("あいうえおかき", 1.05)).toBeCloseTo(1);
    expect(estimateSpeechSeconds("a".repeat(14), 1.05)).toBeCloseTo(2);
  });

  it("空白は数えない（全角の空白・改行も）", () => {
    expect(estimateSpeechSeconds("あい う　え\nおか\tき", 1.05)).toBeCloseTo(1);
    expect(estimateSpeechSeconds("   ", 1.05)).toBe(0);
  });

  it("句読点は数える", () => {
    expect(estimateSpeechSeconds("あいう，えお．か", 1.05)).toBeCloseTo(8 / 7);
  });

  it("空の文字列は 0 秒", () => {
    expect(estimateSpeechSeconds("", 1.05)).toBe(0);
  });

  it("rate に比例して短くなる", () => {
    const text = "あいうえおかきくけこ";
    expect(estimateSpeechSeconds(text, 2.1)).toBeCloseTo(estimateSpeechSeconds(text, 1.05) / 2);
    expect(estimateSpeechSeconds(text, 0.525)).toBeCloseTo(estimateSpeechSeconds(text, 1.05) * 2);
  });

  it.each([Number.NaN, 0, -1, Number.POSITIVE_INFINITY])(
    "rate が %s なら 1.05 として見積もる",
    (rate) => {
      expect(estimateSpeechSeconds("あいうえおかき", rate)).toBeCloseTo(1);
    },
  );

  it("サロゲートペアの文字は 1 文字と数える", () => {
    expect(estimateSpeechSeconds("𠮷𠮷𠮷𠮷𠮷𠮷𠮷", 1.05)).toBeCloseTo(1);
  });

  it.each([0, -3, Number.NaN])("charsPerSecond が %s なら既定の 7 で見積もる", (cps) => {
    expect(
      estimateSpeechSeconds("あいうえおかき", 1.05, { charsPerSecond: cps, marginSeconds: 4 }),
    ).toBeCloseTo(1);
  });

  it("校内放送の文は 0 秒より長く，有限", () => {
    const text = buildNarration(NARRATION_ID.fireAnnouncement, { roomName: "3年1組" })?.text ?? "";
    const s = estimateSpeechSeconds(text, SPEECH_RATE.announcement);
    expect(Number.isFinite(s)).toBe(true);
    expect(s).toBeGreaterThan(0);
  });
});

describe("speechTimeoutSeconds", () => {
  it("見積もり＋4 秒", () => {
    expect(DEFAULT_SPEECH_PACING.marginSeconds).toBe(4);
    expect(speechTimeoutSeconds("あいうえおかき", 1.05)).toBeCloseTo(5);
    expect(speechTimeoutSeconds("", 1.05)).toBeCloseTo(4);
  });

  it("rate が NaN でも有限", () => {
    expect(speechTimeoutSeconds("あいうえおかき", Number.NaN)).toBeCloseTo(5);
  });

  it.each([-1, Number.NaN])("余裕が %s なら 0 として足す", (margin) => {
    expect(
      speechTimeoutSeconds("あいうえおかき", 1.05, { charsPerSecond: 7, marginSeconds: margin }),
    ).toBeCloseTo(1);
  });
});
