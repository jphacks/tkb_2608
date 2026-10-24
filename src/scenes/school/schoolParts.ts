// 校舎のパーツ（床の面・辺に置く物・柱）の three.js の Group を作る．寸法は schoolLayout.ts の純粋な関数から出す．
// マテリアルと単位立方体は SchoolPartContext で全パーツが共有し，パーツの中の同じ材質の箱は 1 つのジオメトリに結合する

import * as THREE from "three";
import { createBox, mergeBoxes } from "../common/meshHelpers";
import { slidingLeafX } from "../common/slidingDoor";
import type { WallDef, WallRect } from "../common/wallLayout";
import { createMergedWall } from "../common/wallMeshes";
import {
  type BoxSpec,
  DOOR,
  doorLeafLayout,
  type EdgeKind,
  type EdgeLayout,
  type EdgeOptions,
  EXIT,
  edgeLayout,
  edgeLocalX,
  FIRE_SHUTTER,
  type FireShutterUserData,
  type FloorKind,
  type FloorSurfaceUserData,
  floorSurfaceLayout,
  POST_SIZE,
  type SchoolBlockUserData,
  type SchoolDoorLeafUserData,
  type SchoolDoorUserData,
  type SchoolEdgeUserData,
  type SchoolPostUserData,
  tileRepeat,
  WALL_THICKNESS,
  WINDOW,
  type WindowGlass,
} from "./schoolLayout";
import {
  createSchoolMaterials,
  disposeSchoolMaterials,
  type SchoolMaterials,
} from "./schoolMaterials";
import { SCHOOL_TILE_SIZE } from "./schoolTextures";

/** パーツ間で共有するマテリアルと単位立方体 */
export interface SchoolPartContext {
  readonly materials: SchoolMaterials;
  readonly unitBox: THREE.BoxGeometry;
}

/** 共有のマテリアルと単位立方体を作る（1 つの空間で 1 回だけ作る） */
export function createSchoolPartContext(maxAnisotropy: number): SchoolPartContext {
  return {
    materials: createSchoolMaterials(maxAnisotropy),
    unitBox: new THREE.BoxGeometry(1, 1, 1),
  };
}

/** 共有のマテリアル・テクスチャ・単位立方体を解放する */
export function disposeSchoolPartContext(context: SchoolPartContext): void {
  disposeSchoolMaterials(context.materials);
  context.unitBox.dispose();
}

/** 開閉で表示や位置を変えるため，空間の静的な結合（mergeStaticSchoolMeshes）から外す物の kind */
const DYNAMIC_KINDS: ReadonlySet<string> = new Set([
  "schoolDoorLeaf",
  "fireShutterCurtain",
  "fireShutterOpenBar",
]);

/** 開閉で動く・表示が変わる物（引き戸の扉・シャッターの幕と座板）か */
export function isDynamicSchoolObject(object: THREE.Object3D): boolean {
  const kind = (object.userData as { kind?: unknown }).kind;
  return typeof kind === "string" && DYNAMIC_KINDS.has(kind);
}

function mergedMesh(
  boxes: readonly BoxSpec[],
  material: THREE.Material,
  name: string,
): THREE.Mesh | null {
  if (boxes.length === 0) return null;
  const mesh = new THREE.Mesh(mergeBoxes(boxes), material);
  mesh.name = name;
  return mesh;
}

function addAll(group: THREE.Group, objects: readonly (THREE.Object3D | null)[]): void {
  for (const object of objects) if (object) group.add(object);
}

// ---------------------------------------------------------------------------
// 床の面

/** 床の面の作り方 */
export interface FloorSurfaceOptions {
  readonly kind: FloorKind;
  /** 幅（ローカル X．m） */
  readonly width: number;
  /** 奥行き（ローカル Z．m） */
  readonly depth: number;
  /** 天井の高さ（m） */
  readonly ceilingHeight: number;
  readonly id?: string;
  /** 天井の照明を付けるか（既定 true．中が見えない外側だけの教室では省く） */
  readonly lights?: boolean;
}

/** 水平の板（UV は tileSize ごとに整数回の繰り返し）．上向き（床）か下向き（天井） */
function tiledPlane(
  width: number,
  depth: number,
  tileSize: number,
  y: number,
  facingUp: boolean,
  material: THREE.Material,
  name: string,
): THREE.Mesh {
  const geometry = new THREE.PlaneGeometry(width, depth);
  const repeatX = tileRepeat(width, tileSize);
  const repeatZ = tileRepeat(depth, tileSize);
  const uv = geometry.getAttribute("uv");
  for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * repeatX, uv.getY(i) * repeatZ);
  const mesh = new THREE.Mesh(geometry, material);
  mesh.rotation.x = facingUp ? -Math.PI / 2 : Math.PI / 2;
  mesh.position.y = y;
  mesh.name = name;
  return mesh;
}

/**
 * 床の面（床・天井・天井の照明）．原点は面の中心の床の上，幅がローカル X，奥行きがローカル Z．
 * 教室と廊下で床・天井の見た目を分ける
 */
export function createFloorSurface(
  context: SchoolPartContext,
  options: FloorSurfaceOptions,
): THREE.Group {
  const { kind, width, depth, ceilingHeight } = options;
  const id = options.id ?? `${kind}-floor`;
  const layout = floorSurfaceLayout(kind, width, depth, ceilingHeight);
  const m = context.materials;
  const isClassroom = kind === "classroom";
  const group = new THREE.Group();
  group.name = id;
  const userData: FloorSurfaceUserData = {
    kind: "schoolFloor",
    id,
    floorKind: kind,
    width,
    depth,
    ceilingHeight,
  };
  group.userData = userData;
  addAll(group, [
    tiledPlane(
      width,
      depth,
      isClassroom ? SCHOOL_TILE_SIZE.classroomFloor : SCHOOL_TILE_SIZE.corridorFloor,
      0,
      true,
      isClassroom ? m.classroomFloor : m.corridorFloor,
      `${id}-floor`,
    ),
    tiledPlane(
      width,
      depth,
      isClassroom ? SCHOOL_TILE_SIZE.classroomCeiling : SCHOOL_TILE_SIZE.corridorCeiling,
      ceilingHeight,
      false,
      isClassroom ? m.classroomCeiling : m.corridorCeiling,
      `${id}-ceiling`,
    ),
    options.lights === false ? null : mergedMesh(layout.lights, m.ceilingLight, `${id}-lights`),
  ]);
  return group;
}

// ---------------------------------------------------------------------------
// 辺に置く物

/** 辺に置く物の作り方 */
export interface EdgeBuildOptions extends EdgeOptions {
  readonly kind: EdgeKind;
  /** 辺の長さ（m．両端の柱の中心の間） */
  readonly length: number;
  /** 天井の高さ（m） */
  readonly height: number;
  readonly id?: string;
  /** 窓付きの壁・ドアの窓のガラス（既定 clear．外側だけの教室の廊下側は frosted） */
  readonly glass?: WindowGlass;
  /** ドアを開かないようにする（外側だけの教室のドア．閉じたまま通れない） */
  readonly locked?: boolean;
  /** ドアを開けた状態で作る（locked なら無視して閉じる） */
  readonly open?: boolean;
  /** 防火シャッターを閉じた状態で作る（既定 false） */
  readonly closed?: boolean;
}

/** 壁の板の上の矩形を，奥行き depth（中心はローカル Z の z）の直方体にする */
function rectBox(layout: EdgeLayout, rect: WallRect, depth: number, z = 0): BoxSpec {
  return {
    size: [rect.u1 - rect.u0, rect.v1 - rect.v0, depth],
    position: [edgeLocalX(layout.length, (rect.u0 + rect.u1) / 2), (rect.v0 + rect.v1) / 2, z],
  };
}

const BASEBOARD_HEIGHT = 0.08;
/** 枠・幅木が壁の面から出る量（m．壁の面と重ならないようにする） */
const TRIM_PROTRUSION = 0.01;

/** 壁の板と幅木（床に接する板の下端）の Mesh */
function wallMeshes(context: SchoolPartContext, layout: EdgeLayout, id: string): THREE.Mesh[] {
  const m = context.materials;
  const walls = layout.wallRects.map((rect) => rectBox(layout, rect, WALL_THICKNESS));
  const baseboards = layout.wallRects
    .filter((rect) => rect.v0 === 0)
    .map((rect) =>
      rectBox(layout, { ...rect, v1: BASEBOARD_HEIGHT }, WALL_THICKNESS + 2 * TRIM_PROTRUSION),
    );
  return [
    mergedMesh(walls, m.wall, `${id}-wall`),
    mergedMesh(baseboards, m.baseboard, `${id}-baseboard`),
  ].filter((mesh): mesh is THREE.Mesh => mesh !== null);
}

/** 開口部の枠（両面に少し出る．withSill なら下枠も） */
function openingTrim(
  layout: EdgeLayout,
  rect: WallRect,
  width: number,
  withSill: boolean,
): BoxSpec[] {
  const depth = WALL_THICKNESS + 2 * TRIM_PROTRUSION;
  const v0 = withSill ? rect.v0 - width : rect.v0;
  const v1 = rect.v1 + width;
  const boxes = [
    rectBox(layout, { u0: rect.u0 - width, u1: rect.u0, v0, v1 }, depth),
    rectBox(layout, { u0: rect.u1, u1: rect.u1 + width, v0, v1 }, depth),
    rectBox(layout, { u0: rect.u0, u1: rect.u1, v0: rect.v1, v1 }, depth),
  ];
  if (withSill) boxes.push(rectBox(layout, { u0: rect.u0, u1: rect.u1, v0, v1: rect.v0 }, depth));
  return boxes;
}

function edgeGroup(id: string, userData: SchoolEdgeUserData): THREE.Group {
  const group = new THREE.Group();
  group.name = id;
  group.userData = userData;
  return group;
}

function glassMaterial(context: SchoolPartContext, glass: WindowGlass): THREE.Material {
  return glass === "frosted" ? context.materials.frostedGlass : context.materials.glass;
}

function createPlainWall(context: SchoolPartContext, layout: EdgeLayout, id: string): THREE.Group {
  const group = edgeGroup(id, {
    kind: "schoolEdge",
    id,
    edgeKind: "wall",
    length: layout.length,
    height: layout.height,
  });
  addAll(group, wallMeshes(context, layout, id));
  return group;
}

function createWindowWall(
  context: SchoolPartContext,
  layout: EdgeLayout,
  id: string,
  glass: WindowGlass,
): THREE.Group {
  const group = edgeGroup(id, {
    kind: "schoolEdge",
    id,
    edgeKind: "windowWall",
    length: layout.length,
    height: layout.height,
    glass,
  });
  const frames = layout.openings.flatMap((rect) => [
    ...openingTrim(layout, rect, WINDOW.frameWidth, true),
    // 引き違いの 2 枚の召し合わせ（中央の縦の桟）
    rectBox(
      layout,
      {
        u0: (rect.u0 + rect.u1) / 2 - 0.02,
        u1: (rect.u0 + rect.u1) / 2 + 0.02,
        v0: rect.v0,
        v1: rect.v1,
      },
      0.06,
    ),
  ]);
  const panes = layout.openings.map((rect) => rectBox(layout, rect, 0.01));
  addAll(group, [
    ...wallMeshes(context, layout, id),
    mergedMesh(frames, context.materials.frame, `${id}-frames`),
    mergedMesh(panes, glassMaterial(context, glass), `${id}-glass`),
  ]);
  return group;
}

/** 引き戸の扉 1 枚（下は板，上はガラスの小窓．原点は扉の下端の中心） */
function createDoorLeafMeshes(
  context: SchoolPartContext,
  width: number,
  height: number,
  glass: WindowGlass,
  name: string,
): THREE.Mesh[] {
  const t = DOOR.leafThickness;
  const lower = 1.1;
  const rail = 0.1;
  const stile = 0.1;
  const body: BoxSpec[] = [
    { size: [width, lower, t], position: [0, lower / 2, 0] },
    { size: [width, rail, t], position: [0, height - rail / 2, 0] },
    ...[-1, 1].map(
      (side): BoxSpec => ({
        size: [stile, height - lower - rail, t],
        position: [side * (width / 2 - stile / 2), (lower + height - rail) / 2, 0],
      }),
    ),
    // 取っ手（両面のくぼみの代わりの小さな箱）
    { size: [0.03, 0.15, t + 0.02], position: [-width / 2 + 0.08, 1.0, 0] },
  ];
  const pane: BoxSpec = {
    size: [width - 2 * stile, height - lower - rail, 0.01],
    position: [0, (lower + height - rail) / 2, 0],
  };
  return [
    mergedMesh(body, context.materials.doorLeaf, `${name}-body`),
    mergedMesh([pane], glassMaterial(context, glass), `${name}-glass`),
  ].filter((mesh): mesh is THREE.Mesh => mesh !== null);
}

function createClassroomDoor(
  context: SchoolPartContext,
  layout: EdgeLayout,
  id: string,
  options: EdgeBuildOptions,
): THREE.Group {
  const locked = options.locked ?? false;
  const open = !locked && (options.open ?? false);
  const leafName = `${id}-leaf`;
  const userData: SchoolDoorUserData = {
    kind: "schoolEdge",
    id,
    edgeKind: "door",
    length: layout.length,
    height: layout.height,
    open,
    openAmount: open ? 1 : 0,
    locked,
    leafName,
  };
  const group = edgeGroup(id, userData);
  const opening = layout.openings[0];
  const trim = opening ? openingTrim(layout, opening, DOOR.frameWidth, false) : [];
  addAll(group, [
    ...wallMeshes(context, layout, id),
    mergedMesh(trim, context.materials.frame, `${id}-frame`),
  ]);

  const leafLayout = doorLeafLayout(layout);
  const leaf = new THREE.Group();
  leaf.name = leafName;
  const leafData: SchoolDoorLeafUserData = {
    kind: "schoolDoorLeaf",
    doorId: id,
    closedX: leafLayout.closedX,
    slideDirection: leafLayout.slideDirection,
    slideDistance: leafLayout.slideDistance,
    openAmount: userData.openAmount,
  };
  leaf.userData = leafData;
  leaf.position.set(slidingLeafX(leafData, leafData.openAmount), 0, leafLayout.z);
  addAll(
    leaf,
    createDoorLeafMeshes(
      context,
      leafLayout.width,
      leafLayout.height,
      locked ? "frosted" : (options.glass ?? "clear"),
      leafName,
    ),
  );
  group.add(leaf);
  return group;
}

function createExit(context: SchoolPartContext, layout: EdgeLayout, id: string): THREE.Group {
  const m = context.materials;
  const group = edgeGroup(id, {
    kind: "schoolEdge",
    id,
    edgeKind: "exit",
    length: layout.length,
    height: layout.height,
  });
  const opening = layout.openings[0];
  if (!opening) throw new Error("出口の開口部がありません");
  const openingWidth = opening.u1 - opening.u0;
  const centerX = edgeLocalX(layout.length, (opening.u0 + opening.u1) / 2);
  const outerWidth = Math.min(openingWidth + 1, layout.wallLength);
  const outsideZ = -WALL_THICKNESS / 2;
  const canopyY =
    Math.min(EXIT.height + EXIT.canopyRise, layout.height - EXIT.canopyThickness) +
    EXIT.canopyThickness / 2;
  addAll(group, [
    ...wallMeshes(context, layout, id),
    mergedMesh(openingTrim(layout, opening, EXIT.frameWidth, false), m.frame, `${id}-frame`),
    // 敷居（またげる高さ）と外のポーチ（地面より少し高い土間）
    mergedMesh(
      [
        { size: [openingWidth, 0.02, WALL_THICKNESS], position: [centerX, 0.01, 0] },
        {
          size: [outerWidth, 0.03, EXIT.apronDepth],
          position: [centerX, -0.01, outsideZ - EXIT.apronDepth / 2],
        },
      ],
      m.concrete,
      `${id}-apron`,
    ),
    mergedMesh(
      [
        {
          size: [outerWidth, EXIT.canopyThickness, EXIT.canopyDepth],
          position: [centerX, canopyY, outsideZ - EXIT.canopyDepth / 2],
        },
      ],
      m.canopy,
      `${id}-canopy`,
    ),
    // 内側（+Z の面）の開口部の上の誘導灯
    mergedMesh(
      [
        {
          size: [EXIT.signWidth, EXIT.signHeight, 0.03],
          position: [
            centerX,
            EXIT.height + EXIT.frameWidth + 0.05 + EXIT.signHeight / 2,
            WALL_THICKNESS / 2 + 0.015,
          ],
        },
      ],
      m.exitSign,
      `${id}-exit-sign`,
    ),
  ]);
  return group;
}

function createFireShutter(
  context: SchoolPartContext,
  layout: EdgeLayout,
  id: string,
  options: EdgeBuildOptions,
): THREE.Group {
  const m = context.materials;
  const shutter = layout.shutter;
  if (!shutter) throw new Error("防火シャッターの寸法がありません");
  const closed = options.closed ?? false;
  const curtainName = `${id}-curtain`;
  const openBarName = `${id}-open-bar`;
  const { wicket } = shutter;
  const userData: FireShutterUserData = {
    kind: "schoolEdge",
    id,
    edgeKind: "fireShutter",
    length: layout.length,
    height: layout.height,
    closed,
    wicket: {
      centerX: shutter.wicketCenterX,
      bottom: wicket.v0,
      width: wicket.u1 - wicket.u0,
      height: wicket.v1 - wicket.v0,
    },
    wicketOpen: false,
    wicketOffset: options.wicketOffset ?? 0,
    curtainName,
    openBarName,
  };
  const group = edgeGroup(id, userData);
  const boxY = layout.height - FIRE_SHUTTER.boxHeight / 2;
  addAll(group, [
    mergedMesh(
      [
        {
          size: [layout.wallLength, FIRE_SHUTTER.boxHeight, FIRE_SHUTTER.boxDepth],
          position: [0, boxY, 0],
        },
        ...shutter.rails.map((rect) => rectBox(layout, rect, FIRE_SHUTTER.railDepth)),
      ],
      m.shutterBox,
      `${id}-box`,
    ),
  ]);

  // 開いた時に収納箱の下に見える座板
  const openBar = createBox(
    context.unitBox,
    m.shutterBox,
    [layout.wallLength - 2 * FIRE_SHUTTER.railWidth, 0.05, 0.05],
    [0, shutter.boxBottom - 0.025, 0],
    openBarName,
  );
  openBar.userData = { kind: "fireShutterOpenBar", shutterId: id };
  openBar.visible = !closed;
  group.add(openBar);

  // 閉じた時の幕（くぐり戸の分を空けた板＋くぐり戸の扉＋取っ手＋座板）
  const curtain = new THREE.Group();
  curtain.name = curtainName;
  curtain.userData = { kind: "fireShutterCurtain", shutterId: id };
  curtain.visible = closed;
  // 幕は辺の線の上の 1 枚の板（両面）．模様が切れ目でつながるよう壁の板と同じ UV の付け方にする
  const curtainWall: WallDef = { ...layout.wall, origin: [-layout.wallLength / 2, 0, 0] };
  const curtainRects: WallRect[] = [
    { u0: 0, u1: wicket.u0, v0: 0, v1: shutter.boxBottom },
    { u0: wicket.u1, u1: layout.wallLength, v0: 0, v1: shutter.boxBottom },
    { u0: wicket.u0, u1: wicket.u1, v0: 0, v1: wicket.v0 },
    { u0: wicket.u0, u1: wicket.u1, v0: wicket.v1, v1: shutter.boxBottom },
  ].filter((r) => r.u1 - r.u0 > 0 && r.v1 - r.v0 > 0);
  const wicketX = shutter.wicketCenterX;
  const wicketW = wicket.u1 - wicket.u0;
  const wicketH = wicket.v1 - wicket.v0;
  addAll(curtain, [
    createMergedWall(
      [[curtainWall, curtainRects]],
      m.shutterCurtain,
      SCHOOL_TILE_SIZE.shutter,
      `${curtainName}-panel`,
    ),
    mergedMesh(
      [
        {
          size: [wicketW, wicketH, FIRE_SHUTTER.curtainThickness],
          position: [wicketX, wicket.v0 + wicketH / 2, 0],
        },
      ],
      m.wicket,
      `${id}-wicket`,
    ),
    mergedMesh(
      [
        { size: [0.12, 0.03, 0.08], position: [wicketX + wicketW / 2 - 0.12, 1.0, 0] },
        { size: [layout.wallLength - 0.02, 0.05, 0.05], position: [0, 0.025, 0] },
      ],
      m.handle,
      `${id}-handle`,
    ),
  ]);
  group.add(curtain);
  return group;
}

/**
 * 辺に置く物（壁・窓付きの壁・ドア・出口・防火シャッター）．原点は辺の中心の床の上で，辺はローカル X に沿う．
 * 長さ・高さが下限より小さければ RangeError（minEdgeLength・MIN_CEILING_HEIGHT）
 */
export function createSchoolEdge(
  context: SchoolPartContext,
  options: EdgeBuildOptions,
): THREE.Group {
  const layout = edgeLayout(options.kind, options.length, options.height, options);
  const id = options.id ?? options.kind;
  switch (options.kind) {
    case "wall":
      return createPlainWall(context, layout, id);
    case "windowWall":
      return createWindowWall(context, layout, id, options.glass ?? "clear");
    case "door":
      return createClassroomDoor(context, layout, id, options);
    case "exit":
      return createExit(context, layout, id);
    case "fireShutter":
      return createFireShutter(context, layout, id, options);
  }
}

/** 引き戸を開ける・閉める（扉の位置と userData を変える）．開かないドア（locked）は変えずに false を返す */
export function setSchoolDoorOpen(door: THREE.Object3D, open: boolean): boolean {
  const data = door.userData as SchoolDoorUserData;
  if (data.locked) return false;
  data.open = open;
  data.openAmount = open ? 1 : 0;
  const leaf = door.getObjectByName(data.leafName);
  if (leaf) {
    const leafData = leaf.userData as SchoolDoorLeafUserData;
    leafData.openAmount = data.openAmount;
    leaf.position.x = slidingLeafX(leafData, data.openAmount);
  }
  return true;
}

/** 防火シャッターを閉じる・開ける（幕と座板の表示と userData を変える） */
export function setFireShutterClosed(shutter: THREE.Object3D, closed: boolean): void {
  const data = shutter.userData as FireShutterUserData;
  data.closed = closed;
  const curtain = shutter.getObjectByName(data.curtainName);
  if (curtain) curtain.visible = closed;
  const bar = shutter.getObjectByName(data.openBarName);
  if (bar) bar.visible = !closed;
}

// ---------------------------------------------------------------------------
// 柱

/** 柱（辺の端点に置く角柱）．原点は端点の床の上 */
export function createSchoolPost(
  context: SchoolPartContext,
  options: { readonly height: number; readonly id?: string },
): THREE.Group {
  const id = options.id ?? "post";
  const group = new THREE.Group();
  group.name = id;
  const userData: SchoolPostUserData = { kind: "schoolPost", id, height: options.height };
  group.userData = userData;
  group.add(
    createBox(
      context.unitBox,
      context.materials.wall,
      [POST_SIZE, options.height, POST_SIZE],
      [0, options.height / 2, 0],
      `${id}-body`,
    ),
  );
  return group;
}

// ---------------------------------------------------------------------------
// マスをふさぐ直方体

/** マス全体をふさぐ直方体（SchoolPlan の `wall` のマス）．原点は底面の中心，幅がローカル X，奥行きがローカル Z */
export function createSchoolBlock(
  context: SchoolPartContext,
  options: {
    readonly width: number;
    readonly depth: number;
    readonly height: number;
    readonly id?: string;
  },
): THREE.Group {
  const { width, depth, height } = options;
  const id = options.id ?? "block";
  const group = new THREE.Group();
  group.name = id;
  const userData: SchoolBlockUserData = { kind: "schoolBlock", id, width, depth, height };
  group.userData = userData;
  group.add(
    createBox(
      context.unitBox,
      context.materials.wall,
      [width, height, depth],
      [0, height / 2, 0],
      `${id}-body`,
    ),
  );
  return group;
}
