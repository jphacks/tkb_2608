// 集合場所の床の印（assemblyMarker.ts）の組み立てのテスト．Mesh の数・名前・置き場所（構造）を確かめる（見た目は実機で確かめる）

import * as THREE from "three";
import { describe, expect, it } from "vitest";
import type { SchoolPlan } from "../../core/schoolPlan";
import { DEMO_SCHOOL } from "../../share/samples/demoSchool";
import { ASSEMBLY_MARKER_NAME, createAssemblyMarker } from "./assemblyMarker";
import { ASSEMBLY_FILL_LIFT, ASSEMBLY_FRAME_LIFT } from "./assemblyMarkerLayout";
import { ROUTE_ARROW_LIFT } from "./routeArrowsLayout";

function withDrill(drill: Partial<SchoolPlan["drill"]>): SchoolPlan {
  return { ...DEMO_SCHOOL, drill: { ...DEMO_SCHOOL.drill, ...drill } };
}

function meshNamed(group: THREE.Group, name: string): THREE.InstancedMesh {
  const mesh = group.getObjectByName(name);
  if (!(mesh instanceof THREE.InstancedMesh)) throw new Error(`${name} がありません`);
  return mesh;
}

describe("createAssemblyMarker", () => {
  it("デモの校舎では塗る面 1 つと枠 8 本を InstancedMesh にまとめる", () => {
    const marker = createAssemblyMarker(DEMO_SCHOOL);
    expect(marker.object.name).toBe(ASSEMBLY_MARKER_NAME);
    const fill = meshNamed(marker.object, `${ASSEMBLY_MARKER_NAME}-fill`);
    const frame = meshNamed(marker.object, `${ASSEMBLY_MARKER_NAME}-frame`);
    expect(fill.count).toBe(1);
    expect(frame.count).toBe(8);

    // 面は集合場所（x 8〜10，z 10〜12）の中心に置く
    const matrix = new THREE.Matrix4();
    const position = new THREE.Vector3();
    const scale = new THREE.Vector3();
    fill.getMatrixAt(0, matrix);
    matrix.decompose(position, new THREE.Quaternion(), scale);
    // 行列は 32 ビットの小数で持つため，近い値で比べる
    for (const [i, v] of [9, ASSEMBLY_FILL_LIFT, 11].entries()) {
      expect(position.getComponent(i)).toBeCloseTo(v);
    }
    for (const [i, v] of [2, 1, 2].entries()) expect(scale.getComponent(i)).toBeCloseTo(v);
    marker.dispose();
  });

  it("面と枠は床の矢印より低く，枠は面より上に置く（矢印が印の上に見える）", () => {
    expect(ASSEMBLY_FILL_LIFT).toBeLessThan(ROUTE_ARROW_LIFT);
    expect(ASSEMBLY_FRAME_LIFT).toBeLessThan(ROUTE_ARROW_LIFT);
    expect(ASSEMBLY_FRAME_LIFT).toBeGreaterThan(ASSEMBLY_FILL_LIFT);
  });

  it("テストモードでも出す（避難先が分からないと訓練にならないため）", () => {
    const marker = createAssemblyMarker(withDrill({ mode: "test" }));
    expect(marker.object.children).toHaveLength(2);
    marker.dispose();
  });

  it("集合場所が無ければ中身が空", () => {
    const marker = createAssemblyMarker(withDrill({ assembly: [] }));
    expect(marker.object.children).toHaveLength(0);
    marker.dispose();
  });

  it("dispose でジオメトリとマテリアルを解放する", () => {
    const marker = createAssemblyMarker(DEMO_SCHOOL);
    let disposed = 0;
    marker.object.traverse((o) => {
      if (!(o instanceof THREE.InstancedMesh)) return;
      o.geometry.addEventListener("dispose", () => disposed++);
      (o.material as THREE.Material).addEventListener("dispose", () => disposed++);
    });
    marker.dispose();
    expect(disposed).toBe(4);
  });
});
