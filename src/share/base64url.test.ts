// bytesToBase64Url・base64UrlToBytes のテスト．
// 基準は docs/04_SPEC/SPEC_02「URL と QR への埋め込み」の 3（base64url: `+` → `-`，`/` → `_`，末尾の `=` を除く）．
// 標準の base64（btoa）から仕様の置き換えをした結果と一致することで確かめる
import { describe, expect, it } from "vitest";
import { base64UrlToBytes, bytesToBase64Url } from "./base64url";

/** 種付きの乱数（mulberry32）．テストを毎回同じにする */
function seeded(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const randomBytes = (length: number, random: () => number): Uint8Array =>
  Uint8Array.from({ length }, () => Math.floor(random() * 256));

/** 仕様の作り方どおり: 標準の base64 → `+` を `-`，`/` を `_` に → 末尾の `=` を除く */
const referenceBase64Url = (bytes: Uint8Array): string =>
  btoa(String.fromCharCode(...bytes))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");

describe("bytesToBase64Url", () => {
  it("空のバイト列は空の文字列", () => {
    expect(bytesToBase64Url(new Uint8Array())).toBe("");
  });

  it.each<[number[], string]>([
    [[0x66], "Zg"],
    [[0x66, 0x6f], "Zm8"],
    [[0x66, 0x6f, 0x6f], "Zm9v"],
    [[0x66, 0x6f, 0x6f, 0x62], "Zm9vYg"],
  ])("%j は末尾の = を付けずに %s", (bytes, text) => {
    expect(bytesToBase64Url(Uint8Array.from(bytes))).toBe(text);
  });

  it("標準の base64 の + は -，/ は _ になる", () => {
    // 0xfb 0xff → 標準では "+/8="
    expect(bytesToBase64Url(Uint8Array.from([0xfb, 0xff]))).toBe("-_8");
    expect(bytesToBase64Url(Uint8Array.from([0xff, 0xff, 0xff]))).toBe("____");
    expect(bytesToBase64Url(Uint8Array.from([0xf8, 0x00, 0x00]))).toBe("-AAA");
  });

  it("0〜255 のすべてのバイトを含む列で，標準の base64 からの置き換えと一致する", () => {
    const bytes = Uint8Array.from({ length: 256 }, (_, i) => i);
    expect(bytesToBase64Url(bytes)).toBe(referenceBase64Url(bytes));
  });

  it("任意の長さ・中身のバイト列で，出力は base64url の文字だけ（= を含まない）で標準の置き換えと一致する", () => {
    const random = seeded(84);
    for (let length = 0; length < 200; length++) {
      const bytes = randomBytes(length, random);
      const text = bytesToBase64Url(bytes);
      expect(text).toMatch(/^[A-Za-z0-9_-]*$/);
      expect(text).toBe(referenceBase64Url(bytes));
    }
  });
});

describe("base64UrlToBytes", () => {
  it("空の文字列は空のバイト列", () => {
    expect(base64UrlToBytes("")).toEqual(new Uint8Array());
  });

  it("任意のバイト列で bytesToBase64Url と往復する", () => {
    const random = seeded(2608);
    for (let length = 0; length < 200; length++) {
      const bytes = randomBytes(length, random);
      const back = base64UrlToBytes(bytesToBase64Url(bytes));
      expect(back).not.toBeNull();
      expect(Array.from(back ?? [])).toEqual(Array.from(bytes));
    }
  });

  it("大きなバイト列（10 万バイト）でも往復する", () => {
    const bytes = randomBytes(100_000, seeded(1));
    expect(Array.from(base64UrlToBytes(bytesToBase64Url(bytes)) ?? [])).toEqual(Array.from(bytes));
  });

  it.each<[string, number[]]>([
    ["Zg", [0x66]],
    ["Zm8", [0x66, 0x6f]],
    ["Zm9v", [0x66, 0x6f, 0x6f]],
    ["-_8", [0xfb, 0xff]],
  ])("%s は %j に戻る", (text, bytes) => {
    expect(Array.from(base64UrlToBytes(text) ?? [])).toEqual(bytes);
  });

  it.each([
    ["末尾の =（仕様では除く）", "Zg=="],
    ["途中の =", "Zm=v"],
    ["標準の base64 の +", "+/8"],
    ["標準の base64 の /", "ab/c"],
    ["空白", "Zm9 v"],
    ["改行", "Zm9v\n"],
    ["記号", "Zm9v!"],
    ["全角の文字", "Ｚｍ９ｖ"],
    ["日本語", "あいう"],
    ["絵文字", "Zm😀"],
  ])("base64url に無い文字（%s）を含むと null", (_label, text) => {
    expect(base64UrlToBytes(text)).toBeNull();
  });

  it.each(["A", "AAAAA", "Zm9vY"])("長さが 4 で割って 1 余る（%s）と null", (text) => {
    expect(base64UrlToBytes(text)).toBeNull();
  });
});
