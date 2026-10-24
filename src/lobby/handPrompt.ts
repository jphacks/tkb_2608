// ロビーの開始ボタンを待つ間に，手が見つからない時の案内を出すかの判定（DOM・three.js に依存しない純粋な関数）．
// カメラは使えるが手が映っていない時に，自動では始めず「手を目の前に出して」と促す（Issue #110）

import type { Handedness, HandState } from "../core/types";

export interface HandPromptConfig {
  /** 手がこの秒数続けて見つからなければ案内を出す（s） */
  readonly promptAfterSeconds: number;
  /** 案内を出した後も手が見つからない時に，読み上げを繰り返す間隔（s） */
  readonly repeatSeconds: number;
}

export const DEFAULT_HAND_PROMPT_CONFIG: HandPromptConfig = {
  promptAfterSeconds: 10,
  repeatSeconds: 15,
};

export interface HandSearchState {
  /** 手（左右のどちらか）を最後に認識してからの秒数．認識している間は 0 */
  readonly unseenSeconds: number;
}

export const INITIAL_HAND_SEARCH: HandSearchState = { unseenSeconds: 0 };

/** 左右のどちらかの手を認識しているか */
export function isAnyHandTracked(hands: Readonly<Record<Handedness, HandState>>): boolean {
  return hands.left.tracked || hands.right.tracked;
}

/** 1 フレーム進める．手を認識したら数え直す */
export function advanceHandSearch(
  state: HandSearchState,
  dt: number,
  handTracked: boolean,
): HandSearchState {
  if (handTracked) return state.unseenSeconds === 0 ? state : INITIAL_HAND_SEARCH;
  const step = Number.isFinite(dt) && dt > 0 ? dt : 0;
  return { unseenSeconds: state.unseenSeconds + step };
}

/**
 * 手が見つからない案内の何回目か（0 から．読み上げの区切りに使う）．案内を出さない時は null
 */
export function handPromptIndex(
  state: HandSearchState,
  config: HandPromptConfig = DEFAULT_HAND_PROMPT_CONFIG,
): number | null {
  const over = state.unseenSeconds - config.promptAfterSeconds;
  if (!Number.isFinite(over) || over < 0) return null;
  if (!(config.repeatSeconds > 0)) return 0;
  return Math.floor(over / config.repeatSeconds);
}
