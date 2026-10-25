// serializePlan・parsePlanText・planFileName（校舎のファイルの書き出し・読み込みと localStorage の保存の形式）と，
// その土台の planToJson・planFromJson のテスト．
// 基準は docs/04_SPEC/SPEC_01 の src/editor/ の行（保存はファイルの書き出し・読み込みと localStorage）・
// SPEC_02「方針」（version を持ち，読めない版は新しい版で開くよう案内する）・「URL と QR への埋め込み」
// （失敗の種類 corrupted / unsupportedVersion / invalidPlan．unsupportedVersion は形の検査より先．展開後 1 MiB 超は corrupted）と
// Issue #134（書き出したファイルを別のブラウザで読み込むと同じ校舎・同じ訓練条件になる．形が読めない・version が新しい時は開かず理由を出す．
// validatePlan の誤りだけなら開く．ファイル名に学校名を使う．拡張子は .json）
import { describe, expect, it } from "vitest";
import type { CellRef, SchoolPlan } from "../core/schoolPlan";
import { encodePlan, planFromJson, planToJson } from "./planCodec";
import {
  MAX_PLAN_TEXT_LENGTH,
  PLAN_FILE_EXTENSION,
  PLAN_FILE_MIME,
  parsePlanText,
  planFileName,
  serializePlan,
} from "./planFile";
import { DEMO_SCHOOL } from "./samples/demoSchool";
import { validatePlan } from "./validatePlan";

const at = (x: number, z: number, floor = 0): CellRef => ({ floor, x, z });

/** デモの校舎に，経路・延焼・モード等を既定と違う値で入れた校舎（一部だけ上書きできる） */
function customPlan(overrides: Partial<SchoolPlan> = {}): SchoolPlan {
  return {
    ...DEMO_SCHOOL,
    name: 'テスト "小学校" 東館\\2F 😀',
    cellSize: 1.25,
    drill: {
      ...DEMO_SCHOOL.drill,
      mode: "test",
      startYaw: Math.PI / 2,
      // 経路は集合場所で終わる必要があるため，デモの経路を集合場所の隣のマスまで伸ばす
      route: [...DEMO_SCHOOL.drill.route, at(9, 10)],
      spread: {
        fireSecondsPerCell: 7.5,
        smokeSecondsPerCell: 1.5,
        extraFires: [{ cell: at(10, 2), atSeconds: 30 }],
      },
      timeLimitSeconds: 222,
    },
    ...overrides,
  };
}

/** 書き出した文字列を JSON として書き換える */
function editJson(plan: SchoolPlan, edit: (json: Record<string, unknown>) => void): string {
  const json = JSON.parse(serializePlan(plan)) as Record<string, unknown>;
  edit(json);
  return JSON.stringify(json);
}

/** 埋め込みデータを仕様の逆の順（base64url → deflate-raw の展開）で JSON の文字列に戻す */
async function inflateEmbedded(text: string): Promise<string> {
  const binary = atob(text.replace(/-/g, "+").replace(/_/g, "/"));
  const bytes = Uint8Array.from(binary, (c) => c.charCodeAt(0));
  const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream("deflate-raw"));
  return new Response(stream).text();
}

const expectFailureKind = (result: ReturnType<typeof parsePlanText>, kind: string): void => {
  expect(result.ok).toBe(false);
  if (result.ok) return;
  expect(result.kind).toBe(kind);
  expect(typeof result.reason).toBe("string");
  expect(result.reason.length).toBeGreaterThan(0);
};

describe("serializePlan / parsePlanText の往復", () => {
  it.each<[string, SchoolPlan]>([
    ["デモの校舎", DEMO_SCHOOL],
    ["経路・延焼・モード・名前を変えた校舎", customPlan()],
    ["経路が空の校舎", customPlan({ drill: { ...customPlan().drill, route: [] } })],
  ])("%s は pretty の有無にかかわらず同じ校舎・同じ訓練条件に戻る", (_label, plan) => {
    for (const pretty of [undefined, false, true]) {
      const result = parsePlanText(serializePlan(plan, { pretty }));
      expect(result).toEqual({ ok: true, plan });
    }
  });

  it("2 回往復しても同じ文字列になる（読み込んだ校舎を書き出しても変わらない）", () => {
    const text = serializePlan(customPlan(), { pretty: true });
    const result = parsePlanText(text);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(serializePlan(result.plan, { pretty: true })).toBe(text);
  });

  it("書き出しは version を持つ（SPEC_02「版を持つ」）", () => {
    const json = JSON.parse(serializePlan(DEMO_SCHOOL)) as { version: unknown };
    expect(json.version).toBe(1);
  });

  it("pretty は字下げ 2 の複数行で末尾に改行が付き，省くと 1 行", () => {
    const pretty = serializePlan(DEMO_SCHOOL, { pretty: true });
    expect(pretty.endsWith("}\n")).toBe(true);
    expect(pretty).toContain('\n  "version": 1');
    const compact = serializePlan(DEMO_SCHOOL);
    expect(compact).not.toContain("\n");
    expect(compact.length).toBeLessThan(pretty.length);
  });

  it("中身を確かめずに書く（誤りのある編集の途中も保存できる）", () => {
    const broken = customPlan({ cellSize: 0 });
    expect(validatePlan(broken).length).toBeGreaterThan(0);
    expect(() => serializePlan(broken)).not.toThrow();
  });

  it("入力の校舎を書き換えない", () => {
    const plan = customPlan();
    const snapshot = JSON.stringify(plan);
    serializePlan(plan, { pretty: true });
    expect(JSON.stringify(plan)).toBe(snapshot);
  });

  it("前後の空白・BOM の無い改行つきの文字列も読める", () => {
    const result = parsePlanText(`\n  ${serializePlan(DEMO_SCHOOL)}  \n`);
    expect(result).toEqual({ ok: true, plan: DEMO_SCHOOL });
  });
});

describe("planToJson", () => {
  it("URL の埋め込みデータを圧縮する前の JSON と同じ形（cells は 1 マス 1 文字，roomOf はランレングス）", async () => {
    const json = planToJson(DEMO_SCHOOL);
    const floor = json.floors[0];
    expect(typeof floor.cells).toBe("string");
    expect(floor.cells).toHaveLength(floor.width * floor.depth);
    // ランレングス: [値, 続く数, …] の続く数の合計がマスの数
    const runs = floor.roomOf;
    expect(runs.length % 2).toBe(0);
    let total = 0;
    for (let i = 1; i < runs.length; i += 2) total += runs[i];
    expect(total).toBe(floor.width * floor.depth);
    // encodePlan の埋め込みデータを base64url → deflate-raw の展開で戻した JSON と同じ（キーの順も同じ）
    expect(await inflateEmbedded(await encodePlan(DEMO_SCHOOL))).toBe(JSON.stringify(json));
    expect(planFromJson(JSON.parse(JSON.stringify(json)))).toEqual({ ok: true, plan: DEMO_SCHOOL });
  });
});

describe("parsePlanText の失敗", () => {
  it.each<[string, string]>([
    ["空文字", ""],
    ["空白だけ", "   "],
    ["JSON でない", "これは校舎ではありません"],
    ["途中で切れた JSON", serializePlan(DEMO_SCHOOL).slice(0, 100)],
    ["null", "null"],
    ["数", "42"],
    ["文字列", '"school"'],
    ["配列", "[]"],
    ["空のオブジェクト", "{}"],
  ])("%s は corrupted", (_label, text) => {
    expectFailureKind(parsePlanText(text), "corrupted");
  });

  it.each<[string, (json: Record<string, unknown>) => void]>([
    ["version が無い", (j) => delete j.version],
    ["version が文字列", (j) => (j.version = "1")],
    ["version が 0（古い・無い版）", (j) => (j.version = 0)],
    ["name が数", (j) => (j.name = 3)],
    ["floors が無い", (j) => delete j.floors],
    ["drill が無い", (j) => delete j.drill],
    ["drill.mode が知らない値", (j) => ((j.drill as Record<string, unknown>).mode = "free")],
    [
      "cells に知らない文字",
      (j) => {
        const floors = j.floors as Record<string, unknown>[];
        floors[0].cells = `X${(floors[0].cells as string).slice(1)}`;
      },
    ],
    [
      "roomOf の続く数の合計が合わない",
      (j) => {
        const floors = j.floors as Record<string, unknown>[];
        floors[0].roomOf = [-1, 1];
      },
    ],
  ])("形が違う（%s）は corrupted", (_label, edit) => {
    expectFailureKind(parsePlanText(editJson(DEMO_SCHOOL, edit)), "corrupted");
  });

  it("version が今より新しいと unsupportedVersion", () => {
    expectFailureKind(
      parsePlanText(editJson(DEMO_SCHOOL, (j) => (j.version = 2))),
      "unsupportedVersion",
    );
  });

  it("version が新しければ，形が読めなくても unsupportedVersion（形の検査より先に判定する）", () => {
    expectFailureKind(parsePlanText(JSON.stringify({ version: 2 })), "unsupportedVersion");
    expectFailureKind(
      parsePlanText(JSON.stringify({ version: 99, floors: "壊れた形", drill: null })),
      "unsupportedVersion",
    );
  });

  it("unsupportedVersion の理由は新しい版のアプリで開くよう案内する", () => {
    const result = parsePlanText(JSON.stringify({ version: 2 }));
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toContain("新しい版");
  });

  it("長さが上限（1 MiB）を超えると corrupted", () => {
    // 上限を超える分を空白で足す（JSON としては正しいが，校舎のファイルとしては大きすぎる）
    const text = serializePlan(DEMO_SCHOOL).padEnd(MAX_PLAN_TEXT_LENGTH + 1, " ");
    expect(text.length).toBe(MAX_PLAN_TEXT_LENGTH + 1);
    expectFailureKind(parsePlanText(text), "corrupted");
  });

  it("長さがちょうど上限なら読む", () => {
    const text = serializePlan(DEMO_SCHOOL).padEnd(MAX_PLAN_TEXT_LENGTH, " ");
    expect(text.length).toBe(MAX_PLAN_TEXT_LENGTH);
    expect(parsePlanText(text)).toEqual({ ok: true, plan: DEMO_SCHOOL });
  });

  it("上限は 1 MiB", () => {
    expect(MAX_PLAN_TEXT_LENGTH).toBe(1024 * 1024);
  });

  it.each<[string, SchoolPlan]>([
    ["マスの大きさが 0", customPlan({ cellSize: 0 })],
    ["開始地点がマス目の外", customPlan({ drill: { ...customPlan().drill, start: at(99, 99) } })],
    ["集合場所が無い", customPlan({ drill: { ...customPlan().drill, assembly: [] } })],
  ])(
    "形は読めて validatePlan に通らない（%s）は invalidPlan で，校舎と誤りの一覧も返す",
    (_label, plan) => {
      const errors = validatePlan(plan);
      expect(errors.length).toBeGreaterThan(0);
      const result = parsePlanText(serializePlan(plan));
      expectFailureKind(result, "invalidPlan");
      if (result.ok || result.kind !== "invalidPlan") return;
      expect(result.plan).toEqual(plan);
      expect(result.errors).toEqual(errors);
      expect(result.reason).toContain(errors[0]);
    },
  );

  it("例外を投げない（どんな文字列でも結果を返す）", () => {
    for (const text of ["", "{", "[1,2", "\u0000", '{"version":1e999}', "😀".repeat(1000)]) {
      expect(() => parsePlanText(text)).not.toThrow();
      expect(parsePlanText(text).ok).toBe(false);
    }
  });
});

describe("planFromJson", () => {
  it("知らない項目は捨てて校舎の項目だけで組み立てる", () => {
    const json = { ...planToJson(DEMO_SCHOOL), extra: "余計な項目" };
    const result = planFromJson(JSON.parse(JSON.stringify(json)));
    expect(result).toEqual({ ok: true, plan: DEMO_SCHOOL });
    if (result.ok) expect("extra" in result.plan).toBe(false);
  });

  it.each<[string, unknown]>([
    ["undefined", undefined],
    ["null", null],
    ["数", 1],
    ["配列", [planToJson(DEMO_SCHOOL)]],
  ])("%s は corrupted", (_label, json) => {
    const result = planFromJson(json);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.kind).toBe("corrupted");
  });
});

describe("planFileName", () => {
  it("学校名に拡張子 .json を付ける", () => {
    expect(planFileName("デモ小学校 北校舎")).toBe("デモ小学校 北校舎.json");
    expect(PLAN_FILE_EXTENSION).toBe(".json");
    expect(PLAN_FILE_MIME).toBe("application/json");
  });

  it.each<[string, string]>([
    ["a\\b", "a_b.json"],
    ["a/b", "a_b.json"],
    ["a:b", "a_b.json"],
    ["a*b", "a_b.json"],
    ["a?b", "a_b.json"],
    ['a"b', "a_b.json"],
    ["a<b>c", "a_b_c.json"],
    ["a|b", "a_b.json"],
    ["a\u0000b", "a_b.json"],
    ["a\u001fb", "a_b.json"],
    ["a\u007fb", "a_b.json"],
  ])("ファイル名に使えない文字は _ にする（%j → %s）", (name, expected) => {
    expect(planFileName(name)).toBe(expected);
  });

  it("続く空白は 1 つにし，前後の空白を除く", () => {
    expect(planFileName("  東  小学校\u3000\u3000北館  ")).toBe("東 小学校 北館.json");
  });

  it("改行・タブ（制御文字）は空白ではなく _ になる", () => {
    expect(planFileName("a\nb")).toBe("a_b.json");
    expect(planFileName("a\tb")).toBe("a_b.json");
  });

  it("末尾の . と空白を除く", () => {
    expect(planFileName("小学校...")).toBe("小学校.json");
    expect(planFileName("小学校. . ")).toBe("小学校.json");
  });

  it.each<[string]>([[""], ["   "], ["..."], [". . ."]])(
    "空になる名前（%j）は 校舎.json",
    (name) => {
      expect(planFileName(name)).toBe("校舎.json");
    },
  );

  it("使えない文字だけの名前は _ が残る（空にはならない）", () => {
    expect(planFileName("///")).toBe("___.json");
  });

  it.each<[string, string]>([
    ["CON", "CON_.json"],
    ["con", "con_.json"],
    ["PRN", "PRN_.json"],
    ["AUX", "AUX_.json"],
    ["NUL", "NUL_.json"],
    ["COM1", "COM1_.json"],
    ["LPT9", "LPT9_.json"],
    ["CON.", "CON_.json"],
  ])("Windows の予約名（%s）は _ を付ける", (name, expected) => {
    expect(planFileName(name)).toBe(expected);
  });

  it.each<[string]>([["CONSOLE"], ["COM"], ["小CON"]])(
    "予約名を含むだけの名前（%s）はそのまま",
    (name) => {
      expect(planFileName(name)).toBe(`${name}.json`);
    },
  );

  it("長い名前は 60 文字（コードポイント）で切る", () => {
    expect(planFileName("あ".repeat(100))).toBe(`${"あ".repeat(60)}.json`);
    expect(planFileName("a".repeat(60))).toBe(`${"a".repeat(60)}.json`);
  });

  it("60 文字目がサロゲートペア（絵文字）でも途中で切らない", () => {
    const base = planFileName(`${"a".repeat(59)}😀😀`).slice(0, -PLAN_FILE_EXTENSION.length);
    expect(base).toBe(`${"a".repeat(59)}😀`);
  });

  it("サロゲートペア（絵文字）の途中で切らない", () => {
    const name = planFileName("😀".repeat(70));
    const base = name.slice(0, -PLAN_FILE_EXTENSION.length);
    expect(Array.from(base)).toHaveLength(60);
    expect(base).toBe("😀".repeat(60));
  });

  it("切った後に末尾が空白になれば除く", () => {
    expect(planFileName(`${"a".repeat(59)} b`)).toBe(`${"a".repeat(59)}.json`);
  });
});
