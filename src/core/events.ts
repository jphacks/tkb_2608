// イベントバスで流すイベントの一覧．追加は core の専用 PR で行い全員に周知する
import type { Cue } from "./cue";
import type { ScenarioResult } from "./result";
import type { Handedness } from "./types";

/**
 * 部屋（scenes/）で起きた出来事．scenario/ の判定条件の入力になる
 */
export type GameEvent =
  /** 手で物に触れた（objectId は scenes/ が付ける触れる物の ID） */
  | { readonly type: "objectTouched"; readonly objectId: string; readonly hand: Handedness }
  /** エリアに入った・出た（areaId は scenes/ が付けるエリアの ID） */
  | { readonly type: "areaEntered"; readonly areaId: string }
  | { readonly type: "areaExited"; readonly areaId: string }
  /** その他の出来事（例: "door-opened"，"narration-ended:intro"） */
  | { readonly type: "signal"; readonly name: string };

/**
 * アプリ全体のイベント．GameEvent に加え，シナリオの進行の通知を流す
 */
export type AppEvent =
  | GameEvent
  /** シナリオからの演出の指示（scenes/ と audio/ が受け取る） */
  | { readonly type: "cue"; readonly cue: Cue }
  | { readonly type: "stepEntered"; readonly stepId: string }
  | { readonly type: "scenarioFinished"; readonly result: ScenarioResult };

export type AppEventType = AppEvent["type"];
