import { describe, expect, it } from "vitest";
import { resolveDebug, resolveDemo, resolveLaunchMode, resolveStereo } from "./launchMode";

describe("resolveLaunchMode", () => {
  it("パラメータ無しは教員用のホーム画面，?scene=train は従来のビューア", () => {
    expect(resolveLaunchMode("")).toBe("home");
    expect(resolveLaunchMode("?")).toBe("home");
    expect(resolveLaunchMode("?scene=train")).toBe("viewer");
  });

  it("?app があれば体験の流れ（値の有無を問わない）", () => {
    expect(resolveLaunchMode("?app")).toBe("app");
    expect(resolveLaunchMode("?app=1")).toBe("app");
    expect(resolveLaunchMode("?scene=room&app")).toBe("app");
  });

  it("?app=0 / ?app=false だけならホーム画面", () => {
    expect(resolveLaunchMode("?app=0")).toBe("home");
    expect(resolveLaunchMode("?app=false")).toBe("home");
    expect(resolveLaunchMode("?app=FALSE")).toBe("home");
  });
});

describe("resolveLaunchMode（結果画面の単独起動 ?debrief）", () => {
  it.each(["?debrief", "?debrief=1", "?debrief=late", "?debrief=nosmoke", "?scene=room&debrief"])(
    "%s は結果画面",
    (search) => {
      expect(resolveLaunchMode(search)).toBe("debrief");
    },
  );

  it.each(["?debrief=0", "?debrief=false", "?debrief=FALSE"])("%s だけならホーム画面", (search) => {
    expect(resolveLaunchMode(search)).toBe("home");
  });

  it("?app と ?debrief の両方があれば ?app が優先", () => {
    expect(resolveLaunchMode("?app&debrief")).toBe("app");
    expect(resolveLaunchMode("?debrief=late&app=1")).toBe("app");
  });

  it("?app=0 なら ?debrief が効く", () => {
    expect(resolveLaunchMode("?app=0&debrief")).toBe("debrief");
    expect(resolveLaunchMode("?app=0&debrief=0")).toBe("home");
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

describe("resolveLaunchMode（教員用のエディタ ?editor）", () => {
  it.each(["?editor", "?editor=1", "?editor=true", "?scene=room&editor", "?input=mock&editor"])(
    "%s はエディタ",
    (search) => {
      expect(resolveLaunchMode(search)).toBe("editor");
    },
  );

  it.each(["?editor=0", "?editor=false", "?editor=FALSE"])("%s だけならホーム画面", (search) => {
    expect(resolveLaunchMode(search)).toBe("home");
  });

  it("?app が ?editor より優先", () => {
    expect(resolveLaunchMode("?app&editor")).toBe("app");
    expect(resolveLaunchMode("?editor&app=1")).toBe("app");
  });

  it("?debrief が ?editor より優先", () => {
    expect(resolveLaunchMode("?debrief&editor")).toBe("debrief");
    expect(resolveLaunchMode("?editor&debrief=late")).toBe("debrief");
  });

  it("?app=0・?debrief=0 なら ?editor が効く", () => {
    expect(resolveLaunchMode("?app=0&editor")).toBe("editor");
    expect(resolveLaunchMode("?debrief=0&editor")).toBe("editor");
    expect(resolveLaunchMode("?app=false&debrief=0&editor")).toBe("editor");
  });
});

describe("resolveLaunchMode（避難の音の単独起動 ?audio）", () => {
  it.each(["?audio", "?audio=1", "?audio=true", "?scene=room&audio"])("%s は音の確認", (search) => {
    expect(resolveLaunchMode(search)).toBe("audio");
  });

  it.each(["?audio=0", "?audio=false", "?audio=FALSE"])("%s だけならホーム画面", (search) => {
    expect(resolveLaunchMode(search)).toBe("home");
  });

  it("?app・?debrief が ?audio より優先", () => {
    expect(resolveLaunchMode("?audio&app")).toBe("app");
    expect(resolveLaunchMode("?audio&debrief")).toBe("debrief");
  });

  it("?audio が ?editor より優先", () => {
    expect(resolveLaunchMode("?editor&audio")).toBe("audio");
    expect(resolveLaunchMode("?audio=0&editor")).toBe("editor");
  });
});

describe("resolveLaunchMode（教員用の見守り画面 ?monitor）", () => {
  it.each(["?monitor", "?monitor=1", "?monitor=true", "?scene=room&monitor"])(
    "%s は見守り画面",
    (search) => {
      expect(resolveLaunchMode(search)).toBe("monitor");
    },
  );

  it.each(["?monitor=0", "?monitor=false", "?monitor=FALSE"])("%s だけならホーム画面", (search) => {
    expect(resolveLaunchMode(search)).toBe("home");
  });

  it.each<[string, string]>([
    ["?app&monitor", "app"],
    ["?monitor&app=1", "app"],
    ["?debrief&monitor", "debrief"],
    ["?monitor&debrief=late", "debrief"],
    ["?editor&monitor", "editor"],
    ["?monitor&editor", "editor"],
    ["?app&debrief&editor&monitor", "app"],
    ["?audio&monitor", "audio"],
    ["?monitor&audio=1", "audio"],
    ["?audio=0&monitor", "monitor"],
  ])("%s は ?app・?debrief・?audio・?editor が優先されて %s", (search, expected) => {
    expect(resolveLaunchMode(search)).toBe(expected);
  });

  it("?app=0・?debrief=0・?editor=0 なら ?monitor が効く", () => {
    expect(resolveLaunchMode("?app=0&monitor")).toBe("monitor");
    expect(resolveLaunchMode("?debrief=0&monitor")).toBe("monitor");
    expect(resolveLaunchMode("?editor=false&monitor")).toBe("monitor");
    expect(resolveLaunchMode("?app=0&debrief=0&editor=0&monitor")).toBe("monitor");
  });
});

describe("resolveLaunchMode（教員用のホーム画面と開発用のビューア）", () => {
  it.each(["", "?", "?stereo=1", "?debug", "?foo=bar", "?home"])(
    "%s は起動のパラメータが無いのでホーム画面",
    (search) => {
      expect(resolveLaunchMode(search)).toBe("home");
    },
  );

  it.each([
    "?app=0&debrief=0&audio=0&editor=0&monitor=0",
    "?app=false&editor=FALSE&viewer=0",
    "?viewer=0",
    "?viewer=false",
    "?viewer=FALSE",
  ])("%s は無効なパラメータだけなのでホーム画面", (search) => {
    expect(resolveLaunchMode(search)).toBe("home");
  });

  it.each(["?viewer", "?viewer=1", "?viewer=true", "?viewer=abc"])("%s はビューア", (search) => {
    expect(resolveLaunchMode(search)).toBe("viewer");
  });

  it.each([
    "?scene=train",
    "?scene=room",
    "?input=mock",
    "?input=device",
    "?scene=train&input=mock",
    "?scene=",
    "?input=",
    "?scene",
    "?scene=0",
    "?scene=false",
    "?input=0",
    "?viewer=0&scene=train",
  ])("%s は値に関係なくビューア（開発の URL）", (search) => {
    expect(resolveLaunchMode(search)).toBe("viewer");
  });

  it.each<[string, string]>([
    ["?editor&viewer", "editor"],
    ["?viewer&editor", "editor"],
    ["?editor&scene=train", "editor"],
    ["?monitor&scene=x", "monitor"],
    ["?monitor&viewer", "monitor"],
    ["?audio&input=mock", "audio"],
    ["?debrief&viewer", "debrief"],
    ["?app&viewer", "app"],
    ["?app=0&scene=x", "viewer"],
    ["?editor=0&viewer", "viewer"],
    ["?app=0&debrief=0&audio=0&editor=0&monitor=0&input=mock", "viewer"],
  ])(
    "%s は優先順位（app → debrief → audio → editor → monitor → viewer）に従って %s",
    (search, expected) => {
      expect(resolveLaunchMode(search)).toBe(expected);
    },
  );
});

describe("resolveDemo（デモ用の起動 ?app&demo．Issue #181）", () => {
  it.each(["", "?app", "?app&debug"])("%s は無効", (search) => {
    expect(resolveDemo(search)).toBe(false);
  });

  it.each(["?demo", "?app&demo", "?app&demo=1", "?demo=yes"])("%s は有効", (search) => {
    expect(resolveDemo(search)).toBe(true);
  });

  it.each(["?app&demo=0", "?demo=false", "?demo=FALSE", "?demo=False"])("%s は無効", (search) => {
    expect(resolveDemo(search)).toBe(false);
  });

  it.each(["?demo", "?demo=0", "?demo=false", "?demo=FALSE", "?demo=1", ""])(
    "%s は resolveDebug と同じ規則",
    (search) => {
      expect(resolveDemo(search)).toBe(resolveDebug(search.replace("demo", "debug")));
    },
  );
});
