// 避難の記録（DrillTrack）と評価（DrillEvaluation）の型（app/ が記録し，sim/ が評価し，debrief/ が表示する）．
// 求め方は docs/04_SPEC/SPEC_01_画面遷移とモジュール構成.md「結果の評価」を正とする
import type { Posture } from "./types";

/** 避難中の 1 回分の記録（app/ が 0.2 秒ごとに足す） */
export interface DrillSample {
  /** 非常ベルからの秒数（s） */
  readonly t: number;
  /** SchoolPlan.floors の添字（CellRef.floor と同じ） */
  readonly floor: number;
  /** ワールド座標の X（m） */
  readonly x: number;
  /** ワールド座標の Z（m） */
  readonly z: number;
  readonly posture: Posture;
}

/** 避難の間の記録．samples は時刻の順に並べる */
export interface DrillTrack {
  readonly samples: readonly DrillSample[];
}

/** 記録のうちの連続した区間（両端の記録を含む） */
export interface DrillInterval {
  /** 最初の記録の DrillTrack.samples の添字 */
  readonly fromIndex: number;
  /** 最後の記録の添字 */
  readonly toIndex: number;
  /** 最初の記録の非常ベルからの秒数（s） */
  readonly fromSeconds: number;
  /** 最後の記録の非常ベルからの秒数（s） */
  readonly toSeconds: number;
}

/** 記録のうちの 1 点（火に近づいた点等） */
export interface DrillMoment {
  /** DrillTrack.samples の添字 */
  readonly index: number;
  /** 非常ベルからの秒数（s） */
  readonly t: number;
  readonly floor: number;
  /** ワールド座標の X（m） */
  readonly x: number;
  /** ワールド座標の Z（m） */
  readonly z: number;
}

/** 避難の評価（F8．sim/ の evaluateDrill() が作る） */
export interface DrillEvaluation {
  /** 正解経路のマスから 1 マスより離れた区間 */
  readonly offRoute: readonly DrillInterval[];
  /** 燃えているマスから 1 マス以内に入った点（入った時だけ．いる間は続けて数えない） */
  readonly nearFire: readonly DrillMoment[];
  /** 煙が着いたマスにいた時間（s） */
  readonly smokeSeconds: number;
  /** 煙の中でしゃがんでいた時間の割合（0〜1）．煙の中にいなかった時は null */
  readonly smokeCrouchRatio: number | null;
  /** 煙の中の姿勢が「できた」か（割合が目安以上）．煙の中にいなかった時は null */
  readonly smokePostureGood: boolean | null;
  /** 煙の中で立っていた区間 */
  readonly smokeStanding: readonly DrillInterval[];
  /** 非常ベルから集合場所のマスに入るまでの秒数（s）．制限時間内に着かなければ null */
  readonly evacuationSeconds: number | null;
  /** 制限時間（s．SchoolPlan.drill.timeLimitSeconds の写し．「制限時間の何割か」を出すため） */
  readonly timeLimitSeconds: number;
  /** 逃げ遅れ（制限時間内に集合場所に着かなかった）か */
  readonly lateEscape: boolean;
}
