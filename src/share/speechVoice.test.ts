// 読み上げの声の選び方と，読み上げに渡す文面の変換のテスト（Issue #184）
import { describe, expect, it } from "vitest";
import {
  createVoicePicker,
  isJapaneseVoice,
  pickVoice,
  toSpeechText,
  type VoiceLike,
  type VoiceSource,
} from "./speechVoice";

function voice(over: Partial<VoiceLike> = {}): VoiceLike {
  return { name: "Voice", lang: "ja-JP", localService: true, default: false, ...over };
}

describe("isJapaneseVoice", () => {
  it.each(["ja", "ja-JP", "ja_JP", "JA-jp", " ja-JP "])("%s は日本語", (lang) => {
    expect(isJapaneseVoice(voice({ lang }))).toBe(true);
  });

  it.each(["en-US", "", "jav", "zh-CN", "ko-KR"])("%s は日本語でない", (lang) => {
    expect(isJapaneseVoice(voice({ lang }))).toBe(false);
  });
});

describe("pickVoice", () => {
  it("空の一覧・日本語の声が無ければ null", () => {
    expect(pickVoice([])).toBeNull();
    expect(pickVoice([voice({ name: "Samantha", lang: "en-US" })])).toBeNull();
  });

  it("日本語の声だけを選ぶ（英語の高品質な声より日本語の普通の声）", () => {
    const ja = voice({ name: "Some Voice" });
    expect(pickVoice([voice({ name: "Samantha (Enhanced)", lang: "en-US" }), ja])).toBe(ja);
  });

  it.each([
    ["Kyoko (Enhanced)", "Kyoko"],
    ["Kyoko (Premium)", "Kyoko"],
    ["O-Ren（拡張）", "O-Ren"],
    ["Otoya（高品質）", "Otoya"],
  ])("名前に高品質の印がある声（%s）を同じ声の普通版（%s）より選ぶ", (good, plain) => {
    const picked = pickVoice([voice({ name: plain }), voice({ name: good })]);
    expect(picked?.name).toBe(good);
  });

  it.each([
    "Kyoko",
    "O-Ren",
    "Otoya",
    "Hattori",
    "Google 日本語",
    "Microsoft Nanami Online (Natural) - Japanese (Japan)",
  ])("既知の良い声（%s）を名前の知らない声より選ぶ", (name) => {
    const good = voice({ name, localService: false });
    expect(pickVoice([voice({ name: "Unknown", localService: true, default: true }), good])).toBe(
      good,
    );
  });

  it("同じ程度なら端末の中の声（localService）を選ぶ", () => {
    const local = voice({ name: "B", localService: true });
    expect(pickVoice([voice({ name: "A", localService: false }), local])).toBe(local);
  });

  it("同じ程度なら既定の声，それも同じなら一覧の先の声", () => {
    const def = voice({ name: "B", default: true });
    expect(pickVoice([voice({ name: "A" }), def])).toBe(def);
    const first = voice({ name: "A" });
    expect(pickVoice([first, voice({ name: "B" })])).toBe(first);
  });

  it.each([
    "Eddy (日本語（日本）)",
    "Flo",
    "Grandma",
    "Grandpa",
    "Reed",
    "Rocko",
    "Sandy",
    "Shelley",
  ])("ノベルティ系の声（%s）は名前の知らない声より後", (name) => {
    const other = voice({ name: "Unknown", localService: false });
    expect(pickVoice([voice({ name, default: true }), other])).toBe(other);
  });

  it("ノベルティ系の声しか無ければそれを選ぶ（声を指定しないより日本語で読める）", () => {
    const eddy = voice({ name: "Eddy" });
    expect(pickVoice([eddy])).toBe(eddy);
  });

  it("名前の一部が一致するだけの声はノベルティ扱いしない（Flower は Flo でない）", () => {
    const flower = voice({ name: "Flower", localService: true });
    expect(pickVoice([voice({ name: "Other", localService: false }), flower])).toBe(flower);
  });
});

describe("toSpeechText", () => {
  it("全角の「．」「，」を「。」「、」にする", () => {
    expect(toSpeechText("授業中です．周りを見てみましょう")).toBe(
      "授業中です。周りを見てみましょう",
    );
    expect(toSpeechText("火と煙を避けて，校庭へ避難しましょう．")).toBe(
      "火と煙を避けて、校庭へ避難しましょう。",
    );
  });

  it("半角の . , と他の文字は変えない", () => {
    expect(toSpeechText("3.5 m, 2 秒、です。")).toBe("3.5 m, 2 秒、です。");
    expect(toSpeechText("")).toBe("");
  });
});

/** voiceschanged を手で送れる声の一覧の出どころ */
function source(initial: readonly VoiceLike[]): VoiceSource<VoiceLike> & {
  set(voices: readonly VoiceLike[]): void;
  calls(): number;
} {
  let voices = initial;
  let listener: (() => void) | null = null;
  let calls = 0;
  return {
    getVoices() {
      calls++;
      return voices;
    },
    addEventListener(_type, l) {
      listener = l;
    },
    set(next) {
      voices = next;
      listener?.();
    },
    calls: () => calls,
  };
}

describe("createVoicePicker", () => {
  it("最初から一覧があればその中から選ぶ", () => {
    const kyoko = voice({ name: "Kyoko" });
    expect(createVoicePicker(source([voice({ name: "X" }), kyoko])).current()).toBe(kyoko);
  });

  it("一覧が遅れて届く端末では，届く前は null，voiceschanged の後は選んだ声", () => {
    const s = source([]);
    const picker = createVoicePicker(s);
    expect(picker.current()).toBeNull();
    const kyoko = voice({ name: "Kyoko" });
    s.set([kyoko]);
    expect(picker.current()).toBe(kyoko);
  });

  it("選んだ後は呼ぶたびに一覧を取り直さない", () => {
    const s = source([voice({ name: "Kyoko" })]);
    const picker = createVoicePicker(s);
    const before = s.calls();
    picker.current();
    picker.current();
    expect(s.calls()).toBe(before);
  });

  it("getVoices・addEventListener が例外を投げても null で続ける", () => {
    const broken: VoiceSource<VoiceLike> = {
      getVoices() {
        throw new Error("x");
      },
      addEventListener() {
        throw new Error("y");
      },
    };
    expect(createVoicePicker(broken).current()).toBeNull();
  });
});
