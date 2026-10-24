// 体験中のエラー行動（煙の中で立っている・火の 1 マス以内）の判定．毎フレームの「赤い表示」と，evaluateDrill() の
// 「煙の中で立っていた区間」「火に近づいた点」が同じ定義を使うよう，判定をここに集める（SPEC_01「赤い表示（エラー行動の評価）」）
import type { DrillSample } from "../core/drill";
import type { CellRef, SchoolPlan } from "../core/schoolPlan";
import type { Posture } from "../core/types";
import { worldToCell } from "./grid";
import { isNearFire, type SpreadMap } from "./spread";

/** 今のエラー行動．エラー行動を足す時は項目を足し，any にも含める */
export interface ErrorBehaviors {
  /** 煙が着いたマスにいて，しゃがんでいない（赤い表示のみ） */
  readonly smokeStanding: boolean;
  /** 燃えているマスから 1 マス以内にいる（赤い表示と警告音） */
  readonly nearFire: boolean;
  /** エラー行動が 1 つでもあるか（赤い表示を出すか） */
  readonly any: boolean;
}

// 毎フレーム呼ばれるため，結果は組み合わせごとに作っておいた値を返す（呼ぶたびにオブジェクトを作らない）
const NONE: ErrorBehaviors = Object.freeze({ smokeStanding: false, nearFire: false, any: false });
const SMOKE_STANDING: ErrorBehaviors = Object.freeze({
  smokeStanding: true,
  nearFire: false,
  any: true,
});
const NEAR_FIRE: ErrorBehaviors = Object.freeze({
  smokeStanding: false,
  nearFire: true,
  any: true,
});
const BOTH: ErrorBehaviors = Object.freeze({ smokeStanding: true, nearFire: true, any: true });

/** 階とワールド座標（m）から，その位置を含むマス（マス目の外・無い階でもそのまま返す） */
export function positionCell(
  plan: SchoolPlan,
  floor: number,
  worldX: number,
  worldZ: number,
): CellRef {
  const { x, z } = worldToCell(plan.cellSize, worldX, worldZ);
  return { floor, x, z };
}

/** そのマスに atSeconds（非常ベルからの秒数．s）の時点で煙が着いているか．マス目の外・無い階は false */
export function isInSmoke(spread: SpreadMap, cell: CellRef, atSeconds: number): boolean {
  return spread.smokeAt(cell) <= atSeconds;
}

/**
 * マスと時刻（非常ベルからの秒数．s）と姿勢から，今のエラー行動を求める．
 * evaluateDrill() もこの関数で各記録を判定する（体験中の赤い表示と結果画面の印を食い違わせないため）
 */
export function errorBehaviorsAt(
  spread: SpreadMap,
  cell: CellRef,
  atSeconds: number,
  posture: Posture,
): ErrorBehaviors {
  const smokeStanding = posture !== "crouching" && isInSmoke(spread, cell, atSeconds);
  const nearFire = isNearFire(spread, cell, atSeconds);
  if (smokeStanding) return nearFire ? BOTH : SMOKE_STANDING;
  return nearFire ? NEAR_FIRE : NONE;
}

/**
 * 1 フレーム分の位置（階・ワールド座標の X と Z．m）・姿勢・非常ベルからの秒数（t．s）から，今のエラー行動を求める．
 * 引数は DrillSample と同じ形（記録の 1 件をそのまま渡せる）．返す値は共有の固定値なので書き換えない．
 * 評価の窓（非常ベル〜集合場所に入るまで）は見ない．呼び出し側が避難の間だけ呼ぶ
 */
export function detectErrorBehaviors(
  plan: SchoolPlan,
  spread: SpreadMap,
  sample: DrillSample,
): ErrorBehaviors {
  return errorBehaviorsAt(
    spread,
    positionCell(plan, sample.floor, sample.x, sample.z),
    sample.t,
    sample.posture,
  );
}
