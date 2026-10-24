import { describe, expect, it } from "vitest";
import { DeviceTracker } from "../deviceTracker";
import { INPUT_PARAM_KEYS } from "../params";
import type { InputRecord, StateRecord } from "../recorder/records";
import { samplesOf, TEST_PARAMS } from "../testFixtures";
import { DetectLogger, paramsRecord } from "./detectLog";

describe("paramsRecord", () => {
  it("しきい値の全項目を記録する", () => {
    const r = paramsRecord(12.34567, TEST_PARAMS);
    expect(r).toMatchObject({ type: "params", t: 12.346 });
    if (r.type !== "params") throw new Error("type");
    expect(Object.keys(r.params).sort()).toEqual([...INPUT_PARAM_KEYS].sort());
    expect(r.params.stepHighStanding).toBe(TEST_PARAMS.stepHighStanding);
  });
});

describe("DetectLogger", () => {
  it("サンプルごとに detect を記録し，歩・状態の変化を state として記録する", () => {
    const tracker = new DeviceTracker({ params: TEST_PARAMS });
    const records: InputRecord[] = [];
    const states: StateRecord[] = [];
    const logger = new DetectLogger(
      (r) => records.push(r),
      (r) => states.push(r),
    );
    const samples = [
      ...samplesOf(0, 1000, 16, () => 0),
      ...samplesOf(1000, 2000, 16, (t) => -3 * Math.cos(2 * Math.PI * 2 * t)),
    ];
    for (const s of samples) {
      tracker.onMotion(s);
      logger.onMotion(s.t, tracker);
    }
    expect(records.filter((r) => r.type === "detect")).toHaveLength(samples.length);
    const events = states.map((s) => s.event);
    expect(events).toContain("step");
    expect(events).toContain("locomotion");
    expect(states.some((s) => s.event === "locomotion" && s.walking)).toBe(true);
    // state は記録にも onState にも同じものが渡る
    expect(records.filter((r) => r.type === "state")).toEqual(states);
  });
});
