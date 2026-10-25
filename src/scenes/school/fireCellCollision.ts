// 燃えているマスの当たり判定（SPEC_01「火のマスには入れない」）．火が着いたマス（SpreadMap.fireAt(cell) ≤ 今）は壁と同じく進めない．
// 時刻とともに通れないマスが増えるため，マスごとに「閉じている間だけふさぐ」DoorBlocker として WalkWorld に足す．
// 火が着いた時に体がすでにそのマスに重なっていれば，そのマスは通れるままにする（押し出しで飛ばされたり閉じ込められたりしないため）

import type { SchoolPlan } from "../../core/schoolPlan";
import { cellIndex } from "../../sim/grid";
import type { SpreadMap } from "../../sim/spread";
import { circleOverlapsRect, DEFAULT_BODY, type Obstacle } from "../walk/collision";
import type { DoorBlocker } from "../walk/locomotion";

/** 燃えうるマス 1 つ（火が着く時刻が有限のマス） */
export interface FireCell {
  /** SchoolPlan.floors の添字 */
  readonly floor: number;
  readonly x: number;
  readonly z: number;
  /** 火が着く時刻（非常ベルからの秒数．s） */
  readonly fireAt: number;
}

/** マス (x, z) を床から height（m）までふさぐ障害物（ワールド座標．マス (x, z) は X が x * cellSize〜(x + 1) * cellSize） */
export function fireCellObstacle(
  cellSize: number,
  x: number,
  z: number,
  height: number,
  id: string,
): Obstacle {
  return {
    id,
    minX: x * cellSize,
    maxX: (x + 1) * cellSize,
    minZ: z * cellSize,
    maxZ: (z + 1) * cellSize,
    minY: 0,
    maxY: height,
  };
}

/** 階 floorIndex のうち，いつか火が着くマス（火が着く時刻が有限のマス）を並べる（z の順，同じ z は x の順） */
export function listFireCells(plan: SchoolPlan, spread: SpreadMap, floorIndex: number): FireCell[] {
  const floor = plan.floors[floorIndex];
  const seconds = spread.fireSeconds[floorIndex];
  if (floor === undefined || seconds === undefined) return [];
  const cells: FireCell[] = [];
  for (let z = 0; z < floor.depth; z++) {
    for (let x = 0; x < floor.width; x++) {
      const fireAt = seconds[cellIndex(floor, x, z)];
      if (fireAt !== undefined && Number.isFinite(fireAt)) {
        cells.push({ floor: floorIndex, x, z, fireAt });
      }
    }
  }
  return cells;
}

/**
 * 燃えているマスが行く手をふさぐか．火が着いた後（fireAt ≤ nowSeconds）で，体がそのマスに重なっていない時だけふさぐ．
 * nowSeconds が NaN（時刻が無い）なら燃えていない扱い
 */
export function fireCellBlocks(fireAt: number, nowSeconds: number, bodyOverlaps: boolean): boolean {
  return fireAt <= nowSeconds && !bodyOverlaps;
}

/** 燃えているマスの当たり判定（時刻と体の位置を毎フレーム渡す殻） */
export interface FireCellBlockers {
  /** WalkWorld.doors に足す（燃えている間は閉じたドアと同じくふさぐ） */
  readonly doors: readonly DoorBlocker[];
  /**
   * 今の時刻（非常ベルからの秒数．s）と体の中心（ワールド座標の X・Z．m．無ければ null）を渡す．
   * 歩かせる前（または前のフレームの終わり）に呼ぶ
   */
  update(nowSeconds: number, body: { readonly x: number; readonly z: number } | null): void;
}

/**
 * 階 floorIndex の燃えうるマスごとに，燃えている間だけふさぐ DoorBlocker を作る．
 * height は障害物の高さ（m．天井の高さ），bodyRadius は体の半径（m．WalkWorld の体と同じ値にする）
 */
export function createFireCellBlockers(
  plan: SchoolPlan,
  spread: SpreadMap,
  floorIndex: number,
  height: number,
  bodyRadius: number = DEFAULT_BODY.radius,
): FireCellBlockers {
  // 毎フレーム読む値は 1 つの状態にまとめ，判定のたびにオブジェクトを作らない
  const state = { now: Number.NaN, hasBody: false, x: 0, z: 0 };
  const doors = listFireCells(plan, spread, floorIndex).map((cell): DoorBlocker => {
    const obstacle = fireCellObstacle(
      plan.cellSize,
      cell.x,
      cell.z,
      height,
      `fire-cell-${cell.floor}-${cell.x}-${cell.z}`,
    );
    return {
      id: obstacle.id,
      obstacle,
      isOpen: () => {
        if (!(cell.fireAt <= state.now)) return true;
        const overlaps =
          state.hasBody && circleOverlapsRect(state.x, state.z, bodyRadius, obstacle);
        return !fireCellBlocks(cell.fireAt, state.now, overlaps);
      },
    };
  });
  return {
    doors,
    update(nowSeconds, body) {
      state.now = nowSeconds;
      state.hasBody = body !== null;
      if (body !== null) {
        state.x = body.x;
        state.z = body.z;
      }
    },
  };
}
