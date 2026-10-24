// 確認用: プレイヤーの近くのドアを 1 つだけ開ける・閉める（開閉の状態 open と見た目をすぐ切り替える）．
// 歩行の当たり判定でドアを通れる・通れないの切り替えを確かめるためのもの．
// 開閉の動き（手で触れて開く・アニメーション・シナリオの演出）は後の Issue で作り，そちらに差し替える

import type * as THREE from "three";
import { slidingLeafX } from "./common/slidingDoor";
import { type WallDef, type WallRect, wallPointToWorld } from "./common/wallLayout";
import { type ElevatorSpace, isElevatorSpace } from "./elevator/elevator";
import {
  CABIN_DOOR_OPENING,
  CABIN_WALLS,
  type ElevatorDoorLeafUserData,
  type ElevatorDoorUserData,
} from "./elevator/elevatorLayout";
import { isRoomSpace, type RoomSpace } from "./room/room";
import {
  DOOR_OPENING,
  type DoorUserData as RoomDoorUserData,
  roomDoorRotationY,
  WALLS,
} from "./room/roomLayout";
import {
  type FireShutterUserData,
  placePoint,
  type SchoolDoorLeafUserData,
  type SchoolDoorUserData,
} from "./school/schoolLayout";
import { setFireShutterClosed, setSchoolDoorOpen } from "./school/schoolParts";
import { isSchoolPartsSpace, type SchoolPartsSpace } from "./school/schoolPartsPreview";
import { isTrainSpace, type TrainSpace } from "./train/train";
import {
  type DoorLeafUserData,
  GANGWAY_DOORS,
  SIDE_DOORS,
  type DoorUserData as TrainDoorUserData,
} from "./train/trainLayout";
import type { Space } from "./types";

/**
 * ボタンで開閉するドアを探す範囲（体の中心から開口部の中心まで，XZ 平面の距離．m）．
 * 本物のドア開閉（手で触れる）が入るまでのデバッグ用．入ったらこのファイルごと差し替える
 */
export const DEV_DOOR_REACH = 1.5;

export interface XZPoint {
  readonly x: number;
  readonly z: number;
}

/**
 * ドアの開口部の中心の一覧から，player から maxDistance 以内で最も近いものの添字を返す．
 * 範囲内に無ければ null．同じ距離なら先のものを選ぶ
 */
export function nearestDoorIndex(
  doorCenters: readonly XZPoint[],
  player: XZPoint,
  maxDistance: number = DEV_DOOR_REACH,
): number | null {
  let best: number | null = null;
  let bestDistance = Number.POSITIVE_INFINITY;
  for (const [i, center] of doorCenters.entries()) {
    const distance = Math.hypot(center.x - player.x, center.z - player.z);
    if (distance <= maxDistance && distance < bestDistance) {
      best = i;
      bestDistance = distance;
    }
  }
  return best;
}

/** 確認用に開閉できるドア 1 つ（複数の扉の板からなるドアもまとめて 1 つ） */
export interface DevDoor {
  readonly id: string;
  /** 開口部の下端の中心（root の座標の XZ） */
  readonly center: XZPoint;
  isOpen(): boolean;
  setOpen(open: boolean): void;
}

function openingCenter(wall: WallDef, opening: WallRect): XZPoint {
  const [x, , z] = wallPointToWorld(wall, (opening.u0 + opening.u1) / 2, opening.v0);
  return { x, z };
}

function slideLeaves(leaves: readonly THREE.Group[], amount: number): void {
  for (const leaf of leaves) {
    const data = leaf.userData as DoorLeafUserData | ElevatorDoorLeafUserData;
    data.openAmount = amount;
    leaf.position.x = slidingLeafX(data, amount);
  }
}

function leavesOf(leaves: readonly THREE.Group[], doorId: string): THREE.Group[] {
  return leaves.filter(
    (leaf) => (leaf.userData as DoorLeafUserData | ElevatorDoorLeafUserData).doorId === doorId,
  );
}

function roomDevDoors(space: RoomSpace): DevDoor[] {
  const door = space.parts.door;
  const data = door.userData as RoomDoorUserData;
  return [
    {
      id: data.id,
      center: openingCenter(WALLS.south, DOOR_OPENING),
      isOpen: () => data.open,
      setOpen: (open) => {
        data.open = open;
        data.openAngle = open ? data.maxOpenAngle : 0;
        door.rotation.y = roomDoorRotationY(data, data.openAngle);
      },
    },
  ];
}

function trainDevDoors(space: TrainSpace): DevDoor[] {
  const { parts } = space;
  return [...SIDE_DOORS, ...GANGWAY_DOORS].map((def): DevDoor => {
    const group = parts.byId.get(def.id);
    if (!group) throw new Error(`電車の部品がありません: ${def.id}`);
    const data = group.userData as TrainDoorUserData;
    const leaves = leavesOf(parts.doorLeaves, def.id);
    return {
      id: def.id,
      center: openingCenter(def.wall, def.opening),
      isOpen: () => data.open,
      setOpen: (open) => {
        data.open = open;
        slideLeaves(leaves, open ? 1 : 0);
      },
    };
  });
}

function elevatorDevDoors(space: ElevatorSpace): DevDoor[] {
  const { parts } = space;
  // かごの扉は 1 か所だけ（正面の壁の CABIN_DOOR_OPENING）
  return parts.doors.map((group): DevDoor => {
    const data = group.userData as ElevatorDoorUserData;
    const leaves = leavesOf(parts.doorLeaves, data.id);
    return {
      id: data.id,
      center: openingCenter(CABIN_WALLS.front, CABIN_DOOR_OPENING),
      isOpen: () => data.open,
      setOpen: (open) => {
        data.open = open;
        data.openAmount = open ? 1 : 0;
        slideLeaves(leaves, open ? 1 : 0);
      },
    };
  });
}

/** 部品の Group のローカル座標の点 (x, 0) を，親（パーツをまとめた Group．root と同じ座標）の XZ に変える */
function partPoint(group: THREE.Object3D, localX: number): XZPoint {
  return placePoint(
    { x: localX, z: 0 },
    { x: group.position.x, z: group.position.z, rotationY: group.rotation.y },
  );
}

function schoolPartsDevDoors(space: SchoolPartsSpace): DevDoor[] {
  const { parts } = space;
  // 外側だけの教室のドア（locked）は開かない扱いのため含めない
  const doors = parts.doors
    .filter((group) => !(group.userData as SchoolDoorUserData).locked)
    .map((group): DevDoor => {
      const data = group.userData as SchoolDoorUserData;
      const leaf = group.getObjectByName(data.leafName);
      const closedX = leaf ? (leaf.userData as SchoolDoorLeafUserData).closedX : 0;
      return {
        id: data.id,
        center: partPoint(group, closedX),
        isOpen: () => data.open,
        setOpen: (open) => {
          setSchoolDoorOpen(group, open);
        },
      };
    });
  // 防火シャッターは「開ける」を幕を上げる（closed を false にする）として扱う
  const shutters = parts.shutters.map((group): DevDoor => {
    const data = group.userData as FireShutterUserData;
    return {
      id: data.id,
      center: partPoint(group, 0),
      isOpen: () => !data.closed,
      setOpen: (open) => setFireShutterClosed(group, !open),
    };
  });
  return [...doors, ...shutters];
}

/** 空間の確認用に開閉できるドアの一覧 */
export function createDevDoors(space: Space): DevDoor[] {
  if (isRoomSpace(space)) return roomDevDoors(space);
  if (isTrainSpace(space)) return trainDevDoors(space);
  if (isElevatorSpace(space)) return elevatorDevDoors(space);
  if (isSchoolPartsSpace(space)) return schoolPartsDevDoors(space);
  return [];
}

/** player から DEV_DOOR_REACH 以内で最も近いドア（無ければ null） */
export function findNearbyDevDoor(doors: readonly DevDoor[], player: XZPoint): DevDoor | null {
  const index = nearestDoorIndex(
    doors.map((door) => door.center),
    player,
  );
  return index === null ? null : (doors[index] ?? null);
}
