// 空間の一覧．電車・エレベーターは実装したらここに足す

import { createRoomScene } from "./room/room";
import type { SceneId } from "./sceneParam";
import type { SceneBuildOptions, SceneFactory, SceneSpace } from "./types";

const SCENE_FACTORIES: Partial<Record<SceneId, SceneFactory>> = {
  room: createRoomScene,
};

/** 実装済みの空間の id */
export const AVAILABLE_SCENE_IDS = Object.keys(SCENE_FACTORIES) as SceneId[];

/** 空間を作る．未実装の id なら例外にする（呼ぶ前に resolveSceneId で絞る） */
export function createSceneSpace(id: SceneId, options: SceneBuildOptions): SceneSpace {
  const factory = SCENE_FACTORIES[id];
  if (!factory) throw new Error(`未実装の空間です: ${id}`);
  return factory(options);
}
