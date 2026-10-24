// 電車の設備のうち，後で触れる・動かす対象になる物．1 つずつ独立した Group として作る
// （座席・手すり・つり革・ドアと扉・非常用ドアコック・非常通報装置・網棚・荷物）

import * as THREE from "three";
import type { Size3 } from "../common/furniture";
import { createFurnitureGroup } from "../common/furnitureGroup";
import { type BoxPlacement, createBox, mergeBoxes } from "../common/meshHelpers";
import { wallPointToWorld } from "../common/wallLayout";
import {
  DOOR_COCK,
  type DoorCockDef,
  type DoorCockUserData,
  type DoorLeafUserData,
  type DoorUserData,
  GANGWAY_DOOR,
  type HandrailDef,
  type HandrailUserData,
  type LuggageDef,
  type LuggageUserData,
  SEAT,
  type SeatDef,
  type SeatUserData,
  SIDE_DOOR,
  STRAP,
  STRAP_LENGTH,
  type StrapDef,
  type StrapUserData,
  seatFacingYaw,
  seatSlots,
  type TrainDoorDef,
} from "./trainLayout";
import type { TrainMaterials } from "./trainMaterials";

/** 設備を作るときに共有する部品（ジオメトリは使い回し，scale で大きさを変える） */
export interface FixtureContext {
  /** 単位立方体（1×1×1） */
  readonly unitBox: THREE.BufferGeometry;
  /** 単位円柱（直径 1・高さ 1） */
  readonly unitCylinder: THREE.BufferGeometry;
  /** 単位の板（1×1．+Z 向き） */
  readonly unitPlane: THREE.BufferGeometry;
  readonly materials: TrainMaterials;
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

// ---- 座席 ----

/**
 * ロングシート 1 区画（座面＋背もたれ・袖仕切り 2 枚・蹴込みの 3 Mesh）．
 * 原点は床の上の座席の中央，正面（通路側）がローカル +Z
 */
export function createSeat(def: SeatDef, ctx: FixtureContext): THREE.Group {
  const group = createFurnitureGroup(def);
  const userData: SeatUserData = {
    ...(group.userData as SeatUserData),
    side: def.side,
    persons: def.persons,
    slots: seatSlots(def.persons),
    facingYaw: seatFacingYaw(def.rotationY),
  };
  group.userData = userData;

  const { size } = def;
  const back = -size.z / 2;
  const innerLength = def.persons * SEAT.personWidth;
  const key = `seat-${def.persons}`;
  const fabric = cached(ctx, `${key}-fabric`, () =>
    mergeBoxes([
      // 座面（背もたれの前から座面の前端まで）
      {
        size: [innerLength, SEAT.cushionThickness, size.z - SEAT.backThickness],
        position: [
          0,
          SEAT.height - SEAT.cushionThickness / 2,
          back + SEAT.backThickness + (size.z - SEAT.backThickness) / 2,
        ],
      },
      // 背もたれ
      {
        size: [innerLength, SEAT.backTop - SEAT.height, SEAT.backThickness],
        position: [0, (SEAT.height + SEAT.backTop) / 2, back + SEAT.backThickness / 2],
      },
    ]),
  );
  const arms = cached(ctx, `${key}-arms`, () =>
    mergeBoxes(
      [-1, 1].map(
        (sign): BoxPlacement => ({
          size: [SEAT.armThickness, SEAT.armHeight, size.z],
          position: [(sign * (size.x - SEAT.armThickness)) / 2, SEAT.armHeight / 2, 0],
        }),
      ),
    ),
  );
  // 蹴込み（座面の下．少し奥へ引っ込める）
  const baseHeight = SEAT.height - SEAT.cushionThickness;
  const baseDepth = size.z - 0.12;
  group.add(
    mesh(fabric, ctx.materials[def.kind], `${def.id}-cushion`),
    mesh(arms, ctx.materials.seatArm, `${def.id}-arms`),
    createBox(
      ctx.unitBox,
      ctx.materials.seatBase,
      [innerLength, baseHeight, baseDepth],
      [0, baseHeight / 2, back + baseDepth / 2],
      `${def.id}-base`,
    ),
  );
  return group;
}

// ---- 手すり・つり革 ----

/** 縦・横の握り棒（ステンレスの円柱 1 本） */
export function createHandrail(def: HandrailDef, ctx: FixtureContext): THREE.Group {
  const group = createFurnitureGroup(def);
  const userData: HandrailUserData = {
    ...(group.userData as HandrailUserData),
    orientation: def.orientation,
    grabbed: false,
  };
  group.userData = userData;
  const bar = mesh(ctx.unitCylinder, ctx.materials.stainless, `${def.id}-bar`);
  if (def.orientation === "vertical") {
    bar.scale.set(def.size.x, def.size.y, def.size.z);
    bar.position.y = def.size.y / 2;
  } else {
    // 円柱の軸（Y）を Z へ倒す
    bar.scale.set(def.size.x, def.size.z, def.size.y);
    bar.rotation.x = Math.PI / 2;
  }
  group.add(bar);
  return group;
}

/** つり革（帯＋輪の 2 Mesh）．Group 原点は横の握り棒に掛かる上端（支点） */
export function createStrap(def: StrapDef, ctx: FixtureContext): THREE.Group {
  const group = new THREE.Group();
  group.name = def.id;
  group.position.set(...def.position);
  const userData: StrapUserData = {
    id: def.id,
    kind: "strap",
    railId: def.railId,
    length: STRAP_LENGTH,
    grabbed: false,
  };
  group.userData = userData;
  const ringRadius = STRAP.ringDiameter / 2;
  const ringGeometry = cached(
    ctx,
    "strap-ring",
    () =>
      new THREE.TorusGeometry(ringRadius - STRAP.ringThickness / 2, STRAP.ringThickness / 2, 6, 16),
  );
  const ring = mesh(ringGeometry, ctx.materials.strapRing, `${def.id}-ring`);
  ring.position.y = -STRAP.beltLength - ringRadius + STRAP.ringThickness / 2;
  // 輪の面を通路の横（±X）へ向ける
  ring.rotation.y = Math.PI / 2;
  group.add(
    createBox(
      ctx.unitBox,
      ctx.materials.strapBelt,
      [STRAP.beltThickness, STRAP.beltLength, STRAP.beltWidth],
      [0, -STRAP.beltLength / 2, 0],
      `${def.id}-belt`,
    ),
    ring,
  );
  return group;
}

// ---- ドア ----

type DoorDims = typeof SIDE_DOOR | typeof GANGWAY_DOOR;

/** 扉 1 枚の枠（窓の下の板・窓の上の板・窓の左右の縦框）．原点は扉の下端中央 */
function leafFrameGeometry(width: number, dims: DoorDims): THREE.BufferGeometry {
  const t = dims.leafThickness;
  const m = dims.windowMargin;
  const windowHeight = dims.windowTop - dims.windowBottom;
  return mergeBoxes([
    { size: [width, dims.windowBottom, t], position: [0, dims.windowBottom / 2, 0] },
    {
      size: [width, dims.height - dims.windowTop, t],
      position: [0, (dims.windowTop + dims.height) / 2, 0],
    },
    {
      size: [m, windowHeight, t],
      position: [-(width - m) / 2, (dims.windowBottom + dims.windowTop) / 2, 0],
    },
    {
      size: [m, windowHeight, t],
      position: [(width - m) / 2, (dims.windowBottom + dims.windowTop) / 2, 0],
    },
  ]);
}

/**
 * ドア 1 か所（Group 原点は壁面上の開口部の下端中央．ローカル X が壁に沿う向き，+Z が車内）．
 * 扉は 1 枚ずつ独立した子 Group で，壁の外側（戸袋）をローカル X に滑る．壁とは別の構造
 */
export function createDoor(
  def: TrainDoorDef,
  ctx: FixtureContext,
): { door: THREE.Group; leaves: THREE.Group[] } {
  const dims: DoorDims = def.kind === "sideDoor" ? SIDE_DOOR : GANGWAY_DOOR;
  const { u0, u1 } = def.opening;
  const door = new THREE.Group();
  door.name = def.id;
  door.position.set(...wallPointToWorld(def.wall, (u0 + u1) / 2, 0));
  door.rotation.y = def.wall.rotationY;

  const leaves = def.leaves.map((leafDef) => {
    const id = `${def.id}-${leafDef.suffix}`;
    const size: Size3 = { x: leafDef.width, y: dims.height, z: dims.leafThickness };
    const leaf = new THREE.Group();
    leaf.name = id;
    leaf.position.set(leafDef.closedX, 0, -dims.leafOffset);
    const userData: DoorLeafUserData = {
      ...leafDef,
      id,
      kind: "doorLeaf",
      doorId: def.id,
      size,
      slideAxis: "x",
      openAmount: 0,
    };
    leaf.userData = userData;
    const frame = cached(
      ctx,
      `leaf-${def.kind === "sideDoor" ? "side" : "end"}-${leafDef.width}`,
      () => leafFrameGeometry(leafDef.width, dims),
    );
    const glass = mesh(ctx.unitPlane, ctx.materials.glass, `${id}-glass`);
    glass.scale.set(leafDef.width - dims.windowMargin * 2, dims.windowTop - dims.windowBottom, 1);
    glass.position.set(0, (dims.windowBottom + dims.windowTop) / 2, 0);
    leaf.add(mesh(frame, ctx.materials.doorPanel, `${id}-panel`), glass);
    return leaf;
  });

  const userData: DoorUserData = {
    id: def.id,
    kind: def.kind,
    side: def.side,
    end: def.end,
    width: u1 - u0,
    height: def.opening.v1 - def.opening.v0,
    leafIds: leaves.map((leaf) => leaf.name),
    openStyle: "slide",
    open: false,
  };
  door.userData = userData;
  door.add(...leaves);
  return { door, leaves };
}

// ---- 小さな設備 ----

/** 非常用ドアコック（箱＋蓋．蓋は上端を軸に開く子 Group） */
export function createDoorCock(def: DoorCockDef, ctx: FixtureContext): THREE.Group {
  const group = createFurnitureGroup(def);
  const lidName = `${def.id}-lid`;
  const userData: DoorCockUserData = {
    ...(group.userData as DoorCockUserData),
    doorId: def.doorId,
    lidName,
    opened: false,
  };
  group.userData = userData;
  const { x, y, z } = def.size;
  group.add(createBox(ctx.unitBox, ctx.materials.darkGray, [x, y, z], [0, 0, 0], `${def.id}-box`));
  const lid = new THREE.Group();
  lid.name = lidName;
  lid.position.set(0, y / 2, z / 2);
  lid.add(
    createBox(
      ctx.unitBox,
      ctx.materials.intercom,
      [x - 0.01, y - 0.01, DOOR_COCK.lidThickness],
      [0, -y / 2, DOOR_COCK.lidThickness / 2],
      `${def.id}-lid-panel`,
    ),
  );
  group.add(lid);
  return group;
}

/** 非常通報装置（赤い箱＋黄色のボタン．正面はローカル +Z） */
export function createIntercom(
  def: Parameters<typeof createFurnitureGroup>[0],
  ctx: FixtureContext,
): THREE.Group {
  const group = createFurnitureGroup(def);
  const { x, y, z } = def.size;
  group.add(
    createBox(ctx.unitBox, ctx.materials.intercom, [x, y, z], [0, 0, 0], `${def.id}-box`),
    createBox(ctx.unitBox, ctx.materials.button, [0.05, 0.05, 0.015], [0, -0.03, z / 2 + 0.007]),
  );
  return group;
}

/** 網棚（棚板＋手前の縁を 1 Mesh にまとめる．原点は棚板の中心） */
export function createRack(
  def: Parameters<typeof createFurnitureGroup>[0],
  ctx: FixtureContext,
): THREE.Group {
  const group = createFurnitureGroup(def);
  const { x, y, z } = def.size;
  const geometry = cached(ctx, `rack-${x}`, () =>
    mergeBoxes([
      { size: [x, y, z], position: [0, 0, 0] },
      { size: [x, 0.03, 0.025], position: [0, 0.01, z / 2] },
    ]),
  );
  group.add(mesh(geometry, ctx.materials.rack, `${def.id}-shelf`));
  return group;
}

/** 荷物（カバン・箱・リュック．原点は底面中央） */
export function createLuggage(def: LuggageDef, ctx: FixtureContext): THREE.Group {
  const group = createFurnitureGroup(def);
  const userData: LuggageUserData = {
    ...(group.userData as LuggageUserData),
    shape: def.shape,
  };
  group.userData = userData;
  const { x, y, z } = def.size;
  const { materials, unitBox } = ctx;
  if (def.shape === "box") {
    group.add(createBox(unitBox, materials.cardboard, [x, y, z], [0, y / 2, 0], `${def.id}-body`));
  } else if (def.shape === "bag") {
    const bodyHeight = y * 0.8;
    group.add(
      createBox(
        unitBox,
        materials.bag,
        [x, bodyHeight, z],
        [0, bodyHeight / 2, 0],
        `${def.id}-body`,
      ),
      createBox(
        unitBox,
        materials.bag,
        [x * 0.5, y - bodyHeight, 0.02],
        [0, (bodyHeight + y) / 2, 0],
        `${def.id}-handle`,
      ),
    );
  } else {
    group.add(
      createBox(
        unitBox,
        materials.backpack,
        [x, y, z * 0.75],
        [0, y / 2, -z * 0.125],
        `${def.id}-body`,
      ),
      createBox(
        unitBox,
        materials.backpack,
        [x * 0.7, y * 0.45, z * 0.25],
        [0, y * 0.3, z * 0.375],
        `${def.id}-pocket`,
      ),
    );
  }
  return group;
}
