// 避難の画面の時刻の数え方（drillProgress.ts）のテスト．
// 基準は docs/04_SPEC/SPEC_01「VR 避難の規則」（火の 1 マス以内で警告音）・「結果の評価」（0.2 秒ごとの記録）．
// 警告音を鳴らし直す間隔（2 秒）は仕様に無く，Issue #111 で仮に決めた値
import { describe, expect, it } from "vitest";
import {
  INITIAL_WARNING_TIMER,
  NEAR_FIRE_WARNING_REPEAT_SECONDS,
  TRACK_SAMPLE_INTERVAL_SECONDS,
  tickNearFireWarning,
  tickTrack,
  type WarningTimer,
} from "./drillProgress";

describe("定数", () => {
  it("記録の間隔は 0.2 秒，警告音の鳴らし直しは 2 秒", () => {
    expect(TRACK_SAMPLE_INTERVAL_SECONDS).toBe(0.2);
    expect(NEAR_FIRE_WARNING_REPEAT_SECONDS).toBe(2);
  });
});

describe("tickTrack", () => {
  it("非常ベルの時点（0 秒）で最初の記録を足し，次は 0.2 秒", () => {
    expect(tickTrack(0, 0)).toEqual({ record: true, nextAt: 0.2 });
  });

  it("次の予定の前は足さず，予定はそのまま", () => {
    expect(tickTrack(0.2, 0.1)).toEqual({ record: false, nextAt: 0.2 });
    expect(tickTrack(0.2, 0.1999)).toEqual({ record: false, nextAt: 0.2 });
  });

  it("予定の時刻ちょうどで足し，次の予定は 1 間隔後", () => {
    const r = tickTrack(0.2, 0.2);
    expect(r.record).toBe(true);
    expect(r.nextAt).toBeCloseTo(0.4, 12);
  });

  it("予定を少し過ぎたフレームでは，予定の時刻から 1 間隔後を次にする（ずれをためない）", () => {
    const r = tickTrack(0.2, 0.21);
    expect(r.record).toBe(true);
    expect(r.nextAt).toBeCloseTo(0.4, 12);
  });

  it("フレームが 1 間隔以上遅れた時は，まとめて足さず今から 1 間隔後を次にする", () => {
    const r = tickTrack(0.2, 1.0);
    expect(r.record).toBe(true);
    expect(r.nextAt).toBeCloseTo(1.2, 12);
    // 次のフレームで追いつくためにもう一度足すことはない
    expect(tickTrack(r.nextAt, 1.0 + 1 / 60).record).toBe(false);
  });

  it("間隔を渡せる", () => {
    expect(tickTrack(0, 0, 0.5)).toEqual({ record: true, nextAt: 0.5 });
  });

  it.each([Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY])(
    "時刻が有限でない（%s）なら足さない",
    (t) => {
      expect(tickTrack(0, t)).toEqual({ record: false, nextAt: 0 });
    },
  );

  it.each([Number.NaN, Number.POSITIVE_INFINITY])(
    "予定が有限でない（%s）なら足さない",
    (nextAt) => {
      expect(tickTrack(nextAt, 5).record).toBe(false);
    },
  );

  it("非常ベルより前（負の時刻）は足さない", () => {
    expect(tickTrack(0, -0.5).record).toBe(false);
  });

  it("60 fps で 150 秒進めると，約 0.2 秒ごとに 750〜751 件になる（SPEC_01: 150 秒で 751 件）", () => {
    let nextAt = 0;
    const times: number[] = [];
    for (let i = 0; i <= 150 * 60; i++) {
      const t = i / 60;
      const r = tickTrack(nextAt, t);
      if (r.record) times.push(t);
      nextAt = r.nextAt;
    }
    expect(times.length).toBeGreaterThanOrEqual(750);
    expect(times.length).toBeLessThanOrEqual(751);
    expect(times[0]).toBe(0);
    for (let i = 1; i < times.length; i++) {
      const gap = (times[i] ?? 0) - (times[i - 1] ?? 0);
      expect(gap).toBeGreaterThan(0.2 - 1 / 60 - 1e-9);
      expect(gap).toBeLessThan(0.2 + 1 / 60 + 1e-9);
    }
  });
});

describe("tickNearFireWarning", () => {
  const near = (sinceLast: number): WarningTimer => ({ near: true, sinceLast });

  it("火の 1 マス以内でなければ鳴らさず，状態は初期に戻る", () => {
    expect(tickNearFireWarning(INITIAL_WARNING_TIMER, false, 0.1)).toEqual({
      timer: INITIAL_WARNING_TIMER,
      play: false,
    });
    expect(tickNearFireWarning(near(1.5), false, 0.1)).toEqual({
      timer: INITIAL_WARNING_TIMER,
      play: false,
    });
  });

  it("火の 1 マス以内に入ったフレームで鳴らす", () => {
    const r = tickNearFireWarning(INITIAL_WARNING_TIMER, true, 0.1);
    expect(r.play).toBe(true);
    expect(r.timer).toEqual({ near: true, sinceLast: 0 });
  });

  it("いる間は 2 秒たつまで鳴らさず，2 秒で鳴らし直す", () => {
    expect(tickNearFireWarning(near(1.85), true, 0.1).play).toBe(false);
    const r = tickNearFireWarning(near(1.9), true, 0.1);
    expect(r.play).toBe(true);
    expect(r.timer.sinceLast).toBe(0);
  });

  it("いる間ずっと 1/60 秒ずつ進めると，入った時と 2 秒ごとに鳴る", () => {
    let timer = INITIAL_WARNING_TIMER;
    const played: number[] = [];
    for (let i = 0; i <= 60 * 5; i++) {
      const r = tickNearFireWarning(timer, true, 1 / 60);
      if (r.play) played.push(i / 60);
      timer = r.timer;
    }
    expect(played.length).toBe(3);
    expect(played[0]).toBe(0);
    expect(played[1]).toBeCloseTo(2, 1);
    expect(played[2]).toBeCloseTo(4, 1);
  });

  it("離れてから入り直せば，すぐに鳴らす", () => {
    let r = tickNearFireWarning(INITIAL_WARNING_TIMER, true, 0.1);
    r = tickNearFireWarning(r.timer, true, 0.5);
    expect(r.play).toBe(false);
    r = tickNearFireWarning(r.timer, false, 0.1);
    r = tickNearFireWarning(r.timer, true, 0.1);
    expect(r.play).toBe(true);
  });

  it.each([Number.NaN, -1, Number.NEGATIVE_INFINITY])("dt が不正（%s）なら 0 として扱う", (dt) => {
    const r = tickNearFireWarning(near(1.0), true, dt);
    expect(r.play).toBe(false);
    expect(r.timer).toEqual({ near: true, sinceLast: 1.0 });
  });

  it("鳴らし直す間隔を渡せる", () => {
    expect(tickNearFireWarning(near(0.4), true, 0.1, 0.5).play).toBe(true);
    expect(tickNearFireWarning(near(0.3), true, 0.1, 0.5).play).toBe(false);
  });

  it("状態を書き換えない", () => {
    const t = Object.freeze(near(1));
    tickNearFireWarning(t, true, 1.5);
    expect(t).toEqual({ near: true, sinceLast: 1 });
  });
});
