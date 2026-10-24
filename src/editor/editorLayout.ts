// エディタの上から見た図の配置の計算（マスの大きさ・画面の位置とマスの変換・壁の線・教室の名前の位置）．
// Canvas に描く殻（editorCanvas.ts）とマウスの操作の殻（editor.ts）から使う純粋な関数
import type { Floor, Room } from "../core/schoolPlan";
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
