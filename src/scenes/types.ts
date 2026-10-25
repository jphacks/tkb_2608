// 空間（部屋・電車・エレベーター）の共通インターフェース．
// 画面の種類（core/scene.ts の SceneId）と区別するため，空間は「Space」と呼ぶ

import type { ColorRepresentation, Fog, FogExp2, Group, Vector3 } from "three";
import type { Posture } from "../core/types";
import type { SpaceId } from "./spaceParam";

export type { SpaceId } from "./spaceParam";

/** 空間を作るときの描画側の設定 */
export interface SpaceBuildOptions {
  /** テクスチャの異方性フィルタの上限（renderer.capabilities.getMaxAnisotropy() 等） */
  readonly maxAnisotropy: number;
}

/** 毎フレーム空間に渡す値（Space.update の引数） */
export interface SpaceFrame {
  /** 非常ベルからの秒数（s．単独で開いた時は scenes/alarmClock.ts の決め方，体験の流れでは app/ の時刻） */
  readonly seconds: number;
  /** 目の位置（ワールド座標，m．THREE.Vector3 もそのまま渡せる）．目が無い視点（見下ろし等）は null */
  readonly eye: { readonly x: number; readonly y: number; readonly z: number } | null;
  /** 前のフレームからの経過時間（s．実際の時間．省略可．赤い表示のフェード等に使い，無ければ瞬時に切り替える） */
  readonly dt?: number;
  /** 今の姿勢（省略可．単独で開いた校舎が赤い表示を自分で判定する時に使う．無ければ立っている扱い） */
  readonly posture?: Posture;
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
  /**
   * 空間全体に効くフォグ（省略可．無い空間はフォグなし）．呼び出し側が scene.fog に付け，空間を切り替える時に外す．
   * 濃さ等は update が書き換えてよい
   */
  readonly fog?: Fog | FogExp2;
  /** 毎フレームの更新（省略可．時刻や目の位置で見た目が変わる空間だけが持つ．描画の前に呼ぶ） */
  update?(frame: SpaceFrame): void;
  /** ジオメトリ・マテリアル・テクスチャを解放する */
  dispose(): void;
}

export type SpaceFactory = (options: SpaceBuildOptions) => Space;
