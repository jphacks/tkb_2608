// 確認用の空間（?scene=school-parts）．校舎のパーツを schoolPartsPreviewLayout.ts の一覧どおりに並べ，
// 外の地面と光源を足す．動かない Mesh は最後にマテリアルごとに結合し，描画の回数を減らす

import * as THREE from "three";
import { disposeObjectTree } from "../common/meshHelpers";
import type { Space, SpaceBuildOptions } from "../types";
import { createClassroom } from "./classroom";
import type { PartPlacement } from "./schoolLayout";
import { type MergeStats, mergeStaticMeshes } from "./schoolMerge";
import {
  createFloorSurface,
  createSchoolEdge,
  createSchoolPartContext,
  createSchoolPost,
  disposeSchoolPartContext,
  isDynamicSchoolObject,
  type SchoolPartContext,
} from "./schoolParts";
import {
  PREVIEW_EYE_HEIGHT,
  PREVIEW_GROUND,
  PREVIEW_START,
  type PreviewPart,
  previewParts,
} from "./schoolPartsPreviewLayout";

/** 空の色（Scene の背景） */
export const SCHOOL_PARTS_BACKGROUND = 0xa9cbe6;

/** 確認用の空間に並べたパーツ */
export interface SchoolPartsParts {
  /** パーツをまとめた親（root の子．子は 1 パーツ 1 Group．userData は schoolLayout.ts の型） */
  readonly parts: THREE.Group;
  /** 引き戸のドア（userData は SchoolDoorUserData．locked のものも含む） */
  readonly doors: readonly THREE.Group[];
  /** 防火シャッター（userData は FireShutterUserData） */
  readonly shutters: readonly THREE.Group[];
  /** パーツの Group を id（= name）で引く */
  readonly byId: ReadonlyMap<string, THREE.Group>;
  /** 動かない Mesh の結合の結果 */
  readonly mergeStats: MergeStats;
}

/** 確認用の空間．Space に加え，並べたパーツの一覧を持つ */
export interface SchoolPartsSpace extends Space {
  readonly id: "school-parts";
  readonly parts: SchoolPartsParts;
}

/** Space が確認用の校舎のパーツの空間か（parts を持つか）を判定する */
export function isSchoolPartsSpace(space: Space): space is SchoolPartsSpace {
  return space.id === "school-parts" && "parts" in space;
}

function place(object: THREE.Object3D, placement: PartPlacement): void {
  object.position.set(placement.x, 0, placement.z);
  object.rotation.y = placement.rotationY;
}

function createPart(context: SchoolPartContext, part: PreviewPart): THREE.Group {
  switch (part.type) {
    case "floor":
      return createFloorSurface(context, part);
    case "classroom":
      return createClassroom(context, part);
    case "edge":
      return createSchoolEdge(context, part);
    case "post":
      return createSchoolPost(context, part);
  }
}

/** 外の地面（校庭の土）．建物の床と重ならないよう少し下げる */
function createGround(): THREE.Mesh {
  const width = PREVIEW_GROUND.maxX - PREVIEW_GROUND.minX;
  const depth = PREVIEW_GROUND.maxZ - PREVIEW_GROUND.minZ;
  const ground = new THREE.Mesh(
    new THREE.PlaneGeometry(width, depth),
    new THREE.MeshLambertMaterial({ color: 0xc4ab84 }),
  );
  ground.rotation.x = -Math.PI / 2;
  ground.position.set(
    (PREVIEW_GROUND.minX + PREVIEW_GROUND.maxX) / 2,
    -0.02,
    (PREVIEW_GROUND.minZ + PREVIEW_GROUND.maxZ) / 2,
  );
  ground.name = "ground";
  return ground;
}

/** 確認用の空間を作る */
export function createSchoolPartsScene(options: SpaceBuildOptions): SchoolPartsSpace {
  const context = createSchoolPartContext(options.maxAnisotropy);
  const root = new THREE.Group();
  root.name = "school-parts";

  const partsGroup = new THREE.Group();
  partsGroup.name = "parts";
  const byId = new Map<string, THREE.Group>();
  const doors: THREE.Group[] = [];
  const shutters: THREE.Group[] = [];
  for (const part of previewParts()) {
    const group = createPart(context, part);
    place(group, part.placement);
    partsGroup.add(group);
    byId.set(group.name, group);
    if (part.type === "edge" && part.kind === "door") doors.push(group);
    if (part.type === "edge" && part.kind === "fireShutter") shutters.push(group);
  }
  root.add(partsGroup);
  root.add(createGround());

  // 天井があるため光源は上からだけでは室内が暗くなる．影は使わないので，半球光と平行光で室内も同じ明るさにする
  const hemisphere = new THREE.HemisphereLight(0xffffff, 0x8a7a66, 1.6);
  hemisphere.name = "ambient";
  const sun = new THREE.DirectionalLight(0xfff4e0, 1.2);
  sun.position.set(-10, 20, 12);
  sun.name = "sun";
  root.add(hemisphere, sun);

  // パーツを並べ終えた後に，動かない Mesh をまとめる（パーツの Group と userData は残る）
  const mergeStats = mergeStaticMeshes(partsGroup, isDynamicSchoolObject);

  return {
    id: "school-parts",
    root,
    startPosition: new THREE.Vector3(PREVIEW_START.x, PREVIEW_EYE_HEIGHT.standing, PREVIEW_START.z),
    startYaw: PREVIEW_START.yaw,
    background: SCHOOL_PARTS_BACKGROUND,
    parts: { parts: partsGroup, doors, shutters, byId, mergeStats },
    dispose: () => {
      disposeObjectTree(root);
      disposeSchoolPartContext(context);
    },
  };
}
