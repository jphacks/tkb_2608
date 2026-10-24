// 正解経路の提案（E5）．延焼（SpreadMap）を見て，着いた時刻に燃えているマスを通らず，煙と火の側をなるべく避けた
// 最短の避難経路を開始地点から集合場所まで求める．教員はこれを元に経路を直す
import type { CellRef, Floor, SchoolPlan } from "../core/schoolPlan";
import { cellIndex, isInside, NEIGHBOR_OFFSETS } from "./grid";
import {
  ROUTE_DEPART_SECONDS,
  ROUTE_FIRE_MARGIN_SECONDS,
  ROUTE_FIRE_SIDE_LOOKAHEAD_SECONDS,
  ROUTE_FIRE_SIDE_PENALTY_CELLS,
  ROUTE_FIRE_SIDE_RANGE_CELLS,
  ROUTE_NEAR_FIRE_PENALTY_CELLS,
  ROUTE_SMOKE_PENALTY_CELLS,
  ROUTE_WALK_SPEED,
} from "./params";
import { isNearFire, type SpreadMap } from "./spread";
import { canPersonStep } from "./walls";

/** 経路の提案の条件．省いた項目は params.ts の既定値を使う */
export interface RouteOptions {
  /** 開始地点（既定は plan.drill.start．ES4 の開始地点ごとの QR で別の教室から求める時に渡す） */
  readonly start?: CellRef;
  /** 避難を始める時刻（非常ベルからの秒数．s） */
  readonly departSeconds?: number;
  /** 見込む歩く速さ（m/s） */
  readonly walkSpeed?: number;
}

/**
 * 開始地点から集合場所（plan.drill.assembly のどれか）までの経路を，上下左右に隣り合うマスの列で返す．
 * 列の最初は開始地点，最後は集合場所のマス．たどり着けない時は null．
 *
 * - 人は SPEC_02「通れる・燃え広がる」の規則で移り，着いた時刻から ROUTE_FIRE_MARGIN_SECONDS 秒以内に燃えるマスには
 *   入らない．その余裕では着けない時は，余裕なし（着いた時刻に燃えているマスだけ避ける）で探し直す
 * - 歩いたマスの数に，煙の着いたマス・燃えているマスの近く・火の側（先読みで燃えるマスの近く）を通った分の
 *   重み（params.ts）を足した値が最も小さい経路を選ぶ．時刻の上で火より先に通り抜けられても，火の側は遠回りしてでも避ける
 * - 集合場所は開始地点と同じ階のものだけを見る（段階 1 は 1 フロア）
 */
export function proposeRoute(
  plan: SchoolPlan,
  spread: SpreadMap,
  options: RouteOptions = {},
): readonly CellRef[] | null {
  const start = options.start ?? plan.drill.start;
  const floor = plan.floors[start.floor];
  if (floor === undefined || !isInside(floor, start.x, start.z)) return null;
  const departSeconds = options.departSeconds ?? ROUTE_DEPART_SECONDS;
  const walkSpeed = options.walkSpeed ?? ROUTE_WALK_SPEED;
  const secondsPerCell = plan.cellSize / walkSpeed;

  const assembly = new Set<number>();
  for (const cell of plan.drill.assembly) {
    if (cell.floor === start.floor && isInside(floor, cell.x, cell.z)) {
      assembly.add(cellIndex(floor, cell.x, cell.z));
    }
  }
  if (assembly.size === 0) return null;
  const startIndex = cellIndex(floor, start.x, start.z);
  if (assembly.has(startIndex)) return [start];

  const search = (fireMarginSeconds: number): CellRef[] | null =>
    searchRoute(floor, spread, start, assembly, departSeconds, secondsPerCell, fireMarginSeconds);
  // 余裕を取ると出口に着けない（火元が出口のそば等）時も，通れる経路があれば返す
  return search(ROUTE_FIRE_MARGIN_SECONDS) ?? (ROUTE_FIRE_MARGIN_SECONDS > 0 ? search(0) : null);
}

/**
 * 時間展開の探索の本体．着いた時刻から fireMarginSeconds 秒以内に燃えるマスには入らない．
 * 集合場所にたどり着けない時は null
 */
function searchRoute(
  floor: Floor,
  spread: SpreadMap,
  start: CellRef,
  assembly: ReadonlySet<number>,
  departSeconds: number,
  secondsPerCell: number,
  fireMarginSeconds: number,
): CellRef[] | null {
  const startIndex = cellIndex(floor, start.x, start.z);

  // 時刻で通れるマスが変わるため，歩いた数（k）ごとに層を作って広げる（時間展開の探索）．
  // 火も煙も一度着いたら消えないので，同じマスに「より早く，重みも小さく」着いた経路があれば後の経路は要らない．
  // この打ち切りで，各マスに残るのは重みが下がる時だけになり，探索は有限で終わる
  const labelCell: number[] = [startIndex];
  const labelParent: number[] = [-1];
  const labelCost: number[] = [0];
  const bestCostAt = new Array<number>(floor.cells.length).fill(Infinity);
  bestCostAt[startIndex] = 0;
  let frontier = [0];
  let bestLabel = -1;
  let bestCost = Infinity;

  // 重みは歩いた数以上なので，歩いた数が見つかった最良の重みに届いたら，それより良い経路は無い
  for (let k = 1; frontier.length > 0 && k < bestCost; k++) {
    const t = departSeconds + k * secondsPerCell;
    const layer = new Map<number, number>(); // マスの添字 → この層の最良のラベル
    for (const label of frontier) {
      const i = labelCell[label];
      const from = { x: i % floor.width, z: Math.floor(i / floor.width) };
      for (const d of NEIGHBOR_OFFSETS) {
        const to = { floor: start.floor, x: from.x + d.x, z: from.z + d.z };
        if (!canPersonStep(floor, from, to) || spread.fireAt(to) <= t + fireMarginSeconds) continue;
        let cost = labelCost[label] + 1;
        if (spread.smokeAt(to) <= t) cost += ROUTE_SMOKE_PENALTY_CELLS;
        if (isNearFire(spread, to, t)) cost += ROUTE_NEAR_FIRE_PENALTY_CELLS;
        cost += fireSidePenalty(spread, to, t);
        const j = cellIndex(floor, to.x, to.z);
        if (cost >= bestCostAt[j]) continue;
        const existing = layer.get(j);
        if (existing !== undefined && labelCost[existing] <= cost) continue;
        labelCell.push(j);
        labelParent.push(label);
        labelCost.push(cost);
        layer.set(j, labelCell.length - 1);
      }
    }
    frontier = [];
    for (const [j, label] of layer) {
      bestCostAt[j] = labelCost[label];
      if (assembly.has(j)) {
        if (labelCost[label] < bestCost) {
          bestCost = labelCost[label];
          bestLabel = label;
        }
      } else {
        frontier.push(label);
      }
    }
  }
  if (bestLabel < 0) return null;

  const route: CellRef[] = [];
  for (let label = bestLabel; label >= 0; label = labelParent[label]) {
    const i = labelCell[label];
    route.push({ floor: start.floor, x: i % floor.width, z: Math.floor(i / floor.width) });
  }
  return route.reverse();
}

/**
 * 火の側を通る重み．着いた時刻から ROUTE_FIRE_SIDE_LOOKAHEAD_SECONDS 秒のうちに燃えるマスまでの距離 d
 * （斜めも 1 マス．ROUTE_FIRE_SIDE_RANGE_CELLS まで見る）が近いほど重くする．
 * 時刻の余裕だけで見ると，火元の部屋の前の廊下のように「まだ燃えていないが火のすぐ先」を通る経路が選ばれるため，
 * 先読みした火からの距離で「火の側」を避けさせる．火は消えないので，同じマスでも遅く着くほど重みは下がらない
 */
function fireSidePenalty(spread: SpreadMap, cell: CellRef, atSeconds: number): number {
  const until = atSeconds + ROUTE_FIRE_SIDE_LOOKAHEAD_SECONDS;
  for (let d = 0; d <= ROUTE_FIRE_SIDE_RANGE_CELLS; d++) {
    if (isNearFire(spread, cell, until, d)) {
      return ROUTE_FIRE_SIDE_PENALTY_CELLS * (ROUTE_FIRE_SIDE_RANGE_CELLS + 1 - d);
    }
  }
  return 0;
}
