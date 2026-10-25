// エディタの上から見た図の配置の計算（マスの大きさ・画面の位置とマスの変換・壁の線・教室の名前の位置）．
// Canvas に描く殻（editorCanvas.ts）とマウスの操作の殻（editor.ts）から使う純粋な関数
import type { CellRef, DrillSetup, Floor, Room } from "../core/schoolPlan";
import type { CellXZ } from "../sim/grid";
import { wallBetween } from "../sim/walls";

/** マス目を Canvas のどこにどの大きさで描くか（すべて CSS の px） */
export interface GridLayout {
  /** マス 1 辺の大きさ（px） */
  readonly cellPx: number;
  /** マス目の左上の位置（px） */
  readonly offsetX: number;
  readonly offsetY: number;
}

/** マス目の周りに空ける余白（px） */
export const GRID_MARGIN_PX = 16;

/** マスの大きさの上限（px．小さい校舎が大きくなりすぎないように） */
export const MAX_CELL_PX = 48;

/**
 * マス目が Canvas（幅 canvasWidth × 高さ canvasHeight px）に余白つきで収まる，整数のマスの大きさと，
 * 真ん中に置く時の左上の位置を求める．収まらないほど狭い時も 1 px は確保する
 */
export function computeGridLayout(
  floor: Pick<Floor, "width" | "depth">,
  canvasWidth: number,
  canvasHeight: number,
): GridLayout {
  const usableW = Math.max(0, canvasWidth - GRID_MARGIN_PX * 2);
  const usableH = Math.max(0, canvasHeight - GRID_MARGIN_PX * 2);
  const fit = Math.floor(Math.min(usableW / floor.width, usableH / floor.depth));
  const cellPx = Math.max(1, Math.min(MAX_CELL_PX, Number.isFinite(fit) ? fit : 1));
  return {
    cellPx,
    offsetX: Math.floor((canvasWidth - cellPx * floor.width) / 2),
    offsetY: Math.floor((canvasHeight - cellPx * floor.depth) / 2),
  };
}

/** Canvas の位置（CSS の px）にあるマス．マス目の外なら null */
export function canvasToCell(
  layout: GridLayout,
  floor: Pick<Floor, "width" | "depth">,
  px: number,
  py: number,
): CellXZ | null {
  const x = Math.floor((px - layout.offsetX) / layout.cellPx);
  const z = Math.floor((py - layout.offsetY) / layout.cellPx);
  if (!(x >= 0 && x < floor.width && z >= 0 && z < floor.depth)) return null;
  return { x, z };
}

/** マスの境目の線分（マスの座標．(x1, z1) から (x2, z2) へ．格子の線の上にある） */
export interface GridEdge {
  readonly x1: number;
  readonly z1: number;
  readonly x2: number;
  readonly z2: number;
}

/**
 * 薄い壁が立つ辺の一覧（SPEC_02「壁の自動配置」．sim/ の wallBetween の結果そのまま）．
 * マス目の外側の辺（外とマス目の端の間）も含める
 */
export function wallEdges(floor: Floor): GridEdge[] {
  const edges: GridEdge[] = [];
  // 左右に隣り合う組（x と x + 1 の間の縦の線）．x = -1 は左端の外
  for (let z = 0; z < floor.depth; z++) {
    for (let x = -1; x < floor.width; x++) {
      if (wallBetween(floor, { x, z }, { x: x + 1, z })) {
        edges.push({ x1: x + 1, z1: z, x2: x + 1, z2: z + 1 });
      }
    }
  }
  // 上下に隣り合う組（z と z + 1 の間の横の線）．z = -1 は上端の外
  for (let x = 0; x < floor.width; x++) {
    for (let z = -1; z < floor.depth; z++) {
      if (wallBetween(floor, { x, z }, { x, z: z + 1 })) {
        edges.push({ x1: x, z1: z + 1, x2: x + 1, z2: z + 1 });
      }
    }
  }
  return edges;
}

/** 教室の名前を描く位置（その教室のマスの中心の平均．マスの座標で，マスの中心は +0.5） */
export interface RoomLabel {
  readonly room: number;
  readonly name: string;
  readonly x: number;
  readonly z: number;
}

/** マスが 1 つもある教室ごとの名前の位置（マスの無い教室は含めない） */
export function roomLabels(floor: Floor, rooms: readonly Room[]): RoomLabel[] {
  const sumX = new Array<number>(rooms.length).fill(0);
  const sumZ = new Array<number>(rooms.length).fill(0);
  const count = new Array<number>(rooms.length).fill(0);
  for (let z = 0; z < floor.depth; z++) {
    for (let x = 0; x < floor.width; x++) {
      const i = z * floor.width + x;
      const room = floor.roomOf[i];
      if (floor.cells[i] !== "classroom" || !(room >= 0 && room < rooms.length)) continue;
      sumX[room] += x + 0.5;
      sumZ[room] += z + 0.5;
      count[room]++;
    }
  }
  const labels: RoomLabel[] = [];
  rooms.forEach((r, room) => {
    if (count[room] === 0) return;
    labels.push({ room, name: r.name, x: sumX[room] / count[room], z: sumZ[room] / count[room] });
  });
  return labels;
}

/** マス目の上に重ねる訓練条件の印（描く階のマス目の中にある物だけ） */
export interface DrillMarkers {
  readonly fireOrigins: readonly CellXZ[];
  /** 開始地点．この階に無い・マス目の外なら null */
  readonly start: CellXZ | null;
  readonly assembly: readonly CellXZ[];
}

/**
 * 訓練条件のうち，floorIndex 階（SchoolPlan.floors の添字）のマス目の中にある印．
 * マス目の外に出た物（大きさを変えた時等）は描かない（validatePlan の誤りとして見える）
 */
export function drillMarkers(drill: DrillSetup, floorIndex: number, floor: Floor): DrillMarkers {
  const onFloor = (ref: CellRef): boolean =>
    ref.floor === floorIndex &&
    Number.isInteger(ref.x) &&
    Number.isInteger(ref.z) &&
    ref.x >= 0 &&
    ref.x < floor.width &&
    ref.z >= 0 &&
    ref.z < floor.depth;
  const toXZ = (ref: CellRef): CellXZ => ({ x: ref.x, z: ref.z });
  return {
    fireOrigins: drill.fireOrigins.filter(onFloor).map(toXZ),
    start: onFloor(drill.start) ? toXZ(drill.start) : null,
    assembly: drill.assembly.filter(onFloor).map(toXZ),
  };
}

/** 集合場所のひとまとまり（上下左右につながった集合場所のマス）．エディタではマスごとではなく，まとまりで描く */
export interface AssemblyZone {
  /** まとまりのマス（上の行から，行の中は左から） */
  readonly cells: readonly CellXZ[];
  /** まとまりの外周の辺（隣が同じまとまりでない辺．穴があれば穴の縁も含む） */
  readonly edges: readonly GridEdge[];
  /** 旗を立てるマス（まとまりの最も上の行の，最も左のマス） */
  readonly flag: CellXZ;
}

/**
 * 集合場所のマスを，上下左右につながったまとまりに分ける（まとまりは旗のマスの上の行・左の順）．
 * 同じマスが重なって入っていても 1 つとして数える
 */
export function assemblyZones(cells: readonly CellXZ[]): AssemblyZone[] {
  const key = (x: number, z: number): string => `${x},${z}`;
  const all = new Map<string, CellXZ>();
  for (const c of cells) all.set(key(c.x, c.z), { x: c.x, z: c.z });
  const sorted = [...all.values()].sort((a, b) => a.z - b.z || a.x - b.x);
  const seen = new Set<string>();
  const zones: AssemblyZone[] = [];
  for (const first of sorted) {
    if (seen.has(key(first.x, first.z))) continue;
    // 上下左右につながったマスをたどる．sorted の順に始めるので，最初のマスが最も上・最も左になる
    const members: CellXZ[] = [];
    const queue: CellXZ[] = [first];
    seen.add(key(first.x, first.z));
    for (let c = queue.pop(); c !== undefined; c = queue.pop()) {
      members.push(c);
      for (const [dx, dz] of NEIGHBOR_STEPS) {
        const k = key(c.x + dx, c.z + dz);
        const next = all.get(k);
        if (next === undefined || seen.has(k)) continue;
        seen.add(k);
        queue.push(next);
      }
    }
    members.sort((a, b) => a.z - b.z || a.x - b.x);
    const edges: GridEdge[] = [];
    for (const { x, z } of members) {
      if (!all.has(key(x, z - 1))) edges.push({ x1: x, z1: z, x2: x + 1, z2: z });
      if (!all.has(key(x, z + 1))) edges.push({ x1: x, z1: z + 1, x2: x + 1, z2: z + 1 });
      if (!all.has(key(x - 1, z))) edges.push({ x1: x, z1: z, x2: x, z2: z + 1 });
      if (!all.has(key(x + 1, z))) edges.push({ x1: x + 1, z1: z, x2: x + 1, z2: z + 1 });
    }
    zones.push({ cells: members, edges, flag: first });
  }
  return zones;
}

/** 上下左右の隣への差（x, z） */
const NEIGHBOR_STEPS: readonly (readonly [number, number])[] = [
  [0, -1],
  [0, 1],
  [-1, 0],
  [1, 0],
];
