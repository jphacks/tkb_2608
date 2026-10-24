// エレベーターの歩行の当たり判定・エリア・目の高さ（walk/ の WalkWorld を作る）．
// かごの壁は扉の開口部を除いた板を，扉は閉じている間だけ開口部をふさぐ．開いた扉から乗り場へ出られる．
// 座標はかごが原点にある（揺らしていない・上下させていない）前提で，かごの座標を root の座標として扱う

import { splitWallAroundOpening } from "../common/wallLayout";
import type { FloorArea } from "../walk/areas";
import type { Obstacle, XZRect } from "../walk/collision";
import { furnitureObstacles } from "../walk/furnitureObstacles";
import type { DoorBlocker, WalkWorld } from "../walk/locomotion";
import { fullWallRect, wallObstacles, wallRectObstacle } from "../walk/obstacles";
import type { ElevatorSpace } from "./elevator";
import {
  CABIN,
  CABIN_DOOR,
  CABIN_DOOR_ID,
  CABIN_DOOR_OPENING,
  CABIN_WALLS,
  type ElevatorDoorUserData,
  EYE_HEIGHT,
  HALL,
  HALL_DOOR_OPENING,
  HALL_WALL_Z,
  HALL_WALLS,
} from "./elevatorLayout";

const HALF_W = CABIN.width / 2;
const HALF_D = CABIN.depth / 2;

/** 当たり判定での壁の厚み（壁の面から外側へ．かごと乗り場のすき間 DOOR_GAP.depth と同じ） */
export const ELEVATOR_WALL_THICKNESS = 0.1;

/** 扉の前のエリアの奥行き（正面の壁から，かごの内側へ） */
const DOOR_FRONT_DEPTH = 0.6;

const CABIN_RECT: XZRect = { minX: -HALF_W, maxX: HALF_W, minZ: -HALF_D, maxZ: HALF_D };

/** 乗り場の床の範囲（root の座標） */
export const HALL_RECT: XZRect = {
  minX: -HALL.width / 2,
  maxX: HALL.width / 2,
  minZ: HALL_WALL_Z - HALL.depth,
  maxZ: HALL_WALL_Z,
};

/** 体の中心が動ける床の範囲（かご・扉の開口部（かごと乗り場のすき間）・乗り場） */
export const ELEVATOR_FLOORS: readonly XZRect[] = [
  CABIN_RECT,
  { minX: -CABIN_DOOR.width / 2, maxX: CABIN_DOOR.width / 2, minZ: HALL_WALL_Z, maxZ: -HALF_D },
  HALL_RECT,
];

/** かごと乗り場の壁（扉の開口部を除く） */
export function elevatorWallObstacles(): Obstacle[] {
  const t = ELEVATOR_WALL_THICKNESS;
  return [
    ...wallObstacles(
      CABIN_WALLS.front,
      splitWallAroundOpening(CABIN_WALLS.front.length, CABIN.height, CABIN_DOOR_OPENING),
      t,
    ),
    ...[CABIN_WALLS.right, CABIN_WALLS.rear, CABIN_WALLS.left].flatMap((wall) =>
      wallObstacles(wall, [fullWallRect(wall, CABIN.height)], t),
    ),
    ...wallObstacles(
      HALL_WALLS.car,
      splitWallAroundOpening(HALL_WALLS.car.length, HALL.height, HALL_DOOR_OPENING),
      t,
    ),
    ...[HALL_WALLS.far, HALL_WALLS.right, HALL_WALLS.left].flatMap((wall) =>
      wallObstacles(wall, [fullWallRect(wall, HALL.height)], t),
    ),
  ];
}

/** 閉じた扉がふさぐ開口部（正面の壁の面から乗り場の壁まで） */
export const CABIN_DOOR_OBSTACLE: Obstacle = wallRectObstacle(
  CABIN_WALLS.front,
  CABIN_DOOR_OPENING,
  ELEVATOR_WALL_THICKNESS,
  CABIN_DOOR_ID,
);

/**
 * エレベーターのエリア．かごの中（cabin），扉の前（door-front．かごの内側），
 * 乗り場（hall．かごから出た．E1・E2 の終了）
 */
export const ELEVATOR_AREAS: readonly FloorArea[] = [
  { id: "cabin", ...CABIN_RECT },
  {
    id: "door-front",
    minX: -CABIN_DOOR.width / 2,
    maxX: CABIN_DOOR.width / 2,
    minZ: -HALF_D,
    maxZ: -HALF_D + DOOR_FRONT_DEPTH,
  },
  { id: "hall", ...HALL_RECT },
];

/** エレベーターの WalkWorld を作る（手すりの Group の今の位置から障害物を作る） */
export function createElevatorWalkWorld(space: ElevatorSpace): WalkWorld {
  const { parts } = space;
  const doors = parts.doors.map(
    (group): DoorBlocker => ({
      id: group.name,
      obstacle: CABIN_DOOR_OBSTACLE,
      isOpen: () => (group.userData as ElevatorDoorUserData).open,
    }),
  );
  return {
    floors: ELEVATOR_FLOORS,
    obstacles: [...elevatorWallObstacles(), ...furnitureObstacles(parts.handrails)],
    doors,
    areas: ELEVATOR_AREAS,
    eyeHeights: EYE_HEIGHT,
    seats: [],
  };
}
