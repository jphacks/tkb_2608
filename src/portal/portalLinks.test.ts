// portal/ の URL の組み立てのテスト．基準は Issue #176（パラメータ無しの URL は教員用のホーム画面．
// 進む先は「エディタを開く」（?editor）だけ．背景の画像は public/home/ に置き，配信先の base が "/" 以外でも壊れない）
import { describe, expect, it } from "vitest";
import { resolveLaunchMode } from "../app/launchMode";
import { buildEditorHref, resolveHeroImageUrls } from "./portalLinks";

describe("resolveHeroImageUrls", () => {
  it.each<[string, string, string]>([
    ["/", "/home/hero.webp", "/home/hero.jpg"],
    ["/sub", "/sub/home/hero.webp", "/sub/home/hero.jpg"],
    ["/sub/", "/sub/home/hero.webp", "/sub/home/hero.jpg"],
    ["", "/home/hero.webp", "/home/hero.jpg"],
    ["/a/b/", "/a/b/home/hero.webp", "/a/b/home/hero.jpg"],
    ["./", "./home/hero.webp", "./home/hero.jpg"],
  ])("base が %j なら webp は %s・jpg は %s", (base, webp, jpg) => {
    expect(resolveHeroImageUrls(base)).toEqual({ webp, jpg });
  });

  it("base と画像のパスの間の / は 1 つだけ", () => {
    for (const base of ["/", "/sub", "/sub/", ""]) {
      const { webp, jpg } = resolveHeroImageUrls(base);
      expect(webp).not.toMatch(/\/\/home/);
      expect(jpg).not.toMatch(/\/\/home/);
    }
  });
});

describe("buildEditorHref", () => {
  it.each<[string, string]>([
    ["/", "/?editor"],
    ["/sub/index.html", "/sub/index.html?editor"],
    ["/sub/", "/sub/?editor"],
    ["", "/?editor"],
  ])("パス %j から %s を作る", (pathname, expected) => {
    expect(buildEditorHref(pathname)).toBe(expected);
  });

  it.each(["/", "/sub/index.html", "/sub/", ""])(
    "パス %j から作った行き先はエディタとして起動する",
    (pathname) => {
      const href = buildEditorHref(pathname);
      const search = href.slice(href.indexOf("?"));
      expect(search).toBe("?editor");
      expect(resolveLaunchMode(search)).toBe("editor");
    },
  );
});
