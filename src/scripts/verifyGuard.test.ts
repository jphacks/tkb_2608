// scripts/verify/guard.mjs（検証がつないでよい先の判定）のテスト（vitest の include が src/**/*.test.ts のため src に置く）
// tsconfig は scripts/ の .mjs を型付けしないため，型を付けて動的に読み込む
import { describe, expect, it } from "vitest";

interface GuardModule {
  isAllowed(url: string): boolean;
  assertAllowed(url: string): void;
}

const GUARD_PATH: string = "../../scripts/verify/guard.mjs";
const { assertAllowed, isAllowed } = (await import(/* @vite-ignore */ GUARD_PATH)) as GuardModule;

describe("isAllowed", () => {
  it.each([
    "http://127.0.0.1:5173/",
    "http://127.0.0.1:5173/?editor",
    "http://localhost:5173/src/main.ts",
    "ws://127.0.0.1:5173/",
    "data:image/png;base64,AAAA",
    "blob:http://127.0.0.1:5173/abc",
    "about:blank",
  ])("ローカルの開発サーバーとブラウザ内の URL は許可する: %s", (url) => {
    expect(isAllowed(url)).toBe(true);
  });

  it.each([
    "https://tkb2608.pages.dev/",
    "https://staging.tkb2608.pages.dev/?app",
    "https://abc.tkb2608.pages.dev/",
    "https://tkb2608-relay.example.workers.dev/",
    "https://abc-def.trycloudflare.com/",
    "https://generativelanguage.googleapis.com/v1beta/models",
    "https://storage.googleapis.com/mediapipe-models/x.task",
    "http://127.0.0.1:8788/api/floor-draft",
    "http://127.0.0.1:5173/api/floor-draft",
    "http://127.0.0.1:8787/",
    "https://127.0.0.1:5173/",
    "http://127.0.0.1:51730/",
  ])("本番・staging・外部・別のポート・AI の下書きの API は拒否する: %s", (url) => {
    expect(isAllowed(url)).toBe(false);
  });

  it.each(["", "not a url", "127.0.0.1:5173"])("URL として読めないものは拒否する: %j", (url) => {
    expect(isAllowed(url)).toBe(false);
  });
});

describe("assertAllowed", () => {
  it("許可する先なら何もしない", () => {
    expect(() => assertAllowed("http://127.0.0.1:5173/")).not.toThrow();
  });

  it("拒否する先なら例外を投げる", () => {
    expect(() => assertAllowed("https://tkb2608.pages.dev/")).toThrow(/検証の対象外/);
  });
});
