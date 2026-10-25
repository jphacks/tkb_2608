// エディタの配置の下書き（ES3）の当てはめ（draftRejection・applyFloorDraft）のテスト．
// 基準は docs/04_SPEC/SPEC_02「配置の下書き」の「流れ」（validatePlan と同じ確かめ方で調べる・今の階のマス目を置き換える・
// 「元に戻す」で戻れる・合わなくなった訓練条件は外して知らせる）と，PR #168 で決めたこと（火元・集合場所・経路は外す．
// 開始地点は消さず知らせるだけ．当てはめは 1 回の「元に戻す」で戻る）．editorState.test.ts が大きいため別のファイルにした
import { describe, expect, it } from "vitest";
import type {
  CellKind,
  CellRef,
  DrillSetup,
  FloorDraft,
  Room,
  SchoolPlan,
} from "../core/schoolPlan";
import { DEMO_SCHOOL } from "../share/samples/demoSchool";
import { createFloorFromRows } from "../share/samples/floorFromRows";
import {
  applyFloorDraft,
  canRedo,
  canUndo,
  createEditorState,
  DRAFT_REASONS,
  draftRejection,
  EDIT_FLOOR,
  type EditorState,
  editingFloor,
  MAX_GRID_SIZE,
  redo,
  undo,
} from "./editorState";
import { checkRoute } from "./routeCheck";

function deepFreeze<T>(value: T): T {
  if (value !== null && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const v of Object.values(value as object)) deepFreeze(v);
  }
  return value;
}

const ref = (x: number, z: number, floor = 0): CellRef => ({ floor, x, z });

// 元の校舎（3 × 3 マス）:
//   z=0: 教室 教室 廊下
//   z=1: 教室 ドア 廊下
//   z=2: 屋外 屋外 屋外
// 開始地点 (1, 0)・火元 (2, 0)・集合場所 (1, 2)・経路 (1,0) → (1,1) ドア → (1,2)
const BASE_ROWS = ["00h", "0dh", "ooo"];

const BASE_DRILL: DrillSetup = {
  mode: "test",
  fireOrigins: [ref(2, 0)],
  start: ref(1, 0),
  startYaw: Math.PI / 2,
  assembly: [ref(1, 2)],
  route: [ref(1, 0), ref(1, 1), ref(1, 2)],
  spread: {
    ...DEMO_SCHOOL.drill.spread,
    extraFires: [{ cell: ref(2, 1), atSeconds: 30 }],
  },
  timeLimitSeconds: 123,
};

function basePlan(drill: Partial<DrillSetup> = {}): SchoolPlan {
  return deepFreeze({
    ...DEMO_SCHOOL,
    name: "テスト校舎",
    cellSize: 1.5,
    floors: [createFloorFromRows(1, BASE_ROWS)],
    rooms: [{ name: "1年1組" }],
    drill: { ...BASE_DRILL, ...drill },
  });
}

const baseState = (drill?: Partial<DrillSetup>): EditorState => createEditorState(basePlan(drill));

/** 文字の行から下書きを作る（SPEC_02 の 1 マス 1 文字．教室は数字） */
function draft(rows: readonly string[], rooms: readonly Room[] = [{ name: "理科室" }]): FloorDraft {
  const { width, depth, cells, roomOf } = createFloorFromRows(1, rows);
  return deepFreeze({ width, depth, cells, roomOf, rooms });
}

/** 一部の項目を壊した下書き */
const broken = (overrides: Partial<FloorDraft>): FloorDraft => ({
  ...draft(BASE_ROWS),
  ...overrides,
});

describe("draftRejection", () => {
  it("正しい下書きは null", () => {
    expect(draftRejection(draft(BASE_ROWS))).toBeNull();
  });

  it("教室が無い下書きも当てられる", () => {
    expect(draftRejection(draft(["hh", "oo"], []))).toBeNull();
  });

  it.each<[string, Partial<FloorDraft>]>([
    ["cells が短い", { cells: draft(BASE_ROWS).cells.slice(1) }],
    ["roomOf が長い", { roomOf: [...draft(BASE_ROWS).roomOf, -1] }],
    ["知らないマスの種類", { cells: ["lava" as CellKind, ...draft(BASE_ROWS).cells.slice(1)] }],
    ["教室のマスの roomOf が -1", { roomOf: [-1, ...draft(BASE_ROWS).roomOf.slice(1)] }],
    ["教室の添字が rooms の外", { roomOf: [1, ...draft(BASE_ROWS).roomOf.slice(1)] }],
    [
      "教室以外のマスの roomOf が -1 でない",
      { roomOf: [...draft(BASE_ROWS).roomOf.slice(0, 2), 0, ...draft(BASE_ROWS).roomOf.slice(3)] },
    ],
    ["幅が 0", { width: 0 }],
    ["幅が整数でない", { width: 2.5 }],
    ["奥行きが NaN", { depth: Number.NaN }],
    ["教室の一覧が空なのに教室のマスがある", { rooms: [] }],
  ])("%s なら理由を返す", (_, overrides) => {
    const reason = draftRejection(broken(overrides));
    expect(reason).not.toBeNull();
    expect(typeof reason).toBe("string");
  });

  it("形の誤りの理由は DRAFT_REASONS.invalid の文", () => {
    const reason = draftRejection(broken({ cells: [] }));
    expect(reason?.startsWith(DRAFT_REASONS.invalid("").slice(0, 10))).toBe(true);
  });

  it.each<[number, number]>([
    [MAX_GRID_SIZE + 1, 1],
    [1, MAX_GRID_SIZE + 1],
  ])("%d × %d マスは大きすぎる", (width, depth) => {
    const count = width * depth;
    const d: FloorDraft = {
      width,
      depth,
      cells: new Array(count).fill("corridor"),
      roomOf: new Array(count).fill(-1),
      rooms: [],
    };
    expect(draftRejection(d)).toBe(DRAFT_REASONS.tooLarge);
  });

  it(`${MAX_GRID_SIZE} × ${MAX_GRID_SIZE} マスは当てられる`, () => {
    const count = MAX_GRID_SIZE * MAX_GRID_SIZE;
    const d: FloorDraft = {
      width: MAX_GRID_SIZE,
      depth: MAX_GRID_SIZE,
      cells: new Array(count).fill("corridor"),
      roomOf: new Array(count).fill(-1),
      rooms: [],
    };
    expect(draftRejection(d)).toBeNull();
  });

  it.each(["", "   "])("教室の名前が空（%j）なら理由を返す", (name) => {
    expect(draftRejection(draft(BASE_ROWS, [{ name }]))).toBe(DRAFT_REASONS.badRoomName);
  });
});

describe("applyFloorDraft", () => {
  it("前提: 元の校舎の経路は確かめに通る", () => {
    const s = baseState();
    expect(checkRoute(s.plan.drill, EDIT_FLOOR, editingFloor(s)).problems).toEqual([]);
  });

  it("今の階のマス目と教室の一覧を下書きに置き換える", () => {
    const d = draft(["000h", "0d0h", "hhhh", "oooo"], [{ name: "理科室" }]);
    const { state: next, reason } = applyFloorDraft(baseState(), d);
    expect(reason).toBeNull();
    const f = editingFloor(next);
    expect(f.width).toBe(4);
    expect(f.depth).toBe(4);
    expect(f.cells).toEqual(d.cells);
    expect(f.roomOf).toEqual(d.roomOf);
    expect(f.level).toBe(1);
    expect(next.plan.rooms).toEqual([{ name: "理科室" }]);
  });

  it("教室の名前の前後の空白は除く", () => {
    const { state: next } = applyFloorDraft(baseState(), draft(BASE_ROWS, [{ name: " 図書室 " }]));
    expect(next.plan.rooms).toEqual([{ name: "図書室" }]);
  });

  it("名前・マスの大きさ・訓練条件の他の項目は変えない", () => {
    const s = baseState();
    const { state: next } = applyFloorDraft(s, draft(["0#h", "0dh", "ooo"]));
    expect(next.plan.name).toBe(s.plan.name);
    expect(next.plan.cellSize).toBe(s.plan.cellSize);
    expect(next.plan.version).toBe(1);
    expect(next.plan.drill.mode).toBe("test");
    expect(next.plan.drill.startYaw).toBe(Math.PI / 2);
    expect(next.plan.drill.timeLimitSeconds).toBe(123);
    expect(next.plan.drill.spread.fireSecondsPerCell).toBe(BASE_DRILL.spread.fireSecondsPerCell);
    expect(next.plan.drill.spread.smokeSecondsPerCell).toBe(BASE_DRILL.spread.smokeSecondsPerCell);
  });

  it("条件に合うままの訓練条件は外さない（removed は空）", () => {
    const s = baseState();
    // 教室の名前と形だけが変わる（開始地点・火元・集合場所・経路のマスは同じ種類）
    const { state: next, removed } = applyFloorDraft(s, draft(["00h", "0dh", "ooo"]));
    expect(removed).toEqual([]);
    expect(next.plan.drill.fireOrigins).toEqual(BASE_DRILL.fireOrigins);
    expect(next.plan.drill.assembly).toEqual(BASE_DRILL.assembly);
    expect(next.plan.drill.route).toEqual(BASE_DRILL.route);
    expect(next.plan.drill.start).toEqual(BASE_DRILL.start);
    expect(next.plan.drill.spread.extraFires).toEqual(BASE_DRILL.spread.extraFires);
  });

  it.each<[string, readonly string[]]>([
    ["柱", ["00#", "0dh", "ooo"]],
    ["何もない", ["00.", "0dh", "ooo"]],
  ])("火元のマスが%sになったら火元を外す", (_, rows) => {
    const { state: next, removed } = applyFloorDraft(baseState(), draft(rows));
    expect(next.plan.drill.fireOrigins).toEqual([]);
    expect(removed).toContain("火元");
    expect(removed).not.toContain("集合場所");
    expect(removed).not.toContain("開始地点");
  });

  it("火元が人の入れるマス（教室等）のままなら外さない", () => {
    const { state: next, removed } = applyFloorDraft(baseState(), draft(["000", "0dh", "ooo"]));
    expect(next.plan.drill.fireOrigins).toEqual([ref(2, 0)]);
    expect(removed).not.toContain("火元");
  });

  it("追加の延焼箇所のマスが柱になったら外す", () => {
    const { state: next, removed } = applyFloorDraft(baseState(), draft(["00h", "0d#", "ooo"]));
    expect(next.plan.drill.spread.extraFires).toEqual([]);
    expect(removed).toContain("追加の延焼箇所");
    expect(next.plan.drill.fireOrigins).toEqual([ref(2, 0)]);
  });

  it("集合場所のマスが屋外でなくなったら外し，集合場所で終わらなくなった経路も外す", () => {
    const { state: next, removed } = applyFloorDraft(baseState(), draft(["00h", "0dh", "oho"]));
    expect(next.plan.drill.assembly).toEqual([]);
    expect(next.plan.drill.route).toEqual([]);
    expect(removed).toEqual(expect.arrayContaining(["集合場所", "正解経路"]));
    expect(removed).not.toContain("火元");
  });

  it("複数の集合場所のうち屋外でなくなったものだけを外す", () => {
    const s = baseState({ assembly: [ref(0, 2), ref(1, 2)] });
    const { state: next } = applyFloorDraft(s, draft(["00h", "0dh", "hoo"]));
    expect(next.plan.drill.assembly).toEqual([ref(1, 2)]);
  });

  it("開始地点のマスが教室でなくなっても開始地点は消さず，知らせる", () => {
    const s = baseState();
    const { state: next, removed, reason } = applyFloorDraft(s, draft(["0hh", "0dh", "ooo"]));
    expect(reason).toBeNull();
    expect(next.plan.drill.start).toEqual(BASE_DRILL.start);
    expect(removed).toContain("開始地点");
  });

  it("壁をまたぐことになった経路は丸ごと外す", () => {
    // ドアが教室になり，教室から屋外へ壁をまたぐ
    const { state: next, removed } = applyFloorDraft(baseState(), draft(["00h", "00h", "ooo"]));
    expect(next.plan.drill.route).toEqual([]);
    expect(removed).toContain("正解経路");
    expect(next.plan.drill.assembly).toEqual(BASE_DRILL.assembly);
    expect(next.plan.drill.fireOrigins).toEqual(BASE_DRILL.fireOrigins);
  });

  it("経路が空ならそのまま空で，正解経路は知らせない", () => {
    const { state: next, removed } = applyFloorDraft(
      baseState({ route: [] }),
      draft(["00h", "00h", "ooo"]),
    );
    expect(next.plan.drill.route).toEqual([]);
    expect(removed).not.toContain("正解経路");
  });

  it("マス目が小さくなり外に出た訓練条件は外す（開始地点は残して知らせる）", () => {
    const { state: next, removed } = applyFloorDraft(baseState(), draft(["0h", "hh"]));
    expect(editingFloor(next).width).toBe(2);
    expect(next.plan.drill.fireOrigins).toEqual([]);
    expect(next.plan.drill.assembly).toEqual([]);
    expect(next.plan.drill.spread.extraFires).toEqual([]);
    expect(next.plan.drill.route).toEqual([]);
    expect(next.plan.drill.start).toEqual(BASE_DRILL.start);
    expect(removed).toEqual(
      expect.arrayContaining(["火元", "追加の延焼箇所", "集合場所", "開始地点", "正解経路"]),
    );
  });

  it("1 回の「元に戻す」で当てる前の校舎に，「やり直す」で当てた校舎に戻る", () => {
    const s = baseState();
    const { state: next } = applyFloorDraft(s, draft(["0hh", "0dh", "hoo"]));
    expect(canUndo(next)).toBe(true);
    expect(next.past).toEqual([s.plan]);
    const undone = undo(next);
    expect(undone.plan).toBe(s.plan);
    expect(canRedo(undone)).toBe(true);
    expect(redo(undone).plan).toBe(next.plan);
  });

  it("当てられない下書きなら理由を返し，校舎と履歴は変えない", () => {
    const s = baseState();
    const d = broken({ cells: [] });
    const { state: next, reason, removed } = applyFloorDraft(s, d);
    expect(reason).toBe(draftRejection(d));
    expect(reason).not.toBeNull();
    expect(removed).toEqual([]);
    expect(next.plan).toBe(s.plan);
    expect(next.past).toEqual(s.past);
    expect(next.future).toEqual(s.future);
  });

  it("下書きの配列を後で書き換えても校舎は変わらない", () => {
    const cells: CellKind[] = ["corridor", "outdoor"];
    const roomOf = [-1, -1];
    const { state: next } = applyFloorDraft(baseState(), {
      width: 2,
      depth: 1,
      cells,
      roomOf,
      rooms: [],
    });
    cells[0] = "wall";
    roomOf[0] = 5;
    expect(editingFloor(next).cells[0]).toBe("corridor");
    expect(editingFloor(next).roomOf[0]).toBe(-1);
  });
});
