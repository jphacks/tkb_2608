// 避難の評価（F8）．記録（DrillTrack）と延焼（SpreadMap）から，正解経路の外れ・火への接近・煙の中の姿勢・避難時間を求める．
// 求め方は docs/04_SPEC/SPEC_01_画面遷移とモジュール構成.md「結果の評価」を正とする
import type {
  DrillEvaluation,
  DrillInterval,
  DrillMoment,
  DrillSample,
  DrillTrack,
} from "../core/drill";
import type { CellRef, SchoolPlan } from "../core/schoolPlan";
import { worldToCell } from "./grid";
import { OFF_ROUTE_CELLS, SMOKE_CROUCH_GOOD_RATIO, TRACK_MAX_SAMPLE_GAP_SECONDS } from "./params";
import { proposeRoute } from "./route";
import { isNearFire, type SpreadMap } from "./spread";

/** 評価の条件 */
export interface EvaluateOptions {
  /**
   * 「外れた」を比べる正解経路．省くと resolveReferenceRoute() の順（校舎データの経路 → 経路の提案）で決める．
   * app/ が開始地点を変えた時（ES4）等，呼び出し側で決めた経路を使う時に渡す
   */
  readonly route?: readonly CellRef[];
}

/** 比べる正解経路をどこから取ったか（given: 呼び出し側が渡した，plan: 校舎データの経路，proposed: 経路の提案） */
export type ReferenceRouteSource = "given" | "plan" | "proposed";

/** 比べる正解経路と，その出どころ */
export interface ReferenceRoute {
  readonly route: readonly CellRef[];
  readonly source: ReferenceRouteSource;
}

/**
 * evaluateDrill() が「外れた」を比べる正解経路を決める．順は ① 渡された経路 ② 教員が書いた経路（plan.drill.route．
 * E5 で修正したもの）が空でなければそれ ③ proposeRoute() の結果（着けなければ空の列）．
 * 結果画面（debrief/）が地図に正解経路を出す時も，これで同じ経路を得る
 */
export function resolveReferenceRoute(
  plan: SchoolPlan,
  spread: SpreadMap,
  route?: readonly CellRef[],
): ReferenceRoute {
  if (route !== undefined) return { route, source: "given" };
  if (plan.drill.route.length > 0) return { route: plan.drill.route, source: "plan" };
  return { route: proposeRoute(plan, spread) ?? [], source: "proposed" };
}

/**
 * 避難の記録を評価する．評価するのは非常ベル（0 秒）から，集合場所に入った記録（着かなければ制限時間）までの記録だけ．
 * 集合場所に入ったかは記録の位置のマスで決める（制限時間を過ぎてから入ったものは数えない）．
 * 「外れた」は resolveReferenceRoute() で決めた正解経路と比べる
 */
export function evaluateDrill(
  plan: SchoolPlan,
  spread: SpreadMap,
  track: DrillTrack,
  options: EvaluateOptions = {},
): DrillEvaluation {
  const { samples } = track;
  const timeLimitSeconds = plan.drill.timeLimitSeconds;
  const cells = samples.map((s) => sampleCell(plan, s));

  const assembly = new Set(plan.drill.assembly.map(cellKey));
  let arrivalIndex = -1;
  for (let i = 0; i < samples.length; i++) {
    const t = samples[i].t;
    if (t >= 0 && t <= timeLimitSeconds && assembly.has(cellKey(cells[i]))) {
      arrivalIndex = i;
      break;
    }
  }
  const endSeconds = arrivalIndex >= 0 ? samples[arrivalIndex].t : timeLimitSeconds;
  const inWindow = samples.map((s) => s.t >= 0 && s.t <= endSeconds);

  // 正解経路が空の時（渡された経路が空，または提案でも着けない時）は比べる相手が無いので，外れた区間は出さない
  const route = new Set(resolveReferenceRoute(plan, spread, options.route).route.map(cellKey));
  const offRoute = toIntervals(
    samples,
    cells.map((c, i) => inWindow[i] && route.size > 0 && !isNearRoute(route, c)),
  );

  const nearFire: DrillMoment[] = [];
  let wasNear = false;
  samples.forEach((s, i) => {
    const near = inWindow[i] && isNearFire(spread, cells[i], s.t);
    if (near && !wasNear) nearFire.push({ index: i, t: s.t, floor: s.floor, x: s.x, z: s.z });
    wasNear = near;
  });

  const inSmoke = cells.map((c, i) => inWindow[i] && spread.smokeAt(c) <= samples[i].t);
  let smokeSeconds = 0;
  let crouchSeconds = 0;
  samples.forEach((s, i) => {
    if (!inSmoke[i]) return;
    // 1 つの記録は次の記録までの間を表す．最後の記録（集合場所に入った時等）は長さを持たない
    const next = samples[i + 1];
    const duration =
      next !== undefined && inWindow[i + 1]
        ? Math.min(Math.max(next.t - s.t, 0), TRACK_MAX_SAMPLE_GAP_SECONDS)
        : 0;
    smokeSeconds += duration;
    if (s.posture === "crouching") crouchSeconds += duration;
  });
  const smokeCrouchRatio = smokeSeconds > 0 ? crouchSeconds / smokeSeconds : null;
  const smokeStanding = toIntervals(
    samples,
    samples.map((s, i) => inSmoke[i] && s.posture === "standing"),
  );

  return {
    offRoute,
    nearFire,
    smokeSeconds,
    smokeCrouchRatio,
    smokePostureGood:
      smokeCrouchRatio === null ? null : smokeCrouchRatio >= SMOKE_CROUCH_GOOD_RATIO,
    smokeStanding,
    evacuationSeconds: arrivalIndex >= 0 ? endSeconds : null,
    timeLimitSeconds,
    lateEscape: arrivalIndex < 0,
  };
}

function sampleCell(plan: SchoolPlan, sample: DrillSample): CellRef {
  const { x, z } = worldToCell(plan.cellSize, sample.x, sample.z);
  return { floor: sample.floor, x, z };
}

function cellKey(cell: CellRef): string {
  return `${cell.floor}:${cell.x}:${cell.z}`;
}

/** 正解経路のマスから OFF_ROUTE_CELLS マス以内（斜めも含む）にいるか */
function isNearRoute(route: ReadonlySet<string>, cell: CellRef): boolean {
  for (let dz = -OFF_ROUTE_CELLS; dz <= OFF_ROUTE_CELLS; dz++) {
    for (let dx = -OFF_ROUTE_CELLS; dx <= OFF_ROUTE_CELLS; dx++) {
      if (route.has(cellKey({ floor: cell.floor, x: cell.x + dx, z: cell.z + dz }))) return true;
    }
  }
  return false;
}

/** 当てはまる記録（flags が true）の続く部分を区間にまとめる */
function toIntervals(samples: readonly DrillSample[], flags: readonly boolean[]): DrillInterval[] {
  const intervals: DrillInterval[] = [];
  let from = -1;
  for (let i = 0; i <= flags.length; i++) {
    if (i < flags.length && flags[i]) {
      if (from < 0) from = i;
    } else if (from >= 0) {
      const to = i - 1;
      intervals.push({
        fromIndex: from,
        toIndex: to,
        fromSeconds: samples[from].t,
        toSeconds: samples[to].t,
      });
      from = -1;
    }
  }
  return intervals;
}
