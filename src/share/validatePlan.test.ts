// validatePlan（SchoolPlan の中身の検査）のテスト．
// 基準は docs/04_SPEC/SPEC_02「型」（長さ width * depth・教室以外の roomOf は -1・火元 1 つ以上・開始地点は教室・集合場所は屋外・
// 正解経路は開始地点から集合場所まで上下左右に隣り合うマスの列）・「通れる・燃え広がる」（人は void・wall に入れない）・
// 「URL と QR への埋め込み」（配列の長さ・添字の範囲・開始地点が教室か・集合場所が屋外か・経路が隣り合うマスの列か）．
// 正しい校舎としてデモの校舎（19 × 13）を使い，一部だけを壊して誤りが返ることを確かめる
import { describe, expect, it } from "vitest";
import type {
  CellKind,
  CellRef,
  DrillSetup,
  Floor,
  SchoolPlan,
  SpreadSettings,
} from "../core/schoolPlan";
import { DEMO_SCHOOL } from "./samples/demoSchool";
import { validatePlan } from "./validatePlan";

const at = (x: number, z: number, floor = 0): CellRef => ({ floor, x, z });

/** デモの校舎の一部を上書きした校舎 */
const plan = (overrides: Partial<SchoolPlan> = {}): SchoolPlan => ({
  ...DEMO_SCHOOL,
  ...overrides,
});
const withDrill = (overrides: Partial<DrillSetup>): SchoolPlan =>
  plan({ drill: { ...DEMO_SCHOOL.drill, ...overrides } });
const withSpread = (overrides: Partial<SpreadSettings>): SchoolPlan =>
  withDrill({ spread: { ...DEMO_SCHOOL.drill.spread, ...overrides } });
const demoFloor = DEMO_SCHOOL.floors[0];
const withFloor = (overrides: Partial<Floor>): SchoolPlan =>
  plan({ floors: [{ ...demoFloor, ...overrides }] });
/** デモの 1 階の (x, z) のマスを置き換えた校舎 */
const withCell = (x: number, z: number, kind: CellKind, room = -1): SchoolPlan => {
  const i = z * demoFloor.width + x;
  const cells = [...demoFloor.cells];
  const roomOf = [...demoFloor.roomOf];
  cells[i] = kind;
  roomOf[i] = room;
  return withFloor({ cells, roomOf });
};
const route = DEMO_SCHOOL.drill.route;

describe("validatePlan（正しい校舎）", () => {
  it("デモの校舎は誤りなし（空の配列）", () => {
    expect(validatePlan(DEMO_SCHOOL)).toEqual([]);
  });

  it.each<[string, SchoolPlan]>([
    ["テストモード", withDrill({ mode: "test" })],
    ["負の向き・1 周を超える向き", withDrill({ startYaw: -7.5 })],
    ["小数のマスの大きさ", plan({ cellSize: 0.5 })],
    ["火元が複数", withDrill({ fireOrigins: [at(16, 2), at(14, 0)] })],
    ["火元が教室以外（廊下）のマス", withDrill({ fireOrigins: [at(15, 6)] })],
    [
      "0 秒に燃え始める追加の延焼箇所",
      withSpread({ extraFires: [{ cell: at(14, 6), atSeconds: 0 }] }),
    ],
    [
      "小数の秒数",
      withSpread({
        fireSecondsPerCell: 0.5,
        smokeSecondsPerCell: 0.25,
        extraFires: [{ cell: at(14, 6), atSeconds: 12.5 }],
      }),
    ],
    [
      "煙の発生源（0 秒・小数の秒数）",
      withSpread({
        extraSmokes: [
          { cell: at(6, 6), atSeconds: 0 },
          { cell: at(3, 2), atSeconds: 7.5 },
        ],
      }),
    ],
    ["煙の発生源が空", withSpread({ extraSmokes: [] })],
    ["小数の制限時間", withDrill({ timeLimitSeconds: 0.1 })],
    ["使われていない教室がある", plan({ rooms: [...DEMO_SCHOOL.rooms, { name: "空き教室" }] })],
    [
      "最後のマスが集合場所のどれか（1 つ目でなくてよい）",
      withDrill({ route: [...route, at(9, 10)] }),
    ],
  ])("%s は誤りなし", (_label, p) => {
    expect(validatePlan(p)).toEqual([]);
  });

  it("2 階建て（2 つ目の階の位置を指す追加の延焼箇所）は誤りなし", () => {
    const p = plan({
      floors: [demoFloor, { ...demoFloor, level: 2 }],
      drill: {
        ...DEMO_SCHOOL.drill,
        fireOrigins: [at(16, 2), at(3, 3, 1)],
        spread: { ...DEMO_SCHOOL.drill.spread, extraFires: [{ cell: at(5, 6, 1), atSeconds: 30 }] },
      },
    });
    expect(validatePlan(p)).toEqual([]);
  });

  it("1 × 1 より大きい最小の校舎（教室・ドア・出口・屋外の 1 列）は誤りなし", () => {
    const p: SchoolPlan = {
      version: 1,
      name: "",
      cellSize: 1,
      floors: [
        {
          level: 1,
          width: 4,
          depth: 1,
          cells: ["classroom", "door", "exit", "outdoor"],
          roomOf: [0, -1, -1, -1],
        },
      ],
      rooms: [{ name: "教室" }],
      drill: {
        mode: "learn",
        fireOrigins: [at(0, 0)],
        start: at(0, 0),
        startYaw: 0,
        assembly: [at(3, 0)],
        route: [at(0, 0), at(1, 0), at(2, 0), at(3, 0)],
        spread: { fireSecondsPerCell: 6, smokeSecondsPerCell: 2, extraFires: [] },
        timeLimitSeconds: 150,
      },
    };
    expect(validatePlan(p)).toEqual([]);
  });
});

describe("validatePlan（校舎全体の誤り）", () => {
  it.each<[string, SchoolPlan]>([
    ["版が 2", plan({ version: 2 as 1 })],
    ["版が 0", plan({ version: 0 as 1 })],
    ["マスの大きさが 0", plan({ cellSize: 0 })],
    ["マスの大きさが負", plan({ cellSize: -1 })],
    ["マスの大きさが NaN", plan({ cellSize: Number.NaN })],
    ["マスの大きさが Infinity", plan({ cellSize: Number.POSITIVE_INFINITY })],
    ["階が 1 つもない", plan({ floors: [] })],
  ])("%s は誤り", (_label, p) => {
    expect(validatePlan(p).length).toBeGreaterThan(0);
  });

  it("煙の発生源の誤りは，何番目の発生源かを理由に書く", () => {
    const errors = validatePlan(
      withSpread({
        extraSmokes: [
          { cell: at(6, 6), atSeconds: 0 },
          { cell: at(6, 6), atSeconds: -5 },
        ],
      }),
    );
    expect(errors).toEqual(["煙の発生源 2 の煙が出始める時刻は 0 秒以上にしてください"]);
  });

  it("誤りの理由は空でない文字列", () => {
    const errors = validatePlan(plan({ cellSize: 0 }));
    expect(errors.length).toBeGreaterThan(0);
    for (const error of errors) {
      expect(typeof error).toBe("string");
      expect(error.length).toBeGreaterThan(0);
    }
  });

  it("誤りが複数あれば複数の理由を返す", () => {
    const p = plan({
      cellSize: 0,
      drill: { ...DEMO_SCHOOL.drill, timeLimitSeconds: 0, startYaw: Number.NaN },
    });
    // マスの大きさは階の検査より前，制限時間・向きはその後．マスの大きさの誤りで打ち切られても 1 件以上は返る
    expect(validatePlan(p).length).toBeGreaterThanOrEqual(1);
    const p2 = withDrill({ timeLimitSeconds: 0, startYaw: Number.NaN });
    expect(validatePlan(p2).length).toBeGreaterThanOrEqual(2);
  });
});

describe("validatePlan（階のマス目の誤り）", () => {
  it.each<[string, SchoolPlan]>([
    ["階の番号が 0", withFloor({ level: 0 })],
    ["階の番号が負", withFloor({ level: -1 })],
    ["階の番号が小数", withFloor({ level: 1.5 })],
    ["階の番号が NaN", withFloor({ level: Number.NaN })],
    ["幅が 0", withFloor({ width: 0 })],
    ["奥行きが 0", withFloor({ depth: 0 })],
    ["幅が小数", withFloor({ width: 19.5 })],
    ["奥行きが NaN", withFloor({ depth: Number.NaN })],
    ["マスの数が 1 つ足りない", withFloor({ cells: demoFloor.cells.slice(1) })],
    ["マスの数が 1 つ多い", withFloor({ cells: [...demoFloor.cells, "outdoor"] })],
    ["教室の割り当ての数が足りない", withFloor({ roomOf: demoFloor.roomOf.slice(1) })],
    ["教室の割り当ての数が多い", withFloor({ roomOf: [...demoFloor.roomOf, -1] })],
    ["幅が 1 多い（配列の長さが width * depth と合わない）", withFloor({ width: 20 })],
    ["知らない種類のマス", withCell(5, 6, "lava" as CellKind)],
    ["教室のマスの割り当てが -1", withCell(0, 0, "classroom", -1)],
    ["教室のマスの割り当てが教室の数と同じ（範囲外）", withCell(0, 0, "classroom", 3)],
    ["教室のマスの割り当てが小数", withCell(0, 0, "classroom", 0.5)],
    ["教室のマスの割り当てが NaN", withCell(0, 0, "classroom", Number.NaN)],
    ["教室以外のマス（廊下）に教室の割り当て", withCell(5, 6, "corridor", 0)],
    ["教室以外のマス（ドア）に教室の割り当て", withCell(4, 5, "door", 0)],
    ["教室が 1 つも無いのに教室のマスがある", plan({ rooms: [] })],
  ])("%s は誤り", (_label, p) => {
    expect(validatePlan(p).length).toBeGreaterThan(0);
  });

  it("2 つ目の階だけが壊れていても誤り", () => {
    const p = plan({ floors: [demoFloor, { ...demoFloor, level: 2, cells: [] }] });
    expect(validatePlan(p).length).toBeGreaterThan(0);
  });

  it("マス目が壊れていても例外を投げない（訓練条件の位置がマス目を読む前に止まる）", () => {
    expect(() => validatePlan(withFloor({ cells: [], roomOf: [] }))).not.toThrow();
    expect(() => validatePlan(withFloor({ width: 0 }))).not.toThrow();
    expect(() => validatePlan(plan({ floors: [] }))).not.toThrow();
  });
});

describe("validatePlan（訓練条件の誤り）", () => {
  it.each<[string, SchoolPlan]>([
    ["モードが学習・テスト以外", withDrill({ mode: "free" as "learn" })],
    // 火元
    ["火元が 1 つもない", withDrill({ fireOrigins: [] })],
    ["火元の x がマス目の外（右端の次）", withDrill({ fireOrigins: [at(19, 0)] })],
    ["火元の z がマス目の外（下端の次）", withDrill({ fireOrigins: [at(0, 13)] })],
    ["火元の x が負", withDrill({ fireOrigins: [at(-1, 0)] })],
    ["火元の位置が小数", withDrill({ fireOrigins: [at(0.5, 0)] })],
    ["火元の位置が NaN", withDrill({ fireOrigins: [at(Number.NaN, 0)] })],
    ["火元の階が無い", withDrill({ fireOrigins: [at(0, 0, 1)] })],
    ["火元の階が負", withDrill({ fireOrigins: [at(0, 0, -1)] })],
    ["2 つ目の火元だけがマス目の外", withDrill({ fireOrigins: [at(16, 2), at(100, 100)] })],
    // 開始地点
    ["開始地点がマス目の外", withDrill({ start: at(19, 2), route: [at(19, 2), ...route] })],
    ["開始地点の階が無い", withDrill({ start: at(2, 2, 1) })],
    ["開始地点が廊下（教室でない）", withDrill({ start: at(2, 6), route: route.slice(8) })],
    ["開始地点がドア（教室でない）", withDrill({ start: at(4, 5), route: route.slice(5) })],
    ["開始時の向きが NaN", withDrill({ startYaw: Number.NaN })],
    ["開始時の向きが Infinity", withDrill({ startYaw: Number.POSITIVE_INFINITY })],
    // 集合場所
    ["集合場所が 1 つもない", withDrill({ assembly: [] })],
    ["集合場所がマス目の外", withDrill({ assembly: [at(8, 10), at(8, 13)] })],
    ["集合場所が廊下（屋外でない）", withDrill({ assembly: [at(8, 10), at(5, 6)] })],
    ["集合場所が出口（屋外でない）", withDrill({ assembly: [at(8, 10), at(2, 7)] })],
    // 延焼
    ["火が移る秒数が 0", withSpread({ fireSecondsPerCell: 0 })],
    ["火が移る秒数が負", withSpread({ fireSecondsPerCell: -6 })],
    ["火が移る秒数が NaN", withSpread({ fireSecondsPerCell: Number.NaN })],
    ["煙が移る秒数が 0", withSpread({ smokeSecondsPerCell: 0 })],
    ["煙が移る秒数が Infinity", withSpread({ smokeSecondsPerCell: Number.POSITIVE_INFINITY })],
    [
      "追加の延焼箇所がマス目の外",
      withSpread({ extraFires: [{ cell: at(0, 99), atSeconds: 10 }] }),
    ],
    [
      "追加の延焼箇所の階が無い",
      withSpread({ extraFires: [{ cell: at(0, 0, 3), atSeconds: 10 }] }),
    ],
    ["追加の延焼箇所の時刻が負", withSpread({ extraFires: [{ cell: at(14, 6), atSeconds: -1 }] })],
    [
      "追加の延焼箇所の時刻が NaN",
      withSpread({ extraFires: [{ cell: at(14, 6), atSeconds: Number.NaN }] }),
    ],
    ["煙の発生源がマス目の外", withSpread({ extraSmokes: [{ cell: at(19, 0), atSeconds: 10 }] })],
    ["煙の発生源の階が無い", withSpread({ extraSmokes: [{ cell: at(0, 0, 1), atSeconds: 10 }] })],
    ["煙の発生源の時刻が負", withSpread({ extraSmokes: [{ cell: at(6, 6), atSeconds: -1 }] })],
    [
      "煙の発生源の時刻が NaN",
      withSpread({ extraSmokes: [{ cell: at(6, 6), atSeconds: Number.NaN }] }),
    ],
    [
      "煙の発生源の時刻が Infinity",
      withSpread({ extraSmokes: [{ cell: at(6, 6), atSeconds: Number.POSITIVE_INFINITY }] }),
    ],
    // 制限時間
    ["制限時間が 0", withDrill({ timeLimitSeconds: 0 })],
    ["制限時間が負", withDrill({ timeLimitSeconds: -150 })],
    ["制限時間が NaN", withDrill({ timeLimitSeconds: Number.NaN })],
    ["制限時間が Infinity", withDrill({ timeLimitSeconds: Number.POSITIVE_INFINITY })],
  ])("%s は誤り", (_label, p) => {
    expect(validatePlan(p).length).toBeGreaterThan(0);
  });
});

describe("validatePlan（空の正解経路）", () => {
  // Issue #133 の仕様変更: 経路は空でもよい．空なら生徒側で proposeRoute() の提案を使う（SPEC_01「結果の評価」）
  it("経路が空は誤りにしない", () => {
    expect(validatePlan(withDrill({ route: [] }))).toEqual([]);
  });

  it("経路が空でも，経路以外の誤りは従来どおり返す", () => {
    expect(validatePlan(withDrill({ route: [], start: at(8, 10) })).length).toBeGreaterThan(0);
  });
});

describe("validatePlan（正解経路の誤り）", () => {
  it.each<[string, SchoolPlan]>([
    ["開始地点から始まらない（最初のマスを抜いた）", withDrill({ route: route.slice(1) })],
    [
      "開始地点から始まらない（同じ x・z でも別の階）",
      plan({
        floors: [demoFloor, { ...demoFloor, level: 2 }],
        drill: { ...DEMO_SCHOOL.drill, route: [at(2, 2, 1), ...route.slice(1)] },
      }),
    ],
    ["集合場所で終わらない（最後のマスを抜いた）", withDrill({ route: route.slice(0, -1) })],
    ["開始地点だけの経路（集合場所で終わらない）", withDrill({ route: [at(2, 2)] })],
    ["途中で 1 マス飛ぶ", withDrill({ route: [...route.slice(0, 3), ...route.slice(4)] })],
    [
      "斜めに進む",
      // (2, 4) → (3, 4) → (4, 4) の (3, 4) を (3, 5) に替えると (2, 4)→(3, 5) が斜め
      withDrill({ route: route.map((ref, i) => (i === 3 ? at(3, 5) : ref)) }),
    ],
    ["同じマスが続く（隣り合っていない）", withDrill({ route: [route[0], ...route] })],
    [
      "途中で別の階に移る（同じ x・z）",
      plan({
        floors: [demoFloor, { ...demoFloor, level: 2 }],
        drill: {
          ...DEMO_SCHOOL.drill,
          route: route.map((ref, i) => (i === 7 ? { ...ref, floor: 1 } : ref)),
        },
      }),
    ],
    [
      "途中のマスがマス目の外",
      withDrill({ route: route.map((ref, i) => (i === 7 ? at(3, -1) : ref)) }),
    ],
    [
      "途中のマスの階が無い",
      withDrill({ route: route.map((ref, i) => (i === 7 ? at(3, 6, 5) : ref)) }),
    ],
    // 経路の 8 マス目は廊下の (3, 6)．そこを壁・何もないマスにする
    ["柱・厚い壁（wall）のマスを通る", withCell(3, 6, "wall")],
    ["何もない（void）マスを通る", withCell(3, 6, "void")],
  ])("%s は誤り", (_label, p) => {
    expect(validatePlan(p).length).toBeGreaterThan(0);
  });

  it("経路のマスがマス目の外でも例外を投げない", () => {
    expect(() =>
      validatePlan(withDrill({ route: [at(1000, 1000), at(Number.NaN, 0), at(0, 0, 9)] })),
    ).not.toThrow();
  });
});
