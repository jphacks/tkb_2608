// 部屋（リビング）の空間．床・壁・天井・窓・ドア・照明と家具をまとめて root に載せる

import * as THREE from "three";
import { createBox, disposeObjectTree } from "../common/meshHelpers";
import {
  splitWallAroundOpening,
  type WallDef,
  type WallRect,
  wallPointToWorld,
} from "../common/wallLayout";
import { createWallPiece, wallBox } from "../common/wallMeshes";
import type { Space, SpaceBuildOptions } from "../types";
import { createRoomFurniture } from "./roomFurniture";
import {
  BASEBOARD,
  DOOR,
  DOOR_OPENING,
  ROOM,
  ROOM_BACKGROUND,
  ROOM_FURNITURE,
  ROOM_START,
  SKY_BOARD,
  TILE_SIZE,
  WALLS,
  WINDOW,
  WINDOW_OPENING,
} from "./roomLayout";
import { createRoomMaterials, type RoomMaterials } from "./roomMaterials";

/** ドアの Group.userData（開閉は後の Issue で実装する） */
export interface DoorUserData {
  readonly id: "door";
  readonly kind: "door";
  /** 部屋の内側から見たヒンジの側 */
  readonly hingeSide: "left" | "right";
  readonly width: number;
  readonly height: number;
  readonly thickness: number;
  /** 閉じた状態の rotation.y */
  readonly closedRotationY: number;
  /** 部屋の内側へ開くときの rotation.y の増える向き（closedRotationY + sign × 開き角） */
  readonly openInwardSign: 1 | -1;
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

function createFloorAndCeiling(materials: RoomMaterials): THREE.Mesh[] {
  const floorMap = materials.floor.map;
  floorMap?.repeat.set(ROOM.width / TILE_SIZE.floor, ROOM.depth / TILE_SIZE.floor);
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(ROOM.width, ROOM.depth), materials.floor);
  floor.rotation.x = -Math.PI / 2;
  floor.name = "floor";

  const ceilingMap = materials.ceiling.map;
  ceilingMap?.repeat.set(ROOM.width / TILE_SIZE.ceiling, ROOM.depth / TILE_SIZE.ceiling);
  const ceiling = new THREE.Mesh(
    new THREE.PlaneGeometry(ROOM.width, ROOM.depth),
    materials.ceiling,
  );
  ceiling.rotation.x = Math.PI / 2;
  ceiling.position.y = ROOM.height;
  ceiling.name = "ceiling";
  return [floor, ceiling];
}

/** 窓（枠・中央の縦桟・窓台・ガラス）と窓の外の景色 */
function createWindow(materials: RoomMaterials, unitBox: THREE.BufferGeometry): THREE.Group {
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

  const glass = new THREE.Mesh(
    new THREE.PlaneGeometry(WINDOW.width, WINDOW.height),
    materials.glass,
  );
  glass.position.set(...wallPointToWorld(wall, centerU, centerV));
  glass.rotation.y = wall.rotationY;
  glass.name = "window-glass";
  group.add(glass);

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
  group.add(sky);
  return group;
}

/** ドア枠（壁の外に固定）とドア本体（ヒンジ位置を原点とする Group） */
function createDoor(
  materials: RoomMaterials,
  unitBox: THREE.BufferGeometry,
): { frame: THREE.Group; door: THREE.Group } {
  const wall = WALLS.south;
  const { u0, u1 } = DOOR_OPENING;
  const fw = DOOR.frameWidth;
  const fd = DOOR.frameDepth;
  const frame = new THREE.Group();
  frame.name = "door-frame";
  frame.add(
    wallBox(unitBox, materials.woodTrim, wall, u0 - fw / 2, (DOOR.height + fw) / 2, 0, [
      fw,
      DOOR.height + fw,
      fd,
    ]),
    wallBox(unitBox, materials.woodTrim, wall, u1 + fw / 2, (DOOR.height + fw) / 2, 0, [
      fw,
      DOOR.height + fw,
      fd,
    ]),
    wallBox(unitBox, materials.woodTrim, wall, (u0 + u1) / 2, DOOR.height + fw / 2, 0, [
      DOOR.width + fw * 2,
      fw,
      fd,
    ]),
  );

  // 内側から見て左（u が小さい側）がヒンジ．Group のローカル +X がドア板の向き，+Z が部屋の内側
  const door = new THREE.Group();
  door.name = "door";
  door.position.set(...wallPointToWorld(wall, u0, 0));
  door.rotation.y = wall.rotationY;
  const userData: DoorUserData = {
    id: "door",
    kind: "door",
    hingeSide: DOOR.hingeSide,
    width: DOOR.width,
    height: DOOR.height,
    thickness: DOOR.thickness,
    closedRotationY: wall.rotationY,
    // 正へ回すとドア板の先端はローカルの -Z（部屋の外）へ動くため，内開きは負
    openInwardSign: -1,
  };
  door.userData = userData;
  door.add(
    createBox(
      unitBox,
      materials.woodLight,
      [DOOR.width, DOOR.height, DOOR.thickness],
      [DOOR.width / 2, DOOR.height / 2, 0],
      "door-leaf",
    ),
  );
  // レバーハンドル（ヒンジと反対の端．内外の両面に付け，レバーはヒンジ側へ向ける）
  const handleU = DOOR.width - 0.07;
  const handleY = 0.95;
  for (const side of [1, -1]) {
    const z = side * (DOOR.thickness / 2);
    door.add(
      createBox(
        unitBox,
        materials.metal,
        [0.05, 0.05, 0.012],
        [handleU, handleY, z + side * 0.006],
      ),
      createBox(
        unitBox,
        materials.metal,
        [0.016, 0.016, 0.05],
        [handleU, handleY, z + side * 0.025],
      ),
      createBox(
        unitBox,
        materials.metal,
        [0.12, 0.018, 0.018],
        [handleU - 0.05, handleY, z + side * 0.05],
      ),
    );
  }
  return { frame, door };
}

function createLights(): THREE.Object3D[] {
  const hemisphere = new THREE.HemisphereLight(0xffffff, 0x8a7560, 1.1);
  // 窓の外の斜め上から差し込む日光（影は描かない）
  const sun = new THREE.DirectionalLight(0xfff4e0, 1.2);
  sun.position.set(-1.5, 4.5, -6.5);
  sun.target.position.set(0.5, 0, 0.8);
  return [hemisphere, sun, sun.target];
}

/** 部屋（リビング）の空間を作る */
export function createRoomScene(options: SpaceBuildOptions): Space {
  const root = new THREE.Group();
  root.name = "room";
  const materials = createRoomMaterials(options.maxAnisotropy);
  const unitBox = new THREE.BoxGeometry(1, 1, 1);

  root.add(...createFloorAndCeiling(materials));
  root.add(createWalls(materials, unitBox));
  root.add(createWindow(materials, unitBox));
  const { frame, door } = createDoor(materials, unitBox);
  root.add(frame, door);

  const furniture = new THREE.Group();
  furniture.name = "furniture";
  furniture.add(...createRoomFurniture(ROOM_FURNITURE, materials, unitBox));
  root.add(furniture);
  root.add(...createLights());

  return {
    id: "room",
    root,
    startPosition: new THREE.Vector3(...ROOM_START.position),
    startYaw: ROOM_START.yaw,
    background: ROOM_BACKGROUND,
    dispose: () => {
      root.removeFromParent();
      disposeObjectTree(root);
    },
  };
}
