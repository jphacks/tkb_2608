// 体の判定の全体（射影 → 帯域通過 → 山 → 状態機械，しゃがみ）を合成の波形で確かめる．
// 基準は SPEC_01「判定の安定性」（足踏みは 0.5 秒以内，しゃがみは 1 秒以内）と experiment_山﨑/04・05・09
import { describe, expect, it } from "vitest";
import type { MotionSample } from "../sensors/types";
import { crouchAccel, G, samplesOf, testParams, verticalSample } from "../testFixtures";
import {
  type BodyState,
  cloneBodyState,
  createBodyState,
  readBody,
  resetBody,
  stepBody,
  updateBody,
} from "./bodyTracker";
import { StepResult } from "./stepDetector";

const P = testParams();
const DT = 16;

/** 足踏み（上下 ±d m の揺れ．x = d(cos ωt − 1) なので速度の平均は 0）の上下の加速度 */
function stepping(freqHz: number, accAmp: number): (t: number) => number {
  const w = 2 * Math.PI * freqHz;
  return (t) => -accAmp * Math.cos(w * t);
}

interface Trace {
  t: number;
  walking: boolean;
  speed: number;
  posture: string;
  mode: string;
  step: StepResult;
}

function feed(s: BodyState, samples: MotionSample[], params = P): Trace[] {
  return samples.map((x) => {
    updateBody(s, x, params);
    const o = readBody(s, x.t, params);
    return {
      t: x.t,
      walking: o.walking,
      speed: o.walkSpeed,
      posture: o.posture,
      mode: s.locomotion.mode,
      step: s.lastStepResult,
    };
  });
}

function rest(s: BodyState, t0: number, ms: number, params = P): Trace[] {
  return feed(
    s,
    samplesOf(t0, ms, DT, () => 0),
    params,
  );
}

describe("足踏み（合成の 2 Hz）", () => {
  it.each([1.5, 3, 5])(
    "上下の加速度 ±%s m/s^2: 1 歩目で仮に歩き，2 歩目で歩く．0.5 秒以内に walking",
    (amp) => {
      const s = createBodyState(P);
      rest(s, 0, 2000);
      const tr = feed(s, samplesOf(2000, 3000, DT, stepping(2, amp)));
      const steps = tr.filter((x) => x.step === StepResult.Step);
      expect(steps.length).toBeGreaterThanOrEqual(5);
      expect(steps[0].mode).toBe("tentative");
      expect(steps[1].mode).toBe("walking");
      const firstWalking = tr.find((x) => x.walking);
      expect(firstWalking).toBeDefined();
      expect((firstWalking?.t ?? Number.POSITIVE_INFINITY) - 2000).toBeLessThanOrEqual(500);
      // 1 秒に 2 歩 × 0.5 m = 1.0 m/s に近づく
      expect(tr[tr.length - 1].speed).toBeGreaterThan(0.85);
      expect(tr[tr.length - 1].speed).toBeLessThanOrEqual(1.05);
      expect(s.posture.posture).toBe("standing");
    },
  );

  it("速さは maxWalkSpeed を超えない（3 Hz の足踏み）", () => {
    const params = testParams({ maxWalkSpeed: 1.2 });
    const s = createBodyState(params);
    rest(s, 0, 2000, params);
    const tr = feed(s, samplesOf(2000, 4000, DT, stepping(3, 4)), params);
    expect(Math.max(...tr.map((x) => x.speed))).toBeLessThanOrEqual(1.2);
    expect(tr[tr.length - 1].speed).toBeGreaterThan(1.0);
  });

  it("足踏みをやめると止まる（stepStopMaxMs と減速の分の後に walking false）", () => {
    const s = createBodyState(P);
    rest(s, 0, 2000);
    feed(s, samplesOf(2000, 3000, DT, stepping(2, 3)));
    const tr = rest(s, 5000, 3000);
    const stopAt = tr.find((x) => !x.walking)?.t ?? Number.POSITIVE_INFINITY;
    expect(stopAt - 5000).toBeLessThanOrEqual(P.stepStopMaxMs + 600);
    expect(tr[tr.length - 1]).toMatchObject({ walking: false, speed: 0, mode: "stopped" });
  });

  it("小さすぎる揺れ（T_high 未満）では歩かない", () => {
    const s = createBodyState(P);
    rest(s, 0, 2000);
    const tr = feed(s, samplesOf(2000, 3000, DT, stepping(2, 0.5)));
    expect(tr.some((x) => x.walking)).toBe(false);
  });

  it("首振り（角速度が大きい）の揺れでは歩かない", () => {
    const s = createBodyState(P);
    rest(s, 0, 2000);
    const tr = feed(
      s,
      samplesOf(2000, 3000, DT, stepping(2, 3), () => P.stepGyroRejectDps * 2),
    );
    expect(tr.some((x) => x.walking)).toBe(false);
    expect(tr.some((x) => x.step === StepResult.RejectedGyro)).toBe(true);
  });

  it("サンプルの周期が違っても（30 Hz・100 Hz）同じように歩く", () => {
    for (const dt of [33, 10]) {
      const s = createBodyState(P);
      feed(
        s,
        samplesOf(0, 2000, dt, () => 0),
      );
      const tr = feed(s, samplesOf(2000, 3000, dt, stepping(2, 3)));
      const firstWalking = tr.find((x) => x.walking)?.t ?? Number.POSITIVE_INFINITY;
      expect(firstWalking - 2000).toBeLessThanOrEqual(500);
      expect(tr[tr.length - 1].speed).toBeGreaterThan(0.85);
    }
  });
});

describe("しゃがみ・立ち上がり（合成）", () => {
  it("0.4 m を 0.7 秒でしゃがむと 1 秒以内に crouching，立つと 1 秒以内に standing．歩かない", () => {
    const s = createBodyState(P);
    rest(s, 0, 2000);
    const down = feed(s, samplesOf(2000, 2000, DT, crouchAccel(0.4, 0.7)));
    const crouchAt = down.find((x) => x.posture === "crouching")?.t ?? Number.POSITIVE_INFINITY;
    expect(crouchAt - 2000).toBeLessThanOrEqual(1000);
    const up = feed(s, samplesOf(4000, 2000, DT, crouchAccel(-0.4, 0.7)));
    const standAt = up.find((x) => x.posture === "standing")?.t ?? Number.POSITIVE_INFINITY;
    expect(standAt - 4000).toBeLessThanOrEqual(1000);
    expect([...down, ...up].some((x) => x.walking)).toBe(false);
  });

  it("しゃがみ歩き（しゃがみのしきい値で歩き，立ちのしきい値より小さい揺れ）を 30 秒続けても立たない", () => {
    const s = createBodyState(P);
    rest(s, 0, 2000);
    feed(s, samplesOf(2000, 2000, DT, crouchAccel(0.4, 0.7)));
    expect(s.posture.posture).toBe("crouching");
    // 帯域通過後の山が stepHighCrouching（0.6）と stepHighStanding（1.0）の間に入る大きさ
    const tr = feed(s, samplesOf(4000, 30000, DT, stepping(2, 0.85)));
    expect(tr.every((x) => x.posture === "crouching")).toBe(true);
    expect(tr.filter((x) => x.walking).length).toBeGreaterThan(tr.length * 0.8);
  });

  it("しゃがんだまま立ちの大きさの足踏みが続くと，逃げ道 A で立つ", () => {
    const s = createBodyState(P);
    rest(s, 0, 2000);
    feed(s, samplesOf(2000, 2000, DT, crouchAccel(0.4, 0.7)));
    expect(s.posture.posture).toBe("crouching");
    const tr = feed(s, samplesOf(4000, 5000, DT, stepping(2, 3)));
    expect(tr[tr.length - 1].posture).toBe("standing");
    expect(s.posture.lastOutcome).toBe("stand-escape");
  });

  it("standEscapeSteps=0 なら，立ちの大きさの足踏みでもしゃがみのまま", () => {
    const params = testParams({ standEscapeSteps: 0 });
    const s = createBodyState(params);
    rest(s, 0, 2000, params);
    feed(s, samplesOf(2000, 2000, DT, crouchAccel(0.4, 0.7)), params);
    const tr = feed(s, samplesOf(4000, 5000, DT, stepping(2, 3)), params);
    expect(tr.every((x) => x.posture === "crouching")).toBe(true);
  });

  it("しゃがむ動作の山は足踏みとして数えない", () => {
    const s = createBodyState(P);
    rest(s, 0, 2000);
    const tr = feed(s, samplesOf(2000, 2500, DT, crouchAccel(0.4, 0.7)));
    expect(tr.filter((x) => x.step === StepResult.Step)).toHaveLength(0);
  });
});

describe("フェイルセーフ（experiment_山﨑/09）", () => {
  function walkingState(): BodyState {
    const s = createBodyState(P);
    rest(s, 0, 2000);
    feed(s, samplesOf(2000, 2000, DT, stepping(2, 3)));
    expect(readBody(s, 3984, P).walking).toBe(true);
    return s;
  }

  it("時刻が進まない・戻るサンプルは捨てる", () => {
    const s = walkingState();
    const before = cloneBodyState(s);
    updateBody(s, verticalSample(3984, 5), P);
    updateBody(s, verticalSample(3000, 5), P);
    expect(s.droppedCount).toBe(before.droppedCount + 2);
    expect(s.sampleCount).toBe(before.sampleCount);
    expect(s.lastT).toBe(before.lastT);
    expect(s.locomotion).toEqual(before.locomotion);
  });

  it("非有限の時刻のサンプルは捨てる", () => {
    const s = walkingState();
    updateBody(s, verticalSample(Number.NaN, 5), P);
    expect(s.droppedCount).toBe(1);
    expect(s.lastT).toBe(3984);
  });

  it("間隔が maxSampleGapMs を超えたら初期化する（歩きは止め，姿勢は保つ）", () => {
    const s = createBodyState(P);
    rest(s, 0, 2000);
    feed(s, samplesOf(2000, 2000, DT, crouchAccel(0.4, 0.7)));
    feed(s, samplesOf(4000, 2000, DT, stepping(2, 0.85)));
    expect(s.posture.posture).toBe("crouching");
    expect(readBody(s, 5984, P).walking).toBe(true);
    const resets = s.resetCount;
    updateBody(s, verticalSample(5984 + P.maxSampleGapMs + 1, 0), P);
    expect(s.resetCount).toBe(resets + 1);
    expect(s.posture.posture).toBe("crouching");
    expect(s.locomotion.mode).toBe("stopped");
    expect(readBody(s, 5984 + P.maxSampleGapMs + 1, P)).toEqual({
      posture: "crouching",
      walking: false,
      walkSpeed: 0,
    });
  });

  it("間隔がちょうど maxSampleGapMs なら初期化しない", () => {
    const s = walkingState();
    const resets = s.resetCount;
    updateBody(s, verticalSample(3984 + P.maxSampleGapMs, 0), P);
    expect(s.resetCount).toBe(resets);
  });

  it("初期化の後，数百 ms で元の判定に戻る（再び歩ける）", () => {
    const s = walkingState();
    const t0 = 3984 + 5000; // 裏に回って 5 秒後に戻った
    const tr = feed(s, samplesOf(t0, 3000, DT, stepping(2, 3)));
    expect(tr.some((x) => x.walking)).toBe(true);
  });

  it("最後のサンプルから sensorTimeoutMs を超えたら walking false・速さ 0（姿勢は保つ）", () => {
    const s = walkingState();
    const last = s.lastT;
    expect(readBody(s, last + P.sensorTimeoutMs, P).walking).toBe(true);
    expect(readBody(s, last + P.sensorTimeoutMs + 1, P)).toEqual({
      posture: "standing",
      walking: false,
      walkSpeed: 0,
    });
  });

  it("サンプルがまだ無ければ止まって立っている", () => {
    expect(readBody(createBodyState(P), 0, P)).toEqual({
      posture: "standing",
      walking: false,
      walkSpeed: 0,
    });
  });

  it.each<[string, Partial<MotionSample>]>([
    ["acc が NaN", { acc: { x: Number.NaN, y: 0, z: 0 } }],
    ["acc が Infinity", { acc: { x: 0, y: Number.POSITIVE_INFINITY, z: 0 } }],
    ["accG が NaN", { accG: { x: Number.NaN, y: G, z: 0 } }],
    ["rot が NaN", { rot: { alpha: Number.NaN, beta: 0, gamma: 0 } }],
    ["すべて null", { acc: null, accG: null, rot: null }],
  ])("壊れた値（%s）が来ても例外を投げず，姿勢を保ち，その後また歩ける", (_, broken) => {
    const s = createBodyState(P);
    rest(s, 0, 2000);
    feed(s, samplesOf(2000, 2000, DT, crouchAccel(0.4, 0.7)));
    expect(s.posture.posture).toBe("crouching");
    const bad = { ...verticalSample(4000, 0), ...broken };
    expect(() => updateBody(s, bad, P)).not.toThrow();
    expect(s.posture.posture).toBe("crouching");
    const out = readBody(s, 4000, P);
    expect(Number.isFinite(out.walkSpeed)).toBe(true);
    // 壊れた値の後も，数秒で元どおり判定できる
    const tr = feed(s, samplesOf(4016, 4000, DT, stepping(2, 0.85)));
    expect(tr.some((x) => x.walking)).toBe(true);
    expect(tr.every((x) => Number.isFinite(x.speed))).toBe(true);
  });

  it("resetBody は姿勢を保ち，歩きと動作の途中を捨てる", () => {
    const s = walkingState();
    s.posture.posture = "crouching";
    resetBody(s);
    expect(s.posture.posture).toBe("crouching");
    expect(s.locomotion.mode).toBe("stopped");
    expect(s.locomotion.speed).toBe(0);
    expect(s.lastT).toBeNaN();
    expect(readBody(s, 10000, P).walking).toBe(false);
  });
});

describe("書き換える版と返す版", () => {
  it("stepBody は updateBody と同じ結果を返し，元の状態を変えない", () => {
    const samples = [
      ...samplesOf(0, 1000, DT, () => 0),
      ...samplesOf(1000, 1500, DT, stepping(2, 3)),
    ];
    const mutated = createBodyState(P);
    let returned = createBodyState(P);
    for (const x of samples) {
      updateBody(mutated, x, P);
      const prev = returned;
      const snapshot = JSON.stringify(prev);
      returned = stepBody(prev, x, P);
      expect(JSON.stringify(prev)).toBe(snapshot);
    }
    expect(JSON.stringify(returned)).toBe(JSON.stringify(mutated));
    expect(readBody(returned, 2484, P)).toEqual(readBody(mutated, 2484, P));
  });

  it("readBody は状態を書き換えない", () => {
    const s = createBodyState(P);
    feed(
      s,
      samplesOf(0, 500, DT, () => 0),
    );
    const snapshot = JSON.stringify(s);
    readBody(s, 100000, P);
    expect(JSON.stringify(s)).toBe(snapshot);
  });
});
