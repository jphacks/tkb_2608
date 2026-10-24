// HandLandmarker を作って 1 枚ずつ認識する部分（Worker とメインスレッドの両方から使う）．
// @mediapipe/tasks-vision は使う時に動的に読み込み，最初の読み込み（本番の画面）に含めない
import type { HandAssetUrls } from "./handAssets";
import { observationsFromResult } from "./handPacking";
import type { HandObservation } from "./types";

export type LandmarkerDelegate = "GPU" | "CPU";

export interface HandDetector {
  readonly delegate: LandmarkerDelegate;
  /** 1 枚を認識する（同期．時刻は内部で単調に増やす）．t は映像の時刻（ms） */
  detect(image: ImageBitmap | HTMLVideoElement, t: number): HandObservation[];
  close(): void;
}

type CanvasLike = HTMLCanvasElement | OffscreenCanvas;

/** wasm の読み込み用のスクリプトが置く関数（ライブラリはこれを使って wasm を起動する） */
type GlobalWithFactory = typeof globalThis & { ModuleFactory?: unknown };

/**
 * HandLandmarker を作る．GPU で作れなければ CPU で作り直す．
 * makeCanvas は GPU の処理に使う canvas を作る（Worker では OffscreenCanvas）
 */
export async function createHandDetector(
  urls: HandAssetUrls,
  makeCanvas: () => CanvasLike | undefined,
): Promise<HandDetector> {
  const vision = await import("@mediapipe/tasks-vision");
  // wasm の読み込み用のスクリプト（ES モジュールの版）は読むと globalThis.ModuleFactory を置く．
  // 先に読んでおき，wasmLoaderPath を空にしてライブラリに読み直させない
  // （ライブラリは Worker では importScripts，メインスレッドでは <script> で読もうとし，ES モジュールの版を読めないため）
  // ライブラリは作り終えると globalThis.ModuleFactory を消すため，作り直す（GPU → CPU・カメラの差し替え）たびに置き直す
  const loader: { default?: unknown } = await import(/* @vite-ignore */ urls.wasmLoaderUrl);
  const factory = loader.default ?? (globalThis as GlobalWithFactory).ModuleFactory;
  if (typeof factory !== "function") throw new Error("wasm の読み込み用のスクリプトを読めません");
  const fileset = { wasmLoaderPath: "", wasmBinaryPath: urls.wasmBinaryUrl };
  const create = (delegate: LandmarkerDelegate) => {
    (globalThis as GlobalWithFactory).ModuleFactory = factory;
    return vision.HandLandmarker.createFromOptions(fileset, {
      baseOptions: { modelAssetPath: urls.modelUrl, delegate },
      canvas: makeCanvas(),
      runningMode: "VIDEO",
      numHands: 2,
    });
  };
  let delegate: LandmarkerDelegate = "GPU";
  let landmarker: Awaited<ReturnType<typeof create>>;
  try {
    landmarker = await create("GPU");
  } catch {
    delegate = "CPU";
    landmarker = await create("CPU");
  }
  // detectForVideo は同じ時刻・戻った時刻を渡すと結果が壊れるため，単調に増やす
  let lastTs = Number.NEGATIVE_INFINITY;
  return {
    delegate,
    detect(image, t) {
      const ts = Math.max(Math.round(t), Math.floor(lastTs) + 1);
      lastTs = ts;
      return observationsFromResult(landmarker.detectForVideo(image, ts));
    },
    close() {
      landmarker.close();
    },
  };
}
