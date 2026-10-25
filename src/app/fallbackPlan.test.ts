// #p= が無い時の既定の校舎（fallbackPlan.ts）のテスト．
// 基準は SPEC_01「起動の切り替え」: ?app 系・?monitor 系で共通の DEMO_PITCH_SCHOOL（?demo の有無で変えない）．
// ?scene=school・?editor・?debrief は DEMO_SCHOOL のまま
import { describe, expect, it } from "vitest";
import { fireOriginName } from "../scenario/drill";
import { loadPlanFromHash } from "../share/planHash";
import { DEMO_PITCH_SCHOOL } from "../share/samples/demoPitchSchool";
import { DEMO_SCHOOL } from "../share/samples/demoSchool";
import { FALLBACK_PLAN } from "./fallbackPlan";

describe("FALLBACK_PLAN", () => {
  it("発表のデモ用の校舎（DEMO_PITCH_SCHOOL）で，同梱のデモの校舎（DEMO_SCHOOL）ではない", () => {
    expect(FALLBACK_PLAN).toBe(DEMO_PITCH_SCHOOL);
    expect(FALLBACK_PLAN).not.toBe(DEMO_SCHOOL);
  });

  it("校内放送で伝える火元は理科室", () => {
    expect(fireOriginName(FALLBACK_PLAN)).toBe("理科室");
  });

  it.each([
    ["フラグメントが空", ""],
    ["# だけ", "#"],
    ["room= だけ", "#room=abc"],
  ])("loadPlanFromHash に渡すと，#p= が無い時（%s）はこの校舎になる", async (_, hash) => {
    const loaded = await loadPlanFromHash(hash, FALLBACK_PLAN);
    expect(loaded.plan).toBe(DEMO_PITCH_SCHOOL);
    expect(loaded.planLoadError).toBeNull();
  });

  it("#p= が壊れている時は既定の校舎に替えず失敗にする", async () => {
    const loaded = await loadPlanFromHash("#p=", FALLBACK_PLAN);
    expect(loaded.plan).toBeNull();
    expect(loaded.planLoadError).not.toBeNull();
  });
});
