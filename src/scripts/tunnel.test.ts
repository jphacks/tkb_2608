// scripts/tunnel.mjs の純粋な関数のテスト（vitest の include が src/**/*.test.ts のため src に置く）
// tsconfig は scripts/ の .mjs を型付けしないため，型を付けて動的に読み込む
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
});
