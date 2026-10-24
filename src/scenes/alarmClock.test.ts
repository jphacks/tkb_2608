// 空間を単独で開いた時の非常ベルからの時刻の決め方（alarmClock.ts）のテスト．
// 基準は Issue #104 の約束（?t=<秒> は 0 以上の有限の数，?speed=<倍率> は 0 より大きい有限の数だけ受け付け，
// それ以外は既定値（0 秒・1 倍）．1 フレームで dt × speed 進め，dt が負・NaN なら進めない）

import { describe, expect, it } from "vitest";
import { advanceAlarmSeconds, DEFAULT_ALARM_CLOCK, parseAlarmClock } from "./alarmClock";

describe("DEFAULT_ALARM_CLOCK", () => {
  it("開いた時を 0 秒とし，実際の時間と同じ速さ（1 倍）で進む", () => {
    expect(DEFAULT_ALARM_CLOCK).toEqual({ startSeconds: 0, speed: 1 });
  });
});

describe("parseAlarmClock", () => {
  it("指定なし（空のクエリ）は既定値", () => {
    expect(parseAlarmClock("")).toEqual(DEFAULT_ALARM_CLOCK);
    expect(parseAlarmClock("?scene=school")).toEqual(DEFAULT_ALARM_CLOCK);
  });

  it("t と speed を両方受け付ける（他のパラメータと併用できる）", () => {
    expect(parseAlarmClock("?scene=school&t=60&speed=5")).toEqual({ startSeconds: 60, speed: 5 });
  });

  it("先頭の ? が無くても読める", () => {
    expect(parseAlarmClock("t=12&speed=2")).toEqual({ startSeconds: 12, speed: 2 });
  });

  it.each([
    ["0（境界．非常ベルちょうど）", "0", 0],
    ["小数", "12.5", 12.5],
    ["指数表記", "1e3", 1000],
    ["大きな値", "100000", 100000],
  ])("t: %s は受け付ける", (_, value, expected) => {
    const clock = parseAlarmClock(`?t=${value}`);
    expect(clock.startSeconds).toBe(expected);
    expect(clock.speed).toBe(1);
  });

  it.each([
    ["負の数", "-1"],
    ["ごく小さい負の数", "-0.001"],
    ["NaN", "NaN"],
    ["Infinity", "Infinity"],
    ["-Infinity", "-Infinity"],
    ["空", ""],
    ["空白だけ", "%20%20"],
    ["数でない文字", "abc"],
    ["数の後ろに文字", "10s"],
  ])("t: %s は既定値の 0 秒", (_, value) => {
    expect(parseAlarmClock(`?t=${value}`).startSeconds).toBe(0);
  });

  it("t=（値なし）は既定値の 0 秒", () => {
    expect(parseAlarmClock("?t=").startSeconds).toBe(0);
    expect(parseAlarmClock("?t").startSeconds).toBe(0);
  });

  it.each([
    ["1", "1", 1],
    ["5 倍", "5", 5],
    ["遅くする", "0.5", 0.5],
    ["ごく小さい正の数（境界）", "0.000001", 0.000001],
    ["Number.MIN_VALUE", String(Number.MIN_VALUE), Number.MIN_VALUE],
  ])("speed: %s は受け付ける", (_, value, expected) => {
    const clock = parseAlarmClock(`?speed=${value}`);
    expect(clock.speed).toBe(expected);
    expect(clock.startSeconds).toBe(0);
  });

  it.each([
    ["0（境界．止まる）", "0"],
    ["負の数", "-2"],
    ["NaN", "NaN"],
    ["Infinity", "Infinity"],
    ["空", ""],
    ["数でない文字", "fast"],
  ])("speed: %s は既定値の 1 倍", (_, value) => {
    expect(parseAlarmClock(`?speed=${value}`).speed).toBe(1);
  });

  it("t と speed は別々に判定する（片方が不正でももう片方は使う）", () => {
    expect(parseAlarmClock("?t=-5&speed=3")).toEqual({ startSeconds: 0, speed: 3 });
    expect(parseAlarmClock("?t=30&speed=0")).toEqual({ startSeconds: 30, speed: 1 });
  });

  it("同じパラメータを複数指定した時は最初の値を使う", () => {
    expect(parseAlarmClock("?t=10&t=20&speed=2&speed=4")).toEqual({
      startSeconds: 10,
      speed: 2,
    });
  });

  it("返す値は常に有限で，t は 0 以上・speed は 0 より大きい", () => {
    for (const search of ["?t=NaN&speed=NaN", "?t=-1&speed=-1", "?t=1e400&speed=1e400", ""]) {
      const { startSeconds, speed } = parseAlarmClock(search);
      expect(Number.isFinite(startSeconds)).toBe(true);
      expect(startSeconds).toBeGreaterThanOrEqual(0);
      expect(Number.isFinite(speed)).toBe(true);
      expect(speed).toBeGreaterThan(0);
    }
  });
});

describe("advanceAlarmSeconds", () => {
  it("dt × speed だけ進める", () => {
    expect(advanceAlarmSeconds(10, 0.5, 1)).toBe(10.5);
    expect(advanceAlarmSeconds(10, 0.5, 4)).toBe(12);
    expect(advanceAlarmSeconds(0, 1 / 60, 1)).toBeCloseTo(1 / 60, 12);
  });

  it("毎フレーム進めると経過時間 × speed になる", () => {
    let seconds = 60;
    for (let i = 0; i < 120; i++) seconds = advanceAlarmSeconds(seconds, 1 / 60, 5);
    expect(seconds).toBeCloseTo(60 + 2 * 5, 9);
  });

  it("dt が 0 の時は進めない", () => {
    expect(advanceAlarmSeconds(10, 0, 5)).toBe(10);
  });

  it.each([
    ["負（時計の巻き戻り）", -0.1],
    ["NaN", Number.NaN],
    ["Infinity", Number.POSITIVE_INFINITY],
    ["-Infinity", Number.NEGATIVE_INFINITY],
  ])("dt が %s の時は進めない", (_, dt) => {
    expect(advanceAlarmSeconds(10, dt, 2)).toBe(10);
  });

  it("引数を書き換えず，同じ入力には同じ値を返す（純粋な関数）", () => {
    expect(advanceAlarmSeconds(3, 0.25, 2)).toBe(advanceAlarmSeconds(3, 0.25, 2));
  });
});
