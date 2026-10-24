import { describe, expect, it } from "vitest";
import * as trainLayout from "../train/trainLayout";
import { slidingLeafX, slidingLeaves } from "./slidingDoor";

/** 扉の X の範囲 */
function leafSpan(leaf: ReturnType<typeof slidingLeaves>[number], openAmount: number) {
  const x = slidingLeafX(leaf, openAmount);
  return [x - leaf.width / 2, x + leaf.width / 2] as const;
}

describe("slidingLeaves / slidingLeafX（common）", () => {
  it("2 枚（エレベーターの 1.0m の扉）: 閉じると中央で合わさり開口部をすき間なくふさぐ", () => {
    const leaves = slidingLeaves(1.0, 2);
    expect(leaves).toHaveLength(2);
    const [a, b] = leaves.map((l) => leafSpan(l, 0)).sort((p, q) => p[0] - q[0]);
    expect(a[0]).toBeCloseTo(-0.5);
    expect(a[1]).toBeCloseTo(0);
    expect(b[0]).toBeCloseTo(0);
    expect(b[1]).toBeCloseTo(0.5);
  });

  it("2 枚: a は -X，b は +X へ開き，全開で開口部が全幅あく", () => {
    const leaves = slidingLeaves(1.0, 2);
    const a = leaves.find((l) => l.suffix === "a");
    const b = leaves.find((l) => l.suffix === "b");
    expect(a?.slideDirection).toBe(-1);
    expect(b?.slideDirection).toBe(1);
    for (const leaf of leaves) {
      const [x0, x1] = leafSpan(leaf, 1);
      expect(Math.min(x1, 0.5) - Math.max(x0, -0.5)).toBeLessThanOrEqual(1e-9);
    }
  });

  it("openAmount は 0〜1 に切り詰め，途中は線形", () => {
    const [leaf] = slidingLeaves(1.0, 2);
    const closed = slidingLeafX(leaf, 0);
    const open = slidingLeafX(leaf, 1);
    expect(slidingLeafX(leaf, 0.5)).toBeCloseTo((closed + open) / 2);
    expect(slidingLeafX(leaf, -1)).toBeCloseTo(closed);
    expect(slidingLeafX(leaf, 3)).toBeCloseTo(open);
  });

  it("電車（trainLayout）からも同じ関数を使える", () => {
    expect(trainLayout.slidingLeaves).toBe(slidingLeaves);
    expect(trainLayout.slidingLeafX).toBe(slidingLeafX);
  });
});
