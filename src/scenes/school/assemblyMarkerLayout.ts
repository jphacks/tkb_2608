// 集合場所の床の印の並べ方（three に依存しない純粋な関数）．集合場所のマスを塗る面と，
// 集合場所のまとまりの外周に沿った枠の帯を求める．座標はワールド座標（m）で，1 つ目の階だけを扱う

import type { SchoolPlan } from "../../core/schoolPlan";
import type { XZRect } from "../walk/collision";
import { assemblyCellsOnFloor } from "./schoolAreas";
import { cellRects } from "./schoolPlanLayout";

/** 塗る面を床（地面）から浮かせる高さ（m．床の矢印 ROUTE_ARROW_LIFT の 0.02 より低くし，矢印が上に見えるようにする） */
export const ASSEMBLY_FILL_LIFT = 0.01;
/** 枠の帯を浮かせる高さ（m．塗る面より少し上） */
export const ASSEMBLY_FRAME_LIFT = 0.012;
/** 枠の帯の幅（マス 1 辺に対する割合．マスの内側に引く） */
export const ASSEMBLY_FRAME_RATIO = 0.12;

/** 集合場所の床の印の並べ方 */
export interface AssemblyMarkerLayout {
  /** 塗る面（集合場所のマスを重ならない矩形にまとめたもの） */
  readonly fills: readonly XZRect[];
  /** 枠の帯（集合場所のまとまりの外周の辺ごと．隣が集合場所でない辺だけ） */
  readonly frames: readonly XZRect[];
}

/**
 * 集合場所の床の印の並べ方を求める．1 つ目の階のマス目の中にある集合場所だけを扱う（校舎の空間が 1 つ目の階だけのため）．
 * 集合場所が無ければ両方とも空
 */
export function layoutAssemblyMarker(plan: SchoolPlan): AssemblyMarkerLayout {
  const floor = plan.floors[0];
  const cells = assemblyCellsOnFloor(plan, 0);
  if (!floor || cells.length === 0) return { fills: [], frames: [] };
  const size = plan.cellSize;
  const keys = new Set(cells.map((c) => `${c.x},${c.z}`));
  const isAssembly = (x: number, z: number) => keys.has(`${x},${z}`);

  const fills = cellRects(floor, (x, z) => (isAssembly(x, z) ? "assembly" : null)).map(
    ({ cells: r }) => ({
      minX: r.x0 * size,
      maxX: r.x1 * size,
      minZ: r.z0 * size,
      maxZ: r.z1 * size,
    }),
  );

  const band = size * ASSEMBLY_FRAME_RATIO;
  const frames: XZRect[] = [];
  // 重複を避けるためマスの順（z → x）に並べ，同じ入力なら毎回同じ並びにする
  const sorted = [...keys]
    .map((k) => k.split(",").map(Number) as [number, number])
    .sort((a, b) => a[1] - b[1] || a[0] - b[0]);
  for (const [x, z] of sorted) {
    const x0 = x * size;
    const z0 = z * size;
    const x1 = x0 + size;
    const z1 = z0 + size;
    if (!isAssembly(x, z - 1)) frames.push({ minX: x0, maxX: x1, minZ: z0, maxZ: z0 + band });
    if (!isAssembly(x, z + 1)) frames.push({ minX: x0, maxX: x1, minZ: z1 - band, maxZ: z1 });
    if (!isAssembly(x - 1, z)) frames.push({ minX: x0, maxX: x0 + band, minZ: z0, maxZ: z1 });
    if (!isAssembly(x + 1, z)) frames.push({ minX: x1 - band, maxX: x1, minZ: z0, maxZ: z1 });
  }
  return { fills, frames };
}
