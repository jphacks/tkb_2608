// エレベーターの設備のうち，後で触れる・動かす・表示を変える対象になる物．1 つずつ独立した Group として作る
// （操作盤とボタン・手すり・扉と扉 1 枚ずつ・階の表示・照明）

import * as THREE from "three";
import { createFurnitureGroup } from "../common/furnitureGroup";
import { createBox, mergeBoxes } from "../common/meshHelpers";
import { slidingLeafX } from "../common/slidingDoor";
import { wallPointToWorld } from "../common/wallLayout";
import {
  CABIN,
  CABIN_DOOR,
  CABIN_DOOR_ID,
  CABIN_DOOR_LEAVES,
  CABIN_DOOR_OPENING,
  CABIN_WALLS,
  type CabinLightUserData,
  CEILING_LIGHT,
  type ControlPanelDef,
  type ControlPanelUserData,
  ELEVATOR_BUTTONS,
  type ElevatorButtonDef,
  type ElevatorButtonKey,
  type ElevatorButtonUserData,
  type ElevatorDoorLeafUserData,
  type ElevatorDoorUserData,
  type ElevatorHandrailDef,
  type ElevatorHandrailUserData,
  EMERGENCY_LIGHT,
  FLOOR_INDICATOR,
  FLOOR_INDICATOR_ID,
  type FloorIndicatorUserData,
  HANDRAIL,
  type IndicatorDirection,
  PANEL,
} from "./elevatorLayout";
import type { ElevatorMaterials } from "./elevatorMaterials";
import { buttonLabelURange, drawFloorIndicator } from "./elevatorTextures";

/** 設備を作るときに共有する部品（ジオメトリは使い回し，scale で大きさを変える） */
export interface FixtureContext {
  /** 単位立方体（1×1×1） */
  readonly unitBox: THREE.BufferGeometry;
  /** 単位円柱（直径 1・高さ 1） */
  readonly unitCylinder: THREE.BufferGeometry;
  /** 単位の板（1×1．+Z 向き） */
  readonly unitPlane: THREE.BufferGeometry;
  readonly materials: ElevatorMaterials;
  /** 形が同じ部品をまとめたジオメトリのキャッシュ（キーごとに 1 つだけ作って共有する） */
  readonly geometryCache: Map<string, THREE.BufferGeometry>;
}

function cached(
  ctx: FixtureContext,
  key: string,
  build: () => THREE.BufferGeometry,
): THREE.BufferGeometry {
  let geometry = ctx.geometryCache.get(key);
  if (!geometry) {
    geometry = build();
    ctx.geometryCache.set(key, geometry);
  }
  return geometry;
}

function mesh(geometry: THREE.BufferGeometry, material: THREE.Material, name = ""): THREE.Mesh {
  const m = new THREE.Mesh(geometry, material);
  m.name = name;
  return m;
}

// ---- 操作盤とボタン ----

/**
 * ボタンの面（直径 1 の円の板．+Z 向き）．UV をラベルのテクスチャの key のマスに合わせる．
 * key ごとに 1 つだけ作り，両方の操作盤で共有する
 */
function buttonFaceGeometry(key: ElevatorButtonKey): THREE.BufferGeometry {
  const geometry = new THREE.CircleGeometry(0.5, 24);
  const { u0, u1 } = buttonLabelURange(key);
  const uv = geometry.getAttribute("uv");
  for (let i = 0; i < uv.count; i++) uv.setX(i, u0 + uv.getX(i) * (u1 - u0));
  return geometry;
}

/**
 * ボタン 1 つ（台座の円柱＋文字を描いた面の 2 Mesh）．Group 原点は板の上の付け根の中心，正面がローカル +Z．
 * 押し込みは Group の position.z，点灯は setElevatorButtonLit で面のマテリアルを差し替える
 */
export function createElevatorButton(def: ElevatorButtonDef, ctx: FixtureContext): THREE.Group {
  const group = new THREE.Group();
  group.name = def.id;
  group.position.set(...def.localPosition);
  const faceName = `${def.id}-face`;
  const userData: ElevatorButtonUserData = {
    id: def.id,
    kind: "elevatorButton",
    panelId: def.panelId,
    key: def.key,
    action: def.action,
    floor: def.floor,
    diameter: def.diameter,
    faceName,
    pressed: false,
    lit: false,
  };
  group.userData = userData;
  const body = mesh(ctx.unitCylinder, ctx.materials.buttonBody, `${def.id}-body`);
  // 円柱の軸（Y）を Z へ倒し，板から buttonDepth だけ出す
  body.scale.set(def.diameter + 0.008, PANEL.buttonDepth, def.diameter + 0.008);
  body.rotation.x = Math.PI / 2;
  body.position.z = PANEL.buttonDepth / 2;
  const face = mesh(
    cached(ctx, `button-face-${def.key}`, () => buttonFaceGeometry(def.key)),
    ctx.materials.buttonFace,
    faceName,
  );
  face.scale.set(def.diameter, def.diameter, 1);
  face.position.z = PANEL.buttonDepth + 0.001;
  group.add(body, face);
  return group;
}

/** ボタンの点灯を切り替える（userData.lit と面のマテリアルを合わせて変える） */
export function setElevatorButtonLit(
  button: THREE.Object3D,
  lit: boolean,
  materials: Pick<ElevatorMaterials, "buttonFace" | "buttonLit">,
): void {
  const data = button.userData as ElevatorButtonUserData;
  data.lit = lit;
  const face = button.getObjectByName(data.faceName);
  if (face instanceof THREE.Mesh) face.material = lit ? materials.buttonLit : materials.buttonFace;
}

/**
 * 操作盤 1 枚（板 1 Mesh＋ボタンの子 Group）．Group 原点は板の中心の壁面上，正面がローカル +Z．
 * 板の大きさとボタンの並びは def.layout（縦型・横型）．板の表にスピーカーの格子と定員・積載量を描いている
 */
export function createControlPanel(
  def: ControlPanelDef,
  ctx: FixtureContext,
): { panel: THREE.Group; buttons: THREE.Group[] } {
  const panel = new THREE.Group();
  panel.name = def.id;
  panel.position.set(...def.position);
  panel.rotation.y = def.rotationY;
  const buttons = ELEVATOR_BUTTONS.filter((b) => b.panelId === def.id).map((b) =>
    createElevatorButton(b, ctx),
  );
  const userData: ControlPanelUserData = {
    id: def.id,
    kind: "controlPanel",
    role: def.role,
    layout: def.layout.name,
    buttonIds: buttons.map((b) => b.name),
  };
  panel.userData = userData;
  const { layout } = def;
  // 板（表の面だけテクスチャ．側面は同じマテリアルで細いので気にならない）
  panel.add(
    createBox(
      ctx.unitBox,
      ctx.materials.panelPlate[layout.name],
      [layout.width, layout.top - layout.bottom, PANEL.depth],
      [0, 0, PANEL.depth / 2],
      `${def.id}-plate`,
    ),
    ...buttons,
  );
  return { panel, buttons };
}

// ---- 手すり ----

/** 横の手すり（丸棒 1 Mesh＋支えの腕 2 本を 1 Mesh）．Group 原点は棒の中心，ローカル X が棒の向き */
export function createHandrail(def: ElevatorHandrailDef, ctx: FixtureContext): THREE.Group {
  const group = createFurnitureGroup(def);
  const userData: ElevatorHandrailUserData = {
    ...(group.userData as ElevatorHandrailUserData),
    wall: def.wall,
    grabbed: false,
  };
  group.userData = userData;
  const length = def.size.x;
  const bar = mesh(ctx.unitCylinder, ctx.materials.handrail, `${def.id}-bar`);
  // 円柱の軸（Y）を X へ倒す
  bar.scale.set(HANDRAIL.diameter, length, HANDRAIL.diameter);
  bar.rotation.z = Math.PI / 2;
  const s = HANDRAIL.bracketSize;
  const brackets = cached(ctx, `handrail-brackets-${length.toFixed(3)}`, () =>
    mergeBoxes(
      [-1, 1].map((sign) => ({
        size: [s, s, HANDRAIL.standoff] as const,
        position: [sign * (length / 2 - HANDRAIL.bracketInset), 0, -HANDRAIL.standoff / 2] as const,
      })),
    ),
  );
  group.add(bar, mesh(brackets, ctx.materials.frame, `${def.id}-brackets`));
  return group;
}

// ---- 扉 ----

/**
 * かごの扉（Group 原点は正面の壁面上の開口部の下端中央．ローカル X が壁に沿う向き，+Z がかごの内側）．
 * 扉 2 枚は独立した子 Group で，壁の外側（乗り場側）をローカル X に滑る．三方枠は別の構造（createCabinShell 側）
 */
export function createCabinDoor(ctx: FixtureContext): { door: THREE.Group; leaves: THREE.Group[] } {
  const { u0, u1, v0, v1 } = CABIN_DOOR_OPENING;
  const door = new THREE.Group();
  door.name = CABIN_DOOR_ID;
  door.position.set(...wallPointToWorld(CABIN_WALLS.front, (u0 + u1) / 2, 0));
  door.rotation.y = CABIN_WALLS.front.rotationY;
  const leafHeight = CABIN_DOOR.height - CABIN_DOOR.leafBottom;

  const leaves = CABIN_DOOR_LEAVES.map((leafDef) => {
    const id = `${CABIN_DOOR_ID}-${leafDef.suffix}`;
    const leaf = new THREE.Group();
    leaf.name = id;
    leaf.position.set(slidingLeafX(leafDef, 0), 0, -CABIN_DOOR.leafOffset);
    const userData: ElevatorDoorLeafUserData = {
      ...leafDef,
      id,
      kind: "doorLeaf",
      doorId: CABIN_DOOR_ID,
      size: { x: leafDef.width, y: CABIN_DOOR.height, z: CABIN_DOOR.leafThickness },
      slideAxis: "x",
      openAmount: 0,
    };
    leaf.userData = userData;
    leaf.add(
      createBox(
        ctx.unitBox,
        ctx.materials.doorLeaf,
        [leafDef.width, leafHeight, CABIN_DOOR.leafThickness],
        [0, CABIN_DOOR.leafBottom + leafHeight / 2, 0],
        `${id}-panel`,
      ),
    );
    return leaf;
  });

  const userData: ElevatorDoorUserData = {
    id: CABIN_DOOR_ID,
    kind: "elevatorDoor",
    width: u1 - u0,
    height: v1 - v0,
    leafIds: leaves.map((leaf) => leaf.name),
    openStyle: "slide",
    open: false,
    openAmount: 0,
    locked: false,
  };
  door.userData = userData;
  door.add(...leaves);
  return { door, leaves };
}

// ---- 階の表示 ----

/** 扉の上の階の表示（枠の箱＋画面の板）．Group 原点は正面の壁面上の表示の中心 */
export function createFloorIndicator(ctx: FixtureContext): THREE.Group {
  const group = new THREE.Group();
  group.name = FLOOR_INDICATOR_ID;
  const { u0, u1 } = CABIN_DOOR_OPENING;
  group.position.set(
    ...wallPointToWorld(CABIN_WALLS.front, (u0 + u1) / 2, FLOOR_INDICATOR.centerY),
  );
  group.rotation.y = CABIN_WALLS.front.rotationY;
  const screenName = `${FLOOR_INDICATOR_ID}-screen`;
  const userData: FloorIndicatorUserData = {
    id: FLOOR_INDICATOR_ID,
    kind: "floorIndicator",
    screenName,
    currentFloor: 1,
    direction: "none",
  };
  group.userData = userData;
  const { width, height, depth, bezel } = FLOOR_INDICATOR;
  const screen = mesh(ctx.unitPlane, ctx.materials.indicatorScreen, screenName);
  screen.scale.set(width - bezel * 2, height - bezel * 2, 1);
  screen.position.z = depth + 0.001;
  group.add(
    createBox(
      ctx.unitBox,
      ctx.materials.indicatorHousing,
      [width, height, depth],
      [0, 0, depth / 2],
      `${FLOOR_INDICATOR_ID}-housing`,
    ),
    screen,
  );
  return group;
}

/**
 * 階の表示を変えて描き直す（userData の currentFloor・direction も合わせる）．
 * 画面の canvas テクスチャに描くため，呼ぶたびに GPU へ再転送される（毎フレームではなく変わった時だけ呼ぶ）
 */
export function setFloorIndicator(
  indicator: THREE.Object3D,
  floor: number,
  direction: IndicatorDirection,
): void {
  const data = indicator.userData as FloorIndicatorUserData;
  data.currentFloor = floor;
  data.direction = direction;
  const screen = indicator.getObjectByName(data.screenName);
  if (!(screen instanceof THREE.Mesh)) return;
  const map = (screen.material as THREE.MeshBasicMaterial).map;
  const canvas = map?.image as HTMLCanvasElement | undefined;
  const ctx = canvas?.getContext("2d");
  if (!map || !ctx) return;
  drawFloorIndicator(ctx, floor, direction);
  map.needsUpdate = true;
}

// ---- 照明 ----

/**
 * かごの照明（天井の照明パネル ceiling-light と非常灯 emergency-light）．
 * 発光の板と PointLight を子に持つ独立した Group．非常灯は既定で消灯（intensity 0）
 */
export function createCabinLights(ctx: FixtureContext): THREE.Group[] {
  const make = (
    id: string,
    kind: CabinLightUserData["kind"],
    size: { width: number; depth: number; thickness: number },
    position: readonly [number, number],
    material: THREE.Material,
    intensity: number,
    on: boolean,
  ): THREE.Group => {
    const group = new THREE.Group();
    group.name = id;
    group.position.set(position[0], CABIN.height, position[1]);
    const panelName = `${id}-panel`;
    const lightName = `${id}-source`;
    const userData: CabinLightUserData = {
      id,
      kind,
      emergency: kind === "emergencyLight",
      intensity,
      lightName,
      panelName,
      on,
    };
    group.userData = userData;
    const light = new THREE.PointLight(0xffffff, on ? intensity : 0, 0, 2);
    light.name = lightName;
    light.position.y = -CEILING_LIGHT.lightDrop;
    group.add(
      createBox(
        ctx.unitBox,
        material,
        [size.width, size.thickness, size.depth],
        [0, -size.thickness / 2, 0],
        panelName,
      ),
      light,
    );
    return group;
  };
  return [
    make(
      "ceiling-light",
      "ceilingLight",
      CEILING_LIGHT,
      [0, CEILING_LIGHT.z],
      ctx.materials.lightPanel,
      CEILING_LIGHT.intensity,
      true,
    ),
    make(
      "emergency-light",
      "emergencyLight",
      EMERGENCY_LIGHT,
      [EMERGENCY_LIGHT.x, EMERGENCY_LIGHT.z],
      ctx.materials.emergencyPanel,
      EMERGENCY_LIGHT.intensity,
      false,
    ),
  ];
}
