// PC モードの判定・URL・開始の向きのテスト（Issue #205）
import { describe, expect, it } from "vitest";
import { resolveLaunchMode } from "./launchMode";
import {
  buildPcModeHref,
  buildTopHref,
  PC_CONTROLS_LINES,
  PC_HOME_LABEL,
  resolvePcMode,
  routeFacingYaw,
} from "./pcMode";

const cell = (x: number, z: number, floor = 0) => ({ floor, x, z });

describe("resolvePcMode", () => {
  it.each<[string, boolean]>([
    ["?app&pc", true],
    ["?app&pc=1", true],
    ["?app&pc=0", false],
    ["?app&pc=FALSE", false],
    ["?app", false],
    // 入力だけを PC にした開発用の流れは PC モードにしない
    ["?app&input=mock", false],
  ])("%s は %s", (search, expected) => {
    expect(resolvePcMode(search)).toBe(expected);
  });
});

describe("buildPcModeHref", () => {
  it("?app に pc を足し，ハッシュ（校舎・部屋）を保つ", () => {
    const href = buildPcModeHref("/", "?app", "#p=abc&room=r1");
    expect(href).toBe("/?app&pc#p=abc&room=r1");
    const search = href.slice(href.indexOf("?"), href.indexOf("#"));
    expect(resolveLaunchMode(search)).toBe("app");
    expect(resolvePcMode(search)).toBe(true);
  });

  it("input= は外し，他のパラメータは保つ", () => {
    expect(buildPcModeHref("/sub/", "?app&input=device&debug", "")).toBe("/sub/?app&debug&pc");
  });
});

describe("buildTopHref", () => {
  it.each<[string, string]>([
    ["/", "/"],
    ["", "/"],
    ["/sub/", "/sub/"],
  ])("パス %j のトップは %s", (pathname, expected) => {
    expect(buildTopHref(pathname)).toBe(expected);
  });
});

describe("routeFacingYaw", () => {
  it("経路が -Z（エディタの上）へ進むなら 0", () => {
    expect(routeFacingYaw(cell(2, 5), [cell(2, 5), cell(2, 4), cell(2, 3), cell(2, 2)])).toBe(0);
  });

  it("経路が +X へ進むなら右を向く（-π/2）", () => {
    const yaw = routeFacingYaw(cell(0, 0), [cell(0, 0), cell(1, 0), cell(2, 0), cell(3, 0)]);
    expect(yaw).toBeCloseTo(-Math.PI / 2);
  });

  it("経路が短い時は最後のマスを向く（+Z なら π）", () => {
    const yaw = routeFacingYaw(cell(0, 0), [cell(0, 0), cell(0, 1)]);
    expect(Math.abs(yaw ?? 0)).toBeCloseTo(Math.PI);
  });

  it("向けるマスが無い時は null", () => {
    expect(routeFacingYaw(cell(0, 0), [])).toBeNull();
    expect(routeFacingYaw(cell(0, 0), [cell(0, 0)])).toBeNull();
    expect(routeFacingYaw(cell(0, 0), [cell(0, 0), cell(1, 0, 1)])).toBeNull();
  });
});

// ここから下は Issue #205 の仕様の観点（境界値・異常値）を補うテスト
describe("resolvePcMode（境界値）", () => {
  it.each<[string, boolean]>([
    ["", false],
    ["?", false],
    ["?app&pc=false", false],
    ["?app&pc=False", false],
    ["?app&pc=true", true],
    ["?app&demo&pc", true],
    ["?app&pc&demo", true],
    // input= が残っていても pc が付いていれば PC モード
    ["?app&pc&input=device", true],
    // 名前が似ているだけのパラメータは PC モードにしない
    ["?app&pcx", false],
    ["?app&npc", false],
  ])("%j は %s", (search, expected) => {
    expect(resolvePcMode(search)).toBe(expected);
  });
});

describe("buildPcModeHref（境界値）", () => {
  it.each<[string, string, string, string]>([
    ["/", "?app&input=mock", "", "/?app&pc"],
    ["/", "?app&input=device", "#p=xyz", "/?app&pc#p=xyz"],
    ["/", "?app&input=mock&input=device", "", "/?app&pc"],
    ["/", "?app&demo", "", "/?app&demo&pc"],
    ["/", "?app&demo&input=mock", "#p=a-b_c&room=r9", "/?app&demo&pc#p=a-b_c&room=r9"],
    ["/", "?app&room=r1", "#p=abc", "/?app&room=r1&pc#p=abc"],
    ["", "?app", "", "/?app&pc"],
    ["/sub/index.html", "?app", "#room=r2", "/sub/index.html?app&pc#room=r2"],
  ])("パス %j・%j・%j から %s を作る", (pathname, search, hash, expected) => {
    expect(buildPcModeHref(pathname, search, hash)).toBe(expected);
  });

  it.each<[string]>([["?app&pc"], ["?app&pc=0"], ["?app&pc=false"], ["?app&pc=1"]])(
    "すでに pc がある %j からは pc を 1 つだけ持ち PC モードになる URL を作る",
    (search) => {
      const href = buildPcModeHref("/", search, "");
      const query = href.slice(href.indexOf("?"));
      expect(new URLSearchParams(query).getAll("pc")).toHaveLength(1);
      expect(resolvePcMode(query)).toBe(true);
    },
  );

  it.each<[string, string]>([
    ["?app", "#p=abc&room=r1"],
    ["?app&input=mock", "#p=abc"],
    ["?app&input=device&demo", "#room=r1"],
    ["?app&demo", ""],
  ])(
    "%j%s から作った URL は input= を持たず，体験の流れの PC モードで開き，ハッシュはそのまま",
    (search, hash) => {
      const href = buildPcModeHref("/", search, hash);
      const hashIndex = href.indexOf("#");
      const query = href.slice(href.indexOf("?"), hashIndex === -1 ? undefined : hashIndex);
      expect(new URLSearchParams(query).has("input")).toBe(false);
      expect(resolveLaunchMode(query)).toBe("app");
      expect(resolvePcMode(query)).toBe(true);
      expect(hashIndex === -1 ? "" : href.slice(hashIndex)).toBe(hash);
    },
  );
});

describe("PC_CONTROLS_LINES・PC_HOME_LABEL", () => {
  it("操作の説明に歩く（W／↑）・しゃがむ（C）・見回す（ドラッグ）がある", () => {
    const text = PC_CONTROLS_LINES.join("\n");
    expect(text).toMatch(/W/);
    expect(text).toMatch(/↑/);
    expect(text).toMatch(/歩く/);
    expect(text).toMatch(/C/);
    expect(text).toMatch(/しゃが/);
    expect(text).toMatch(/ドラッグ/);
    expect(text).toMatch(/見回す/);
  });

  it("操作の説明と「トップへ」にセンサー・ゴーグル・手のひらの文言が無い", () => {
    for (const line of [...PC_CONTROLS_LINES, PC_HOME_LABEL]) {
      expect(line).not.toBe("");
      expect(line).not.toMatch(/センサー|ゴーグル|手のひら|かざ/);
    }
  });

  it("PC の結果画面のホームへのボタンは「トップへ」", () => {
    expect(PC_HOME_LABEL).toBe("トップへ");
  });
});

describe("routeFacingYaw（向きの約束と境界値）", () => {
  // 向き yaw で前を向いた時の XZ の向き（0 で -Z，正で左へ回る）
  const forward = (yaw: number) => ({ x: -Math.sin(yaw), z: -Math.cos(yaw) });

  it.each<[string, number, number, number]>([
    ["-Z（前）", 0, -3, 0],
    ["+X（右）", 3, 0, -Math.PI / 2],
    ["-X（左）", -3, 0, Math.PI / 2],
    ["+X・-Z の斜め", 3, -3, -Math.PI / 4],
    ["-X・-Z の斜め", -3, -3, Math.PI / 4],
  ])("経路が %s へ進むなら %s", (_name, dx, dz, expected) => {
    const start = cell(5, 5);
    const route = [start, cell(5 + dx, 5 + dz)];
    expect(routeFacingYaw(start, route)).toBeCloseTo(expected);
  });

  it.each<[number, number]>([
    [1, 0],
    [1, -2],
    [-2, 1],
    [0, 4],
    [-1, -1],
    [3, 7],
  ])("向いた前の向きは目印のマス（差 %i, %i）を指す", (dx, dz) => {
    const yaw = routeFacingYaw(cell(0, 0), [cell(0, 0), cell(dx, dz)]);
    expect(yaw).not.toBeNull();
    const f = forward(yaw as number);
    const len = Math.hypot(dx, dz);
    expect(f.x).toBeCloseTo(dx / len);
    expect(f.z).toBeCloseTo(dz / len);
  });

  it("既定では開始地点から 3 マス先を向く（隣のマスではない）", () => {
    // 1 マス目は -Z，3 マス目は曲がった先（+X・-Z）
    const route = [cell(0, 0), cell(0, -1), cell(0, -2), cell(1, -2), cell(2, -2)];
    expect(routeFacingYaw(cell(0, 0), route)).toBeCloseTo(Math.atan2(-1, 2));
  });

  it("lookahead を 1 にすると隣のマスを向く", () => {
    const route = [cell(0, 0), cell(1, 0), cell(1, -1), cell(1, -2)];
    expect(routeFacingYaw(cell(0, 0), route, 1)).toBeCloseTo(-Math.PI / 2);
  });

  it("経路の途中で別の階へ移っても，同じ階のマスだけを数える", () => {
    const route = [cell(0, 0), cell(0, 0, 1), cell(5, 0, 1), cell(0, -1), cell(0, -2)];
    expect(routeFacingYaw(cell(0, 0), route)).toBe(0);
  });

  it("開始地点が経路の上に無くても，経路のマスを向く", () => {
    const yaw = routeFacingYaw(cell(5, 5), [cell(5, 3), cell(5, 2)]);
    expect(yaw).toBe(0);
  });

  it("-0 を返さない（前を向く時は 0）", () => {
    const yaw = routeFacingYaw(cell(0, 0), [cell(0, 0), cell(0, -1)]);
    expect(Object.is(yaw, 0)).toBe(true);
  });

  it("経路のうち座標が壊れたマス（NaN・Infinity）は数えない", () => {
    const route = [cell(0, 0), cell(Number.NaN, 0), cell(0, Number.POSITIVE_INFINITY), cell(0, -1)];
    expect(routeFacingYaw(cell(0, 0), route)).toBe(0);
  });

  it.each<
    [string, { floor: number; x: number; z: number }, { floor: number; x: number; z: number }[]]
  >([
    ["経路が空", cell(0, 0), []],
    ["経路が開始地点の 1 マスだけ", cell(0, 0), [cell(0, 0)]],
    ["経路が別の 1 マスだけ", cell(0, 0), [cell(2, 0)]],
    ["経路が開始地点の繰り返し", cell(1, 1), [cell(1, 1), cell(1, 1)]],
    ["経路が別の階だけ", cell(0, 0), [cell(1, 0, 1), cell(2, 0, 1)]],
    ["開始地点が NaN", cell(Number.NaN, 0), [cell(0, 0), cell(1, 0)]],
    ["開始地点が Infinity", cell(0, Number.POSITIVE_INFINITY), [cell(0, 0), cell(1, 0)]],
    ["経路のマスがすべて NaN", cell(0, 0), [cell(Number.NaN, Number.NaN)]],
  ])("%s の時も NaN を返さない（有限の数か null）", (_name, start, route) => {
    const yaw = routeFacingYaw(start, route);
    if (yaw !== null) {
      expect(Number.isFinite(yaw)).toBe(true);
      expect(Math.abs(yaw)).toBeLessThanOrEqual(Math.PI);
    }
  });

  it.each<[number]>([[0], [-5], [Number.NaN], [Number.POSITIVE_INFINITY], [2.7], [100]])(
    "lookahead が %s でも NaN を返さない",
    (lookahead) => {
      const route = [cell(0, 0), cell(1, 0), cell(2, 0), cell(3, 0)];
      const yaw = routeFacingYaw(cell(0, 0), route, lookahead);
      if (yaw !== null) {
        expect(Number.isFinite(yaw)).toBe(true);
        expect(yaw).toBeCloseTo(-Math.PI / 2);
      }
    },
  );

  it("経路が空・1 マスだけの時は向けるマスが無いので null（校舎データの開始の向きのまま）", () => {
    expect(routeFacingYaw(cell(3, 3), [])).toBeNull();
    expect(routeFacingYaw(cell(3, 3), [cell(3, 3)])).toBeNull();
  });
});
