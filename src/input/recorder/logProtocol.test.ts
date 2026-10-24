import { describe, expect, it } from "vitest";
import {
  classifySendStatus,
  createSessionId,
  INPUT_LOG_ENDPOINT,
  INPUT_LOG_ROUTES,
  isValidSessionId,
  MARK_KIND_PATTERN,
  MAX_MARK_NOTE_LENGTH,
  MAX_REQUEST_BYTES,
} from "./logProtocol";

describe("約束事の定数", () => {
  it("受け取る口は /__input-log，本文の上限は 1 MB", () => {
    expect(INPUT_LOG_ENDPOINT).toBe("/__input-log");
    expect(MAX_REQUEST_BYTES).toBe(1024 * 1024);
  });

  it("記録の口の下に time・sessions・mark・list・file の口を置く", () => {
    expect(INPUT_LOG_ROUTES).toEqual({
      time: "/time",
      sessions: "/sessions",
      mark: "/mark",
      list: "/list",
      file: "/file",
    });
  });

  it("印の説明は 200 文字まで", () => {
    expect(MAX_MARK_NOTE_LENGTH).toBe(200);
  });
});

describe("MARK_KIND_PATTERN", () => {
  it.each(["false-walk", "other", "a", "0", "a".repeat(32)])("%s は印の種類として使える", (k) => {
    expect(MARK_KIND_PATTERN.test(k)).toBe(true);
  });

  it.each(["", "A", "a_b", "a b", "a/b", "../x", "a\nb", "あ", "a".repeat(33)])(
    "%j は使えない",
    (k) => {
      expect(MARK_KIND_PATTERN.test(k)).toBe(false);
    },
  );
});

describe("isValidSessionId", () => {
  it.each(["a", "abc123", "A-b-C", "0".repeat(64)])("%s は正しい", (id) => {
    expect(isValidSessionId(id)).toBe(true);
  });

  it.each([
    "",
    "0".repeat(65),
    "../x",
    "a/b",
    "a\\b",
    "a.b",
    "a_b",
    "a b",
    "abc\n",
    "あ",
    "%2e%2e",
  ])("%s は不正", (id) => {
    expect(isValidSessionId(id)).toBe(false);
  });

  it.each([null, undefined, 123, {}, ["abc"]])("文字列でない値（%s）は不正", (id) => {
    expect(isValidSessionId(id)).toBe(false);
  });
});

describe("createSessionId", () => {
  it("既定は 8 文字で，書式を満たす", () => {
    const id = createSessionId();
    expect(id).toHaveLength(8);
    expect(isValidSessionId(id)).toBe(true);
  });

  it("random を差し替えると決まった ID になる", () => {
    expect(createSessionId(() => 0)).toBe("00000000");
    expect(createSessionId(() => 0.999999)).toBe("zzzzzzzz");
  });

  it.each([
    ["1", () => 1],
    ["負", () => -0.5],
    ["NaN", () => NaN],
    ["Infinity", () => Infinity],
    ["大きい値", () => 1e9],
  ])("random が範囲外（%s）でも書式を満たす", (_name, random) => {
    const id = createSessionId(random);
    expect(isValidSessionId(id)).toBe(true);
    expect(id).toHaveLength(8);
  });

  it("長さを指定できる", () => {
    expect(createSessionId(Math.random, 16)).toHaveLength(16);
    expect(isValidSessionId(createSessionId(Math.random, 64))).toBe(true);
  });

  it.each([0, -1, 65, 100, NaN])(
    "長さが書式の範囲外（%s）でも，常に isValidSessionId を満たす",
    (length) => {
      expect(isValidSessionId(createSessionId(Math.random, length))).toBe(true);
    },
  );
});

describe("classifySendStatus", () => {
  it.each([200, 201, 204, 299])("%s は送信済み", (status) => {
    expect(classifySendStatus(status)).toBe("ok");
  });

  it("通信そのものの失敗（null）は再送", () => {
    expect(classifySendStatus(null)).toBe("retry");
  });

  it.each([404, 408, 429, 500, 502, 503, 599])("%s は再送", (status) => {
    expect(classifySendStatus(status)).toBe("retry");
  });

  it.each([400, 401, 403, 413, 415, 499])("%s は拒否（送信済み扱い）", (status) => {
    expect(classifySendStatus(status)).toBe("reject");
  });
});
