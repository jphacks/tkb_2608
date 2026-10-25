// trimVoidMargins（URL に載せる前にマス目の外側の void の行・列を切り詰める）のテスト．
// 基準は docs/04_SPEC/SPEC_02「長さの上限」（エディタは QR を出す前に，マス目の外側の void の行・列を自動で切り詰めてから測る）・
// 「型」（添字は z * width + x・教室以外の roomOf は -1・CellRef は floors の添字とマスの位置）と Issue #130
import { describe, expect, it } from "vitest";
import type { CellRef, DrillSetup, Floor, SchoolPlan } from "../core/schoolPlan";
import { DEMO_SCHOOL, DEMO_SCHOOL_ROWS } from "./samples/demoSchool";
import { createFloorFromRows } from "./samples/floorFromRows";
import { trimVoidMargins } from "./trimPlan";
import { validatePlan } from "./validatePlan";

/** 入れ子のオブジェクト・配列をすべて凍らせる（入力を書き換えると strict mode で例外になる） */
function deepFreeze<T>(value: T): T {
  if (value !== null && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const v of Object.values(value as object)) deepFreeze(v);
  }
  return value;
}

const ref = (x: number, z: number, floor = 0): CellRef => ({ floor, x, z });

/** 行の周りに void を足す（上 top 行・下 bottom 行・左 left 列・右 right 列） */
function pad(
  rows: readonly string[],
  margins: { top?: number; bottom?: number; left?: number; right?: number },
): string[] {
  const { top = 0, bottom = 0, left = 0, right = 0 } = margins;
  const width = rows[0].length + left + right;
  const blank = ".".repeat(width);
  return [
    ...Array.from({ length: top }, () => blank),
    ...rows.map((row) => ".".repeat(left) + row + ".".repeat(right)),
    ...Array.from({ length: bottom }, () => blank),
  ];
}

/** 位置をずらす */
const moved = (r: CellRef, dx: number, dz: number): CellRef => ({ ...r, x: r.x + dx, z: r.z + dz });

/** 訓練条件のすべての位置を同じだけずらす */
function shiftDrill(drill: DrillSetup, dx: number, dz: number): DrillSetup {
  const m = (r: CellRef): CellRef => moved(r, dx, dz);
  return {
    ...drill,
    fireOrigins: drill.fireOrigins.map(m),
    start: m(drill.start),
    assembly: drill.assembly.map(m),
    route: drill.route.map(m),
    spread: {
      ...drill.spread,
      extraFires: drill.spread.extraFires.map((f) => ({ ...f, cell: m(f.cell) })),
      ...(drill.spread.extraSmokes === undefined
        ? {}
        : { extraSmokes: drill.spread.extraSmokes.map((f) => ({ ...f, cell: m(f.cell) })) }),
    },
  };
}

// 既定の小さな校舎（4 × 3）:
//   z=0: 教室0 教室0 廊下 廊下
//   z=1: 教室0 教室1 廊下 廊下
//   z=2: 屋外  屋外  屋外 屋外
const BASE_ROWS = ["00hh", "01hh", "oooo"];
const BASE_DRILL: DrillSetup = {
  mode: "test",
  fireOrigins: [ref(3, 0)],
  start: ref(1, 1),
  startYaw: Math.PI / 2,
  assembly: [ref(3, 2)],
  route: [ref(1, 1), ref(2, 1), ref(3, 1), ref(3, 2)],
  spread: { fireSecondsPerCell: 6, smokeSecondsPerCell: 2, extraFires: [] },
  timeLimitSeconds: 150,
};

/** テスト用の校舎．一部だけ上書きできる．入力が書き換えられないよう凍らせる */
function plan(
  options: {
    rows?: readonly string[];
    floors?: readonly Floor[];
    drill?: Partial<DrillSetup>;
  } = {},
): SchoolPlan {
  return deepFreeze({
    version: 1,
    name: "テスト校舎",
    cellSize: 1.5,
    floors: options.floors ?? [createFloorFromRows(1, options.rows ?? BASE_ROWS)],
    rooms: [{ name: "1年1組" }, { name: "1年2組" }],
    drill: { ...BASE_DRILL, ...options.drill },
  });
}

/** BASE_ROWS の周りに void を足し，訓練条件も同じだけずらした校舎 */
function paddedBase(
  margins: { top?: number; bottom?: number; left?: number; right?: number },
  drill: Partial<DrillSetup> = {},
): SchoolPlan {
  const full = { ...BASE_DRILL, ...drill };
  return plan({
    rows: pad(BASE_ROWS, margins),
    drill: shiftDrill(full, margins.left ?? 0, margins.top ?? 0),
  });
}

describe("trimVoidMargins", () => {
  it("外側に void が無い校舎は同じ参照を返す", () => {
    const p = plan();
    expect(trimVoidMargins(p)).toBe(p);
  });

  it("デモの校舎（外側に void が無い）は同じ参照を返す", () => {
    expect(trimVoidMargins(DEMO_SCHOOL)).toBe(DEMO_SCHOOL);
  });

  it("内側にだけ void がある校舎は切り詰めない（同じ参照）", () => {
    const p = plan({ rows: ["00hh", "0.hh", "oooo"], drill: { start: ref(0, 1), route: [] } });
    expect(trimVoidMargins(p)).toBe(p);
  });

  it.each<[string, { top?: number; bottom?: number; left?: number; right?: number }]>([
    ["上だけ", { top: 2 }],
    ["下だけ", { bottom: 3 }],
    ["左だけ", { left: 1 }],
    ["右だけ", { right: 4 }],
    ["四方", { top: 2, bottom: 1, left: 3, right: 2 }],
  ])("%s の void を切り詰めると元の校舎と同じになる", (_, margins) => {
    const padded = paddedBase(margins);
    const trimmed = trimVoidMargins(padded);
    const expected = plan();
    expect(trimmed).toEqual(expected);
    expect(validatePlan(trimmed)).toEqual([]);
  });

  it("周りに void を足したデモの校舎を切り詰めるとデモの校舎に戻る", () => {
    const margins = { top: 3, bottom: 2, left: 4, right: 5 };
    const padded = deepFreeze<SchoolPlan>({
      ...DEMO_SCHOOL,
      floors: [createFloorFromRows(1, pad(DEMO_SCHOOL_ROWS, margins))],
      drill: shiftDrill(DEMO_SCHOOL.drill, margins.left, margins.top),
    });
    expect(validatePlan(padded)).toEqual([]);
    const trimmed = trimVoidMargins(padded);
    expect(trimmed).toEqual(DEMO_SCHOOL);
    expect(validatePlan(trimmed)).toEqual([]);
  });

  it("教室の割り当て（roomOf）もマスと一緒に切り出す", () => {
    const trimmed = trimVoidMargins(paddedBase({ top: 1, left: 2 }));
    const floor = trimmed.floors[0];
    expect(floor.width).toBe(4);
    expect(floor.depth).toBe(3);
    expect(floor.cells).toHaveLength(12);
    expect(floor.roomOf).toEqual([0, 0, -1, -1, 0, 1, -1, -1, -1, -1, -1, -1]);
  });

  it("訓練条件のすべての位置（火元・開始地点・集合場所・経路・追加の延焼箇所）をずらす", () => {
    const extraFires = [{ cell: ref(2, 0), atSeconds: 30 }];
    const trimmed = trimVoidMargins(
      paddedBase({ top: 2, left: 3 }, { spread: { ...BASE_DRILL.spread, extraFires } }),
    );
    expect(trimmed.drill.fireOrigins).toEqual(BASE_DRILL.fireOrigins);
    expect(trimmed.drill.start).toEqual(BASE_DRILL.start);
    expect(trimmed.drill.assembly).toEqual(BASE_DRILL.assembly);
    expect(trimmed.drill.route).toEqual(BASE_DRILL.route);
    expect(trimmed.drill.spread.extraFires).toEqual(extraFires);
  });

  it("煙の発生源（extraSmokes）の位置もずらす", () => {
    const extraSmokes = [{ cell: ref(2, 1), atSeconds: 15 }];
    const trimmed = trimVoidMargins(
      paddedBase({ top: 2, left: 3 }, { spread: { ...BASE_DRILL.spread, extraSmokes } }),
    );
    expect(trimmed.drill.spread.extraSmokes).toEqual(extraSmokes);
  });

  it("煙の発生源の項目が無い校舎は，切り詰めた後も項目が無いまま", () => {
    const trimmed = trimVoidMargins(paddedBase({ top: 1, left: 1 }));
    expect(trimmed.drill.spread).not.toHaveProperty("extraSmokes");
  });

  it("位置以外の訓練条件（モード・向き・速さ・制限時間）と校舎の名前・教室は変えない", () => {
    const padded = paddedBase({ top: 1, right: 1 });
    const trimmed = trimVoidMargins(padded);
    expect(trimmed.drill.mode).toBe("test");
    expect(trimmed.drill.startYaw).toBe(BASE_DRILL.startYaw);
    expect(trimmed.drill.spread.fireSecondsPerCell).toBe(6);
    expect(trimmed.drill.spread.smokeSecondsPerCell).toBe(2);
    expect(trimmed.drill.timeLimitSeconds).toBe(150);
    expect(trimmed.name).toBe(padded.name);
    expect(trimmed.rooms).toEqual(padded.rooms);
    expect(trimmed.cellSize).toBe(padded.cellSize);
    expect(trimmed.version).toBe(padded.version);
  });

  it("入力の校舎は書き換えない（凍らせた入力でも例外にならない）", () => {
    const padded = paddedBase({ top: 1, left: 1, bottom: 1, right: 1 });
    const snapshot = JSON.parse(JSON.stringify(padded));
    trimVoidMargins(padded);
    expect(JSON.parse(JSON.stringify(padded))).toEqual(snapshot);
  });

  it("外側の void の上にある火元は落とさず，そのマスまで残す", () => {
    // 左に 2 列の void．火元は x = 0（いちばん外側の void）に置く
    const padded = plan({
      rows: pad(BASE_ROWS, { left: 2 }),
      drill: { ...shiftDrill(BASE_DRILL, 2, 0), fireOrigins: [ref(0, 1)] },
    });
    const trimmed = trimVoidMargins(padded);
    expect(trimmed.floors[0].width).toBe(6);
    expect(trimmed.drill.fireOrigins).toEqual([ref(0, 1)]);
    expect(trimmed.floors[0].cells[1 * 6 + 0]).toBe("void");
    expect(validatePlan(trimmed)).toEqual([]);
  });

  it("void の上の火元が 1 列内側なら，その外側の void だけを切り詰める", () => {
    const padded = plan({
      rows: pad(BASE_ROWS, { left: 3 }),
      drill: { ...shiftDrill(BASE_DRILL, 3, 0), fireOrigins: [ref(1, 1)] },
    });
    const trimmed = trimVoidMargins(padded);
    expect(trimmed.floors[0].width).toBe(6);
    expect(trimmed.drill.fireOrigins).toEqual([ref(0, 1)]);
    expect(trimmed.drill.start).toEqual(moved(BASE_DRILL.start, 2, 0));
  });

  it("void の上の追加の延焼箇所も落とさない", () => {
    const padded = plan({
      rows: pad(BASE_ROWS, { bottom: 2 }),
      drill: {
        spread: { ...BASE_DRILL.spread, extraFires: [{ cell: ref(2, 4), atSeconds: 10 }] },
      },
    });
    const trimmed = trimVoidMargins(padded);
    expect(trimmed.floors[0].depth).toBe(5);
    expect(trimmed.drill.spread.extraFires).toEqual([{ cell: ref(2, 4), atSeconds: 10 }]);
  });

  it("マス目の外を指す位置は範囲に含めず，同じだけずらす（validatePlan の誤りのまま残る）", () => {
    const padded = plan({
      rows: pad(BASE_ROWS, { top: 1, left: 2 }),
      drill: { ...shiftDrill(BASE_DRILL, 2, 1), fireOrigins: [ref(-1, 1), ref(100, 2)] },
    });
    const trimmed = trimVoidMargins(padded);
    expect(trimmed.floors[0].width).toBe(4);
    expect(trimmed.floors[0].depth).toBe(3);
    expect(trimmed.drill.fireOrigins).toEqual([ref(-3, 0), ref(98, 1)]);
    expect(validatePlan(trimmed).length).toBeGreaterThan(0);
  });

  it("すべて void で位置も無い階は切り詰めない", () => {
    const empty = createFloorFromRows(2, ["...", "..."]);
    const p = plan({ floors: [createFloorFromRows(1, BASE_ROWS), empty] });
    const trimmed = trimVoidMargins(p);
    expect(trimmed).toBe(p);
  });

  it("すべて void の階は残したまま，ほかの階だけを切り詰める", () => {
    const empty = createFloorFromRows(2, ["...", "..."]);
    const p = plan({
      floors: [createFloorFromRows(1, pad(BASE_ROWS, { left: 1 })), empty],
      drill: shiftDrill(BASE_DRILL, 1, 0),
    });
    const trimmed = trimVoidMargins(p);
    expect(trimmed.floors[0].width).toBe(4);
    expect(trimmed.floors[1]).toEqual(empty);
    expect(trimmed.drill.start).toEqual(BASE_DRILL.start);
  });

  it("複数の階は階ごとに切り詰め，位置はその階の切り詰めの分だけずらす", () => {
    // 1 階は左に 1 列，2 階は上に 2 行・右に 1 列の void
    const floor1 = createFloorFromRows(1, pad(BASE_ROWS, { left: 1 }));
    const floor2 = createFloorFromRows(2, pad(["hh", "0h"], { top: 2, right: 1 }));
    const p = plan({
      floors: [floor1, floor2],
      drill: {
        ...shiftDrill(BASE_DRILL, 1, 0),
        fireOrigins: [ref(1, 3, 1)],
        spread: { ...BASE_DRILL.spread, extraFires: [{ cell: ref(0, 2, 1), atSeconds: 5 }] },
      },
    });
    const trimmed = trimVoidMargins(p);
    expect(trimmed.floors[0].width).toBe(4);
    expect(trimmed.floors[0].depth).toBe(3);
    expect(trimmed.floors[1].width).toBe(2);
    expect(trimmed.floors[1].depth).toBe(2);
    expect(trimmed.floors[1].level).toBe(2);
    expect(trimmed.floors[1].cells).toEqual(["corridor", "corridor", "classroom", "corridor"]);
    expect(trimmed.floors[1].roomOf).toEqual([-1, -1, 0, -1]);
    // 2 階の位置は 2 階の分（z を 2）だけ，1 階の位置は 1 階の分（x を 1）だけずれる
    expect(trimmed.drill.fireOrigins).toEqual([ref(1, 1, 1)]);
    expect(trimmed.drill.spread.extraFires).toEqual([{ cell: ref(0, 0, 1), atSeconds: 5 }]);
    expect(trimmed.drill.start).toEqual(BASE_DRILL.start);
    expect(trimmed.drill.route).toEqual(BASE_DRILL.route);
  });

  it("切り詰めた後の校舎をもう一度切り詰めても変わらない（同じ参照）", () => {
    const once = trimVoidMargins(paddedBase({ top: 1, bottom: 1, left: 1, right: 1 }));
    expect(trimVoidMargins(once)).toBe(once);
  });
});
