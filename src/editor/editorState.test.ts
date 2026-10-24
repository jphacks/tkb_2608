// エディタの編集の状態と操作のテスト．
// 基準は docs/04_SPEC/SPEC_01_画面遷移とモジュール構成.md（src/editor/: 「今の状態 → 操作 → 次の状態」の純粋な関数・「元に戻す」），
// docs/04_SPEC/SPEC_02_校舎データの形式.md（型・座標・添字 z * width + x・教室以外の roomOf は -1），Issue #108
import { describe, expect, it } from "vitest";
import type { CellKind, Floor, Room, SchoolPlan } from "../core/schoolPlan";
import { DEMO_SCHOOL } from "../share/samples/demoSchool";
import { createFloorFromRows } from "../share/samples/floorFromRows";
import type { CellXZ } from "../sim/grid";
import {
  addRoom,
  beginStroke,
  canRedo,
  canUndo,
  continueStroke,
  createEditorState,
  type EditorState,
  editingFloor,
  endStroke,
  HISTORY_LIMIT,
  MAX_GRID_SIZE,
  paintCell,
  redo,
  renameRoom,
  resizeGrid,
  selectTool,
  startBlank,
  undo,
} from "./editorState";

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
