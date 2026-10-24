// SchoolPlan の 1 フロアから，校舎のパーツ（床の面・壁・柱・マスをふさぐ直方体・開口部の垂れ壁・防火シャッター）
// の並べ方を求める（three に依存しない純粋な関数）．壁の有無は src/sim/walls.ts の wallBetween() だけで決め，
// ここでは同じ規則を書かない．座標は SPEC_02「座標」のとおり，マス (x, z) が X は x*cellSize〜(x+1)*cellSize，
// Z は z*cellSize〜(z+1)*cellSize を占める（ワールド座標，m）

import type { CellKind, Floor, SchoolPlan } from "../../core/schoolPlan";
import { type CellXZ, cellIndex, kindAt } from "../../sim/grid";
import { isWalkableKind, wallBetween } from "../../sim/walls";
import type { XZRect } from "../walk/collision";
import {
  DEFAULT_CEILING_HEIGHT,
  DOOR,
  EXIT,
  type FloorKind,
  minEdgeLength,
  type XZPoint,
} from "./schoolLayout";

/** 校舎の天井の高さ（m．SPEC_02「座標」の 3 m） */
export const SCHOOL_CEILING_HEIGHT = DEFAULT_CEILING_HEIGHT;

/** 校舎の目の高さ（m．立ち・しゃがみ．確認用の空間と同じ） */
export const SCHOOL_EYE_HEIGHT = { standing: 1.6, crouching: 0.9 } as const;

/** マス目の上の矩形（マスの添字．x0 ≤ x < x1，z0 ≤ z < z1） */
export interface CellRect {
  readonly x0: number;
  readonly z0: number;
  readonly x1: number;
  readonly z1: number;
}

/** 床の面（教室・廊下・開口部のマス）1 枚 */
export interface PlanFloorSurface {
  readonly id: string;
  readonly kind: FloorKind;
  /** 教室なら SchoolPlan.rooms の添字，それ以外は -1 */
  readonly room: number;
  readonly cells: CellRect;
  /** ワールド座標の範囲 */
  readonly rect: XZRect;
}

/** 壁 1 枚（2 つの格子点の間．端には柱を置く） */
export interface PlanWall {
  readonly id: string;
  /** 両側が教室・廊下・屋外のどれか（教室どうしを除く）なら窓付きの壁 */
  readonly kind: "wall" | "windowWall";
  readonly from: XZPoint;
  readonly to: XZPoint;
}

/** 柱（格子点の上） */
export interface PlanPost {
  readonly id: string;
  readonly x: number;
  readonly z: number;
}

/** マスをふさぐ直方体（`wall` のマスをまとめた矩形） */
export interface PlanBlock {
  readonly id: string;
  readonly cells: CellRect;
  readonly rect: XZRect;
}

/** ドア・出口のマスの開口部の上の垂れ壁（床から bottom（m）の高さから天井まで） */
export interface PlanLintel {
  readonly id: string;
  readonly from: XZPoint;
  readonly to: XZPoint;
  readonly bottom: number;
}

/**
 * 防火シャッター（並んだ `shutter` のマスの中心線に沿う）．
 * 長さが防火シャッターのパーツの下限に足りなければ kind を "wall" にする（シャッターは非常ベルの時点で
 * 閉じている扱いのため，壁と同じく通れない．SPEC_02「通れる・燃え広がる」）
 */
export interface PlanShutter {
  readonly id: string;
  readonly kind: "fireShutter" | "wall";
  readonly from: XZPoint;
  readonly to: XZPoint;
  readonly cells: readonly CellXZ[];
}

/** SchoolPlan の 1 フロアの組み立て方 */
export interface SchoolPlanLayout {
  readonly cellSize: number;
  readonly ceilingHeight: number;
  /** マス目全体の範囲（ワールド座標） */
  readonly bounds: XZRect;
  /** 屋内の床の面（天井を張る） */
  readonly floors: readonly PlanFloorSurface[];
  /** 屋外のマスをまとめた矩形（ワールド座標．天井は張らない） */
  readonly outdoor: readonly XZRect[];
  readonly walls: readonly PlanWall[];
  readonly posts: readonly PlanPost[];
  readonly blocks: readonly PlanBlock[];
  readonly lintels: readonly PlanLintel[];
  readonly shutters: readonly PlanShutter[];
  /** 開始地点（マスの中心のワールド座標）と向き（rad．0 で -Z，正で左へ回る．Space.startYaw と同じ約束） */
  readonly start: { readonly x: number; readonly z: number; readonly yaw: number };
}

// ---------------------------------------------------------------------------
// 向き

/**
 * SchoolPlan の向き（rad．0 で -Z（エディタの上）を向き，右回り（エディタの画面で時計回り）に増える．
 * SPEC_02「座標」）を，3D の空間の向き（rad．0 で -Z を向き，正で左へ回る．Space.startYaw と同じ）に変える．
 * 向きを変える所はすべてこの関数を通す（約束の食い違いを 1 か所に閉じ込めるため）．
 * -0 は 0 にそろえる（比べやすくし，表示で "-0" が出ないようにするため）．NaN はそのまま返す
 */
export function planYawToSpaceYaw(planYaw: number): number {
  const yaw = -planYaw;
  return yaw === 0 ? 0 : yaw;
}

// ---------------------------------------------------------------------------
// マスをまとめた矩形

/**
 * keyOf が同じ値を返すマスを，重ならない矩形に分ける（左上から順に，右へ伸ばしてから下へ伸ばす）．
 * keyOf が null のマスは含めない
 */
export function cellRects(
  floor: Floor,
  keyOf: (x: number, z: number) => string | null,
): { readonly key: string; readonly cells: CellRect }[] {
  const used = new Array<boolean>(floor.width * floor.depth).fill(false);
  const free = (x: number, z: number, key: string) =>
    x < floor.width && z < floor.depth && !used[cellIndex(floor, x, z)] && keyOf(x, z) === key;
  const result: { key: string; cells: CellRect }[] = [];
  for (let z = 0; z < floor.depth; z++) {
    for (let x = 0; x < floor.width; x++) {
      const key = keyOf(x, z);
      if (key === null || used[cellIndex(floor, x, z)]) continue;
      let x1 = x + 1;
      while (free(x1, z, key)) x1++;
      let z1 = z + 1;
      while (rowFree(x, x1, z1, (cx, cz) => free(cx, cz, key))) z1++;
      for (let cz = z; cz < z1; cz++) {
        for (let cx = x; cx < x1; cx++) used[cellIndex(floor, cx, cz)] = true;
      }
      result.push({ key, cells: { x0: x, z0: z, x1, z1 } });
    }
  }
  return result;
}

function rowFree(
  x0: number,
  x1: number,
  z: number,
  free: (x: number, z: number) => boolean,
): boolean {
  for (let x = x0; x < x1; x++) if (!free(x, z)) return false;
  return true;
}

function cellRectToWorld(cells: CellRect, cellSize: number): XZRect {
  return {
    minX: cells.x0 * cellSize,
    maxX: cells.x1 * cellSize,
    minZ: cells.z0 * cellSize,
    maxZ: cells.z1 * cellSize,
  };
}

/** 屋内の床の面のまとめ方（教室は教室ごと，廊下はすべてで 1 つ，ドア・出口・シャッターのマスは開口部で 1 つ） */
function indoorFloorKey(floor: Floor, x: number, z: number): string | null {
  switch (kindAt(floor, x, z)) {
    case "classroom":
      return `room-${floor.roomOf[cellIndex(floor, x, z)]}`;
    case "corridor":
      return "corridor";
    case "door":
    case "exit":
    case "shutter":
      return "opening";
    default:
      return null;
  }
}

// ---------------------------------------------------------------------------
// 辺（マスとマスの間の長さ 1 マスの線分）

/**
 * 格子線の上の長さ 1 マスの辺．axis "x" は線 z = line の上で x = i〜i+1（上下のマスの間），
 * axis "z" は線 x = line の上で z = i〜i+1（左右のマスの間）
 */
interface UnitEdge {
  readonly axis: "x" | "z";
  readonly line: number;
  readonly i: number;
}

/** 辺の両側のマス（マス目の外でもよい） */
function edgeSides(edge: UnitEdge): readonly [CellXZ, CellXZ] {
  return edge.axis === "x"
    ? [
        { x: edge.i, z: edge.line - 1 },
        { x: edge.i, z: edge.line },
      ]
    : [
        { x: edge.line - 1, z: edge.i },
        { x: edge.line, z: edge.i },
      ];
}

/** 線の数と，線の上の辺の数 */
function lineCounts(floor: Floor, axis: "x" | "z"): { lines: number; length: number } {
  return axis === "x"
    ? { lines: floor.depth + 1, length: floor.width }
    : { lines: floor.width + 1, length: floor.depth };
}

const WINDOW_SIDE_KINDS: ReadonlySet<CellKind> = new Set(["classroom", "corridor", "outdoor"]);

/** 壁を置く辺の見た目（壁を置かない辺は null） */
function edgeWallKind(floor: Floor, edge: UnitEdge): PlanWall["kind"] | null {
  const [a, b] = edgeSides(edge);
  if (!wallBetween(floor, a, b)) return null;
  const ka = kindAt(floor, a.x, a.z);
  const kb = kindAt(floor, b.x, b.z);
  const windowed =
    ka !== null &&
    kb !== null &&
    WINDOW_SIDE_KINDS.has(ka) &&
    WINDOW_SIDE_KINDS.has(kb) &&
    !(ka === "classroom" && kb === "classroom");
  return windowed ? "windowWall" : "wall";
}

/** 辺の両側のどちらかがドア・出口のマスなら，その種類（出口を優先） */
function edgeOpeningKind(floor: Floor, edge: UnitEdge): "door" | "exit" | null {
  const kinds = edgeSides(edge).map((c) => kindAt(floor, c.x, c.z));
  if (kinds.includes("exit")) return "exit";
  if (kinds.includes("door")) return "door";
  return null;
}

/** 辺の端点（格子点）の座標（i が線の上の位置） */
function gridPoint(axis: "x" | "z", line: number, i: number, cellSize: number): XZPoint {
  return axis === "x"
    ? { x: i * cellSize, z: line * cellSize }
    : { x: line * cellSize, z: i * cellSize };
}

// ---------------------------------------------------------------------------
// 組み立て

/** 壁の辺の見た目の表（axis ごとに [line][i]） */
type WallTable = Record<"x" | "z", (PlanWall["kind"] | null)[][]>;

function wallTable(floor: Floor): WallTable {
  const build = (axis: "x" | "z") => {
    const { lines, length } = lineCounts(floor, axis);
    return Array.from({ length: lines }, (_, line) =>
      Array.from({ length }, (_, i) => edgeWallKind(floor, { axis, line, i })),
    );
  };
  return { x: build("x"), z: build("z") };
}

/**
 * 格子点 (px, pz) で壁を区切るか．壁が 1 本も来ない点は区切らない．
 * 同じ見た目の壁がまっすぐ通り抜けるだけの点（左右だけ・上下だけ）は区切らず，それ以外（端・角・T 字・十字・
 * 見た目の変わり目）は区切って柱を置く（TECH_01「大きさの約束」）
 */
function isBreakPoint(table: WallTable, px: number, pz: number): boolean {
  const left = table.x[pz]?.[px - 1] ?? null;
  const right = table.x[pz]?.[px] ?? null;
  const up = table.z[px]?.[pz - 1] ?? null;
  const down = table.z[px]?.[pz] ?? null;
  const count = [left, right, up, down].filter((k) => k !== null).length;
  if (count === 0) return false;
  if (count === 2 && left !== null && left === right) return false;
  if (count === 2 && up !== null && up === down) return false;
  return true;
}

/** 壁と柱 */
function planWalls(
  floor: Floor,
  table: WallTable,
  cellSize: number,
): { walls: PlanWall[]; posts: Map<string, PlanPost> } {
  const walls: PlanWall[] = [];
  const posts = new Map<string, PlanPost>();
  const addPost = (p: XZPoint) => {
    const key = `${p.x},${p.z}`;
    if (!posts.has(key)) posts.set(key, { id: `post-${posts.size}`, x: p.x, z: p.z });
  };
  for (const axis of ["x", "z"] as const) {
    const { lines, length } = lineCounts(floor, axis);
    for (let line = 0; line < lines; line++) {
      const row = table[axis][line] ?? [];
      let i = 0;
      while (i < length) {
        const kind = row[i] ?? null;
        if (kind === null) {
          i++;
          continue;
        }
        let end = i + 1;
        while (end < length && row[end] === kind && !isBreakAt(table, axis, line, end)) end++;
        const from = gridPoint(axis, line, i, cellSize);
        const to = gridPoint(axis, line, end, cellSize);
        walls.push({ id: `wall-${walls.length}`, kind, from, to });
        addPost(from);
        addPost(to);
        i = end;
      }
    }
  }
  return { walls, posts };
}

function isBreakAt(table: WallTable, axis: "x" | "z", line: number, i: number): boolean {
  return axis === "x" ? isBreakPoint(table, i, line) : isBreakPoint(table, line, i);
}

/**
 * ドア・出口のマスの開口部の垂れ壁．格子線の上で，壁を置かずドア・出口のマスに接する辺が続く区間のうち，
 * 両端の隣の辺に壁があるもの（壁の列に空いた開口部）の上に置く
 */
function planLintels(floor: Floor, table: WallTable, cellSize: number): PlanLintel[] {
  const lintels: PlanLintel[] = [];
  for (const axis of ["x", "z"] as const) {
    const { lines, length } = lineCounts(floor, axis);
    for (let line = 0; line < lines; line++) {
      const row = table[axis][line] ?? [];
      let i = 0;
      while (i < length) {
        const opening = row[i] === null ? edgeOpeningKind(floor, { axis, line, i }) : null;
        if (opening === null) {
          i++;
          continue;
        }
        let end = i;
        let hasExit = false;
        while (end < length && row[end] === null) {
          const k = edgeOpeningKind(floor, { axis, line, i: end });
          if (k === null) break;
          if (k === "exit") hasExit = true;
          end++;
        }
        const bounded = (row[i - 1] ?? null) !== null && (row[end] ?? null) !== null;
        if (bounded) {
          lintels.push({
            id: `lintel-${lintels.length}`,
            from: gridPoint(axis, line, i, cellSize),
            to: gridPoint(axis, line, end, cellSize),
            bottom: hasExit ? EXIT.height : DOOR.height,
          });
        }
        i = end;
      }
    }
  }
  return lintels;
}

/**
 * 防火シャッター．左右に並んだ `shutter` のマスは X に沿う 1 枚，上下に並んだもの・1 つだけのものは
 * 通り抜ける向きに直交する 1 枚にする（どちらもマスの中心線の上）
 */
function planShutters(floor: Floor, cellSize: number): PlanShutter[] {
  const isShutter = (x: number, z: number) => kindAt(floor, x, z) === "shutter";
  const assigned = new Set<number>();
  const shutters: PlanShutter[] = [];
  const add = (cells: CellXZ[], alongX: boolean) => {
    for (const c of cells) assigned.add(cellIndex(floor, c.x, c.z));
    const first = cells[0];
    const last = cells[cells.length - 1];
    if (!first || !last) return;
    const from = alongX
      ? { x: first.x * cellSize, z: (first.z + 0.5) * cellSize }
      : { x: (first.x + 0.5) * cellSize, z: first.z * cellSize };
    const to = alongX
      ? { x: (last.x + 1) * cellSize, z: (last.z + 0.5) * cellSize }
      : { x: (last.x + 0.5) * cellSize, z: (last.z + 1) * cellSize };
    const length = cells.length * cellSize;
    shutters.push({
      id: `shutter-${shutters.length}`,
      kind: length >= minEdgeLength("fireShutter") ? "fireShutter" : "wall",
      from,
      to,
      cells,
    });
  };
  // 左右に 2 つ以上並ぶもの
  for (let z = 0; z < floor.depth; z++) {
    let x = 0;
    while (x < floor.width) {
      let end = x;
      while (end < floor.width && isShutter(end, z)) end++;
      if (end - x >= 2) {
        add(
          Array.from({ length: end - x }, (_, k) => ({ x: x + k, z })),
          true,
        );
      }
      x = Math.max(end, x + 1);
    }
  }
  // 残り（上下に並ぶもの・1 つだけのもの）
  for (let x = 0; x < floor.width; x++) {
    let z = 0;
    while (z < floor.depth) {
      let end = z;
      while (end < floor.depth && isShutter(x, end) && !assigned.has(cellIndex(floor, x, end))) {
        end++;
      }
      if (end > z) {
        const cells = Array.from({ length: end - z }, (_, k) => ({ x, z: z + k }));
        // 1 つだけのものは，左右が通れるなら（左右へ通り抜けるなら）Z に沿わせる
        const alongX =
          cells.length === 1 &&
          !(isWalkableKind(kindAt(floor, x - 1, z)) && isWalkableKind(kindAt(floor, x + 1, z)));
        add(cells, alongX);
      }
      z = Math.max(end, z + 1);
    }
  }
  return shutters;
}

/**
 * SchoolPlan の floorIndex 階の組み立て方を求める（既定は 1 つ目の階．階段・複数フロアは扱わない）．
 * 階が無ければ RangeError
 */
export function schoolPlanLayout(plan: SchoolPlan, floorIndex = 0): SchoolPlanLayout {
  const floor = plan.floors[floorIndex];
  if (!floor) throw new RangeError(`階がありません: ${floorIndex}`);
  const cellSize = plan.cellSize;
  const table = wallTable(floor);

  const floors = cellRects(floor, (x, z) => indoorFloorKey(floor, x, z)).map(
    ({ key, cells }, i): PlanFloorSurface => {
      const room = key.startsWith("room-") ? Number(key.slice("room-".length)) : -1;
      return {
        id: `${key}-floor-${i}`,
        kind: room >= 0 ? "classroom" : "corridor",
        room,
        cells,
        rect: cellRectToWorld(cells, cellSize),
      };
    },
  );
  const outdoor = cellRects(floor, (x, z) =>
    kindAt(floor, x, z) === "outdoor" ? "outdoor" : null,
  ).map(({ cells }) => cellRectToWorld(cells, cellSize));
  const blocks = cellRects(floor, (x, z) => (kindAt(floor, x, z) === "wall" ? "wall" : null)).map(
    ({ cells }, i): PlanBlock => ({
      id: `block-${i}`,
      cells,
      rect: cellRectToWorld(cells, cellSize),
    }),
  );

  const { walls, posts } = planWalls(floor, table, cellSize);
  const shutters = planShutters(floor, cellSize);
  // シャッターの両端にも柱を置き，壁・直方体との間の隙間（壁の板は柱の半分だけ短い）をふさぐ
  for (const s of shutters) {
    for (const p of [s.from, s.to]) {
      const key = `${p.x},${p.z}`;
      if (!posts.has(key)) posts.set(key, { id: `post-${posts.size}`, x: p.x, z: p.z });
    }
  }

  const start = plan.drill.start;
  return {
    cellSize,
    ceilingHeight: SCHOOL_CEILING_HEIGHT,
    bounds: { minX: 0, maxX: floor.width * cellSize, minZ: 0, maxZ: floor.depth * cellSize },
    floors,
    outdoor,
    walls,
    posts: [...posts.values()],
    blocks,
    lintels: planLintels(floor, table, cellSize),
    shutters,
    start: {
      x: (start.x + 0.5) * cellSize,
      z: (start.z + 0.5) * cellSize,
      yaw: planYawToSpaceYaw(plan.drill.startYaw),
    },
  };
}
