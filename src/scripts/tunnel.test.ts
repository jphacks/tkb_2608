// scripts/tunnel.mjs の純粋な関数のテスト（vitest の include が src/**/*.test.ts のため src に置く）
// tsconfig は scripts/ の .mjs を型付けしないため，型を付けて動的に読み込む
import { describe, expect, it } from "vitest";

interface TunnelModule {
  withScene(url: string, scene: string | undefined): string | null;
  findTunnelUrl(line: string): string | null;
}

const TUNNEL_PATH: string = "../../scripts/tunnel.mjs";
const { findTunnelUrl, withScene } = (await import(/* @vite-ignore */ TUNNEL_PATH)) as TunnelModule;

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

describe("findTunnelUrl", () => {
  it("ログの行から Quick Tunnel の URL を取り出す", () => {
    expect(findTunnelUrl(`INF |  ${URL}                     |`)).toBe(URL);
  });

  it("無ければ null", () => {
    expect(findTunnelUrl("INF Starting tunnel")).toBeNull();
  });
});
