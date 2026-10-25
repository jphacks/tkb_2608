// 集合場所の床の印（塗った面と枠）の組み立て．並べ方は assemblyMarkerLayout.ts の純粋な関数で求め，
// 面と枠をそれぞれ 1 つの InstancedMesh（描画 1 回ずつ）にまとめる．学習モードでもテストモードでも出す（SPEC_01「VR 避難の規則」）

import * as THREE from "three";
import type { SchoolPlan } from "../../core/schoolPlan";
import { disposeObjectTree } from "../common/meshHelpers";
import type { XZRect } from "../walk/collision";
import {
  ASSEMBLY_FILL_LIFT,
  ASSEMBLY_FRAME_LIFT,
  type AssemblyMarkerLayout,
  layoutAssemblyMarker,
} from "./assemblyMarkerLayout";

/** 塗る面の色（淡い黄．床の矢印の緑 ROUTE_ARROW_COLOR が上に重なっても見分けられ，校庭の土の色の上で目立つ） */
export const ASSEMBLY_FILL_COLOR = 0xfff1a8;
/** 枠の色（濃い黄．遠くからでもまとまりの形が分かる） */
export const ASSEMBLY_FRAME_COLOR = 0xf2a900;

/** 印をまとめた Group の名前（テスト・確認用の表示で探すため） */
export const ASSEMBLY_MARKER_NAME = "assembly-marker";

/** 集合場所の床の印 */
export interface AssemblyMarker {
  /** 印をまとめた Group（校舎の root に add する．ワールド座標で置いてあるので，root は原点のままでよい） */
  readonly object: THREE.Group;
  /** 並べ方（テスト・確認用） */
  readonly layout: AssemblyMarkerLayout;
  /** ジオメトリ・マテリアル・InstancedMesh のバッファを解放する（object を親から外すのは呼び出し側） */
  dispose(): void;
}

function createRectsMesh(
  rects: readonly XZRect[],
  y: number,
  color: number,
  offset: number,
  name: string,
): THREE.InstancedMesh {
  // 1 m 四方の平らな面（+Y を向く）を矩形ごとに伸ばして置く
  const geometry = new THREE.PlaneGeometry(1, 1);
  geometry.rotateX(-Math.PI / 2);
  // 光源が無くても同じ明るさで見えるよう MeshBasicMaterial にする．地面とのちらつきは浮かせと polygonOffset で防ぐ
  const material = new THREE.MeshBasicMaterial({
    color,
    side: THREE.DoubleSide,
    polygonOffset: true,
    polygonOffsetFactor: offset,
    polygonOffsetUnits: offset,
  });
  const mesh = new THREE.InstancedMesh(geometry, material, rects.length);
  mesh.name = name;
  const matrix = new THREE.Matrix4();
  rects.forEach((r, i) => {
    matrix.makeScale(r.maxX - r.minX, 1, r.maxZ - r.minZ);
    matrix.setPosition((r.minX + r.maxX) / 2, y, (r.minZ + r.maxZ) / 2);
    mesh.setMatrixAt(i, matrix);
  });
  mesh.instanceMatrix.needsUpdate = true;
  mesh.computeBoundingSphere();
  return mesh;
}

/** 集合場所の床の印を作る．集合場所が無い（1 つ目の階に無い）時は，中身が空の object を返す */
export function createAssemblyMarker(plan: SchoolPlan): AssemblyMarker {
  const layout = layoutAssemblyMarker(plan);
  const group = new THREE.Group();
  group.name = ASSEMBLY_MARKER_NAME;
  if (layout.fills.length > 0) {
    group.add(
      createRectsMesh(
        layout.fills,
        ASSEMBLY_FILL_LIFT,
        ASSEMBLY_FILL_COLOR,
        -1,
        `${ASSEMBLY_MARKER_NAME}-fill`,
      ),
    );
  }
  if (layout.frames.length > 0) {
    group.add(
      createRectsMesh(
        layout.frames,
        ASSEMBLY_FRAME_LIFT,
        ASSEMBLY_FRAME_COLOR,
        -1.5,
        `${ASSEMBLY_MARKER_NAME}-frame`,
      ),
    );
  }
  return {
    object: group,
    layout,
    dispose() {
      disposeObjectTree(group);
    },
  };
}
