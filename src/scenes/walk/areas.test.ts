// エリアの判定のテスト．Issue #31「エリアの出入りを areaEntered／areaExited で流し，observe() で今いるエリアを返す」

import { describe, expect, it } from "vitest";
import { areasAt, diffAreaIds, type FloorArea } from "./areas";

const AREAS: readonly FloorArea[] = [
  { id: "a", minX: 0, maxX: 1, minZ: 0, maxZ: 1 },
  { id: "b", minX: 0.5, maxX: 2, minZ: 0, maxZ: 1 },
];

describe("areasAt", () => {
  it("点を含むエリアを並びの順に返す（重なれば複数，境界上も含む）", () => {
    expect(areasAt(AREAS, 0.25, 0.5)).toEqual(["a"]);
    expect(areasAt(AREAS, 0.75, 0.5)).toEqual(["a", "b"]);
    expect(areasAt(AREAS, 2, 1)).toEqual(["b"]);
    expect(areasAt(AREAS, 3, 0.5)).toEqual([]);
  });
});

describe("diffAreaIds", () => {
  it("入ったエリアと出たエリアを求める", () => {
    expect(diffAreaIds(["a"], ["a", "b"])).toEqual({ entered: ["b"], exited: [] });
    expect(diffAreaIds(["a", "b"], ["b"])).toEqual({ entered: [], exited: ["a"] });
    expect(diffAreaIds(["a"], ["b"])).toEqual({ entered: ["b"], exited: ["a"] });
    expect(diffAreaIds(["a"], ["a"])).toEqual({ entered: [], exited: [] });
  });
});
