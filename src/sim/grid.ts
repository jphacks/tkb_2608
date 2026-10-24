// マス目の位置の計算（範囲の確認・添字・上下左右の隣・ワールド座標との変換）．
// 座標の決まりは docs/04_SPEC/SPEC_02_校舎データの形式.md「座標」を正とする
import type { CellKind, Floor } from "../core/schoolPlan";

/** 1 つの階の中のマスの位置（CellRef から階を除いたもの．CellRef もそのまま渡せる） */
export interface CellXZ {
  readonly x: number;
  readonly z: number;
}

/** 上下左右の隣への差（火・煙・人は 4 方向に移る．SPEC_02「通れる・燃え広がる」） */
export const NEIGHBOR_OFFSETS: readonly CellXZ[] = [
  { x: 0, z: -1 },
  { x: 1, z: 0 },
  { x: 0, z: 1 },
  { x: -1, z: 0 },
];

/** (x, z) がマス目の中か */
export function isInside(floor: Floor, x: number, z: number): boolean {
  return x >= 0 && x < floor.width && z >= 0 && z < floor.depth;
}

/** マスの配列の添字（z * width + x）．範囲は確かめない */
export function cellIndex(floor: Floor, x: number, z: number): number {
  return z * floor.width + x;
}

/** (x, z) のマスの種類．マス目の外は null */
export function kindAt(floor: Floor, x: number, z: number): CellKind | null {
  return isInside(floor, x, z) ? floor.cells[cellIndex(floor, x, z)] : null;
}

/** 2 つのマスが上下左右に隣り合うか */
export function isAdjacent(a: CellXZ, b: CellXZ): boolean {
  return Math.abs(a.x - b.x) + Math.abs(a.z - b.z) === 1;
}

/** ワールド座標（m）からそれを含むマスを求める（マス目の外でもそのまま返す） */
export function worldToCell(cellSize: number, worldX: number, worldZ: number): CellXZ {
  return { x: Math.floor(worldX / cellSize), z: Math.floor(worldZ / cellSize) };
}

/** マスの中心のワールド座標（m）．X・Z を CellXZ と同じ形で返す */
export function cellCenter(cellSize: number, cell: CellXZ): CellXZ {
  return { x: (cell.x + 0.5) * cellSize, z: (cell.z + 0.5) * cellSize };
}
