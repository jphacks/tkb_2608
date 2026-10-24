// dev 用の仮の避難の記録（sampleDrill.ts）のテスト．
// 基準は src/core/drill.ts の型の約束（samples は時刻の順・0.2 秒ごと（SPEC_01「結果の評価」）・区間は両端を含む添字・
// timeLimitSeconds は SchoolPlan.drill の写し・煙の中にいなかった時は割合と「できた」が null）と，Issue #91 のデモの値．
// 校舎は同梱のデモの校舎（src/share/samples/）を使う
import { describe, expect, it } from "vitest";
import type { DrillEvaluation, DrillInterval, DrillTrack } from "../core/drill";
import type { SchoolPlan } from "../core/schoolPlan";
import { DEMO_SCHOOL } from "../share/samples/demoSchool";
import {
  createSampleDrill,
  resolveSampleDrillVariant,
  SAMPLE_INTERVAL_SECONDS,
  type SampleDrillVariant,
} from "./sampleDrill";

const VARIANTS: readonly SampleDrillVariant[] = ["good", "late", "nosmoke"];

const cellOf = (plan: SchoolPlan, x: number, z: number): { x: number; z: number } => ({
  x: Math.floor(x / plan.cellSize),
  z: Math.floor(z / plan.cellSize),
});

const inAssembly = (plan: SchoolPlan, s: { floor: number; x: number; z: number }): boolean => {
  const c = cellOf(plan, s.x, s.z);
  return plan.drill.assembly.some((a) => a.floor === s.floor && a.x === c.x && a.z === c.z);
};

/** 型の約束を満たすかを確かめる */
function expectValidDrill(plan: SchoolPlan, track: DrillTrack, ev: DrillEvaluation): void {
  const { samples } = track;
  expect(samples.length).toBeGreaterThan(0);
  expect(samples[0].t).toBe(0);
  samples.forEach((s, i) => {
    expect(Number.isFinite(s.x) && Number.isFinite(s.z)).toBe(true);
    expect(Number.isInteger(s.floor) && s.floor >= 0 && s.floor < plan.floors.length).toBe(true);
    expect(["standing", "crouching"]).toContain(s.posture);
    if (i > 0) {
      // 時刻の順・0.2 秒ごと
      expect(s.t - samples[i - 1].t).toBeCloseTo(SAMPLE_INTERVAL_SECONDS, 6);
    }
  });
  const checkInterval = (iv: DrillInterval): void => {
    expect(Number.isInteger(iv.fromIndex) && Number.isInteger(iv.toIndex)).toBe(true);
    expect(iv.fromIndex).toBeGreaterThanOrEqual(0);
    expect(iv.toIndex).toBeLessThan(samples.length);
    expect(iv.fromIndex).toBeLessThanOrEqual(iv.toIndex);
    expect(iv.fromSeconds).toBe(samples[iv.fromIndex].t);
    expect(iv.toSeconds).toBe(samples[iv.toIndex].t);
  };
  ev.offRoute.forEach(checkInterval);
  ev.smokeStanding.forEach(checkInterval);
  // 区間どうしは重ならず時刻の順
  for (const list of [ev.offRoute, ev.smokeStanding]) {
    for (let i = 1; i < list.length; i++) {
      expect(list[i].fromIndex).toBeGreaterThan(list[i - 1].toIndex);
    }
  }
  // 煙の中で立っていた区間の記録は立っている
  for (const iv of ev.smokeStanding) {
    for (let i = iv.fromIndex; i <= iv.toIndex; i++) expect(samples[i].posture).toBe("standing");
  }
  for (const m of ev.nearFire) {
    expect(Number.isInteger(m.index) && m.index >= 0 && m.index < samples.length).toBe(true);
    const s = samples[m.index];
    expect({ t: m.t, floor: m.floor, x: m.x, z: m.z }).toEqual({
      t: s.t,
      floor: s.floor,
      x: s.x,
      z: s.z,
    });
  }
  expect(ev.timeLimitSeconds).toBe(plan.drill.timeLimitSeconds);
  expect(ev.lateEscape).toBe(ev.evacuationSeconds === null);
  if (ev.evacuationSeconds !== null) {
    expect(ev.evacuationSeconds).toBeGreaterThanOrEqual(0);
    expect(ev.evacuationSeconds).toBeLessThanOrEqual(ev.timeLimitSeconds);
  }
  expect(ev.smokeSeconds).toBeGreaterThanOrEqual(0);
  if (ev.smokeCrouchRatio === null) {
    expect(ev.smokePostureGood).toBeNull();
    expect(ev.smokeSeconds).toBe(0);
    expect(ev.smokeStanding).toEqual([]);
  } else {
    expect(ev.smokeCrouchRatio).toBeGreaterThanOrEqual(0);
    expect(ev.smokeCrouchRatio).toBeLessThanOrEqual(1);
    expect(typeof ev.smokePostureGood).toBe("boolean");
    expect(ev.smokeSeconds).toBeGreaterThan(0);
  }
}

describe("resolveSampleDrillVariant", () => {
  it.each([
    ["", "good"],
    ["?debrief", "good"],
    ["?debrief=1", "good"],
    ["?debrief=good", "good"],
    ["?debrief=late", "late"],
    ["?debrief=nosmoke", "nosmoke"],
    ["?scene=room&debrief=late", "late"],
    ["?debrief=unknown", "good"],
  ])("%j は %s", (search, variant) => {
    expect(resolveSampleDrillVariant(search)).toBe(variant);
  });
});

describe("createSampleDrill", () => {
  it.each(VARIANTS)("%s の記録と評価は型の約束を満たす", (variant) => {
    const { track, evaluation } = createSampleDrill(DEMO_SCHOOL, variant);
    expectValidDrill(DEMO_SCHOOL, track, evaluation);
  });

  it.each(VARIANTS)("%s は同じ校舎なら毎回同じ結果", (variant) => {
    expect(createSampleDrill(DEMO_SCHOOL, variant)).toEqual(
      createSampleDrill(DEMO_SCHOOL, variant),
    );
  });

  it("種類を省くと good", () => {
    expect(createSampleDrill(DEMO_SCHOOL)).toEqual(createSampleDrill(DEMO_SCHOOL, "good"));
  });

  it("記録は開始地点の中心から始まる", () => {
    const { track } = createSampleDrill(DEMO_SCHOOL);
    const { start } = DEMO_SCHOOL.drill;
    expect(track.samples[0]).toMatchObject({
      floor: start.floor,
      x: (start.x + 0.5) * DEMO_SCHOOL.cellSize,
      z: (start.z + 0.5) * DEMO_SCHOOL.cellSize,
    });
  });

  describe("good（着いた．煙の中の姿勢は「もう少し」）", () => {
    const { track, evaluation } = createSampleDrill(DEMO_SCHOOL, "good");

    it("Issue #91 のデモの値（141 記録・避難 27.6 秒・外れた区間 1 つ・火に近づいた点 1 つ・しゃがんでいた割合 4/9）", () => {
      expect(track.samples).toHaveLength(141);
      expect(evaluation.evacuationSeconds).toBeCloseTo(27.6, 6);
      expect(evaluation.lateEscape).toBe(false);
      expect(evaluation.offRoute).toHaveLength(1);
      expect(evaluation.nearFire).toHaveLength(1);
      expect(evaluation.smokeCrouchRatio).toBeCloseTo(4 / 9, 6);
      expect(evaluation.smokePostureGood).toBe(false);
    });

    it("避難時間は集合場所のマスに最初に入った記録の時刻", () => {
      const first = track.samples.find((s) => inAssembly(DEMO_SCHOOL, s));
      expect(first).toBeDefined();
      expect(evaluation.evacuationSeconds).toBe(first?.t);
    });

    it("最後の記録は集合場所の中", () => {
      expect(inAssembly(DEMO_SCHOOL, track.samples[track.samples.length - 1])).toBe(true);
    });

    it("煙の中で立っていた区間がある", () => {
      expect(evaluation.smokeStanding.length).toBeGreaterThan(0);
    });
  });

  describe("late（逃げ遅れ）", () => {
    const { track, evaluation } = createSampleDrill(DEMO_SCHOOL, "late");

    it("逃げ遅れで，避難時間は null", () => {
      expect(evaluation.lateEscape).toBe(true);
      expect(evaluation.evacuationSeconds).toBeNull();
    });

    it("制限時間まで記録が続く（751 記録．最後の時刻が制限時間）", () => {
      expect(track.samples).toHaveLength(751);
      expect(track.samples[track.samples.length - 1].t).toBeCloseTo(
        DEMO_SCHOOL.drill.timeLimitSeconds,
        6,
      );
    });

    it("集合場所のマスには入っていない", () => {
      expect(track.samples.some((s) => inAssembly(DEMO_SCHOOL, s))).toBe(false);
    });
  });

  describe("nosmoke（煙の中にいなかった）", () => {
    const { evaluation } = createSampleDrill(DEMO_SCHOOL, "nosmoke");

    it("割合と「できた」は null，煙の中にいた時間は 0，立っていた区間は無い", () => {
      expect(evaluation.smokeCrouchRatio).toBeNull();
      expect(evaluation.smokePostureGood).toBeNull();
      expect(evaluation.smokeSeconds).toBe(0);
      expect(evaluation.smokeStanding).toEqual([]);
    });

    it("避難はできている", () => {
      expect(evaluation.lateEscape).toBe(false);
      expect(evaluation.evacuationSeconds).not.toBeNull();
    });
  });

  it("制限時間は校舎の訓練条件の写し（デモの校舎と別の値でも）", () => {
    const plan: SchoolPlan = {
      ...DEMO_SCHOOL,
      drill: { ...DEMO_SCHOOL.drill, timeLimitSeconds: 200, mode: "test" },
    };
    for (const variant of VARIANTS) {
      const { track, evaluation } = createSampleDrill(plan, variant);
      expect(evaluation.timeLimitSeconds).toBe(200);
      expectValidDrill(plan, track, evaluation);
    }
  });

  it("正解経路が空の校舎でも例外を投げず，約束を満たす", () => {
    const plan: SchoolPlan = { ...DEMO_SCHOOL, drill: { ...DEMO_SCHOOL.drill, route: [] } };
    for (const variant of VARIANTS) {
      const { track, evaluation } = createSampleDrill(plan, variant);
      expectValidDrill(plan, track, evaluation);
    }
  });
});
