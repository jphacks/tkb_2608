// 空間の一覧（URL パラメータで選んだ 1 つだけを作る）

import { createElevatorScene } from "./elevator/elevator";
import { createRoomScene } from "./room/room";
import type { SpaceId } from "./spaceParam";
import { createTrainScene } from "./train/train";
import type { Space, SpaceBuildOptions, SpaceFactory } from "./types";

const SPACE_FACTORIES: Partial<Record<SpaceId, SpaceFactory>> = {
  room: createRoomScene,
  train: createTrainScene,
  elevator: createElevatorScene,
};

/** 実装済みの空間の id */
export const AVAILABLE_SPACE_IDS = Object.keys(SPACE_FACTORIES) as SpaceId[];

/** 空間を作る．未実装の id なら例外にする（呼ぶ前に resolveSpaceId で絞る） */
export function createSpace(id: SpaceId, options: SpaceBuildOptions): Space {
  const factory = SPACE_FACTORIES[id];
  if (!factory) throw new Error(`未実装の空間です: ${id}`);
  return factory(options);
}
