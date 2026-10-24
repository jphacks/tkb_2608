import { describe, expect, it } from "vitest";
import type { CalibrationProfile } from "../core/types";
import {
  DEFAULT_INPUT_PARAMS,
  INPUT_PARAM_KEYS,
  mergeParams,
  paramsFromCalibration,
  paramsFromSearch,
} from "./params";
import { TEST_PARAMS } from "./testFixtures";

function calib(over: Partial<CalibrationProfile>): CalibrationProfile {
  return {
    createdAt: 0,
    yawOffset: 0,
    stepPeakThreshold: Number.NaN,
    standingBaseline: 0,
    crouchThreshold: Number.NaN,
    ...over,
  };
}

describe("DEFAULT_INPUT_PARAMS・INPUT_PARAM_KEYS", () => {
  it("既定値はすべて有限の正の数（値そのものは調整中のため確かめない）", () => {
    for (const key of INPUT_PARAM_KEYS) {
      const v = DEFAULT_INPUT_PARAMS[key];
      expect(Number.isFinite(v), key).toBe(true);
      expect(v, key).toBeGreaterThan(0);
    }
  });

  it("項目名の一覧は InputParams の全項目と一致する", () => {
    expect([...INPUT_PARAM_KEYS].sort()).toEqual(Object.keys(TEST_PARAMS).sort());
    expect(new Set(INPUT_PARAM_KEYS).size).toBe(INPUT_PARAM_KEYS.length);
  });
});

describe("mergeParams", () => {
  it("上書きを重ね，元の値は書き換えない", () => {
    const base = { ...TEST_PARAMS };
    const p = mergeParams(base, { stepHighStanding: 2.5, headPredictionMs: 0 });
    expect(p.stepHighStanding).toBe(2.5);
    expect(p.headPredictionMs).toBe(0);
    expect(p.stepLowStanding).toBe(TEST_PARAMS.stepLowStanding);
    expect(base).toEqual(TEST_PARAMS);
  });

  it.each([null, undefined])("%s なら元のまま", (o) => {
    expect(mergeParams(TEST_PARAMS, o)).toEqual(TEST_PARAMS);
  });

  it.each<[string, unknown]>([
    ["NaN", Number.NaN],
    ["Infinity", Number.POSITIVE_INFINITY],
    ["-Infinity", Number.NEGATIVE_INFINITY],
    ["文字列", "1.5"],
    ["null", null],
    ["真偽値", true],
  ])("有限の数でない値（%s）は無視する", (_, v) => {
    expect(mergeParams(TEST_PARAMS, { stepHighStanding: v })).toEqual(TEST_PARAMS);
  });

  it("知らない項目は無視する", () => {
    const p = mergeParams(TEST_PARAMS, { unknownKey: 1, toString: 3, __proto__x: 2 });
    expect(p).toEqual(TEST_PARAMS);
    expect(Object.keys(p).sort()).toEqual(Object.keys(TEST_PARAMS).sort());
  });
});

describe("paramsFromCalibration", () => {
  it.each([null, undefined])("%s なら元のまま", (c) => {
    expect(paramsFromCalibration(TEST_PARAMS, c)).toEqual(TEST_PARAMS);
  });

  it("stepPeakThreshold を立ちの T_high にし，他の 3 つを同じ比で動かす", () => {
    const p = paramsFromCalibration(TEST_PARAMS, calib({ stepPeakThreshold: 2 }));
    const scale = 2 / TEST_PARAMS.stepHighStanding;
    expect(p.stepHighStanding).toBe(2);
    expect(p.stepLowStanding).toBeCloseTo(TEST_PARAMS.stepLowStanding * scale, 12);
    expect(p.stepHighCrouching).toBeCloseTo(TEST_PARAMS.stepHighCrouching * scale, 12);
    expect(p.stepLowCrouching).toBeCloseTo(TEST_PARAMS.stepLowCrouching * scale, 12);
    expect(p.crouchDepthM).toBe(TEST_PARAMS.crouchDepthM);
  });

  it.each([0.2, 10])("stepPeakThreshold の範囲の端（%s）は使う", (v) => {
    expect(
      paramsFromCalibration(TEST_PARAMS, calib({ stepPeakThreshold: v })).stepHighStanding,
    ).toBe(v);
  });

  it.each([0.19, 10.01, 0, -1, Number.NaN, Number.POSITIVE_INFINITY])(
    "stepPeakThreshold が範囲外・非有限（%s）なら既定のまま",
    (v) => {
      expect(paramsFromCalibration(TEST_PARAMS, calib({ stepPeakThreshold: v }))).toEqual(
        TEST_PARAMS,
      );
    },
  );

  it.each([0.1, 0.35, 1.0])("crouchThreshold が 0.1〜1.0（%s）ならしゃがみの深さにする", (v) => {
    const p = paramsFromCalibration(TEST_PARAMS, calib({ crouchThreshold: v }));
    expect(p.crouchDepthM).toBe(v);
    expect(p.stepHighStanding).toBe(TEST_PARAMS.stepHighStanding);
  });

  it.each([0.09, 1.01, Number.NaN])("crouchThreshold が範囲外（%s）なら既定のまま", (v) => {
    expect(paramsFromCalibration(TEST_PARAMS, calib({ crouchThreshold: v }))).toEqual(TEST_PARAMS);
  });

  it("null の項目（型を外れた値）が来ても例外を投げず既定のまま", () => {
    const c = {
      ...calib({}),
      stepPeakThreshold: null,
      crouchThreshold: null,
    } as unknown as CalibrationProfile;
    expect(paramsFromCalibration(TEST_PARAMS, c)).toEqual(TEST_PARAMS);
  });
});

describe("paramsFromSearch", () => {
  it("知っている項目の数だけを読む", () => {
    expect(
      paramsFromSearch("?stepHighStanding=1.5&headPredictionMs=20&foo=3&strideM=abc&maxWalkSpeed="),
    ).toEqual({ stepHighStanding: 1.5, headPredictionMs: 20 });
  });

  it("指数表記・負の数も数として読む（範囲の検査はしない）", () => {
    expect(paramsFromSearch("strideM=5e-1&speedMaxDecel=-2")).toEqual({
      strideM: 0.5,
      speedMaxDecel: -2,
    });
  });

  it.each(["", "?", "?stepHighStanding=Infinity", "?stepHighStanding=%20"])("%s は空", (s) => {
    expect(paramsFromSearch(s)).toEqual({});
  });

  it("mergeParams と組み合わせて上書きできる", () => {
    const p = mergeParams(TEST_PARAMS, paramsFromSearch("?zuptMs=200"));
    expect(p.zuptMs).toBe(200);
  });
});
