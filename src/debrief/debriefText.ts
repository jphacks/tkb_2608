// 結果画面に出す文と数の整形（DOM に依存しない純粋な関数）．評価の中身（目安の割合等）は sim/ の evaluateDrill() が決め，
// ここでは DrillEvaluation の値をそのまま文にするだけにする
import type { DrillEvaluation } from "../core/drill";
import type { DrillMode } from "../core/schoolPlan";

/** 評価の見せ方（good = できた，warn = もう少し・逃げ遅れ，neutral = どちらでもない） */
export type StatTone = "good" | "warn" | "neutral";

/** 結果画面の 1 項目 */
export interface DebriefStat {
  /** 項目名（「避難時間」等） */
  readonly label: string;
  /** 大きく出す値（「48 秒」「逃げ遅れ」等） */
  readonly value: string;
  /** 値の下に出す補足 */
  readonly note: string;
  readonly tone: StatTone;
}

/** 秒数を整数の秒の文にする（四捨五入．有限でない時は「―」） */
export function formatSeconds(seconds: number): string {
  if (!Number.isFinite(seconds)) return "―";
  return `${Math.round(seconds)} 秒`;
}

/** 割合（0〜1 等）を整数の % の文にする（四捨五入．1 を超える値もそのまま出す．有限でない時は「―」） */
export function formatPercent(ratio: number): string {
  if (!Number.isFinite(ratio)) return "―";
  return `${Math.round(ratio * 100)}%`;
}

/** 避難時間．集合場所に着いていれば秒数と制限時間に対する割合，着いていなければ「逃げ遅れ」 */
export function describeEvacuation(evaluation: DrillEvaluation): DebriefStat {
  const limit = evaluation.timeLimitSeconds;
  const hasLimit = Number.isFinite(limit) && limit > 0;
  const seconds = evaluation.evacuationSeconds;
  if (evaluation.lateEscape || seconds === null || !Number.isFinite(seconds)) {
    return {
      label: "避難時間",
      value: "逃げ遅れ",
      note: hasLimit
        ? `制限時間 ${formatSeconds(limit)}のうちに集合場所に着けませんでした`
        : "集合場所に着けませんでした",
      tone: "warn",
    };
  }
  return {
    label: "避難時間",
    value: formatSeconds(seconds),
    note: hasLimit
      ? `制限時間 ${formatSeconds(limit)}の ${formatPercent(seconds / limit)}で集合場所に着きました`
      : "集合場所に着きました",
    tone: "good",
  };
}

/** 煙の中の姿勢．しゃがんでいた割合と「できた／もう少し」．煙の中にいなかった時はそう伝える */
export function describeSmokePosture(evaluation: DrillEvaluation): DebriefStat {
  const ratio = evaluation.smokeCrouchRatio;
  if (ratio === null || !Number.isFinite(ratio)) {
    return {
      label: "煙の中の姿勢",
      value: "―",
      note: "煙の中にいませんでした",
      tone: "neutral",
    };
  }
  const clamped = Math.min(1, Math.max(0, ratio));
  const good = evaluation.smokePostureGood === true;
  const time = Number.isFinite(evaluation.smokeSeconds)
    ? `煙の中にいた ${formatSeconds(evaluation.smokeSeconds)}のうち，`
    : "煙の中で";
  return {
    label: "煙の中の姿勢",
    value: good ? "できた" : "もう少し",
    note: `${time}${formatPercent(clamped)}の間しゃがんでいました`,
    tone: good ? "good" : "warn",
  };
}

/** 正解経路から外れた区間の数 */
export function describeOffRoute(evaluation: DrillEvaluation): DebriefStat {
  const count = evaluation.offRoute.length;
  return {
    label: "正解経路から外れた所",
    value: `${count} か所`,
    note: count === 0 ? "正解経路から外れずに進めました" : "地図の橙色の線が外れた所です",
    tone: count === 0 ? "good" : "warn",
  };
}

/** 火に近づいた回数 */
export function describeNearFire(evaluation: DrillEvaluation): DebriefStat {
  const count = evaluation.nearFire.length;
  return {
    label: "火に近づいた回数",
    value: `${count} 回`,
    note: count === 0 ? "火に近づきませんでした" : "地図の赤い点が火に近づいた所です",
    tone: count === 0 ? "good" : "warn",
  };
}

/** 結果画面に並べる項目（上から順に出す） */
export function describeDrill(evaluation: DrillEvaluation): DebriefStat[] {
  return [
    describeEvacuation(evaluation),
    describeSmokePosture(evaluation),
    describeOffRoute(evaluation),
    describeNearFire(evaluation),
  ];
}

/** 正解経路（緑の線）についての一言．テストモード（F7）では，避難中には見せていなかったことを伝える */
export function describeRouteReveal(mode: DrillMode): string {
  return mode === "test"
    ? "テストモードでは避難中に正解経路を出していませんでした．緑の線が正解経路です．自分の経路（青）と比べてみましょう"
    : "緑の線は，避難中に床に出ていた正解経路です．自分の経路（青）と比べてみましょう";
}

/** 結果画面の見出し（校舎の名前が空なら「避難の結果」だけ） */
export function debriefTitle(planName: string): string {
  const name = planName.trim();
  return name === "" ? "避難の結果" : `${name}　避難の結果`;
}
