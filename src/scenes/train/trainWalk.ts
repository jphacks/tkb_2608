// 電車の歩行の当たり判定・エリア・目の高さ・着座（walk/ の WalkWorld を作る）．
// 壁はドア・窓・貫通扉の開口部を除いた板を，ドアは閉じている間だけ開口部をふさぐ．
// 開いたドアから出られるのは，左の側面のホームと，妻面の貫通扉の向こうの通路（箱）だけ（右の側面は線路）．
// 座席・縦の握り棒・ドアコック等の設備は家具の Group から障害物にする（頭上の横の握り棒・網棚は頭より上）

import type * as THREE from "three";
import { splitWallAroundOpening, splitWallAroundOpenings } from "../common/wallLayout";
import type { FloorArea } from "../walk/areas";
import type { Obstacle, XZRect } from "../walk/collision";
import { furnitureObstacles } from "../walk/furnitureObstacles";
import type { DoorBlocker, SeatSpot, WalkWorld } from "../walk/locomotion";
import { localToParentXZ, wallObstacles, wallRectObstacle } from "../walk/obstacles";
import type { TrainSpace } from "./train";
import {
  CAR,
  type DoorUserData,
  END_WALLS,
  EYE_HEIGHT,
  GANGWAY,
  GANGWAY_DOOR,
  GANGWAY_DOORS,
  PLATFORM,
  SEAT,
  type SeatUserData,
  SIDE_DOORS,
  SIDE_WALLS,
  SIDE_WINDOWS,
  sideSign,
  TRAIN_SIDES,
  type TrainDoorDef,
} from "./trainLayout";

const HALF_L = CAR.length / 2;
const HALF_W = CAR.width / 2;

/** 当たり判定での車体の壁の厚み（壁の面から外側へ．閉じた扉は壁の面の外 leafOffset にある） */
export const CAR_WALL_THICKNESS = 0.1;

/** ドアの前のエリアの奥行き（壁の面から車内へ） */
const DOOR_FRONT_DEPTH = 0.8;

/** 座席の前でしゃがむと座る範囲の奥行き（座面の前端から通路へ） */
const SIT_ZONE_DEPTH = 0.35;

/** 貫通扉の向こうの通路（箱）の床の範囲．壁の面から GANGWAY の奥行きの端まで */
export function gangwayRect(door: TrainDoorDef): XZRect {
  const sign = door.end === "front" ? -1 : 1;
  const near = sign * HALF_L;
  const far =
    sign * (HALF_L + GANGWAY_DOOR.leafOffset + GANGWAY_DOOR.leafThickness + GANGWAY.depth);
  return {
    minX: -GANGWAY.width / 2,
    maxX: GANGWAY.width / 2,
    minZ: Math.min(near, far),
    maxZ: Math.max(near, far),
  };
}

/** 側面のドアの開口部（壁の厚みの範囲）の床 */
function sideDoorwayRect(door: TrainDoorDef): XZRect {
  const sign = sideSign(door.side ?? "left");
  const z0 = door.wall.origin[2] + door.wall.dir[2] * door.opening.u0;
  const z1 = door.wall.origin[2] + door.wall.dir[2] * door.opening.u1;
  const x0 = sign * HALF_W;
  const x1 = sign * (HALF_W + CAR_WALL_THICKNESS);
  return {
    minX: Math.min(x0, x1),
    maxX: Math.max(x0, x1),
    minZ: Math.min(z0, z1),
    maxZ: Math.max(z0, z1),
  };
}

/** ホームの床の範囲（左の側面の外） */
export const PLATFORM_RECT: XZRect = (() => {
  const sign = sideSign(PLATFORM.side);
  const edge = sign * (HALF_W + PLATFORM.gap);
  const far = sign * (HALF_W + PLATFORM.gap + PLATFORM.width);
  return {
    minX: Math.min(edge, far),
    maxX: Math.max(edge, far),
    minZ: -PLATFORM.length / 2,
    maxZ: PLATFORM.length / 2,
  };
})();

/**
 * 体の中心が動ける床の範囲．車内・側面のドアの開口部（右の側面も開口部までは入れる）・
 * ホーム（左の側面の開口部の外とホームの端のすき間を含む）・貫通扉の向こうの通路
 */
export const TRAIN_FLOORS: readonly XZRect[] = [
  { minX: -HALF_W, maxX: HALF_W, minZ: -HALF_L, maxZ: HALF_L },
  ...SIDE_DOORS.map(sideDoorwayRect),
  { ...PLATFORM_RECT, maxX: PLATFORM_RECT.maxX + PLATFORM.gap },
  ...GANGWAY_DOORS.map(gangwayRect),
];

/** 車体の壁（開口部を除く．窓の下の腰壁は残る）と，貫通扉の向こうの通路の壁 */
export function trainWallObstacles(): Obstacle[] {
  const t = CAR_WALL_THICKNESS;
  const sides = TRAIN_SIDES.flatMap((side) => {
    const wall = SIDE_WALLS[side];
    const openings = [
      ...SIDE_DOORS.filter((d) => d.side === side).map((d) => d.opening),
      ...SIDE_WINDOWS.filter((w) => w.wall === wall).map((w) => w.opening),
    ];
    return wallObstacles(wall, splitWallAroundOpenings(wall.length, CAR.height, openings), t);
  });
  const ends = GANGWAY_DOORS.flatMap((door) =>
    wallObstacles(
      END_WALLS[door.end ?? "front"],
      splitWallAroundOpening(door.wall.length, CAR.height, door.opening),
      t,
    ),
  );
  const gangways = GANGWAY_DOORS.flatMap((door): Obstacle[] => {
    const rect = gangwayRect(door);
    const farZ = door.end === "front" ? rect.minZ : rect.maxZ;
    const sign = door.end === "front" ? -1 : 1;
    const base = { minY: 0, maxY: GANGWAY.height };
    return [
      { id: `${door.id}-gangway-left`, ...base, ...rect, minX: rect.minX - t, maxX: rect.minX },
      { id: `${door.id}-gangway-right`, ...base, ...rect, minX: rect.maxX, maxX: rect.maxX + t },
      {
        id: `${door.id}-gangway-end`,
        ...base,
        minX: rect.minX - t,
        maxX: rect.maxX + t,
        minZ: Math.min(farZ, farZ + sign * t),
        maxZ: Math.max(farZ, farZ + sign * t),
      },
    ];
  });
  return [...sides, ...ends, ...gangways];
}

/** ドアの前のエリア（車内．開口部の幅で壁の面から DOOR_FRONT_DEPTH）．id は `${ドアの id}-front` */
function doorFrontArea(door: TrainDoorDef): FloorArea {
  const { wall, opening } = door;
  const corners = [
    [opening.u0, 0],
    [opening.u1, DOOR_FRONT_DEPTH],
  ].map(([u, offset]) => ({
    x: wall.origin[0] + wall.dir[0] * u + wall.normal[0] * offset,
    z: wall.origin[2] + wall.dir[2] * u + wall.normal[2] * offset,
  }));
  const [a, b] = corners as [{ x: number; z: number }, { x: number; z: number }];
  return {
    id: `${door.id}-front`,
    minX: Math.min(a.x, b.x),
    maxX: Math.max(a.x, b.x),
    minZ: Math.min(a.z, b.z),
    maxZ: Math.max(a.z, b.z),
  };
}

/**
 * 電車のエリア．ドアの前（door-left-1-front・emergency-door-front 等），
 * ホーム（platform．T1 の終了），貫通扉の向こうの通路（emergency-door-gangway．T2 の終了・
 * gangway-door-rear-gangway）
 */
export const TRAIN_AREAS: readonly FloorArea[] = [
  ...[...SIDE_DOORS, ...GANGWAY_DOORS].map(doorFrontArea),
  { id: "platform", ...PLATFORM_RECT },
  ...GANGWAY_DOORS.map((door): FloorArea => ({ id: `${door.id}-gangway`, ...gangwayRect(door) })),
];

/** 座席の着座位置ごとの SeatSpot（座席の Group の今の位置・向きから求める） */
export function seatSpots(seat: THREE.Object3D): SeatSpot[] {
  const data = seat.userData as SeatUserData;
  const toCar = (x: number, z: number) => localToParentXZ(seat.position, seat.rotation.y, { x, z });
  const front = data.size.z / 2;
  return data.slots.map((slot) => {
    const [ex, ey, ez] = slot.eyePosition;
    const eye = toCar(ex, ez);
    const a = toCar(ex - SEAT.personWidth / 2, front);
    const b = toCar(ex + SEAT.personWidth / 2, front + SIT_ZONE_DEPTH);
    return {
      id: `${seat.name}-${slot.index + 1}`,
      x: eye.x,
      z: eye.z,
      eyeHeight: seat.position.y + ey,
      facingYaw: data.facingYaw,
      zone: {
        minX: Math.min(a.x, b.x),
        maxX: Math.max(a.x, b.x),
        minZ: Math.min(a.z, b.z),
        maxZ: Math.max(a.z, b.z),
      },
    };
  });
}

/** 電車の WalkWorld を作る（座席・手すり・設備の Group の今の位置から障害物を作る） */
export function createTrainWalkWorld(space: TrainSpace): WalkWorld {
  const { parts } = space;
  const doors = [...SIDE_DOORS, ...GANGWAY_DOORS].map((def): DoorBlocker => {
    const group = parts.byId.get(def.id);
    if (!group) throw new Error(`電車の部品がありません: ${def.id}`);
    return {
      id: def.id,
      obstacle: wallRectObstacle(def.wall, def.opening, CAR_WALL_THICKNESS, def.id),
      isOpen: () => (group.userData as DoorUserData).open,
    };
  });
  return {
    floors: TRAIN_FLOORS,
    obstacles: [
      ...trainWallObstacles(),
      ...furnitureObstacles([
        ...parts.seats,
        ...parts.handrails,
        ...parts.doorCocks,
        ...parts.intercoms,
        ...parts.racks,
        ...parts.luggage,
      ]),
    ],
    doors,
    areas: TRAIN_AREAS,
    eyeHeights: EYE_HEIGHT,
    seats: parts.seats.flatMap(seatSpots),
  };
}
