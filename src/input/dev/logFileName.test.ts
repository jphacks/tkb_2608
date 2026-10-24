import { describe, expect, it } from "vitest";
import {
  buildLogFileName,
  checkJsonlBody,
  findLogFileForSession,
  formatLogTimestamp,
  isLogFileName,
  sortLogFileNames,
} from "./logFileName";

// ローカル時刻で作る（formatLogTimestamp はその環境のローカル時刻で書く）
const DATE = new Date(2026, 9, 24, 13, 4, 5);

describe("formatLogTimestamp", () => {
  it("YYYYMMDD-HHMMSS（ゼロ埋め）", () => {
    expect(formatLogTimestamp(DATE)).toBe("20261024-130405");
    expect(formatLogTimestamp(new Date(2026, 0, 2, 3, 4, 5))).toBe("20260102-030405");
    expect(formatLogTimestamp(new Date(2026, 11, 31, 23, 59, 59))).toBe("20261231-235959");
  });

  it("不正な日時なら null", () => {
    expect(formatLogTimestamp(new Date(NaN))).toBeNull();
  });
});

describe("buildLogFileName", () => {
  it("<YYYYMMDD-HHMMSS>_<セッション ID>.jsonl", () => {
    expect(buildLogFileName(DATE, "abc123")).toBe("20261024-130405_abc123.jsonl");
    expect(buildLogFileName(DATE, "a".repeat(64))).toBe(`20261024-130405_${"a".repeat(64)}.jsonl`);
  });

  it.each(["../x", "..", "a/b", "/", "", "a".repeat(65), "a.b", "a\\b"])(
    "セッション ID が不正（%s）なら null（変換しない）",
    (id) => {
      expect(buildLogFileName(DATE, id)).toBeNull();
    },
  );

  it("日時が不正なら null", () => {
    expect(buildLogFileName(new Date(NaN), "abc")).toBeNull();
  });
});

describe("findLogFileForSession", () => {
  it("同じセッションのファイルを見つける", () => {
    expect(
      findLogFileForSession(
        ["20261024-130405_other.jsonl", "20261024-130405_abc.jsonl", "README.md"],
        "abc",
      ),
    ).toBe("20261024-130405_abc.jsonl");
  });

  it("複数あれば最新（名前の日時が最も新しいもの）", () => {
    expect(
      findLogFileForSession(
        [
          "20261024-130405_abc.jsonl",
          "20261025-090000_abc.jsonl",
          "20261024-235959_abc.jsonl",
          "20261026-000000_other.jsonl",
        ],
        "abc",
      ),
    ).toBe("20261025-090000_abc.jsonl");
  });

  it("別のセッション・書式違いは無視する", () => {
    expect(
      findLogFileForSession(
        [
          "20261024-130405_abcd.jsonl",
          "20261024-130405_xabc.jsonl",
          "20261024-130405_abc.json",
          "20261024-130405_abc.jsonl.bak",
          "2026-10-24_abc.jsonl",
          "abc.jsonl",
          "20261024-130405_abc",
        ],
        "abc",
      ),
    ).toBeNull();
  });

  it("無ければ null．セッション ID が不正でも null", () => {
    expect(findLogFileForSession([], "abc")).toBeNull();
    expect(findLogFileForSession(["20261024-130405_..jsonl"], "..")).toBeNull();
  });
});

describe("checkJsonlBody", () => {
  it("各行が JSON のオブジェクトなら，各行の末尾に改行を付けて返す", () => {
    expect(checkJsonlBody('{"a":1}\n{"b":2}')).toEqual({
      ok: true,
      text: '{"a":1}\n{"b":2}\n',
      lineCount: 2,
    });
  });

  it("空行は飛ばす", () => {
    expect(checkJsonlBody('\n{"a":1}\n\n   \n{"b":2}\n\n')).toEqual({
      ok: true,
      text: '{"a":1}\n{"b":2}\n',
      lineCount: 2,
    });
  });

  it("CRLF の行末も受け付け，LF にそろえる", () => {
    expect(checkJsonlBody('{"a":1}\r\n{"b":2}\r\n')).toEqual({
      ok: true,
      text: '{"a":1}\n{"b":2}\n',
      lineCount: 2,
    });
  });

  it("空の本文は 0 行で空文字列", () => {
    expect(checkJsonlBody("")).toEqual({ ok: true, text: "", lineCount: 0 });
    expect(checkJsonlBody("\n\n")).toEqual({ ok: true, text: "", lineCount: 0 });
  });

  it.each([
    ["JSON でない行", '{"a":1}\nnot json'],
    ["配列の行", '{"a":1}\n[1,2]'],
    ["null の行", "null"],
    ["数の行", "123"],
    ["文字列の行", '"abc"'],
    ["真偽値の行", "true"],
    ["途中で切れた行", '{"a":'],
  ])("%s があれば全体を拒否する", (_name, body) => {
    const r = checkJsonlBody(body);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toEqual(expect.any(String));
  });
});

describe("isLogFileName", () => {
  it.each([
    "20261024-143537_o0qich1i.jsonl",
    "20261024-143537_a.jsonl",
    `20261024-143537_${"a".repeat(64)}.jsonl`,
    "20261024-143537_A-b-9.jsonl",
  ])("%s は記録のファイル名", (name) => {
    expect(isLogFileName(name)).toBe(true);
  });

  it.each([
    "",
    "../20261024-143537_abc.jsonl",
    "./20261024-143537_abc.jsonl",
    "logs/input/20261024-143537_abc.jsonl",
    "/20261024-143537_abc.jsonl",
    "20261024-143537_abc.jsonl/../../package.json",
    "20261024-143537_../x.jsonl",
    "20261024-143537_a.b.jsonl",
    "20261024-143537_a\\b.jsonl",
    "20261024-143537_.jsonl",
    `20261024-143537_${"a".repeat(65)}.jsonl`,
    "20261024-143537_abc.json",
    "20261024-143537_abc.jsonl\n",
    "20261024-143537_abc.jsonl\u0000",
    "2026102-143537_abc.jsonl",
    "20261024_143537_abc.jsonl",
    "package.json",
    "..",
  ])("%j は記録のファイル名でない（ほかのファイルを読ませない）", (name) => {
    expect(isLogFileName(name)).toBe(false);
  });

  it.each([null, undefined, 123, {}, ["20261024-143537_abc.jsonl"]])(
    "文字列でない（%j）なら false",
    (v) => {
      expect(isLogFileName(v)).toBe(false);
    },
  );
});

describe("sortLogFileNames", () => {
  it("記録のファイル名だけを残し，新しい順に並べる", () => {
    expect(
      sortLogFileNames([
        "20261024-100000_b.jsonl",
        "notes.txt",
        "20261025-090000_a.jsonl",
        ".gitkeep",
        "20261024-100000_a.jsonl",
        "20261023-235959_z.jsonl",
      ]),
    ).toEqual([
      "20261025-090000_a.jsonl",
      "20261024-100000_b.jsonl",
      "20261024-100000_a.jsonl",
      "20261023-235959_z.jsonl",
    ]);
  });

  it("元の配列は変えず，空なら空", () => {
    const names = ["20261023-000000_a.jsonl", "20261024-000000_a.jsonl"];
    sortLogFileNames(names);
    expect(names).toEqual(["20261023-000000_a.jsonl", "20261024-000000_a.jsonl"]);
    expect(sortLogFileNames([])).toEqual([]);
  });
});
