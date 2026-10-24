import { describe, expect, it } from "vitest";
import { resolveDebug, resolveLaunchMode, resolveStereo } from "./launchMode";

describe("resolveLaunchMode", () => {
  it("?app が無ければ従来のビューア", () => {
    expect(resolveLaunchMode("")).toBe("viewer");
    expect(resolveLaunchMode("?scene=train")).toBe("viewer");
  });

  it("?app があれば体験の流れ（値の有無を問わない）", () => {
    expect(resolveLaunchMode("?app")).toBe("app");
    expect(resolveLaunchMode("?app=1")).toBe("app");
    expect(resolveLaunchMode("?scene=room&app")).toBe("app");
  });

  it("?app=0 / ?app=false はビューア", () => {
    expect(resolveLaunchMode("?app=0")).toBe("viewer");
    expect(resolveLaunchMode("?app=false")).toBe("viewer");
    expect(resolveLaunchMode("?app=FALSE")).toBe("viewer");
  });
});

describe("resolveLaunchMode（結果画面の単独起動 ?debrief）", () => {
  it.each(["?debrief", "?debrief=1", "?debrief=late", "?debrief=nosmoke", "?scene=room&debrief"])(
    "%s は結果画面",
    (search) => {
      expect(resolveLaunchMode(search)).toBe("debrief");
    },
  );

  it.each(["?debrief=0", "?debrief=false", "?debrief=FALSE"])("%s はビューア", (search) => {
    expect(resolveLaunchMode(search)).toBe("viewer");
  });

  it("?app と ?debrief の両方があれば ?app が優先", () => {
    expect(resolveLaunchMode("?app&debrief")).toBe("app");
    expect(resolveLaunchMode("?debrief=late&app=1")).toBe("app");
  });

  it("?app=0 なら ?debrief が効く", () => {
    expect(resolveLaunchMode("?app=0&debrief")).toBe("debrief");
    expect(resolveLaunchMode("?app=0&debrief=0")).toBe("viewer");
  });
});

describe("resolveStereo", () => {
  it("指定が無ければ coarse pointer（スマホ）の端末だけ 2 画面", () => {
    expect(resolveStereo("", true)).toBe(true);
    expect(resolveStereo("", false)).toBe(false);
    expect(resolveStereo("?app", true)).toBe(true);
  });

  it("?stereo=1 / true で強制的に 2 画面", () => {
    expect(resolveStereo("?stereo=1", false)).toBe(true);
    expect(resolveStereo("?stereo=true", false)).toBe(true);
  });

  it("?stereo=0 / false で強制的に 1 画面", () => {
    expect(resolveStereo("?stereo=0", true)).toBe(false);
    expect(resolveStereo("?stereo=false", true)).toBe(false);
  });

  it("解釈できない値は端末の種類に従う", () => {
    expect(resolveStereo("?stereo=abc", true)).toBe(true);
    expect(resolveStereo("?stereo=abc", false)).toBe(false);
  });
});

describe("resolveDebug", () => {
  it("?debug が無ければ無効", () => {
    expect(resolveDebug("")).toBe(false);
    expect(resolveDebug("?app")).toBe(false);
  });

  it("?debug があれば有効", () => {
    expect(resolveDebug("?debug")).toBe(true);
    expect(resolveDebug("?app&debug=1")).toBe(true);
  });

  it("?debug=0 / false は無効", () => {
    expect(resolveDebug("?debug=0")).toBe(false);
    expect(resolveDebug("?debug=false")).toBe(false);
  });
});
