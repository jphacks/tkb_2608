// シナリオの結果（scenario/ が作り，debrief/ が表示し，recording/ がアップロードする）

export type StepOutcome = "completed" | "timedOut";

/** 場面 1 つ分の記録 */
export interface StepRecord {
  readonly stepId: string;
  /** 結果画面に出す場面の見出し（場面の定義の report.label） */
  readonly label?: string;
  /** 求める動作ができた時の補足・できなかった時の助言 */
  readonly advice?: string;
  readonly outcome: StepOutcome;
  /** 体験開始からの経過秒数 */
  readonly startedAt: number;
  readonly durationSeconds: number;
}

export type EvaluationPolarity = "good" | "bad";

/** 場面の途中で検出した正しい行動・危険な行動 */
export interface EvaluationRecord {
  readonly id: string;
  readonly stepId: string;
  readonly label: string;
  readonly polarity: EvaluationPolarity;
  readonly advice?: string;
  /** 体験開始からの経過秒数 */
  readonly atSeconds: number;
}

export interface ScenarioResult {
  readonly scenarioId: string;
  readonly title: string;
  readonly totalSeconds: number;
  /** 全体の制限時間で打ち切られたか */
  readonly aborted: boolean;
  readonly steps: readonly StepRecord[];
  readonly evaluations: readonly EvaluationRecord[];
}
