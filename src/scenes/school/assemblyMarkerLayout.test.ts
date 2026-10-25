// 集合場所の床の印の並べ方（assemblyMarkerLayout.ts）のテスト．塗る面が集合場所のマスと一致し，枠が外周にだけ付くことを確かめる

import { describe, expect, it } from "vitest";
import type { CellRef, SchoolPlan } from "../../core/schoolPlan";
import { DEMO_SCHOOL } from "../../share/samples/demoSchool";
import { ASSEMBLY_FRAME_RATIO, layoutAssemblyMarker } from "./assemblyMarkerLayout";

const at = (x: number, z: number, floor = 0): CellRef => ({ floor, x, z });

function withAssembly(assembly: readonly CellRef[], cellSize = 1): SchoolPlan {
  return { ...DEMO_SCHOOL, cellSize, drill: { ...DEMO_SCHOOL.drill, assembly } };
}

/** 矩形の面積の和（m²） */
const area = (rects: readonly { minX: number; maxX: number; minZ: number; maxZ: number }[]) =>
  rects.reduce((sum, r) => sum + (r.maxX - r.minX) * (r.maxZ - r.minZ), 0);

describe("layoutAssemblyMarker", () => {
  it("デモの校舎の 2 × 2 マスは 1 つの面と外周 8 本の枠", () => {
    const { fills, frames } = layoutAssemblyMarker(DEMO_SCHOOL);
    expect(fills).toEqual([{ minX: 8, maxX: 10, minZ: 10, maxZ: 12 }]);
    expect(frames).toHaveLength(8);
    // 枠はどれも集合場所の中にあり，外周の線に接する
    for (const f of frames) {
      expect(f.minX).toBeGreaterThanOrEqual(8);
      expect(f.maxX).toBeLessThanOrEqual(10);
      expect(f.minZ).toBeGreaterThanOrEqual(10);
      expect(f.maxZ).toBeLessThanOrEqual(12);
      expect([f.minX === 8, f.maxX === 10, f.minZ === 10, f.maxZ === 12]).toContain(true);
    }
  });

  it("L 字の集合場所は塗る面の合計が 3 マス分で，枠は外周の辺の数（8 本）", () => {
    const { fills, frames } = layoutAssemblyMarker(withAssembly([at(1, 9), at(2, 9), at(1, 10)]));
    expect(area(fills)).toBeCloseTo(3);
    expect(frames).toHaveLength(8);
  });

  it("マスの大きさに合わせて広がり，枠の幅はマスの ASSEMBLY_FRAME_RATIO 倍", () => {
    const { fills, frames } = layoutAssemblyMarker(withAssembly([at(3, 9)], 2));
    expect(fills).toEqual([{ minX: 6, maxX: 8, minZ: 18, maxZ: 20 }]);
    expect(frames).toHaveLength(4);
    expect(frames[0]).toEqual({ minX: 6, maxX: 8, minZ: 18, maxZ: 18 + 2 * ASSEMBLY_FRAME_RATIO });
  });

  it("同じマスが重なって書かれていても 1 マスとして扱う", () => {
    const { fills, frames } = layoutAssemblyMarker(withAssembly([at(3, 9), at(3, 9)]));
    expect(fills).toHaveLength(1);
    expect(frames).toHaveLength(4);
  });

  it.each([
    ["集合場所が無い", []],
    ["別の階だけ", [at(3, 9, 1)]],
    ["マス目の外だけ", [at(40, 9), at(-1, 0)]],
  ])("%s時は両方とも空", (_, assembly) => {
    expect(layoutAssemblyMarker(withAssembly(assembly))).toEqual({ fills: [], frames: [] });
  });
});
