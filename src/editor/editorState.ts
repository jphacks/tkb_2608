// エディタの編集の状態と操作（「今の状態 → 操作 → 次の状態」の純粋な関数．DOM・Canvas に依存しない）．
// 編集するのは 1 フロア目（floors[0]）だけで，floors は配列のまま保つ．元に戻す／やり直すの履歴もここで持つ
import type { CellKind, CellRef, DrillSetup, Floor, Room, SchoolPlan } from "../core/schoolPlan";
import type { CellXZ } from "../sim/grid";

/** 塗る道具．教室の時はどの教室（SchoolPlan.rooms の添字）で塗るかを持つ */
export type PaintTool =
  | { readonly kind: Exclude<CellKind, "classroom"> }
  | { readonly kind: "classroom"; readonly room: number };

/** 訓練条件（SPEC_02 の DrillSetup）のうち，マスを選んで置く物の種類 */
export type MarkerKind = "fireOrigin" | "start" | "assembly";

/** 訓練条件を置く道具（火元・開始地点・集合場所．マスは塗らない） */
export interface MarkerTool {
  readonly kind: MarkerKind;
}

/** エディタで選べる道具（マスを塗る道具か，訓練条件を置く道具） */
export type EditorTool = PaintTool | MarkerTool;

/** 開始時の向きの選び方（エディタの画面の上下左右） */
export type Facing = "up" | "right" | "down" | "left";

/**
 * 画面の方向 ↔ startYaw（rad）の対応．向きの約束はここだけに書く．
 * SPEC_02 の約束「0 が -Z（エディタの上）向き，右回りに増える」に従う．
 * .claude/rules/coding-typescript.md は「正で左へ回る」と食い違っており，Issue #104 で決まったらこの表と
 * yawToGridDirection だけを直す（上・下はどちらの約束でも 0・π で同じ．左右の符号だけが入れ替わる）
 */
export const FACING_YAW: Readonly<Record<Facing, number>> = {
  up: 0,
  right: Math.PI / 2,
  down: Math.PI,
  left: -Math.PI / 2,
};

/** 道具箱に並べる向きの順番 */
export const FACINGS: readonly Facing[] = ["up", "right", "down", "left"];

/**
 * startYaw（rad）が向くマス目の上の方向（x は右，z は画面の下に増える．長さ 1）．
 * FACING_YAW と同じ約束（SPEC_02．Issue #104 で決まったら一緒に直す）
 */
export function yawToGridDirection(yaw: number): CellXZ {
  return { x: Math.sin(yaw), z: -Math.cos(yaw) };
}

/** startYaw（rad）に最も近い上下左右の向き．数でない時は null */
export function facingOfYaw(yaw: number): Facing | null {
  if (!Number.isFinite(yaw)) return null;
  const dir = yawToGridDirection(yaw);
  let best: Facing = "up";
  let bestDot = -Infinity;
  for (const facing of FACINGS) {
    const d = yawToGridDirection(FACING_YAW[facing]);
    const dot = d.x * dir.x + d.z * dir.z;
    if (dot > bestDot) {
      best = facing;
      bestDot = dot;
    }
  }
  return best;
}

/** 訓練条件を置く操作の結果．置けなかった時は state は元のままで，reason に画面に出す理由（日本語の 1 文）を持つ */
export interface MarkerResult {
  readonly state: EditorState;
  readonly reason: string | null;
}

/** 置けない時の理由の文 */
export const MARKER_REASONS = {
  outside: "マス目の外には置けません",
  startNotClassroom: "開始地点は教室のマスにだけ置けます",
  assemblyNotOutdoor: "集合場所は屋外（校庭）のマスにだけ置けます",
} as const;

/** ドラッグで塗っている途中の記録（1 回のドラッグを 1 回分の「元に戻す」にまとめるため） */
export interface PaintStroke {
  /** ドラッグを始める前の校舎（履歴に積むもの） */
  readonly before: SchoolPlan;
  /** 最後に塗ったマス（次に動いた先までの間を埋めるため） */
  readonly last: CellXZ;
}

/** エディタの状態 */
export interface EditorState {
  /** 編集中の校舎 */
  readonly plan: SchoolPlan;
  /** 選んでいる道具 */
  readonly tool: EditorTool;
  /** 元に戻す先（古い順．最後が直前） */
  readonly past: readonly SchoolPlan[];
  /** やり直す先（最後が次にやり直すもの） */
  readonly future: readonly SchoolPlan[];
  /** ドラッグで塗っている途中なら，その記録．塗っていなければ null */
  readonly stroke: PaintStroke | null;
}

/** 元に戻せる回数の上限（メモリを使いすぎないため．古いものから捨てる） */
export const HISTORY_LIMIT = 200;

/** マス目の幅・奥行きの上限（マス）．URL・QR に収まる大きさの目安 */
export const MAX_GRID_SIZE = 80;

/** 編集する階（SchoolPlan.floors の添字．1 フロア目だけ．ES2 で複数フロアにする時に広げる） */
export const EDIT_FLOOR = 0;

/** 最初に選んでいる道具 */
const DEFAULT_TOOL: PaintTool = { kind: "corridor" };

/** 校舎を開いた状態を作る（履歴は空） */
export function createEditorState(plan: SchoolPlan): EditorState {
  return {
    plan,
    tool: normalizeTool(
      plan,
      plan.rooms.length > 0 ? { kind: "classroom", room: 0 } : DEFAULT_TOOL,
    ),
    past: [],
    future: [],
    stroke: null,
  };
}

/** 編集中の階（1 フロア目） */
export function editingFloor(state: EditorState): Floor {
  return state.plan.floors[EDIT_FLOOR];
}

/** 道具が訓練条件を置く道具か */
export function isMarkerTool(tool: EditorTool): tool is MarkerTool {
  return tool.kind === "fireOrigin" || tool.kind === "start" || tool.kind === "assembly";
}

/** 道具を選ぶ．存在しない教室を選んだ時は何もしない */
export function selectTool(state: EditorState, tool: EditorTool): EditorState {
  if (tool.kind === "classroom" && !isRoomIndex(state.plan, tool.room)) return state;
  return { ...state, tool };
}

/** 1 マスを今の道具で塗る（1 回分の「元に戻す」になる）．マス目の外・変わらない時・塗る道具でない時は何もしない */
export function paintCell(state: EditorState, cell: CellXZ): EditorState {
  const settled = endStroke(state);
  return commit(settled, paintCells(settled.plan, settled.tool, [cell]));
}

/** ドラッグで塗り始める（最初のマスを塗る）．塗り終わりは endStroke で知らせる．塗る道具でない時は塗らない */
export function beginStroke(state: EditorState, cell: CellXZ): EditorState {
  const settled = endStroke(state);
  return {
    ...settled,
    plan: paintCells(settled.plan, settled.tool, [cell]),
    stroke: { before: settled.plan, last: cell },
  };
}

/**
 * ドラッグで次のマスまで塗る．前に塗ったマスとの間も塗る（マウスが速く動いてマスを飛ばしても途切れないように）．
 * 塗っている途中でなければ何もしない
 */
export function continueStroke(state: EditorState, cell: CellXZ): EditorState {
  const stroke = state.stroke;
  if (stroke === null) return state;
  if (stroke.last.x === cell.x && stroke.last.z === cell.z) return state;
  return {
    ...state,
    plan: paintCells(state.plan, state.tool, cellsBetween(stroke.last, cell)),
    stroke: { before: stroke.before, last: cell },
  };
}

/** ドラッグで塗り終える．何か変わっていれば，ドラッグ全体を 1 回分の「元に戻す」として履歴に積む */
export function endStroke(state: EditorState): EditorState {
  const stroke = state.stroke;
  if (stroke === null) return state;
  const done: EditorState = { ...state, plan: stroke.before, stroke: null };
  return commit(done, state.plan);
}

/** 教室を足し，その教室を塗る道具を選ぶ．名前が空なら「教室 n」にする */
export function addRoom(state: EditorState, name = ""): EditorState {
  const settled = endStroke(state);
  const plan = settled.plan;
  const index = plan.rooms.length;
  const room: Room = { name: name.trim() || defaultRoomName(plan) };
  const next = commit(settled, { ...plan, rooms: [...plan.rooms, room] });
  return { ...next, tool: { kind: "classroom", room: index } };
}

/** 教室の名前を変える．存在しない教室・空の名前・同じ名前の時は何もしない */
export function renameRoom(state: EditorState, room: number, name: string): EditorState {
  const settled = endStroke(state);
  const plan = settled.plan;
  const trimmed = name.trim();
  if (!isRoomIndex(plan, room) || trimmed === "" || plan.rooms[room].name === trimmed) {
    return settled;
  }
  const rooms = plan.rooms.map((r, i) => (i === room ? { ...r, name: trimmed } : r));
  return commit(settled, { ...plan, rooms });
}

/**
 * マス目の幅・奥行き（マス）を変える．左上 (0, 0) をそろえて残るマスは保ち，増えたマスは void にする．
 * 1〜MAX_GRID_SIZE の整数に丸める．訓練条件（火元・開始地点・集合場所・経路）は変えない（外に出たものは validatePlan の誤りとして見える）
 */
export function resizeGrid(state: EditorState, width: number, depth: number): EditorState {
  const settled = endStroke(state);
  const floor = editingFloor(settled);
  const w = clampGridSize(width, floor.width);
  const d = clampGridSize(depth, floor.depth);
  if (w === floor.width && d === floor.depth) return settled;
  const cells: CellKind[] = [];
  const roomOf: number[] = [];
  for (let z = 0; z < d; z++) {
    for (let x = 0; x < w; x++) {
      const inside = x < floor.width && z < floor.depth;
      const i = z * floor.width + x;
      cells.push(inside ? floor.cells[i] : "void");
      roomOf.push(inside ? floor.roomOf[i] : -1);
    }
  }
  return commit(
    settled,
    replaceFloor(settled.plan, { ...floor, width: w, depth: d, cells, roomOf }),
  );
}

/**
 * 空のマス目（すべて void．教室の一覧も空）から始める．元に戻せる．
 * 校舎の名前・マスの大きさ・訓練条件は残す（訓練条件は E3 以降で置き直す）
 */
export function startBlank(state: EditorState, width: number, depth: number): EditorState {
  const settled = endStroke(state);
  const floor = editingFloor(settled);
  const w = clampGridSize(width, floor.width);
  const d = clampGridSize(depth, floor.depth);
  const count = w * d;
  const blank: Floor = {
    ...floor,
    width: w,
    depth: d,
    cells: new Array<CellKind>(count).fill("void"),
    roomOf: new Array<number>(count).fill(-1),
  };
  return commit(settled, { ...replaceFloor(settled.plan, blank), rooms: [] });
}

/**
 * そのマスに訓練条件の物を置けない理由（置ける時は null）．
 * 火元はマスの種類を問わない（SPEC_02 は火元の種類を決めておらず，validatePlan も範囲だけを確かめるため）
 */
export function markerRejection(state: EditorState, kind: MarkerKind, cell: CellXZ): string | null {
  const floor = editingFloor(state);
  const { x, z } = cell;
  if (
    !(
      Number.isInteger(x) &&
      Number.isInteger(z) &&
      x >= 0 &&
      x < floor.width &&
      z >= 0 &&
      z < floor.depth
    )
  ) {
    return MARKER_REASONS.outside;
  }
  const cellKind = floor.cells[z * floor.width + x];
  if (kind === "start" && cellKind !== "classroom") return MARKER_REASONS.startNotClassroom;
  if (kind === "assembly" && cellKind !== "outdoor") return MARKER_REASONS.assemblyNotOutdoor;
  return null;
}

/** 今の道具（訓練条件を置く道具）でマスを選ぶ．塗る道具の時は何もしない */
export function placeMarker(state: EditorState, cell: CellXZ): MarkerResult {
  const tool = state.tool;
  if (!isMarkerTool(tool)) return { state, reason: null };
  switch (tool.kind) {
    case "fireOrigin":
      return toggleFireOrigin(state, cell);
    case "start":
      return placeStart(state, cell);
    case "assembly":
      return toggleAssembly(state, cell);
  }
}

/** 火元を足す．すでに火元のマスなら外す（最後の 1 つも外せる．無い時は validatePlan の誤りとして見える） */
export function toggleFireOrigin(state: EditorState, cell: CellXZ): MarkerResult {
  return toggleRef(state, "fireOrigin", "fireOrigins", cell);
}

/** 集合場所を足す．すでに集合場所のマスなら外す（最後の 1 つも外せる．無い時は validatePlan の誤りとして見える） */
export function toggleAssembly(state: EditorState, cell: CellXZ): MarkerResult {
  return toggleRef(state, "assembly", "assembly", cell);
}

/** 開始地点を置く（1 つだけなので，前の位置から移る）．同じマスなら何もしない */
export function placeStart(state: EditorState, cell: CellXZ): MarkerResult {
  const settled = endStroke(state);
  const reason = markerRejection(settled, "start", cell);
  if (reason !== null) return { state: settled, reason };
  const drill = settled.plan.drill;
  const ref = editRef(cell);
  if (sameRef(drill.start, ref)) return { state: settled, reason: null };
  return {
    state: commit(settled, withDrill(settled.plan, { ...drill, start: ref })),
    reason: null,
  };
}

/** 開始時の向きを上下左右から選ぶ（FACING_YAW の値にする）．同じ向きなら何もしない */
export function setStartFacing(state: EditorState, facing: Facing): EditorState {
  const settled = endStroke(state);
  const drill = settled.plan.drill;
  const yaw = FACING_YAW[facing];
  if (drill.startYaw === yaw) return settled;
  return commit(settled, withDrill(settled.plan, { ...drill, startYaw: yaw }));
}

/** 元に戻す（ドラッグの途中なら先に塗り終える）．戻す先が無ければ何もしない */
export function undo(state: EditorState): EditorState {
  const settled = endStroke(state);
  const previous = settled.past.at(-1);
  if (previous === undefined) return settled;
  return withPlan(settled, previous, settled.past.slice(0, -1), [...settled.future, settled.plan]);
}

/** やり直す（ドラッグの途中なら先に塗り終える）．やり直す先が無ければ何もしない */
export function redo(state: EditorState): EditorState {
  const settled = endStroke(state);
  const next = settled.future.at(-1);
  if (next === undefined) return settled;
  return withPlan(settled, next, [...settled.past, settled.plan], settled.future.slice(0, -1));
}

/** 元に戻せるか */
export function canUndo(state: EditorState): boolean {
  return state.past.length > 0 || state.stroke !== null;
}

/** やり直せるか */
export function canRedo(state: EditorState): boolean {
  return state.future.length > 0;
}

/**
 * 校舎を next に変えて履歴に積む（やり直す先は捨てる）．変わっていなければ（同じ参照）何もしない．
 * 道具が指す教室が無くなった時は道具を直す
 */
function commit(state: EditorState, next: SchoolPlan): EditorState {
  if (next === state.plan) return state;
  const past = [...state.past, state.plan].slice(-HISTORY_LIMIT);
  return withPlan(state, next, past, []);
}

function withPlan(
  state: EditorState,
  plan: SchoolPlan,
  past: readonly SchoolPlan[],
  future: readonly SchoolPlan[],
): EditorState {
  return { ...state, plan, past, future, stroke: null, tool: normalizeTool(plan, state.tool) };
}

/** 道具が無い教室を指していれば，先頭の教室（教室が無ければ廊下）に直す（元に戻すで教室の追加を取り消した時等） */
function normalizeTool(plan: SchoolPlan, tool: EditorTool): EditorTool {
  if (tool.kind !== "classroom" || isRoomIndex(plan, tool.room)) return tool;
  return plan.rooms.length > 0 ? { kind: "classroom", room: 0 } : DEFAULT_TOOL;
}

/** マスを道具で塗った校舎．何も変わらなければ同じ plan を返す（履歴に積まないため） */
function paintCells(plan: SchoolPlan, tool: EditorTool, targets: readonly CellXZ[]): SchoolPlan {
  if (isMarkerTool(tool)) return plan;
  if (tool.kind === "classroom" && !isRoomIndex(plan, tool.room)) return plan;
  const floor = plan.floors[EDIT_FLOOR];
  const room = tool.kind === "classroom" ? tool.room : -1;
  let cells: CellKind[] | null = null;
  let roomOf: number[] | null = null;
  for (const { x, z } of targets) {
    if (!(x >= 0 && x < floor.width && z >= 0 && z < floor.depth)) continue;
    const i = z * floor.width + x;
    const current = cells ?? floor.cells;
    const currentRoom = roomOf ?? floor.roomOf;
    if (current[i] === tool.kind && currentRoom[i] === room) continue;
    cells ??= [...floor.cells];
    roomOf ??= [...floor.roomOf];
    cells[i] = tool.kind;
    roomOf[i] = room;
  }
  if (cells === null || roomOf === null) return plan;
  return replaceFloor(plan, { ...floor, cells, roomOf });
}

/** from の次から to までのマス（間を上下左右につながるように埋める．from は含めない） */
function cellsBetween(from: CellXZ, to: CellXZ): CellXZ[] {
  const result: CellXZ[] = [];
  let x = from.x;
  let z = from.z;
  const dx = to.x - from.x;
  const dz = to.z - from.z;
  const steps = Math.abs(dx) + Math.abs(dz);
  // 直線に沿って 1 マスずつ，目標の線から遠い方の軸を進める（斜めに飛ばず，辺で隣り合うマスだけでつながる）
  for (let i = 0; i < steps; i++) {
    const errX = Math.abs((x + Math.sign(dx) - from.x) * dz - (z - from.z) * dx);
    const errZ = Math.abs((x - from.x) * dz - (z + Math.sign(dz) - from.z) * dx);
    if (x !== to.x && (z === to.z || errX <= errZ)) x += Math.sign(dx);
    else z += Math.sign(dz);
    result.push({ x, z });
  }
  return result;
}

/** 位置の一覧（火元・集合場所）にマスを足す・外す．置けないマスなら理由を返して何もしない */
function toggleRef(
  state: EditorState,
  kind: MarkerKind,
  key: "fireOrigins" | "assembly",
  cell: CellXZ,
): MarkerResult {
  const settled = endStroke(state);
  const drill = settled.plan.drill;
  const ref = editRef(cell);
  const list = drill[key];
  const has = list.some((r) => sameRef(r, ref));
  // 外す時は置き場所の条件を問わない（塗り替えて条件から外れた物も，選べば外せるように）
  if (!has) {
    const reason = markerRejection(settled, kind, cell);
    if (reason !== null) return { state: settled, reason };
  }
  const next = has ? list.filter((r) => !sameRef(r, ref)) : [...list, ref];
  const nextDrill: DrillSetup =
    key === "fireOrigins" ? { ...drill, fireOrigins: next } : { ...drill, assembly: next };
  return { state: commit(settled, withDrill(settled.plan, nextDrill)), reason: null };
}

/** 編集中の階のマスの位置 */
function editRef(cell: CellXZ): CellRef {
  return { floor: EDIT_FLOOR, x: cell.x, z: cell.z };
}

const sameRef = (a: CellRef, b: CellRef): boolean =>
  a.floor === b.floor && a.x === b.x && a.z === b.z;

function withDrill(plan: SchoolPlan, drill: DrillSetup): SchoolPlan {
  return { ...plan, drill };
}

function replaceFloor(plan: SchoolPlan, floor: Floor): SchoolPlan {
  return { ...plan, floors: plan.floors.map((f, i) => (i === EDIT_FLOOR ? floor : f)) };
}

function isRoomIndex(plan: SchoolPlan, room: number): boolean {
  return Number.isInteger(room) && room >= 0 && room < plan.rooms.length;
}

/** 使われていない「教室 n」の名前 */
function defaultRoomName(plan: SchoolPlan): string {
  const used = new Set(plan.rooms.map((r) => r.name));
  let n = plan.rooms.length + 1;
  while (used.has(`教室 ${n}`)) n++;
  return `教室 ${n}`;
}

/** 幅・奥行きの入力を 1〜MAX_GRID_SIZE の整数にする（Infinity も上限・下限に丸める）．NaN なら今の値のまま */
function clampGridSize(value: number, fallback: number): number {
  if (Number.isNaN(value)) return fallback;
  return Math.min(MAX_GRID_SIZE, Math.max(1, Math.round(value)));
}
