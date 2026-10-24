// 手の認識の Worker とメインスレッドの間のメッセージの形
import type { HandAssetUrls } from "./handAssets";
import type { PackedHands } from "./handPacking";
import type { LandmarkerDelegate } from "./landmarkerCore";

export type ToHandWorker =
  | { readonly type: "init"; readonly urls: HandAssetUrls }
  /** 認識する 1 枚（bitmap は転送する．Worker が閉じる） */
  | {
      readonly type: "frame";
      readonly id: number;
      readonly t: number;
      readonly bitmap: ImageBitmap;
    }
  | { readonly type: "close" };

export type FromHandWorker =
  | { readonly type: "ready"; readonly delegate: LandmarkerDelegate }
  | { readonly type: "error"; readonly message: string }
  | {
      readonly type: "result";
      readonly id: number;
      readonly t: number;
      /** 認識そのものにかかった時間（ms） */
      readonly inferMs: number;
      readonly width: number;
      readonly height: number;
      /** 認識に失敗した時は null */
      readonly packed: PackedHands | null;
    };
