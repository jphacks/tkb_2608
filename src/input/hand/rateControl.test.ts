// 負荷に応じた認識の頻度（SPEC_01「処理速度」: fps が 30 を下回ったら 15 → 10 → 7 回/秒と下げ，戻す時はゆっくり上げる）
import { describe, expect, it } from "vitest";
import {
  INITIAL_RATE_CONTROL,
  type RateControlParams,
  type RateControlState,
  rateHz,
  stepRateControl,
} from "./rateControl";
import { TEST_HAND_PARAMS } from "./testHands";

const P: RateControlParams = TEST_HAND_PARAMS;

/** fps の一定のフレームを ms の間流す．最後の時刻も返す */
function run(
  s: RateControlState,
  t0: number,
  fps: number,
  ms: number,
): { s: RateControlState; t: number } {
  let st = s;
  const dt = 1000 / fps;
  let t = t0;
  for (; t <= t0 + ms; t += dt) st = stepRateControl(st, t, P);
  return { s: st, t: t - dt };
}

describe("rateHz", () => {
  it("最初は最も高い頻度（15 回/秒）", () => {
    expect(rateHz(INITIAL_RATE_CONTROL, P)).toBe(15);
  });

  it.each([
    [0, 15],
    [1, 10],
    [2, 7],
    [5, 7],
    [-1, 15],
  ])("段階 %s → %s 回/秒（範囲の外は端に収める）", (level, hz) => {
    expect(rateHz({ ...INITIAL_RATE_CONTROL, level }, P)).toBe(hz);
  });

  it("段階が無ければ 10 回/秒", () => {
    expect(rateHz(INITIAL_RATE_CONTROL, { rateLevelsHz: [] })).toBe(10);
  });
});

describe("stepRateControl", () => {
  it("60 fps が続く間は 15 回/秒のまま", () => {
    const { s } = run(INITIAL_RATE_CONTROL, 0, 60, 10_000);
    expect(s.level).toBe(0);
    expect(s.fps).toBeCloseTo(60, 0);
  });

  it("fps が 30 を下回って 1 秒続くと 10 回/秒に下げ，さらに 1 秒続くと 7 回/秒，それより下げない", () => {
    let s = run(INITIAL_RATE_CONTROL, 0, 60, 1000).s;
    const t0 = s.lastT;
    const changes: { t: number; hz: number }[] = [];
    for (let t = t0 + 50; t <= t0 + 10_000; t += 50) {
      const before = rateHz(s, P);
      s = stepRateControl(s, t, P);
      if (rateHz(s, P) !== before) changes.push({ t: t - t0, hz: rateHz(s, P) });
    }
    expect(changes.map((c) => c.hz)).toEqual([10, 7]);
    // fps は平均（時定数 0.5 秒）で見るため，30 を下回るまで少しかかり，その後 1 秒続いてから下げる
    expect(changes[0].t).toBeGreaterThanOrEqual(1000);
    expect(changes[0].t).toBeLessThanOrEqual(2000);
    expect(changes[1].t - changes[0].t).toBeGreaterThanOrEqual(1000);
    expect(changes[1].t - changes[0].t).toBeLessThanOrEqual(1100);
  });

  it("30〜50 fps の間は上げも下げもしない", () => {
    const down = { ...INITIAL_RATE_CONTROL, level: 1 };
    const { s } = run(down, 0, 40, 20_000);
    expect(s.level).toBe(1);
  });

  it("戻す時はゆっくり: 50 fps を超えて 5 秒続いたら 1 段だけ上げる", () => {
    const low = { ...INITIAL_RATE_CONTROL, level: 2 };
    let r = run(low, 0, 60, 4500);
    expect(r.s.level).toBe(2);
    r = run(r.s, r.t + 1000 / 60, 60, 1000);
    expect(r.s.level).toBe(1);
    r = run(r.s, r.t + 1000 / 60, 60, 5100);
    expect(r.s.level).toBe(0);
  });

  it("下げる判断のほうが上げる判断より早い", () => {
    expect(P.rateDownHoldMs).toBeLessThan(P.rateUpHoldMs);
  });

  it("500 ms を超えるフレームの間隔（タブが裏に回った等）は数えず，続いていた時間も数え直す", () => {
    let r = run(INITIAL_RATE_CONTROL, 0, 20, 800);
    expect(Number.isNaN(r.s.lowSince)).toBe(false);
    const fpsBefore = r.s.fps;
    const afterGap = stepRateControl(r.s, r.t + 3000, P);
    expect(afterGap.level).toBe(0);
    expect(afterGap.fps).toBe(fpsBefore);
    expect(Number.isNaN(afterGap.lowSince)).toBe(true);
    // 続く 20 fps は改めて 1 秒数える
    r = run(afterGap, r.t + 3050, 20, 800);
    expect(r.s.level).toBe(0);
  });

  it("時刻が NaN なら状態は変わらない", () => {
    const s = run(INITIAL_RATE_CONTROL, 0, 60, 500).s;
    expect(stepRateControl(s, Number.NaN, P)).toBe(s);
  });

  it("時刻が戻った・同じ時刻のフレームは数えない", () => {
    const s = run(INITIAL_RATE_CONTROL, 0, 60, 500).s;
    const back = stepRateControl(s, s.lastT - 100, P);
    expect(back.level).toBe(s.level);
    expect(back.fps).toBe(s.fps);
    const same = stepRateControl(s, s.lastT, P);
    expect(same.fps).toBe(s.fps);
  });

  it("最初のフレームは時刻を覚えるだけ", () => {
    const s = stepRateControl(INITIAL_RATE_CONTROL, 100, P);
    expect(s.lastT).toBe(100);
    expect(s.level).toBe(0);
    expect(Number.isNaN(s.fps)).toBe(true);
  });

  it("段階が 1 つしか無ければ下げない", () => {
    let s = INITIAL_RATE_CONTROL;
    for (let t = 0; t < 5000; t += 50) s = stepRateControl(s, t, { ...P, rateLevelsHz: [12] });
    expect(s.level).toBe(0);
  });
});
