// encodePlan・decodePlan（SchoolPlan と URL の埋め込みデータの変換）のテスト．
// 基準は docs/04_SPEC/SPEC_02「URL と QR への埋め込み」（JSON の cells は 1 マス 1 文字・roomOf はランレングス →
// CompressionStream("deflate-raw") → base64url．読み込み時は逆の順に戻して validatePlan で確かめる）・「長さの上限」
// （1 フロア 60×30 マスの想定の校舎で URL 全体 1,500 文字まで）・「方針」（読めない版は新しい版で開くよう案内する）と Issue #84
// （壊れた文字列・未知の version は理由つきの失敗として返し，例外で落とさない）．
// CompressionStream は Node の同じ API を使う
import { describe, expect, expectTypeOf, it } from "vitest";
import type { Session } from "../core/scene";
import type {
  CellKind,
  CellRef,
  PlanLoadError,
  PlanLoadFailureKind,
  SchoolPlan,
} from "../core/schoolPlan";
import {
  type DecodePlanFailureKind,
  type DecodePlanResult,
  decodePlan,
  encodePlan,
} from "./planCodec";
import { DEMO_SCHOOL } from "./samples/demoSchool";
import { validatePlan } from "./validatePlan";

/** 配信先を含めた URL の前半（SPEC_02「形式」．staging を例にする） */
const URL_PREFIX = "https://staging.tkb2608.pages.dev/?app#p=";
/** QR に載せる URL 全体の長さの目安（文字．SPEC_02「長さの上限」） */
const URL_LENGTH_LIMIT = 1500;

const at = (x: number, z: number, floor = 0): CellRef => ({ floor, x, z });

/** 種付きの乱数（mulberry32） */
function seeded(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * SPEC_02「長さの上限」が想定する校舎（1 フロア 60×30 マス．教室 6 つと廊下）．
 * z = 0〜10 が教室（幅 10 マスずつ．z = 10 の x % 10 === 3 がドア），z = 11〜13 が廊下（z = 13 の x = 2・57 が昇降口），z = 14〜29 が校庭．
 * longRoute で東端の教室から西の昇降口まで廊下を歩く長い経路にする
 */
function schoolOf60x30(options: { readonly longRoute?: boolean } = {}): SchoolPlan {
  const width = 60;
  const depth = 30;
  const cells: CellKind[] = [];
  const roomOf: number[] = [];
  for (let z = 0; z < depth; z++) {
    for (let x = 0; x < width; x++) {
      let kind: CellKind;
      if (z <= 9) kind = "classroom";
      else if (z === 10) kind = x % 10 === 3 ? "door" : "classroom";
      else if (z <= 13) kind = z === 13 && (x === 2 || x === 57) ? "exit" : "corridor";
      else kind = "outdoor";
      cells.push(kind);
      roomOf.push(kind === "classroom" ? Math.floor(x / 10) : -1);
    }
  }
  const startX = options.longRoute ? 53 : 3;
  const route: CellRef[] = [];
  for (let z = 5; z <= 10; z++) route.push(at(startX, z));
  for (let x = startX; x >= 2; x--) route.push(at(x, 11));
  route.push(at(2, 12), at(2, 13));
  for (let z = 14; z <= 20; z++) route.push(at(2, z));
  return {
    version: 1,
    name: "想定の小学校 南校舎",
    cellSize: 1,
    floors: [{ level: 1, width, depth, cells, roomOf }],
    rooms: ["1年1組", "1年2組", "2年1組", "2年2組", "3年1組", "理科室"].map((name) => ({ name })),
    drill: {
      mode: "learn",
      fireOrigins: [options.longRoute ? at(5, 5) : at(55, 5)],
      start: at(startX, 5),
      startYaw: 0,
      assembly: [at(2, 20), at(3, 20), at(2, 21), at(3, 21)],
      route,
      spread: { fireSecondsPerCell: 6, smokeSecondsPerCell: 2, extraFires: [] },
      timeLimitSeconds: 150,
    },
  };
}

/** 2 階建て・テストモード・追加の延焼箇所あり・小数や記号を含む名前の校舎（デモの 1 階を 2 階にも複製する） */
function twoFloorTestPlan(): SchoolPlan {
  const floor = DEMO_SCHOOL.floors[0];
  return {
    ...DEMO_SCHOOL,
    name: 'テスト用 "中学校" 東館\\2F 😀',
    cellSize: 1.25,
    floors: [floor, { ...floor, level: 2 }],
    rooms: [{ name: "1年1組" }, { name: "" }, { name: "理科室 <実験>" }],
    drill: {
      ...DEMO_SCHOOL.drill,
      mode: "test",
      fireOrigins: [at(16, 2), at(14, 1, 1)],
      startYaw: 1.5707963267948966,
      spread: {
        fireSecondsPerCell: 4.5,
        smokeSecondsPerCell: 1.5,
        extraFires: [
          { cell: at(14, 6), atSeconds: 0 },
          { cell: at(3, 3, 1), atSeconds: 42.25 },
        ],
      },
      timeLimitSeconds: 180,
    },
  };
}

/** バイト列を deflate-raw で圧縮して base64url にする（仕様の 2・3 をテストの中で書き写したもの．細工した入力を作るために使う） */
async function deflateToBase64Url(bytes: Uint8Array): Promise<string> {
  const stream = new Blob([bytes as Uint8Array<ArrayBuffer>])
    .stream()
    .pipeThrough(new CompressionStream("deflate-raw"));
  const compressed = new Uint8Array(await new Response(stream).arrayBuffer());
  let binary = "";
  for (const b of compressed) binary += String.fromCharCode(b);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
const embedText = (text: string): Promise<string> =>
  deflateToBase64Url(new TextEncoder().encode(text));
const embedJson = (value: unknown): Promise<string> => embedText(JSON.stringify(value));

/** 埋め込みデータを仕様の逆の順（base64url → deflate-raw の展開）で JSON に戻す */
async function inflateEmbedded(text: string): Promise<unknown> {
  const binary = atob(text.replace(/-/g, "+").replace(/_/g, "/"));
  const bytes = Uint8Array.from(binary, (c) => c.charCodeAt(0));
  const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream("deflate-raw"));
  return JSON.parse(await new Response(stream).text());
}

type EncodedJson = {
  version: unknown;
  name: unknown;
  cellSize: unknown;
  floors: { level: unknown; width: unknown; depth: unknown; cells: unknown; roomOf: unknown }[];
  rooms: unknown;
  drill: Record<string, unknown>;
};

/** デモの校舎を encodePlan した後の JSON（細工の元にする） */
async function demoJson(): Promise<EncodedJson> {
  return (await inflateEmbedded(await encodePlan(DEMO_SCHOOL))) as EncodedJson;
}

const expectFailure = (result: DecodePlanResult, kind: string): void => {
  expect(result.ok).toBe(false);
  if (result.ok) return;
  expect(result.kind).toBe(kind);
  expect(typeof result.reason).toBe("string");
  expect(result.reason.length).toBeGreaterThan(0);
};

describe("encodePlan → decodePlan の往復", () => {
  it.each<[string, () => SchoolPlan]>([
    ["デモの校舎", () => DEMO_SCHOOL],
    ["60×30 の想定の校舎", () => schoolOf60x30()],
    ["60×30 の想定の校舎（長い経路）", () => schoolOf60x30({ longRoute: true })],
    ["2 階建て・テストモード・追加の延焼箇所あり", twoFloorTestPlan],
  ])("%s は元の SchoolPlan と等しく戻る", async (_label, make) => {
    const plan = make();
    expect(validatePlan(plan)).toEqual([]);
    const result = await decodePlan(await encodePlan(plan));
    expect(result).toEqual({ ok: true, plan });
  });

  it("8 種類すべてのマスと，横に長く続かない教室の割り当てでも戻る", async () => {
    // 1 行目: 教室 0・1 が交互（ランレングスが 1 ずつになる），2 行目: 全種類，3 行目: 屋外
    const cells: CellKind[] = [
      ...(["classroom", "classroom", "classroom", "classroom", "classroom", "classroom"] as const),
      ...(["corridor", "door", "wall", "void", "shutter", "exit"] as const),
      ...(["outdoor", "outdoor", "outdoor", "outdoor", "outdoor", "outdoor"] as const),
    ];
    const roomOf = [0, 1, 0, 1, 0, 1, ...Array<number>(12).fill(-1)];
    const plan: SchoolPlan = {
      version: 1,
      name: "全種類",
      cellSize: 1,
      floors: [{ level: 1, width: 6, depth: 3, cells, roomOf }],
      rooms: [{ name: "A" }, { name: "B" }],
      drill: {
        mode: "learn",
        fireOrigins: [at(1, 0)],
        start: at(0, 0),
        startYaw: 0,
        assembly: [at(0, 2)],
        route: [at(0, 0), at(0, 1), at(0, 2)],
        spread: { fireSecondsPerCell: 6, smokeSecondsPerCell: 2, extraFires: [] },
        timeLimitSeconds: 150,
      },
    };
    expect(validatePlan(plan)).toEqual([]);
    expect(await decodePlan(await encodePlan(plan))).toEqual({ ok: true, plan });
  });

  it("同じ校舎を何度 encode しても，どれも元に戻る", async () => {
    for (let i = 0; i < 3; i++) {
      const result = await decodePlan(await encodePlan(DEMO_SCHOOL));
      expect(result).toEqual({ ok: true, plan: DEMO_SCHOOL });
    }
  });
});

describe("encodePlan の出力", () => {
  it.each<[string, () => SchoolPlan]>([
    ["デモの校舎", () => DEMO_SCHOOL],
    ["60×30 の想定の校舎", () => schoolOf60x30()],
    ["2 階建て", twoFloorTestPlan],
  ])("%s: base64url の文字だけで，= を含まない", async (_label, make) => {
    const text = await encodePlan(make());
    expect(text.length).toBeGreaterThan(0);
    expect(text).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(text).not.toContain("=");
    // URL のフラグメントに置いても書き換わらない（エスケープが要らない）
    expect(new URL(`${URL_PREFIX}${text}`).hash).toBe(`#p=${text}`);
  });

  it("deflate-raw で展開すると，cells は 1 マス 1 文字の文字列・roomOf は [値, 続く数, …] の JSON になる", async () => {
    const json = await demoJson();
    const floor = DEMO_SCHOOL.floors[0];
    expect(json.floors).toHaveLength(1);
    const encoded = json.floors[0];
    expect(typeof encoded.cells).toBe("string");
    // SPEC_02 の表の書き写し
    const table: Record<CellKind, string> = {
      void: ".",
      classroom: "c",
      corridor: "h",
      wall: "#",
      door: "d",
      exit: "e",
      shutter: "s",
      outdoor: "o",
    };
    expect(encoded.cells).toBe(floor.cells.map((kind) => table[kind]).join(""));
    // ランレングスを広げると元の roomOf になる
    const runs = encoded.roomOf as number[];
    expect(runs.length % 2).toBe(0);
    const expanded: number[] = [];
    for (let i = 0; i < runs.length; i += 2) {
      for (let k = 0; k < runs[i + 1]; k++) expanded.push(runs[i]);
    }
    expect(expanded).toEqual(floor.roomOf);
    // 元の配列よりずっと短い（同じ値が横に長く続くため）
    expect(runs.length).toBeLessThan(floor.roomOf.length / 2);
    expect(encoded.level).toBe(floor.level);
    expect(encoded.width).toBe(floor.width);
    expect(encoded.depth).toBe(floor.depth);
    expect(json.version).toBe(1);
    expect(json.name).toBe(DEMO_SCHOOL.name);
    expect(json.cellSize).toBe(DEMO_SCHOOL.cellSize);
    expect(json.rooms).toEqual(DEMO_SCHOOL.rooms);
    expect(json.drill).toEqual(DEMO_SCHOOL.drill);
  });

  it.each<[string, () => SchoolPlan]>([
    ["デモの校舎", () => DEMO_SCHOOL],
    ["60×30 の想定の校舎", () => schoolOf60x30()],
    ["60×30 の想定の校舎（長い経路）", () => schoolOf60x30({ longRoute: true })],
  ])("%s: URL 全体が 1,500 文字の目安に収まる", async (_label, make) => {
    const text = await encodePlan(make());
    expect(`${URL_PREFIX}${text}`.length).toBeLessThanOrEqual(URL_LENGTH_LIMIT);
  });
});

describe("decodePlan（壊れた入力）", () => {
  it.each<[string, string]>([
    ["空の文字列", ""],
    ["base64url に無い文字（!）", "!!!!"],
    ["末尾の =", "AAAA="],
    ["標準の base64 の + と /", "ab+/cd"],
    ["空白", "AAAA AAAA"],
    ["日本語", "校舎のデータ"],
    ["長さが 4 で割って 1 余る", "A"],
    ["deflate として読めないバイト列", "____________"],
    ["0 だけのバイト列", "AAAA"],
  ])("%s は例外を投げず corrupted を返す", async (_label, text) => {
    expectFailure(await decodePlan(text), "corrupted");
  });

  it("途中で欠けたデータ（後ろを切った）は例外を投げず corrupted を返す", async () => {
    const text = await encodePlan(DEMO_SCHOOL);
    for (const cut of [1, 2, 3, 4, 10, Math.floor(text.length / 2), text.length - 1]) {
      expectFailure(await decodePlan(text.slice(0, text.length - cut)), "corrupted");
    }
  });

  it("前を切ったデータは例外を投げず失敗を返す", async () => {
    const text = await encodePlan(DEMO_SCHOOL);
    for (const cut of [1, 4, 8]) {
      const result = await decodePlan(text.slice(cut));
      expect(result.ok).toBe(false);
    }
  });

  it("どこか 1 文字を書き換えても例外を投げない（成功するなら中身は validatePlan を通る）", async () => {
    const text = await encodePlan(DEMO_SCHOOL);
    const random = seeded(84);
    const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";
    for (let trial = 0; trial < 100; trial++) {
      const i = Math.floor(random() * text.length);
      const ch = alphabet[Math.floor(random() * alphabet.length)];
      const broken = text.slice(0, i) + ch + text.slice(i + 1);
      const result = await decodePlan(broken);
      if (result.ok) {
        expect(validatePlan(result.plan)).toEqual([]);
      } else {
        expect(["corrupted", "unsupportedVersion", "invalidPlan"]).toContain(result.kind);
        expect(result.reason.length).toBeGreaterThan(0);
      }
    }
  });

  it.each<[string, string]>([
    ["JSON でない文字列", "not json"],
    ["途中で切れた JSON", '{"version":1,"name":"a'],
    ["空の文字列を圧縮したもの", ""],
  ])("展開できても %s は corrupted", async (_label, text) => {
    expectFailure(await decodePlan(await embedText(text)), "corrupted");
  });

  it("UTF-8 として読めないバイト列は corrupted", async () => {
    expectFailure(
      await decodePlan(await deflateToBase64Url(Uint8Array.from([0xff, 0xfe, 0x7b, 0x7d]))),
      "corrupted",
    );
  });

  it.each<[string, unknown]>([
    ["null", null],
    ["数", 1],
    ["配列", [1, 2]],
    ["文字列", "plan"],
    ["版だけ", { version: 1 }],
    ["空のオブジェクト", {}],
  ])("JSON の形が違う（%s）は corrupted", async (_label, value) => {
    expectFailure(await decodePlan(await embedJson(value)), "corrupted");
  });

  it.each<[string, (json: EncodedJson) => void]>([
    ["名前が数", (j) => (j.name = 1)],
    ["マスの大きさが文字列", (j) => (j.cellSize = "1")],
    ["マスの大きさが null（NaN を JSON にした形）", (j) => (j.cellSize = null)],
    ["階が配列でない", (j) => (j.floors = {} as EncodedJson["floors"])],
    ["教室の一覧が無い", (j) => delete (j as Partial<EncodedJson>).rooms],
    ["教室の名前が数", (j) => (j.rooms = [{ name: 1 }])],
    ["訓練条件が無い", (j) => delete (j as Partial<EncodedJson>).drill],
    ["マスが文字列でなく配列", (j) => (j.floors[0].cells = ["h"])],
    ["マスに表に無い文字", (j) => (j.floors[0].cells = `x${String(j.floors[0].cells).slice(1)}`)],
    [
      "マスの数が width * depth と違う",
      (j) => (j.floors[0].cells = String(j.floors[0].cells).slice(1)),
    ],
    ["幅が文字列", (j) => (j.floors[0].width = "19")],
    ["roomOf が配列でない", (j) => (j.floors[0].roomOf = "0")],
    [
      "roomOf のランレングスの合計がマスの数より 1 少ない",
      (j) => {
        const runs = j.floors[0].roomOf as number[];
        runs[runs.length - 1] -= 1;
      },
    ],
    [
      "roomOf のランレングスの合計がマスの数より 1 多い",
      (j) => {
        const runs = j.floors[0].roomOf as number[];
        runs[runs.length - 1] += 1;
      },
    ],
    ["roomOf のランレングスが奇数個", (j) => (j.floors[0].roomOf = [-1])],
    ["roomOf のランレングスが空", (j) => (j.floors[0].roomOf = [])],
    ["roomOf の続く数が 0", (j) => (j.floors[0].roomOf = [0, 0, -1, 247])],
    ["roomOf の続く数が負", (j) => (j.floors[0].roomOf = [-1, -1, -1, 248])],
    ["roomOf の続く数が小数", (j) => (j.floors[0].roomOf = [-1, 123.5, -1, 123.5])],
    ["roomOf の続く数が巨大", (j) => (j.floors[0].roomOf = [-1, 1e12])],
    ["roomOf の値が文字列", (j) => (j.floors[0].roomOf = ["-1", 247])],
    ["モードが知らない値", (j) => (j.drill.mode = "free")],
    ["開始地点が無い", (j) => delete j.drill.start],
    ["開始地点の x が文字列", (j) => (j.drill.start = { floor: 0, x: "2", z: 2 })],
    ["火元が配列でない", (j) => (j.drill.fireOrigins = { floor: 0, x: 16, z: 2 })],
    ["経路の要素が null", (j) => (j.drill.route = [null])],
    ["延焼の設定が無い", (j) => delete j.drill.spread],
    [
      "追加の延焼箇所の時刻が文字列",
      (j) =>
        (j.drill.spread = {
          fireSecondsPerCell: 6,
          smokeSecondsPerCell: 2,
          extraFires: [{ cell: { floor: 0, x: 14, z: 6 }, atSeconds: "0" }],
        }),
    ],
    ["制限時間が null（Infinity を JSON にした形）", (j) => (j.drill.timeLimitSeconds = null)],
    ["開始時の向きが null", (j) => (j.drill.startYaw = null)],
  ])("形が違う（%s）は例外を投げず corrupted", async (_label, mutate) => {
    const json = await demoJson();
    mutate(json);
    expectFailure(await decodePlan(await embedJson(json)), "corrupted");
  });

  it("展開すると 1 MiB を大きく超える（圧縮爆弾）データは corrupted", async () => {
    // 同じ文字の繰り返しは数 KB に縮むが，展開すると 8 MB になる
    const huge = `{"version":1,"name":"${"a".repeat(8 * 1024 * 1024)}"}`;
    const text = await embedText(huge);
    expect(`${URL_PREFIX}${text}`.length).toBeLessThan(20_000);
    expectFailure(await decodePlan(text), "corrupted");
  });

  it("形は正しいが，マスが巨大（展開後 1 MiB 超）な校舎は corrupted", async () => {
    const json = await demoJson();
    const width = 2000;
    const depth = 1000;
    json.floors[0] = {
      level: 1,
      width,
      depth,
      cells: "o".repeat(width * depth),
      roomOf: [-1, width * depth],
    };
    expectFailure(await decodePlan(await embedJson(json)), "corrupted");
  });
});

describe("decodePlan（版）", () => {
  it.each([2, 3, 100, 1.5])(
    "版が %s（このアプリより新しい）は unsupportedVersion で，新しい版のアプリで開くよう案内する",
    async (version) => {
      const json = await demoJson();
      json.version = version;
      const result = await decodePlan(await embedJson(json));
      expectFailure(result, "unsupportedVersion");
      if (!result.ok) expect(result.reason).toContain("新しい版");
    },
  );

  it("新しい版なら，形が今の版と違っていても unsupportedVersion（形の検査より先に判定する）", async () => {
    const result = await decodePlan(
      await embedJson({ version: 2, floorsV2: "別の形", something: [1, 2, 3] }),
    );
    expectFailure(result, "unsupportedVersion");
  });

  it("encodePlan に版 2 の校舎を渡しても，decodePlan は unsupportedVersion", async () => {
    const result = await decodePlan(await encodePlan({ ...DEMO_SCHOOL, version: 2 as 1 }));
    expectFailure(result, "unsupportedVersion");
  });

  it.each<[string, unknown]>([
    ["0", 0],
    ["負", -1],
    ['文字列の "1"', "1"],
    ["null", null],
  ])(
    "版が %s（読める版ではない）は失敗し unsupportedVersion にはしない",
    async (_label, version) => {
      const json = await demoJson();
      json.version = version;
      const result = await decodePlan(await embedJson(json));
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.kind).not.toBe("unsupportedVersion");
    },
  );

  it("版が無い JSON は失敗し unsupportedVersion にはしない", async () => {
    const json = await demoJson();
    delete (json as Partial<EncodedJson>).version;
    const result = await decodePlan(await embedJson(json));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.kind).not.toBe("unsupportedVersion");
  });
});

describe("decodePlan（中身の誤り）", () => {
  it.each<[string, SchoolPlan]>([
    ["開始地点が廊下", { ...DEMO_SCHOOL, drill: { ...DEMO_SCHOOL.drill, start: at(5, 6) } }],
    ["集合場所が廊下", { ...DEMO_SCHOOL, drill: { ...DEMO_SCHOOL.drill, assembly: [at(5, 6)] } }],
    [
      "経路が開始地点から始まらない",
      { ...DEMO_SCHOOL, drill: { ...DEMO_SCHOOL.drill, route: DEMO_SCHOOL.drill.route.slice(1) } },
    ],
    [
      "経路が隣り合わない",
      {
        ...DEMO_SCHOOL,
        drill: {
          ...DEMO_SCHOOL.drill,
          route: [...DEMO_SCHOOL.drill.route.slice(0, 3), ...DEMO_SCHOOL.drill.route.slice(4)],
        },
      },
    ],
    ["火元が 1 つもない", { ...DEMO_SCHOOL, drill: { ...DEMO_SCHOOL.drill, fireOrigins: [] } }],
    [
      "火元がマス目の外",
      { ...DEMO_SCHOOL, drill: { ...DEMO_SCHOOL.drill, fireOrigins: [at(99, 0)] } },
    ],
    ["マスの大きさが 0", { ...DEMO_SCHOOL, cellSize: 0 }],
    ["教室の一覧が空（教室の添字が範囲外）", { ...DEMO_SCHOOL, rooms: [] }],
  ])("%s は invalidPlan で，理由に validatePlan の最初の誤りが入る", async (_label, plan) => {
    const errors = validatePlan(plan);
    expect(errors.length).toBeGreaterThan(0);
    const result = await decodePlan(await encodePlan(plan));
    expectFailure(result, "invalidPlan");
    if (!result.ok) expect(result.reason).toContain(errors[0]);
  });

  it("誤りが複数あれば，理由に残りの件数が入る", async () => {
    const plan: SchoolPlan = {
      ...DEMO_SCHOOL,
      drill: { ...DEMO_SCHOOL.drill, fireOrigins: [], assembly: [], timeLimitSeconds: 0 },
    };
    const errors = validatePlan(plan);
    expect(errors.length).toBeGreaterThan(1);
    const result = await decodePlan(await encodePlan(plan));
    expectFailure(result, "invalidPlan");
    if (!result.ok) {
      expect(result.reason).toContain(errors[0]);
      expect(result.reason).toContain(String(errors.length - 1));
    }
  });

  it("JSON の階の roomOf を細工して教室以外に教室の割り当てを入れると invalidPlan", async () => {
    const json = await demoJson();
    const floor = DEMO_SCHOOL.floors[0];
    // すべてのマスを教室 0 にする（廊下・屋外にも 0 が付く）
    json.floors[0].roomOf = [0, floor.width * floor.depth];
    expectFailure(await decodePlan(await embedJson(json)), "invalidPlan");
  });
});

describe("decodePlan（知らない項目）", () => {
  it("知らない項目は捨てて，SchoolPlan の項目だけで返す", async () => {
    const json = (await demoJson()) as EncodedJson & Record<string, unknown>;
    json.extra = { secret: "x" };
    (json.floors[0] as Record<string, unknown>).links = [];
    json.drill.note = "メモ";
    (json.drill.start as Record<string, unknown>).label = "教室";
    (json.drill.spread as Record<string, unknown>).wind = 3;
    (json.rooms as Record<string, unknown>[])[0].color = "red";
    const result = await decodePlan(await embedJson(json));
    expect(result).toEqual({ ok: true, plan: DEMO_SCHOOL });
    if (!result.ok) return;
    expect(Object.keys(result.plan).sort()).toEqual(
      ["version", "name", "cellSize", "floors", "rooms", "drill"].sort(),
    );
    expect(result.plan).not.toHaveProperty("extra");
    expect(result.plan.floors[0]).not.toHaveProperty("links");
    expect(result.plan.drill).not.toHaveProperty("note");
    expect(result.plan.drill.start).not.toHaveProperty("label");
    expect(result.plan.drill.spread).not.toHaveProperty("wind");
    expect(result.plan.rooms[0]).not.toHaveProperty("color");
  });

  it("__proto__ を含む JSON でも例外を投げず，返す校舎に混ざらない", async () => {
    const json = JSON.stringify(await demoJson()).replace(/^\{/, '{"__proto__":{"polluted":true},');
    const result = await decodePlan(await embedText(json));
    expect(result.ok).toBe(true);
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
    if (result.ok) expect(result.plan).not.toHaveProperty("polluted");
  });
});

// decodePlan の結果を Session に書けること（SPEC_01「受け渡すデータ」の Session.plan・Issue #86 の
// 「読み込みに失敗した時は失敗の理由を Session に残す」）．app/ が書く口だけを取り出して確かめる
type SessionPlanSlot = Pick<Session, "plan" | "planLoadError">;

/** decodePlan の結果を Session の plan・planLoadError に書く（app/ がする受け渡しをテストの中で書き写したもの） */
const toSessionSlot = (result: DecodePlanResult): SessionPlanSlot => {
  if (result.ok) return { plan: result.plan, planLoadError: null };
  const { ok: _ok, ...error } = result;
  return { plan: null, planLoadError: error };
};

describe("decodePlan の結果と Session", () => {
  it("失敗の型は core の PlanLoadError と同じもので，Session.planLoadError にそのまま入れられる", () => {
    expectTypeOf<DecodePlanFailureKind>().toEqualTypeOf<PlanLoadFailureKind>();
    expectTypeOf<Extract<DecodePlanResult, { ok: false }>>().toExtend<PlanLoadError>();
    expectTypeOf<Session["plan"]>().toEqualTypeOf<SchoolPlan | null>();
    expectTypeOf<Session["planLoadError"]>().toEqualTypeOf<PlanLoadError | null>();
  });

  it("読み込めた時は plan に校舎が入り，planLoadError は null", async () => {
    const slot = toSessionSlot(await decodePlan(await encodePlan(DEMO_SCHOOL)));
    expect(slot.plan).toEqual(DEMO_SCHOOL);
    expect(slot.planLoadError).toBeNull();
  });

  it.each<[PlanLoadFailureKind, () => Promise<string>]>([
    ["corrupted", async () => (await encodePlan(DEMO_SCHOOL)).slice(0, 10)],
    [
      "unsupportedVersion",
      async () => {
        const json = await demoJson();
        json.version = 2;
        return embedJson(json);
      },
    ],
    ["invalidPlan", () => encodePlan({ ...DEMO_SCHOOL, cellSize: 0 })],
  ])(
    "%s の失敗は kind・reason を保ったまま planLoadError に入り，plan は null",
    async (kind, make) => {
      const result = await decodePlan(await make());
      expectFailure(result, kind);
      if (result.ok) return;
      const slot = toSessionSlot(result);
      expect(slot.plan).toBeNull();
      expect(slot.planLoadError).toEqual({ kind, reason: result.reason });
    },
  );
});
