// エディタの編集の状態と操作のテスト．
// 基準は docs/04_SPEC/SPEC_01_画面遷移とモジュール構成.md（src/editor/: 「今の状態 → 操作 → 次の状態」の純粋な関数・「元に戻す」），
// docs/04_SPEC/SPEC_02_校舎データの形式.md（型・座標・添字 z * width + x・教室以外の roomOf は -1），Issue #108
import { describe, expect, it } from "vitest";
import type { CellKind, CellRef, DrillSetup, Floor, Room, SchoolPlan } from "../core/schoolPlan";
import { DEMO_SCHOOL } from "../share/samples/demoSchool";
import { createFloorFromRows } from "../share/samples/floorFromRows";
import { validatePlan } from "../share/validatePlan";
import { canPersonStep, computeSpread, proposeRoute, type SpreadMap } from "../sim";
import type { CellXZ } from "../sim/grid";
import {
  addRoom,
  beginRouteStroke,
  beginStroke,
  canRedo,
  canUndo,
  clearRoute,
  continueRouteStroke,
  continueStroke,
  createEditorState,
  EDIT_FLOOR,
  type EditorState,
  type EditorTool,
  editingFloor,
  endStroke,
  FACING_YAW,
  FACINGS,
  type Facing,
  facingOfYaw,
  HISTORY_LIMIT,
  isMarkerTool,
  isRouteTool,
  isValidSeconds,
  MARKER_REASONS,
  MAX_GRID_SIZE,
  type MarkerKind,
  markerRejection,
  paintCell,
  placeMarker,
  placeStart,
  ROUTE_EDIT_REASONS,
  redo,
  renameRoom,
  resizeGrid,
  type SpreadSecondsKey,
  selectTool,
  setDrillMode,
  setSpreadSeconds,
  setStartFacing,
  setTimeLimit,
  startBlank,
  suggestRoute,
  toggleAssembly,
  toggleFireOrigin,
  undo,
  yawToGridDirection,
} from "./editorState";
import { checkRoute, ROUTE_REASONS } from "./routeCheck";

/** 入れ子のオブジェクト・配列をすべて凍らせる（書き換えようとすると strict mode で例外になる） */
function deepFreeze<T>(value: T): T {
  if (value !== null && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const v of Object.values(value as object)) deepFreeze(v);
  }
  return value;
}

/** テスト用の校舎（既定は 4 × 3 マス・教室 2 つ）．一部だけ上書きできる．入力が書き換えられないよう凍らせる */
function plan(
  options: {
    rows?: readonly string[];
    rooms?: readonly Room[];
    extraFloors?: readonly Floor[];
    overrides?: Partial<SchoolPlan>;
  } = {},
): SchoolPlan {
  const rows = options.rows ?? ["00hh", "01hh", "oooo"];
  const rooms = options.rooms ?? [{ name: "1年1組" }, { name: "1年2組" }];
  return deepFreeze({
    ...DEMO_SCHOOL,
    name: "テスト校舎",
    cellSize: 1.5,
    floors: [createFloorFromRows(1, rows), ...(options.extraFloors ?? [])],
    rooms,
    ...options.overrides,
  });
}

/** 凍らせた校舎で状態を作る */
const state = (options?: Parameters<typeof plan>[0]): EditorState =>
  createEditorState(plan(options));

const at = (x: number, z: number): CellXZ => ({ x, z });

/** (x, z) のマスの種類と教室（SPEC_02: 添字は z * width + x） */
function cellAt(s: EditorState, x: number, z: number): [CellKind, number] {
  const f = editingFloor(s);
  const i = z * f.width + x;
  return [f.cells[i], f.roomOf[i]];
}

/** SPEC_02 の Floor の決まり（配列の長さ・教室以外の roomOf は -1・教室の roomOf は rooms の添字） */
function expectValidFloor(p: SchoolPlan): void {
  const f = p.floors[0];
  expect(f.cells).toHaveLength(f.width * f.depth);
  expect(f.roomOf).toHaveLength(f.width * f.depth);
  f.cells.forEach((kind, i) => {
    if (kind === "classroom") {
      expect(Number.isInteger(f.roomOf[i])).toBe(true);
      expect(f.roomOf[i]).toBeGreaterThanOrEqual(0);
      expect(f.roomOf[i]).toBeLessThan(p.rooms.length);
    } else {
      expect(f.roomOf[i]).toBe(-1);
    }
  });
}

/** 2 つの校舎で違うマスの (x, z) の一覧 */
function changedCells(a: SchoolPlan, b: SchoolPlan): CellXZ[] {
  const fa = a.floors[0];
  const fb = b.floors[0];
  const result: CellXZ[] = [];
  for (let z = 0; z < fa.depth; z++) {
    for (let x = 0; x < fa.width; x++) {
      const i = z * fa.width + x;
      if (fa.cells[i] !== fb.cells[i] || fa.roomOf[i] !== fb.roomOf[i]) result.push({ x, z });
    }
  }
  return result;
}

describe("createEditorState", () => {
  it("教室があれば最初の道具は教室 0", () => {
    expect(state().tool).toEqual({ kind: "classroom", room: 0 });
  });

  it("教室が無ければ最初の道具は廊下", () => {
    expect(state({ rows: ["hh"], rooms: [] }).tool).toEqual({ kind: "corridor" });
  });

  it("履歴は空でドラッグの途中ではない", () => {
    const s = state();
    expect(s.past).toEqual([]);
    expect(s.future).toEqual([]);
    expect(s.stroke).toBeNull();
    expect(canUndo(s)).toBe(false);
    expect(canRedo(s)).toBe(false);
  });

  it("校舎はそのまま持つ（デモの校舎を開ける）", () => {
    const s = createEditorState(DEMO_SCHOOL);
    expect(s.plan).toBe(DEMO_SCHOOL);
    expect(editingFloor(s)).toBe(DEMO_SCHOOL.floors[0]);
  });
});

describe("selectTool", () => {
  it.each<Exclude<CellKind, "classroom">>([
    "void",
    "corridor",
    "wall",
    "door",
    "exit",
    "shutter",
    "outdoor",
  ])("教室以外の %s を選べる", (kind) => {
    const s = selectTool(state(), { kind });
    expect(s.tool).toEqual({ kind });
  });

  it("ある教室を選べる", () => {
    expect(selectTool(state(), { kind: "classroom", room: 1 }).tool).toEqual({
      kind: "classroom",
      room: 1,
    });
  });

  it.each([2, -1, 0.5, Number.NaN, Number.POSITIVE_INFINITY])(
    "無い教室（%s）を選んでも何もしない",
    (room) => {
      const s = state();
      expect(selectTool(s, { kind: "classroom", room })).toBe(s);
    },
  );

  it("道具を選んでも校舎・履歴は変わらない", () => {
    const s = state();
    const next = selectTool(s, { kind: "wall" });
    expect(next.plan).toBe(s.plan);
    expect(next.past).toHaveLength(0);
  });
});

describe("paintCell", () => {
  it("塗ったマスは z * width + x の位置が道具の種類になる", () => {
    const s = selectTool(state(), { kind: "wall" });
    const next = paintCell(s, at(3, 1));
    const f = editingFloor(next);
    expect(f.cells[1 * 4 + 3]).toBe("wall");
    expect(changedCells(s.plan, next.plan)).toEqual([at(3, 1)]);
  });

  it("教室以外で塗ると roomOf は -1 になる（教室のマスを塗りつぶしても）", () => {
    const s = selectTool(state(), { kind: "corridor" });
    const next = paintCell(s, at(1, 1)); // もとは教室 1
    expect(cellAt(next, 1, 1)).toEqual(["corridor", -1]);
    expectValidFloor(next.plan);
  });

  it("教室で塗ると roomOf はその教室の添字になる", () => {
    const s = selectTool(state(), { kind: "classroom", room: 1 });
    const next = paintCell(s, at(3, 2)); // もとは屋外
    expect(cellAt(next, 3, 2)).toEqual(["classroom", 1]);
    expectValidFloor(next.plan);
  });

  it("同じ教室の種類でも別の教室で塗れば roomOf が変わる", () => {
    const s = selectTool(state(), { kind: "classroom", room: 1 });
    const next = paintCell(s, at(0, 0)); // もとは教室 0
    expect(cellAt(next, 0, 0)).toEqual(["classroom", 1]);
    expect(next.past).toHaveLength(1);
  });

  it("1 マスで 1 回分の履歴を積み，やり直す先を捨てる", () => {
    const s = selectTool(state(), { kind: "wall" });
    const once = paintCell(s, at(2, 0));
    expect(once.past).toEqual([s.plan]);
    expect(canUndo(once)).toBe(true);
    const twice = paintCell(once, at(3, 0));
    expect(twice.past).toEqual([s.plan, once.plan]);
  });

  it("変わらないマスを塗っても何もしない（同じ校舎・履歴に積まない）", () => {
    const s = selectTool(state(), { kind: "corridor" });
    const next = paintCell(s, at(2, 0)); // もとから廊下
    expect(next.plan).toBe(s.plan);
    expect(next.past).toHaveLength(0);
  });

  it.each([
    [-1, 0],
    [0, -1],
    [4, 0],
    [0, 3],
    [Number.NaN, 0],
  ])("マス目の外 (%s, %s) は何もしない", (x, z) => {
    const s = selectTool(state(), { kind: "wall" });
    const next = paintCell(s, at(x, z));
    expect(next.plan).toBe(s.plan);
    expect(next.past).toHaveLength(0);
  });

  it("入力の校舎を書き換えない（凍らせた校舎でも塗れる）", () => {
    const original = plan();
    const snapshot = JSON.stringify(original);
    const s = selectTool(createEditorState(original), { kind: "wall" });
    const next = paintCell(s, at(0, 0));
    expect(JSON.stringify(original)).toBe(snapshot);
    expect(next.plan).not.toBe(original);
    expect(next.plan.floors[0]).not.toBe(original.floors[0]);
  });

  it("塗っても他の項目（名前・マスの大きさ・教室・訓練条件・階の数）は変わらない", () => {
    const s = selectTool(state(), { kind: "wall" });
    const next = paintCell(s, at(0, 0));
    expect(next.plan.name).toBe(s.plan.name);
    expect(next.plan.cellSize).toBe(s.plan.cellSize);
    expect(next.plan.rooms).toEqual(s.plan.rooms);
    expect(next.plan.drill).toBe(s.plan.drill);
    expect(next.plan.floors).toHaveLength(1);
    expect(editingFloor(next).width).toBe(4);
    expect(editingFloor(next).depth).toBe(3);
    expect(editingFloor(next).level).toBe(1);
  });

  it("1 フロア目だけを塗り，2 フロア目はそのまま", () => {
    const upper = createFloorFromRows(2, ["hh"]);
    const s = selectTool(state({ extraFloors: [upper] }), { kind: "wall" });
    const next = paintCell(s, at(0, 0));
    expect(next.plan.floors).toHaveLength(2);
    expect(next.plan.floors[1]).toEqual(upper);
    expect(cellAt(next, 0, 0)[0]).toBe("wall");
  });
});

describe("undo / redo", () => {
  it("元に戻すと元の校舎（同じもの）に戻り，やり直すと塗った校舎に戻る", () => {
    const s = selectTool(state(), { kind: "wall" });
    const painted = paintCell(s, at(0, 0));
    const undone = undo(painted);
    expect(undone.plan).toBe(s.plan);
    expect(canUndo(undone)).toBe(false);
    expect(canRedo(undone)).toBe(true);
    const redone = redo(undone);
    expect(redone.plan).toBe(painted.plan);
    expect(canRedo(redone)).toBe(false);
    expect(canUndo(redone)).toBe(true);
  });

  it("何回も元に戻し・やり直せる（順番が保たれる）", () => {
    let s = selectTool(state(), { kind: "wall" });
    const plans = [s.plan];
    for (const c of [at(0, 0), at(1, 0), at(2, 0)]) {
      s = paintCell(s, c);
      plans.push(s.plan);
    }
    for (let i = 2; i >= 0; i--) {
      s = undo(s);
      expect(s.plan).toBe(plans[i]);
    }
    for (let i = 1; i <= 3; i++) {
      s = redo(s);
      expect(s.plan).toBe(plans[i]);
    }
  });

  it("戻す先・やり直す先が無ければ何もしない", () => {
    const s = state();
    expect(undo(s).plan).toBe(s.plan);
    expect(redo(s).plan).toBe(s.plan);
    expect(undo(s).past).toHaveLength(0);
    expect(redo(s).future).toHaveLength(0);
  });

  it("元に戻した後に新しい操作をすると，やり直す先は捨てられる", () => {
    let s = selectTool(state(), { kind: "wall" });
    s = paintCell(s, at(0, 0));
    s = paintCell(s, at(1, 0));
    s = undo(s);
    expect(canRedo(s)).toBe(true);
    s = paintCell(s, at(3, 2));
    expect(canRedo(s)).toBe(false);
    expect(s.future).toHaveLength(0);
    expect(redo(s).plan).toBe(s.plan);
  });

  it(`履歴は ${HISTORY_LIMIT} 回分まで（古いものから捨てる）`, () => {
    expect(HISTORY_LIMIT).toBe(200);
    // 2 つの道具で同じマスを交互に塗り，毎回変化させる
    let s = state({ rows: ["h"], rooms: [] });
    const first = s.plan;
    const total = HISTORY_LIMIT + 50;
    for (let i = 0; i < total; i++) {
      s = selectTool(s, { kind: i % 2 === 0 ? "wall" : "corridor" });
      s = paintCell(s, at(0, 0));
    }
    expect(s.past).toHaveLength(HISTORY_LIMIT);
    expect(s.past).not.toContain(first);
    let undone = 0;
    while (canUndo(s)) {
      s = undo(s);
      undone++;
    }
    expect(undone).toBe(HISTORY_LIMIT);
    expect(s.future).toHaveLength(HISTORY_LIMIT);
    // 最も古く残っているのは 50 回目に塗った後の校舎（corridor・wall を交互に塗るので 50 回目は corridor）
    expect(cellAt(s, 0, 0)[0]).toBe("corridor");
  });

  it("元に戻して道具の教室が無くなったら，先頭の教室に直す", () => {
    let s = addRoom(state()); // 教室 2 を足して選ぶ
    expect(s.tool).toEqual({ kind: "classroom", room: 2 });
    s = undo(s);
    expect(s.plan.rooms).toHaveLength(2);
    expect(s.tool).toEqual({ kind: "classroom", room: 0 });
  });

  it("元に戻して教室が 1 つも無くなったら，道具は廊下に直す", () => {
    let s = addRoom(state({ rows: ["hh"], rooms: [] }));
    expect(s.tool).toEqual({ kind: "classroom", room: 0 });
    s = undo(s);
    expect(s.plan.rooms).toHaveLength(0);
    expect(s.tool).toEqual({ kind: "corridor" });
  });

  it("元に戻しても教室以外の道具はそのまま", () => {
    let s = selectTool(state(), { kind: "door" });
    s = paintCell(s, at(0, 0));
    s = undo(s);
    expect(s.tool).toEqual({ kind: "door" });
  });
});

describe("beginStroke / continueStroke / endStroke", () => {
  it("ドラッグ全体を 1 回分の履歴にまとめ，元に戻すとドラッグの前に戻る", () => {
    let s = selectTool(state(), { kind: "wall" });
    const before = s.plan;
    s = beginStroke(s, at(0, 2));
    expect(cellAt(s, 0, 2)[0]).toBe("wall");
    expect(canUndo(s)).toBe(true);
    s = continueStroke(s, at(1, 2));
    s = continueStroke(s, at(2, 2));
    s = continueStroke(s, at(3, 2));
    s = endStroke(s);
    expect(s.stroke).toBeNull();
    expect(s.past).toEqual([before]);
    expect(changedCells(before, s.plan)).toEqual([at(0, 2), at(1, 2), at(2, 2), at(3, 2)]);
    const undone = undo(s);
    expect(undone.plan).toBe(before);
    expect(redo(undone).plan).toBe(s.plan);
  });

  it("何も変わらなかったドラッグは履歴に積まない", () => {
    let s = selectTool(state(), { kind: "corridor" });
    const before = s.plan;
    s = beginStroke(s, at(2, 0));
    s = continueStroke(s, at(3, 0));
    s = continueStroke(s, at(3, 1));
    s = endStroke(s);
    expect(s.plan).toBe(before);
    expect(s.past).toHaveLength(0);
    expect(canUndo(s)).toBe(false);
  });

  it("ドラッグが変わったら，やり直す先を捨てる", () => {
    let s = selectTool(state(), { kind: "wall" });
    s = undo(paintCell(s, at(0, 0)));
    expect(canRedo(s)).toBe(true);
    s = endStroke(continueStroke(beginStroke(s, at(3, 2)), at(2, 2)));
    expect(canRedo(s)).toBe(false);
  });

  it("ドラッグの途中でなければ continueStroke・endStroke は何もしない", () => {
    const s = selectTool(state(), { kind: "wall" });
    expect(continueStroke(s, at(1, 1))).toBe(s);
    expect(endStroke(s)).toBe(s);
  });

  it("同じマスへの continueStroke は何もしない", () => {
    const s = beginStroke(selectTool(state(), { kind: "wall" }), at(0, 0));
    expect(continueStroke(s, at(0, 0))).toBe(s);
  });

  it("ドラッグ中に元に戻すと，ドラッグを閉じてからそれを取り消す", () => {
    let s = selectTool(state(), { kind: "wall" });
    const before = s.plan;
    s = continueStroke(beginStroke(s, at(0, 0)), at(1, 0));
    s = undo(s);
    expect(s.stroke).toBeNull();
    expect(s.plan).toBe(before);
    expect(canRedo(s)).toBe(true);
  });

  it("ドラッグ中に 1 マス塗ると，ドラッグを先に閉じて別の 1 回分にする", () => {
    let s = selectTool(state(), { kind: "wall" });
    const before = s.plan;
    s = continueStroke(beginStroke(s, at(0, 0)), at(1, 0));
    const dragged = s.plan;
    s = paintCell(s, at(3, 2));
    expect(s.stroke).toBeNull();
    expect(s.past).toEqual([before, dragged]);
  });

  it("ドラッグ中に新しいドラッグを始めると，前のドラッグを先に閉じる", () => {
    let s = selectTool(state(), { kind: "wall" });
    const before = s.plan;
    s = beginStroke(s, at(0, 0));
    const first = s.plan;
    s = endStroke(beginStroke(s, at(3, 2)));
    expect(s.past).toEqual([before, first]);
  });

  it("マス目の外から始めて中へ入っても，中のマスだけ塗れる", () => {
    let s = selectTool(state(), { kind: "wall" });
    const before = s.plan;
    s = beginStroke(s, at(-2, 2));
    expect(s.plan).toBe(before);
    s = endStroke(continueStroke(s, at(1, 2)));
    expect(changedCells(before, s.plan)).toEqual([at(0, 2), at(1, 2)]);
    expectValidFloor(s.plan);
  });

  it("入力の校舎を書き換えない", () => {
    const original = plan();
    const snapshot = JSON.stringify(original);
    let s = selectTool(createEditorState(original), { kind: "void" });
    s = endStroke(continueStroke(beginStroke(s, at(0, 0)), at(3, 2)));
    expect(JSON.stringify(original)).toBe(snapshot);
    expectValidFloor(s.plan);
  });
});

describe("continueStroke の補間（上下左右に切れ目なく塗る）", () => {
  const blank = (w: number, d: number): EditorState =>
    selectTool(state({ rows: Array.from({ length: d }, () => ".".repeat(w)), rooms: [] }), {
      kind: "corridor",
    });

  /** from から to へ 1 回の continueStroke で動いた時に塗られたマス */
  function stroke(from: CellXZ, to: CellXZ): CellXZ[] {
    const s = blank(12, 12);
    const done = endStroke(continueStroke(beginStroke(s, from), to));
    return changedCells(s.plan, done.plan);
  }

  /** マスの集合が from から to への上下左右につながった最短の道か */
  function expectConnectedPath(cells: CellXZ[], from: CellXZ, to: CellXZ): void {
    const key = (c: CellXZ) => `${c.x},${c.z}`;
    const set = new Set(cells.map(key));
    expect(set.has(key(from))).toBe(true);
    expect(set.has(key(to))).toBe(true);
    // 上下左右に隣り合うマスだけでたどれる
    const seen = new Set([key(from)]);
    const queue = [from];
    while (queue.length > 0) {
      const c = queue.shift() as CellXZ;
      for (const [dx, dz] of [
        [1, 0],
        [-1, 0],
        [0, 1],
        [0, -1],
      ]) {
        const n = { x: c.x + dx, z: c.z + dz };
        if (set.has(key(n)) && !seen.has(key(n))) {
          seen.add(key(n));
          queue.push(n);
        }
      }
    }
    expect(seen.has(key(to))).toBe(true);
    expect(seen.size).toBe(set.size);
    // 遠回りしない（マンハッタン距離 + 1 マス）
    expect(cells).toHaveLength(Math.abs(to.x - from.x) + Math.abs(to.z - from.z) + 1);
    // from と to を囲む長方形の中だけ
    for (const c of cells) {
      expect(c.x).toBeGreaterThanOrEqual(Math.min(from.x, to.x));
      expect(c.x).toBeLessThanOrEqual(Math.max(from.x, to.x));
      expect(c.z).toBeGreaterThanOrEqual(Math.min(from.z, to.z));
      expect(c.z).toBeLessThanOrEqual(Math.max(from.z, to.z));
    }
  }

  it.each<[string, CellXZ, CellXZ]>([
    ["右へまっすぐ", at(1, 1), at(8, 1)],
    ["左へまっすぐ", at(8, 1), at(1, 1)],
    ["下へまっすぐ", at(3, 0), at(3, 10)],
    ["上へまっすぐ", at(3, 10), at(3, 0)],
    ["右下へ斜め 45°", at(0, 0), at(5, 5)],
    ["左上へ斜め 45°", at(5, 5), at(0, 0)],
    ["右上へ斜め", at(1, 9), at(10, 2)],
    ["左下へ斜め", at(10, 2), at(1, 9)],
    ["ゆるい斜め", at(0, 4), at(11, 6)],
    ["急な斜め", at(4, 0), at(6, 11)],
    ["斜め隣（1 マス）", at(5, 5), at(6, 6)],
  ])("%s: 上下左右につながる", (_, from, to) => {
    expectConnectedPath(stroke(from, to), from, to);
  });

  it("続けて何度動いてもすべてつながる", () => {
    const s = blank(12, 12);
    const points = [at(0, 0), at(7, 3), at(2, 9), at(11, 11), at(11, 0)];
    let t = beginStroke(s, points[0]);
    for (const p of points.slice(1)) t = continueStroke(t, p);
    t = endStroke(t);
    expect(t.past).toHaveLength(1);
    const painted = new Set(changedCells(s.plan, t.plan).map((c) => `${c.x},${c.z}`));
    for (let i = 1; i < points.length; i++) {
      const segment = stroke(points[i - 1], points[i]);
      for (const c of segment) expect(painted.has(`${c.x},${c.z}`)).toBe(true);
    }
  });

  it("マス目の外へ出ても，中の部分は切れ目なく塗る", () => {
    const s = blank(5, 5);
    const done = endStroke(continueStroke(beginStroke(s, at(0, 2)), at(9, 2)));
    expect(changedCells(s.plan, done.plan)).toEqual([0, 1, 2, 3, 4].map((x) => at(x, 2)));
    expectValidFloor(done.plan);
  });
});

describe("addRoom", () => {
  it("名前を付けて教室を足し，その教室を塗る道具を選ぶ（1 回分の履歴）", () => {
    const s = state();
    const next = addRoom(s, "  理科室 ");
    expect(next.plan.rooms).toEqual([...s.plan.rooms, { name: "理科室" }]);
    expect(next.tool).toEqual({ kind: "classroom", room: 2 });
    expect(next.past).toEqual([s.plan]);
    expect(undo(next).plan).toBe(s.plan);
  });

  it.each(["", "   "])("名前が空（%j）なら「教室 n」", (name) => {
    const next = addRoom(state(), name);
    expect(next.plan.rooms[2]).toEqual({ name: "教室 3" });
  });

  it("名前を省くと「教室 n」", () => {
    expect(addRoom(state({ rows: ["h"], rooms: [] })).plan.rooms).toEqual([{ name: "教室 1" }]);
  });

  it("「教室 n」が使われていれば使われていない番号にする", () => {
    const next = addRoom(state({ rooms: [{ name: "教室 3" }, { name: "教室 4" }] }));
    expect(next.plan.rooms.map((r) => r.name)).toEqual(["教室 3", "教室 4", "教室 5"]);
  });

  it("足した教室で塗れる", () => {
    let s = addRoom(state(), "音楽室");
    s = paintCell(s, at(3, 2));
    expect(cellAt(s, 3, 2)).toEqual(["classroom", 2]);
    expectValidFloor(s.plan);
  });

  it("マス目は変えず，入力の校舎を書き換えない", () => {
    const original = plan();
    const snapshot = JSON.stringify(original);
    const next = addRoom(createEditorState(original), "x");
    expect(next.plan.floors[0]).toBe(original.floors[0]);
    expect(JSON.stringify(original)).toBe(snapshot);
  });
});

describe("renameRoom", () => {
  it("名前を変える（前後の空白を除く．1 回分の履歴）", () => {
    const s = state();
    const next = renameRoom(s, 1, "  2年1組  ");
    expect(next.plan.rooms).toEqual([{ name: "1年1組" }, { name: "2年1組" }]);
    expect(next.past).toEqual([s.plan]);
    expect(undo(next).plan).toBe(s.plan);
  });

  it.each<[string, number, string]>([
    ["空の名前", 0, ""],
    ["空白だけの名前", 0, "   "],
    ["同じ名前", 0, "1年1組"],
    ["空白を除くと同じ名前", 0, " 1年1組 "],
    ["無い教室", 2, "x"],
    ["負の添字", -1, "x"],
    ["整数でない添字", 0.5, "x"],
    ["NaN の添字", Number.NaN, "x"],
  ])("%s は何もしない", (_, room, name) => {
    const s = state();
    const next = renameRoom(s, room, name);
    expect(next.plan).toBe(s.plan);
    expect(next.past).toHaveLength(0);
  });

  it("入力の校舎を書き換えない", () => {
    const original = plan();
    const snapshot = JSON.stringify(original);
    renameRoom(createEditorState(original), 0, "新しい名前");
    expect(JSON.stringify(original)).toBe(snapshot);
  });
});

describe("resizeGrid", () => {
  it(`MAX_GRID_SIZE は 80`, () => {
    expect(MAX_GRID_SIZE).toBe(80);
  });

  it("大きくすると，残るマスは同じ (x, z) に保ち，増えたマスは void・-1", () => {
    const s = state();
    const next = resizeGrid(s, 6, 5);
    const f = editingFloor(next);
    expect(f.width).toBe(6);
    expect(f.depth).toBe(5);
    expectValidFloor(next.plan);
    const old = editingFloor(s);
    for (let z = 0; z < 5; z++) {
      for (let x = 0; x < 6; x++) {
        const got = cellAt(next, x, z);
        if (x < old.width && z < old.depth) {
          const i = z * old.width + x;
          expect(got).toEqual([old.cells[i], old.roomOf[i]]);
        } else {
          expect(got).toEqual(["void", -1]);
        }
      }
    }
  });

  it("小さくすると，左上から残るマスを保つ", () => {
    const next = resizeGrid(state(), 2, 2);
    const f = editingFloor(next);
    expect(f.width).toBe(2);
    expect(f.depth).toBe(2);
    expect(f.cells).toEqual(["classroom", "classroom", "classroom", "classroom"]);
    expect(f.roomOf).toEqual([0, 0, 0, 1]);
  });

  it("幅だけ・奥行きだけを変えられる", () => {
    const wide = editingFloor(resizeGrid(state(), 5, 3));
    expect(wide.cells.slice(0, 5)).toEqual([
      "classroom",
      "classroom",
      "corridor",
      "corridor",
      "void",
    ]);
    const deep = editingFloor(resizeGrid(state(), 4, 4));
    expect(deep.cells.slice(8, 16)).toEqual([
      "outdoor",
      "outdoor",
      "outdoor",
      "outdoor",
      "void",
      "void",
      "void",
      "void",
    ]);
  });

  it("1 回分の履歴になり，元に戻すと元の校舎に戻る", () => {
    const s = state();
    const next = resizeGrid(s, 10, 10);
    expect(next.past).toEqual([s.plan]);
    expect(undo(next).plan).toBe(s.plan);
    expect(redo(undo(next)).plan).toBe(next.plan);
  });

  it("小さくしてから元の大きさに戻すと，消えたマスは void になる（元に戻すでは復元できる）", () => {
    let s = state();
    const original = s.plan;
    s = resizeGrid(resizeGrid(s, 1, 1), 4, 3);
    expect(cellAt(s, 3, 2)).toEqual(["void", -1]);
    s = undo(undo(s));
    expect(s.plan).toBe(original);
  });

  it("同じ大きさなら何もしない", () => {
    const s = state();
    const next = resizeGrid(s, 4, 3);
    expect(next.plan).toBe(s.plan);
    expect(next.past).toHaveLength(0);
  });

  it.each<[string, number, number, number, number]>([
    ["0 は 1 に", 0, 0, 1, 1],
    ["負の数は 1 に", -5, -1, 1, 1],
    ["上限を超えたら 80 に", 81, 1000, 80, 80],
    ["上限ちょうど", 80, 80, 80, 80],
    ["小数は四捨五入", 2.6, 4.4, 3, 4],
    ["NaN は今の値", Number.NaN, 7, 4, 7],
    ["奥行きの NaN は今の値", 7, Number.NaN, 7, 3],
    ["Infinity は 80 に", Number.POSITIVE_INFINITY, Number.POSITIVE_INFINITY, 80, 80],
    ["-Infinity は 1 に", Number.NEGATIVE_INFINITY, Number.NEGATIVE_INFINITY, 1, 1],
  ])("%s", (_, w, d, ew, ed) => {
    const next = resizeGrid(state(), w, d);
    const f = editingFloor(next);
    expect([f.width, f.depth]).toEqual([ew, ed]);
    expectValidFloor(next.plan);
  });

  it("訓練条件（drill）・名前・マスの大きさ・教室は残す", () => {
    const s = state();
    const next = resizeGrid(s, 1, 1);
    expect(next.plan.drill).toBe(s.plan.drill);
    expect(next.plan.name).toBe(s.plan.name);
    expect(next.plan.cellSize).toBe(s.plan.cellSize);
    expect(next.plan.rooms).toBe(s.plan.rooms);
  });

  it("1 フロア目だけを変え，floors は配列のまま", () => {
    const upper = createFloorFromRows(2, ["hh"]);
    const next = resizeGrid(state({ extraFloors: [upper] }), 6, 6);
    expect(next.plan.floors).toHaveLength(2);
    expect(next.plan.floors[1]).toEqual(upper);
    expect(next.plan.floors[0].level).toBe(1);
  });

  it("入力の校舎を書き換えない", () => {
    const original = plan();
    const snapshot = JSON.stringify(original);
    resizeGrid(createEditorState(original), 8, 2);
    expect(JSON.stringify(original)).toBe(snapshot);
  });

  it("デモの校舎を広げても SPEC_02 の Floor の決まりを満たす", () => {
    const next = resizeGrid(createEditorState(DEMO_SCHOOL), 25, 20);
    expectValidFloor(next.plan);
    const f = editingFloor(next);
    const demo = DEMO_SCHOOL.floors[0];
    expect(cellAt(next, 18, 12)).toEqual([
      demo.cells[12 * demo.width + 18],
      demo.roomOf[12 * demo.width + 18],
    ]);
    expect(f.cells[12 * 25 + 19]).toBe("void");
  });
});

describe("startBlank", () => {
  it("すべて void・-1，教室の一覧は空のマス目になる", () => {
    const next = startBlank(state(), 5, 6);
    const f = editingFloor(next);
    expect(f.width).toBe(5);
    expect(f.depth).toBe(6);
    expect(f.cells).toEqual(new Array(30).fill("void"));
    expect(f.roomOf).toEqual(new Array(30).fill(-1));
    expect(next.plan.rooms).toEqual([]);
    expectValidFloor(next.plan);
  });

  it("名前・マスの大きさ・訓練条件は残す", () => {
    const s = state();
    const next = startBlank(s, 5, 5);
    expect(next.plan.name).toBe(s.plan.name);
    expect(next.plan.cellSize).toBe(s.plan.cellSize);
    expect(next.plan.drill).toBe(s.plan.drill);
    expect(next.plan.version).toBe(1);
  });

  it("元に戻せる（元の校舎に戻る）", () => {
    const s = state();
    const next = startBlank(s, 5, 5);
    expect(next.past).toEqual([s.plan]);
    expect(undo(next).plan).toBe(s.plan);
  });

  it("教室が無くなるので，道具が教室なら廊下に直す", () => {
    const next = startBlank(state(), 5, 5);
    expect(next.tool).toEqual({ kind: "corridor" });
    const undone = undo(next);
    // 教室の道具は戻らなくてもよいが，有効な道具であること
    if (undone.tool.kind === "classroom") {
      expect(undone.tool.room).toBeLessThan(undone.plan.rooms.length);
    }
  });

  it.each<[number, number, number, number]>([
    [0, 0, 1, 1],
    [200, 200, 80, 80],
    [Number.NaN, Number.NaN, 4, 3],
    [Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY, 80, 1],
  ])("大きさ (%s, %s) は (%s, %s) に丸める", (w, d, ew, ed) => {
    const f = editingFloor(startBlank(state(), w, d));
    expect([f.width, f.depth]).toEqual([ew, ed]);
    expect(f.cells).toHaveLength(ew * ed);
  });

  it("1 フロア目だけを空にし，floors は配列のまま", () => {
    const upper = createFloorFromRows(2, ["hh"]);
    const next = startBlank(state({ extraFloors: [upper] }), 3, 3);
    expect(next.plan.floors).toHaveLength(2);
    expect(next.plan.floors[1]).toEqual(upper);
  });

  it("入力の校舎を書き換えない", () => {
    const original = plan();
    const snapshot = JSON.stringify(original);
    startBlank(createEditorState(original), 3, 3);
    expect(JSON.stringify(original)).toBe(snapshot);
  });
});

describe("一連の編集", () => {
  it("空のマス目から教室・廊下・ドアを置いて校舎を作り，すべて元に戻すと最初に戻る", () => {
    const initial = createEditorState(DEMO_SCHOOL);
    let s = startBlank(initial, 6, 4);
    s = addRoom(s, "1年1組");
    s = endStroke(continueStroke(beginStroke(s, at(0, 0)), at(5, 1)));
    s = selectTool(s, { kind: "corridor" });
    s = endStroke(continueStroke(beginStroke(s, at(0, 3)), at(5, 3)));
    s = selectTool(s, { kind: "door" });
    s = paintCell(s, at(2, 2));
    expectValidFloor(s.plan);
    expect(cellAt(s, 2, 2)).toEqual(["door", -1]);
    expect(cellAt(s, 5, 3)).toEqual(["corridor", -1]);
    expect(s.past).toHaveLength(5);
    while (canUndo(s)) s = undo(s);
    expect(s.plan).toBe(DEMO_SCHOOL);
  });
});

// ---- 訓練条件（火元・開始地点・向き・集合場所）を置く操作（Issue #116・PLAN_04 E3・SPEC_02 の DrillSetup） ----
// 既定のマス目（4 × 3）:
//   z=0: 教室0 教室0 廊下 廊下
//   z=1: 教室0 教室1 廊下 廊下
//   z=2: 屋外  屋外  屋外 屋外

const ref = (x: number, z: number, floor = 0): CellRef => ({ floor, x, z });

/** テスト用の訓練条件（既定のマス目で validatePlan が誤りを出さない） */
const TEST_DRILL: DrillSetup = {
  mode: "learn",
  fireOrigins: [ref(3, 0)],
  start: ref(1, 1),
  startYaw: 0,
  assembly: [ref(3, 2)],
  route: [ref(1, 1), ref(2, 1), ref(3, 1), ref(3, 2)],
  spread: DEMO_SCHOOL.drill.spread,
  timeLimitSeconds: DEMO_SCHOOL.drill.timeLimitSeconds,
};

/** 訓練条件の一部だけを上書きした校舎で状態を作る（凍らせてある） */
function drillState(
  drill: Partial<DrillSetup> = {},
  options: Omit<NonNullable<Parameters<typeof plan>[0]>, "overrides"> = {},
): EditorState {
  return createEditorState(plan({ ...options, overrides: { drill: { ...TEST_DRILL, ...drill } } }));
}

/** 置けない位置（マス目の外・整数でない・数でない） */
const OUTSIDE_CELLS: readonly CellXZ[] = [
  at(-1, 0),
  at(0, -1),
  at(4, 0),
  at(0, 3),
  at(4, 3),
  at(0.5, 0),
  at(0, 1.5),
  at(Number.NaN, 0),
  at(0, Number.NaN),
  at(Number.POSITIVE_INFINITY, 0),
  at(0, Number.NEGATIVE_INFINITY),
];

/** 置けなかった時: 理由が返り，校舎は同じ参照・履歴は変わらない */
function expectRejected(
  before: EditorState,
  result: { state: EditorState; reason: string | null },
  reason: string,
): void {
  expect(result.reason).toBe(reason);
  expect(result.state.plan).toBe(before.plan);
  expect(result.state.past).toEqual(before.past);
  expect(result.state.future).toEqual(before.future);
}

/** drill のうち，指定した項目以外が変わっていない（同じ値） */
function expectDrillOthersKept(
  before: SchoolPlan,
  after: SchoolPlan,
  changed: readonly (keyof DrillSetup)[],
): void {
  const keys: (keyof DrillSetup)[] = [
    "mode",
    "fireOrigins",
    "start",
    "startYaw",
    "assembly",
    "route",
    "spread",
    "timeLimitSeconds",
  ];
  for (const key of keys) {
    if (changed.includes(key)) continue;
    expect(after.drill[key]).toEqual(before.drill[key]);
  }
  // 訓練条件以外（マス目・教室・名前）も変えない
  expect(after.floors).toBe(before.floors);
  expect(after.rooms).toBe(before.rooms);
  expect(after.name).toBe(before.name);
  expect(after.cellSize).toBe(before.cellSize);
}

describe("訓練条件のテスト用データ", () => {
  it("既定の訓練条件は validatePlan の誤りが無い（以降のテストの前提）", () => {
    expect(validatePlan(drillState().plan)).toEqual([]);
  });

  it("EDIT_FLOOR は 1 フロア目（0）", () => {
    expect(EDIT_FLOOR).toBe(0);
  });
});

describe("isMarkerTool", () => {
  it.each<MarkerKind>(["fireOrigin", "start", "assembly"])("%s は置く道具", (kind) => {
    expect(isMarkerTool({ kind })).toBe(true);
  });

  it.each<EditorTool>([
    { kind: "corridor" },
    { kind: "outdoor" },
    { kind: "void" },
    { kind: "classroom", room: 0 },
  ])("塗る道具 %o は置く道具ではない", (tool) => {
    expect(isMarkerTool(tool)).toBe(false);
  });
});

describe("selectTool（置く道具）", () => {
  it.each<MarkerKind>(["fireOrigin", "start", "assembly"])(
    "%s を選べる．校舎と履歴は変わらない",
    (kind) => {
      const s = drillState();
      const next = selectTool(s, { kind });
      expect(next.tool).toEqual({ kind });
      expect(next.plan).toBe(s.plan);
      expect(next.past).toEqual([]);
    },
  );
});

describe("markerRejection", () => {
  it.each<[MarkerKind, CellXZ, string | null]>([
    ["fireOrigin", at(0, 0), null],
    ["fireOrigin", at(2, 0), null],
    ["fireOrigin", at(0, 2), null],
    ["start", at(0, 0), null],
    ["start", at(1, 1), null],
    ["start", at(2, 0), MARKER_REASONS.startNotClassroom],
    ["start", at(0, 2), MARKER_REASONS.startNotClassroom],
    ["assembly", at(0, 2), null],
    ["assembly", at(3, 2), null],
    ["assembly", at(0, 0), MARKER_REASONS.assemblyNotOutdoor],
    ["assembly", at(2, 1), MARKER_REASONS.assemblyNotOutdoor],
  ])("%s を %o に置く → %s", (kind, cell, reason) => {
    expect(markerRejection(drillState(), kind, cell)).toBe(reason);
  });

  it.each(["door", "exit", "shutter", "wall", "void"] as const)(
    "開始地点は教室以外（%s）に置けず，集合場所も屋外以外に置けない",
    (kind) => {
      const ch = { door: "d", exit: "e", shutter: "s", wall: "#", void: "." }[kind];
      const s = drillState({}, { rows: ["00hh", `01h${ch}`, "oooo"] });
      expect(editingFloor(s).cells[1 * 4 + 3]).toBe(kind);
      expect(markerRejection(s, "start", at(3, 1))).toBe(MARKER_REASONS.startNotClassroom);
      expect(markerRejection(s, "assembly", at(3, 1))).toBe(MARKER_REASONS.assemblyNotOutdoor);
    },
  );

  it.each<MarkerKind>(["fireOrigin", "start", "assembly"])(
    "%s はマス目の外・整数でない・数でない位置には置けない",
    (kind) => {
      for (const cell of OUTSIDE_CELLS) {
        expect(markerRejection(drillState(), kind, cell)).toBe(MARKER_REASONS.outside);
      }
    },
  );

  it("理由はどれも空でない日本語の文", () => {
    for (const reason of Object.values(MARKER_REASONS)) {
      expect(reason.length).toBeGreaterThan(0);
    }
    expect(new Set(Object.values(MARKER_REASONS)).size).toBe(3);
  });
});

describe("toggleFireOrigin", () => {
  it.each<[string, CellXZ]>([
    ["教室", at(0, 0)],
    ["廊下", at(2, 1)],
    ["屋外", at(0, 2)],
  ])("%s のマスに火元を足せる（1 回分の履歴になる）", (_, cell) => {
    const s = drillState();
    const { state: next, reason } = toggleFireOrigin(s, cell);
    expect(reason).toBeNull();
    expect(next.plan.drill.fireOrigins).toEqual([ref(3, 0), ref(cell.x, cell.z)]);
    expect(next.past).toHaveLength(1);
    expect(next.past[0]).toBe(s.plan);
    expect(next.future).toEqual([]);
    expectDrillOthersKept(s.plan, next.plan, ["fireOrigins"]);
  });

  it("足した位置は編集中の階（EDIT_FLOOR）を指す", () => {
    const { state: next } = toggleFireOrigin(drillState(), at(1, 0));
    expect(next.plan.drill.fireOrigins.at(-1)?.floor).toBe(EDIT_FLOOR);
  });

  it("同じマスをもう一度選ぶと外す（最後の 1 つも外せ，validatePlan の誤りになる）", () => {
    const s = drillState();
    const { state: next, reason } = toggleFireOrigin(s, at(3, 0));
    expect(reason).toBeNull();
    expect(next.plan.drill.fireOrigins).toEqual([]);
    expect(next.past).toHaveLength(1);
    expect(validatePlan(next.plan)).toContain("火元が 1 つもありません");
    expectDrillOthersKept(s.plan, next.plan, ["fireOrigins"]);
  });

  it("足して外すと元の火元に戻る（同じマスが 2 つにならない）", () => {
    let s = drillState();
    s = toggleFireOrigin(s, at(0, 0)).state;
    s = toggleFireOrigin(s, at(0, 0)).state;
    expect(s.plan.drill.fireOrigins).toEqual([ref(3, 0)]);
    expect(s.past).toHaveLength(2);
  });

  it("複数の中から 1 つだけ外せる", () => {
    const s = drillState({ fireOrigins: [ref(0, 0), ref(2, 0), ref(3, 0)] });
    const { state: next } = toggleFireOrigin(s, at(2, 0));
    expect(next.plan.drill.fireOrigins).toEqual([ref(0, 0), ref(3, 0)]);
  });

  it("元に戻す・やり直すで前後の校舎に戻る", () => {
    const s = drillState();
    const added = toggleFireOrigin(s, at(0, 0)).state;
    const undone = undo(added);
    expect(undone.plan).toBe(s.plan);
    expect(canRedo(undone)).toBe(true);
    const redone = redo(undone);
    expect(redone.plan).toBe(added.plan);
  });

  it("新しく足すと，やり直す先は捨てる", () => {
    const s = toggleFireOrigin(drillState(), at(0, 0)).state;
    const undone = undo(s);
    const next = toggleFireOrigin(undone, at(1, 0)).state;
    expect(next.future).toEqual([]);
    expect(canRedo(next)).toBe(false);
  });

  it.each(OUTSIDE_CELLS)("マス目の外 %o には置けず，理由が返り履歴に積まない", (cell) => {
    const s = drillState();
    expectRejected(s, toggleFireOrigin(s, cell), MARKER_REASONS.outside);
  });

  it("入力の校舎を書き換えない（凍らせた校舎で例外にならない）", () => {
    const s = drillState();
    const snapshot = JSON.stringify(s.plan);
    expect(() => toggleFireOrigin(s, at(0, 0))).not.toThrow();
    expect(() => toggleFireOrigin(s, at(3, 0))).not.toThrow();
    expect(JSON.stringify(s.plan)).toBe(snapshot);
  });
});

describe("toggleAssembly", () => {
  it("屋外のマスに集合場所を足せる（1 回分の履歴になる）", () => {
    const s = drillState();
    const { state: next, reason } = toggleAssembly(s, at(0, 2));
    expect(reason).toBeNull();
    expect(next.plan.drill.assembly).toEqual([ref(3, 2), ref(0, 2)]);
    expect(next.past).toEqual([s.plan]);
    expectDrillOthersKept(s.plan, next.plan, ["assembly"]);
    expect(validatePlan(next.plan)).toEqual([]);
  });

  it.each<[string, CellXZ]>([
    ["教室", at(0, 0)],
    ["廊下", at(2, 1)],
  ])("%s のマスには置けず，理由が返り履歴に積まない", (_, cell) => {
    const s = drillState();
    expectRejected(s, toggleAssembly(s, cell), MARKER_REASONS.assemblyNotOutdoor);
  });

  it.each(OUTSIDE_CELLS)("マス目の外 %o には置けない", (cell) => {
    const s = drillState();
    expectRejected(s, toggleAssembly(s, cell), MARKER_REASONS.outside);
  });

  it("同じマスをもう一度選ぶと外す（最後の 1 つも外せ，validatePlan の誤りになる）", () => {
    const s = drillState();
    const { state: next, reason } = toggleAssembly(s, at(3, 2));
    expect(reason).toBeNull();
    expect(next.plan.drill.assembly).toEqual([]);
    expect(next.past).toHaveLength(1);
    expect(validatePlan(next.plan)).toContain("集合場所が 1 つもありません");
  });

  it("屋外でなくなったマスの集合場所も，選べば外せる", () => {
    const s = drillState({ assembly: [ref(3, 2), ref(2, 0)] });
    const { state: next, reason } = toggleAssembly(s, at(2, 0));
    expect(reason).toBeNull();
    expect(next.plan.drill.assembly).toEqual([ref(3, 2)]);
  });

  it("元に戻す・やり直すで前後の校舎に戻る", () => {
    const s = drillState();
    const added = toggleAssembly(s, at(1, 2)).state;
    expect(undo(added).plan).toBe(s.plan);
    expect(redo(undo(added)).plan).toBe(added.plan);
  });
});

describe("placeStart", () => {
  it("教室のマスに置くと前の位置から移る（1 つだけ・1 回分の履歴）", () => {
    const s = drillState();
    const { state: next, reason } = placeStart(s, at(0, 0));
    expect(reason).toBeNull();
    expect(next.plan.drill.start).toEqual(ref(0, 0));
    expect(next.past).toEqual([s.plan]);
    expectDrillOthersKept(s.plan, next.plan, ["start"]);
  });

  it("向き（startYaw）は置き直しても変わらない", () => {
    const s = drillState({ startYaw: Math.PI });
    const next = placeStart(s, at(0, 1)).state;
    expect(next.plan.drill.startYaw).toBe(Math.PI);
  });

  it("同じマスに置き直しても何も変わらず，履歴に積まない", () => {
    const s = drillState();
    const result = placeStart(s, at(1, 1));
    expect(result.reason).toBeNull();
    expect(result.state.plan).toBe(s.plan);
    expect(result.state.past).toEqual([]);
  });

  it.each<[string, CellXZ]>([
    ["廊下", at(2, 0)],
    ["屋外", at(0, 2)],
  ])("%s のマスには置けず，理由が返り履歴に積まない", (_, cell) => {
    const s = drillState();
    expectRejected(s, placeStart(s, cell), MARKER_REASONS.startNotClassroom);
  });

  it.each(OUTSIDE_CELLS)("マス目の外 %o には置けない", (cell) => {
    const s = drillState();
    expectRejected(s, placeStart(s, cell), MARKER_REASONS.outside);
  });

  it("元に戻す・やり直すで前後の校舎に戻る", () => {
    const s = drillState();
    const moved = placeStart(s, at(0, 0)).state;
    expect(undo(moved).plan).toBe(s.plan);
    expect(redo(undo(moved)).plan).toBe(moved.plan);
  });
});

describe("setStartFacing", () => {
  it.each<[Facing, number]>([
    ["right", Math.PI / 2],
    ["down", Math.PI],
    ["left", -Math.PI / 2],
  ])("%s を選ぶと startYaw が FACING_YAW の値になる（1 回分の履歴）", (facing, yaw) => {
    const s = drillState({ startYaw: 0 });
    const next = setStartFacing(s, facing);
    expect(next.plan.drill.startYaw).toBeCloseTo(yaw, 12);
    expect(next.plan.drill.startYaw).toBe(FACING_YAW[facing]);
    expect(facingOfYaw(next.plan.drill.startYaw)).toBe(facing);
    expect(next.past).toEqual([s.plan]);
    expectDrillOthersKept(s.plan, next.plan, ["startYaw"]);
  });

  it("今と同じ向きなら何も変わらず，履歴に積まない", () => {
    const s = drillState({ startYaw: 0 });
    const next = setStartFacing(s, "up");
    expect(next.plan).toBe(s.plan);
    expect(next.past).toEqual([]);
  });

  it("4 方向でない向き（0.3 rad）から上を選ぶと 0 になる", () => {
    const s = drillState({ startYaw: 0.3 });
    const next = setStartFacing(s, "up");
    expect(next.plan.drill.startYaw).toBe(0);
    expect(next.past).toHaveLength(1);
  });

  it("元に戻す・やり直すで前後の向きに戻る", () => {
    const s = drillState();
    const turned = setStartFacing(s, "left");
    expect(undo(turned).plan).toBe(s.plan);
    expect(redo(undo(turned)).plan).toBe(turned.plan);
  });
});

describe("placeMarker", () => {
  it("塗る道具の時は何もしない（理由も出さない）", () => {
    const s = drillState();
    const result = placeMarker(s, at(0, 0));
    expect(result.state).toBe(s);
    expect(result.reason).toBeNull();
  });

  it("火元の道具ではマスの火元を足し・外す", () => {
    const s = selectTool(drillState(), { kind: "fireOrigin" });
    const added = placeMarker(s, at(0, 0));
    expect(added.reason).toBeNull();
    expect(added.state.plan.drill.fireOrigins).toEqual([ref(3, 0), ref(0, 0)]);
    const removed = placeMarker(added.state, at(0, 0));
    expect(removed.state.plan.drill.fireOrigins).toEqual([ref(3, 0)]);
  });

  it("開始地点の道具では教室に置き，教室以外は理由を返す", () => {
    const s = selectTool(drillState(), { kind: "start" });
    expect(placeMarker(s, at(0, 0)).state.plan.drill.start).toEqual(ref(0, 0));
    expectRejected(s, placeMarker(s, at(2, 0)), MARKER_REASONS.startNotClassroom);
  });

  it("集合場所の道具では屋外に置き，屋外以外は理由を返す", () => {
    const s = selectTool(drillState(), { kind: "assembly" });
    expect(placeMarker(s, at(0, 2)).state.plan.drill.assembly).toEqual([ref(3, 2), ref(0, 2)]);
    expectRejected(s, placeMarker(s, at(0, 0)), MARKER_REASONS.assemblyNotOutdoor);
  });

  it("置いた後も道具は変わらない", () => {
    const s = selectTool(drillState(), { kind: "assembly" });
    expect(placeMarker(s, at(0, 2)).state.tool).toEqual({ kind: "assembly" });
  });
});

describe("置く道具の時の塗る操作", () => {
  it.each<MarkerKind>(["fireOrigin", "start", "assembly"])(
    "%s の道具では paintCell は塗らず，履歴に積まない",
    (kind) => {
      const s = selectTool(drillState(), { kind });
      const next = paintCell(s, at(2, 0));
      expect(next.plan).toBe(s.plan);
      expect(next.past).toEqual([]);
    },
  );

  it.each<MarkerKind>(["fireOrigin", "start", "assembly"])(
    "%s の道具ではドラッグしても塗らず，履歴に積まない",
    (kind) => {
      const s = selectTool(drillState(), { kind });
      const dragged = endStroke(continueStroke(beginStroke(s, at(0, 0)), at(3, 1)));
      expect(dragged.plan).toEqual(s.plan);
      expect(changedCells(s.plan, dragged.plan)).toEqual([]);
      expect(dragged.past).toEqual([]);
    },
  );

  it("塗る道具に戻せば塗れる", () => {
    let s = selectTool(drillState(), { kind: "fireOrigin" });
    s = selectTool(s, { kind: "wall" });
    s = paintCell(s, at(2, 0));
    expect(cellAt(s, 2, 0)).toEqual(["wall", -1]);
    expect(s.past).toHaveLength(1);
  });

  it("ドラッグで塗っている途中に置くと，塗った分と置いた分が別々の履歴になる", () => {
    const s0 = selectTool(drillState(), { kind: "corridor" });
    const painting = continueStroke(beginStroke(s0, at(0, 0)), at(1, 0));
    const { state: placed } = toggleFireOrigin(painting, at(2, 1));
    expect(placed.stroke).toBeNull();
    expect(placed.past).toHaveLength(2);
    expect(placed.plan.drill.fireOrigins).toContainEqual(ref(2, 1));
    const once = undo(placed);
    expect(once.plan.drill.fireOrigins).toEqual([ref(3, 0)]);
    expect(cellAt(once, 0, 0)).toEqual(["corridor", -1]);
    expect(undo(once).plan).toBe(s0.plan);
  });
});

describe("塗り替え・大きさの変更の後の訓練条件", () => {
  it("開始地点の教室を廊下に塗り替えても開始地点は残り，validatePlan の誤りになる", () => {
    let s = drillState();
    s = selectTool(s, { kind: "corridor" });
    s = paintCell(s, at(1, 1));
    expect(s.plan.drill.start).toEqual(ref(1, 1));
    expect(validatePlan(s.plan)).toContain("開始地点 1階の (1, 1) が教室のマスではありません");
  });

  it("集合場所の屋外を廊下に塗り替えても集合場所は残り，validatePlan の誤りになる", () => {
    let s = drillState();
    s = selectTool(s, { kind: "corridor" });
    s = paintCell(s, at(3, 2));
    expect(s.plan.drill.assembly).toEqual([ref(3, 2)]);
    expect(validatePlan(s.plan)).toContain("集合場所 1階の (3, 2) が屋外のマスではありません");
  });

  it("火元のマスを塗り替えても火元は残る", () => {
    let s = drillState();
    s = selectTool(s, { kind: "wall" });
    s = paintCell(s, at(3, 0));
    expect(s.plan.drill.fireOrigins).toEqual([ref(3, 0)]);
  });

  it("小さくしてマス目の外に出ても火元・集合場所は残り，validatePlan の誤りになる", () => {
    const s = drillState();
    const next = resizeGrid(s, 2, 2);
    expect(next.plan.drill).toEqual(s.plan.drill);
    const errors = validatePlan(next.plan);
    expect(errors.some((e) => /^火元 1.*\(3, 0\).*マス目の外/.test(e))).toBe(true);
    expect(errors.some((e) => /^集合場所 1.*\(3, 2\).*マス目の外/.test(e))).toBe(true);
  });

  it("大きさを元に戻すと誤りが消える", () => {
    const s = drillState();
    const back = undo(resizeGrid(s, 2, 2));
    expect(validatePlan(back.plan)).toEqual([]);
  });
});

describe("訓練条件の一連の編集", () => {
  it("1 操作が 1 回分の履歴になり，すべて元に戻すと最初の校舎に戻る", () => {
    const original = drillState();
    const snapshot = JSON.stringify(original.plan);
    let s = original;
    s = toggleFireOrigin(s, at(0, 2)).state;
    expect(s.past).toHaveLength(1);
    s = toggleFireOrigin(s, at(3, 0)).state;
    expect(s.past).toHaveLength(2);
    s = placeStart(s, at(0, 0)).state;
    expect(s.past).toHaveLength(3);
    s = setStartFacing(s, "down");
    expect(s.past).toHaveLength(4);
    s = toggleAssembly(s, at(0, 2)).state;
    expect(s.past).toHaveLength(5);
    s = toggleAssembly(s, at(0, 0)).state; // 置けない
    expect(s.past).toHaveLength(5);

    const drill = s.plan.drill;
    expect(drill.fireOrigins).toEqual([ref(0, 2)]);
    expect(drill.start).toEqual(ref(0, 0));
    expect(drill.startYaw).toBe(Math.PI);
    expect(drill.assembly).toEqual([ref(3, 2), ref(0, 2)]);
    expect(drill.route).toEqual(TEST_DRILL.route);
    expect(drill.spread).toEqual(TEST_DRILL.spread);
    expect(drill.timeLimitSeconds).toBe(TEST_DRILL.timeLimitSeconds);
    expect(drill.mode).toBe(TEST_DRILL.mode);

    const done = s;
    while (canUndo(s)) s = undo(s);
    expect(s.plan).toBe(original.plan);
    while (canRedo(s)) s = redo(s);
    expect(s.plan).toBe(done.plan);
    expect(JSON.stringify(original.plan)).toBe(snapshot);
  });
});

describe("FACING_YAW / FACINGS（SPEC_02: 0 が -Z（エディタの上）向き，右回りに増える）", () => {
  it("上下左右が 1 つずつ並ぶ", () => {
    expect(new Set(FACINGS)).toEqual(new Set<Facing>(["up", "right", "down", "left"]));
    expect(FACINGS).toHaveLength(4);
  });

  it("上は 0 rad", () => {
    expect(FACING_YAW.up).toBe(0);
  });

  it("上から右回りに 90° ずつ: 右 π/2・下 π・左 3π/2（-π/2 と同じ向き）", () => {
    const norm = (a: number) => ((a % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI);
    expect(norm(FACING_YAW.right)).toBeCloseTo(Math.PI / 2, 12);
    expect(norm(FACING_YAW.down)).toBeCloseTo(Math.PI, 12);
    expect(norm(FACING_YAW.left)).toBeCloseTo((3 * Math.PI) / 2, 12);
  });
});

describe("yawToGridDirection", () => {
  it.each<[Facing, number, number]>([
    ["up", 0, -1],
    ["right", 1, 0],
    ["down", 0, 1],
    ["left", -1, 0],
  ])("%s の向きはマス目の (x %s, z %s) 方向（x は右・z は画面の下）", (facing, x, z) => {
    const d = yawToGridDirection(FACING_YAW[facing]);
    expect(d.x).toBeCloseTo(x, 12);
    expect(d.z).toBeCloseTo(z, 12);
  });

  it.each([0, 0.3, 1, Math.PI / 4, 2, -2.5, 10])("長さは 1（%s rad）", (yaw) => {
    const d = yawToGridDirection(yaw);
    expect(Math.hypot(d.x, d.z)).toBeCloseTo(1, 12);
  });
});

describe("facingOfYaw", () => {
  it.each(FACINGS)("FACING_YAW の %s を戻すと同じ向き", (facing) => {
    expect(facingOfYaw(FACING_YAW[facing])).toBe(facing);
  });

  it.each(FACINGS)("2π 回った向き（%s）も同じ向き", (facing) => {
    expect(facingOfYaw(FACING_YAW[facing] + 2 * Math.PI)).toBe(facing);
    expect(facingOfYaw(FACING_YAW[facing] - 2 * Math.PI)).toBe(facing);
    expect(facingOfYaw(FACING_YAW[facing] + 6 * Math.PI)).toBe(facing);
  });

  it.each<[number, Facing]>([
    [Math.PI / 4 - 0.01, "up"],
    [Math.PI / 4 + 0.01, "right"],
    [(3 * Math.PI) / 4 - 0.01, "right"],
    [(3 * Math.PI) / 4 + 0.01, "down"],
    [(5 * Math.PI) / 4 - 0.01, "down"],
    [(5 * Math.PI) / 4 + 0.01, "left"],
    [-Math.PI / 4 + 0.01, "up"],
    [-Math.PI / 4 - 0.01, "left"],
    [-Math.PI + 0.01, "down"],
    [0.3, "up"],
  ])("%s rad は最も近い %s", (yaw, facing) => {
    expect(facingOfYaw(yaw)).toBe(facing);
  });

  it.each<[number, readonly Facing[]]>([
    [Math.PI / 4, ["up", "right"]],
    [(3 * Math.PI) / 4, ["right", "down"]],
    [-Math.PI / 4, ["up", "left"]],
  ])("ちょうど真ん中（%s rad）は隣り合う 2 つのどちらか", (yaw, candidates) => {
    expect(candidates).toContain(facingOfYaw(yaw));
  });

  it.each([Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY])(
    "数でない（%s）時は null",
    (yaw) => {
      expect(facingOfYaw(yaw)).toBeNull();
    },
  );
});

// ---- 訓練のモード（学習／テスト）を選ぶ操作（Issue #130・PLAN_04 E6・SPEC_02 の DrillSetup.mode） ----
describe("setDrillMode", () => {
  it.each<[DrillSetup["mode"], DrillSetup["mode"]]>([
    ["learn", "test"],
    ["test", "learn"],
  ])(
    "%s から %s を選ぶとモードが変わる（1 回分の履歴．ほかの訓練条件・マス目は変えない）",
    (from, to) => {
      const s = drillState({ mode: from });
      const next = setDrillMode(s, to);
      expect(next.plan.drill.mode).toBe(to);
      expect(next.past).toEqual([s.plan]);
      expect(next.future).toEqual([]);
      expectDrillOthersKept(s.plan, next.plan, ["mode"]);
      expect(validatePlan(next.plan)).toEqual([]);
    },
  );

  it.each<DrillSetup["mode"]>(["learn", "test"])(
    "今と同じモード（%s）なら同じ状態を返し，履歴に積まない",
    (mode) => {
      const s = drillState({ mode });
      const next = setDrillMode(s, mode);
      expect(next.plan).toBe(s.plan);
      expect(next.past).toEqual([]);
      expect(canUndo(next)).toBe(false);
    },
  );

  it("元に戻す・やり直すで前後のモードに戻る", () => {
    const s = drillState({ mode: "learn" });
    const changed = setDrillMode(s, "test");
    const undone = undo(changed);
    expect(undone.plan).toBe(s.plan);
    expect(undone.plan.drill.mode).toBe("learn");
    expect(canRedo(undone)).toBe(true);
    const redone = redo(undone);
    expect(redone.plan).toBe(changed.plan);
    expect(redone.plan.drill.mode).toBe("test");
  });

  it("モードを選ぶと，やり直しの履歴は消える", () => {
    const s = drillState({ mode: "learn" });
    const undone = undo(setStartFacing(s, "left"));
    expect(canRedo(undone)).toBe(true);
    const next = setDrillMode(undone, "test");
    expect(canRedo(next)).toBe(false);
  });

  it("ドラッグの途中で選ぶと，塗りを 1 回分の履歴にしてからモードを変える", () => {
    let s = selectTool(drillState({ mode: "learn" }), { kind: "corridor" });
    const before = s.plan;
    s = beginStroke(s, at(0, 2));
    const next = setDrillMode(s, "test");
    expect(next.stroke).toBeNull();
    expect(next.plan.drill.mode).toBe("test");
    expect(next.past).toHaveLength(2);
    expect(next.past[0]).toBe(before);
    const undoneOnce = undo(next);
    expect(undoneOnce.plan.drill.mode).toBe("learn");
    expect(cellAt(undoneOnce, 0, 2)[0]).toBe("corridor");
    expect(undo(undoneOnce).plan).toBe(before);
  });
});

// 延焼の速さ・制限時間（E4．SPEC_02 の SpreadSettings・DrillSetup.timeLimitSeconds．Issue #132: 値が変わらなければ履歴に積まない）

/** 受け付けない秒数（0 以下・数でない・無限） */
const INVALID_SECONDS: readonly number[] = [
  0,
  -0,
  -1,
  -0.001,
  Number.NaN,
  Number.POSITIVE_INFINITY,
  Number.NEGATIVE_INFINITY,
];

describe("isValidSeconds", () => {
  it.each([0.001, 0.5, 1, 2, 6, 150, 1e6])("0 より大きい有限の数（%s）は受け付ける", (v) => {
    expect(isValidSeconds(v)).toBe(true);
  });

  it.each(INVALID_SECONDS)("0 以下・NaN・無限（%s）は受け付けない", (v) => {
    expect(isValidSeconds(v)).toBe(false);
  });

  it("受け付けた値を入れた校舎は validatePlan の誤りが無く，受け付けない値は誤りになる（同じ条件）", () => {
    for (const v of [0.5, 6, 150]) {
      const p = drillState({ timeLimitSeconds: v }).plan;
      expect(validatePlan(p)).toEqual([]);
    }
    for (const v of INVALID_SECONDS) {
      const p = drillState({ timeLimitSeconds: v }).plan;
      expect(validatePlan(p).length).toBeGreaterThan(0);
    }
  });
});

const SPREAD_KEYS: readonly SpreadSecondsKey[] = ["fireSecondsPerCell", "smokeSecondsPerCell"];
const OTHER_KEY: Record<SpreadSecondsKey, SpreadSecondsKey> = {
  fireSecondsPerCell: "smokeSecondsPerCell",
  smokeSecondsPerCell: "fireSecondsPerCell",
};

describe("setSpreadSeconds", () => {
  const EXTRA = [{ cell: ref(0, 0), atSeconds: 30 }];
  const spreadState = () =>
    drillState({
      spread: { fireSecondsPerCell: 6, smokeSecondsPerCell: 2, extraFires: EXTRA },
    });

  it.each(SPREAD_KEYS)(
    "%s を変えると 1 回分の履歴になり，もう一方の秒数・手で足した延焼箇所・ほかの訓練条件・マス目は変えない",
    (key) => {
      const s = spreadState();
      const next = setSpreadSeconds(s, key, 3.5);
      expect(next.plan.drill.spread[key]).toBe(3.5);
      expect(next.plan.drill.spread[OTHER_KEY[key]]).toBe(s.plan.drill.spread[OTHER_KEY[key]]);
      expect(next.plan.drill.spread.extraFires).toEqual(EXTRA);
      expect(next.past).toEqual([s.plan]);
      expect(next.future).toEqual([]);
      expectDrillOthersKept(s.plan, next.plan, ["spread"]);
      expect(validatePlan(next.plan)).toEqual([]);
    },
  );

  it.each(SPREAD_KEYS)("%s が今と同じ値なら同じ状態を返し，履歴に積まない", (key) => {
    const s = spreadState();
    const next = setSpreadSeconds(s, key, s.plan.drill.spread[key]);
    expect(next.plan).toBe(s.plan);
    expect(next.past).toEqual([]);
    expect(canUndo(next)).toBe(false);
  });

  it.each(SPREAD_KEYS.flatMap((key) => INVALID_SECONDS.map((v) => [key, v] as const)))(
    "%s に受け付けない値（%s）を渡すと何もしない（校舎は同じ参照・履歴に積まない）",
    (key, v) => {
      const s = spreadState();
      const next = setSpreadSeconds(s, key, v);
      expect(next.plan).toBe(s.plan);
      expect(next.past).toEqual([]);
      expect(next.future).toEqual([]);
    },
  );

  it("煙の秒数を火より長くしても受け付ける（誤りにせず，注意は spreadWarnings が出す）", () => {
    const s = spreadState();
    const next = setSpreadSeconds(s, "smokeSecondsPerCell", 10);
    expect(next.plan.drill.spread.smokeSecondsPerCell).toBe(10);
    expect(validatePlan(next.plan)).toEqual([]);
  });

  it("元に戻す・やり直すで前後の秒数（同じ参照の校舎）に戻る", () => {
    const s = spreadState();
    const changed = setSpreadSeconds(s, "fireSecondsPerCell", 2);
    const undone = undo(changed);
    expect(undone.plan).toBe(s.plan);
    expect(undone.plan.drill.spread.fireSecondsPerCell).toBe(6);
    const redone = redo(undone);
    expect(redone.plan).toBe(changed.plan);
    expect(redone.plan.drill.spread.fireSecondsPerCell).toBe(2);
  });

  it("続けて 2 回変えると 2 回分の履歴になり，1 回ずつ戻る", () => {
    const s = spreadState();
    const a = setSpreadSeconds(s, "fireSecondsPerCell", 4);
    const b = setSpreadSeconds(a, "smokeSecondsPerCell", 1);
    expect(b.past).toEqual([s.plan, a.plan]);
    expect(undo(b).plan).toBe(a.plan);
    expect(undo(undo(b)).plan).toBe(s.plan);
  });

  it("秒数を変えると，やり直しの履歴は消える．同じ値なら消えない", () => {
    const undone = undo(setStartFacing(spreadState(), "left"));
    expect(canRedo(undone)).toBe(true);
    expect(canRedo(setSpreadSeconds(undone, "fireSecondsPerCell", 6))).toBe(true);
    expect(canRedo(setSpreadSeconds(undone, "fireSecondsPerCell", 7))).toBe(false);
  });

  it("ドラッグの途中で変えると，塗りを 1 回分の履歴にしてから秒数を変える", () => {
    let s = selectTool(spreadState(), { kind: "corridor" });
    const before = s.plan;
    s = beginStroke(s, at(0, 2));
    const next = setSpreadSeconds(s, "fireSecondsPerCell", 3);
    expect(next.stroke).toBeNull();
    expect(next.plan.drill.spread.fireSecondsPerCell).toBe(3);
    expect(next.past).toHaveLength(2);
    expect(next.past[0]).toBe(before);
    const undoneOnce = undo(next);
    expect(undoneOnce.plan.drill.spread.fireSecondsPerCell).toBe(6);
    expect(cellAt(undoneOnce, 0, 2)[0]).toBe("corridor");
    expect(undo(undoneOnce).plan).toBe(before);
  });

  it("ドラッグの途中に同じ値・受け付けない値を渡しても，塗りは確定する（秒数の履歴は積まない）", () => {
    let s = selectTool(spreadState(), { kind: "corridor" });
    const before = s.plan;
    s = beginStroke(s, at(0, 2));
    for (const v of [6, Number.NaN]) {
      const next = setSpreadSeconds(s, "fireSecondsPerCell", v);
      expect(next.stroke).toBeNull();
      expect(next.past).toEqual([before]);
      expect(next.plan.drill.spread.fireSecondsPerCell).toBe(6);
    }
  });
});

describe("setTimeLimit", () => {
  it("制限時間を変えると 1 回分の履歴になり，ほかの訓練条件・マス目は変えない", () => {
    const s = drillState({ timeLimitSeconds: 150 });
    const next = setTimeLimit(s, 90);
    expect(next.plan.drill.timeLimitSeconds).toBe(90);
    expect(next.past).toEqual([s.plan]);
    expectDrillOthersKept(s.plan, next.plan, ["timeLimitSeconds"]);
    expect(validatePlan(next.plan)).toEqual([]);
  });

  it("今と同じ値なら同じ状態を返し，履歴に積まない", () => {
    const s = drillState({ timeLimitSeconds: 150 });
    const next = setTimeLimit(s, 150);
    expect(next.plan).toBe(s.plan);
    expect(canUndo(next)).toBe(false);
  });

  it.each(INVALID_SECONDS)("受け付けない値（%s）を渡すと何もしない", (v) => {
    const s = drillState({ timeLimitSeconds: 150 });
    const next = setTimeLimit(s, v);
    expect(next.plan).toBe(s.plan);
    expect(next.past).toEqual([]);
  });

  it("元に戻す・やり直すで前後の制限時間に戻る", () => {
    const s = drillState({ timeLimitSeconds: 150 });
    const changed = setTimeLimit(s, 60);
    expect(undo(changed).plan).toBe(s.plan);
    expect(redo(undo(changed)).plan).toBe(changed.plan);
  });

  it("ドラッグの途中で変えると，塗りを 1 回分の履歴にしてから制限時間を変える", () => {
    let s = selectTool(drillState({ timeLimitSeconds: 150 }), { kind: "corridor" });
    const before = s.plan;
    s = beginStroke(s, at(0, 2));
    const next = setTimeLimit(s, 60);
    expect(next.stroke).toBeNull();
    expect(next.past).toHaveLength(2);
    expect(next.past[0]).toBe(before);
    expect(undo(next).plan.drill.timeLimitSeconds).toBe(150);
  });
});

// ---- 正解経路の提案と手での修正（Issue #133・PLAN_04 E5・SPEC_01「経路の提案」「結果の評価」・SPEC_02 の DrillSetup.route） ----
// 経路のテスト用のマス目（5 × 5）:
//   z=0: 教室 教室 教室 廊下 廊下
//   z=1: 教室 教室 教室 ドア 廊下
//   z=2: 廊下 廊下 廊下 廊下 廊下
//   z=3: 柱   出口 柱   柱   何もない
//   z=4: 屋外 屋外 屋外 屋外 屋外
const ROUTE_ROWS = ["000hh", "000dh", "hhhhh", "#e##.", "ooooo"];
const ROUTE_TOOL: EditorTool = { kind: "route" };

/** 教室のドア → 廊下 → 出口 → 集合場所（壁をまたがない） */
const FULL_ROUTE: readonly CellRef[] = [
  ref(1, 1),
  ref(2, 1),
  ref(3, 1), // ドア
  ref(3, 2),
  ref(2, 2),
  ref(1, 2),
  ref(1, 3), // 出口
  ref(1, 4),
  ref(2, 4),
  ref(3, 4), // 集合場所
];

const ROUTE_DRILL: DrillSetup = {
  ...TEST_DRILL,
  fireOrigins: [ref(4, 0)],
  start: ref(1, 1),
  assembly: [ref(3, 4)],
  route: FULL_ROUTE,
};

/** 経路のテスト用の校舎で状態を作る（既定は経路の道具を選んだ状態．凍らせてある） */
function routeState(
  drill: Partial<DrillSetup> = {},
  options: { rows?: readonly string[]; tool?: EditorTool } = {},
): EditorState {
  const s = createEditorState(
    plan({
      rows: options.rows ?? ROUTE_ROWS,
      rooms: [{ name: "1年1組" }],
      overrides: { drill: { ...ROUTE_DRILL, ...drill } },
    }),
  );
  return selectTool(s, options.tool ?? ROUTE_TOOL);
}

const demoState = (drill: Partial<DrillSetup> = {}): EditorState =>
  selectTool(
    createEditorState(deepFreeze({ ...DEMO_SCHOOL, drill: { ...DEMO_SCHOOL.drill, ...drill } })),
    ROUTE_TOOL,
  );

const sameCell = (a: CellRef, b: CellRef): boolean =>
  a.floor === b.floor && a.x === b.x && a.z === b.z;

/** 経路が開始地点から集合場所まで，人が一歩ずつ進める列か */
function expectWalkableRoute(p: SchoolPlan): void {
  const { route, start, assembly } = p.drill;
  const f = p.floors[p.drill.start.floor];
  expect(route.length).toBeGreaterThan(1);
  expect(sameCell(route[0], start)).toBe(true);
  expect(assembly.some((a) => sameCell(a, route[route.length - 1]))).toBe(true);
  for (let i = 1; i < route.length; i++) {
    expect(canPersonStep(f, route[i - 1], route[i])).toBe(true);
  }
}

/** ドラッグを begin → continue（順に）→ endStroke で行う */
function dragRoute(s: EditorState, cells: readonly CellXZ[]): EditorState {
  let next = beginRouteStroke(s, cells[0]).state;
  for (const c of cells.slice(1)) next = continueRouteStroke(next, c).state;
  return endStroke(next);
}

describe("経路のテスト用データ", () => {
  it("経路のテスト用の校舎は validatePlan の誤りが無く，経路の確かめでも問題なし", () => {
    const s = routeState();
    expect(validatePlan(s.plan)).toEqual([]);
    expect(checkRoute(s.plan.drill, 0, editingFloor(s)).problems).toEqual([]);
  });
});

describe("isRouteTool", () => {
  it("経路の道具だけ true", () => {
    expect(isRouteTool(ROUTE_TOOL)).toBe(true);
  });

  it.each<EditorTool>([
    { kind: "classroom", room: 0 },
    { kind: "corridor" },
    { kind: "fireOrigin" },
    { kind: "start" },
    { kind: "assembly" },
  ])("%o は false", (tool) => {
    expect(isRouteTool(tool)).toBe(false);
  });

  it("経路の道具は置く道具ではない", () => {
    expect(isMarkerTool(ROUTE_TOOL)).toBe(false);
  });
});

describe("selectTool（経路の道具）", () => {
  it("経路の道具を選べ，校舎は変わらない", () => {
    const before = routeState({}, { tool: { kind: "classroom", room: 0 } });
    const after = selectTool(before, ROUTE_TOOL);
    expect(after.tool).toEqual(ROUTE_TOOL);
    expect(after.plan).toBe(before.plan);
  });
});

describe("suggestRoute", () => {
  const spreadOf = (p: SchoolPlan): SpreadMap => computeSpread(p);

  it("デモの校舎で，理科室の火の側（防火シャッターより東・東の昇降口）を通らない経路が入る", () => {
    const before = demoState({ route: [] });
    const { state: after, reason } = suggestRoute(before, spreadOf);
    expect(reason).toBeNull();
    expectWalkableRoute(after.plan);
    // 防火シャッターは x = 12．火元の理科室・東の昇降口 (16, 7) はその東
    expect(after.plan.drill.route.every((r) => r.x < 12)).toBe(true);
    expect(after.plan.drill.route.some((r) => r.x === 16 && r.z === 7)).toBe(false);
    // 1年1組のドア (4, 5) と西の昇降口 (2, 7) を通る
    expect(after.plan.drill.route.some((r) => r.x === 4 && r.z === 5)).toBe(true);
    expect(after.plan.drill.route.some((r) => r.x === 2 && r.z === 7)).toBe(true);
  });

  it("入る経路は proposeRoute() の提案そのもので，validatePlan・経路の確かめとも誤りなし", () => {
    const before = demoState({ route: [] });
    const after = suggestRoute(before, spreadOf).state;
    expect(after.plan.drill.route).toEqual(proposeRoute(before.plan, computeSpread(before.plan)));
    expect(validatePlan(after.plan)).toEqual([]);
    expect(checkRoute(after.plan.drill, 0, editingFloor(after)).problems).toEqual([]);
  });

  it("経路以外は変えず，履歴が 1 つ増える．元に戻すと前の経路に戻る", () => {
    const before = demoState();
    const after = suggestRoute(before, spreadOf).state;
    expect(after.plan.drill.route).not.toEqual(before.plan.drill.route);
    expectDrillOthersKept(before.plan, after.plan, ["route"]);
    expect(after.past).toHaveLength(before.past.length + 1);
    expect(undo(after).plan.drill.route).toEqual(before.plan.drill.route);
  });

  it("延焼は渡した spreadOf で引く（今の校舎を渡す）", () => {
    const before = demoState({ route: [] });
    const seen: SchoolPlan[] = [];
    suggestRoute(before, (p) => {
      seen.push(p);
      return computeSpread(p);
    });
    expect(seen.length).toBeGreaterThan(0);
    expect(seen.every((p) => p === before.plan)).toBe(true);
  });

  it("もう一度押しても提案が同じなら同じ参照（履歴に積まない）", () => {
    const once = suggestRoute(demoState({ route: [] }), spreadOf).state;
    const twice = suggestRoute(once, spreadOf);
    expect(twice.reason).toBeNull();
    expect(twice.state.plan).toBe(once.plan);
    expect(twice.state.past).toEqual(once.past);
  });

  it("テスト用の校舎でも，ドアと出口を通る経路が入る", () => {
    const after = suggestRoute(routeState({ route: [] }), spreadOf);
    expect(after.reason).toBeNull();
    expectWalkableRoute(after.state.plan);
  });

  it("同じ階に集合場所が無い時は理由を出し，校舎を変えない", () => {
    const before = routeState({ assembly: [] });
    expectRejected(before, suggestRoute(before, spreadOf), ROUTE_EDIT_REASONS.noAssembly);
  });

  it("集合場所が別の階にしか無い時も同じ階に無い理由", () => {
    const before = routeState({ assembly: [ref(3, 4, 1)] }, { rows: ROUTE_ROWS });
    expectRejected(before, suggestRoute(before, spreadOf), ROUTE_EDIT_REASONS.noAssembly);
  });

  it.each<CellRef>([ref(-1, 0), ref(5, 0), ref(0, 5), ref(1, 1, 3)])(
    "開始地点がマス目の外（%o）の時は理由を出し，校舎を変えない",
    (start) => {
      const before = routeState({ start });
      expectRejected(before, suggestRoute(before, spreadOf), ROUTE_EDIT_REASONS.startOutside);
    },
  );

  it("閉じ込められて集合場所にたどり着けない時は理由を出し，校舎を変えない", () => {
    const before = routeState({}, { rows: ["000hh", "000dh", "hhhhh", "####.", "ooooo"] });
    expectRejected(before, suggestRoute(before, spreadOf), ROUTE_EDIT_REASONS.unreachable);
  });

  it("ドラッグの途中なら先に終えてから提案する（ドラッグとは別の履歴）", () => {
    const mid = beginRouteStroke(routeState({ route: [] }), at(1, 1)).state;
    const after = suggestRoute(mid, spreadOf).state;
    expect(after.stroke).toBeNull();
    expectWalkableRoute(after.plan);
  });
});

describe("clearRoute", () => {
  it("経路を空にし，経路以外は変えない．履歴が 1 増え，元に戻せる", () => {
    const before = routeState();
    const after = clearRoute(before);
    expect(after.plan.drill.route).toEqual([]);
    expectDrillOthersKept(before.plan, after.plan, ["route"]);
    expect(after.past).toHaveLength(before.past.length + 1);
    expect(undo(after).plan.drill.route).toEqual(FULL_ROUTE);
  });

  it("空にした校舎も validatePlan の誤りにならない（空なら生徒側で提案を使う）", () => {
    expect(validatePlan(clearRoute(routeState()).plan)).toEqual([]);
  });

  it("もう空なら何もしない（同じ参照・履歴は変わらない）", () => {
    const before = routeState({ route: [] });
    const after = clearRoute(before);
    expect(after.plan).toBe(before.plan);
    expect(after.past).toEqual(before.past);
  });
});

describe("beginRouteStroke / continueRouteStroke / endStroke", () => {
  it("経路が空の時，開始地点を押すと開始地点だけの経路になる", () => {
    const r = beginRouteStroke(routeState({ route: [] }), at(1, 1));
    expect(r.reason).toBeNull();
    expect(endStroke(r.state).plan.drill.route).toEqual([ref(1, 1)]);
  });

  it("経路が空の時，開始地点の隣（一歩で進める）を押すと開始地点とそのマスになる", () => {
    const r = beginRouteStroke(routeState({ route: [] }), at(2, 1));
    expect(r.reason).toBeNull();
    expect(endStroke(r.state).plan.drill.route).toEqual([ref(1, 1), ref(2, 1)]);
  });

  it("経路が空の時，開始地点から離れたマスを押すと理由を出し，経路は変えない", () => {
    const before = routeState({ route: [] });
    const r = beginRouteStroke(before, at(3, 2));
    expect(r.reason).toBe(ROUTE_REASONS.startNotNext(ref(1, 1)));
    const done = endStroke(r.state);
    expect(done.plan).toBe(before.plan);
    expect(done.past).toEqual(before.past);
  });

  it("経路が空の時，開始地点の隣でも壁の向こう（ドアを通らない廊下）なら理由を出し，経路は変えない", () => {
    const before = routeState({ route: [] });
    const r = beginRouteStroke(before, at(1, 2));
    expect(r.reason).toBe(ROUTE_REASONS.wall(at(1, 1), at(1, 2)));
    expect(endStroke(r.state).plan).toBe(before.plan);
  });

  it("経路が空で開始地点がマス目の外なら理由を出し，経路は変えない", () => {
    const before = routeState({ route: [], start: ref(9, 9) });
    const r = beginRouteStroke(before, at(1, 1));
    expect(r.reason).toBe(ROUTE_REASONS.startOutside);
    expect(endStroke(r.state).plan).toBe(before.plan);
  });

  it("開始地点から 1 マスずつドラッグして集合場所まで引ける（1 回のドラッグが 1 回分の履歴）", () => {
    const before = routeState({ route: [] });
    const after = dragRoute(before, FULL_ROUTE);
    expect(after.plan.drill.route).toEqual(FULL_ROUTE);
    expect(after.past).toHaveLength(before.past.length + 1);
    expect(validatePlan(after.plan)).toEqual([]);
    // 1 回の元に戻すで空に戻る
    const undone = undo(after);
    expect(undone.plan.drill.route).toEqual([]);
    expect(redo(undone).plan.drill.route).toEqual(FULL_ROUTE);
  });

  it("ドラッグの途中は経路が伸びていき，終わるまで履歴は積まない", () => {
    const before = routeState({ route: [] });
    let s = beginRouteStroke(before, at(1, 1)).state;
    s = continueRouteStroke(s, at(2, 1)).state;
    expect(s.plan.drill.route).toEqual([ref(1, 1), ref(2, 1)]);
    expect(s.past).toEqual(before.past);
    s = continueRouteStroke(s, at(3, 1)).state;
    expect(s.plan.drill.route).toEqual([ref(1, 1), ref(2, 1), ref(3, 1)]);
  });

  it("マウスが速く動いて飛ばしたマスも順に埋める（直線）", () => {
    const before = routeState({ route: [ref(1, 1), ref(2, 1), ref(3, 1), ref(3, 2)] });
    // (3, 2) から (0, 2) へ一度に動く: (2, 2)・(1, 2)・(0, 2) を足す
    const after = dragRoute(before, [at(3, 2), at(0, 2)]);
    expect(after.plan.drill.route).toEqual([
      ref(1, 1),
      ref(2, 1),
      ref(3, 1),
      ref(3, 2),
      ref(2, 2),
      ref(1, 2),
      ref(0, 2),
    ]);
  });

  it("飛ばしたマスを埋める時，できた経路は上下左右に隣り合う（斜めの動きでも）", () => {
    const before = routeState({ route: [ref(1, 1), ref(2, 1), ref(3, 1), ref(3, 2)] });
    // (3, 2) → (1, 4) は斜め．間の柱で止まることはあるが，できた経路は人が一歩ずつ進める
    const after = dragRoute(before, [at(3, 2), at(1, 4)]);
    const route = after.plan.drill.route;
    const f = editingFloor(after);
    for (let i = 1; i < route.length; i++) {
      expect(canPersonStep(f, route[i - 1], route[i])).toBe(true);
    }
  });

  it("人の入れないマス（柱）の手前でドラッグは止まり，理由を出す", () => {
    const route = [ref(1, 1), ref(2, 1), ref(3, 1), ref(3, 2), ref(2, 2)];
    const before = routeState({ route });
    let s = beginRouteStroke(before, at(2, 2)).state;
    // (2, 2) から (2, 4) へ: 間の (2, 3) は柱
    const r = continueRouteStroke(s, at(2, 4));
    expect(r.reason).toBe(ROUTE_REASONS.notWalkable(at(2, 3)));
    s = endStroke(r.state);
    expect(s.plan.drill.route).toEqual(route);
  });

  it("壁をまたぐ一歩（ドアを通らず廊下から教室へ）は足さずに理由を出す", () => {
    // 経路の最後は廊下の (0, 2)．真上の (0, 1) は教室で，間に壁がある
    const before = routeState({
      route: [ref(1, 1), ref(2, 1), ref(3, 1), ref(3, 2), ref(2, 2), ref(1, 2), ref(0, 2)],
    });
    const r = beginRouteStroke(before, at(0, 1));
    expect(r.reason).toBe(ROUTE_REASONS.wall(at(0, 2), at(0, 1)));
    const done = endStroke(r.state);
    expect(done.plan).toBe(before.plan);
    expect(done.past).toEqual(before.past);
  });

  it("経路の最後と隣り合わないマスを押すと理由を出し，経路は変えない", () => {
    const route = [ref(1, 1), ref(2, 1)];
    const before = routeState({ route });
    const r = beginRouteStroke(before, at(4, 0));
    expect(r.reason).toBe(ROUTE_REASONS.notAdjacent(at(2, 1)));
    expect(endStroke(r.state).plan).toBe(before.plan);
  });

  it("経路の途中のマスを押すと，そこまでに切り詰める（1 回分の履歴．元に戻せる）", () => {
    const before = routeState();
    const after = endStroke(beginRouteStroke(before, at(3, 1)).state);
    expect(after.plan.drill.route).toEqual(FULL_ROUTE.slice(0, 3));
    expect(after.past).toHaveLength(before.past.length + 1);
    expect(undo(after).plan.drill.route).toEqual(FULL_ROUTE);
  });

  it("開始地点を押すと開始地点だけに切り詰める", () => {
    const after = endStroke(beginRouteStroke(routeState(), at(1, 1)).state);
    expect(after.plan.drill.route).toEqual([ref(1, 1)]);
  });

  it("ドラッグで経路を戻ると切り詰める", () => {
    const before = routeState();
    const after = dragRoute(before, [at(3, 4), at(1, 4)]);
    expect(after.plan.drill.route).toEqual(FULL_ROUTE.slice(0, 8));
  });

  it("切り詰めた後に別の向きへ伸ばせる（1 マスずつ直せる）", () => {
    const before = routeState();
    // (3, 2) まで戻ってから (4, 2) へ
    const after = dragRoute(before, [at(3, 2), at(4, 2)]);
    expect(after.plan.drill.route).toEqual([...FULL_ROUTE.slice(0, 4), ref(4, 2)]);
    expect(after.past).toHaveLength(before.past.length + 1);
  });

  it("最後のマスを押しただけなら何もしない（同じ参照・履歴に積まない）", () => {
    const before = routeState();
    const after = endStroke(beginRouteStroke(before, at(3, 4)).state);
    expect(after.plan).toBe(before.plan);
    expect(after.past).toEqual(before.past);
  });

  it("ドラッグで伸ばしてから元の最後のマスに戻ると，ドラッグ前と同じ参照で履歴に積まない", () => {
    const route = [ref(1, 1), ref(2, 1)];
    const before = routeState({ route });
    let s = beginRouteStroke(before, at(2, 1)).state;
    s = continueRouteStroke(s, at(3, 1)).state;
    expect(s.plan.drill.route).toEqual([...route, ref(3, 1)]);
    s = continueRouteStroke(s, at(2, 1)).state;
    expect(s.plan).toBe(before.plan);
    const done = endStroke(s);
    expect(done.plan).toBe(before.plan);
    expect(done.past).toEqual(before.past);
  });

  it("同じマスへの continueRouteStroke は何もしない", () => {
    const s = beginRouteStroke(routeState({ route: [] }), at(1, 1)).state;
    const r = continueRouteStroke(s, at(1, 1));
    expect(r.state).toBe(s);
    expect(r.reason).toBeNull();
  });

  it("ドラッグの途中でなければ continueRouteStroke は何もしない", () => {
    const before = routeState({ route: [ref(1, 1)] });
    const r = continueRouteStroke(before, at(2, 1));
    expect(r.state).toBe(before);
    expect(r.reason).toBeNull();
  });

  it.each<EditorTool>([{ kind: "classroom", room: 0 }, { kind: "corridor" }, { kind: "start" }])(
    "経路の道具でない（%o）時は経路を変えない",
    (tool) => {
      const before = routeState({ route: [ref(1, 1)] }, { tool });
      const r = beginRouteStroke(before, at(2, 1));
      expect(r.reason).toBeNull();
      expect(r.state.plan.drill.route).toEqual([ref(1, 1)]);
      const c = continueRouteStroke(r.state, at(3, 1));
      expect(endStroke(c.state).plan.drill.route).toEqual([ref(1, 1)]);
    },
  );

  it("経路の操作はマス目を変えない", () => {
    const before = routeState({ route: [] });
    const after = dragRoute(before, FULL_ROUTE);
    expect(after.plan.floors).toBe(before.plan.floors);
    expectDrillOthersKept(before.plan, after.plan, ["route"]);
  });

  it("集合場所を過ぎても伸ばせる（確かめは checkRoute で出す）", () => {
    const before = routeState();
    const after = dragRoute(before, [at(3, 4), at(4, 4)]);
    expect(after.plan.drill.route).toEqual([...FULL_ROUTE, ref(4, 4)]);
    expect(checkRoute(after.plan.drill, 0, editingFloor(after)).endsAtAssembly).toBe(false);
  });
});

describe("経路の道具の時の塗る操作", () => {
  it("paintCell は経路の道具では塗らない（同じ参照）", () => {
    const before = routeState();
    for (const c of [at(0, 0), at(3, 2), at(4, 4)]) {
      expect(paintCell(before, c).plan).toBe(before.plan);
    }
  });

  it("beginStroke / continueStroke は経路の道具では塗らない", () => {
    const before = routeState();
    const after = endStroke(continueStroke(beginStroke(before, at(0, 0)), at(4, 4)));
    expect(after.plan).toBe(before.plan);
    expect(after.past).toEqual(before.past);
  });
});

describe("訓練条件の操作と正解経路", () => {
  it("開始地点を動かしても経路は変えない", () => {
    const before = routeState({}, { tool: { kind: "start" } });
    const after = placeStart(before, at(0, 0));
    expect(after.reason).toBeNull();
    expect(after.state.plan.drill.start).toEqual(ref(0, 0));
    expect(after.state.plan.drill.route).toEqual(FULL_ROUTE);
  });

  it("集合場所を足し・外しても経路は変えない", () => {
    const before = routeState({}, { tool: { kind: "assembly" } });
    const added = toggleAssembly(before, at(0, 4));
    expect(added.reason).toBeNull();
    expect(added.state.plan.drill.route).toEqual(FULL_ROUTE);
    const removed = toggleAssembly(added.state, at(3, 4));
    expect(removed.reason).toBeNull();
    expect(removed.state.plan.drill.route).toEqual(FULL_ROUTE);
  });
});
