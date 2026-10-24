// 電車（通勤電車 1 両のうちドア 2 か所分）の空間．
// 車体（carBody）の Group に床・壁・天井・窓・設備・座席・手すり・つり革・ドアを載せ，
// 車外の景色・ホーム・照明は root に直接置く（車体だけを揺らしても外と照明は動かない）

import * as THREE from "three";
import { type BoxPlacement, createInstancedParts, disposeObjectTree } from "../common/meshHelpers";
import {
  splitWallAroundOpening,
  splitWallAroundOpenings,
  type WallDef,
  type WallRect,
  wallPointToWorld,
} from "../common/wallLayout";
import { createMergedWall } from "../common/wallMeshes";
import type { Space, SpaceBuildOptions } from "../types";
import {
  createDoor,
  createDoorCock,
  createHandrail,
  createIntercom,
  createLuggage,
  createRack,
  createSeat,
  createStrap,
  type FixtureContext,
} from "./trainFixtures";
import {
  CAR,
  CEILING_LIGHT,
  DOOR_COCKS,
  DOOR_DISPLAY,
  EMERGENCY_INTERCOM,
  GANGWAY,
  GANGWAY_DOOR,
  GANGWAY_DOORS,
  HANGING_AD,
  OUTSIDE_BOARD,
  PLATFORM,
  RAIL,
  SIDE_DOOR,
  SIDE_DOORS,
  SIDE_WALLS,
  SIDE_WINDOW,
  SIDE_WINDOWS,
  sideSign,
  TILE_SIZE,
  TRAIN_BACKGROUND,
  TRAIN_HANDRAILS,
  TRAIN_LUGGAGE,
  TRAIN_RACKS,
  TRAIN_SEATS,
  TRAIN_SIDES,
  TRAIN_START,
  TRAIN_STRAPS,
  type TrainDoorDef,
} from "./trainLayout";
import { AD_COLORS, createTrainMaterials, type TrainMaterials } from "./trainMaterials";

/** 後で触れる・動かす対象を種類ごとに引ける一覧（どれも carBody の子孫） */
export interface TrainParts {
  /** 車体全体（床・壁・天井・座席・手すり・窓・設備・つり革・ドア）．揺れの演出で動かす親 */
  readonly carBody: THREE.Group;
  /** 座席（userData は SeatUserData） */
  readonly seats: readonly THREE.Group[];
  /** 縦・横の握り棒と非常扉の手すり（userData は HandrailUserData） */
  readonly handrails: readonly THREE.Group[];
  /** つり革（userData は StrapUserData．原点が支点） */
  readonly straps: readonly THREE.Group[];
  /** ドア 1 か所ずつ（側面・貫通扉・非常扉．userData は DoorUserData） */
  readonly doors: readonly THREE.Group[];
  /** 扉 1 枚ずつ（userData は DoorLeafUserData） */
  readonly doorLeaves: readonly THREE.Group[];
  /** 非常用ドアコック（userData は DoorCockUserData） */
  readonly doorCocks: readonly THREE.Group[];
  /** 非常通報装置 */
  readonly intercoms: readonly THREE.Group[];
  readonly racks: readonly THREE.Group[];
  /** 網棚の上の荷物（userData は LuggageUserData） */
  readonly luggage: readonly THREE.Group[];
  /** 上のすべてを id（= Group の name）で引く */
  readonly byId: ReadonlyMap<string, THREE.Group>;
}

/** 電車の空間．Space に加え，触れる・動かす対象の一覧を持つ */
export interface TrainSpace extends Space {
  readonly id: "train";
  readonly parts: TrainParts;
}

/** Space が電車か（parts を持つか）を判定する */
export function isTrainSpace(space: Space): space is TrainSpace {
  return space.id === "train" && "parts" in space;
}

function createFloorAndCeiling(materials: TrainMaterials): THREE.Mesh[] {
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(CAR.width, CAR.length), materials.floor);
  floor.rotation.x = -Math.PI / 2;
  floor.name = "floor";
  const ceiling = new THREE.Mesh(new THREE.PlaneGeometry(CAR.width, CAR.length), materials.ceiling);
  ceiling.rotation.x = Math.PI / 2;
  ceiling.position.y = CAR.height;
  ceiling.name = "ceiling";
  return [floor, ceiling];
}

/** 壁 4 面（ドア・窓・貫通扉の開口部を空けて 1 Mesh にまとめる） */
function createWalls(materials: TrainMaterials): THREE.Mesh | null {
  const pieces: [WallDef, WallRect[]][] = [
    ...TRAIN_SIDES.map((side): [WallDef, WallRect[]] => {
      const wall = SIDE_WALLS[side];
      const openings = [
        ...SIDE_DOORS.filter((d) => d.side === side).map((d) => d.opening),
        ...SIDE_WINDOWS.filter((w) => w.wall === wall).map((w) => w.opening),
      ];
      return [wall, splitWallAroundOpenings(wall.length, CAR.height, openings)];
    }),
    ...GANGWAY_DOORS.map((d): [WallDef, WallRect[]] => [
      d.wall,
      splitWallAroundOpening(d.wall.length, CAR.height, d.opening),
    ]),
  ];
  return createMergedWall(pieces, materials.wall, TILE_SIZE.wall, "walls");
}

/** 壁上の位置 (u, v)・壁から内側への offset に置く直方体の配置 */
function onWall(
  wall: WallDef,
  u: number,
  v: number,
  offset: number,
  size: readonly [number, number, number],
): BoxPlacement {
  return { size, position: wallPointToWorld(wall, u, v, offset), rotationY: wall.rotationY };
}

/** ドアの枠（左右と上）と敷居 */
function doorFramePlacements(door: TrainDoorDef): BoxPlacement[] {
  const dims = door.kind === "sideDoor" ? SIDE_DOOR : GANGWAY_DOOR;
  const { u0, u1, v1 } = door.opening;
  const fw = dims.frameWidth;
  const fd = dims.frameDepth;
  const w = door.wall;
  return [
    onWall(w, u0 - fw / 2, (v1 + fw) / 2, 0, [fw, v1 + fw, fd]),
    onWall(w, u1 + fw / 2, (v1 + fw) / 2, 0, [fw, v1 + fw, fd]),
    onWall(w, (u0 + u1) / 2, v1 + fw / 2, 0, [u1 - u0 + fw * 2, fw, fd]),
    // 敷居（扉の下．壁の面から外側へ）
    onWall(w, (u0 + u1) / 2, 0.005, -0.02, [u1 - u0, 0.01, 0.12]),
  ];
}

/** 窓の枠（上下左右と，7 人掛けの上の窓の中央の縦桟） */
function windowFramePlacements(): BoxPlacement[] {
  const fw = SIDE_WINDOW.frameWidth;
  const fd = SIDE_WINDOW.frameDepth;
  return SIDE_WINDOWS.flatMap(({ wall, opening, mullion }) => {
    const { u0, u1, v0, v1 } = opening;
    const cu = (u0 + u1) / 2;
    const cv = (v0 + v1) / 2;
    const list = [
      onWall(wall, u0 + fw / 2, cv, 0, [fw, v1 - v0, fd]),
      onWall(wall, u1 - fw / 2, cv, 0, [fw, v1 - v0, fd]),
      onWall(wall, cu, v1 - fw / 2, 0, [u1 - u0, fw, fd]),
      onWall(wall, cu, v0 + fw / 2, 0, [u1 - u0, fw, fd]),
    ];
    if (mullion) list.push(onWall(wall, cu, cv, 0, [fw, v1 - v0, fd]));
    return list;
  });
}

/**
 * 動かない部品（枠・支え・照明・広告・案内表示・窓ガラス）を材質ごとに InstancedMesh にまとめる．
 * 描画数を抑えるため，触れる対象にならない物だけをここに入れる
 */
function createStaticParts(
  materials: TrainMaterials,
  unitBox: THREE.BufferGeometry,
  unitPlane: THREE.BufferGeometry,
): THREE.Object3D[] {
  const stainless: BoxPlacement[] = [
    ...[...SIDE_DOORS, ...GANGWAY_DOORS].flatMap(doorFramePlacements),
    ...windowFramePlacements(),
    // 横の握り棒の支え（天井から）
    ...TRAIN_SIDES.flatMap((side) =>
      RAIL.hangerZ.map(
        (z): BoxPlacement => ({
          size: [0.02, CAR.height - RAIL.y, 0.02],
          position: [sideSign(side) * RAIL.x, (RAIL.y + CAR.height) / 2, z],
        }),
      ),
    ),
    // 中吊り広告を吊る棒と，天井の中央の換気口の帯
    {
      size: [0.02, 0.02, CAR.length - 0.4],
      position: [0, HANGING_AD.top + 0.01, 0],
    },
    { size: [0.3, 0.02, CAR.length], position: [0, CAR.height - 0.01, 0] },
  ];

  const sideDisplays = SIDE_DOORS.map((d) => ({
    wall: d.wall,
    u: (d.opening.u0 + d.opening.u1) / 2,
  }));
  const housings = sideDisplays.map(({ wall, u }) =>
    onWall(wall, u, DOOR_DISPLAY.centerY, DOOR_DISPLAY.depth / 2, [
      DOOR_DISPLAY.width,
      DOOR_DISPLAY.height,
      DOOR_DISPLAY.depth,
    ]),
  );
  const screens = sideDisplays.map(({ wall, u }) =>
    onWall(wall, u, DOOR_DISPLAY.centerY, DOOR_DISPLAY.depth + 0.001, [
      DOOR_DISPLAY.width - 0.04,
      DOOR_DISPLAY.height - 0.04,
      1,
    ]),
  );
  const glass = SIDE_WINDOWS.map(({ wall, opening }) =>
    onWall(wall, (opening.u0 + opening.u1) / 2, (opening.v0 + opening.v1) / 2, 0, [
      opening.u1 - opening.u0,
      opening.v1 - opening.v0,
      1,
    ]),
  );
  const ads = HANGING_AD.rowsZ.flatMap((z) =>
    [-1, 1].map(
      (sign): BoxPlacement => ({
        size: [HANGING_AD.width, HANGING_AD.height, HANGING_AD.thickness],
        position: [sign * HANGING_AD.x, HANGING_AD.top - HANGING_AD.height / 2, z],
      }),
    ),
  );
  const lights = [-1, 1].map(
    (sign): BoxPlacement => ({
      size: [CEILING_LIGHT.width, CEILING_LIGHT.thickness, CEILING_LIGHT.length],
      position: [sign * CEILING_LIGHT.x, CAR.height - CEILING_LIGHT.thickness / 2, 0],
    }),
  );
  return [
    createInstancedParts(unitBox, materials.stainless, stainless, "stainless-parts"),
    createInstancedParts(unitBox, materials.darkGray, housings, "door-display-housings"),
    createInstancedParts(unitPlane, materials.display, screens, "door-display-screens"),
    createInstancedParts(unitPlane, materials.glass, glass, "window-glass"),
    createInstancedParts(unitBox, materials.ad, ads, "hanging-ads", AD_COLORS),
    createInstancedParts(unitBox, materials.light, lights, "ceiling-lights"),
  ];
}

/** 貫通扉の向こうの通路（内側だけ描く箱．外が覗けないように閉じる） */
function createGangways(materials: TrainMaterials, unitBox: THREE.BufferGeometry): THREE.Mesh[] {
  return GANGWAY_DOORS.map((door) => {
    const { u0, u1 } = door.opening;
    const offset = -(GANGWAY_DOOR.leafOffset + GANGWAY_DOOR.leafThickness + GANGWAY.depth / 2);
    const box = new THREE.Mesh(unitBox, materials.gangway);
    box.scale.set(GANGWAY.width, GANGWAY.height, GANGWAY.depth);
    box.position.set(...wallPointToWorld(door.wall, (u0 + u1) / 2, GANGWAY.height / 2, offset));
    box.rotation.y = door.wall.rotationY;
    box.name = `${door.id}-gangway`;
    return box;
  });
}

/** 車外（両側の景色の板と，左側のホーム）．車体の外なので root に置く */
function createOutside(materials: TrainMaterials): THREE.Object3D[] {
  const boards = TRAIN_SIDES.map((side) => {
    const board = new THREE.Mesh(
      new THREE.PlaneGeometry(OUTSIDE_BOARD.length, OUTSIDE_BOARD.height),
      materials.outside,
    );
    board.position.set(
      sideSign(side) * (CAR.width / 2 + OUTSIDE_BOARD.distance),
      OUTSIDE_BOARD.bottom + OUTSIDE_BOARD.height / 2,
      0,
    );
    // 板の表（+Z）を車体へ向ける（壁の内向きの回転と同じ）
    board.rotation.y = SIDE_WALLS[side].rotationY;
    board.name = `outside-${side}`;
    return board;
  });

  const platform = new THREE.Group();
  platform.name = "platform";
  const sign = sideSign(PLATFORM.side);
  const edgeX = sign * (CAR.width / 2 + PLATFORM.gap);
  const floor = new THREE.Mesh(
    new THREE.PlaneGeometry(PLATFORM.width, PLATFORM.length),
    materials.platform,
  );
  floor.rotation.x = -Math.PI / 2;
  floor.position.set(edgeX + (sign * PLATFORM.width) / 2, PLATFORM.y, 0);
  floor.name = "platform-floor";
  const tactile = new THREE.Mesh(
    new THREE.PlaneGeometry(PLATFORM.tactileWidth, PLATFORM.length),
    materials.tactile,
  );
  tactile.rotation.x = -Math.PI / 2;
  tactile.position.set(edgeX + sign * PLATFORM.tactileOffset, PLATFORM.y + 0.003, 0);
  tactile.name = "platform-tactile";
  platform.add(floor, tactile);
  return [...boards, platform];
}

function createLights(): THREE.Object3D[] {
  // 天井の照明で車内全体が明るい．影は描かない
  const hemisphere = new THREE.HemisphereLight(0xffffff, 0x9a9a96, 1.6);
  const top = new THREE.DirectionalLight(0xffffff, 0.8);
  top.position.set(0.8, 6, 2);
  top.target.position.set(0, 0, 0);
  return [hemisphere, top, top.target];
}

/** 電車の空間を作る */
export function createTrainScene(options: SpaceBuildOptions): TrainSpace {
  const root = new THREE.Group();
  root.name = "train";
  const carBody = new THREE.Group();
  carBody.name = "carBody";
  root.add(carBody);

  const materials = createTrainMaterials(options.maxAnisotropy);
  const unitBox = new THREE.BoxGeometry(1, 1, 1);
  const unitPlane = new THREE.PlaneGeometry(1, 1);
  const ctx: FixtureContext = {
    unitBox,
    unitCylinder: new THREE.CylinderGeometry(0.5, 0.5, 1, 10),
    unitPlane,
    materials,
    geometryCache: new Map(),
  };

  carBody.add(...createFloorAndCeiling(materials));
  const walls = createWalls(materials);
  if (walls) carBody.add(walls);
  carBody.add(...createStaticParts(materials, unitBox, unitPlane));
  carBody.add(...createGangways(materials, unitBox));

  const seats = TRAIN_SEATS.map((def) => createSeat(def, ctx));
  const handrails = TRAIN_HANDRAILS.map((def) => createHandrail(def, ctx));
  const straps = TRAIN_STRAPS.map((def) => createStrap(def, ctx));
  const doorParts = [...SIDE_DOORS, ...GANGWAY_DOORS].map((def) => createDoor(def, ctx));
  const doors = doorParts.map((p) => p.door);
  const doorLeaves = doorParts.flatMap((p) => p.leaves);
  const doorCocks = DOOR_COCKS.map((def) => createDoorCock(def, ctx));
  const intercoms = [createIntercom(EMERGENCY_INTERCOM, ctx)];
  const racks = TRAIN_RACKS.map((def) => createRack(def, ctx));
  const luggage = TRAIN_LUGGAGE.map((def) => createLuggage(def, ctx));

  const groupOf = (name: string, children: readonly THREE.Object3D[]): THREE.Group => {
    const group = new THREE.Group();
    group.name = name;
    if (children.length > 0) group.add(...children);
    return group;
  };
  carBody.add(
    groupOf("seats", seats),
    groupOf("handrails", handrails),
    groupOf("straps", straps),
    groupOf("doors", doors),
    groupOf("equipment", [...doorCocks, ...intercoms, ...racks]),
    groupOf("luggage", luggage),
  );

  root.add(...createOutside(materials));
  root.add(...createLights());

  const byId = new Map<string, THREE.Group>();
  for (const group of [
    ...seats,
    ...handrails,
    ...straps,
    ...doors,
    ...doorLeaves,
    ...doorCocks,
    ...intercoms,
    ...racks,
    ...luggage,
  ]) {
    byId.set(group.name, group);
  }

  return {
    id: "train",
    root,
    startPosition: new THREE.Vector3(...TRAIN_START.position),
    startYaw: TRAIN_START.yaw,
    background: TRAIN_BACKGROUND,
    parts: {
      carBody,
      seats,
      handrails,
      straps,
      doors,
      doorLeaves,
      doorCocks,
      intercoms,
      racks,
      luggage,
      byId,
    },
    dispose: () => {
      root.removeFromParent();
      disposeObjectTree(root);
    },
  };
}
