// 再生と調整のページで決めたしきい値の書き出し（params の JSON・URL パラメータ）と切り出しのファイル名
// （experiment_山﨑/10「再生と調整のページ」・ENV_04「担当D の dev ページ」）
import { describe, expect, it } from "vitest";
import { isLogFileName } from "../dev/logFileName";
import { INPUT_PARAM_KEYS, paramsFromSearch } from "../params";
import { testParams } from "../testFixtures";
import { clipFileName, paramsDiff, paramsExportJson, paramsSearchOf } from "./tuning";

const BASE = testParams();

describe("paramsDiff", () => {
  it("同じなら空", () => {
    expect(paramsDiff(BASE, testParams())).toEqual({});
  });

  it("変えた項目だけを返す", () => {
    expect(paramsDiff(BASE, testParams({ stepHighStanding: 1.3, headPredictionMs: 20 }))).toEqual({
      stepHighStanding: 1.3,
      headPredictionMs: 20,
    });
  });

  it("0 に変えた項目も返す", () => {
    expect(paramsDiff(BASE, testParams({ headPredictionMs: 0 }))).toEqual({
      headPredictionMs: 0,
    });
  });

  it.each([Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY])(
    "有限でない値（%s）は書き出さない",
    (v) => {
      expect(paramsDiff(BASE, testParams({ stepHighStanding: v }))).toEqual({});
    },
  );

  it("基準が有限でなく今の値が有限なら返す", () => {
    expect(
      paramsDiff(testParams({ stepHighStanding: Number.NaN }), testParams({ stepHighStanding: 1 })),
    ).toEqual({ stepHighStanding: 1 });
  });
});

describe("paramsExportJson", () => {
  it("変えた項目（changed）と全体（params）を JSON にする", () => {
    const current = testParams({ stepHighStanding: 1.3 });
    const parsed = JSON.parse(paramsExportJson(BASE, current));
    expect(parsed.changed).toEqual({ stepHighStanding: 1.3 });
    expect(Object.keys(parsed.params).sort()).toEqual([...INPUT_PARAM_KEYS].sort());
    expect(parsed.params.stepHighStanding).toBe(1.3);
    expect(parsed.params.strideM).toBe(BASE.strideM);
  });

  it("変えていなければ changed は空", () => {
    expect(JSON.parse(paramsExportJson(BASE, BASE)).changed).toEqual({});
  });
});

describe("paramsSearchOf", () => {
  it("変えた項目が無ければ空文字列", () => {
    expect(paramsSearchOf({})).toBe("");
  });

  it("?項目名=値 にする（ENV_04 の例）", () => {
    expect(paramsSearchOf({ stepHighStanding: 1.3 })).toBe("?stepHighStanding=1.3");
  });

  it("有限でない値は飛ばす", () => {
    expect(paramsSearchOf({ stepHighStanding: Number.NaN, strideM: 0.6 })).toBe("?strideM=0.6");
    expect(paramsSearchOf({ stepHighStanding: Number.POSITIVE_INFINITY })).toBe("");
  });

  it("dev ページの URL パラメータの読み込み（paramsFromSearch）で同じ値に戻る", () => {
    const diff = paramsDiff(
      BASE,
      testParams({ stepHighStanding: 1.25, headPredictionMs: 0, stepRefractoryMs: 300 }),
    );
    expect(paramsFromSearch(paramsSearchOf(diff))).toEqual(diff);
  });
});

describe("clipFileName", () => {
  it("<元の名前>_<始まり>-<終わり>ms.jsonl（時刻は整数の ms に丸める）", () => {
    expect(clipFileName("20261024-143537_o0qich1i.jsonl", 1000.4, 2000.6)).toBe(
      "20261024-143537_o0qich1i_1000-2001ms.jsonl",
    );
  });

  it("拡張子は大文字でも外す", () => {
    expect(clipFileName("rec.JSONL", 0, 1)).toBe("rec_0-1ms.jsonl");
  });

  it.each(["../../etc/passwd", "..\\x.jsonl", "a b/c.jsonl", "日本語.jsonl", "/abs/path.jsonl"])(
    "英数字・ハイフン・アンダースコア以外は - にし，フォルダの外を指さない（%s）",
    (name) => {
      const out = clipFileName(name, 0, 1);
      expect(out).toMatch(/^[A-Za-z0-9_-]+_0-1ms\.jsonl$/);
      expect(out).not.toContain("..");
      expect(out).not.toContain("/");
    },
  );

  it.each(["", ".jsonl"])("名前が空（%j）なら record", (name) => {
    expect(clipFileName(name, 0, 1)).toBe("record_0-1ms.jsonl");
  });

  it.each([
    [Number.NaN, 5, "rec_0-5ms.jsonl"],
    [5, Number.POSITIVE_INFINITY, "rec_5-0ms.jsonl"],
  ])("時刻が数でない（%s〜%s）なら 0", (a, b, expected) => {
    expect(clipFileName("rec.jsonl", a, b)).toBe(expected);
  });

  it("切り出しの名前は記録の名前（logs/input/ の書式）とは見分けられる", () => {
    expect(isLogFileName(clipFileName("20261024-143537_abc.jsonl", 0, 1))).toBe(false);
  });
});
