// scripts/tunnel.mjs の純粋な関数のテスト（vitest の include が src/**/*.test.ts のため src に置く）
// tsconfig は scripts/ の .mjs を型付けしないため，型を付けて動的に読み込む
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

interface TunnelModule {
  withScene(url: string, scene: string | undefined): string | null;
  withPath(url: string, path: string): string | null;
  withTarget(url: string, arg: string | undefined): string | null;
  findTunnelUrl(line: string): string | null;
}

const TUNNEL_PATH: string = "../../scripts/tunnel.mjs";
const { findTunnelUrl, withPath, withScene, withTarget } = (await import(
  /* @vite-ignore */ TUNNEL_PATH
)) as TunnelModule;

const URL = "https://abc-def-123.trycloudflare.com";

describe("withScene", () => {
  it("scene が無ければ url のまま", () => {
    expect(withScene(URL, undefined)).toBe(URL);
    expect(withScene(URL, "")).toBe(URL);
  });

  it.each(["train", "room", "elevator", "a-1"])("%s なら ?scene=<id> を付ける", (scene) => {
    expect(withScene(URL, scene)).toBe(`${URL}/?scene=${scene}`);
  });

  it.each(["Train", "train&x=1", "../x", "a b", "train/", "トレイン"])(
    "書式が不正（%s）なら null",
    (scene) => {
      expect(withScene(URL, scene)).toBeNull();
    },
  );
});

describe("withPath", () => {
  it.each(["/", "/src/input/dev/", "/src/input/dev/sensors.html", "/a_b-c.d/E9"])(
    "%s をそのまま URL に付ける",
    (path) => {
      expect(withPath(URL, path)).toBe(`${URL}${path}`);
    },
  );

  it.each([
    "/../x",
    "/a/../b",
    "/a/..",
    "/a b",
    "/x?y",
    "/x#y",
    "/x&y",
    "/%2e%2e/x",
    "/あ",
    "src/input/dev/",
    "",
  ])("書式が不正（%s）なら null", (path) => {
    expect(withPath(URL, path)).toBeNull();
  });
});

describe("withTarget", () => {
  it("引数が無ければ URL のまま", () => {
    expect(withTarget(URL, undefined)).toBe(URL);
    expect(withTarget(URL, "")).toBe(URL);
  });

  it("空間の id なら ?scene=<id> を付ける", () => {
    expect(withTarget(URL, "train")).toBe(`${URL}/?scene=train`);
  });

  it('"/" で始まればパスとして付ける', () => {
    expect(withTarget(URL, "/src/input/dev/")).toBe(`${URL}/src/input/dev/`);
  });

  it.each(["/../x", "/a b", "/x?y", "Train", "../x"])("不正（%s）なら null", (arg) => {
    expect(withTarget(URL, arg)).toBeNull();
  });
});

describe("findTunnelUrl", () => {
  it("ログの行から Quick Tunnel の URL を取り出す", () => {
    expect(findTunnelUrl(`INF |  ${URL}                     |`)).toBe(URL);
  });

  it("無ければ null", () => {
    expect(findTunnelUrl("INF Starting tunnel")).toBeNull();
  });

  it.each([
    "https://seasonal-deck-organisms-sf.trycloudflare.com",
    "https://api-deck-x.trycloudflare.com",
    "https://x-api.trycloudflare.com",
    "https://apix.trycloudflare.com",
    "https://rapid-api-test.trycloudflare.com",
  ])("発行された形の URL（%s）は拾う（api. 以外は外さない）", (url) => {
    expect(findTunnelUrl(`2026-10-25T00:00:00Z INF |  ${url}                     |`)).toBe(url);
  });

  it("トンネル作成に失敗した時のログ（api.trycloudflare.com だけを含む）では null（誤った URL・QR を出さない）", () => {
    const line =
      '2026-10-25T00:00:00Z ERR failed to request quick Tunnel: Post "https://api.trycloudflare.com/tunnel": dial tcp: lookup api.trycloudflare.com on 192.168.65.7:53: no such host';
    expect(findTunnelUrl(line)).toBeNull();
  });

  it.each([
    "https://api.trycloudflare.com",
    "https://api.trycloudflare.com/tunnel",
    'Post "https://api.trycloudflare.com/tunnel"',
  ])("受付の api.trycloudflare.com（%s）は拾わない", (line) => {
    expect(findTunnelUrl(line)).toBeNull();
  });

  it("同じ行に受付と発行された URL があれば，発行された URL を拾う", () => {
    expect(findTunnelUrl(`https://api.trycloudflare.com/tunnel -> ${URL}`)).toBe(URL);
  });
});

// TARGET は export されていないため，ソースの文字列で vite.config.ts の server.host と揃っていることを確かめる
describe("tunnel.mjs のトンネルの向き先", () => {
  it("cloudflared は開発サーバーの待ち受けと同じ http://127.0.0.1:5173 を指す（localhost では ::1 につなぐ環境がある）", () => {
    const source = readFileSync(
      new globalThis.URL("../../scripts/tunnel.mjs", import.meta.url),
      "utf8",
    );
    expect(source).toMatch(/const TARGET = "http:\/\/127\.0\.0\.1:5173";/);
    expect(source).not.toMatch(/http:\/\/localhost:5173/);
  });
});
