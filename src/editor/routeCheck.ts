// 正解経路（E5）の確かめ（開始地点から始まり集合場所で終わるか・隣り合うか・壁をまたがないか）の純粋な関数．
// validatePlan は壁を見ないため（SPEC_02），壁の規則は sim/ の canPersonStep で見る
import type { CellRef, DrillSetup, Floor, SchoolPlan } from "../core/schoolPlan";
import { proposeRoute, type SpreadMap } from "../sim";
import { type CellXZ, isAdjacent, kindAt } from "../sim/grid";
import { isWalkableKind, wallBetween } from "../sim/walls";

/** 経路の一歩を置けない理由の文 */
export const ROUTE_REASONS = {
  notAdjacent: (last: CellXZ) =>
    `経路の最後のマス (${last.x}, ${last.z}) に上下左右で隣り合うマスだけ足せます`,
  notWalkable: (cell: CellXZ) =>
    `(${cell.x}, ${cell.z}) は人が入れないマス（壁・柱・何もない・マス目の外）です`,
  wall: (from: CellXZ, to: CellXZ) =>
    `(${from.x}, ${from.z}) と (${to.x}, ${to.z}) の間には壁があります（ドア・出口を通ってください）`,
  startOutside: "開始地点がマス目の外にあるため，経路を始められません",
  startNotNext: (start: CellXZ) =>
    `経路は開始地点 (${start.x}, ${start.z}) から始めます．開始地点か，その隣のマスを選んでください`,
} as const;

/**
 * 人が経路の上で from から to へ一歩進めない理由（進める時は null）．
 * 隣り合わない・to が人の入れないマス・間に壁がある，の順に確かめる（sim/ の canPersonStep と同じ規則）
 */
export function routeStepRejection(floor: Floor, from: CellXZ, to: CellXZ): string | null {
  if (!isAdjacent(from, to)) return ROUTE_REASONS.notAdjacent(from);
  if (!isWalkableKind(kindAt(floor, to.x, to.z))) return ROUTE_REASONS.notWalkable(to);
  if (wallBetween(floor, from, to)) return ROUTE_REASONS.wall(from, to);
  return null;
}

/** 経路の確かめの結果 */
export interface RouteCheck {
  /** 経路が空か（空なら生徒側では proposeRoute() の提案を使う．SPEC_01「結果の評価」） */
  readonly empty: boolean;
  /** 最初のマスが開始地点か（空なら false） */
  readonly startsAtStart: boolean;
  /** 最後のマスが集合場所のどれかか（空なら false） */
  readonly endsAtAssembly: boolean;
  /** 置けない一歩の位置（i なら route[i - 1] → route[i] の一歩．1 以上） */
  readonly badSteps: readonly number[];
  /** 画面に出す問題の文（開始地点・集合場所・置けない一歩・人の入れないマス・別の階）．無ければ空 */
  readonly problems: readonly string[];
}

/** 画面に並べる問題の数の上限（残りは件数だけ出す） */
const SHOWN_PROBLEMS = 3;

/**
 * 経路を確かめる（floorIndex 階の floor で見る．段階 1 は 1 フロア）．
 * 壁をまたぐ一歩・隣り合わない一歩・人の入れないマスは routeStepRejection と同じ規則で見る
 */
export function checkRoute(drill: DrillSetup, floorIndex: number, floor: Floor): RouteCheck {
  const { route, start, assembly } = drill;
  if (route.length === 0) {
    return { empty: true, startsAtStart: false, endsAtAssembly: false, badSteps: [], problems: [] };
  }
  const startsAtStart = sameRef(route[0], start);
  const last = route[route.length - 1];
  const endsAtAssembly = assembly.some((ref) => sameRef(ref, last));
  const problems: string[] = [];
  if (!startsAtStart) problems.push("経路が開始地点から始まっていません");
  if (!endsAtAssembly) problems.push("経路が集合場所で終わっていません");

  const stepProblems: string[] = [];
  const badSteps: number[] = [];
  if (route.some((ref) => ref.floor !== floorIndex)) {
    stepProblems.push("経路に別の階のマスがあります");
  }
  if (!isWalkableKind(kindAt(floor, route[0].x, route[0].z))) {
    stepProblems.push(`経路の 1 マス目: ${ROUTE_REASONS.notWalkable(route[0])}`);
  }
  for (let i = 1; i < route.length; i++) {
    const from = route[i - 1];
    const to = route[i];
    const reason = isAdjacent(from, to)
      ? routeStepRejection(floor, from, to)
      : `(${from.x}, ${from.z}) と (${to.x}, ${to.z}) が上下左右に隣り合っていません`;
    if (reason === null) continue;
    badSteps.push(i);
    stepProblems.push(`経路の ${i + 1} マス目: ${reason}`);
  }
  problems.push(...stepProblems.slice(0, SHOWN_PROBLEMS));
  if (stepProblems.length > SHOWN_PROBLEMS) {
    problems.push(`ほか ${stepProblems.length - SHOWN_PROBLEMS} 件`);
  }
  return { empty: false, startsAtStart, endsAtAssembly, badSteps, problems };
}

/**
 * 経路が空で，生徒側の自動の提案（proposeRoute()）でも集合場所にたどり着けないか．
 * その時は QR は出せるが，生徒側に正解経路が出ない（床の矢印・結果画面の緑の線が無い）．経路が空でなければ false
 */
export function isEmptyRouteUnreachable(plan: SchoolPlan, spread: SpreadMap): boolean {
  return plan.drill.route.length === 0 && proposeRoute(plan, spread) === null;
}

const sameRef = (a: CellRef, b: CellRef): boolean =>
  a.floor === b.floor && a.x === b.x && a.z === b.z;
