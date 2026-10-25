// 部屋の ID・生徒の ID・校舎の指紋の最小限のテスト．
// 基準は docs/04_SPEC/SPEC_01「見守り」の段階 1「部屋の ID と URL」
import { createHash } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  createPlanFingerprint,
  createPlanFingerprintFromHash,
  createRoomId,
  createStudentId,
  getRoomIdFromHash,
  isRoomId,
  isStudentId,
  parseStudentId,
  ROOM_HASH_KEY,
} from "./monitorIds";

describe("createRoomId・isRoomId", () => {
  it("作った ID は 16 文字で形に合う", () => {
    const id = createRoomId();
    expect(id).toHaveLength(16);
    expect(isRoomId(id)).toBe(true);
  });

  it.each<[string, boolean]>([
    ["abcdefgh", true],
    ["abcdefg", false],
    ["a".repeat(64), true],
    ["a".repeat(65), false],
    ["abcd+efgh", false],
  ])("%s は %s", (id, expected) => {
    expect(isRoomId(id)).toBe(expected);
  });

  it("フラグメントから形に合う room= だけを取る", () => {
    expect(getRoomIdFromHash("#p=abc&room=Ab_-1234")).toBe("Ab_-1234");
    expect(getRoomIdFromHash("#room=short")).toBeNull();
    expect(getRoomIdFromHash("#p=abc")).toBeNull();
  });
});

describe("createStudentId・parseStudentId", () => {
  it("作った ID は 1〜4294967295", () => {
    const id = createStudentId();
    expect(Number.isInteger(id) && id >= 1 && id <= 4294967295).toBe(true);
  });

  it.each<[string | null, number | null]>([
    ["3141592653", 3141592653],
    ["0", null],
    ["4294967296", null],
    ["1.5", null],
    [null, null],
  ])("%s は %s", (text, expected) => {
    expect(parseStudentId(text)).toBe(expected);
  });
});

describe("createPlanFingerprint", () => {
  it("p の値の SHA-256 の先頭 8 バイトを base64url にした 11 文字", async () => {
    const expected = createHash("sha256")
      .update("abc-_")
      .digest()
      .subarray(0, 8)
      .toString("base64url");
    expect(await createPlanFingerprint("abc-_")).toBe(expected);
    expect(await createPlanFingerprintFromHash("#p=abc-_&room=abcdefgh")).toBe(expected);
    expect(expected).toHaveLength(11);
  });

  it("p= が無い時は demo", async () => {
    expect(await createPlanFingerprint(null)).toBe("demo");
    expect(await createPlanFingerprintFromHash("#room=abcdefgh")).toBe("demo");
  });
});

// ---- 以下は tester が足した境界値・エラーパス（仕様: SPEC_01「見守り」段階 1「部屋の ID と URL」，SPEC_02 の room=） ----

afterEach(() => {
  vi.restoreAllMocks();
});

const sha256Prefix = (text: string): string =>
  createHash("sha256").update(text).digest().subarray(0, 8).toString("base64url");

describe("createRoomId（仕様: crypto.getRandomValues の 12 バイトを base64url にした 16 文字）", () => {
  it("crypto.getRandomValues で埋めた 12 バイトをそのまま base64url にする", () => {
    const bytes = Uint8Array.from({ length: 12 }, (_, i) => (i * 37 + 251) & 0xff);
    const spy = vi.spyOn(crypto, "getRandomValues").mockImplementation((array) => {
      const target = array as Uint8Array;
      expect(target.byteLength).toBe(12);
      target.set(bytes);
      return array;
    });
    expect(createRoomId()).toBe(Buffer.from(bytes).toString("base64url"));
    expect(spy).toHaveBeenCalled();
  });

  it("全バイトが 0xff・0x00 でも 16 文字の base64url の文字だけになる（= を含まない）", () => {
    for (const fill of [0x00, 0xff, 0xfb]) {
      vi.spyOn(crypto, "getRandomValues").mockImplementation((array) => {
        (array as Uint8Array).fill(fill);
        return array;
      });
      const id = createRoomId();
      expect(id).toMatch(/^[A-Za-z0-9_-]{16}$/);
      vi.restoreAllMocks();
    }
  });

  it("作るたびに違う ID になり，どれも isRoomId に通る", () => {
    const ids = Array.from({ length: 200 }, () => createRoomId());
    expect(new Set(ids).size).toBe(ids.length);
    for (const id of ids) {
      expect(id).toMatch(/^[A-Za-z0-9_-]{16}$/);
      expect(isRoomId(id)).toBe(true);
    }
  });

  it("仕様の手で作る方法（Node の randomBytes(12).toString('base64url')）と同じ形", () => {
    const manual = Buffer.from(Uint8Array.from({ length: 12 }, (_, i) => i * 21)).toString(
      "base64url",
    );
    expect(manual).toHaveLength(16);
    expect(isRoomId(manual)).toBe(true);
  });
});

describe("isRoomId（仕様: base64url の文字 [A-Za-z0-9_-] で 8〜64 文字）", () => {
  it.each<[string, boolean]>([
    ["", false],
    ["-_-_-_-_", true],
    ["AZaz09-_", true],
    ["a".repeat(63), true],
    ["abcdefg=", false],
    ["abcd/efg", false],
    ["abcd.efg", false],
    ["abcd efg", false],
    ["abcd%2Defg", false],
    ["あいうえおかきく", false],
    ["abcdefgh\n", false],
  ])("%j は %s", (id, expected) => {
    expect(isRoomId(id)).toBe(expected);
  });

  it("改行を前後に付けたものは受け付けない（^$ が行ごとに効かない）", () => {
    expect(isRoomId("abcdefgh\n")).toBe(false);
    expect(isRoomId("\nabcdefgh")).toBe(false);
    expect(isRoomId("abcdefgh\nabcdefgh")).toBe(false);
  });
});

describe("getRoomIdFromHash（仕様: room= が無い・形に合わない時は null．p= の後ろに & でつなぐ）", () => {
  it("フラグメントの名前は room", () => {
    expect(ROOM_HASH_KEY).toBe("room");
  });

  it.each<[string, string | null]>([
    ["#p=abc&room=Ab_-1234abcdEFGH", "Ab_-1234abcdEFGH"],
    ["p=abc&room=Ab_-1234abcdEFGH", "Ab_-1234abcdEFGH"],
    ["#room=Ab_-1234abcdEFGH&p=abc", "Ab_-1234abcdEFGH"],
    ["#room=Ab_-1234abcdEFGH", "Ab_-1234abcdEFGH"],
    ["room=Ab_-1234abcdEFGH", "Ab_-1234abcdEFGH"],
    ["#x=1&room=abcdefgh&y=2", "abcdefgh"],
    [`#room=${"a".repeat(64)}`, "a".repeat(64)],
    [`#room=${"a".repeat(65)}`, null],
    ["", null],
    ["#", null],
    ["#room=", null],
    ["#room", null],
    ["#p=abc&room=abcd+efgh", null],
    ["#p=abc&room=abcd%2Fefgh", null],
    ["#p=abc&room=abc=defgh", null],
    ["#ROOM=abcdefgh", null],
    ["#rooms=abcdefgh", null],
  ])("%j は %j", (hash, expected) => {
    expect(getRoomIdFromHash(hash)).toBe(expected);
  });

  it("?app と ?monitor で同じフラグメントなら同じ部屋の ID になる", () => {
    const id = createRoomId();
    const fragment = `#p=AAAA-_bb&room=${id}`;
    expect(getRoomIdFromHash(fragment)).toBe(id);
    expect(getRoomIdFromHash(new URL(`https://example.com/?monitor${fragment}`).hash)).toBe(id);
    expect(getRoomIdFromHash(new URL(`https://example.com/?app${fragment}`).hash)).toBe(id);
  });

  it("例外を投げない", () => {
    for (const hash of ["#%", "#room=%E0%A4%A", "#&&&", "#=", "#room=%00%00%00%00%00%00%00%00"]) {
      expect(() => getRoomIdFromHash(hash)).not.toThrow();
      expect(getRoomIdFromHash(hash)).toBeNull();
    }
  });
});

describe("createStudentId（仕様: crypto.getRandomValues の 32 ビットの符号なし整数．1〜4294967295．0 は使わない）", () => {
  it("乱数が 0 の時は作り直し，0 を返さない", () => {
    const values = [0, 0, 42];
    vi.spyOn(crypto, "getRandomValues").mockImplementation((array) => {
      (array as Uint32Array)[0] = values.shift() ?? 7;
      return array;
    });
    expect(createStudentId()).toBe(42);
  });

  it("乱数が最大（0xffffffff）ならそのまま 4294967295", () => {
    vi.spyOn(crypto, "getRandomValues").mockImplementation((array) => {
      (array as Uint32Array)[0] = 0xffffffff;
      return array;
    });
    expect(createStudentId()).toBe(4294967295);
  });

  it("何度作っても 1〜4294967295 の整数で isStudentId に通る", () => {
    for (let i = 0; i < 500; i++) {
      const id = createStudentId();
      expect(Number.isInteger(id)).toBe(true);
      expect(id).toBeGreaterThanOrEqual(1);
      expect(id).toBeLessThanOrEqual(4294967295);
      expect(isStudentId(id)).toBe(true);
    }
  });
});

describe("isStudentId", () => {
  it.each<[unknown, boolean]>([
    [1, true],
    [4294967295, true],
    [0, false],
    [4294967296, false],
    [-1, false],
    [1.5, false],
    [Number.NaN, false],
    [Number.POSITIVE_INFINITY, false],
    ["1", false],
    [null, false],
    [undefined, false],
    [1n, false],
  ])("%s は %s", (value, expected) => {
    expect(isStudentId(value)).toBe(expected);
  });
});

describe("parseStudentId（sessionStorage に置いた文字を数に戻す）", () => {
  it.each<[string | null, number | null]>([
    ["1", 1],
    ["4294967295", 4294967295],
    ["", null],
    ["-1", null],
    [" 1", null],
    ["1 ", null],
    ["1e3", null],
    ["0x10", null],
    ["abc", null],
    ["99999999999", null],
    ["NaN", null],
    ["Infinity", null],
  ])("%j は %s", (text, expected) => {
    expect(parseStudentId(text)).toBe(expected);
  });

  it("作った ID を文字にして戻すと同じ数になる", () => {
    for (let i = 0; i < 50; i++) {
      const id = createStudentId();
      expect(parseStudentId(String(id))).toBe(id);
    }
  });
});

describe("createPlanFingerprint（仕様: p の値の SHA-256 の先頭 8 バイトを base64url にした 11 文字．p= が無い時は demo）", () => {
  it.each(["", "a", "AAAA-_bb", "x".repeat(1500), "日本語"])(
    "%j の指紋は SHA-256 の先頭 8 バイトの base64url",
    async (encoded) => {
      const fingerprint = await createPlanFingerprint(encoded);
      expect(fingerprint).toBe(sha256Prefix(encoded));
      expect(fingerprint).toMatch(/^[A-Za-z0-9_-]{11}$/);
    },
  );

  it("空の文字列（#p= の中身が空）は p= が無いのとは別で demo にしない", async () => {
    expect(await createPlanFingerprint("")).not.toBe("demo");
    expect(await createPlanFingerprintFromHash("#p=&room=abcdefgh")).toBe(sha256Prefix(""));
  });

  it("同じ埋め込みデータは同じ指紋，1 文字でも違えば違う指紋", async () => {
    const a = await createPlanFingerprint("AAAA-_bbCCCC");
    expect(await createPlanFingerprint("AAAA-_bbCCCC")).toBe(a);
    expect(await createPlanFingerprint("AAAA-_bbCCCD")).not.toBe(a);
  });

  it.each<[string, string]>([
    ["#p=AAAA-_bb", "AAAA-_bb"],
    ["p=AAAA-_bb", "AAAA-_bb"],
    ["#room=abcdefgh&p=AAAA-_bb", "AAAA-_bb"],
    ["#x=1&p=AAAA-_bb&room=abcdefgh", "AAAA-_bb"],
  ])(
    "フラグメント %j では p の値 %j から作る（room= や他の値の有無に左右されない）",
    async (hash, p) => {
      expect(await createPlanFingerprintFromHash(hash)).toBe(sha256Prefix(p));
    },
  );

  it.each(["", "#", "#room=abcdefgh", "#x=1&y=2"])(
    "p= が無いフラグメント %j は demo",
    async (hash) => {
      expect(await createPlanFingerprintFromHash(hash)).toBe("demo");
    },
  );

  it("生徒（?app）と見守り画面（?monitor）で同じフラグメントなら同じ指紋", async () => {
    const fragment = "#p=AAAA-_bbCCCC&room=abcdefgh12345678";
    const app = new URL(`https://example.com/?app${fragment}`).hash;
    const monitor = new URL(`https://example.com/?monitor${fragment}`).hash;
    expect(await createPlanFingerprintFromHash(app)).toBe(
      await createPlanFingerprintFromHash(monitor),
    );
  });
});
