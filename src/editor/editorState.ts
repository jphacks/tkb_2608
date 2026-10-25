// エディタの編集の状態と操作（「今の状態 → 操作 → 次の状態」の純粋な関数．DOM・Canvas に依存しない）．
// 編集するのは 1 フロア目（floors[0]）だけで，floors は配列のまま保つ．元に戻す／やり直すの履歴もここで持つ
import type {
  CellKind,
  CellRef,
  DrillMode,
  DrillSetup,
  Floor,
  FloorDraft,
  Room,
  SchoolPlan,
} from "../core/schoolPlan";
import { validateFloor } from "../share/validatePlan";
import { proposeRoute, type SpreadMap } from "../sim";
import { type CellXZ, isAdjacent } from "../sim/grid";
import { isWalkableKind } from "../sim/walls";
import { checkRoute, ROUTE_REASONS, routeStepRejection } from "./routeCheck";

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

/** 正解経路（E5）を引く道具（マスは塗らない．経路の最後に隣り合うマスで伸ばし，途中のマスで切り詰める） */
export interface RouteTool {
  readonly kind: "route";
}

/** エディタで選べる道具（マスを塗る道具か，訓練条件を置く道具か，正解経路を引く道具） */
export type EditorTool = PaintTool | MarkerTool | RouteTool;

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

/** 正解経路の操作の結果．経路を変えられなかった時は reason に画面に出す理由（日本語の 1 文）を持つ（MarkerResult と同じ形） */
export type RouteResult = MarkerResult;

/** 経路の提案・操作で出す理由の文（一歩ごとの理由は routeCheck.ts の ROUTE_REASONS） */
export const ROUTE_EDIT_REASONS = {
  noAssembly: "集合場所が開始地点と同じ階にないため，経路を提案できません",
  startOutside: "開始地点がマス目の外にあるため，経路を提案できません",
  unreachable:
    "開始地点から集合場所までたどり着ける経路がありません（壁・ドア・出口と，火で通れなくなるマスを確かめてください）",
} as const;

/** ドラッグで塗っている途中の記録（1 回のドラッグを 1 回分の「元に戻す」にまとめるため．経路を引くドラッグも同じ記録を使う） */
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

/** 道具が正解経路を引く道具か */
export function isRouteTool(tool: EditorTool): tool is RouteTool {
  return tool.kind === "route";
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
 * 別の校舎に丸ごと置き換える（ファイルの読み込み・デモの校舎に戻す）．元に戻せる．
 * 道具が新しい校舎に無い教室を指していれば直す．同じ校舎（同じ参照）なら何もしない
 */
export function openPlan(state: EditorState, plan: SchoolPlan): EditorState {
  return commit(endStroke(state), plan);
}

/** 配置の下書き（ES3）を当てた結果．当てられなかった時は state は元のままで，reason に理由を持つ */
export interface DraftResult {
  readonly state: EditorState;
  /** 当てられなかった理由（画面に出す日本語の 1 文）．当てられた時は null */
  readonly reason: string | null;
  /** 置き換えで条件を満たさなくなり，外した（置き直しが要る）訓練条件の名前（「火元」「集合場所」等）．無ければ空 */
  readonly removed: readonly string[];
}

/** 下書きを当てる時の案内の文 */
export const DRAFT_REASONS = {
  invalid: (detail: string) => `下書きの形が正しくないため，当てられませんでした（${detail}）`,
  tooLarge: `下書きのマス目が大きすぎます（幅・奥行きは 1〜${MAX_GRID_SIZE} マス）`,
  badRoomName: "下書きの教室の名前が空です",
} as const;

/**
 * 配置の下書き（FloorDraft）を確かめる（validatePlan と同じ階のマス目の検査に，大きさの上限と教室の名前を足したもの）．
 * 当てられる時は null，当てられない時は理由
 */
export function draftRejection(draft: FloorDraft): string | null {
  const floor: Floor = { level: EDIT_FLOOR + 1, ...pickFloorShape(draft) };
  const errors = validateFloor(floor, EDIT_FLOOR, draft.rooms.length);
  if (errors.length > 0) return DRAFT_REASONS.invalid(errors[0]);
  if (draft.width > MAX_GRID_SIZE || draft.depth > MAX_GRID_SIZE) return DRAFT_REASONS.tooLarge;
  if (draft.rooms.some((r) => typeof r.name !== "string" || r.name.trim() === "")) {
    return DRAFT_REASONS.badRoomName;
  }
  return null;
}

/**
 * 今の階のマス目（大きさ・cells・roomOf）と教室の一覧を下書きに置き換える（1 回分の「元に戻す」になる）．
 * 段階 1 は 1 フロアなので，教室の一覧は下書きの教室に丸ごと置き換える．
 * 置き換えで条件を満たさなくなった訓練条件は外す: 床（人の入れるマス）でなくなった火元・追加の延焼箇所，
 * 屋外でなくなった集合場所，確かめ（checkRoute）に通らなくなった正解経路（丸ごと空にする）．
 * 開始地点は 1 つ必ず要るので外さず，教室でなくなった時は removed で知らせる（validatePlan の誤りとしても見える）
 */
export function applyFloorDraft(state: EditorState, draft: FloorDraft): DraftResult {
  const settled = endStroke(state);
  const reason = draftRejection(draft);
  if (reason !== null) return { state: settled, reason, removed: [] };
  const plan = settled.plan;
  const floor: Floor = { ...editingFloor(settled), ...pickFloorShape(draft) };
  const drill = plan.drill;
  const onFloor = (ref: CellRef): boolean => ref.floor === EDIT_FLOOR;
  const kindOf = (ref: CellRef): CellKind | null =>
    isInsideFloor(floor, ref) ? floor.cells[ref.z * floor.width + ref.x] : null;
  const removed: string[] = [];

  const fireOrigins = drill.fireOrigins.filter(
    (ref) => !onFloor(ref) || isWalkableKind(kindOf(ref)),
  );
  if (fireOrigins.length !== drill.fireOrigins.length) removed.push("火元");
  const extraFires = drill.spread.extraFires.filter(
    (fire) => !onFloor(fire.cell) || isWalkableKind(kindOf(fire.cell)),
  );
  if (extraFires.length !== drill.spread.extraFires.length) removed.push("追加の延焼箇所");
  const assembly = drill.assembly.filter((ref) => !onFloor(ref) || kindOf(ref) === "outdoor");
  if (assembly.length !== drill.assembly.length) removed.push("集合場所");
  if (onFloor(drill.start) && kindOf(drill.start) !== "classroom") removed.push("開始地点");

  const nextDrill: DrillSetup = {
    ...drill,
    fireOrigins,
    assembly,
    spread: { ...drill.spread, extraFires },
  };
  const check = checkRoute(nextDrill, EDIT_FLOOR, floor);
  const route = check.empty || check.problems.length === 0 ? drill.route : [];
  if (route !== drill.route) removed.push("正解経路");

  const next: SchoolPlan = {
    ...replaceFloor(plan, floor),
    rooms: draft.rooms.map((r) => ({ name: r.name.trim() })),
    drill: { ...nextDrill, route },
  };
  return { state: commit(settled, next), reason: null, removed };
}

/** 下書きのうち階のマス目に当てる項目（配列は書き換えられないよう写す） */
function pickFloorShape(draft: FloorDraft): Omit<Floor, "level"> {
  return {
    width: draft.width,
    depth: draft.depth,
    cells: [...draft.cells],
    roomOf: [...draft.roomOf],
  };
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

/** 訓練のモード（学習／テスト．E6）を選ぶ．同じモードなら何もしない */
export function setDrillMode(state: EditorState, mode: DrillMode): EditorState {
  const settled = endStroke(state);
  const drill = settled.plan.drill;
  if (drill.mode === mode) return settled;
  return commit(settled, withDrill(settled.plan, { ...drill, mode }));
}

/** 延焼の速さ（SPEC_02 の SpreadSettings）のうち，エディタで変える秒数の項目 */
export type SpreadSecondsKey = "fireSecondsPerCell" | "smokeSecondsPerCell";

/** 秒数として受け付けるか（0 より大きい有限の数．validatePlan と同じ条件） */
export function isValidSeconds(value: number): boolean {
  return Number.isFinite(value) && value > 0;
}

/**
 * 火・煙が隣のマスへ移るまでの秒数（s）を変える（E4）．
 * 0 以下・NaN・Infinity は受け付けず何もしない（誤った校舎を作らないため．入力欄の値は呼び出し側で元に戻す）．同じ値なら何もしない
 */
export function setSpreadSeconds(
  state: EditorState,
  key: SpreadSecondsKey,
  seconds: number,
): EditorState {
  const settled = endStroke(state);
  const drill = settled.plan.drill;
  if (!isValidSeconds(seconds) || drill.spread[key] === seconds) return settled;
  return commit(
    settled,
    withDrill(settled.plan, { ...drill, spread: { ...drill.spread, [key]: seconds } }),
  );
}

/** 制限時間（s．非常ベルから）を変える．受け付けない値・同じ値の時は何もしない（setSpreadSeconds と同じ） */
export function setTimeLimit(state: EditorState, seconds: number): EditorState {
  const settled = endStroke(state);
  const drill = settled.plan.drill;
  if (!isValidSeconds(seconds) || drill.timeLimitSeconds === seconds) return settled;
  return commit(settled, withDrill(settled.plan, { ...drill, timeLimitSeconds: seconds }));
}

/**
 * 正解経路を proposeRoute() の提案に置き換える（E5．元に戻せる）．延焼は spreadOf で引く（エディタのキャッシュを渡す）．
 * たどり着けない時は理由を返して校舎を変えない．提案が今の経路と同じなら何もしない
 */
export function suggestRoute(
  state: EditorState,
  spreadOf: (plan: SchoolPlan) => SpreadMap,
): RouteResult {
  const settled = endStroke(state);
  const plan = settled.plan;
  const drill = plan.drill;
  const floor = plan.floors[drill.start.floor];
  if (floor === undefined || !isInsideFloor(floor, drill.start)) {
    return { state: settled, reason: ROUTE_EDIT_REASONS.startOutside };
  }
  if (!drill.assembly.some((ref) => ref.floor === drill.start.floor && isInsideFloor(floor, ref))) {
    return { state: settled, reason: ROUTE_EDIT_REASONS.noAssembly };
  }
  const proposal = proposeRoute(plan, spreadOf(plan));
  if (proposal === null) return { state: settled, reason: ROUTE_EDIT_REASONS.unreachable };
  if (sameRoute(drill.route, proposal)) return { state: settled, reason: null };
  return {
    state: commit(settled, withDrill(plan, { ...drill, route: [...proposal] })),
    reason: null,
  };
}

/** 正解経路を空にする（元に戻せる．空の時は生徒側で proposeRoute() の提案を使う）．もう空なら何もしない */
export function clearRoute(state: EditorState): EditorState {
  const settled = endStroke(state);
  const drill = settled.plan.drill;
  if (drill.route.length === 0) return settled;
  return commit(settled, withDrill(settled.plan, { ...drill, route: [] }));
}

/**
 * 経路の道具でマスを押した（ドラッグの始まり）．続きは continueRouteStroke，終わりは endStroke で知らせ，
 * ドラッグ全体を 1 回分の「元に戻す」にする．
 *
 * - 経路の途中のマス: そのマスまでに切り詰める（最後のマスなら変えない．そのままドラッグで伸ばせる）
 * - 経路の最後のマスに隣り合うマス: 人が一歩で進めれば足す．壁をまたぐ・人の入れないマスなら足さずに理由を返す
 * - 経路が空: 開始地点から始める（開始地点を押せば開始地点だけ，その隣を押せば開始地点とそのマス）
 *
 * 道具が経路の道具でない時は何もしない
 */
export function beginRouteStroke(state: EditorState, cell: CellXZ): RouteResult {
  const settled = endStroke(state);
  if (!isRouteTool(settled.tool)) return { state: settled, reason: null };
  const { route, reason } = stepRoute(settled.plan, settled.plan.drill.route, cell);
  return {
    state: {
      ...settled,
      plan: withRoute(settled.plan, route),
      stroke: { before: settled.plan, last: cell },
    },
    reason,
  };
}

/**
 * 経路の道具でドラッグして次のマスへ動いた．前のマスとの間のマスも順に見る（マウスが速く動いても途切れないように）．
 * 経路の途中のマスに戻れば切り詰め，最後のマスに隣り合うマスなら伸ばす（beginRouteStroke と同じ規則）．
 * 足せないマスがあれば，そこで止めて理由を返す．ドラッグの途中でなければ何もしない
 */
export function continueRouteStroke(state: EditorState, cell: CellXZ): RouteResult {
  const stroke = state.stroke;
  if (stroke === null || !isRouteTool(state.tool)) return { state, reason: null };
  if (stroke.last.x === cell.x && stroke.last.z === cell.z) return { state, reason: null };
  let route = state.plan.drill.route;
  let reason: string | null = null;
  for (const next of cellsBetween(stroke.last, cell)) {
    const step = stepRoute(state.plan, route, next);
    route = step.route;
    if (step.reason !== null) {
      reason = step.reason;
      break;
    }
  }
  // ドラッグで元の経路に戻った時は，ドラッグ前の校舎のままにする（変わっていない操作を履歴に積まないため）
  const plan = sameRoute(route, stroke.before.drill.route)
    ? stroke.before
    : withRoute(state.plan, route);
  return { state: { ...state, plan, stroke: { before: stroke.before, last: cell } }, reason };
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
  if (isMarkerTool(tool) || isRouteTool(tool)) return plan;
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

/**
 * 経路の上でマスを 1 つ選んだ時の次の経路（beginRouteStroke の規則）．変わらなければ同じ配列を返す．
 * 足せない時は route のまま理由を返す
 */
function stepRoute(
  plan: SchoolPlan,
  route: readonly CellRef[],
  cell: CellXZ,
): { readonly route: readonly CellRef[]; readonly reason: string | null } {
  const floor = plan.floors[EDIT_FLOOR];
  const ref = editRef(cell);
  const at = route.findIndex((r) => sameRef(r, ref));
  if (at >= 0)
    return { route: at === route.length - 1 ? route : route.slice(0, at + 1), reason: null };
  if (route.length === 0) {
    const start = plan.drill.start;
    if (start.floor !== EDIT_FLOOR || !isInsideFloor(floor, start)) {
      return { route, reason: ROUTE_REASONS.startOutside };
    }
    if (sameRef(start, ref)) return { route: [start], reason: null };
    if (!isAdjacent(start, cell)) return { route, reason: ROUTE_REASONS.startNotNext(start) };
    const reason = routeStepRejection(floor, start, cell);
    return reason === null ? { route: [start, ref], reason: null } : { route, reason };
  }
  const last = route[route.length - 1];
  const reason = routeStepRejection(floor, last, cell);
  return reason === null ? { route: [...route, ref], reason: null } : { route, reason };
}

function withRoute(plan: SchoolPlan, route: readonly CellRef[]): SchoolPlan {
  return route === plan.drill.route ? plan : withDrill(plan, { ...plan.drill, route });
}

function sameRoute(a: readonly CellRef[], b: readonly CellRef[]): boolean {
  return a.length === b.length && a.every((r, i) => sameRef(r, b[i]));
}

function isInsideFloor(floor: Floor, cell: CellXZ): boolean {
  return (
    Number.isInteger(cell.x) &&
    Number.isInteger(cell.z) &&
    cell.x >= 0 &&
    cell.x < floor.width &&
    cell.z >= 0 &&
    cell.z < floor.depth
  );
}

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
