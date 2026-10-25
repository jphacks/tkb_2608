// 道具箱の項目の開け閉めの状態（閉じた項目の見出しの並び）を localStorage に覚える仕組みのテスト．
// 基準は実装の依頼の要件（キーは `tkb2608.editor.sections`．閉じた項目の見出しを JSON の配列で置く．
// 既定はすべて開く．壊れた中身・Storage が使えない時も例外で止めない）と，SPEC_02「ファイルと localStorage への保存」
// のキーの付け方（`tkb2608.editor.*`）．Storage はフェイク（Map で持つ・例外を投げる）を渡す（planStorage.test.ts と同じ）
import { describe, expect, it } from "vitest";
import { PLAN_STORAGE_KEY, type PlanStorageLike } from "./planStorage";
import {
  isSectionOpen,
  loadClosedSections,
  parseClosedSections,
  SECTION_FOLD_STORAGE_KEY,
  saveClosedSections,
  serializeClosedSections,
  setSectionOpen,
} from "./sectionFold";

/** Map で持つ Storage の代わり．getItem・setItem を例外にできる */
function fakeStorage(
  options: {
    readonly initial?: Readonly<Record<string, string>>;
    readonly getThrows?: boolean;
    readonly setThrows?: boolean;
  } = {},
): PlanStorageLike & { readonly items: Map<string, string> } {
  const items = new Map(Object.entries(options.initial ?? {}));
  return {
    items,
    getItem(key) {
      if (options.getThrows) throw new DOMException("denied", "SecurityError");
      return items.get(key) ?? null;
    },
    setItem(key, value) {
      if (options.setThrows) throw new DOMException("full", "QuotaExceededError");
      items.set(key, value);
    },
  };
}

/** 集合として比べるため並べ替える */
function sorted(list: readonly string[]): string[] {
  return [...list].sort();
}

describe("SECTION_FOLD_STORAGE_KEY", () => {
  it("キーは tkb2608.editor.sections で，校舎の保存のキーとぶつからない", () => {
    expect(SECTION_FOLD_STORAGE_KEY).toBe("tkb2608.editor.sections");
    expect(SECTION_FOLD_STORAGE_KEY).not.toBe(PLAN_STORAGE_KEY);
  });
});

describe("parseClosedSections", () => {
  it.each<[string, string | null]>([
    ["null（保存が無い）", null],
    ["空文字", ""],
    ["JSON でない文字", "パーツ,教室"],
    ["途中で切れた JSON", '["パーツ"'],
    ["オブジェクト", '{"パーツ":true}'],
    ["文字列", '"パーツ"'],
    ["数", "3"],
    ["true", "true"],
    ["null の JSON", "null"],
    ["空の配列", "[]"],
  ])("%s は例外を出さず空（すべて開く）になる", (_label, text) => {
    expect(() => parseClosedSections(text)).not.toThrow();
    expect(parseClosedSections(text)).toEqual([]);
  });

  it("閉じた項目の見出しの配列はその並びになる", () => {
    expect(parseClosedSections('["パーツ","延焼のプレビュー"]')).toEqual([
      "パーツ",
      "延焼のプレビュー",
    ]);
  });

  it.each<[string, string, readonly string[]]>([
    [
      "数・null・真偽値・オブジェクト・配列の要素",
      '["パーツ",1,null,true,{},["教室"],"保存"]',
      ["パーツ", "保存"],
    ],
    ["空文字の要素", '["","教室",""]', ["教室"]],
    ["同じ見出しの重複", '["教室","教室","パーツ","教室"]', ["教室", "パーツ"]],
    ["文字でない要素だけ", "[1,2,null]", []],
  ])("%s は捨て，閉じた項目の正しい集合になる", (_label, text, expected) => {
    expect(() => parseClosedSections(text)).not.toThrow();
    const result = parseClosedSections(text);
    expect(sorted(result)).toEqual(sorted(expected));
    expect(new Set(result).size).toBe(result.length);
  });
});

describe("serializeClosedSections / parseClosedSections の往復", () => {
  it.each<[string, readonly string[]]>([
    ["空（すべて開く）", []],
    ["1 つ", ["パーツ"]],
    ["いくつか", ["パーツ", "教室", "生徒用の QR コード", "マス目の大きさ"]],
    ["記号・引用符・改行を含む見出し", ['図面の"写真"', "元に\\戻す", "改\n行", "← トップへ"]],
  ])("%s は書いて読み直すと元に戻る", (_label, closed) => {
    expect(parseClosedSections(serializeClosedSections(closed))).toEqual(closed);
  });

  it("書いた文字は JSON の配列である", () => {
    const text = serializeClosedSections(["パーツ", "教室"]);
    expect(JSON.parse(text)).toEqual(["パーツ", "教室"]);
  });
});

describe("isSectionOpen", () => {
  it("何も閉じていない時（既定）はどの項目も開いている", () => {
    for (const id of ["パーツ", "教室", "訓練条件", "正解経路", "保存"]) {
      expect(isSectionOpen([], id)).toBe(true);
    }
  });

  it.each<[string, readonly string[], string, boolean]>([
    ["閉じた並びにある項目", ["パーツ", "教室"], "教室", false],
    ["閉じた並びに無い項目", ["パーツ", "教室"], "保存", true],
    ["見出しの一部だけ一致する項目", ["延焼のプレビュー"], "延焼", true],
  ])("%s の開閉を返す", (_label, closed, id, open) => {
    expect(isSectionOpen(closed, id)).toBe(open);
  });
});

describe("setSectionOpen", () => {
  it("開いた項目を閉じると閉じた並びに入る", () => {
    const next = setSectionOpen([], "パーツ", false);
    expect(next).toEqual(["パーツ"]);
    expect(isSectionOpen(next, "パーツ")).toBe(false);
  });

  it("閉じた項目を開くと閉じた並びから消え，他の閉じた項目は残る", () => {
    const next = setSectionOpen(["パーツ", "教室"], "パーツ", true);
    expect(next).toEqual(["教室"]);
    expect(isSectionOpen(next, "パーツ")).toBe(true);
    expect(isSectionOpen(next, "教室")).toBe(false);
  });

  it.each<[string, readonly string[], string, boolean]>([
    ["閉じた項目をもう一度閉じる", ["パーツ"], "パーツ", false],
    ["開いた項目をもう一度開く", ["パーツ"], "教室", true],
    ["何も閉じていない時に開く", [], "パーツ", true],
  ])("%s時は状態が変わらず同じ参照を返す", (_label, closed, id, open) => {
    expect(setSectionOpen(closed, id, open)).toBe(closed);
  });

  it("元の並びを書き換えない", () => {
    const closed = Object.freeze(["パーツ"]) as readonly string[];
    expect(() => setSectionOpen(closed, "教室", false)).not.toThrow();
    expect(() => setSectionOpen(closed, "パーツ", true)).not.toThrow();
    expect(closed).toEqual(["パーツ"]);
  });

  it("開け閉めを繰り返しても重複が増えない", () => {
    let closed: readonly string[] = [];
    for (let i = 0; i < 5; i++) {
      closed = setSectionOpen(closed, "パーツ", false);
      closed = setSectionOpen(closed, "パーツ", false);
      closed = setSectionOpen(closed, "教室", false);
      closed = setSectionOpen(closed, "教室", true);
      closed = setSectionOpen(closed, "教室", false);
    }
    expect(sorted(closed)).toEqual(["パーツ", "教室"].sort());
    expect(new Set(closed).size).toBe(closed.length);

    closed = setSectionOpen(closed, "パーツ", true);
    closed = setSectionOpen(closed, "教室", true);
    expect(closed).toEqual([]);
  });
});

describe("saveClosedSections / loadClosedSections", () => {
  it("何も保存されていない時（既定）は空（すべて開く）を読む", () => {
    const loaded = loadClosedSections(fakeStorage());
    expect(loaded).toEqual([]);
    expect(isSectionOpen(loaded, "パーツ")).toBe(true);
  });

  it("保存した閉じた項目を次に開くと同じ集合で読める", () => {
    const storage = fakeStorage();
    const closed = ["パーツ", "延焼の速さ", "図面の写真"];
    expect(saveClosedSections(storage, closed)).toBe(true);
    expect(loadClosedSections(storage)).toEqual(closed);
  });

  it("保存はキー tkb2608.editor.sections に JSON の配列で置き，他のキーは触らない", () => {
    const storage = fakeStorage({ initial: { [PLAN_STORAGE_KEY]: "校舎" } });
    saveClosedSections(storage, ["保存", "元に戻す"]);
    expect(JSON.parse(storage.items.get("tkb2608.editor.sections") ?? "null")).toEqual([
      "保存",
      "元に戻す",
    ]);
    expect(storage.items.get(PLAN_STORAGE_KEY)).toBe("校舎");
  });

  it("すべて開いた状態を保存すると次はすべて開く", () => {
    const storage = fakeStorage({ initial: { [SECTION_FOLD_STORAGE_KEY]: '["パーツ"]' } });
    expect(saveClosedSections(storage, [])).toBe(true);
    expect(loadClosedSections(storage)).toEqual([]);
  });

  it.each<[string, string]>([
    ["JSON でない", "{壊れた"],
    ["配列でない", '{"closed":["パーツ"]}'],
  ])("保存の中身が %s 時は例外を出さず空（すべて開く）を読む", (_label, text) => {
    const storage = fakeStorage({ initial: { [SECTION_FOLD_STORAGE_KEY]: text } });
    expect(() => loadClosedSections(storage)).not.toThrow();
    expect(loadClosedSections(storage)).toEqual([]);
  });

  it("保存の中身に重複・文字でない要素があっても正しい集合を読む", () => {
    const storage = fakeStorage({
      initial: { [SECTION_FOLD_STORAGE_KEY]: '["教室",5,"","教室","保存"]' },
    });
    expect(sorted(loadClosedSections(storage))).toEqual(["保存", "教室"].sort());
  });

  it.each<[string, PlanStorageLike | null]>([
    ["Storage が使えない（null）", null],
    ["getItem が例外を投げる", fakeStorage({ getThrows: true })],
  ])("%s 時の読み込みは例外を出さず空（すべて開く）になる", (_label, storage) => {
    expect(() => loadClosedSections(storage)).not.toThrow();
    expect(loadClosedSections(storage)).toEqual([]);
  });

  it.each<[string, PlanStorageLike | null]>([
    ["Storage が使えない（null）", null],
    ["setItem が例外を投げる（容量超過・プライベートモード）", fakeStorage({ setThrows: true })],
  ])("%s 時の保存は例外を出さず false を返す", (_label, storage) => {
    expect(() => saveClosedSections(storage, ["パーツ"])).not.toThrow();
    expect(saveClosedSections(storage, ["パーツ"])).toBe(false);
  });

  it("開け閉めのたびに保存して読み直しても重複が増えない", () => {
    const storage = fakeStorage();
    for (let i = 0; i < 3; i++) {
      const closed = setSectionOpen(loadClosedSections(storage), "モード", false);
      saveClosedSections(storage, closed);
    }
    expect(loadClosedSections(storage)).toEqual(["モード"]);
    saveClosedSections(storage, setSectionOpen(loadClosedSections(storage), "モード", true));
    expect(loadClosedSections(storage)).toEqual([]);
  });
});
