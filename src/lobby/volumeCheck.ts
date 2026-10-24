// 設定の「音量」で流す確認用の音の予定（ナレーションの例の文と，効果音の例をいつ・どれを鳴らすか）．
// DOM・Web Audio に依存しない定義だけを置く（音の合成は volumeCheckSound.ts，表示は homeSettingsPanel.ts）

/** 効果音の例の種類．alarm = 警報のような短いビープの繰り返し，rumble = 揺れを思わせる低いうなり */
export type VolumeCueKind = "alarm" | "rumble";

/** 効果音の例の 1 回分 */
export interface VolumeCue {
  /** 「音を鳴らす」を押してから鳴らし始めるまでの秒数（s） */
  readonly at: number;
  readonly kind: VolumeCueKind;
}

/** ナレーションの例として読み上げる文（約 5 秒） */
export const VOLUME_CHECK_NARRATION =
  "ナレーションの音量の確認です．横の音量ボタンで，聞きやすい大きさに合わせてください";

/**
 * 既定の予定．ナレーションの例（約 5 秒）を読み終えた後に，警報 → 揺れ の順に 1 回ずつ鳴らす
 * （読み上げと重なると，どちらの大きさを合わせているか分かりにくいため）
 */
export const DEFAULT_VOLUME_CUES: readonly VolumeCue[] = [
  { at: 5.5, kind: "alarm" },
  { at: 8.5, kind: "rumble" },
];
