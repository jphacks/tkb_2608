// 空間の一覧（URL パラメータで選んだ 1 つだけを作る）

import { createElevatorScene, isElevatorSpace } from "./elevator/elevator";
import { createElevatorWalkWorld } from "./elevator/elevatorWalk";
import { createRoomScene, isRoomSpace } from "./room/room";
import { createRoomWalkWorld } from "./room/roomWalk";
import { createSchoolPartsScene, isSchoolPartsSpace } from "./school/schoolPartsPreview";
import { createSchoolPartsWalkWorld } from "./school/schoolPartsWalk";
import type { SpaceId } from "./spaceParam";
import { createTrainScene, isTrainSpace } from "./train/train";
import { createTrainWalkWorld } from "./train/trainWalk";
import type { Space, SpaceBuildOptions, SpaceFactory } from "./types";
import type { WalkWorld } from "./walk/locomotion";

const SPACE_FACTORIES: Partial<Record<SpaceId, SpaceFactory>> = {
  room: createRoomScene,
  train: createTrainScene,
  elevator: createElevatorScene,
  "school-parts": createSchoolPartsScene,
};

/** 実装済みの空間の id */
export const AVAILABLE_SPACE_IDS = Object.keys(SPACE_FACTORIES) as SpaceId[];

/** 空間を作る．未実装の id なら例外にする（呼ぶ前に resolveSpaceId で絞る） */
export function createSpace(id: SpaceId, options: SpaceBuildOptions): Space {
  const factory = SPACE_FACTORIES[id];
  if (!factory) throw new Error(`未実装の空間です: ${id}`);
  return factory(options);
}

/** 空間の歩行の当たり判定・エリア・目の高さを作る（空間の物の今の位置から） */
export function createWalkWorld(space: Space): WalkWorld {
  if (isRoomSpace(space)) return createRoomWalkWorld(space);
  if (isTrainSpace(space)) return createTrainWalkWorld(space);
  if (isElevatorSpace(space)) return createElevatorWalkWorld(space);
  if (isSchoolPartsSpace(space)) return createSchoolPartsWalkWorld(space);
  throw new Error(`歩行の当たり判定が未実装の空間です: ${space.id}`);
}
