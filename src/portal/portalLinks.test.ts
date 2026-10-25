// portal/ の URL の組み立てのテスト．基準は Issue #176（パラメータ無しの URL は教員用のホーム画面．
// 進む先は「エディタを開く」（?editor）だけ．背景の画像は public/home/ に置き，配信先の base が "/" 以外でも壊れない）
import { describe, expect, it } from "vitest";
import { resolveLaunchMode } from "../app/launchMode";
import { resolvePcMode } from "../app/pcMode";
import {
  buildEditorHref,
  buildPcExperienceHref,
  buildVrExperienceHref,
  portalEntries,
  resolveHeroImageUrls,
} from "./portalLinks";

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

describe("portalEntries", () => {
  it("PC で開いた時は「PC で体験する」を先頭で目立たせる", () => {
    const entries = portalEntries("/", false);
    expect(entries.map((e) => e.id)).toEqual(["pc", "vr", "editor"]);
    expect(entries.filter((e) => e.primary).map((e) => e.id)).toEqual(["pc"]);
  });

  it("スマホで開いた時はゴーグルの体験を先頭で目立たせる", () => {
    const entries = portalEntries("/", true);
    expect(entries.map((e) => e.id)).toEqual(["vr", "pc", "editor"]);
    expect(entries.filter((e) => e.primary).map((e) => e.id)).toEqual(["vr"]);
  });

  it("どの入口にも 1 行の説明がある", () => {
    for (const entry of portalEntries("/", false)) expect(entry.note).not.toBe("");
  });

  it("行き先はそれぞれ PC の体験・スマホの体験・エディタとして起動する", () => {
    const search = (href: string) => href.slice(href.indexOf("?"));
    expect(search(buildPcExperienceHref("/"))).toBe("?app&pc");
    expect(resolveLaunchMode(search(buildPcExperienceHref("/sub/")))).toBe("app");
    expect(resolveLaunchMode(search(buildVrExperienceHref("/")))).toBe("app");
    expect(buildVrExperienceHref("")).toBe("/?app");
  });
});

// Issue #205 の仕様の観点（どのパス・端末でも入口がそろう）を補うテスト
describe("portalEntries（パスと端末の組み合わせ）", () => {
  const PATHS = ["/", "", "/sub/", "/sub/index.html"];
  const cases = PATHS.flatMap((pathname) => [
    [pathname, false] as [string, boolean],
    [pathname, true] as [string, boolean],
  ]);
  const searchOf = (href: string) => href.slice(href.indexOf("?"));
  const pathOf = (href: string) => href.slice(0, href.indexOf("?"));

  it.each(cases)(
    "パス %j・タッチ主体 %s でも入口は PC・ゴーグル・エディタの 3 つ",
    (pathname, coarse) => {
      const ids = portalEntries(pathname, coarse).map((e) => e.id);
      expect(ids).toHaveLength(3);
      expect([...ids].sort()).toEqual(["editor", "pc", "vr"]);
    },
  );

  it.each(cases)(
    "パス %j・タッチ主体 %s では目立たせる入口が 1 つだけで，並びの先頭にある",
    (pathname, coarse) => {
      const entries = portalEntries(pathname, coarse);
      expect(entries.filter((e) => e.primary)).toHaveLength(1);
      expect(entries[0]?.primary).toBe(true);
      expect(entries[0]?.id).toBe(coarse ? "vr" : "pc");
    },
  );

  it.each(cases)("パス %j・タッチ主体 %s でもエディタは最後で目立たせない", (pathname, coarse) => {
    const entries = portalEntries(pathname, coarse);
    expect(entries[entries.length - 1]?.id).toBe("editor");
    expect(entries.find((e) => e.id === "editor")?.primary).toBe(false);
  });

  it.each(cases)(
    "パス %j・タッチ主体 %s でも行き先は今のパスを保ち，各入口の流れで起動する",
    (pathname, coarse) => {
      const expectedPath = pathname === "" ? "/" : pathname;
      for (const entry of portalEntries(pathname, coarse)) {
        expect(pathOf(entry.href)).toBe(expectedPath);
        const search = searchOf(entry.href);
        if (entry.id === "pc") {
          expect(search).toBe("?app&pc");
          expect(resolveLaunchMode(search)).toBe("app");
          expect(resolvePcMode(search)).toBe(true);
        } else if (entry.id === "vr") {
          expect(search).toBe("?app");
          expect(resolveLaunchMode(search)).toBe("app");
          expect(resolvePcMode(search)).toBe(false);
        } else {
          expect(search).toBe("?editor");
          expect(resolveLaunchMode(search)).toBe("editor");
        }
        // ゴーグルの体験・PC の体験は入力を URL で決め打ちしない（input= を付けない）
        expect(new URLSearchParams(search).has("input")).toBe(false);
      }
    },
  );

  it.each(cases)("パス %j・タッチ主体 %s でも各入口に 1 行の説明がある", (pathname, coarse) => {
    for (const entry of portalEntries(pathname, coarse)) {
      expect(entry.label.trim()).not.toBe("");
      expect(entry.note.trim()).not.toBe("");
      expect(entry.note).not.toMatch(/\n/);
    }
  });

  it("入口の文字は Issue のとおり", () => {
    const byId = new Map(portalEntries("/", false).map((e) => [e.id, e]));
    expect(byId.get("pc")?.label).toBe("PC で体験する");
    expect(byId.get("vr")?.label).toBe("スマホ＋VR ゴーグルで体験する");
    expect(byId.get("editor")?.label).toBe("校舎を作る（エディタ）");
  });

  it("PC の入口の説明はゴーグル不要と操作（W で歩く・C でしゃがむ）を伝える", () => {
    const pc = portalEntries("/", false).find((e) => e.id === "pc");
    expect(pc?.note).toMatch(/ゴーグル不要/);
    expect(pc?.note).toMatch(/W/);
    expect(pc?.note).toMatch(/C/);
  });

  it("端末で変わるのは並びと目立たせる入口だけで，行き先・文字は同じ", () => {
    const strip = (e: { id: string; label: string; note: string; href: string }) => ({
      id: e.id,
      label: e.label,
      note: e.note,
      href: e.href,
    });
    const pc = portalEntries("/sub/", false).map(strip);
    const phone = portalEntries("/sub/", true).map(strip);
    const sortById = (a: { id: string }, b: { id: string }) => a.id.localeCompare(b.id);
    expect([...pc].sort(sortById)).toEqual([...phone].sort(sortById));
  });
});

describe("buildPcExperienceHref・buildVrExperienceHref", () => {
  it.each<[string, string, string]>([
    ["/", "/?app&pc", "/?app"],
    ["", "/?app&pc", "/?app"],
    ["/sub/", "/sub/?app&pc", "/sub/?app"],
    ["/sub/index.html", "/sub/index.html?app&pc", "/sub/index.html?app"],
  ])("パス %j から PC は %s・ゴーグルは %s を作る", (pathname, pcHref, vrHref) => {
    expect(buildPcExperienceHref(pathname)).toBe(pcHref);
    expect(buildVrExperienceHref(pathname)).toBe(vrHref);
  });
});
