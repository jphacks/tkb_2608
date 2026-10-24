// 空間（部屋・電車・エレベーター）の共通インターフェース

import type { ColorRepresentation, Group, Vector3 } from "three";
import type { SceneId } from "./sceneParam";

export type { SceneId } from "./sceneParam";

/** 空間を作るときの描画側の設定 */
export interface SceneBuildOptions {
  /** テクスチャの異方性フィルタの上限（renderer.capabilities.getMaxAnisotropy() 等） */
  readonly maxAnisotropy: number;
}

/** 1 つの空間．root を Scene に追加すれば表示できる（照明も root に含む） */
export interface SceneSpace {
  readonly id: SceneId;
  readonly root: Group;
  /** 開始時の目の位置（ワールド座標，m） */
  readonly startPosition: Vector3;
  /** 開始時の向き（Y 軸回り，rad．0 で -Z を向き，正で左へ回る） */
  readonly startYaw: number;
  /** Scene の背景色 */
  readonly background: ColorRepresentation;
  /** ジオメトリ・マテリアル・テクスチャを解放する */
  dispose(): void;
}

export type SceneFactory = (options: SceneBuildOptions) => SceneSpace;
