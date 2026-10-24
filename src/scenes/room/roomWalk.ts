// 部屋（リビング）の歩行の当たり判定・エリア・目の高さ（walk/ の WalkWorld を作る）．
// 壁は窓・ドアの開口部を除いた板を，廊下へ出るドアは閉じている間だけ開口部をふさぐ．
// テーブルは天板（脚の上）と脚 4 本に分け，天板の下にはしゃがんだ時だけ入れる

import type * as THREE from "three";
import { computeFootprint } from "../common/furniture";
import { furnitureFootprint } from "../common/furnitureGroup";
import { splitWallAroundOpening } from "../common/wallLayout";
import type { Obstacle, XZRect } from "../walk/collision";
import { furnitureObstacles } from "../walk/furnitureObstacles";
import type { DoorBlocker, WalkWorld } from "../walk/locomotion";
import {
  footprintObstacle,
  fullWallRect,
  localToParentXZ,
  wallObstacles,
  wallRectObstacle,
} from "../walk/obstacles";
import type { RoomSpace } from "./room";
import {
  DOOR_OPENING,
  DOOR_SPAN_X,
  type DoorUserData,
  EYE_HEIGHT,
  HALLWAY,
  HALLWAY_DOOR_OPENING,
  HALLWAY_WALLS,
  ROOM,
  TABLE_ID,
  type TableLegUserData,
  type TableUserData,
  tableUndersideY,
  WALL_THICKNESS,
  WALLS,
  WINDOW_OPENING,
} from "./roomLayout";

/** 体の中心が動ける床の範囲（部屋・ドアの開口部（壁の厚み）・廊下） */
export const ROOM_FLOORS: readonly XZRect[] = [
  { minX: -ROOM.width / 2, maxX: ROOM.width / 2, minZ: -ROOM.depth / 2, maxZ: ROOM.depth / 2 },
  { minX: DOOR_SPAN_X.minX, maxX: DOOR_SPAN_X.maxX, minZ: ROOM.depth / 2, maxZ: HALLWAY.nearZ },
  { minX: HALLWAY.minX, maxX: HALLWAY.maxX, minZ: HALLWAY.nearZ, maxZ: HALLWAY.farZ },
];

/** 部屋と廊下の壁の障害物（窓・ドアの開口部を除く．窓の下の腰壁は残る） */
export function roomWallObstacles(): Obstacle[] {
  const h = ROOM.height;
  return [
    ...wallObstacles(
      WALLS.north,
      splitWallAroundOpening(WALLS.north.length, h, WINDOW_OPENING),
      WALL_THICKNESS,
    ),
    ...wallObstacles(WALLS.east, [fullWallRect(WALLS.east, h)], WALL_THICKNESS),
    ...wallObstacles(
      WALLS.south,
      splitWallAroundOpening(WALLS.south.length, h, DOOR_OPENING),
      WALL_THICKNESS,
    ),
    ...wallObstacles(WALLS.west, [fullWallRect(WALLS.west, h)], WALL_THICKNESS),
    ...wallObstacles(
      HALLWAY_WALLS.near,
      splitWallAroundOpening(HALLWAY_WALLS.near.length, HALLWAY.height, HALLWAY_DOOR_OPENING),
      WALL_THICKNESS,
    ),
    ...[HALLWAY_WALLS.east, HALLWAY_WALLS.far, HALLWAY_WALLS.west].flatMap((wall) =>
      wallObstacles(wall, [fullWallRect(wall, HALLWAY.height)], WALL_THICKNESS),
    ),
  ];
}

/** 閉じたドアがふさぐ開口部（南の壁の面から壁の厚みまで） */
export const ROOM_DOOR_OBSTACLE: Obstacle = wallRectObstacle(
  WALLS.south,
  DOOR_OPENING,
  WALL_THICKNESS,
  "door",
);

/**
 * テーブルの障害物．天板は脚の上（下面から上面まで）の範囲だけをふさぎ，その下は空ける．
 * 脚は床から天板の下面まで
 */
export function tableObstacles(table: THREE.Object3D, legs: readonly THREE.Object3D[]): Obstacle[] {
  const { size } = table.userData as TableUserData;
  const y = table.position.y;
  const top = footprintObstacle(
    `${table.name}-top`,
    furnitureFootprint(table),
    y + tableUndersideY(size),
    y + size.y,
  );
  const legObstacles = legs.map((leg) => {
    const legData = leg.userData as TableLegUserData;
    const center = localToParentXZ(table.position, table.rotation.y, leg.position);
    return footprintObstacle(
      leg.name,
      computeFootprint(center, table.rotation.y, legData.size),
      y + leg.position.y,
      y + leg.position.y + legData.size.y,
    );
  });
  return [top, ...legObstacles];
}

/** 部屋の WalkWorld を作る（家具の Group の今の位置から障害物を作る） */
export function createRoomWalkWorld(space: RoomSpace): WalkWorld {
  const { parts } = space;
  const table = parts.byId.get(TABLE_ID);
  if (!table) throw new Error(`部屋の部品がありません: ${TABLE_ID}`);
  const others = parts.furniture.children.filter((child) => child !== table);
  const door: DoorBlocker = {
    id: "door",
    obstacle: ROOM_DOOR_OBSTACLE,
    isOpen: () => (parts.door.userData as DoorUserData).open,
  };
  return {
    floors: ROOM_FLOORS,
    obstacles: [
      ...roomWallObstacles(),
      ...tableObstacles(table, parts.tableLegs),
      ...furnitureObstacles(others),
    ],
    doors: [door],
    areas: parts.areas,
    eyeHeights: EYE_HEIGHT,
    seats: [],
  };
}
