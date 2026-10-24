// SchoolPlan の 1 フロアから組み立てた校舎の空間（?scene=school）．並べ方は schoolPlanLayout.ts の純粋な関数で求め，
// ここでは校舎のパーツ（schoolParts.ts）を置くだけ．動かない Mesh は最後にマテリアルごとに結合する．
// 学習モードの床の矢印（routeArrows.ts）と火と煙（fireSmoke.ts）も足し，火と煙は毎フレームの update で時刻に合わせる

import * as THREE from "three";
import type { SchoolPlan } from "../../core/schoolPlan";
import { DEMO_SCHOOL } from "../../share/samples/demoSchool";
import { computeSpread } from "../../sim/spread";
import { createBox, disposeObjectTree } from "../common/meshHelpers";
import type { Space, SpaceBuildOptions } from "../types";
import { createFireSmoke, type FireSmoke } from "./fireSmoke";
import { createRouteArrows, type RouteArrows } from "./routeArrows";
import {
  edgePlacementBetween,
  type PartPlacement,
  POST_SIZE,
  WALL_THICKNESS,
  type XZPoint,
} from "./schoolLayout";
import { type MergeStats, mergeStaticMeshes } from "./schoolMerge";
import {
  createFloorSurface,
  createSchoolBlock,
  createSchoolEdge,
  createSchoolPartContext,
  createSchoolPost,
  disposeSchoolPartContext,
  isDynamicSchoolObject,
  type SchoolPartContext,
} from "./schoolParts";
import { SCHOOL_PARTS_BACKGROUND } from "./schoolPartsPreview";
import { SCHOOL_EYE_HEIGHT, type SchoolPlanLayout, schoolPlanLayout } from "./schoolPlanLayout";

/** マス目の外に広げる地面の幅（m．見た目だけで，歩けるのは屋外のマスだけ） */
export const SCHOOL_GROUND_MARGIN = 30;

/** 組み立てた校舎のパーツ */
export interface SchoolPlanParts {
  /** パーツをまとめた親（root の子．子は 1 パーツ 1 Group） */
  readonly parts: THREE.Group;
  /** 防火シャッター（userData は FireShutterUserData） */
  readonly shutters: readonly THREE.Group[];
  /** パーツの Group を id（= name）で引く */
  readonly byId: ReadonlyMap<string, THREE.Group>;
  /** 動かない Mesh の結合の結果 */
  readonly mergeStats: MergeStats;
}

/** SchoolPlan から組み立てた校舎の空間 */
export interface SchoolSpace extends Space {
  readonly id: "school";
  readonly plan: SchoolPlan;
  readonly layout: SchoolPlanLayout;
  readonly parts: SchoolPlanParts;
  /** 床の正解経路の矢印（root の子．テストモードでは null） */
  readonly routeArrows: RouteArrows | null;
  /** 火と煙（root の子．fog は fireSmoke.fog と同じもの） */
  readonly fireSmoke: FireSmoke;
  readonly fog: THREE.FogExp2;
}

/** Space が SchoolPlan から組み立てた校舎の空間か */
export function isSchoolSpace(space: Space): space is SchoolSpace {
  return space.id === "school" && "layout" in space;
}

/** 校舎の組み立ての追加の指定 */
export interface SchoolSceneOptions {
  /** 防火シャッターを閉じて作るか（既定 true．非常ベルの時点で閉じている扱い．SPEC_02「通れる・燃え広がる」） */
  readonly shuttersClosed?: boolean;
}

function place(object: THREE.Object3D, placement: PartPlacement): void {
  object.position.set(placement.x, 0, placement.z);
  object.rotation.y = placement.rotationY;
}

/** 2 点の間に辺の物を置く（edgePlacementBetween の位置と向き） */
function placeBetween(object: THREE.Object3D, from: XZPoint, to: XZPoint): number {
  const { placement, length } = edgePlacementBetween(from, to);
  place(object, placement);
  return length;
}

/** 開口部の上の垂れ壁（当たり判定は無い．床から bottom（m）より上にあり，立った頭より高いため） */
function createLintel(
  context: SchoolPartContext,
  id: string,
  length: number,
  bottom: number,
  ceiling: number,
): THREE.Group {
  const group = new THREE.Group();
  group.name = id;
  group.userData = { kind: "schoolLintel", id };
  const height = ceiling - bottom;
  group.add(
    createBox(
      context.unitBox,
      context.materials.wall,
      [length - POST_SIZE, height, WALL_THICKNESS],
      [0, bottom + height / 2, 0],
      `${id}-body`,
    ),
  );
  return group;
}

/** 校舎の外の地面（見た目だけ）．建物の床と重ならないよう少し下げる */
function createGround(layout: SchoolPlanLayout): THREE.Mesh {
  const { bounds } = layout;
  const width = bounds.maxX - bounds.minX + 2 * SCHOOL_GROUND_MARGIN;
  const depth = bounds.maxZ - bounds.minZ + 2 * SCHOOL_GROUND_MARGIN;
  const ground = new THREE.Mesh(
    new THREE.PlaneGeometry(width, depth),
    new THREE.MeshLambertMaterial({ color: 0xc4ab84 }),
  );
  ground.rotation.x = -Math.PI / 2;
  ground.position.set((bounds.minX + bounds.maxX) / 2, -0.02, (bounds.minZ + bounds.maxZ) / 2);
  ground.name = "ground";
  return ground;
}

function buildParts(
  context: SchoolPartContext,
  layout: SchoolPlanLayout,
  shuttersClosed: boolean,
): { group: THREE.Group; shutters: THREE.Group[] } {
  const h = layout.ceilingHeight;
  const group = new THREE.Group();
  group.name = "parts";
  const shutters: THREE.Group[] = [];

  for (const f of layout.floors) {
    const width = f.rect.maxX - f.rect.minX;
    const depth = f.rect.maxZ - f.rect.minZ;
    const surface = createFloorSurface(context, {
      kind: f.kind,
      width,
      depth,
      ceilingHeight: h,
      id: f.id,
    });
    place(surface, {
      x: (f.rect.minX + f.rect.maxX) / 2,
      z: (f.rect.minZ + f.rect.maxZ) / 2,
      rotationY: 0,
    });
    group.add(surface);
  }

  for (const w of layout.walls) {
    const { length } = edgePlacementBetween(w.from, w.to);
    const edge = createSchoolEdge(context, { kind: w.kind, length, height: h, id: w.id });
    placeBetween(edge, w.from, w.to);
    group.add(edge);
  }

  for (const s of layout.shutters) {
    const { length } = edgePlacementBetween(s.from, s.to);
    const edge = createSchoolEdge(context, {
      kind: s.kind,
      length,
      height: h,
      id: s.id,
      closed: shuttersClosed,
    });
    placeBetween(edge, s.from, s.to);
    group.add(edge);
    if (s.kind === "fireShutter") shutters.push(edge);
  }

  for (const l of layout.lintels) {
    const { length } = edgePlacementBetween(l.from, l.to);
    const lintel = createLintel(context, l.id, length, l.bottom, h);
    placeBetween(lintel, l.from, l.to);
    group.add(lintel);
  }

  for (const p of layout.posts) {
    const post = createSchoolPost(context, { height: h, id: p.id });
    place(post, { x: p.x, z: p.z, rotationY: 0 });
    group.add(post);
  }

  for (const b of layout.blocks) {
    const block = createSchoolBlock(context, {
      width: b.rect.maxX - b.rect.minX,
      depth: b.rect.maxZ - b.rect.minZ,
      height: h,
      id: b.id,
    });
    place(block, {
      x: (b.rect.minX + b.rect.maxX) / 2,
      z: (b.rect.minZ + b.rect.maxZ) / 2,
      rotationY: 0,
    });
    group.add(block);
  }

  return { group, shutters };
}

/**
 * SchoolPlan（既定はデモの校舎）の 1 つ目の階から校舎の空間を作る．
 * 開始位置は訓練の開始地点のマスの中心，向きは開始時の向き
 */
export function createSchoolScene(
  options: SpaceBuildOptions,
  plan: SchoolPlan = DEMO_SCHOOL,
  sceneOptions: SchoolSceneOptions = {},
): SchoolSpace {
  const layout = schoolPlanLayout(plan);
  const context = createSchoolPartContext(options.maxAnisotropy);
  const root = new THREE.Group();
  root.name = "school";

  const { group: partsGroup, shutters } = buildParts(
    context,
    layout,
    sceneOptions.shuttersClosed ?? true,
  );
  const byId = new Map<string, THREE.Group>();
  for (const child of partsGroup.children) {
    if (child instanceof THREE.Group) byId.set(child.name, child);
  }
  root.add(partsGroup);
  root.add(createGround(layout));

  // 確認用の空間と同じく，影は使わずに半球光と平行光で室内も同じ明るさにする
  const hemisphere = new THREE.HemisphereLight(0xffffff, 0x8a7a66, 1.6);
  hemisphere.name = "ambient";
  const sun = new THREE.DirectionalLight(0xfff4e0, 1.2);
  sun.position.set(-10, 20, 12);
  sun.name = "sun";
  root.add(hemisphere, sun);

  const mergeStats = mergeStaticMeshes(partsGroup, isDynamicSchoolObject);

  // 矢印と火と煙は parts の外（root の直下）に置き，結合の対象にしない（それぞれ自分で解放するため）
  const routeArrows = createRouteArrows(plan);
  if (routeArrows) root.add(routeArrows.object);
  const fireSmoke = createFireSmoke(plan, computeSpread(plan));
  root.add(fireSmoke.object);

  return {
    id: "school",
    root,
    startPosition: new THREE.Vector3(layout.start.x, SCHOOL_EYE_HEIGHT.standing, layout.start.z),
    startYaw: layout.start.yaw,
    background: SCHOOL_PARTS_BACKGROUND,
    plan,
    layout,
    parts: { parts: partsGroup, shutters, byId, mergeStats },
    routeArrows,
    fireSmoke,
    fog: fireSmoke.fog,
    update: (frame) => {
      fireSmoke.update(frame.seconds, frame.eye);
    },
    dispose: () => {
      // 矢印と火と煙は自分の dispose で解放する（火と煙の uniforms のテクスチャは disposeObjectTree では見つからないため）．
      // 二重に解放しないよう root から外してから残りをまとめて解放する
      if (routeArrows) {
        root.remove(routeArrows.object);
        routeArrows.dispose();
      }
      root.remove(fireSmoke.object);
      fireSmoke.dispose();
      disposeObjectTree(root);
      disposeSchoolPartContext(context);
    },
  };
}
