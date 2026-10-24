import { describe, expect, it } from "vitest";
import type { CalibrationProfile } from "../core/types";
import { DEFAULT_INPUT_PARAMS, paramsFromCalibration } from "../input/params";
import { yawOnly } from "./yawOnlyCalibration";

const profile = (overrides: Partial<CalibrationProfile> = {}): CalibrationProfile => ({
  createdAt: 1000,
  yawOffset: 0.5,
  stepPeakThreshold: 2.0,
  standingBaseline: 9.8,
  crouchThreshold: 0.8,
  ...overrides,
});

describe("yawOnly", () => {
  it("正面（yawOffset）と他の項目はそのまま残す", () => {
    const result = yawOnly(profile());
    expect(result.yawOffset).toBe(0.5);
    expect(result.createdAt).toBe(1000);
    expect(result.standingBaseline).toBe(9.8);
  });

  it.each([
    ["測った値が入力の範囲内", profile({ stepPeakThreshold: 2.0, crouchThreshold: 0.8 })],
    ["時間切れの既定値", profile({ stepPeakThreshold: 2.0, crouchThreshold: 1.5 })],
    ["範囲の下限に近い値", profile({ stepPeakThreshold: 0.8, crouchThreshold: 0.5 })],
  ])("%s でも，入力のしきい値は既定のまま", (_label, calibration) => {
    expect(paramsFromCalibration(DEFAULT_INPUT_PARAMS, yawOnly(calibration))).toEqual(
      DEFAULT_INPUT_PARAMS,
    );
  });

  it("元の CalibrationProfile は書き換えない", () => {
    const original = profile();
    yawOnly(original);
    expect(original.stepPeakThreshold).toBe(2.0);
    expect(original.crouchThreshold).toBe(0.8);
  });
});

describe("yawOnly（区間）", () => {
  const segments = [
    { kind: "standing", startMs: 1000, endMs: 4000, outcome: "completed" },
    { kind: "stepping", startMs: 4000, endMs: 9000, outcome: "timeout" },
  ] as const;

  it("区間（segments）と正面（yawOffset）を残し，足踏み・しゃがみのしきい値を無効（NaN）にする", () => {
    const result = yawOnly(profile({ segments }));
    expect(result.segments).toEqual(segments);
    expect(result.yawOffset).toBe(0.5);
    expect(Number.isNaN(result.stepPeakThreshold)).toBe(true);
    expect(Number.isNaN(result.crouchThreshold)).toBe(true);
  });

  it("区間が無い（省略）時は省略のまま", () => {
    const result = yawOnly(profile());
    expect(result.segments).toBeUndefined();
  });

  it("区間があっても入力のしきい値は既定のまま", () => {
    expect(paramsFromCalibration(DEFAULT_INPUT_PARAMS, yawOnly(profile({ segments })))).toEqual(
      DEFAULT_INPUT_PARAMS,
    );
  });
});
