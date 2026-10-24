// 結果画面の地図に重ねるもの（経路・区間・印・教室の名前）を，1 つの階について地図の座標で組み立てる（純粋な関数）．
// 描画（mapCanvas.ts）はここで作った点を Canvas の座標に変えて描くだけにする
import type { DrillEvaluation, DrillInterval, DrillSample, DrillTrack } from "../core/drill";
import type { CellRef, SchoolPlan } from "../core/schoolPlan";
import { cellCenter, type MapPoint, worldToMap } from "./mapLayout";

/** 地図の座標の折れ線（点が 1 つだけの時は点として描く） */
export type MapPolyline = readonly MapPoint[];

/** マスの位置（その階の中の x・z） */
export interface MapCell {
  readonly x: number;
  readonly z: number;
}

/** 教室の名前を出す位置 */
export interface RoomLabel {
  readonly name: string;
  /** 教室のマスの中心の平均（地図の座標） */
  readonly at: MapPoint;
}

/** 1 つの階の地図に重ねるもの（どれも地図の座標） */
export interface MapOverlay {
  /** 正解経路（緑）．階が切り替わる所で分ける */
  readonly correctRoute: readonly MapPolyline[];
  /** 自分の経路（青）．階が切り替わる所・座標が壊れた記録で分ける */
  readonly ownPath: readonly MapPolyline[];
  /** 外れた区間（橙） */
  readonly offRoute: readonly MapPolyline[];
  /** 煙の中で立っていた区間 */
  readonly smokeStanding: readonly MapPolyline[];
  /** 火に近づいた点（赤） */
  readonly nearFire: readonly MapPoint[];
  /** 開始地点（この階に無ければ null） */
  readonly start: MapPoint | null;
  /** 集合場所のマス */
  readonly assembly: readonly MapCell[];
  /** 火元のマス */
  readonly fireOrigins: readonly MapCell[];
  readonly roomLabels: readonly RoomLabel[];
}

/** 結果画面で最初に見せる階（開始地点の階．開始地点の階が無い時は 0） */
export function defaultDebriefFloor(plan: SchoolPlan): number {
  const floor = plan.drill.start.floor;
  return Number.isInteger(floor) && floor >= 0 && floor < plan.floors.length ? floor : 0;
}

/**
 * 記録のうち fromIndex〜toIndex（両端を含む．範囲外は記録の範囲に切り詰める）の，floor の階にいた所を折れ線にする．
 * 別の階の記録と，座標が有限でない記録の所で線を分ける（階をまたいで線を引かない）
 */
export function trackPolylines(
  samples: readonly DrillSample[],
  cellSize: number,
  floor: number,
  fromIndex = 0,
  toIndex: number = samples.length - 1,
): MapPolyline[] {
  const from = Math.max(0, Math.ceil(fromIndex));
  const to = Math.min(samples.length - 1, Math.floor(toIndex));
  const lines: MapPoint[][] = [];
  let current: MapPoint[] = [];
  for (let i = from; i <= to; i++) {
    const sample = samples[i];
    const point = sample.floor === floor ? worldToMap(sample.x, sample.z, cellSize) : null;
    if (point === null) {
      if (current.length > 0) lines.push(current);
      current = [];
      continue;
    }
    current.push(point);
  }
  if (current.length > 0) lines.push(current);
  return lines;
}

/** 区間の一覧を floor の階の折れ線にする（区間ごとに trackPolylines） */
export function intervalPolylines(
  samples: readonly DrillSample[],
  intervals: readonly DrillInterval[],
  cellSize: number,
  floor: number,
): MapPolyline[] {
  return intervals.flatMap((interval) =>
    trackPolylines(samples, cellSize, floor, interval.fromIndex, interval.toIndex),
  );
}

/** 正解経路のマスの列を，floor の階の中で続いている所ごとの折れ線（マスの中心を結ぶ）にする */
export function routePolylines(route: readonly CellRef[], floor: number): MapPolyline[] {
  const lines: MapPoint[][] = [];
  let current: MapPoint[] = [];
  for (const cell of route) {
    if (cell.floor !== floor) {
      if (current.length > 0) lines.push(current);
      current = [];
      continue;
    }
    current.push(cellCenter(cell));
  }
  if (current.length > 0) lines.push(current);
  return lines;
}

/** floor の階にある教室ごとに，名前と，教室のマスの中心の平均の位置を返す（その階にマスの無い教室は出さない） */
export function roomLabels(plan: SchoolPlan, floor: number): RoomLabel[] {
  const target = plan.floors[floor];
  if (target === undefined) return [];
  const sums = new Map<number, { u: number; v: number; count: number }>();
  for (let z = 0; z < target.depth; z++) {
    for (let x = 0; x < target.width; x++) {
      const i = z * target.width + x;
      if (target.cells[i] !== "classroom") continue;
      const room = target.roomOf[i];
      if (room === undefined || room < 0 || plan.rooms[room] === undefined) continue;
      const sum = sums.get(room) ?? { u: 0, v: 0, count: 0 };
      sum.u += x + 0.5;
      sum.v += z + 0.5;
      sum.count += 1;
      sums.set(room, sum);
    }
  }
  return [...sums.entries()]
    .sort(([a], [b]) => a - b)
    .map(([room, sum]) => ({
      name: plan.rooms[room].name,
      at: { u: sum.u / sum.count, v: sum.v / sum.count },
    }));
}

/** 1 つの階の地図に重ねるものをまとめて組み立てる */
export function buildMapOverlay(
  plan: SchoolPlan,
  floor: number,
  track: DrillTrack,
  evaluation: DrillEvaluation,
): MapOverlay {
  const { samples } = track;
  const onFloor = (cell: CellRef): boolean => cell.floor === floor;
  const toCell = (cell: CellRef): MapCell => ({ x: cell.x, z: cell.z });
  const nearFire: MapPoint[] = [];
  for (const moment of evaluation.nearFire) {
    if (moment.floor !== floor) continue;
    const point = worldToMap(moment.x, moment.z, plan.cellSize);
    if (point !== null) nearFire.push(point);
  }
  return {
    correctRoute: routePolylines(plan.drill.route, floor),
    ownPath: trackPolylines(samples, plan.cellSize, floor),
    offRoute: intervalPolylines(samples, evaluation.offRoute, plan.cellSize, floor),
    smokeStanding: intervalPolylines(samples, evaluation.smokeStanding, plan.cellSize, floor),
    nearFire,
    start: onFloor(plan.drill.start) ? cellCenter(plan.drill.start) : null,
    assembly: plan.drill.assembly.filter(onFloor).map(toCell),
    fireOrigins: plan.drill.fireOrigins.filter(onFloor).map(toCell),
    roomLabels: roomLabels(plan, floor),
  };
}
