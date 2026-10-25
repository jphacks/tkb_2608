// 短いキャリブレーション（calibrateParams）を合成のサンプルで確かめる（Issue #94・#58）．
// 基準は SPEC_01「キャリブレーションとの分担」（timeout・skipped の区間やサンプルが足りない区間は捨てて既定の判定に戻す．
// 既定より悪くしない）と，区間ごとの値の求め方（calibration.ts の calibrateParams の説明）
import { describe, expect, it } from "vitest";
import type { CalibrationSegment, CalibrationSegmentKind } from "../../core/types";
import type { MotionSample } from "../sensors/types";
import { crouchAccel, samplesOf, testParams, verticalSample } from "../testFixtures";
import { calibrateParams } from "./calibration";

/** 上書きの下限・上限の基準（テストの中で明示する） */
const BASE = testParams({
  zuptAccel: 0.35,
  zuptGyroDps: 25,
  stepHighStanding: 1.0,
  stepLowStanding: 0.3,
  stepHighCrouching: 0.6,
  stepLowCrouching: 0.2,
  crouchDepthM: 0.4,
  postureMaxIntegrateMs: 1500,
  postureCandidateAccel: 0.8,
  postureNoiseFactor: 4,
  standWalkSteps: 4,
});

const DT = 16;
const still = () => 0;

/** 立って静止の揺れ: 8 Hz・振幅 A（RMS は A / √2） */
const sway = (rms: number) => (t: number) => rms * Math.SQRT2 * Math.sin(2 * Math.PI * 8 * t);
/** 足踏み: 2 Hz・上下の加速度の振幅 A（帯域通過後の山は A の 9 割ほど） */
const stepWave = (amp: number) => (t: number) => -amp * Math.cos(2 * Math.PI * 2 * t);

interface SessionOptions {
  /** 立って静止の RMS（m/s^2）と角速度（deg/s） */
  readonly standRms: number;
  readonly standGyro: number;
  /** 立って足踏みの上下の加速度の振幅（m/s^2）と長さ（ms） */
  readonly stepAmp: number;
  readonly stepMs: number;
  /** しゃがむ深さ（m）と時間（秒） */
  readonly crouchDepth: number;
  readonly crouchSec: number;
  /** しゃがみ歩きの上下の加速度の振幅（m/s^2）と長さ（ms） */
  readonly crouchWalkAmp: number;
  readonly crouchWalkMs: number;
  /** 区間ごとの結果（省けば completed） */
  readonly outcomes: Partial<Record<CalibrationSegmentKind, CalibrationSegment["outcome"]>>;
  /** 区間に入れない種類 */
  readonly omit: readonly CalibrationSegmentKind[];
}

const DEFAULT_SESSION: SessionOptions = {
  standRms: 0.1,
  standGyro: 10,
  stepAmp: 3,
  stepMs: 5000,
  crouchDepth: 0.3,
  crouchSec: 0.7,
  crouchWalkAmp: 8,
  crouchWalkMs: 4000,
  outcomes: {},
  omit: [],
};

/**
 * 準備の静止 2 秒 → 立って静止 3 秒 → 静止 1 秒 → 足踏み → 静止 1 秒 → しゃがむ（区間の始まりから 0.5 秒立って待つ．
 * 区間は動作の終わりまで．短くても 3.5 秒）→ 静止 1 秒 → しゃがみ歩き → 静止 1 秒．区間は各動作の始まりから終わりまで
 */
function session(over: Partial<SessionOptions> = {}): {
  samples: MotionSample[];
  segments: CalibrationSegment[];
} {
  const o = { ...DEFAULT_SESSION, ...over };
  const samples: MotionSample[] = [];
  const segments: CalibrationSegment[] = [];
  let t = 0;
  const add = (ms: number, f: (s: number) => number, gyro?: (s: number) => number) => {
    samples.push(...samplesOf(t, ms, DT, f, gyro));
    t += Math.round(ms / DT) * DT;
  };
  const seg = (kind: CalibrationSegmentKind, startMs: number) => {
    if (o.omit.includes(kind)) return;
    segments.push({ kind, startMs, endMs: t, outcome: o.outcomes[kind] ?? "completed" });
  };
  add(2000, still);
  let s0 = t;
  add(3000, sway(o.standRms), () => o.standGyro);
  seg("standing", s0);
  add(1000, still);
  s0 = t;
  add(o.stepMs, stepWave(o.stepAmp));
  seg("stepping", s0);
  add(1000, still);
  s0 = t;
  add(500, still);
  // しゃがむ動作が終わるまで（短くても 3 秒）
  add(Math.max(3000, o.crouchSec * 1000 + 500), crouchAccel(o.crouchDepth, o.crouchSec));
  seg("crouching", s0);
  add(1000, still);
  s0 = t;
  add(o.crouchWalkMs, stepWave(o.crouchWalkAmp));
  seg("crouchWalking", s0);
  add(1000, still);
  return { samples, segments };
}

function calibrate(over: Partial<SessionOptions> = {}, base = BASE) {
  const { samples, segments } = session(over);
  return calibrateParams(samples, segments, base);
}

describe("calibrateParams（測れない・使わない区間）", () => {
  it("区間が無ければ上書きは空で，測った値はすべて null（既定の判定に戻す）", () => {
    const { samples } = session();
    const r = calibrateParams(samples, [], BASE);
    expect(r.overrides).toEqual({});
    expect(r.measurements).toMatchObject({
      restNoiseAccel: null,
      restGyroDps: null,
      stepPeakStanding: null,
      crouchDepth: null,
      crouchDurationMs: null,
      stepPeakCrouching: null,
      crouchingEstimated: false,
    });
    expect(r.notes.length).toBeGreaterThanOrEqual(4);
  });

  it("サンプルが無ければ上書きは空（例外を投げない）", () => {
    const { segments } = session();
    const r = calibrateParams([], segments, BASE);
    expect(r.overrides).toEqual({});
  });

  it("すべて揃っていれば，求める項目がすべて入る", () => {
    const r = calibrate();
    expect(Object.keys(r.overrides).sort()).toEqual(
      [
        "zuptAccel",
        "zuptGyroDps",
        "stepHighStanding",
        "stepLowStanding",
        "stepHighCrouching",
        "stepLowCrouching",
        "crouchDepthM",
        "postureMaxIntegrateMs",
        "standWalkPeakStanding",
        "standWalkPeakCrouching",
      ].sort(),
    );
    expect(r.measurements.crouchingEstimated).toBe(false);
  });

  // 区間の種類ごとに，その区間から求める項目
  const KEYS_OF: Record<CalibrationSegmentKind, readonly string[]> = {
    standing: ["zuptAccel", "zuptGyroDps"],
    stepping: ["stepHighStanding", "stepLowStanding"],
    crouching: ["crouchDepthM", "postureMaxIntegrateMs"],
    crouchWalking: [],
  };

  it.each<CalibrationSegmentKind>(["standing", "stepping", "crouching"])(
    "%s の区間が skipped なら，その区間の項目は上書きに入れない",
    (kind) => {
      const r = calibrate({ outcomes: { [kind]: "skipped" } });
      for (const key of KEYS_OF[kind]) expect(r.overrides).not.toHaveProperty(key);
    },
  );

  it.each<CalibrationSegmentKind>(["standing", "stepping", "crouching"])(
    "%s の区間が timeout なら，その区間の項目は上書きに入れない（SPEC_01: timeout の区間は捨てて既定の判定に戻す）",
    (kind) => {
      const r = calibrate({ outcomes: { [kind]: "timeout" } });
      for (const key of KEYS_OF[kind]) expect(r.overrides).not.toHaveProperty(key);
    },
  );

  it.each<CalibrationSegmentKind>(["standing", "stepping", "crouching"])(
    "%s の区間が無ければ，その区間の項目は上書きに入れない",
    (kind) => {
      const r = calibrate({ omit: [kind] });
      for (const key of KEYS_OF[kind]) expect(r.overrides).not.toHaveProperty(key);
    },
  );

  it.each([
    ["始まりが NaN", Number.NaN, 5000],
    ["終わりが NaN", 2000, Number.NaN],
    ["終わりが始まりより前", 5000, 2000],
    ["長さが 0", 2000, 2000],
    ["始まりが Infinity", Number.POSITIVE_INFINITY, 5000],
  ])("区間の時刻が不正（%s）なら使わない", (_name, startMs, endMs) => {
    const { samples, segments } = session();
    const bad = segments.map((s) => (s.kind === "standing" ? { ...s, startMs, endMs } : s));
    const r = calibrateParams(samples, bad, BASE);
    expect(r.overrides).not.toHaveProperty("zuptAccel");
    expect(r.overrides).not.toHaveProperty("zuptGyroDps");
    expect(r.measurements.restNoiseAccel).toBeNull();
  });

  it("サンプルの値に NaN・Infinity・時刻の NaN が混ざっても，上書きの値はすべて有限", () => {
    const { samples, segments } = session();
    const noisy = samples.map((s, i) => {
      if (i % 37 === 0) return { ...s, acc: { x: Number.NaN, y: Number.NaN, z: Number.NaN } };
      if (i % 53 === 0) return { ...s, rot: null };
      if (i % 71 === 0) return { ...s, t: Number.NaN };
      if (i % 89 === 0) return { ...s, accG: { x: 0, y: Number.POSITIVE_INFINITY, z: 0 } };
      return s;
    });
    const r = calibrateParams(noisy, segments, BASE);
    expect(Object.keys(r.overrides).length).toBeGreaterThan(0);
    for (const v of Object.values(r.overrides)) expect(Number.isFinite(v)).toBe(true);
  });

  it("区間の中のサンプルが足りない（静止の区間にサンプルが無い）なら静止の項目は入れない", () => {
    const { samples, segments } = session();
    const r = calibrateParams(
      samples,
      segments.map((s) => (s.kind === "standing" ? { ...s, startMs: 1e9, endMs: 1e9 + 3000 } : s)),
      BASE,
    );
    expect(r.overrides).not.toHaveProperty("zuptAccel");
    expect(r.measurements.restNoiseAccel).toBeNull();
  });
});

describe("calibrateParams（立って静止 → zuptAccel・zuptGyroDps）", () => {
  it("静止の揺れ R（250 ms 窓の RMS の中央値）を測る", () => {
    const r = calibrate({ standRms: 0.3 });
    expect(r.measurements.restNoiseAccel).toBeCloseTo(0.3, 1);
  });

  it.each([
    // [R, zuptAccel の期待]: min(1.0, max(base 0.35, 2R))
    [0.1, 0.35],
    [0.3, 0.6],
    [0.45, 0.9],
    [0.6, 1.0],
    [0.9, 1.0],
  ])("R = %s なら zuptAccel = min(1.0, max(base, 2R))", (rms, _expected) => {
    const r = calibrate({ standRms: rms });
    const R = r.measurements.restNoiseAccel;
    expect(R).not.toBeNull();
    expect(r.overrides.zuptAccel).toBeCloseTo(Math.min(1.0, Math.max(0.35, 2 * (R ?? 0))), 2);
  });

  it("zuptAccel は base より下げず，1.0 を超えない", () => {
    expect(calibrate({ standRms: 0.05 }).overrides.zuptAccel).toBeCloseTo(0.35, 3);
    expect(calibrate({ standRms: 0.8 }).overrides.zuptAccel).toBeCloseTo(1.0, 3);
  });

  it("R が 1.0 を超えたら（静止していない）静止の項目を入れない", () => {
    const r = calibrate({ standRms: 1.1 });
    expect(r.measurements.restNoiseAccel).toBeNull();
    expect(r.overrides).not.toHaveProperty("zuptAccel");
    expect(r.overrides).not.toHaveProperty("zuptGyroDps");
    // 他の区間は使う
    expect(r.overrides).toHaveProperty("stepHighStanding");
  });

  it.each([
    // [角速度, zuptGyroDps]: min(45, max(base 25, 3 × 中央値))
    [5, 25],
    [10, 30],
    [12, 36],
    [20, 45],
  ])("静止の角速度 %s deg/s なら zuptGyroDps = %s", (gyro, expected) => {
    const r = calibrate({ standGyro: gyro });
    expect(r.measurements.restGyroDps).toBeCloseTo(gyro, 6);
    expect(r.overrides.zuptGyroDps).toBeCloseTo(expected, 3);
  });
});

describe("calibrateParams（立って足踏み → stepHighStanding・stepLowStanding）", () => {
  it("帯域通過後の山の中央値 P を測る（2 Hz・振幅 3 の足踏みで 3 前後．山は 3 個以上）", () => {
    const r = calibrate({ stepAmp: 3 });
    expect(r.measurements.stepPeakStanding).toBeGreaterThan(2.4);
    expect(r.measurements.stepPeakStanding).toBeLessThan(3.1);
    expect(r.measurements.stepCountStanding).toBeGreaterThanOrEqual(8);
    // 2 Hz なので山の間隔は 500 ms 前後
    expect(r.measurements.stepIntervalMs).toBeGreaterThan(450);
    expect(r.measurements.stepIntervalMs).toBeLessThan(550);
  });

  it.each([
    ["0.6P が base 未満なら base", 1],
    ["0.6P が base と 2.5 の間ならそのまま", 3],
    ["0.6P が 2.5 を超えたら 2.5", 6],
  ])("%s（振幅 %s）", (_name, amp) => {
    const r = calibrate({ stepAmp: amp });
    const p = r.measurements.stepPeakStanding;
    expect(p).not.toBeNull();
    const high = Math.min(2.5, Math.max(1.0, 0.6 * (p ?? 0)));
    expect(r.overrides.stepHighStanding).toBeCloseTo(high, 2);
    // T_low は base の比（0.3 / 1.0）のまま同じ倍率
    expect(r.overrides.stepLowStanding).toBeCloseTo(0.3 * (high / 1.0), 2);
  });

  it("山の境目の例: 振幅 1 では base（1.0），振幅 6 では上限（2.5）", () => {
    expect(calibrate({ stepAmp: 1 }).overrides.stepHighStanding).toBeCloseTo(1.0, 3);
    const big = calibrate({ stepAmp: 6 });
    expect(big.overrides.stepHighStanding).toBeCloseTo(2.5, 3);
    expect(big.overrides.stepLowStanding).toBeCloseTo(0.75, 3);
  });

  it("山が 3 個未満（足踏みが 1 秒）なら入れない", () => {
    const r = calibrate({ stepMs: 1000 });
    expect(r.measurements.stepCountStanding).toBeLessThan(3);
    expect(r.measurements.stepPeakStanding).toBeNull();
    expect(r.overrides).not.toHaveProperty("stepHighStanding");
    expect(r.overrides).not.toHaveProperty("stepLowStanding");
  });

  it("山が小さすぎる（帯域通過後 0.4 未満）なら山として数えず入れない", () => {
    const r = calibrate({ stepAmp: 0.3 });
    expect(r.measurements.stepPeakStanding).toBeNull();
    expect(r.overrides).not.toHaveProperty("stepHighStanding");
  });

  it("山の中央値が範囲外（15 m/s^2 を超える）なら入れない", () => {
    const r = calibrate({ stepAmp: 20 });
    expect(r.measurements.stepPeakStanding).toBeNull();
    expect(r.overrides).not.toHaveProperty("stepHighStanding");
  });
});

describe("calibrateParams（しゃがむ → crouchDepthM・postureMaxIntegrateMs）", () => {
  it("最初のしゃがむ動作の深さ D と時間を測る（0.3 m を 0.7 秒）", () => {
    const r = calibrate({ crouchDepth: 0.3, crouchSec: 0.7 });
    expect(r.measurements.crouchDepth).toBeGreaterThan(0.25);
    expect(r.measurements.crouchDepth).toBeLessThanOrEqual(0.31);
    expect(r.measurements.crouchDurationMs).toBeGreaterThan(500);
    expect(r.measurements.crouchDurationMs).toBeLessThanOrEqual(720);
  });

  it.each([
    ["D が 0.25 未満なら 0.25", 0.18, 0.5],
    ["D が 0.25 と base の間ならそのまま", 0.3, 0.7],
    ["D が base を超えたら base（深くしない）", 1.0, 0.8],
  ])("crouchDepthM = clamp(D, 0.25, base): %s", (_name, depth, sec) => {
    const r = calibrate({ crouchDepth: depth, crouchSec: sec });
    const d = r.measurements.crouchDepth;
    expect(d).not.toBeNull();
    expect(r.overrides.crouchDepthM).toBeCloseTo(Math.min(0.4, Math.max(0.25, d ?? 0)), 2);
  });

  it("深さの境目の例: 0.18 m なら 0.25，1.0 m なら base（0.4）", () => {
    expect(calibrate({ crouchDepth: 0.18, crouchSec: 0.5 }).overrides.crouchDepthM).toBeCloseTo(
      0.25,
      3,
    );
    expect(calibrate({ crouchDepth: 1.0, crouchSec: 0.8 }).overrides.crouchDepthM).toBeCloseTo(
      0.4,
      3,
    );
  });

  it.each([
    ["1.5 × 時間が base 未満なら base", 0.3, 0.7],
    ["1.5 × 時間が base と 3000 の間ならそのまま", 1.0, 2.4],
  ])("postureMaxIntegrateMs = min(3000, max(base, 1.5 × 時間)): %s", (_name, depth, sec) => {
    const r = calibrate({ crouchDepth: depth, crouchSec: sec });
    const ms = r.measurements.crouchDurationMs;
    expect(ms).not.toBeNull();
    expect(r.overrides.postureMaxIntegrateMs).toBeCloseTo(
      Math.min(3000, Math.max(1500, 1.5 * (ms ?? 0))),
      0,
    );
  });

  it("時間の上限の例: 0.9 m/s^2 で 1.125 秒沈んで 1.125 秒止まる（深さ約 1.14 m・2.25 秒）と 3000", () => {
    // 正弦の加速度では候補のしきい値（0.8 m/s^2）を超えるまでの分だけ測る時間が短くなるため，
    // 始めから一定の加速度で沈む（止まる）形にする
    const { samples, segments } = session({ crouchDepth: 0, crouchSec: 2.25 });
    const crouchSeg = segments.find((x) => x.kind === "crouching");
    const start = (crouchSeg?.startMs ?? 0) + 500;
    const bang = (t: number) => (t < 0 || t > 2.25 ? 0 : t < 1.125 ? -0.9 : 0.9);
    const shaped = samples.map((x) =>
      x.t >= start && x.t < start + 3000 ? verticalSample(x.t, bang((x.t - start) / 1000)) : x,
    );
    const r = calibrateParams(shaped, segments, BASE);
    expect(r.measurements.crouchDurationMs).toBeGreaterThan(2000);
    expect(r.overrides.postureMaxIntegrateMs).toBe(3000);
  });

  it.each([
    ["浅すぎる（0.05 m）", 0.05, 0.4],
    ["深すぎる（1.5 m．1.2 m を超える）", 1.5, 1.0],
    ["速すぎる（0.2 m を 0.18 秒．200 ms 未満）", 0.2, 0.18],
    ["遅すぎる（2.5 m を 4 秒．3000 ms を超える）", 2.5, 4],
  ])("しゃがむ動作が範囲外（%s）なら入れない", (_name, depth, sec) => {
    const r = calibrate({ crouchDepth: depth, crouchSec: sec });
    expect(r.measurements.crouchDepth).toBeNull();
    expect(r.overrides).not.toHaveProperty("crouchDepthM");
    expect(r.overrides).not.toHaveProperty("postureMaxIntegrateMs");
  });

  it("しゃがむ前の浅いぐらつき（0.15 m 未満）は飛ばし，その後の最初のしゃがむ動作を使う", () => {
    const { samples, segments } = session({ crouchDepth: 0.3, crouchSec: 0.7 });
    // しゃがむ区間の始まりの 0.5 秒（立って待つ）に，0.06 m の小さなぐらつきを入れる
    const crouchSeg = segments.find((s) => s.kind === "crouching");
    expect(crouchSeg).toBeDefined();
    const start = crouchSeg?.startMs ?? 0;
    const wobble = crouchAccel(0.06, 0.3);
    const withWobble = samples.map((s) =>
      s.t >= start && s.t < start + 400 ? verticalSample(s.t, wobble((s.t - start) / 1000)) : s,
    );
    const r = calibrateParams(withWobble, segments, BASE);
    expect(r.measurements.crouchDepth).toBeGreaterThan(0.25);
  });
});

describe("calibrateParams（しゃがみ歩き → stepHighCrouching・stepLowCrouching）", () => {
  it.each([
    ["0.6Pc が base 未満なら base", 0.8],
    ["0.6Pc が base と 5 の間ならそのまま", 8],
    ["0.6Pc が 5 を超えたら 5", 12],
  ])("stepHighCrouching = clamp(0.6Pc, base, 5): %s（振幅 %s）", (_name, amp) => {
    const r = calibrate({ crouchWalkAmp: amp });
    const pc = r.measurements.stepPeakCrouching;
    expect(pc).not.toBeNull();
    const high = Math.min(5, Math.max(0.6, 0.6 * (pc ?? 0)));
    expect(r.overrides.stepHighCrouching).toBeCloseTo(high, 2);
    expect(r.overrides.stepLowCrouching).toBeCloseTo(0.2 * (high / 0.6), 2);
    expect(r.measurements.crouchingEstimated).toBe(false);
  });

  it("上限の例: 振幅 12 では 5", () => {
    expect(calibrate({ crouchWalkAmp: 12 }).overrides.stepHighCrouching).toBeCloseTo(5, 3);
  });

  it.each([
    ["区間が無い", { omit: ["crouchWalking"] } as Partial<SessionOptions>],
    ["時間切れ", { outcomes: { crouchWalking: "timeout" } } as Partial<SessionOptions>],
    ["飛ばした", { outcomes: { crouchWalking: "skipped" } } as Partial<SessionOptions>],
    ["山が 3 個未満", { crouchWalkMs: 1000 } as Partial<SessionOptions>],
  ])("%s なら，立った足踏みの倍率から見積もる（crouchingEstimated）", (_name, over) => {
    const r = calibrate({ stepAmp: 3, ...over });
    expect(r.measurements.crouchingEstimated).toBe(true);
    const high = r.overrides.stepHighStanding ?? Number.NaN;
    const scale = high / 1.0;
    expect(scale).toBeGreaterThan(1);
    expect(r.overrides.stepHighCrouching).toBeCloseTo(0.6 * scale, 2);
    expect(r.overrides.stepLowCrouching).toBeCloseTo(0.2 * scale, 2);
    // 見積もりの時は，しゃがみ歩きから立つ判定を有効にしない
    expect(r.overrides).not.toHaveProperty("standWalkPeakStanding");
    expect(r.overrides).not.toHaveProperty("standWalkPeakCrouching");
  });

  it("立った足踏みも測れなければ，しゃがみ歩きの項目は入れない（見積もらない）", () => {
    const r = calibrate({ stepMs: 1000, omit: ["crouchWalking"] });
    expect(r.overrides).not.toHaveProperty("stepHighCrouching");
    expect(r.overrides).not.toHaveProperty("stepLowCrouching");
    expect(r.measurements.crouchingEstimated).toBe(false);
  });
});

describe("calibrateParams（しゃがみ歩きから立つ判定 standWalkPeak*）", () => {
  it("P と Pc が測れて比が 2 以上（Pc > Ps）なら，2 つの山の大きさを上書きに入れる", () => {
    const r = calibrate({ stepAmp: 3, crouchWalkAmp: 8 });
    const ps = r.measurements.stepPeakStanding ?? Number.NaN;
    const pc = r.measurements.stepPeakCrouching ?? Number.NaN;
    expect(pc / ps).toBeGreaterThanOrEqual(2);
    expect(r.overrides.standWalkPeakStanding).toBeCloseTo(ps, 2);
    expect(r.overrides.standWalkPeakCrouching).toBeCloseTo(pc, 2);
  });

  it("比が 2 以上（Pc < Ps）でも入れる", () => {
    const r = calibrate({ stepAmp: 6, crouchWalkAmp: 2 });
    const ps = r.measurements.stepPeakStanding ?? Number.NaN;
    const pc = r.measurements.stepPeakCrouching ?? Number.NaN;
    expect(ps / pc).toBeGreaterThanOrEqual(2);
    expect(r.overrides.standWalkPeakStanding).toBeCloseTo(ps, 2);
    expect(r.overrides.standWalkPeakCrouching).toBeCloseTo(pc, 2);
  });

  it("比が 2 未満なら入れない", () => {
    const r = calibrate({ stepAmp: 3, crouchWalkAmp: 5 });
    const ps = r.measurements.stepPeakStanding ?? Number.NaN;
    const pc = r.measurements.stepPeakCrouching ?? Number.NaN;
    expect(pc / ps).toBeLessThan(2);
    expect(r.overrides).not.toHaveProperty("standWalkPeakStanding");
    expect(r.overrides).not.toHaveProperty("standWalkPeakCrouching");
    // 他のしゃがみ歩きの項目は入る
    expect(r.overrides).toHaveProperty("stepHighCrouching");
  });

  it("立った足踏みが測れなければ入れない", () => {
    const r = calibrate({ stepMs: 1000 });
    expect(r.overrides).not.toHaveProperty("standWalkPeakStanding");
    expect(r.overrides).not.toHaveProperty("standWalkPeakCrouching");
  });

  it("base.standWalkSteps が 0（無効）なら入れない", () => {
    const r = calibrate({}, testParams({ ...BASE, standWalkSteps: 0 }));
    expect(r.overrides).not.toHaveProperty("standWalkPeakStanding");
    expect(r.overrides).not.toHaveProperty("standWalkPeakCrouching");
  });
});

describe("calibrateParams（既定より悪くしない）", () => {
  it.each([
    ["静かで小さい人", { standRms: 0.05, standGyro: 2, stepAmp: 0.8, crouchWalkAmp: 0.8 }],
    ["揺れて大きい人", { standRms: 0.9, standGyro: 30, stepAmp: 8, crouchWalkAmp: 14 }],
    ["深く遅い人", { crouchDepth: 1.0, crouchSec: 2.4 }],
  ] as [string, Partial<SessionOptions>][])(
    "%s: zuptAccel・zuptGyroDps・stepHigh*・postureMaxIntegrateMs は base 以上，crouchDepthM は base 以下",
    (_name, over) => {
      const o = calibrate(over).overrides;
      if (o.zuptAccel !== undefined) expect(o.zuptAccel).toBeGreaterThanOrEqual(BASE.zuptAccel);
      if (o.zuptGyroDps !== undefined)
        expect(o.zuptGyroDps).toBeGreaterThanOrEqual(BASE.zuptGyroDps);
      if (o.stepHighStanding !== undefined)
        expect(o.stepHighStanding).toBeGreaterThanOrEqual(BASE.stepHighStanding);
      if (o.stepHighCrouching !== undefined)
        expect(o.stepHighCrouching).toBeGreaterThanOrEqual(BASE.stepHighCrouching);
      if (o.postureMaxIntegrateMs !== undefined)
        expect(o.postureMaxIntegrateMs).toBeGreaterThanOrEqual(BASE.postureMaxIntegrateMs);
      if (o.crouchDepthM !== undefined)
        expect(o.crouchDepthM).toBeLessThanOrEqual(BASE.crouchDepthM);
    },
  );

  it("base を省くと DEFAULT_INPUT_PARAMS を基準にする（例外を投げない）", () => {
    const { samples, segments } = session();
    const r = calibrateParams(samples, segments);
    expect(Object.keys(r.overrides).length).toBeGreaterThan(0);
  });
});
