// 延焼のプレビュー（E4）の純粋な関数．計算は sim/ の computeSpread() に任せ，ここは結果のキャッシュ・時刻ごとの読み分け・注意の文だけを持つ
import type { DrillSetup, SchoolPlan } from "../core/schoolPlan";
import { computeSpread, type SpreadMap } from "../sim";

/** 1 つのマスがその時刻にどうなっているか（火が着いている・煙だけが着いている・どちらも着いていない） */
export type SpreadCellState = "fire" | "smoke" | null;

/** 時刻の範囲で火・煙が着いているマスの数 */
export interface SpreadCount {
  readonly fire: number;
  /** 煙だけが着いているマス（火が着いたマスは含めない） */
  readonly smoke: number;
}

/** 煙が火より遅い設定の時に出す注意（誤りにはしない．SPEC_02 は「煙は火より速い」） */
export const SPREAD_WARNINGS = {
  smokeSlowerThanFire:
    "煙の秒数が火の秒数より長く，煙が火より遅く広がります（ふつうは煙のほうが速く広がります）",
} as const;

/**
 * 校舎から SpreadMap を求める関数を作る．同じ校舎（同じ参照）を続けて渡すと前の結果を返し，校舎が変わった時だけ計算し直す．
 * 時刻のスライダーを動かすたびに計算しないため．延焼のプレビューと正解経路の提案（E5）で同じものを使う
 */
export function createSpreadCache(): (plan: SchoolPlan) => SpreadMap {
  let lastPlan: SchoolPlan | null = null;
  let lastSpread: SpreadMap | null = null;
  return (plan) => {
    if (plan !== lastPlan || lastSpread === null) {
      lastSpread = computeSpread(plan);
      lastPlan = plan;
    }
    return lastSpread;
  };
}

/** 階 floorIndex のマス（添字 i = z * width + x）が atSeconds（s．非常ベルが 0）にどうなっているか */
export function spreadStateAt(
  spread: SpreadMap,
  floorIndex: number,
  i: number,
  atSeconds: number,
): SpreadCellState {
  const fire = spread.fireSeconds[floorIndex]?.[i] ?? Infinity;
  if (Number.isFinite(fire) && fire <= atSeconds) return "fire";
  const smoke = spread.smokeSeconds[floorIndex]?.[i] ?? Infinity;
  return Number.isFinite(smoke) && smoke <= atSeconds ? "smoke" : null;
}

/** 階 floorIndex で atSeconds（s）に火・煙が着いているマスの数 */
export function countSpreadAt(
  spread: SpreadMap,
  floorIndex: number,
  atSeconds: number,
): SpreadCount {
  const cells = spread.fireSeconds[floorIndex]?.length ?? 0;
  let fire = 0;
  let smoke = 0;
  for (let i = 0; i < cells; i++) {
    const state = spreadStateAt(spread, floorIndex, i, atSeconds);
    if (state === "fire") fire++;
    else if (state === "smoke") smoke++;
  }
  return { fire, smoke };
}

/**
 * プレビューの時刻のスライダーの上限（s）．制限時間が正しい数ならその値，そうでなければ（URL から読んだ誤った校舎等）
 * fallbackSeconds にする
 */
export function previewMaxSeconds(drill: DrillSetup, fallbackSeconds: number): number {
  const limit = drill.timeLimitSeconds;
  return Number.isFinite(limit) && limit > 0 ? limit : fallbackSeconds;
}

/** 延焼の設定についての注意（誤りではないが確かめてほしいこと）．無ければ空 */
export function spreadWarnings(drill: DrillSetup): string[] {
  const { fireSecondsPerCell, smokeSecondsPerCell } = drill.spread;
  const warnings: string[] = [];
  if (smokeSecondsPerCell > fireSecondsPerCell) warnings.push(SPREAD_WARNINGS.smokeSlowerThanFire);
  return warnings;
}
