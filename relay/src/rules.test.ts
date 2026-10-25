// 見守りの中継の判定（SPEC_01「見守り」の段階 1 の「中継」・「部屋の ID と URL」，SPEC_02「URL と QR への埋め込み」）
import { describe, expect, it } from "vitest";
import {
  exceedsMaxMessageBytes,
  isValidRoomId,
  MAX_MESSAGE_BYTES,
  messageBytes,
  parseRole,
  parseRoomPath,
} from "./rules";

/** n 文字の部屋の ID（base64url の文字だけ）． */
function roomId(n: number, ch = "a"): string {
  return ch.repeat(n);
}

/** n バイトの ArrayBuffer． */
function bytes(n: number): ArrayBuffer {
  return new ArrayBuffer(n);
}

describe("MAX_MESSAGE_BYTES", () => {
  it("1 回の大きさの上限は 4 KiB（4096 バイト）", () => {
    expect(MAX_MESSAGE_BYTES).toBe(4096);
  });
});

describe("isValidRoomId", () => {
  it.each([
    [8, true],
    [16, true],
    [64, true],
    [7, false],
    [65, false],
    [0, false],
    [1, false],
  ])("%i 文字の ID は %s（8〜64 文字）", (n, ok) => {
    expect(isValidRoomId(roomId(n))).toBe(ok);
  });

  it("base64url の文字（英大文字・英小文字・数字・_・-）はすべて使える", () => {
    expect(isValidRoomId("ABCDEFGHIJKLMNOPQRSTUVWXYZ")).toBe(true);
    expect(isValidRoomId("abcdefghijklmnopqrstuvwxyz")).toBe(true);
    expect(isValidRoomId("0123456789")).toBe(true);
    expect(isValidRoomId("________")).toBe(true);
    expect(isValidRoomId("--------")).toBe(true);
    expect(isValidRoomId("Xq3v9_aB0cD-ef_G")).toBe(true);
  });

  it("node の randomBytes(12).toString('base64url') と同じ形の 16 文字は通る", () => {
    // SPEC_01 の手で作る方法で出る形（12 バイト → 16 文字．パディング無し）
    for (const id of ["q8Zb3x_Tn-1aR0kW", "AAAAAAAAAAAAAAAA", "____------______"]) {
      expect(id).toHaveLength(16);
      expect(isValidRoomId(id)).toBe(true);
    }
  });

  it.each([
    ["+", "abcdefg+"],
    ["/", "abcdefg/"],
    ["= のパディング", "abcdefg="],
    ["空白", "abcd efg"],
    [".", "abcdefg."],
    ["%", "abcdefg%"],
    ["?", "abcdefg?"],
    ["#", "abcdefg#"],
    ["&", "abcdefg&"],
    ["日本語", "abcdefgあ"],
    ["改行（末尾）", "abcdefgh\n"],
    ["改行（先頭）", "\nabcdefgh"],
    ["タブ", "abcdefg\t"],
  ])("base64url 以外の文字（%s）を含むものは通らない", (_label, id) => {
    expect(isValidRoomId(id)).toBe(false);
  });

  it("8 文字に記号が混じって長さが足りていても，記号があれば通らない", () => {
    expect(isValidRoomId(`${roomId(63)}+`)).toBe(false);
    expect(isValidRoomId(`+${roomId(8)}`)).toBe(false);
  });

  it("空文字は通らない", () => {
    expect(isValidRoomId("")).toBe(false);
  });
});

describe("parseRole", () => {
  it("student と monitor の 2 つの役割を読む", () => {
    expect(parseRole("student")).toBe("student");
    expect(parseRole("monitor")).toBe("monitor");
  });

  it.each([
    ["null（role が無い）", null],
    ["空文字", ""],
    ["大文字", "Student"],
    ["すべて大文字", "MONITOR"],
    ["前後に空白", " student"],
    ["末尾に空白", "monitor "],
    ["知らない役割", "teacher"],
    ["複数形", "students"],
    ["admin", "admin"],
  ])("役割でないもの（%s）は null", (_label, value) => {
    expect(parseRole(value)).toBeNull();
  });
});

describe("parseRoomPath", () => {
  it("/rooms/<部屋の ID> から部屋の ID を取り出す", () => {
    expect(parseRoomPath("/rooms/Xq3v9_aB0cD-ef_G")).toBe("Xq3v9_aB0cD-ef_G");
  });

  it("ID の形は見ない（形の検査は isValidRoomId で行う）", () => {
    expect(parseRoomPath("/rooms/abc")).toBe("abc");
  });

  it.each([
    ["ルート", "/"],
    ["空文字", ""],
    ["/rooms だけ", "/rooms"],
    ["/rooms/ で ID が空", "/rooms/"],
    ["末尾に /", "/rooms/abcdefgh/"],
    ["さらに下のパス", "/rooms/abcdefgh/extra"],
    ["別の名前", "/room/abcdefgh"],
    ["前に別のパス", "/api/rooms/abcdefgh"],
    ["先頭の / が無い", "rooms/abcdefgh"],
    ["大文字", "/Rooms/abcdefgh"],
    ["/ が 2 つ", "/rooms//abcdefgh"],
  ])("形に合わないパス（%s）は null", (_label, path) => {
    expect(parseRoomPath(path)).toBeNull();
  });

  it("取り出した ID と isValidRoomId を組み合わせると，正しい部屋だけが通る", () => {
    const ok = parseRoomPath(`/rooms/${roomId(16)}`);
    expect(ok).not.toBeNull();
    expect(isValidRoomId(ok as string)).toBe(true);
    const short = parseRoomPath(`/rooms/${roomId(7)}`);
    expect(isValidRoomId(short as string)).toBe(false);
  });
});

describe("messageBytes", () => {
  describe("バイナリ（ArrayBuffer）", () => {
    it.each([0, 1, 20, 4095, 4096, 4097, 10000])("%i バイトはその長さ", (n) => {
      expect(messageBytes(bytes(n))).toBe(n);
    });

    it("見守りの状態（20 バイト）は上限以下", () => {
      expect(messageBytes(bytes(20))).toBeLessThanOrEqual(MAX_MESSAGE_BYTES);
    });
  });

  describe("テキスト（UTF-8 で数える）", () => {
    it("空文字は 0 バイト", () => {
      expect(messageBytes("")).toBe(0);
    });

    it("ASCII は 1 文字 1 バイト", () => {
      expect(messageBytes("a")).toBe(1);
      expect(messageBytes('{"type":"phase"}')).toBe(16);
    });

    it.each([
      ["2 バイトの文字（é）", "é", 2],
      ["3 バイトの文字（あ）", "あ", 3],
      ["3 バイトの文字（漢字）", "避難", 6],
      ["4 バイトの文字（サロゲートペア）", "😀", 4],
      ["混在", "aé あ😀", 1 + 2 + 1 + 3 + 4],
    ])("短い文字列でも UTF-8 のバイト数を返す（%s）", (_label, text, n) => {
      expect(messageBytes(text)).toBe(n);
    });

    it.each([4095, 4096, 4097])("ASCII %i 文字は %i バイト", (n) => {
      expect(messageBytes("a".repeat(n))).toBe(n);
    });

    it("3 バイトの文字 1365 個（4095 バイト）・1366 個（4098 バイト）を正しく数える", () => {
      expect(messageBytes("あ".repeat(1365))).toBe(4095);
      expect(messageBytes("あ".repeat(1366))).toBe(4098);
    });

    it("UTF-16 では上限以下でも UTF-8 で 4096 を超えるものは超えると数える", () => {
      // 2048 文字（UTF-16 では 4096 バイト）だが UTF-8 では 6144 バイト
      const text = "あ".repeat(2048);
      expect(messageBytes(text)).toBe(6144);
      expect(messageBytes(text)).toBeGreaterThan(MAX_MESSAGE_BYTES);
    });

    it("ちょうど 4096 バイト（ASCII 4093 + あ）は上限ちょうど，1 バイト足すと超える", () => {
      const just = `${"a".repeat(4093)}あ`;
      expect(messageBytes(just)).toBe(MAX_MESSAGE_BYTES);
      expect(messageBytes(`${just}a`)).toBe(MAX_MESSAGE_BYTES + 1);
    });

    it("4 バイトの文字 1024 個はちょうど 4096 バイト，1025 個は超える", () => {
      expect(messageBytes("😀".repeat(1024))).toBe(4096);
      expect(messageBytes("😀".repeat(1025))).toBe(4100);
    });

    it("段階 1 の知らせ（hello・phase・door）は上限以下", () => {
      const notices = [
        {
          type: "hello",
          studentId: 3141592653,
          v: 1,
          planFingerprint: "Xq3v9_aB0cD",
          mode: "learn",
        },
        { type: "phase", studentId: 3141592653, phase: "drill" },
        { type: "door", studentId: 3141592653, cell: { floor: 0, x: 4, z: 7 }, open: true },
      ];
      for (const n of notices) {
        expect(messageBytes(JSON.stringify(n))).toBeLessThanOrEqual(MAX_MESSAGE_BYTES);
      }
    });
  });

  describe("上限との比べ方（4 KiB を超えるものだけを捨てる）", () => {
    it.each([
      ["バイナリ 4096", () => bytes(4096), false],
      ["バイナリ 4097", () => bytes(4097), true],
      ["テキスト ASCII 4096", () => "a".repeat(4096), false],
      ["テキスト ASCII 4097", () => "a".repeat(4097), true],
      ["テキスト あ×1365（4095）", () => "あ".repeat(1365), false],
      ["テキスト あ×1366（4098）", () => "あ".repeat(1366), true],
    ] as const)("%s は超えるか: %s", (_label, make, over) => {
      expect(messageBytes(make()) > MAX_MESSAGE_BYTES).toBe(over);
    });
  });
});

describe("exceedsMaxMessageBytes", () => {
  // 1 回の大きさが 4 KiB（4096 バイト）を超えるものだけを捨てる（SPEC_01「中継」）．テキストは UTF-8 で数える
  const cases: readonly (readonly [string, () => string | ArrayBuffer, boolean])[] = [
    ["空のテキスト（0 バイト）", () => "", false],
    ["空のバイナリ（0 バイト）", () => bytes(0), false],
    ["ASCII 1365 文字（1365 バイト）", () => "a".repeat(1365), false],
    ["ASCII 1366 文字（1366 バイト）", () => "a".repeat(1366), false],
    ["ASCII 4096 文字（4096 バイト）", () => "a".repeat(4096), false],
    ["ASCII 4097 文字（4097 バイト）", () => "a".repeat(4097), true],
    ["あ×1365（4095 バイト）", () => "あ".repeat(1365), false],
    ["あ×1366（4098 バイト）", () => "あ".repeat(1366), true],
    ["ASCII 4093 + あ（ちょうど 4096 バイト）", () => `${"a".repeat(4093)}あ`, false],
    ["ASCII 4094 + あ（4097 バイト）", () => `${"a".repeat(4094)}あ`, true],
    ["ASCII 4093 + あ + a（4097 バイト）", () => `${"a".repeat(4093)}あa`, true],
    ["ASCII 4095 + あ（4098 バイト）", () => `${"a".repeat(4095)}あ`, true],
    ["😀×1024（ちょうど 4096 バイト）", () => "😀".repeat(1024), false],
    ["😀×1025（4100 バイト）", () => "😀".repeat(1025), true],
    ["é×2048（ちょうど 4096 バイト）", () => "é".repeat(2048), false],
    ["é×2049（4098 バイト）", () => "é".repeat(2049), true],
    ["バイナリ 20 バイト（状態）", () => bytes(20), false],
    ["バイナリ 4096 バイト", () => bytes(4096), false],
    ["バイナリ 4097 バイト", () => bytes(4097), true],
  ];
  it.each(cases)("%s は超えるか: %s", (_label, make, over) => {
    expect(exceedsMaxMessageBytes(make())).toBe(over);
  });

  it("messageBytes で数えた大きさと上限の比べ方に一致する", () => {
    const samples: (string | ArrayBuffer)[] = [
      "",
      "a".repeat(1366),
      "あ".repeat(1365),
      "あ".repeat(1366),
      `${"a".repeat(4093)}あ`,
      `${"a".repeat(4094)}あ`,
      "😀".repeat(1024),
      "😀".repeat(1025),
      bytes(4096),
      bytes(4097),
    ];
    for (const m of samples) {
      expect(exceedsMaxMessageBytes(m)).toBe(messageBytes(m) > MAX_MESSAGE_BYTES);
    }
  });
});
