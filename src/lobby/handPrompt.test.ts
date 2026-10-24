// 手が見つからない時の案内（Issue #110 の決定事項を基準にする）:
// ロビーで 10 秒続けて手が見つからなければ案内し，その後 15 秒ごとに読み上げ直す．自動では始めない．
// 手が映れば元の案内に戻る

import { describe, expect, it } from "vitest";
import type { HandState } from "../core/types";
import { UNTRACKED_HAND } from "../core/types";
import {
  advanceHandSearch,
  DEFAULT_HAND_PROMPT_CONFIG,
  type HandSearchState,
  handPromptIndex,
  INITIAL_HAND_SEARCH,
  isAnyHandTracked,
} from "./handPrompt";

const TRACKED: HandState = { tracked: true, position: { x: 0, y: 0, z: -0.4 }, grip: 0 };

function unseen(seconds: number): HandSearchState {
  return { unseenSeconds: seconds };
}

/** dt（2 進で正確な刻み）で seconds だけ進める */
function run(state: HandSearchState, seconds: number, tracked: boolean, dt = 0.125) {
  let s = state;
  const n = Math.round(seconds / dt);
  for (let i = 0; i < n; i++) s = advanceHandSearch(s, dt, tracked);
  return s;
}

describe("DEFAULT_HAND_PROMPT_CONFIG（決定事項）", () => {
  it("10 秒で案内し，15 秒ごとに読み上げ直す", () => {
    expect(DEFAULT_HAND_PROMPT_CONFIG.promptAfterSeconds).toBe(10);
    expect(DEFAULT_HAND_PROMPT_CONFIG.repeatSeconds).toBe(15);
  });
});

describe("isAnyHandTracked", () => {
  it.each([
    ["両方とも未認識", UNTRACKED_HAND, UNTRACKED_HAND, false],
    ["左だけ", TRACKED, UNTRACKED_HAND, true],
    ["右だけ", UNTRACKED_HAND, TRACKED, true],
    ["両方", TRACKED, TRACKED, true],
  ])("%s → %s", (_label, left, right, expected) => {
    expect(isAnyHandTracked({ left, right })).toBe(expected);
  });
});

describe("advanceHandSearch", () => {
  it("手が見つからない間は秒数を足していく", () => {
    expect(run(INITIAL_HAND_SEARCH, 3, false).unseenSeconds).toBeCloseTo(3);
  });

  it("手が映れば 0 に戻る", () => {
    const s = run(INITIAL_HAND_SEARCH, 12, false);
    expect(advanceHandSearch(s, 0.125, true).unseenSeconds).toBe(0);
  });

  it("手が映っている間は 0 のまま（同じ状態を返す）", () => {
    expect(advanceHandSearch(INITIAL_HAND_SEARCH, 1, true)).toBe(INITIAL_HAND_SEARCH);
  });

  it.each([Number.NaN, -1, 0, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY])(
    "dt が %s の時は時間を進めない",
    (dt) => {
      expect(advanceHandSearch(unseen(2), dt, false).unseenSeconds).toBe(2);
    },
  );

  it("元の状態を書き換えない", () => {
    const s = Object.freeze(unseen(1));
    advanceHandSearch(s, 1, false);
    expect(s.unseenSeconds).toBe(1);
  });
});

describe("handPromptIndex", () => {
  it("10 秒未満は案内しない（null）", () => {
    expect(handPromptIndex(INITIAL_HAND_SEARCH)).toBeNull();
    expect(handPromptIndex(unseen(9.99))).toBeNull();
  });

  it("10 秒ちょうどで 1 回目（0）の案内を出す", () => {
    expect(handPromptIndex(unseen(10))).toBe(0);
  });

  it.each([
    [10, 0],
    [24.9, 0],
    [25, 1],
    [39.9, 1],
    [40, 2],
    [100, 6],
  ])("%s 秒見つからない → %s 回目（15 秒ごとに増える）", (seconds, index) => {
    expect(handPromptIndex(unseen(seconds))).toBe(index);
  });

  it("手が映れば案内が消え（null），また 10 秒数え直す", () => {
    let s = run(INITIAL_HAND_SEARCH, 30, false);
    expect(handPromptIndex(s)).toBe(1);
    s = advanceHandSearch(s, 0.125, true);
    expect(handPromptIndex(s)).toBeNull();
    s = run(s, 9.875, false);
    expect(handPromptIndex(s)).toBeNull();
    s = run(s, 0.125, false);
    expect(handPromptIndex(s)).toBe(0);
  });

  it("フレームで進めても 10 秒で案内が出る", () => {
    expect(handPromptIndex(run(INITIAL_HAND_SEARCH, 9.875, false))).toBeNull();
    expect(handPromptIndex(run(INITIAL_HAND_SEARCH, 10, false))).toBe(0);
  });

  it("NaN の秒数では案内しない", () => {
    expect(handPromptIndex(unseen(Number.NaN))).toBeNull();
  });

  it("繰り返しの間隔が 0 以下・NaN なら 1 回目のまま増やさない", () => {
    for (const repeatSeconds of [0, -5, Number.NaN]) {
      expect(handPromptIndex(unseen(100), { promptAfterSeconds: 10, repeatSeconds })).toBe(0);
    }
  });
});
