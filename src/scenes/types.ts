// 空間（部屋・電車・エレベーター）の共通インターフェース．
// 画面の種類（core/scene.ts の SceneId）と区別するため，空間は「Space」と呼ぶ

import type { ColorRepresentation, Group, Vector3 } from "three";
import type { SpaceId } from "./spaceParam";

export type { SpaceId } from "./spaceParam";

/** 空間を作るときの描画側の設定 */
export interface SpaceBuildOptions {
  /** テクスチャの異方性フィルタの上限（renderer.capabilities.getMaxAnisotropy() 等） */
  readonly maxAnisotropy: number;
}

/** 1 つの空間．root を Scene に追加すれば表示できる（照明も root に含む） */
export interface Space {
  readonly id: SpaceId;
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

export type SpaceFactory = (options: SpaceBuildOptions) => Space;
