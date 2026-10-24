// 手の認識の Worker（experiment_山﨑/07「Worker で動かす」）．ImageBitmap を受け取って認識し，21 点だけを返す．
// メインスレッドは結果を待たずに描画を続けられる
import { packHands } from "./handPacking";
import type { FromHandWorker, ToHandWorker } from "./handWorkerProtocol";
import { createHandDetector, type HandDetector } from "./landmarkerCore";

/** Worker の中の self のうち使う部分（tsconfig の lib に WebWorker を入れないため） */
interface WorkerScope {
  postMessage(message: FromHandWorker, transfer?: Transferable[]): void;
  addEventListener(type: "message", listener: (e: MessageEvent<ToHandWorker>) => void): void;
  close(): void;
}

const scope = self as unknown as WorkerScope;
let detector: HandDetector | null = null;

function post(message: FromHandWorker, transfer?: Transferable[]): void {
  scope.postMessage(message, transfer);
}

scope.addEventListener("message", (e) => {
  const msg = e.data;
  if (msg.type === "init") {
    createHandDetector(msg.urls, () =>
      typeof OffscreenCanvas === "undefined" ? undefined : new OffscreenCanvas(1, 1),
    ).then(
      (d) => {
        detector = d;
        post({ type: "ready", delegate: d.delegate });
      },
      (error: unknown) => {
        post({ type: "error", message: error instanceof Error ? error.message : String(error) });
      },
    );
    return;
  }
  if (msg.type === "frame") {
    const { bitmap } = msg;
    const width = bitmap.width;
    const height = bitmap.height;
    let packed = null;
    const start = performance.now();
    try {
      if (detector !== null) packed = packHands(detector.detect(bitmap, msg.t));
    } catch {
      packed = null;
    } finally {
      bitmap.close();
    }
    const inferMs = performance.now() - start;
    post(
      { type: "result", id: msg.id, t: msg.t, inferMs, width, height, packed },
      packed === null ? [] : [packed.points.buffer],
    );
    return;
  }
  detector?.close();
  detector = null;
  scope.close();
});
