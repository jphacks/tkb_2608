// SchoolPlan の 1 フロアから，シナリオの判定に使うエリア（SPEC_01「エリアの ID」）を求める（three に依存しない純粋な関数）．
// エリアは assembly・room:<教室の添字>・corridor・outdoor の 4 種類．マスの判定は sim/ の worldToCell（Math.floor）と同じにする

import type { CellRef, Floor, SchoolPlan } from "../../core/schoolPlan";
import { cellIndex, kindAt } from "../../sim/grid";
import type { FloorArea } from "../walk/areas";
import { type CellRect, cellRects } from "./schoolPlanLayout";

/** 集合場所のエリアの ID（scenario/ の ASSEMBLY_AREA_ID と同じ値．scenes/ から scenario/ は import しないため値を書く） */
export const ASSEMBLY_AREA = "assembly";
/** 廊下のエリアの ID */
export const CORRIDOR_AREA = "corridor";
/** 屋外のエリアの ID（集合場所のマスも含む） */
export const OUTDOOR_AREA = "outdoor";

/** 教室のエリアの ID（room:<SchoolPlan.rooms の添字>） */
export function roomAreaId(roomIndex: number): string {
  return `room:${roomIndex}`;
}

/**
 * エリアの矩形の大きい側（maxX・maxZ）を内側へ寄せる幅（m）．walk/ の areasAt は境界の線の上を含むが，
 * sim/ の worldToCell は線の上を大きい側のマスとする．寄せることで，線の上の位置（屋外の端に押し付けられた時等）が
 * 隣のマスのエリアに入らず，集合場所に入った判定と evaluateDrill() の到着の判定のマスがそろう
 */
export const AREA_EDGE_INSET = 1e-6;

function toArea(id: string, cells: CellRect, cellSize: number): FloorArea {
  return {
    id,
    minX: cells.x0 * cellSize,
    maxX: cells.x1 * cellSize - AREA_EDGE_INSET,
    minZ: cells.z0 * cellSize,
    maxZ: cells.z1 * cellSize - AREA_EDGE_INSET,
  };
}

/** マスの種類から決まるエリア（集合場所以外）．ドア・出口・シャッター・柱・何もないマスは null */
function kindAreaId(floor: Floor, x: number, z: number): string | null {
  switch (kindAt(floor, x, z)) {
    case "classroom": {
      const room = floor.roomOf[cellIndex(floor, x, z)] ?? -1;
      return room >= 0 ? roomAreaId(room) : null;
    }
    case "corridor":
      return CORRIDOR_AREA;
    case "outdoor":
      return OUTDOOR_AREA;
    default:
      return null;
  }
}

/** 集合場所のマスのうち floorIndex 階にあり，マス目の中にあるもの */
export function assemblyCellsOnFloor(plan: SchoolPlan, floorIndex = 0): CellRef[] {
  const floor = plan.floors[floorIndex];
  if (!floor) return [];
  return plan.drill.assembly.filter(
    (c) =>
      c.floor === floorIndex &&
      Number.isInteger(c.x) &&
      Number.isInteger(c.z) &&
      c.x >= 0 &&
      c.z >= 0 &&
      c.x < floor.width &&
      c.z < floor.depth,
  );
}

/**
 * SchoolPlan の floorIndex 階（既定は 1 つ目）のエリアを求める（ワールド座標，m）．
 * 同じ ID のマスは重ならない矩形にまとめる．集合場所のマスは assembly と，マスの種類のエリア（outdoor 等）の両方に入る．
 * 階が無ければ空の列
 */
export function schoolPlanAreas(plan: SchoolPlan, floorIndex = 0): FloorArea[] {
  const floor = plan.floors[floorIndex];
  if (!floor) return [];
  const { cellSize } = plan;
  const assembly = new Set(
    assemblyCellsOnFloor(plan, floorIndex).map((c) => cellIndex(floor, c.x, c.z)),
  );
  const assemblyAreas = cellRects(floor, (x, z) =>
    assembly.has(cellIndex(floor, x, z)) ? ASSEMBLY_AREA : null,
  ).map(({ key, cells }) => toArea(key, cells, cellSize));
  const kindAreas = cellRects(floor, (x, z) => kindAreaId(floor, x, z)).map(({ key, cells }) =>
    toArea(key, cells, cellSize),
  );
  return [...assemblyAreas, ...kindAreas];
}
