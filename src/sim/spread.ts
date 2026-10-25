// 延焼の計算（E4）．火元から上下左右に火と煙が広がり（煙は煙の発生源からも広がり），各マスに着く時刻を SpreadMap として返す．
// 規則は docs/04_SPEC/SPEC_02_校舎データの形式.md「通れる・燃え広がる」を正とする（防火シャッターで止まり，屋外へは広がらない）
import type { CellRef, Floor, SchoolPlan } from "../core/schoolPlan";
import { cellIndex, isInside, NEIGHBOR_OFFSETS } from "./grid";
import { NEAR_FIRE_CELLS } from "./params";
import { canSpreadStep } from "./walls";

/** 各マスに火・煙が着く時刻（s．非常ベルが 0．着かなければ Infinity） */
export interface SpreadMap {
  /** 階ごとの火が着く時刻（s）．並びは SchoolPlan.floors と同じ，各階の添字は z * width + x */
  readonly fireSeconds: readonly (readonly number[])[];
  /** 階ごとの煙が着く時刻（s）．火が着いたマスには，遅くとも同じ時刻に煙も着いている */
  readonly smokeSeconds: readonly (readonly number[])[];
  /** そのマスに火が着く時刻（s）．マス目の外・無い階は Infinity */
  fireAt(cell: CellRef): number;
  /** そのマスに煙が着く時刻（s）．マス目の外・無い階は Infinity */
  smokeAt(cell: CellRef): number;
}

/**
 * 校舎の火元（fireOrigins は 0 秒，extraFires は atSeconds）から火と煙の広がりを求める．
 * 煙は燃えている各マスと煙の発生源（extraSmokes は atSeconds．そのマスは燃えない）から広がる（火より煙が遅く設定されても，燃えているマスに煙が無いことにならないようにするため）
 */
export function computeSpread(plan: SchoolPlan): SpreadMap {
  const { fireOrigins, spread } = plan.drill;
  const fireStarts = plan.floors.map((floor) =>
    new Array<number>(floor.cells.length).fill(Infinity),
  );
  for (const cell of fireOrigins) startAt(plan.floors, fireStarts, cell, 0);
  for (const extra of spread.extraFires) {
    startAt(plan.floors, fireStarts, extra.cell, extra.atSeconds);
  }

  const fireSeconds = plan.floors.map((floor, f) =>
    propagate(floor, fireStarts[f], spread.fireSecondsPerCell),
  );
  // 煙の元は燃えている各マスと煙の発生源（extraSmokes．火は出さないので fireSeconds には入れない）
  const smokeStarts = fireSeconds.map((seconds) => [...seconds]);
  for (const source of spread.extraSmokes ?? []) {
    startAt(plan.floors, smokeStarts, source.cell, source.atSeconds);
  }
  const smokeSeconds = plan.floors.map((floor, f) =>
    propagate(floor, smokeStarts[f], spread.smokeSecondsPerCell),
  );
  return createSpreadMap(plan.floors, fireSeconds, smokeSeconds);
}

/** starts のそのマスの始まりの時刻を，早いほうにする（マス目の外・無い階は何もしない） */
function startAt(
  floors: readonly Floor[],
  starts: number[][],
  cell: CellRef,
  atSeconds: number,
): void {
  const floor = floors[cell.floor];
  if (floor === undefined || !isInside(floor, cell.x, cell.z)) return;
  const i = cellIndex(floor, cell.x, cell.z);
  starts[cell.floor][i] = Math.min(starts[cell.floor][i], atSeconds);
}

/** 燃えているマス（火が着く時刻 ≤ atSeconds）から NEAR_FIRE_CELLS マス以内（斜めも含む．壁は見ない）にいるか */
export function isNearFire(
  spread: SpreadMap,
  cell: CellRef,
  atSeconds: number,
  rangeCells: number = NEAR_FIRE_CELLS,
): boolean {
  for (let dz = -rangeCells; dz <= rangeCells; dz++) {
    for (let dx = -rangeCells; dx <= rangeCells; dx++) {
      const near = { floor: cell.floor, x: cell.x + dx, z: cell.z + dz };
      if (spread.fireAt(near) <= atSeconds) return true;
    }
  }
  return false;
}

function createSpreadMap(
  floors: readonly Floor[],
  fireSeconds: readonly (readonly number[])[],
  smokeSeconds: readonly (readonly number[])[],
): SpreadMap {
  const lookup = (table: readonly (readonly number[])[], cell: CellRef): number => {
    const floor = floors[cell.floor];
    if (floor === undefined || !isInside(floor, cell.x, cell.z)) return Infinity;
    return table[cell.floor][cellIndex(floor, cell.x, cell.z)];
  };
  return {
    fireSeconds,
    smokeSeconds,
    fireAt: (cell) => lookup(fireSeconds, cell),
    smokeAt: (cell) => lookup(smokeSeconds, cell),
  };
}

/**
 * 着き始める時刻（starts．着かないマスは Infinity）から，1 マス secondsPerCell 秒で広げた時の各マスの着く時刻．
 * 始まりの時刻がマスごとに違う（ES1 の手で足した延焼箇所・煙の元になる燃えたマスと煙の発生源）ため，幅優先ではなく Dijkstra で求める
 */
function propagate(floor: Floor, starts: readonly number[], secondsPerCell: number): number[] {
  // 0 以下・NaN の設定でも探索が終わるよう，負の秒数は 0 とみなす
  const step = Number.isFinite(secondsPerCell) && secondsPerCell > 0 ? secondsPerCell : 0;
  const times = [...starts];
  const heap: HeapItem[] = [];
  times.forEach((t, i) => {
    if (t < Infinity) heapPush(heap, { t, i });
  });
  while (heap.length > 0) {
    const { t, i } = heapPop(heap);
    if (t > times[i]) continue;
    const from = { x: i % floor.width, z: Math.floor(i / floor.width) };
    for (const d of NEIGHBOR_OFFSETS) {
      const to = { x: from.x + d.x, z: from.z + d.z };
      if (!canSpreadStep(floor, from, to)) continue;
      const j = cellIndex(floor, to.x, to.z);
      const next = t + step;
      if (next < times[j]) {
        times[j] = next;
        heapPush(heap, { t: next, i: j });
      }
    }
  }
  return times;
}

interface HeapItem {
  readonly t: number;
  readonly i: number;
}

function heapPush(heap: HeapItem[], item: HeapItem): void {
  heap.push(item);
  let k = heap.length - 1;
  while (k > 0) {
    const parent = (k - 1) >> 1;
    if (heap[parent].t <= heap[k].t) break;
    [heap[parent], heap[k]] = [heap[k], heap[parent]];
    k = parent;
  }
}

function heapPop(heap: HeapItem[]): HeapItem {
  const top = heap[0];
  const last = heap.pop() as HeapItem;
  if (heap.length > 0) {
    heap[0] = last;
    let k = 0;
    for (;;) {
      const l = 2 * k + 1;
      const r = l + 1;
      let min = k;
      if (l < heap.length && heap[l].t < heap[min].t) min = l;
      if (r < heap.length && heap[r].t < heap[min].t) min = r;
      if (min === k) break;
      [heap[min], heap[k]] = [heap[k], heap[min]];
      k = min;
    }
  }
  return top;
}
