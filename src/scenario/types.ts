// シナリオ定義の形式（docs/04_SPEC/SPEC_01「シナリオ定義の形式」）．
// シナリオはデータとして書き，進行エンジン（engine.ts）は中身を知らない
import type { Cue } from "../core/cue";
import type { GameEvent } from "../core/events";
import type { EvaluationRecord, StepRecord } from "../core/result";
import type { Posture } from "../core/types";

/**
 * 求める動作の判定条件（判別可能 union．種類を足す時は engine.ts の evaluateLeaf に分岐を足す）．
 * 一度満たした条件は，その場面の間は満たしたままとして扱う（ラッチ）．
 * 詳しい意味（all と together の違い等）は docs/04_SPEC/SPEC_01「判定条件」
 */
export type Condition =
  /** 指定の姿勢を holdSeconds 秒続けた（省略時は 0 秒 = その瞬間） */
  | { readonly type: "posture"; readonly posture: Posture; readonly holdSeconds?: number }
  /** 足踏み（歩行）を holdSeconds 秒続けた */
  | { readonly type: "walking"; readonly holdSeconds?: number }
  /** 指定のエリアに holdSeconds 秒いた（エリアの形は scenes/ が決める） */
  | { readonly type: "inArea"; readonly areaId: string; readonly holdSeconds?: number }
  /** 指定の物に手で触れた */
  | { readonly type: "touch"; readonly objectId: string }
  /** 部屋から指定の出来事（signal）が届いた */
  | { readonly type: "signal"; readonly name: string }
  /** 場面に入ってから seconds 秒たった（ナレーションを聞かせるだけの場面等） */
  | { readonly type: "elapsed"; readonly seconds: number }
  /** それぞれを（別々の時でもよいので）一度は満たした */
  | { readonly type: "all"; readonly conditions: readonly Condition[] }
  /**
   * すべてを同時に満たしている状態が holdSeconds 秒続いた（途切れたら 0 に戻る）．
   * 子はラッチせず「今この瞬間満たしているか」で評価する
   */
  | {
      readonly type: "together";
      readonly conditions: readonly Condition[];
      readonly holdSeconds?: number;
    }
  /** どれかを満たした */
  | { readonly type: "any"; readonly conditions: readonly Condition[] };

/** 場面の途中で鳴らす助言（求める動作がなかなかできない時用） */
export interface HintDefinition {
  /** 場面に入ってからの秒数 */
  readonly afterSeconds: number;
  readonly cues: readonly Cue[];
}

/** 結果画面に出す行動の評価（正しい行動・危険な行動）．条件を満たした時に 1 回だけ記録する */
export interface CheckDefinition {
  readonly id: string;
  readonly label: string;
  readonly polarity: "good" | "bad";
  readonly when: Condition;
  readonly advice?: string;
}

/** 制限時間を過ぎた時の扱い．詰まらないよう，既定では次の場面へ進む */
export interface TimeoutDefinition {
  readonly seconds: number;
  /** 時間切れの時に出す演出（「先に進みます」等） */
  readonly cues?: readonly Cue[];
  /** 時間切れの時の行き先．省略時は場面の next と同じ */
  readonly next?: string | null;
}

export interface StepDefinition {
  readonly id: string;
  /** 場面に入った時の演出（ナレーション・効果音・出来事） */
  readonly onEnter?: readonly Cue[];
  /** 求める動作．満たすと次の場面へ進む */
  readonly goal: Condition;
  /** 求める動作ができた時に出す演出 */
  readonly onComplete?: readonly Cue[];
  readonly timeout?: TimeoutDefinition;
  readonly hints?: readonly HintDefinition[];
  readonly checks?: readonly CheckDefinition[];
  /** 結果画面に出す場面の見出しと助言．省略した場面は結果画面に出さない */
  readonly report?: { readonly label: string; readonly advice?: string };
  /** 次の場面の ID．省略時は配列の次の場面，null で終了 */
  readonly next?: string | null;
}

export interface ScenarioDefinition {
  readonly id: string;
  readonly title: string;
  /** 全体の制限時間（秒）．過ぎたら打ち切って結果画面へ進む */
  readonly timeLimitSeconds?: number;
  /** 最初の場面は配列の先頭 */
  readonly steps: readonly StepDefinition[];
}

/** 進行エンジンへの 1 フレーム分の入力（app/ が PlayerInput と部屋の状態から作る） */
export interface ScenarioInput {
  readonly posture: Posture;
  readonly walking: boolean;
  /** プレイヤーが今いるエリアの ID */
  readonly areaIds: readonly string[];
}

/** 進行エンジンが出す通知．app/ がイベントバスへ流す */
export type ScenarioEffect =
  | { readonly type: "cue"; readonly cue: Cue }
  | { readonly type: "stepEntered"; readonly stepId: string }
  | { readonly type: "stepFinished"; readonly record: StepRecord }
  | { readonly type: "evaluated"; readonly record: EvaluationRecord }
  | { readonly type: "finished" };

/** 条件ごとの途中経過．キーは条件木の中の位置（"goal/0/1" 等） */
export interface ConditionProgress {
  readonly holdTimers: Readonly<Record<string, number>>;
  readonly latched: Readonly<Record<string, true>>;
}

export interface ScenarioState {
  readonly status: "running" | "finished";
  /** 今の場面の ID（終了後は null） */
  readonly stepId: string | null;
  readonly stepElapsed: number;
  readonly totalElapsed: number;
  readonly progress: ConditionProgress;
  /** 今の場面で鳴らした助言の添字 */
  readonly firedHints: readonly number[];
  /** 今の場面で記録した評価の ID */
  readonly firedChecks: readonly string[];
  readonly steps: readonly StepRecord[];
  readonly evaluations: readonly EvaluationRecord[];
  /** 全体の制限時間で打ち切ったか */
  readonly aborted: boolean;
  /**
   * 場面が切り替わったフレームに届き，前の場面で使われなかった出来事．
   * 次の advance() で，そのフレームの出来事より前に並べて評価する
   */
  readonly pendingEvents: readonly GameEvent[];
}

export interface AdvanceResult {
  readonly state: ScenarioState;
  readonly effects: readonly ScenarioEffect[];
}
