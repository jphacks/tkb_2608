import { describe, expect, it } from "vitest";
import { DEV_PAGES, resolveDevRedirect } from "./devPages";

describe("DEV_PAGES", () => {
  it("センサーの確認と手順の記録のページがある", () => {
    expect(DEV_PAGES.map((p) => p.file)).toEqual(["sensors.html", "protocol.html"]);
  });
});

describe("resolveDevRedirect", () => {
  it.each(["sensors.html", "protocol.html"])("覚えているページ（%s）へ移る", (file) => {
    expect(resolveDevRedirect("", file)).toBe(file);
    expect(resolveDevRedirect("?foo=1", file)).toBe(file);
  });

  it.each(["?stay", "?stay=0", "?stay=1", "?a=1&stay"])("%s があれば留まる", (search) => {
    expect(resolveDevRedirect(search, "sensors.html")).toBeNull();
  });

  it("記憶が無ければ留まる", () => {
    expect(resolveDevRedirect("", null)).toBeNull();
  });

  it.each([
    "",
    "index.html",
    "unknown.html",
    "../x",
    "../sensors.html",
    "/sensors.html",
    "SENSORS.HTML",
  ])("一覧に無い値（%s）なら留まる", (stored) => {
    expect(resolveDevRedirect("", stored)).toBeNull();
  });
});
