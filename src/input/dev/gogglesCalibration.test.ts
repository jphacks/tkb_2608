// ゴーグルでの確認ページのキャリブレーションの設定・しきい値の重ね方（gogglesCalibration.ts）を確かめる（Issue #94）
import { describe, expect, it } from "vitest";
import { DEFAULT_INPUT_PARAMS, type InputParamKey } from "../params";
import { DEFAULT_CALIBRATION_LENGTHS } from "../replay/calibrationReplay";
import {
  CALIBRATION_STEP_TEXT,
  calibratedOverrides,
  calibrationProtocolSteps,
  DEFAULT_CALIBRATION_FINISH_MS,
  DEFAULT_CALIBRATION_PREP_MS,
  DEFAULT_CALIBRATION_START_DELAY_MS,
  describeCalibratedParams,
  gogglesCalibrationFromSearch,
  isCalibrationKind,
} from "./gogglesCalibration";

describe("gogglesCalibrationFromSearch", () => {
  it("指定が無ければ既定（する・待ち 10 秒・準備 3 秒・終わり 3 秒・区間は 3/5/3/4 秒）", () => {
    expect(gogglesCalibrationFromSearch("")).toEqual({
      enabled: true,
      startDelayMs: 10000,
      prepMs: DEFAULT_CALIBRATION_PREP_MS,
      finishMs: DEFAULT_CALIBRATION_FINISH_MS,
      lengths: DEFAULT_CALIBRATION_LENGTHS,
    });
    expect(DEFAULT_CALIBRATION_START_DELAY_MS).toBe(10000);
  });

  it.each([
    ["?calib=0", false],
    ["?calib=1", true],
    ["?calib=", true],
    ["?calib=false", true],
  ])("%s なら enabled = %s（0 の時だけしない）", (search, enabled) => {
    expect(gogglesCalibrationFromSearch(search).enabled).toBe(enabled);
  });

  it("区間の長さ・待ち・準備・終わりの時間を読み，四捨五入する", () => {
    const o = gogglesCalibrationFromSearch(
      "?calibStandMs=1000&calibStepMs=6000.4&calibCrouchMs=2500&calibCrouchWalkMs=8000.5&calibPrepMs=1500&calibFinishMs=2000&calibStartDelayMs=5000.6",
    );
    expect(o.lengths).toEqual({
      standingMs: 1000,
      steppingMs: 6000,
      crouchingMs: 2500,
      crouchWalkingMs: 8001,
    });
    expect(o.prepMs).toBe(1500);
    expect(o.finishMs).toBe(2000);
    expect(o.startDelayMs).toBe(5001);
  });

  it.each([
    ["0（待たない）", "0", 0],
    ["上限の 60000", "60000", 60000],
    ["上限を超える", "60001", DEFAULT_CALIBRATION_START_DELAY_MS],
    ["負", "-1", DEFAULT_CALIBRATION_START_DELAY_MS],
    ["数でない", "abc", DEFAULT_CALIBRATION_START_DELAY_MS],
    ["空", "", DEFAULT_CALIBRATION_START_DELAY_MS],
    ["空白", "%20", DEFAULT_CALIBRATION_START_DELAY_MS],
    ["NaN", "NaN", DEFAULT_CALIBRATION_START_DELAY_MS],
    ["Infinity", "Infinity", DEFAULT_CALIBRATION_START_DELAY_MS],
    ["小数", "0.4", 0],
  ])("calibStartDelayMs が %s なら %s", (_name, raw, expected) => {
    expect(gogglesCalibrationFromSearch(`?calibStartDelayMs=${raw}`).startDelayMs).toBe(expected);
  });

  it.each([
    ["calibPrepMs", "prepMs", DEFAULT_CALIBRATION_PREP_MS],
    ["calibFinishMs", "finishMs", DEFAULT_CALIBRATION_FINISH_MS],
  ] as const)("%s は 0 を受け付け，範囲外・不正は既定値", (key, field, def) => {
    expect(gogglesCalibrationFromSearch(`?${key}=0`)[field]).toBe(0);
    expect(gogglesCalibrationFromSearch(`?${key}=60000`)[field]).toBe(60000);
    expect(gogglesCalibrationFromSearch(`?${key}=60001`)[field]).toBe(def);
    expect(gogglesCalibrationFromSearch(`?${key}=-5`)[field]).toBe(def);
    expect(gogglesCalibrationFromSearch(`?${key}=x`)[field]).toBe(def);
  });

  it.each([
    ["calibStandMs", "standingMs"],
    ["calibStepMs", "steppingMs"],
    ["calibCrouchMs", "crouchingMs"],
    ["calibCrouchWalkMs", "crouchWalkingMs"],
  ] as const)("区間の長さ %s は 0 を受け付けず（既定値），60000 まで", (key, field) => {
    const def = DEFAULT_CALIBRATION_LENGTHS[field];
    expect(gogglesCalibrationFromSearch(`?${key}=0`).lengths[field]).toBe(def);
    expect(gogglesCalibrationFromSearch(`?${key}=60000`).lengths[field]).toBe(60000);
    expect(gogglesCalibrationFromSearch(`?${key}=60001`).lengths[field]).toBe(def);
    expect(gogglesCalibrationFromSearch(`?${key}=-1`).lengths[field]).toBe(def);
    expect(gogglesCalibrationFromSearch(`?${key}=NaN`).lengths[field]).toBe(def);
  });
});

describe("calibratedOverrides", () => {
  it("キャリブレーションの値に URL のしきい値を重ね，同じ項目は URL を優先する", () => {
    expect(
      calibratedOverrides(
        { stepHighStanding: 1.5, crouchDepthM: 0.3 },
        { stepHighStanding: 2, zuptMs: 100 },
      ),
    ).toEqual({ stepHighStanding: 2, crouchDepthM: 0.3, zuptMs: 100 });
  });

  it("片方が空ならもう片方のまま", () => {
    expect(calibratedOverrides({}, { zuptMs: 1 })).toEqual({ zuptMs: 1 });
    expect(calibratedOverrides({ zuptMs: 1 }, {})).toEqual({ zuptMs: 1 });
    expect(calibratedOverrides({}, {})).toEqual({});
  });

  it("引数を書き換えない", () => {
    const c = { zuptMs: 1 };
    const u = { zuptMs: 2 };
    calibratedOverrides(c, u);
    expect(c).toEqual({ zuptMs: 1 });
    expect(u).toEqual({ zuptMs: 2 });
  });
});

describe("calibrationProtocolSteps・isCalibrationKind", () => {
  it("立って静止 → 足踏み → しゃがむ → しゃがみ歩きの順で，長さは秒", () => {
    const steps = calibrationProtocolSteps({
      standingMs: 3000,
      steppingMs: 5000,
      crouchingMs: 2500,
      crouchWalkingMs: 8000,
    });
    expect(steps.map((s) => [s.label, s.durationSec])).toEqual([
      ["standing", 3],
      ["stepping", 5],
      ["crouching", 2.5],
      ["crouchWalking", 8],
    ]);
    expect(steps[0].title).toBe(CALIBRATION_STEP_TEXT.standing.title);
  });

  it.each([
    ["standing", true],
    ["crouchWalking", true],
    ["still", false],
    ["toString", false],
    ["", false],
  ])("%s は区間の種類か = %s", (label, expected) => {
    expect(isCalibrationKind(label)).toBe(expected);
  });
});

describe("describeCalibratedParams", () => {
  const params: Readonly<Record<InputParamKey, number>> = DEFAULT_INPUT_PARAMS;

  it("既定のしきい値では境目は -（しゃがみ歩きから立つ判定は無効）", () => {
    expect(describeCalibratedParams(params, null)).toContain("境 -");
  });

  it("境目は 2 つの山の幾何平均で，キャリブレーションで求めた項目に * を付ける", () => {
    const p = { ...params, standWalkPeakStanding: 1, standWalkPeakCrouching: 4 };
    const text = describeCalibratedParams(p, {
      overrides: { standWalkPeakStanding: 1, standWalkPeakCrouching: 4, stepHighStanding: 1.2 },
      measurements: {
        restNoiseAccel: null,
        restNoiseBand: null,
        restGyroDps: null,
        stepPeakStanding: 1,
        stepCountStanding: 5,
        stepIntervalMs: null,
        crouchDepth: null,
        crouchDurationMs: null,
        crouchHoldNoiseAccel: null,
        stepPeakCrouching: 4,
        stepCountCrouching: 5,
        crouchingEstimated: false,
      },
      notes: [],
    });
    expect(text).toContain("境* 2.00");
    expect(text).toContain("T立*");
    expect(text).not.toContain("深*");
  });
});
