// 床の正解経路の矢印の three.js の組み立て（routeArrows.ts）のテスト．
// 基準は SPEC_01「③ 避難」（学習モードでは床に正解経路の矢印を出す F6．テストモードでは出さない F7），
// SPEC_02「座標」，TECH_01 の向きの約束（0 で -Z を向き，正で左へ回る）と Issue #95 の振る舞いの約束．
// 描画結果は見ず，Group の構造（名前・InstancedMesh の数・各インスタンスの位置と回転）を確かめる
import * as THREE from "three";
import { describe, expect, it } from "vitest";
import type { CellRef, DrillSetup, SchoolPlan } from "../../core/schoolPlan";
import { DEMO_SCHOOL } from "../../share/samples/demoSchool";
import {
  createRouteArrowGeometry,
  createRouteArrows,
  ROUTE_ARROW_COLOR,
  ROUTE_ARROWS_NAME,
  type RouteArrows,
} from "./routeArrows";
import { layoutRouteArrows, ROUTE_ARROW_LIFT, routeArrowDimensions } from "./routeArrowsLayout";

const at = (x: number, z: number, floor = 0): CellRef => ({ floor, x, z });

/** デモの校舎の訓練条件を一部だけ上書きした校舎 */
function plan(drill: Partial<DrillSetup> = {}, cellSize = DEMO_SCHOOL.cellSize): SchoolPlan {
  return { ...DEMO_SCHOOL, cellSize, drill: { ...DEMO_SCHOOL.drill, ...drill } };
}

function mustCreate(p: SchoolPlan, route?: readonly CellRef[]): RouteArrows {
  const arrows = createRouteArrows(p, route === undefined ? {} : { route });
  if (arrows === null) throw new Error("矢印が作られなかった");
  return arrows;
}

function meshOf(arrows: RouteArrows): THREE.InstancedMesh {
  const mesh = arrows.object.getObjectByName(`${ROUTE_ARROWS_NAME}-mesh`);
  if (!(mesh instanceof THREE.InstancedMesh)) throw new Error("InstancedMesh が無い");
  return mesh;
}

function instance(mesh: THREE.InstancedMesh, i: number) {
  const matrix = new THREE.Matrix4();
  mesh.getMatrixAt(i, matrix);
  const position = new THREE.Vector3();
  const quaternion = new THREE.Quaternion();
  const scale = new THREE.Vector3();
  matrix.decompose(position, quaternion, scale);
  // 矢印のローカル -Z（先端の向き）がワールドでどこを向くか
  const tip = new THREE.Vector3(0, 0, -1).applyQuaternion(quaternion);
  return { position, quaternion, scale, tip };
}

describe("createRouteArrows（モードの切り替え）", () => {
  it("テストモードでは作らずに null（F7）", () => {
    expect(createRouteArrows(plan({ mode: "test" }))).toBeNull();
  });

  it("テストモードでは route を渡しても null", () => {
    expect(createRouteArrows(plan({ mode: "test" }), { route: [at(0, 6), at(1, 6)] })).toBeNull();
  });

  it("学習モードでは作る", () => {
    const arrows = mustCreate(plan({ mode: "learn" }));
    expect(arrows.object).toBeInstanceOf(THREE.Group);
    arrows.dispose();
  });
});

describe("createRouteArrows（デモの校舎の構造）", () => {
  it("名前付きの Group の中に InstancedMesh が 1 つ，count は経路のマスの数（19）", () => {
    const arrows = mustCreate(DEMO_SCHOOL);
    expect(arrows.object.name).toBe(ROUTE_ARROWS_NAME);
    expect(arrows.object.children).toHaveLength(1);
    const mesh = meshOf(arrows);
    expect(mesh.name).toBe("route-arrows-mesh");
    expect(mesh.count).toBe(19);
    expect(arrows.placements).toHaveLength(19);
    arrows.dispose();
  });

  it("placements は layoutRouteArrows の結果と同じ", () => {
    const arrows = mustCreate(DEMO_SCHOOL);
    expect(arrows.placements).toEqual(layoutRouteArrows(DEMO_SCHOOL, DEMO_SCHOOL.drill.route));
    arrows.dispose();
  });

  it("光源に依らない緑の MeshBasicMaterial", () => {
    const arrows = mustCreate(DEMO_SCHOOL);
    const material = meshOf(arrows).material;
    expect(material).toBeInstanceOf(THREE.MeshBasicMaterial);
    expect((material as THREE.MeshBasicMaterial).color.getHex()).toBe(ROUTE_ARROW_COLOR);
    arrows.dispose();
  });

  it("各インスタンスは経路のマスの中心・床の少し上に置き，拡大縮小しない", () => {
    const arrows = mustCreate(DEMO_SCHOOL);
    const mesh = meshOf(arrows);
    DEMO_SCHOOL.drill.route.forEach((cell, i) => {
      const { position, scale } = instance(mesh, i);
      expect(position.x).toBeCloseTo((cell.x + 0.5) * DEMO_SCHOOL.cellSize, 6);
      expect(position.y).toBeCloseTo(ROUTE_ARROW_LIFT, 6);
      expect(position.z).toBeCloseTo((cell.z + 0.5) * DEMO_SCHOOL.cellSize, 6);
      expect(scale.x).toBeCloseTo(1, 6);
      expect(scale.y).toBeCloseTo(1, 6);
      expect(scale.z).toBeCloseTo(1, 6);
    });
    arrows.dispose();
  });

  it("各インスタンスの先端は次のマスの方を向く（最後は入ってきた向き）", () => {
    const arrows = mustCreate(DEMO_SCHOOL);
    const mesh = meshOf(arrows);
    const route = DEMO_SCHOOL.drill.route;
    route.forEach((cell, i) => {
      const from = i < route.length - 1 ? cell : route[i - 1];
      const to = i < route.length - 1 ? route[i + 1] : cell;
      const { tip } = instance(mesh, i);
      expect(tip.x, `routeIndex ${i}`).toBeCloseTo(to.x - from.x, 6);
      expect(tip.y, `routeIndex ${i}`).toBeCloseTo(0, 6);
      expect(tip.z, `routeIndex ${i}`).toBeCloseTo(to.z - from.z, 6);
    });
    arrows.dispose();
  });

  it("経路の範囲が視野外の判定で消えないよう，境界球が経路全体を含む", () => {
    const arrows = mustCreate(DEMO_SCHOOL);
    const mesh = meshOf(arrows);
    const sphere = mesh.boundingSphere;
    expect(sphere).not.toBeNull();
    for (const p of arrows.placements) {
      expect(sphere?.containsPoint(new THREE.Vector3(p.x, p.y, p.z))).toBe(true);
    }
    arrows.dispose();
  });
});

describe("createRouteArrows（経路と校舎の違い）", () => {
  it("options.route で描く経路を差し替える", () => {
    const route = [at(0, 6), at(1, 6), at(1, 7)];
    const arrows = mustCreate(DEMO_SCHOOL, route);
    expect(arrows.placements.map((p) => p.routeIndex)).toEqual([0, 1, 2]);
    expect(arrows.placements.map((p) => p.kind)).toEqual(["start", "turn", "goal"]);
    const mesh = meshOf(arrows);
    expect(mesh.count).toBe(3);
    expect(instance(mesh, 0).position.x).toBeCloseTo(0.5, 6);
    expect(instance(mesh, 2).position.z).toBeCloseTo(7.5, 6);
    // 1 番目は曲がった後の向き（+Z）
    expect(instance(mesh, 1).tip.z).toBeCloseTo(1, 6);
    arrows.dispose();
  });

  it("空の経路では子の無い Group を返す", () => {
    const arrows = mustCreate(plan({ route: [] }));
    expect(arrows.object.name).toBe(ROUTE_ARROWS_NAME);
    expect(arrows.object.children).toHaveLength(0);
    expect(arrows.placements).toEqual([]);
    expect(() => arrows.dispose()).not.toThrow();
  });

  it("options.route が空なら drill.route があっても子の無い Group", () => {
    const arrows = mustCreate(DEMO_SCHOOL, []);
    expect(arrows.object.children).toHaveLength(0);
    arrows.dispose();
  });

  it("描ける矢印が無い経路（1 マスだけ）でも子の無い Group", () => {
    const arrows = mustCreate(DEMO_SCHOOL, [at(2, 2)]);
    expect(arrows.object.children).toHaveLength(0);
    arrows.dispose();
  });

  it("マスの一辺に合わせて位置と矢印の大きさが変わる", () => {
    const p = plan({}, 2);
    const arrows = mustCreate(p, [at(0, 6), at(1, 6)]);
    const mesh = meshOf(arrows);
    expect(instance(mesh, 1).position.x).toBeCloseTo(3, 6);
    expect(instance(mesh, 1).position.z).toBeCloseTo(13, 6);
    mesh.geometry.computeBoundingBox();
    const box = mesh.geometry.boundingBox as THREE.Box3;
    const { length, width } = routeArrowDimensions(2);
    expect(box.max.z - box.min.z).toBeCloseTo(length, 6);
    expect(box.max.x - box.min.x).toBeCloseTo(width, 6);
    arrows.dispose();
  });

  it("2 階のマスは y = 3.5 m の床の少し上", () => {
    const twoFloors: SchoolPlan = {
      ...DEMO_SCHOOL,
      floors: [DEMO_SCHOOL.floors[0], { ...DEMO_SCHOOL.floors[0], level: 2 }],
    };
    const arrows = mustCreate(twoFloors, [at(0, 6, 1), at(1, 6, 1)]);
    const mesh = meshOf(arrows);
    expect(instance(mesh, 0).position.y).toBeCloseTo(3.5 + ROUTE_ARROW_LIFT, 6);
    expect(instance(mesh, 1).position.y).toBeCloseTo(3.5 + ROUTE_ARROW_LIFT, 6);
    arrows.dispose();
  });
});

describe("createRouteArrows（dispose）", () => {
  it("ジオメトリとマテリアルを解放する", () => {
    const arrows = mustCreate(DEMO_SCHOOL);
    const mesh = meshOf(arrows);
    let geometryDisposed = 0;
    let materialDisposed = 0;
    mesh.geometry.addEventListener("dispose", () => {
      geometryDisposed++;
    });
    (mesh.material as THREE.Material).addEventListener("dispose", () => {
      materialDisposed++;
    });
    arrows.dispose();
    expect(geometryDisposed).toBe(1);
    expect(materialDisposed).toBe(1);
  });
});

describe("createRouteArrowGeometry", () => {
  it("中心が原点で，長さが Z・幅が X に沿う平らな形（y = 0）", () => {
    const geometry = createRouteArrowGeometry(0.6, 0.45);
    geometry.computeBoundingBox();
    const box = geometry.boundingBox as THREE.Box3;
    expect(box.min.z).toBeCloseTo(-0.3, 6);
    expect(box.max.z).toBeCloseTo(0.3, 6);
    expect(box.min.x).toBeCloseTo(-0.225, 6);
    expect(box.max.x).toBeCloseTo(0.225, 6);
    expect(box.min.y).toBeCloseTo(0, 6);
    expect(box.max.y).toBeCloseTo(0, 6);
    geometry.dispose();
  });

  it("先端（幅の中央）は -Z の端にある", () => {
    const geometry = createRouteArrowGeometry(0.6, 0.45);
    const pos = geometry.getAttribute("position");
    const tips: number[] = [];
    for (let i = 0; i < pos.count; i++) {
      if (Math.abs(pos.getZ(i) + 0.3) < 1e-6) tips.push(pos.getX(i));
    }
    expect(tips.length).toBeGreaterThan(0);
    // -Z の端の頂点は先端の 1 点（x = 0）だけ
    for (const x of tips) expect(x).toBeCloseTo(0, 6);
    // +Z の端（軸の後ろ）は幅を持つ
    let tailMinX = Infinity;
    let tailMaxX = -Infinity;
    for (let i = 0; i < pos.count; i++) {
      if (Math.abs(pos.getZ(i) - 0.3) < 1e-6) {
        tailMinX = Math.min(tailMinX, pos.getX(i));
        tailMaxX = Math.max(tailMaxX, pos.getX(i));
      }
    }
    expect(tailMaxX - tailMinX).toBeGreaterThan(0);
    expect(tailMaxX - tailMinX).toBeLessThan(0.45);
    geometry.dispose();
  });

  it("面は上（+Y）を向く", () => {
    const geometry = createRouteArrowGeometry(0.6, 0.45);
    const normal = geometry.getAttribute("normal");
    for (let i = 0; i < normal.count; i++) {
      expect(normal.getY(i)).toBeCloseTo(1, 6);
    }
    geometry.dispose();
  });
});
