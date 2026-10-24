// 結果画面を確かめるための，手で作った避難の記録（DrillTrack）と評価（DrillEvaluation）．
// sim/ の evaluateDrill() と避難の記録（app/）ができるまでの代わりで，dev 用の単独起動（?debrief）と
// シナリオの仮表示から結果画面へ進む確認用の導線で使う．評価の値は記録から簡単な決まりで作った仮のもの（本物の評価の求め方ではない）
import type { DrillEvaluation, DrillInterval, DrillSample, DrillTrack } from "../core/drill";
import type { CellKind, CellRef, SchoolPlan } from "../core/schoolPlan";
import type { Posture } from "../core/types";

/** 仮の記録の種類．good = 着いた（煙の中の姿勢は「もう少し」），late = 逃げ遅れ，nosmoke = 煙の中にいなかった */
export type SampleDrillVariant = "good" | "late" | "nosmoke";

/** 記録の間隔（s．SPEC_01「結果の評価」の 0.2 秒ごと） */
export const SAMPLE_INTERVAL_SECONDS = 0.2;
/** 歩く速さ（m/s） */
const WALK_SPEED = 1.0;
/** 非常ベルの後，歩き出すまでの秒数（s） */
const HESITATE_SECONDS = 4;
/** 寄り道でまっすぐ進むマスの数 */
const DETOUR_CELLS = 3;
/** 煙の中に入ってからしゃがむまでの秒数（s） */
const SMOKE_STAND_SECONDS = 2;
/** 仮の評価で「できた」とする，しゃがんでいた割合（sim/ の目安の代わり） */
const SAMPLE_GOOD_RATIO = 0.7;
/** 逃げ遅れの記録で，正解経路の最後から何マス手前で止まるか */
const LATE_STOP_CELLS = 4;

/** URL の ?debrief=<種類> から仮の記録の種類を決める（知らない値・値なしは good） */
export function resolveSampleDrillVariant(search: string): SampleDrillVariant {
  const value = new URLSearchParams(search).get("debrief");
  return value === "late" || value === "nosmoke" ? value : "good";
}

interface Waypoint {
  readonly floor: number;
  readonly x: number;
  readonly z: number;
}

/** マスの中心のワールド座標（SPEC_02「座標」） */
function cellWorld(plan: SchoolPlan, cell: CellRef): Waypoint {
  return {
    floor: cell.floor,
    x: (cell.x + 0.5) * plan.cellSize,
    z: (cell.z + 0.5) * plan.cellSize,
  };
}

function kindAt(plan: SchoolPlan, floor: number, x: number, z: number): CellKind | null {
  const f = plan.floors[floor];
  if (f === undefined || x < 0 || z < 0 || x >= f.width || z >= f.depth) return null;
  return f.cells[Math.floor(z) * f.width + Math.floor(x)] ?? null;
}

/** 正解経路をたどり，最初の廊下のマスで横へ DETOUR_CELLS マス寄り道して戻る道筋（壁は見ない．仮の記録のため） */
function sampleWaypoints(plan: SchoolPlan, variant: SampleDrillVariant): Waypoint[] {
  const route = plan.drill.route.length > 0 ? plan.drill.route : [plan.drill.start];
  const end = variant === "late" ? Math.max(1, route.length - LATE_STOP_CELLS) : route.length;
  const cells = route.slice(0, end);
  const firstCorridor = cells.findIndex((c) => kindAt(plan, c.floor, c.x, c.z) === "corridor");
  const detourAt = firstCorridor >= 0 ? firstCorridor : Math.floor(cells.length / 3);
  const points: Waypoint[] = [];
  cells.forEach((cell, i) => {
    points.push(cellWorld(plan, cell));
    if (i !== detourAt) return;
    const width = plan.floors[cell.floor]?.width ?? 0;
    const dir = cell.x + DETOUR_CELLS < width ? 1 : -1;
    points.push(cellWorld(plan, { ...cell, x: cell.x + dir * DETOUR_CELLS }));
    points.push(cellWorld(plan, cell));
  });
  return points;
}

/** 連続して条件を満たす記録を区間にまとめる */
function intervalsWhere(
  samples: readonly DrillSample[],
  predicate: (sample: DrillSample, index: number) => boolean,
): DrillInterval[] {
  const intervals: DrillInterval[] = [];
  let from = -1;
  samples.forEach((sample, i) => {
    const hit = predicate(sample, i);
    if (hit && from < 0) from = i;
    if (!hit && from >= 0) {
      intervals.push(toInterval(samples, from, i - 1));
      from = -1;
    }
  });
  if (from >= 0) intervals.push(toInterval(samples, from, samples.length - 1));
  return intervals;
}

function toInterval(samples: readonly DrillSample[], from: number, to: number): DrillInterval {
  return { fromIndex: from, toIndex: to, fromSeconds: samples[from].t, toSeconds: samples[to].t };
}

/** 道筋を一定の速さで歩いた 0.2 秒ごとの位置（姿勢は後で決める） */
function walkSamples(points: readonly Waypoint[], timeLimit: number, late: boolean): Waypoint[] {
  const out: Waypoint[] = [];
  const first = points[0];
  if (first === undefined) return out;
  const hesitateSteps = Math.round(HESITATE_SECONDS / SAMPLE_INTERVAL_SECONDS);
  for (let i = 0; i < hesitateSteps; i++) out.push(first);
  const step = WALK_SPEED * SAMPLE_INTERVAL_SECONDS;
  for (let k = 1; k < points.length; k++) {
    const a = points[k - 1];
    const b = points[k];
    const length = Math.hypot(b.x - a.x, b.z - a.z);
    const count = Math.max(1, Math.round(length / step));
    for (let s = 0; s < count; s++) {
      const r = s / count;
      out.push({ floor: a.floor, x: a.x + (b.x - a.x) * r, z: a.z + (b.z - a.z) * r });
    }
  }
  out.push(points[points.length - 1]);
  // 逃げ遅れでは，止まった所に制限時間まで立ち続ける
  if (late) {
    const total = Math.floor(timeLimit / SAMPLE_INTERVAL_SECONDS) + 1;
    const last = points[points.length - 1];
    while (out.length < total) out.push(last);
  }
  return out;
}

/** 仮の記録と評価を作る（同じ校舎・種類なら毎回同じ結果） */
export function createSampleDrill(
  plan: SchoolPlan,
  variant: SampleDrillVariant = "good",
): { readonly track: DrillTrack; readonly evaluation: DrillEvaluation } {
  const late = variant === "late";
  const limit = plan.drill.timeLimitSeconds;
  const points = sampleWaypoints(plan, variant);
  const positions = walkSamples(points, limit, late);
  const cellKind = (p: Waypoint): CellKind | null =>
    kindAt(plan, p.floor, p.x / plan.cellSize, p.z / plan.cellSize);
  // 仮の決まり: 廊下のマスを煙の中とする（nosmoke では煙は無い）
  const inSmoke = positions.map((p) => variant !== "nosmoke" && cellKind(p) === "corridor");
  const route = plan.drill.route;
  // 仮の決まり: 正解経路のどのマスの中心からも 1.5 マスより遠い所を外れた所とする
  const offRouteAt = (p: Waypoint): boolean =>
    route.length > 0 &&
    route.every(
      (c) =>
        c.floor !== p.floor ||
        Math.max(
          Math.abs((c.x + 0.5) * plan.cellSize - p.x),
          Math.abs((c.z + 0.5) * plan.cellSize - p.z),
        ) >
          1.5 * plan.cellSize,
    );

  let smokeSince = -1;
  const samples: DrillSample[] = positions.map((p, i) => {
    if (inSmoke[i] && smokeSince < 0) smokeSince = i;
    if (!inSmoke[i]) smokeSince = -1;
    const smokeFor = smokeSince < 0 ? 0 : (i - smokeSince) * SAMPLE_INTERVAL_SECONDS;
    // 煙に入ってすぐと，寄り道の間は立っている（「もう少し」になる割合にするため）
    const posture: Posture =
      inSmoke[i] && smokeFor >= SMOKE_STAND_SECONDS && !offRouteAt(p) ? "crouching" : "standing";
    // 0.2 の掛け算の誤差（11.600000000000001 等）を表示に出さないよう ms で丸める
    const t = Math.round(i * SAMPLE_INTERVAL_SECONDS * 1000) / 1000;
    return { t, floor: p.floor, x: p.x, z: p.z, posture };
  });

  const offRoute = intervalsWhere(samples, (s) => offRouteAt(s));
  // 仮の決まり: 外れた区間ごとに，区間の真ん中（寄り道の折り返し）を火に近づいた点とする
  const nearFire = offRoute.map((interval) => {
    const index = Math.round((interval.fromIndex + interval.toIndex) / 2);
    const s = samples[index];
    return { index, t: s.t, floor: s.floor, x: s.x, z: s.z };
  });
  const smokeCount = inSmoke.filter(Boolean).length;
  const crouchCount = samples.filter((s, i) => inSmoke[i] && s.posture === "crouching").length;
  const ratio = smokeCount > 0 ? crouchCount / smokeCount : null;
  const assembly = plan.drill.assembly;
  const arrived = samples.find((s) =>
    assembly.some(
      (c) =>
        c.floor === s.floor &&
        Math.floor(s.x / plan.cellSize) === c.x &&
        Math.floor(s.z / plan.cellSize) === c.z,
    ),
  );
  const evacuationSeconds = !late && arrived !== undefined ? arrived.t : null;

  return {
    track: { samples },
    evaluation: {
      offRoute,
      nearFire,
      smokeSeconds: smokeCount * SAMPLE_INTERVAL_SECONDS,
      smokeCrouchRatio: ratio,
      smokePostureGood: ratio === null ? null : ratio >= SAMPLE_GOOD_RATIO,
      smokeStanding: intervalsWhere(samples, (s, i) => inSmoke[i] && s.posture === "standing"),
      evacuationSeconds,
      timeLimitSeconds: limit,
      lateEscape: evacuationSeconds === null,
    },
  };
}
