// 部屋（リビング）の空間．
// 部屋の殻（shell: 床・壁・天井・窓・窓ガラス・ドア枠・ドア・レンジフード・ガラスの破片）と
// 家具（furniture: 1 つずつ独立した Group）を root に載せる．揺れの演出では shell を動かし，家具は個別に動かす．
// 窓の外の景色・ドアの外の廊下・照明は root に直接置く（揺らさない）

import * as THREE from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import { createBox, disposeObjectTree } from "../common/meshHelpers";
import { mulberry32 } from "../common/random";
import {
  splitWallAroundOpening,
  type WallDef,
  type WallRect,
  wallPointToWorld,
} from "../common/wallLayout";
import { createMergedWall, createWallPiece, wallBox } from "../common/wallMeshes";
import type { Space, SpaceBuildOptions } from "../types";
import { createRoomFurniture } from "./roomFurniture";
import {
  BASEBOARD,
  BOOKSHELF_ID,
  BREAKER_PANEL_ID,
  DOOR,
  DOOR_OPENING,
  type DoorUserData,
  GLASS_SHARDS,
  type GlassShardsUserData,
  glassShardLayout,
  HALLWAY,
  HALLWAY_DOOR_OPENING,
  HALLWAY_WALLS,
  PENDANT_ID,
  ROOM,
  ROOM_AREAS,
  ROOM_BACKGROUND,
  ROOM_FURNITURE,
  ROOM_START,
  type RoomArea,
  roomFurnitureDef,
  SKY_BOARD,
  STOVE_ID,
  TABLE_ID,
  TILE_SIZE,
  TV_ID,
  WALL_THICKNESS,
  WALLS,
  WINDOW,
  WINDOW_OPENING,
  type WindowGlassUserData,
} from "./roomLayout";
import { createRoomMaterials, type RoomMaterials } from "./roomMaterials";

export type { DoorUserData } from "./roomLayout";

/** コンロ（本体と，口ごとのつまみ・火） */
export interface RoomStoveParts {
  /** コンロの Group（userData は StoveUserData．カウンターの上に載る家具） */
  readonly body: THREE.Group;
  /** つまみ（userData は StoveKnobUserData．口の順） */
  readonly knobs: readonly THREE.Group[];
  /** 火（userData は StoveFlameUserData．口の順．表示は visible で切り替える） */
  readonly flames: readonly THREE.Group[];
}

/** ブレーカー（分電盤とメインスイッチ） */
export interface RoomBreakerParts {
  /** 分電盤（userData は BreakerPanelUserData．壁掛けの家具） */
  readonly panel: THREE.Group;
  /** 切る対象のメインスイッチ（userData は BreakerSwitchUserData） */
  readonly mainSwitch: THREE.Group;
}

/** 後で触れる・動かす・表示を変える対象を種類ごとに引ける一覧 */
export interface RoomParts {
  /** 部屋の殻（床・壁・天井・窓・ドア枠・ドア等）．揺れの演出で動かす親 */
  readonly shell: THREE.Group;
  /** 家具をまとめた親（家具は 1 つずつ独立した Group．userData は FurnitureUserData） */
  readonly furniture: THREE.Group;
  /** 本棚の本 1 冊ずつ（Mesh．userData は BookUserData） */
  readonly books: readonly THREE.Mesh[];
  /** テーブルの脚 4 本（userData は TableLegUserData） */
  readonly tableLegs: readonly THREE.Group[];
  readonly stove: RoomStoveParts;
  readonly breaker: RoomBreakerParts;
  /** 窓ガラス（userData は WindowGlassUserData．shell の子） */
  readonly windowGlass: THREE.Group;
  /** 窓の前の床に散らばった破片（userData は GlassShardsUserData．既定は非表示．shell の子） */
  readonly glassShards: THREE.Group;
  /** 廊下へ出るドア（ヒンジが原点．userData は DoorUserData．shell の子） */
  readonly door: THREE.Group;
  /** ドアの外の廊下（root 直下．揺らさない） */
  readonly hallway: THREE.Group;
  /** 天井のペンダントライト（原点は天井取付点．揺らす対象） */
  readonly pendant: THREE.Group;
  /** テレビ（userData は TvUserData．① で音を流す発生源） */
  readonly tv: THREE.Group;
  /** シナリオの判定に使う床の範囲（ROOM_AREAS と同じ） */
  readonly areas: readonly RoomArea[];
  /** 家具・脚・つまみ・火・スイッチ・窓ガラス・破片・ドアを id（= Group の name）で引く（本は含めない） */
  readonly byId: ReadonlyMap<string, THREE.Group>;
}

/** 部屋の空間．Space に加え，触れる・動かす対象の一覧を持つ */
export interface RoomSpace extends Space {
  readonly id: "room";
  readonly parts: RoomParts;
}

/** Space が部屋か（parts を持つか）を判定する */
export function isRoomSpace(space: Space): space is RoomSpace {
  return space.id === "room" && "parts" in space;
}

function createWalls(materials: RoomMaterials, unitBox: THREE.BufferGeometry): THREE.Group {
  const group = new THREE.Group();
  group.name = "walls";
  const full = (wall: WallDef): WallRect[] => [{ u0: 0, u1: wall.length, v0: 0, v1: ROOM.height }];
  const pieces: [WallDef, WallRect[]][] = [
    [WALLS.north, splitWallAroundOpening(WALLS.north.length, ROOM.height, WINDOW_OPENING)],
    [WALLS.east, full(WALLS.east)],
    [WALLS.south, splitWallAroundOpening(WALLS.south.length, ROOM.height, DOOR_OPENING)],
    [WALLS.west, full(WALLS.west)],
  ];
  for (const [wall, rects] of pieces) {
    for (const rect of rects) {
      group.add(createWallPiece(wall, rect, materials.wall, TILE_SIZE.wall));
    }
  }

  // 幅木（ドアの前では途切れる）
  const baseboards: [WallDef, number, number][] = [
    [WALLS.north, 0, WALLS.north.length],
    [WALLS.east, 0, WALLS.east.length],
    [WALLS.south, 0, DOOR_OPENING.u0],
    [WALLS.south, DOOR_OPENING.u1, WALLS.south.length],
    [WALLS.west, 0, WALLS.west.length],
  ];
  for (const [wall, u0, u1] of baseboards) {
    group.add(
      wallBox(
        unitBox,
        materials.woodTrim,
        wall,
        (u0 + u1) / 2,
        BASEBOARD.height / 2,
        BASEBOARD.thickness / 2,
        [u1 - u0, BASEBOARD.height, BASEBOARD.thickness],
      ),
    );
  }
  return group;
}

/**
 * 床や天井の板（原点が中心）．UV を「部屋の床の大きさに対する割合」にして，
 * 部屋の床と同じマテリアル（repeat は部屋の大きさで設定済み）でもタイルの大きさがそろうようにする
 */
function horizontalPlane(
  width: number,
  depth: number,
  material: THREE.Material,
  y: number,
  facingUp: boolean,
  name: string,
  uvScale: readonly [number, number] = [1, 1],
): THREE.Mesh {
  const geometry = new THREE.PlaneGeometry(width, depth);
  const uv = geometry.getAttribute("uv");
  for (let i = 0; i < uv.count; i++) {
    uv.setXY(i, uv.getX(i) * uvScale[0], uv.getY(i) * uvScale[1]);
  }
  const plane = new THREE.Mesh(geometry, material);
  plane.rotation.x = facingUp ? -Math.PI / 2 : Math.PI / 2;
  plane.position.y = y;
  plane.name = name;
  return plane;
}

function createFloorAndCeiling(materials: RoomMaterials): THREE.Mesh[] {
  materials.floor.map?.repeat.set(ROOM.width / TILE_SIZE.floor, ROOM.depth / TILE_SIZE.floor);
  materials.ceiling.map?.repeat.set(ROOM.width / TILE_SIZE.ceiling, ROOM.depth / TILE_SIZE.ceiling);
  return [
    horizontalPlane(ROOM.width, ROOM.depth, materials.floor, 0, true, "floor"),
    horizontalPlane(ROOM.width, ROOM.depth, materials.ceiling, ROOM.height, false, "ceiling"),
  ];
}

/** 窓の枠・中央の縦桟・窓台（shell の子） */
function createWindowFrame(materials: RoomMaterials, unitBox: THREE.BufferGeometry): THREE.Group {
  const group = new THREE.Group();
  group.name = "window";
  const wall = WALLS.north;
  const { u0, u1, v0, v1 } = WINDOW_OPENING;
  const fw = WINDOW.frameWidth;
  const fd = WINDOW.frameDepth;
  const centerU = (u0 + u1) / 2;
  const centerV = (v0 + v1) / 2;
  const mat = materials.white;
  group.add(
    wallBox(unitBox, mat, wall, u0 + fw / 2, centerV, 0, [fw, WINDOW.height, fd]),
    wallBox(unitBox, mat, wall, u1 - fw / 2, centerV, 0, [fw, WINDOW.height, fd]),
    wallBox(unitBox, mat, wall, centerU, v1 - fw / 2, 0, [WINDOW.width - fw * 2, fw, fd]),
    wallBox(unitBox, mat, wall, centerU, v0 + fw / 2, 0, [WINDOW.width - fw * 2, fw, fd]),
    wallBox(unitBox, mat, wall, centerU, centerV, 0, [fw * 0.6, WINDOW.height - fw * 2, fd * 0.6]),
    // 窓台（部屋の内側へ張り出す）
    wallBox(unitBox, materials.woodTrim, wall, centerU, v0 - 0.015, 0.07, [
      WINDOW.width + 0.12,
      0.03,
      0.14,
    ]),
  );
  return group;
}

/** 窓ガラス（割れる対象．原点は開口部の中心の壁面上，正面がローカル +Z） */
function createWindowGlass(materials: RoomMaterials): THREE.Group {
  const wall = WALLS.north;
  const { u0, u1, v0, v1 } = WINDOW_OPENING;
  const group = new THREE.Group();
  group.name = "window-glass";
  group.position.set(...wallPointToWorld(wall, (u0 + u1) / 2, (v0 + v1) / 2));
  group.rotation.y = wall.rotationY;
  const userData: WindowGlassUserData = {
    id: "window-glass",
    kind: "windowGlass",
    width: WINDOW.width,
    height: WINDOW.height,
    broken: false,
  };
  group.userData = userData;
  const pane = new THREE.Mesh(
    new THREE.PlaneGeometry(WINDOW.width, WINDOW.height),
    materials.glass,
  );
  pane.name = "window-glass-pane";
  group.add(pane);
  return group;
}

/** 窓の外の景色の板（root 直下） */
function createOutsideView(materials: RoomMaterials): THREE.Mesh {
  const wall = WALLS.north;
  const centerU = (WINDOW_OPENING.u0 + WINDOW_OPENING.u1) / 2;
  const sky = new THREE.Mesh(
    new THREE.PlaneGeometry(SKY_BOARD.width, SKY_BOARD.height),
    materials.sky,
  );
  sky.position.set(
    ...wallPointToWorld(
      wall,
      centerU,
      SKY_BOARD.bottom + SKY_BOARD.height / 2,
      -SKY_BOARD.distance,
    ),
  );
  sky.rotation.y = wall.rotationY;
  sky.name = "outside-view";
  return sky;
}

/**
 * 窓の前の床に散らばったガラスの破片（小さな三角・四角の板を 1 Mesh にまとめる）．既定は非表示
 */
function createGlassShards(materials: RoomMaterials): THREE.Group {
  const group = new THREE.Group();
  group.name = GLASS_SHARDS.id;
  const userData: GlassShardsUserData = {
    id: GLASS_SHARDS.id,
    kind: "glassShards",
    count: GLASS_SHARDS.count,
  };
  group.userData = userData;
  const shards = glassShardLayout(
    mulberry32(GLASS_SHARDS.seed),
    GLASS_SHARDS.count,
    GLASS_SHARDS.area,
    GLASS_SHARDS.minSize,
    GLASS_SHARDS.maxSize,
  );
  const pieces = shards.map((shard, i) => {
    const geometry =
      shard.shape === "triangle"
        ? new THREE.CircleGeometry(shard.size / 2, 3)
        : new THREE.PlaneGeometry(shard.size, shard.size * 0.6);
    // 床に寝かせ，向きを散らし，床とちらつかないよう少し浮かせる
    geometry.rotateX(-Math.PI / 2);
    geometry.rotateY(shard.rotationY);
    geometry.translate(shard.x, 0.003 + i * 0.0003, shard.z);
    return geometry;
  });
  const merged = new THREE.Mesh(mergeGeometries(pieces), materials.shard);
  for (const p of pieces) p.dispose();
  merged.name = `${GLASS_SHARDS.id}-pieces`;
  group.add(merged);
  group.visible = false;
  return group;
}

/** レンジフード（コンロの上の東の壁．動かない） */
function createRangeHood(materials: RoomMaterials, unitBox: THREE.BufferGeometry): THREE.Group {
  const stove = roomFurnitureDef(STOVE_ID);
  const wall = WALLS.east;
  const u = stove.position[2] - wall.origin[2];
  const group = new THREE.Group();
  group.name = "range-hood";
  group.add(
    wallBox(unitBox, materials.stoveBody, wall, u, 1.9, 0.25, [0.75, 0.3, 0.5]),
    wallBox(unitBox, materials.stoveBody, wall, u, 2.2, 0.15, [0.35, 0.4, 0.3]),
  );
  return group;
}

/** ドア枠（壁の厚みの小口を覆う．shell の子） */
function createDoorFrame(materials: RoomMaterials, unitBox: THREE.BufferGeometry): THREE.Group {
  const wall = WALLS.south;
  const { u0, u1 } = DOOR_OPENING;
  const fw = DOOR.frameWidth;
  const fd = DOOR.frameDepth;
  // 部屋の壁の面と廊下の壁の面の中間を枠の中心にする（offset は部屋の内側が正）
  const offset = -WALL_THICKNESS / 2;
  const frame = new THREE.Group();
  frame.name = "door-frame";
  frame.add(
    wallBox(unitBox, materials.woodTrim, wall, u0 - fw / 2, (DOOR.height + fw) / 2, offset, [
      fw,
      DOOR.height + fw,
      fd,
    ]),
    wallBox(unitBox, materials.woodTrim, wall, u1 + fw / 2, (DOOR.height + fw) / 2, offset, [
      fw,
      DOOR.height + fw,
      fd,
    ]),
    wallBox(unitBox, materials.woodTrim, wall, (u0 + u1) / 2, DOOR.height + fw / 2, offset, [
      DOOR.width + fw * 2,
      fw,
      fd,
    ]),
  );
  return frame;
}

/**
 * ドア本体（ヒンジ位置を原点とする Group．ローカル +Z が部屋の内側）．
 * ヒンジが内側から見て左なら板はローカル +X へ，右ならローカル -X へ伸びる
 */
function createDoor(materials: RoomMaterials, unitBox: THREE.BufferGeometry): THREE.Group {
  const wall = WALLS.south;
  const { u0, u1 } = DOOR_OPENING;
  // 板の伸びる向き（ローカル X の符号）
  const along = DOOR.hingeSide === "left" ? 1 : -1;
  const door = new THREE.Group();
  door.name = "door";
  door.position.set(...wallPointToWorld(wall, DOOR.hingeSide === "left" ? u0 : u1, 0));
  door.rotation.y = wall.rotationY;
  const userData: DoorUserData = {
    id: "door",
    kind: "door",
    hingeSide: DOOR.hingeSide,
    width: DOOR.width,
    height: DOOR.height,
    thickness: DOOR.thickness,
    closedRotationY: wall.rotationY,
    // 正へ回すとローカル +X の先端は -Z（部屋の外）へ，-X の先端は +Z（内側）へ動く
    openInwardSign: along === 1 ? -1 : 1,
    maxOpenAngle: DOOR.maxOpenAngle,
    open: false,
    openAngle: 0,
  };
  door.userData = userData;
  door.add(
    createBox(
      unitBox,
      materials.woodLight,
      [DOOR.width, DOOR.height, DOOR.thickness],
      [(along * DOOR.width) / 2, DOOR.height / 2, 0],
      "door-leaf",
    ),
  );
  // レバーハンドル（ヒンジと反対の端．内外の両面に付け，レバーはヒンジ側へ向ける）
  const handleX = along * (DOOR.width - 0.07);
  const handleY = 0.95;
  for (const side of [1, -1]) {
    const z = side * (DOOR.thickness / 2);
    door.add(
      createBox(
        unitBox,
        materials.metal,
        [0.05, 0.05, 0.012],
        [handleX, handleY, z + side * 0.006],
      ),
      createBox(
        unitBox,
        materials.metal,
        [0.016, 0.016, 0.05],
        [handleX, handleY, z + side * 0.025],
      ),
      createBox(
        unitBox,
        materials.metal,
        [0.12, 0.018, 0.018],
        [handleX - along * 0.05, handleY, z + side * 0.05],
      ),
    );
  }
  return door;
}

/**
 * ドアの外の廊下（床・天井・壁 4 面・照明・西の端の玄関ドア）．内側だけを描く閉じた空間で root 直下に置く．
 * 部屋側の壁にドアと同じ開口部があり，ドアを開けると部屋から見える
 */
function createHallway(materials: RoomMaterials, unitBox: THREE.BufferGeometry): THREE.Group {
  const hallway = new THREE.Group();
  hallway.name = "hallway";
  const width = HALLWAY.maxX - HALLWAY.minX;
  const depth = HALLWAY.farZ - HALLWAY.floorMinZ;
  const centerX = (HALLWAY.minX + HALLWAY.maxX) / 2;
  const centerZ = (HALLWAY.floorMinZ + HALLWAY.farZ) / 2;
  const floor = horizontalPlane(width, depth, materials.floor, 0, true, "hallway-floor", [
    width / ROOM.width,
    depth / ROOM.depth,
  ]);
  floor.position.set(centerX, 0, centerZ);
  const ceiling = horizontalPlane(
    width,
    depth,
    materials.ceiling,
    HALLWAY.height,
    false,
    "hallway-ceiling",
    [width / ROOM.width, depth / ROOM.depth],
  );
  ceiling.position.set(centerX, HALLWAY.height, centerZ);

  const full = (def: WallDef): [WallDef, WallRect[]] => [
    def,
    [{ u0: 0, u1: def.length, v0: 0, v1: HALLWAY.height }],
  ];
  const walls = createMergedWall(
    [
      [
        HALLWAY_WALLS.near,
        splitWallAroundOpening(HALLWAY_WALLS.near.length, HALLWAY.height, HALLWAY_DOOR_OPENING),
      ],
      full(HALLWAY_WALLS.east),
      full(HALLWAY_WALLS.far),
      full(HALLWAY_WALLS.west),
    ],
    materials.wall,
    TILE_SIZE.wall,
    "hallway-walls",
  );

  const light = new THREE.Mesh(unitBox, materials.hallwayLight);
  light.scale.set(0.5, 0.02, 0.5);
  // ドアの開口部の正面の天井
  light.position.set(DOOR.centerX, HALLWAY.height - 0.01, (HALLWAY.nearZ + HALLWAY.farZ) / 2);
  light.name = "hallway-light";

  // 玄関ドア（西の端の壁．開かない飾り）
  const westWall = HALLWAY_WALLS.west;
  const frontDoorU = HALLWAY.farZ - HALLWAY.frontDoor.centerZ;
  const frontDoor = wallBox(
    unitBox,
    materials.frontDoor,
    westWall,
    frontDoorU,
    HALLWAY.frontDoor.height / 2,
    0.02,
    [HALLWAY.frontDoor.width, HALLWAY.frontDoor.height, 0.04],
    "front-door",
  );

  hallway.add(floor, ceiling, light, frontDoor);
  if (walls) hallway.add(walls);
  return hallway;
}

function createLights(): THREE.Object3D[] {
  const hemisphere = new THREE.HemisphereLight(0xffffff, 0x8a7560, 1.1);
  hemisphere.name = "ambient-light";
  // 窓の外の斜め上から差し込む日光（影は描かない）
  const sun = new THREE.DirectionalLight(0xfff4e0, 1.2);
  sun.position.set(-1.5, 4.5, -6.5);
  sun.target.position.set(0.5, 0, 0.8);
  return [hemisphere, sun, sun.target];
}

/** 配下から userData.kind が kind の Group を探す（家具の中の脚・つまみ・火・スイッチを集める） */
function groupsOfKind(root: THREE.Object3D, kind: string): THREE.Group[] {
  const found: THREE.Group[] = [];
  root.traverse((object) => {
    if (object instanceof THREE.Group && object.userData.kind === kind) found.push(object);
  });
  return found;
}

/** 家具の Group を id で引く（無ければ例外） */
function requireGroup(map: ReadonlyMap<string, THREE.Group>, id: string): THREE.Group {
  const group = map.get(id);
  if (!group) throw new Error(`部屋の部品がありません: ${id}`);
  return group;
}

/** 部屋（リビング）の空間を作る */
export function createRoomScene(options: SpaceBuildOptions): RoomSpace {
  const root = new THREE.Group();
  root.name = "room";
  const materials = createRoomMaterials(options.maxAnisotropy);
  const unitBox = new THREE.BoxGeometry(1, 1, 1);

  const shell = new THREE.Group();
  shell.name = "shell";
  const windowGlass = createWindowGlass(materials);
  const glassShards = createGlassShards(materials);
  const door = createDoor(materials, unitBox);
  shell.add(
    ...createFloorAndCeiling(materials),
    createWalls(materials, unitBox),
    createWindowFrame(materials, unitBox),
    windowGlass,
    createDoorFrame(materials, unitBox),
    door,
    createRangeHood(materials, unitBox),
    glassShards,
  );

  const furniture = new THREE.Group();
  furniture.name = "furniture";
  const furnitureGroups = createRoomFurniture(ROOM_FURNITURE, materials, unitBox);
  furniture.add(...furnitureGroups);
  const furnitureById = new Map(furnitureGroups.map((g) => [g.name, g]));

  const hallway = createHallway(materials, unitBox);
  root.add(shell, furniture, createOutsideView(materials), hallway, ...createLights());

  const books: THREE.Mesh[] = [];
  requireGroup(furnitureById, BOOKSHELF_ID).traverse((object) => {
    if (object instanceof THREE.Mesh && object.userData.kind === "book") books.push(object);
  });
  const tableLegs = groupsOfKind(requireGroup(furnitureById, TABLE_ID), "tableLeg");
  const stoveBody = requireGroup(furnitureById, STOVE_ID);
  const stove: RoomStoveParts = {
    body: stoveBody,
    knobs: groupsOfKind(stoveBody, "stoveKnob"),
    flames: groupsOfKind(stoveBody, "stoveFlame"),
  };
  const breakerPanel = requireGroup(furnitureById, BREAKER_PANEL_ID);
  const [mainSwitch] = groupsOfKind(breakerPanel, "breakerSwitch");
  if (!mainSwitch) throw new Error("ブレーカーのメインスイッチがありません");

  const byId = new Map<string, THREE.Group>(furnitureById);
  for (const group of [
    ...tableLegs,
    ...stove.knobs,
    ...stove.flames,
    mainSwitch,
    windowGlass,
    glassShards,
    door,
  ]) {
    byId.set(group.name, group);
  }

  return {
    id: "room",
    root,
    startPosition: new THREE.Vector3(...ROOM_START.position),
    startYaw: ROOM_START.yaw,
    background: ROOM_BACKGROUND,
    parts: {
      shell,
      furniture,
      books,
      tableLegs,
      stove,
      breaker: { panel: breakerPanel, mainSwitch },
      windowGlass,
      glassShards,
      door,
      hallway,
      pendant: requireGroup(furnitureById, PENDANT_ID),
      tv: requireGroup(furnitureById, TV_ID),
      areas: ROOM_AREAS,
      byId,
    },
    dispose: () => {
      root.removeFromParent();
      disposeObjectTree(root);
    },
  };
}
