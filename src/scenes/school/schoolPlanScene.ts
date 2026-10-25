// SchoolPlan の 1 フロアから組み立てた校舎の空間（?scene=school）．並べ方は schoolPlanLayout.ts の純粋な関数で求め，
// ここでは校舎のパーツ（schoolParts.ts）を置くだけ．動かない Mesh は最後にマテリアルごとに結合する．
// 集合場所の床の印（assemblyMarker.ts）・学習モードの床の矢印（routeArrows.ts）・火と煙（fireSmoke.ts）も足し，火と煙は毎フレームの update で時刻に合わせる．
// 閉じた防火シャッターのくぐり戸も毎フレームの update で目の位置に合わせて開け閉めする（shutterWicket.ts）．
// 赤い表示（common/redEdge.ts）も足す．出す・消すは redEdge.setActive で外（app/）から指示するか，autoRedEdge で自分で判定する

import * as THREE from "three";
import type { SchoolPlan } from "../../core/schoolPlan";
import type { Posture } from "../../core/types";
import { DEMO_SCHOOL } from "../../share/samples/demoSchool";
import { detectErrorBehaviors, type ErrorBehaviors } from "../../sim/errorBehavior";
import { computeSpread, type SpreadMap } from "../../sim/spread";
import { createBox, disposeObjectTree } from "../common/meshHelpers";
import { createRedEdge, type RedEdge } from "../common/redEdge";
import type { Space, SpaceBuildOptions } from "../types";
import { type AssemblyMarker, createAssemblyMarker } from "./assemblyMarker";
import { createFireCellBlockers, type FireCellBlockers } from "./fireCellCollision";
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
  updateFireShutterWicket,
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
  /** 集合場所の床の印（root の子．学習モードでもテストモードでも出す） */
  readonly assemblyMarker: AssemblyMarker;
  /** 床の正解経路の矢印（root の子．テストモードでは null） */
  readonly routeArrows: RouteArrows | null;
  /** 火と煙（root の子．fog は fireSmoke.fog と同じもの） */
  readonly fireSmoke: FireSmoke;
  readonly fog: THREE.FogExp2;
  /** 火と煙が各マスに着く時刻（computeSpread(plan)．赤い表示の判定・燃えているマスの当たり判定と同じもの） */
  readonly spread: SpreadMap;
  /**
   * 赤い表示（root の子）．体験の流れ（app/）からは毎フレーム
   * `space.redEdge.setActive(detectErrorBehaviors(plan, space.spread, sample).any)` で出す・消すを指示する．
   * フェードは update(frame) が frame.dt で進める
   */
  readonly redEdge: RedEdge;
  /** 燃えているマスの当たり判定（WalkWorld.doors に足す．時刻と体の位置は update(frame) が渡す） */
  readonly fireCells: FireCellBlockers;
  /** autoRedEdge の時に直前の update で求めたエラー行動（autoRedEdge でない・まだ求めていない時は null） */
  readonly errorBehaviors: ErrorBehaviors | null;
}

/** Space が SchoolPlan から組み立てた校舎の空間か */
export function isSchoolSpace(space: Space): space is SchoolSpace {
  return space.id === "school" && "layout" in space;
}

/** 校舎の組み立ての追加の指定 */
export interface SchoolSceneOptions {
  /** 防火シャッターを閉じて作るか（既定 true．非常ベルの時点で閉じている扱い．SPEC_02「通れる・燃え広がる」） */
  readonly shuttersClosed?: boolean;
  /**
   * 赤い表示を自分で判定して出すか（既定 false）．true なら毎フレームの update で frame.seconds・frame.eye・frame.posture から
   * detectErrorBehaviors() を呼び，any の間だけ出す（体験の流れ（app/）につながるまでの ?scene=school 単独の確認用）．
   * false なら redEdge.setActive の指示だけに従う
   */
  readonly autoRedEdge?: boolean;
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

  // 集合場所の印と矢印と火と煙は parts の外（root の直下）に置き，結合の対象にしない（それぞれ自分で解放するため）
  const assemblyMarker = createAssemblyMarker(plan);
  root.add(assemblyMarker.object);
  const routeArrows = createRouteArrows(plan);
  if (routeArrows) root.add(routeArrows.object);
  const spread = computeSpread(plan);
  const fireSmoke = createFireSmoke(plan, spread);
  root.add(fireSmoke.object);
  const redEdge = createRedEdge();
  root.add(redEdge.object);
  // 作る校舎は 1 つ目の階だけなので，燃えているマスの当たり判定も 1 つ目の階だけ
  const fireCells = createFireCellBlockers(plan, spread, 0, layout.ceilingHeight);

  const autoRedEdge = sceneOptions.autoRedEdge ?? false;
  // 判定に渡す記録の 1 件（毎フレーム作らずに使い回す．DrillSample と同じ形）
  const sample: { t: number; floor: number; x: number; z: number; posture: Posture } = {
    t: 0,
    floor: 0,
    x: 0,
    z: 0,
    posture: "standing",
  };
  let errorBehaviors: ErrorBehaviors | null = null;

  return {
    id: "school",
    root,
    startPosition: new THREE.Vector3(layout.start.x, SCHOOL_EYE_HEIGHT.standing, layout.start.z),
    startYaw: layout.start.yaw,
    background: SCHOOL_PARTS_BACKGROUND,
    plan,
    layout,
    parts: { parts: partsGroup, shutters, byId, mergeStats },
    assemblyMarker,
    routeArrows,
    fireSmoke,
    fog: fireSmoke.fog,
    spread,
    redEdge,
    fireCells,
    get errorBehaviors() {
      return errorBehaviors;
    },
    update: (frame) => {
      fireCells.update(frame.seconds, frame.eye);
      fireSmoke.update(frame.seconds, frame.eye);
      // 閉じたシャッターのくぐり戸は，目が近づくと開き離れると閉じる（見た目だけ．くぐり戸は常に通れる）
      for (const shutter of shutters) updateFireShutterWicket(shutter, frame.eye, frame.dt);
      if (autoRedEdge) {
        if (frame.eye === null) {
          errorBehaviors = null;
          redEdge.setActive(false);
        } else {
          sample.t = frame.seconds;
          sample.x = frame.eye.x;
          sample.z = frame.eye.z;
          sample.posture = frame.posture ?? "standing";
          errorBehaviors = detectErrorBehaviors(plan, spread, sample);
          redEdge.setActive(errorBehaviors.any);
        }
      }
      redEdge.update(frame.dt);
    },
    dispose: () => {
      // 集合場所の印と矢印と火と煙は自分の dispose で解放する（火と煙の uniforms のテクスチャは disposeObjectTree では見つからないため）．
      // 二重に解放しないよう root から外してから残りをまとめて解放する
      root.remove(assemblyMarker.object);
      assemblyMarker.dispose();
      if (routeArrows) {
        root.remove(routeArrows.object);
        routeArrows.dispose();
      }
      root.remove(fireSmoke.object);
      fireSmoke.dispose();
      root.remove(redEdge.object);
      redEdge.dispose();
      disposeObjectTree(root);
      disposeSchoolPartContext(context);
    },
  };
}
