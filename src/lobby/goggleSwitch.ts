// ゴーグルを付けて見る画面（ロビー・避難）と外して見る画面（ホーム・結果）の間の切り替えで出す案内の決まり
// （DOM・three.js に依存しない純粋な関数．docs/04_SPEC/SPEC_01「画面の流れ」）．
// - 外す（takeOff）: 避難 → 結果．VR の中の板とナレーションで「ゴーグルを外して」と伝えてから結果画面へ
// - 付ける（putOn）: 結果・ホーム → ロビー．HTML で「スマホをゴーグルにセットして」と伝えてからロビーへ
// どちらも画面のタッチは使わず，時間で次の画面へ進む

import type { SceneId } from "../core/scene";
import type { StartGateConfig } from "./startGate";

/** ゴーグルを付けて見る画面（左右 2 画面で描く） */
export const GOGGLE_SCENES: ReadonlySet<SceneId> = new Set<SceneId>(["lobby", "scenario"]);

/** 切り替えの案内の種類．takeOff = ゴーグルを外す，putOn = スマホをゴーグルにセットする */
export type GoggleSwitch = "takeOff" | "putOn";

/**
 * 画面の切り替えで出す案内．from は今の画面（まだ何も出していなければ null）．
 * 許可の画面（start）からは直接ロビーへ進まないため，start は案内の対象にしない
 */
export function goggleSwitchBetween(from: SceneId | null, to: SceneId): GoggleSwitch | null {
  if (from === null || from === "start" || to === "start") return null;
  const fromGoggles = GOGGLE_SCENES.has(from);
  const toGoggles = GOGGLE_SCENES.has(to);
  if (fromGoggles && !toGoggles) return "takeOff";
  if (!fromGoggles && toGoggles) return "putOn";
  return null;
}

export interface GoggleSwitchConfig {
  /** 外す案内を出しておく最短の秒数（s）．読み上げが早く終わっても，板を読む時間を取る */
  readonly takeOffMinSeconds: number;
  /** 外す案内の読み上げの終わりが届かない時も，これを過ぎたら結果画面へ進む秒数（s） */
  readonly takeOffMaxSeconds: number;
  /** 付ける案内を出しておく秒数（s）．案内を読んでからゴーグルに入れる時間 */
  readonly putOnSeconds: number;
}

export const DEFAULT_GOGGLE_SWITCH_CONFIG: GoggleSwitchConfig = {
  takeOffMinSeconds: 5,
  takeOffMaxSeconds: 12,
  putOnSeconds: 6,
};

/** 案内を出してからの秒数を進める（dt は s）．paused の間は数えない */
export function advanceGoggleSwitchElapsed(elapsed: number, dt: number, paused: boolean): number {
  if (paused || !Number.isFinite(dt) || dt <= 0) return elapsed;
  return elapsed + dt;
}

/** 外す案内を終えて結果画面へ進んでよいか（最短の秒数が過ぎ，読み上げが終わったか上限の秒数を過ぎた） */
export function isGoggleOffDone(
  elapsed: number,
  narrationEnded: boolean,
  config: GoggleSwitchConfig = DEFAULT_GOGGLE_SWITCH_CONFIG,
): boolean {
  if (!Number.isFinite(elapsed)) return false;
  if (elapsed < config.takeOffMinSeconds) return false;
  return narrationEnded || elapsed >= config.takeOffMaxSeconds;
}

/** 付ける案内の残りの秒数（切り上げ．0 以上） */
export function goggleOnRemainingSeconds(
  elapsed: number,
  config: GoggleSwitchConfig = DEFAULT_GOGGLE_SWITCH_CONFIG,
): number {
  const e = Number.isFinite(elapsed) ? elapsed : 0;
  return Math.max(0, Math.ceil(config.putOnSeconds - e));
}

/** 付ける案内を終えてロビーへ進んでよいか */
export function isGoggleOnDone(
  elapsed: number,
  config: GoggleSwitchConfig = DEFAULT_GOGGLE_SWITCH_CONFIG,
): boolean {
  return Number.isFinite(elapsed) && elapsed >= config.putOnSeconds;
}

/** VR の中の板に出す，ゴーグルを外す案内 */
export const GOGGLE_OFF_PANEL = {
  title: "訓練が終わりました",
  body: "ゴーグルを外して，スマホの画面を見てください．結果が表示されます",
  caption: "まもなく結果画面に切り替わります",
} as const;

/** 付ける案内の見出し */
export const GOGGLE_ON_TITLE = "スマホをゴーグルにセットしてください";

/**
 * 付ける案内の箇条書き．ロビーの開始ボタン（lobbyScript.ts の describeStartGate）の案内とつながるよう，
 * ロビーの始め方（手のひらをかざす／時間で始まる）に合わせる
 */
export function goggleOnGuideLines(
  gate: Pick<StartGateConfig, "startMode" | "autoStartSeconds">,
): readonly string[] {
  const start =
    gate.startMode === "auto"
      ? `ゴーグルを着けて正面を向いて待つと，${Math.ceil(gate.autoStartSeconds)} 秒で訓練が始まります`
      : "ゴーグルを着けたら，目の前のボタンに手のひらをかざすと訓練が始まります";
  return [
    "スマホは横向きのまま，画面をゴーグルの奥に向けて入れてください",
    "画面が左右 2 つに切り替わります．このあとは画面に触らずに進みます",
    start,
  ];
}

/** デモ用の起動（?app&demo）で，開始画面の後の付ける案内に出す箇条書き（ロビーを通らず避難が始まる） */
export const GOGGLE_ON_DEMO_LINES: readonly string[] = [
  "スマホは横向きのまま，画面をゴーグルの奥に向けて入れてください",
  "ゴーグルを着けたら，まっすぐ前を向いて待ってください．その向きが正面になります",
  "画面が左右 2 つに切り替わると，非常ベルが鳴って避難訓練が始まります",
];

/** 付ける案内の残り秒数の表示 */
export function goggleOnCaption(remainingSeconds: number): string {
  return `${remainingSeconds} 秒後にゴーグルの画面に切り替わります`;
}
