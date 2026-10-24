// 学習モードの床の矢印（F6）の位置と向きを，正解経路（drill.route）のマスの並びから求める（three に依存しない純粋な関数）．
// 組み立ては routeArrows.ts．座標の決まりは docs/04_SPEC/SPEC_02_校舎データの形式.md「座標」を正とする

import type { CellRef, DrillMode, SchoolPlan } from "../../core/schoolPlan";
import { type CellXZ, cellCenter, isAdjacent, isInside } from "../../sim/grid";

/** 1 つの階の高さ（m）．level 階の床は (level - 1) * FLOOR_HEIGHT（SPEC_02「座標」） */
export const FLOOR_HEIGHT = 3.5;

/** 矢印を床から浮かせる高さ（m）．床の面と同じ高さに描くとちらつく（z-fighting）ため */
export const ROUTE_ARROW_LIFT = 0.02;

/**
 * 矢印の大きさ（マスの一辺に対する割合と，上限・下限（m））．
 * 1 m のマスで長さ 0.6 m・幅 0.45 m（廊下 2〜3 マスの中で目立ち，隣のマスの矢印と重ならない）．
 * マスが大きい校舎でも足元で見渡せるよう長さを 1.2 m までに抑える
 */
export const ROUTE_ARROW_SIZE = {
  /** 長さ（進む向き）のマスの一辺に対する割合 */
  lengthRatio: 0.6,
  /** 幅の長さに対する割合 */
  widthRatio: 0.75,
  /** 長さの下限（m） */
  minLength: 0.3,
  /** 長さの上限（m） */
  maxLength: 1.2,
} as const;

/**
 * 矢印の役割．
 * - start: 開始地点のマス（経路の最初）
 * - goal: 集合場所のマス（経路の最後）．入ってきた向きを指す
 * - turn: 曲がり角（入ってきた向きと出ていく向きが違うマス）．出ていく向きを指す
 * - straight: それ以外（まっすぐ進むマス，または途切れの直前のマス）
 */
export type RouteArrowKind = "start" | "straight" | "turn" | "goal";

/** 床に置く矢印 1 つ */
export interface RouteArrowPlacement {
  /** 矢印の中心のワールド座標（m．マスの中心，床から ROUTE_ARROW_LIFT だけ上） */
  readonly x: number;
  readonly y: number;
  readonly z: number;
  /** 向き（rad．0 で -Z を向き，正で左（-X の側）へ回る．three.js の rotation.y と同じ） */
  readonly yaw: number;
  readonly kind: RouteArrowKind;
  /** 元の経路（route）の何番目のマスか */
  readonly routeIndex: number;
}

/** 矢印の大きさ（m） */
export interface RouteArrowDimensions {
  /** 進む向きの長さ（m） */
  readonly length: number;
  /** 横幅（m） */
  readonly width: number;
}

/** 床に矢印を出すか（学習モードだけ．テストモードでは正解経路を見せない．F6・F7） */
export function shouldShowRouteArrows(mode: DrillMode): boolean {
  return mode === "learn";
}

/** マスの一辺（m）から矢印の大きさを求める */
export function routeArrowDimensions(cellSize: number): RouteArrowDimensions {
  const { lengthRatio, widthRatio, minLength, maxLength } = ROUTE_ARROW_SIZE;
  const raw = Number.isFinite(cellSize) && cellSize > 0 ? cellSize * lengthRatio : minLength;
  const length = Math.min(maxLength, Math.max(minLength, raw));
  return { length, width: length * widthRatio };
}

/** from から to へ進む向き（rad．0 で -Z，正で左へ回る） */
export function yawBetween(from: CellXZ, to: CellXZ): number {
  // three.js で rotation.y = θ のとき -Z は (-sin θ, 0, -cos θ) へ向く．これが (dx, dz) になる θ を求める
  const yaw = Math.atan2(-(to.x - from.x), -(to.z - from.z));
  // -0 と -π を避け，テストで比べやすい値にそろえる
  return yaw === 0 || yaw === -Math.PI ? Math.abs(yaw) : yaw;
}

/** 経路の中の描けるマス（元の添字付き） */
interface ValidCell {
  readonly cell: CellRef;
  /** 元の経路の添字（同じマスが続いた時は最初の添字） */
  readonly routeIndex: number;
  /** 同じマスが続いた時の最後の添字（続かなければ routeIndex と同じ）．goal の判定に使う */
  readonly lastIndex: number;
}

function isSameCell(a: CellRef, b: CellRef): boolean {
  return a.floor === b.floor && a.x === b.x && a.z === b.z;
}

/** 階が存在し，マス目の中にある整数の位置か */
function isDrawableCell(plan: Pick<SchoolPlan, "floors">, cell: CellRef): boolean {
  const floor = plan.floors[cell.floor];
  if (floor === undefined) return false;
  if (!Number.isInteger(cell.x) || !Number.isInteger(cell.z)) return false;
  return isInside(floor, cell.x, cell.z);
}

/** 前のマスから続けて歩けるか（同じ階で上下左右に隣り合う） */
function continues(prev: CellRef, next: CellRef): boolean {
  return prev.floor === next.floor && isAdjacent(prev, next);
}

/**
 * 正解経路の床の矢印を並べる．各マスの中心に 1 つずつ置き，次のマスへ進む向き（曲がり角では曲がった後の向き）を指す．
 * 最後のマス（集合場所）は入ってきた向きを指す．
 *
 * 異常な経路は例外にせず，描けるところだけ描く．
 * - 空の経路: 矢印なし
 * - 階が無い・マス目の外・整数でない位置のマス: そのマスを飛ばし，前後の続きはそこで途切れたものとして扱う
 * - 同じマスが続く: 1 つにまとめる（矢印は 1 つ）
 * - 隣り合わない・別の階のマスへの飛び: そこで経路を区切り，区切った各部分を別々に描く
 * - 前後のどちらにも続くマスが無いマス（1 マスだけの経路・飛びに挟まれたマス）: 向きが決まらないので描かない
 *
 * start は経路の最初のマスが描けた時だけ，goal は最後のマスが描けた時だけ付く
 */
export function layoutRouteArrows(
  plan: Pick<SchoolPlan, "cellSize" | "floors">,
  route: readonly CellRef[],
): RouteArrowPlacement[] {
  // 描けるマスだけを残し，続けて歩ける部分ごとに区切る
  const runs: ValidCell[][] = [];
  let current: ValidCell[] = [];
  route.forEach((cell, routeIndex) => {
    if (!isDrawableCell(plan, cell)) {
      if (current.length > 0) runs.push(current);
      current = [];
      return;
    }
    const last = current[current.length - 1];
    if (last !== undefined && isSameCell(last.cell, cell)) {
      // 1 つにまとめる．経路の最後のマスが重なっていても goal と分かるよう，最後の添字を覚えておく
      current[current.length - 1] = { ...last, lastIndex: routeIndex };
      return;
    }
    if (last !== undefined && !continues(last.cell, cell)) {
      runs.push(current);
      current = [];
    }
    current.push({ cell, routeIndex, lastIndex: routeIndex });
  });
  if (current.length > 0) runs.push(current);

  const lastRouteIndex = route.length - 1;
  const placements: RouteArrowPlacement[] = [];
  for (const run of runs) {
    if (run.length < 2) continue;
    run.forEach(({ cell, routeIndex, lastIndex }, i) => {
      const prev = run[i - 1];
      const next = run[i + 1];
      const yaw =
        next !== undefined ? yawBetween(cell, next.cell) : yawBetween(run[i - 1].cell, cell);
      let kind: RouteArrowKind = "straight";
      if (routeIndex === 0) kind = "start";
      else if (lastIndex === lastRouteIndex && next === undefined) kind = "goal";
      else if (prev !== undefined && next !== undefined && yawBetween(prev.cell, cell) !== yaw) {
        kind = "turn";
      }
      const center = cellCenter(plan.cellSize, cell);
      const level = plan.floors[cell.floor].level;
      placements.push({
        x: center.x,
        y: (level - 1) * FLOOR_HEIGHT + ROUTE_ARROW_LIFT,
        z: center.z,
        yaw,
        kind,
        routeIndex,
      });
    });
  }
  return placements;
}
