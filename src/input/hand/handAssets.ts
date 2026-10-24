// HandLandmarker のモデルと wasm の置き場所（public/mediapipe/ に同梱して自前で配信する．ENV_01）．
// 取得元・版・取り直す手順は docs/02_ENV/ENV_04「ハンドトラッキングのモデルと wasm」．
// - wasm: npm の @mediapipe/tasks-vision（package.json で版を固定）の wasm/vision_wasm_module_internal.{js,wasm}
//   （ES モジュールの版．Worker（type: "module"）でもメインスレッドでも import() で読める）
// - モデル: https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task

/** 認識に使うファイルの URL（絶対 URL．Worker にもそのまま渡す） */
export interface HandAssetUrls {
  readonly wasmLoaderUrl: string;
  readonly wasmBinaryUrl: string;
  readonly modelUrl: string;
}

/** 置き場所（public/ からの相対） */
export const HAND_ASSET_PATHS = {
  wasmLoader: "mediapipe/wasm/vision_wasm_module_internal.js",
  wasmBinary: "mediapipe/wasm/vision_wasm_module_internal.wasm",
  model: "mediapipe/hand_landmarker.task",
} as const;

/** base（import.meta.env.BASE_URL）と，ページの URL（location.href）から絶対 URL を作る */
export function resolveHandAssetUrls(base: string, pageUrl: string): HandAssetUrls {
  const root = new URL(base.endsWith("/") ? base : `${base}/`, pageUrl);
  return {
    wasmLoaderUrl: new URL(HAND_ASSET_PATHS.wasmLoader, root).href,
    wasmBinaryUrl: new URL(HAND_ASSET_PATHS.wasmBinary, root).href,
    modelUrl: new URL(HAND_ASSET_PATHS.model, root).href,
  };
}
