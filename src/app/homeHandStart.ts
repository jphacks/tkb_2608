// ホームの「スタート」を手で押すために lobby/ へ渡すものを作る（Issue #147）．
// 押した判定は scenes/common/handButtonPress.ts の純粋な関数を使い，手の写し方は入力の種類（input/）に合わせる

import { DEFAULT_HAND_PARAMS } from "../input/hand/handParams";
import type { InputKind } from "../input/inputSource";
import { DEFAULT_MOCK_HAND_OPTIONS } from "../input/mock/mockHand";
import type { HandScreenView, HomeHandPress, HomeHandStart } from "../lobby/homeHandStart";
import {
  advanceHandButtonPress,
  DEFAULT_HAND_BUTTON_PRESS_CONFIG,
  type HandButtonPressConfig,
  type HandButtonPressState,
  handButtonProgress,
  INITIAL_HAND_BUTTON_PRESS,
} from "../scenes/common/handButtonPress";

/**
 * ホームの「スタート」の押した判定．かざす秒数はロビーの開始ボタン・付け外しの案内と同じ 1 秒．
 * ホームを出してから 1 秒は数えない（結果画面から戻った時等に，かざしたままの手ですぐ押さないため）
 */
export const HOME_HAND_PRESS_CONFIG: HandButtonPressConfig = {
  ...DEFAULT_HAND_BUTTON_PRESS_CONFIG,
  armSeconds: 1,
};

/**
 * 入力の種類ごとの，手の位置を画面に写す見え方．
 * device・replay（実機のカメラで記録した手）は背面カメラの画角と位置（input/ の既定値．
 * URL の上書き（?cameraHfovDeg= 等）は反映しない），mock はマウスから手を作る時の表示の画角（マウスの下に印が出る）
 */
export function homeHandScreenView(kind: InputKind): HandScreenView {
  if (kind === "mock") {
    return {
      fovDeg: DEFAULT_MOCK_HAND_OPTIONS.vfovDeg,
      axis: "vertical",
      originZ: 0,
    };
  }
  return {
    fovDeg: DEFAULT_HAND_PARAMS.cameraHfovDeg,
    axis: "horizontal",
    originZ: DEFAULT_HAND_PARAMS.cameraOffsetZM,
  };
}

/** 押した判定 1 つ分．押したフレームだけ true を返す */
export function createHomeHandPress(
  config: HandButtonPressConfig = HOME_HAND_PRESS_CONFIG,
): HomeHandPress {
  let state: HandButtonPressState = INITIAL_HAND_BUTTON_PRESS;
  return {
    advance(dt, handOver) {
      const wasPressed = state.pressedBy !== null;
      state = advanceHandButtonPress(state, { dt, handOver }, config);
      return !wasPressed && state.pressedBy !== null;
    },
    get progress() {
      return handButtonProgress(state, config);
    },
  };
}

export interface HomeHandStartOptions {
  readonly kind: InputKind;
  /** 手を認識できるか（device はカメラが取れた時だけ） */
  readonly handsUsable: () => boolean;
  /** 手の判定を止めるか（縦向きの案内が出ている間） */
  readonly isPaused: () => boolean;
}

/** ホームに渡すもの．mock はマウスをかざして試せるよう，「スタート」のクリックを下の画面へ通す */
export function createHomeHandStart(options: HomeHandStartOptions): HomeHandStart {
  return {
    view: homeHandScreenView(options.kind),
    handsUsable: options.handsUsable,
    createPress: () => createHomeHandPress(),
    isPaused: options.isPaused,
    pointerThrough: options.kind === "mock",
  };
}
