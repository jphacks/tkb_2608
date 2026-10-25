// ロビーの区間から判定のしきい値を求めてつなぐ部品（lobbyCalibrationParams.ts）のテスト．
// 基準は docs/04_SPEC/SPEC_01「キャリブレーションとの分担」（lobby/ は区間を渡し，しきい値は input/ の calibrateParams が求める）と
// Issue #111 の実装の方針（直近 180 秒・最大 36,000 件をためる／区間が前回と同じなら前回の結果を使い回す／
// 前回上書きしたが今回求められなかった項目は既定値に戻す）
import { describe, expect, it } from "vitest";
import type { CalibrationSegment } from "../core/types";
import { type CalibrationResult, calibrateParams } from "../input/body/calibration";
import { DEFAULT_INPUT_PARAMS, type InputParams } from "../input/params";
import type { MotionSample } from "../input/sensors/types";
import {
  type AppliedLobbyParams,
  createMotionSampleBuffer,
  describeLobbyParams,
  LOBBY_SAMPLE_MAX_COUNT,
  LOBBY_SAMPLE_WINDOW_MS,
  replacingOverrides,
  resolveLobbyParams,
  sameSegments,
} from "./lobbyCalibrationParams";

function motion(t: number, patch: Partial<MotionSample> = {}): MotionSample {
  return {
    t,
    acc: { x: 0, y: 0, z: 0 },
    accG: { x: 0, y: 9.8, z: 0 },
    rot: { alpha: 0, beta: 0, gamma: 0 },
    interval: 16,
    ...patch,
  };
}

function segment(patch: Partial<CalibrationSegment> = {}): CalibrationSegment {
  return { kind: "standing", startMs: 1000, endMs: 11000, outcome: "completed", ...patch };
}

function result(patch: Partial<CalibrationResult> = {}): CalibrationResult {
  return {
    overrides: {},
    measurements: {
      restNoiseAccel: null,
      restNoiseBand: null,
      restGyroDps: null,
      stepPeakStanding: null,
      stepCountStanding: 0,
      stepIntervalMs: null,
      crouchDepth: null,
      crouchDurationMs: null,
      crouchHoldNoiseAccel: null,
      stepPeakCrouching: null,
      stepCountCrouching: 0,
      crouchingEstimated: false,
    },
    notes: [],
    ...patch,
  };
}

describe("createMotionSampleBuffer", () => {
  it("既定は直近 180 秒・最大 36,000 件", () => {
    expect(LOBBY_SAMPLE_WINDOW_MS).toBe(180_000);
    expect(LOBBY_SAMPLE_MAX_COUNT).toBe(36_000);
  });

  it("入れた順（古い順）に返す", () => {
    const b = createMotionSampleBuffer();
    for (const t of [1, 2, 3]) b.push(motion(t));
    expect(b.snapshot().map((s) => s.t)).toEqual([1, 2, 3]);
  });

  it("最後のサンプルから windowMs より古いものは捨てる（ちょうど windowMs 前は残す）", () => {
    const b = createMotionSampleBuffer(1000, 100);
    for (const t of [0, 500, 999, 1000, 1500]) b.push(motion(t));
    // 最後は 1500 → 500 より前（0）を捨てる．500 はちょうど 1000 ms 前なので残す
    expect(b.snapshot().map((s) => s.t)).toEqual([500, 999, 1000, 1500]);
  });

  it("数が maxCount を超えたら古いものから捨てる", () => {
    const b = createMotionSampleBuffer(1e9, 3);
    for (let t = 0; t < 10; t++) b.push(motion(t));
    expect(b.snapshot().map((s) => s.t)).toEqual([7, 8, 9]);
  });

  it("多く入れても（詰め直しを挟んでも）最後の maxCount 件が順に残る", () => {
    const b = createMotionSampleBuffer(1e9, 100);
    for (let t = 0; t < 20_000; t++) b.push(motion(t));
    const snap = b.snapshot();
    expect(snap.length).toBe(100);
    expect(snap[0]?.t).toBe(19_900);
    expect(snap[99]?.t).toBe(19_999);
  });

  it("200 Hz で 200 秒入れると，直近 180 秒分（36,000 件程度）だけ残る", () => {
    const b = createMotionSampleBuffer();
    for (let i = 0; i < 200 * 200; i++) b.push(motion(i * 5));
    const snap = b.snapshot();
    expect(snap.length).toBeLessThanOrEqual(LOBBY_SAMPLE_MAX_COUNT + 1);
    const last = snap[snap.length - 1]?.t ?? 0;
    expect(last - (snap[0]?.t ?? 0)).toBeLessThanOrEqual(LOBBY_SAMPLE_WINDOW_MS);
  });

  it.each([Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY])(
    "時刻が有限でない（%s）サンプルは入れない",
    (t) => {
      const b = createMotionSampleBuffer();
      b.push(motion(1));
      b.push(motion(t));
      b.push(motion(2));
      expect(b.snapshot().map((s) => s.t)).toEqual([1, 2]);
    },
  );

  it("clear で空になり，その後も使える", () => {
    const b = createMotionSampleBuffer();
    b.push(motion(1));
    b.clear();
    expect(b.snapshot()).toEqual([]);
    b.push(motion(5));
    expect(b.snapshot().map((s) => s.t)).toEqual([5]);
  });

  it("返した配列は後から入れたサンプルで変わらない", () => {
    const b = createMotionSampleBuffer();
    b.push(motion(1));
    const snap = b.snapshot();
    b.push(motion(2));
    expect(snap.map((s) => s.t)).toEqual([1]);
  });

  it("空なら空の配列", () => {
    expect(createMotionSampleBuffer().snapshot()).toEqual([]);
  });
});

describe("sameSegments", () => {
  it("空同士は同じ", () => {
    expect(sameSegments([], [])).toBe(true);
  });

  it("種類・時刻・結果がすべて同じなら（別の配列でも）同じ", () => {
    expect(
      sameSegments(
        [segment(), segment({ kind: "stepping" })],
        [segment(), segment({ kind: "stepping" })],
      ),
    ).toBe(true);
  });

  it("数が違えば違う", () => {
    expect(sameSegments([segment()], [])).toBe(false);
    expect(sameSegments([segment()], [segment(), segment()])).toBe(false);
  });

  it.each([
    ["kind", { kind: "crouching" }],
    ["startMs", { startMs: 1001 }],
    ["endMs", { endMs: 11001 }],
    ["outcome", { outcome: "skipped" }],
  ] as const)("%s が違えば違う", (_, patch) => {
    expect(sameSegments([segment()], [segment(patch)])).toBe(false);
  });

  it("並びが違えば違う", () => {
    const a = segment();
    const b = segment({ kind: "stepping" });
    expect(sameSegments([a, b], [b, a])).toBe(false);
  });
});

describe("resolveLobbyParams", () => {
  const samples = Array.from({ length: 50 }, (_, i) => motion(1000 + i * 20));
  const segments = [segment({ startMs: 1000, endMs: 2000 })];

  it("前回が無ければ input/ の calibrateParams で求める", () => {
    const r = resolveLobbyParams(samples, segments, null);
    expect(r.segments).toBe(segments);
    expect(r.result).toEqual(calibrateParams(samples, segments, DEFAULT_INPUT_PARAMS));
  });

  it("区間が前回と同じなら，サンプルが無くても前回の結果をそのまま返す（「同じ訓練をもう一度」）", () => {
    const previous: AppliedLobbyParams = {
      segments,
      result: result({ overrides: { stepHighStanding: 1.23 } }),
    };
    const r = resolveLobbyParams([], [segment({ startMs: 1000, endMs: 2000 })], previous);
    expect(r).toBe(previous);
  });

  it("区間が前回と違えば求め直す", () => {
    const previous: AppliedLobbyParams = {
      segments: [segment({ startMs: 0, endMs: 500 })],
      result: result({ overrides: { stepHighStanding: 1.23 } }),
    };
    const r = resolveLobbyParams(samples, segments, previous);
    expect(r).not.toBe(previous);
    expect(r.segments).toBe(segments);
    expect(r.result).toEqual(calibrateParams(samples, segments));
  });

  it("base を calibrateParams に渡す", () => {
    const base: InputParams = { ...DEFAULT_INPUT_PARAMS, stepHighStanding: 3 };
    const r = resolveLobbyParams(samples, segments, null, base);
    expect(r.result).toEqual(calibrateParams(samples, segments, base));
  });

  it("区間もサンプルも無くても落ちず，上書きは空", () => {
    const r = resolveLobbyParams([], [], null);
    expect(r.result.overrides).toEqual({});
  });
});

describe("replacingOverrides", () => {
  it("前回が無ければ今回の上書きのまま", () => {
    expect(replacingOverrides(null, { stepHighStanding: 1.2 })).toEqual({
      stepHighStanding: 1.2,
    });
  });

  it("前回上書きしたが今回求められなかった項目は既定値に戻す", () => {
    const out = replacingOverrides({ stepHighStanding: 1.2, zuptAccel: 0.8 }, { zuptAccel: 0.7 });
    expect(out).toEqual({
      stepHighStanding: DEFAULT_INPUT_PARAMS.stepHighStanding,
      zuptAccel: 0.7,
    });
  });

  it("今回が空なら，前回上書きした項目をすべて既定値に戻す", () => {
    expect(replacingOverrides({ stepHighStanding: 1.2 }, {})).toEqual({
      stepHighStanding: DEFAULT_INPUT_PARAMS.stepHighStanding,
    });
  });

  it("両方に無い項目は入れない", () => {
    expect(Object.keys(replacingOverrides({}, { zuptAccel: 0.7 }))).toEqual(["zuptAccel"]);
  });

  it("戻す値は base から取る", () => {
    const base: InputParams = { ...DEFAULT_INPUT_PARAMS, stepHighStanding: 5 };
    expect(replacingOverrides({ stepHighStanding: 1.2 }, {}, base)).toEqual({
      stepHighStanding: 5,
    });
  });

  it("渡した上書きを書き換えない", () => {
    const prev = Object.freeze({ stepHighStanding: 1.2 });
    const next = Object.freeze({ zuptAccel: 0.7 });
    expect(() => replacingOverrides(prev, next)).not.toThrow();
    expect(prev).toEqual({ stepHighStanding: 1.2 });
    expect(next).toEqual({ zuptAccel: 0.7 });
  });
});

describe("describeLobbyParams", () => {
  it("まだ反映していなければその旨を 1 行で出す", () => {
    const text = describeLobbyParams(null);
    expect(text).toContain("まだ");
    expect(text.split("\n").length).toBe(1);
  });

  it("使った区間（種類と結果）・上書きした項目と値（小数 2 桁）を出す", () => {
    const text = describeLobbyParams({
      segments: [segment(), segment({ kind: "stepping", outcome: "skipped" })],
      result: result({ overrides: { stepHighStanding: 1.234 } }),
    });
    expect(text).toContain("standing(completed)");
    expect(text).toContain("stepping(skipped)");
    expect(text).toContain("stepHighStanding=1.23");
  });

  it("上書きが無ければ「既定値のまま」と出す．区間が無ければ「-」", () => {
    const text = describeLobbyParams({ segments: [], result: result() });
    expect(text).toContain("既定値のまま");
    expect(text).toContain("segments -");
  });

  it("測れなかった値は「-」，notes は 1 行ずつ出す", () => {
    const text = describeLobbyParams({
      segments: [segment()],
      result: result({ notes: ["standing: サンプルが足りない", "stepping: 区間が無い"] }),
    });
    expect(text).toContain("rest -");
    const lines = text.split("\n");
    expect(lines).toContain("note: standing: サンプルが足りない");
    expect(lines).toContain("note: stepping: 区間が無い");
  });

  it("上書きの値が有限でなければ「-」", () => {
    const text = describeLobbyParams({
      segments: [],
      result: result({ overrides: { stepHighStanding: Number.NaN } }),
    });
    expect(text).toContain("stepHighStanding=-");
  });
});
