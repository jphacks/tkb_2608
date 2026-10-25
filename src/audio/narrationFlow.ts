// ナレーションの進め方（チャイム → 読み上げ → チャイム，終わりの signal，重なった時の扱い）を決める状態機械．
// 時刻・タイマー・読み上げには触れず，殻（drillAudio.ts）が「指示」を実行し，結果を「出来事」として戻す．
//
// 重なった時の扱い:
// - 校内放送（announcement）の途中に来たナレーションは，放送の終わりまで待たせる（放送を途中で切らない）．
//   待てるのは 1 つだけで，さらに来たら前に待たせていた分は読まずに終わった扱い（signal を流す）にする
// - 普通のナレーションの途中に来たナレーションは，前を止めて新しい方を読む（前の分の signal はその時に流す）
// - signal は 1 つのナレーションにつき必ず 1 回だけ流す（stop で止めた時は流さない）

import { narrationEndedSignal } from "./audioIds";
import { chimeWaitSeconds } from "./chime";
import {
  DEFAULT_SPEECH_PACING,
  estimateSpeechSeconds,
  type NarrationStyle,
  SPEECH_PITCH,
  SPEECH_RATE,
  type SpeechPacingConfig,
  speechTimeoutSeconds,
} from "./narrationText";

/** 読む 1 件 */
export interface NarrationItem {
  /** 殻が付ける通し番号（古い読み上げの知らせを見分ける） */
  readonly token: number;
  readonly id: string;
  /** 読む文．null は文面が無い（未知の ID 等）ので読まずに終わった扱い */
  readonly text: string | null;
  readonly style: NarrationStyle;
}

export type NarrationPhase = "preChime" | "speaking" | "postChime";

export interface NarrationState {
  readonly current: (NarrationItem & { readonly phase: NarrationPhase }) | null;
  /** 校内放送の後に読む 1 件 */
  readonly queued: NarrationItem | null;
}

export const IDLE_NARRATION: NarrationState = { current: null, queued: null };

/** 時間がたったら殻から戻してもらう出来事の種類 */
export type NarrationTimerEvent = "preChimeDone" | "speechTimeout" | "postChimeDone";

export type NarrationEvent =
  | { readonly type: "request"; readonly item: NarrationItem }
  /** 時間がたった（wait の指示で頼んだもの） */
  | { readonly type: NarrationTimerEvent; readonly token: number }
  /** 読み上げの end・error が届いた */
  | { readonly type: "speechEnded"; readonly token: number }
  /** 読み上げを始められなかった（読み上げの機能が無い等） */
  | { readonly type: "speechUnavailable"; readonly token: number }
  /** すべて止める（画面を出る時．signal は流さない） */
  | { readonly type: "stop" };

export type NarrationAction =
  | { readonly type: "chime"; readonly kind: "start" | "end" }
  | {
      readonly type: "speak";
      readonly token: number;
      readonly text: string;
      readonly rate: number;
      /** 声の高さ（SpeechSynthesisUtterance.pitch） */
      readonly pitch: number;
    }
  | { readonly type: "cancelSpeech" }
  | { readonly type: "signal"; readonly name: string }
  /** seconds 秒（s）後に event を token 付きで戻す */
  | {
      readonly type: "wait";
      readonly token: number;
      readonly event: NarrationTimerEvent;
      readonly seconds: number;
    };

export interface NarrationStep {
  readonly state: NarrationState;
  readonly actions: readonly NarrationAction[];
}

/** 出来事を受けて次の状態と指示を返す */
export function reduceNarration(
  state: NarrationState,
  event: NarrationEvent,
  config: SpeechPacingConfig = DEFAULT_SPEECH_PACING,
): NarrationStep {
  const actions: NarrationAction[] = [];
  switch (event.type) {
    case "stop": {
      if (state.current !== null) actions.push({ type: "cancelSpeech" });
      return { state: IDLE_NARRATION, actions };
    }
    case "request": {
      const { current } = state;
      if (current === null) return { state: begin(event.item, null, actions, config), actions };
      if (current.style === "announcement") {
        // 放送は切らずに待たせる．待たせていた分は読まずに終わった扱いにする
        if (state.queued !== null) actions.push(signalOf(state.queued));
        return { state: { current, queued: event.item }, actions };
      }
      // 普通のナレーションは止めて新しい方を読む
      if (current.phase === "speaking") actions.push({ type: "cancelSpeech" });
      actions.push(signalOf(current));
      return { state: begin(event.item, state.queued, actions, config), actions };
    }
    case "preChimeDone": {
      const { current } = state;
      if (current === null || current.token !== event.token || current.phase !== "preChime") {
        return { state, actions };
      }
      return { state: startSpeaking(current, state.queued, actions, config), actions };
    }
    case "speechEnded":
    case "speechTimeout": {
      const { current } = state;
      if (current === null || current.token !== event.token || current.phase !== "speaking") {
        return { state, actions };
      }
      if (current.style === "announcement") {
        actions.push({ type: "chime", kind: "end" });
        actions.push({
          type: "wait",
          token: current.token,
          event: "postChimeDone",
          seconds: chimeWaitSeconds("end"),
        });
        return {
          state: { current: { ...current, phase: "postChime" }, queued: state.queued },
          actions,
        };
      }
      return { state: finish(current, state.queued, actions, config), actions };
    }
    case "speechUnavailable": {
      const { current } = state;
      if (current === null || current.token !== event.token || current.phase !== "speaking") {
        return { state, actions };
      }
      // 読めなくても場面の間合いを保つため，読んだらかかる時間だけ待ってから終わった扱いにする
      const text = current.text ?? "";
      actions.push({
        type: "wait",
        token: current.token,
        event: "speechTimeout",
        seconds: estimateSpeechSeconds(text, SPEECH_RATE[current.style], config),
      });
      return { state, actions };
    }
    case "postChimeDone": {
      const { current } = state;
      if (current === null || current.token !== event.token || current.phase !== "postChime") {
        return { state, actions };
      }
      return { state: finish(current, state.queued, actions, config), actions };
    }
  }
}

function signalOf(item: NarrationItem): NarrationAction {
  return { type: "signal", name: narrationEndedSignal(item.id) };
}

/** item を読み始める．文面が無ければすぐ終わった扱いにして，待たせている分へ進む */
function begin(
  item: NarrationItem,
  queued: NarrationItem | null,
  actions: NarrationAction[],
  config: SpeechPacingConfig,
): NarrationState {
  if (item.text === null) {
    actions.push(signalOf(item));
    return queued === null ? IDLE_NARRATION : begin(queued, null, actions, config);
  }
  if (item.style === "announcement") {
    actions.push({ type: "chime", kind: "start" });
    actions.push({
      type: "wait",
      token: item.token,
      event: "preChimeDone",
      seconds: chimeWaitSeconds("start"),
    });
    return { current: { ...item, phase: "preChime" }, queued };
  }
  return startSpeaking(item, queued, actions, config);
}

function startSpeaking(
  item: NarrationItem,
  queued: NarrationItem | null,
  actions: NarrationAction[],
  config: SpeechPacingConfig,
): NarrationState {
  const text = item.text ?? "";
  const rate = SPEECH_RATE[item.style];
  const pitch = SPEECH_PITCH[item.style];
  actions.push({ type: "speak", token: item.token, text, rate, pitch });
  // end が来ない端末でも必ず終わるよう，上限の時間を頼んでおく
  actions.push({
    type: "wait",
    token: item.token,
    event: "speechTimeout",
    seconds: speechTimeoutSeconds(text, rate, config),
  });
  return { current: { ...item, phase: "speaking" }, queued };
}

function finish(
  item: NarrationItem,
  queued: NarrationItem | null,
  actions: NarrationAction[],
  config: SpeechPacingConfig,
): NarrationState {
  actions.push(signalOf(item));
  return queued === null ? IDLE_NARRATION : begin(queued, null, actions, config);
}

/** 効果音を小さくしておくか（何かを読んでいる・チャイムの間） */
export function isNarrating(state: NarrationState): boolean {
  return state.current !== null;
}
