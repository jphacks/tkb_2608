// ナレーションの文面の表（ID → 文面）と，params の差し込み・読み上げ時間の見積もり（DOM に依存しない純粋な関数）．
// 文面は SPEC_01「火災訓練のシナリオ」に合わせる．読み上げの声は端末の読み上げ機能（speechSynthesis）

import type { CueParams } from "../core/cue";
import { isNarrationId, type NarrationId } from "./audioIds";

/** 読み方の種類．announcement は校内放送（前後にチャイムを鳴らし，ゆっくり読む） */
export type NarrationStyle = "narration" | "announcement";

export interface NarrationScript {
  /**
   * 文面の候補．{名前} を params の値で置き換える．前から順に，すべての {名前} を埋められた最初の文を使う
   * （roomName が無い時に場所を省いた文にするため）
   */
  readonly templates: readonly string[];
  readonly style: NarrationStyle;
}

/** ナレーションの ID → 文面 */
export const NARRATION_SCRIPTS: Readonly<Record<NarrationId, NarrationScript>> = {
  "classroom-intro": { templates: ["授業中です．周りを見てみましょう"], style: "narration" },
  "fire-announcement": {
    templates: [
      "{roomName}で火事です．先生の指示に従って避難してください",
      "火事です．先生の指示に従って避難してください",
    ],
    style: "announcement",
  },
  "evacuate-start": {
    templates: ["火と煙を避けて，校庭へ避難しましょう"],
    style: "narration",
  },
  "drill-ending": {
    templates: ["集合場所に着きました．訓練を終わります"],
    style: "narration",
  },
};

/** 読み上げの速さ（SpeechSynthesisUtterance.rate）．校内放送は少しゆっくり読む */
export const SPEECH_RATE: Readonly<Record<NarrationStyle, number>> = {
  narration: 1.05,
  announcement: 0.95,
};

/** 読み上げ時間の見積もりの設定（lobby/narrationPacing.ts と同じ考え方） */
export interface SpeechPacingConfig {
  /** rate 1.05 の時の 1 秒あたりの文字数（日本語でおよそ 6〜8） */
  readonly charsPerSecond: number;
  /** end が来ない時に待つ上限に足す余裕（s） */
  readonly marginSeconds: number;
}

export const DEFAULT_SPEECH_PACING: SpeechPacingConfig = { charsPerSecond: 7, marginSeconds: 4 };

/** charsPerSecond を測った時の rate */
const BASE_RATE = 1.05;

const PLACEHOLDER = /\{([A-Za-z0-9_]+)\}/g;

/** params の値を文面に差し込める文字列にする．空・有限でない数は無い扱い */
function paramText(value: string | number | boolean | undefined): string | null {
  if (value === undefined) return null;
  if (typeof value === "number" && !Number.isFinite(value)) return null;
  const text = String(value).trim();
  return text === "" ? null : text;
}

/** 文面の {名前} を埋める．埋められない {名前} があれば null */
export function fillTemplate(template: string, params: CueParams): string | null {
  let missing = false;
  const text = template.replace(PLACEHOLDER, (_, name: string) => {
    const value = Object.hasOwn(params, name) ? paramText(params[name]) : null;
    if (value === null) missing = true;
    return value ?? "";
  });
  return missing ? null : text;
}

/** ナレーションの文面と読み方．未知の ID・どの候補も埋められない時は null */
export function buildNarration(
  id: string,
  params: CueParams = {},
): { readonly text: string; readonly style: NarrationStyle } | null {
  if (!isNarrationId(id)) return null;
  const script = NARRATION_SCRIPTS[id];
  for (const template of script.templates) {
    const text = fillTemplate(template, params);
    if (text !== null) return { text, style: script.style };
  }
  return null;
}

/** 読み上げにかかる秒数の見積もり（s）．空白は数えない（句読点は間が空くため数える） */
export function estimateSpeechSeconds(
  text: string,
  rate: number,
  config: SpeechPacingConfig = DEFAULT_SPEECH_PACING,
): number {
  const cps =
    Number.isFinite(config.charsPerSecond) && config.charsPerSecond > 0
      ? config.charsPerSecond
      : DEFAULT_SPEECH_PACING.charsPerSecond;
  const r = Number.isFinite(rate) && rate > 0 ? rate : BASE_RATE;
  let count = 0;
  for (const ch of text) if (ch.trim() !== "") count++;
  return count / (cps * (r / BASE_RATE));
}

/** end・error が来ない時に，読み上げが終わったとみなすまでの秒数（s）．見積もり＋余裕 */
export function speechTimeoutSeconds(
  text: string,
  rate: number,
  config: SpeechPacingConfig = DEFAULT_SPEECH_PACING,
): number {
  const margin =
    Number.isFinite(config.marginSeconds) && config.marginSeconds >= 0 ? config.marginSeconds : 0;
  return estimateSpeechSeconds(text, rate, config) + margin;
}
