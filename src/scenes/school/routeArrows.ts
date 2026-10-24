// 学習モードの床の矢印（F6）の組み立て．位置と向きは routeArrowsLayout.ts の純粋な関数で求め，
// 矢印はすべて 1 つの InstancedMesh（描画 1 回）にまとめる．校舎の root に object を足すだけで使える

import * as THREE from "three";
import type { CellRef, SchoolPlan } from "../../core/schoolPlan";
import { disposeObjectTree } from "../common/meshHelpers";
import {
  layoutRouteArrows,
  type RouteArrowPlacement,
  routeArrowDimensions,
  shouldShowRouteArrows,
} from "./routeArrowsLayout";

/** 矢印の色（避難誘導の緑．出口の表示 exitSign と同じ系統で，床の色（木目・廊下の灰）の上で目立つ） */
export const ROUTE_ARROW_COLOR = 0x2fd36b;

/** 矢印の Mesh の名前（テスト・確認用の表示で探すため） */
export const ROUTE_ARROWS_NAME = "route-arrows";

/** 床の正解経路の矢印 */
export interface RouteArrows {
  /** 矢印をまとめた Group（校舎の root に add する．ワールド座標で置いてあるので，root は原点のままでよい） */
  readonly object: THREE.Group;
  /** 並べた矢印の位置と向き（確認用の表示・テスト用） */
  readonly placements: readonly RouteArrowPlacement[];
  /** ジオメトリ・マテリアル・InstancedMesh のバッファを解放する（object を親から外すのは呼び出し側） */
  dispose(): void;
}

/** 床の矢印を作る時の指定 */
export interface RouteArrowsOptions {
  /** 描く経路（省くと plan.drill.route）．app/ が proposeRoute() の提案を渡す時に使う */
  readonly route?: readonly CellRef[];
}

/**
 * 矢印の平らな形（XZ 平面．-Z を向く．中心が原点）．三角の頭と四角の軸の 1 つの多角形にする．
 * 面は +Y を向く（上から見える）
 */
export function createRouteArrowGeometry(length: number, width: number): THREE.BufferGeometry {
  const half = length / 2;
  const headLength = length * 0.45;
  const shaftHalfWidth = width * 0.22;
  const headHalfWidth = width / 2;
  // Shape は XY 平面で +Y を先端にし，後で X 軸回りに -90° 回して +Y を -Z に移す
  const shape = new THREE.Shape();
  shape.moveTo(0, half);
  shape.lineTo(-headHalfWidth, half - headLength);
  shape.lineTo(-shaftHalfWidth, half - headLength);
  shape.lineTo(-shaftHalfWidth, -half);
  shape.lineTo(shaftHalfWidth, -half);
  shape.lineTo(shaftHalfWidth, half - headLength);
  shape.lineTo(headHalfWidth, half - headLength);
  shape.closePath();
  const geometry = new THREE.ShapeGeometry(shape);
  geometry.rotateX(-Math.PI / 2);
  return geometry;
}

/**
 * 正解経路の床の矢印を作る．テストモード（drill.mode が "test"）では作らずに null を返す（F7．正解経路を見せない）．
 * 学習モードで描ける矢印が無い（経路が空等）時は，中身が空の object を返す
 */
export function createRouteArrows(
  plan: SchoolPlan,
  options: RouteArrowsOptions = {},
): RouteArrows | null {
  if (!shouldShowRouteArrows(plan.drill.mode)) return null;
  const placements = layoutRouteArrows(plan, options.route ?? plan.drill.route);
  const group = new THREE.Group();
  group.name = ROUTE_ARROWS_NAME;

  if (placements.length > 0) {
    const { length, width } = routeArrowDimensions(plan.cellSize);
    // 光源が無くても同じ明るさで見えるよう MeshBasicMaterial にする．床と重なる面のちらつきを
    // ROUTE_ARROW_LIFT の浮かせに加えて polygonOffset でも防ぐ（遠くから見ると 2 cm の差が深度の精度に埋もれるため）
    const material = new THREE.MeshBasicMaterial({
      color: ROUTE_ARROW_COLOR,
      side: THREE.DoubleSide,
      polygonOffset: true,
      polygonOffsetFactor: -2,
      polygonOffsetUnits: -2,
    });
    const mesh = new THREE.InstancedMesh(
      createRouteArrowGeometry(length, width),
      material,
      placements.length,
    );
    mesh.name = `${ROUTE_ARROWS_NAME}-mesh`;
    const matrix = new THREE.Matrix4();
    const position = new THREE.Vector3();
    const rotation = new THREE.Quaternion();
    const scale = new THREE.Vector3(1, 1, 1);
    const up = new THREE.Vector3(0, 1, 0);
    placements.forEach((p, i) => {
      position.set(p.x, p.y, p.z);
      rotation.setFromAxisAngle(up, p.yaw);
      mesh.setMatrixAt(i, matrix.compose(position, rotation, scale));
    });
    mesh.instanceMatrix.needsUpdate = true;
    // 経路は校舎全体に広がるため，境界球を求め直して視野外の判定で消えないようにする
    mesh.computeBoundingSphere();
    group.add(mesh);
  }

  return {
    object: group,
    placements,
    dispose() {
      disposeObjectTree(group);
    },
  };
}
