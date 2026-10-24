// 避難（仮）の時間の進め方（Issue #110 の決定事項: 5 秒で結果画面へ．縦向きの案内中は数えない）

import { describe, expect, it } from "vitest";
import {
  advancePlaceholderTimer,
  INITIAL_PLACEHOLDER_TIMER,
  isPlaceholderDone,
  type PlaceholderTimer,
  placeholderRemainingSeconds,
  SCENARIO_PLACEHOLDER_SECONDS,
} from "./scenarioPlaceholderTimer";

function run(timer: PlaceholderTimer, seconds: number, paused = false, dt = 0.125) {
  let t = timer;
  const n = Math.round(seconds / dt);
  for (let i = 0; i < n; i++) t = advancePlaceholderTimer(t, dt, paused);
  return t;
}

describe("SCENARIO_PLACEHOLDER_SECONDS", () => {
  it("5 秒", () => {
    expect(SCENARIO_PLACEHOLDER_SECONDS).toBe(5);
  });
});

describe("advancePlaceholderTimer", () => {
  it("dt を足していく", () => {
    expect(run(INITIAL_PLACEHOLDER_TIMER, 2).elapsed).toBeCloseTo(2);
  });

  it("止めている間（縦向きの案内中）は数えない", () => {
    const t = run(INITIAL_PLACEHOLDER_TIMER, 2);
    const paused = run(t, 30, true);
    expect(paused.elapsed).toBeCloseTo(2);
    expect(isPlaceholderDone(paused)).toBe(false);
  });

  it("再開すると続きから数える", () => {
    let t = run(INITIAL_PLACEHOLDER_TIMER, 2);
    t = run(t, 30, true);
    t = run(t, 2.875);
    expect(isPlaceholderDone(t)).toBe(false);
    t = run(t, 0.125);
    expect(isPlaceholderDone(t)).toBe(true);
  });

  it.each([Number.NaN, -1, 0, Number.POSITIVE_INFINITY])("dt が %s の時は進めない", (dt) => {
    expect(advancePlaceholderTimer({ elapsed: 1 }, dt, false).elapsed).toBe(1);
  });
});

describe("isPlaceholderDone", () => {
  it.each([
    [0, false],
    [4.99, false],
    [5, true],
    [7, true],
  ])("%s 秒 → %s", (elapsed, done) => {
    expect(isPlaceholderDone({ elapsed })).toBe(done);
  });

  it("秒数を渡せば，その秒数で終わる", () => {
    expect(isPlaceholderDone({ elapsed: 2 }, 2)).toBe(true);
    expect(isPlaceholderDone({ elapsed: 1.9 }, 2)).toBe(false);
  });
});

describe("placeholderRemainingSeconds", () => {
  it.each([
    [0, 5],
    [0.1, 5],
    [4.2, 1],
    [5, 0],
    [9, 0],
  ])("%s 秒たった → 残り %s 秒（切り上げ，0 以上）", (elapsed, remaining) => {
    expect(placeholderRemainingSeconds({ elapsed })).toBe(remaining);
  });
});
