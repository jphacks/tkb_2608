// カメラの映像から手を認識する殻（experiment_山﨑/07「認識」「背圧の制御」）．ブラウザ API はここに閉じ込める．
// - Worker（type: "module"）で HandLandmarker を動かし，映像を縮小した ImageBitmap を転送する
// - Worker が使えない・作れない時は，メインスレッドで描画のフレームの外（setTimeout）で認識する
// - 処理中の認識は 1 つまで．認識中に届いた映像は捨て，終わった後の最新の映像を次に渡す（遅れを溜めない）
import type { HandAssetUrls } from "./handAssets";
import { unpackHands } from "./handPacking";
import type { FromHandWorker, ToHandWorker } from "./handWorkerProtocol";
import type { HandDetector, LandmarkerDelegate } from "./landmarkerCore";
import type { HandFrameResult } from "./types";

export type RecognizerBackend = "worker" | "main";
export type RecognizerStatus = "loading" | "running" | "failed" | "stopped";

export interface HandRecognizerOptions {
  readonly stream: MediaStream;
  readonly urls: HandAssetUrls;
  readonly onResult: (result: HandFrameResult) => void;
  /** Worker に渡す画像の幅（px）．映像の幅より大きければ映像の幅にする．高さは映像の縦横比から決める（既定 640） */
  readonly width?: number;
  /** Worker を使うか（既定: 使えれば使う）．false でメインスレッドで認識する */
  readonly useWorker?: boolean;
  /** 状態が変わった時（dev ページの表示用） */
  readonly onStatus?: (status: RecognizerStatus) => void;
}

/** Worker の準備（wasm 約 13 MB・モデル約 8 MB の読み込みを含む）を待つ上限（ms） */
const INIT_TIMEOUT_MS = 60_000;
/** 結果が届かないまま，処理中とみなし続ける上限（ms）．メッセージが失われても止まらないようにする */
const IN_FLIGHT_TIMEOUT_MS = 2000;

type VideoWithFrameCallback = HTMLVideoElement & {
  requestVideoFrameCallback?: (callback: (now: number) => void) => number;
  cancelVideoFrameCallback?: (handle: number) => void;
};

function canUseWorker(): boolean {
  return (
    typeof Worker !== "undefined" &&
    typeof OffscreenCanvas !== "undefined" &&
    typeof createImageBitmap === "function"
  );
}

export class HandRecognizer {
  readonly video: HTMLVideoElement;
  status: RecognizerStatus = "loading";
  backend: RecognizerBackend | null = null;
  delegate: LandmarkerDelegate | null = null;
  /** 最後に起きたエラーの説明（dev ページの表示用） */
  error: string | null = null;

  private readonly options: HandRecognizerOptions;
  private intervalMs = 1000 / 15;
  private worker: Worker | null = null;
  private detector: HandDetector | null = null;
  private inFlightSince: number | null = null;
  private lastSentT = Number.NEGATIVE_INFINITY;
  private frameId = 0;
  private frameHandle: number | null = null;
  private usingVideoCallback = false;
  private disposed = false;
  private readonly onTrackEnded = () => this.setStatus("stopped");

  constructor(options: HandRecognizerOptions) {
    this.options = options;
    const video = document.createElement("video");
    video.muted = true;
    video.playsInline = true;
    video.autoplay = true;
    // iOS の Safari は DOM に無い video のフレームを進めないことがあるため，見えない形で置く
    video.style.cssText =
      "position:fixed;left:0;top:0;width:1px;height:1px;opacity:0;pointer-events:none;";
    video.srcObject = options.stream;
    document.body.appendChild(video);
    void video.play().catch(() => undefined);
    this.video = video;
    for (const track of options.stream.getVideoTracks()) {
      track.addEventListener("ended", this.onTrackEnded);
    }

    if (options.useWorker !== false && canUseWorker()) this.startWorker();
    else void this.startMain();
    this.scheduleFrame();
  }

  /** 認識の頻度（回/秒）を変える */
  setRateHz(hz: number): void {
    if (hz > 0 && Number.isFinite(hz)) this.intervalMs = 1000 / hz;
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.cancelFrame();
    for (const track of this.options.stream.getVideoTracks()) {
      track.removeEventListener("ended", this.onTrackEnded);
    }
    if (this.worker !== null) {
      this.post({ type: "close" });
      this.worker.terminate();
      this.worker = null;
    }
    this.detector?.close();
    this.detector = null;
    // カメラの映像そのもの（MediaStream）は渡した側が止める
    this.video.srcObject = null;
    this.video.remove();
    this.status = "stopped";
  }

  private setStatus(status: RecognizerStatus): void {
    if (this.status === status) return;
    this.status = status;
    this.options.onStatus?.(status);
  }

  private post(message: ToHandWorker, transfer: Transferable[] = []): void {
    this.worker?.postMessage(message, transfer);
  }

  private startWorker(): void {
    let worker: Worker;
    try {
      worker = new Worker(new URL("./handWorker.ts", import.meta.url), { type: "module" });
    } catch (error) {
      this.error = `Worker を作れません: ${String(error)}`;
      void this.startMain();
      return;
    }
    this.worker = worker;
    this.backend = "worker";
    let timer: ReturnType<typeof setTimeout> | undefined;
    const fallback = (reason: string) => {
      clearTimeout(timer);
      if (this.worker !== worker || this.disposed) return;
      this.error = reason;
      worker.terminate();
      this.worker = null;
      this.inFlightSince = null;
      void this.startMain();
    };
    timer = setTimeout(() => fallback("Worker の準備が時間内に終わりません"), INIT_TIMEOUT_MS);
    worker.addEventListener("error", (e) => fallback(`Worker のエラー: ${e.message}`));
    worker.addEventListener("message", (e: MessageEvent<FromHandWorker>) => {
      const msg = e.data;
      if (msg.type === "ready") {
        clearTimeout(timer);
        this.delegate = msg.delegate;
        this.setStatus("running");
      } else if (msg.type === "error") {
        fallback(`Worker で認識を準備できません: ${msg.message}`);
      } else if (msg.id === this.frameId) {
        this.inFlightSince = null;
        if (msg.packed !== null) {
          this.options.onResult({
            t: msg.t,
            doneAt: performance.now(),
            inferMs: msg.inferMs,
            width: msg.width,
            height: msg.height,
            hands: unpackHands(msg.packed),
          });
        }
      }
    });
    this.post({ type: "init", urls: this.options.urls });
  }

  private async startMain(): Promise<void> {
    this.backend = "main";
    this.setStatus("loading");
    try {
      const { createHandDetector } = await import("./landmarkerCore");
      const detector = await createHandDetector(this.options.urls, () =>
        document.createElement("canvas"),
      );
      if (this.disposed) {
        detector.close();
        return;
      }
      this.detector = detector;
      this.delegate = detector.delegate;
      this.setStatus("running");
    } catch (error) {
      this.error = `認識を準備できません: ${error instanceof Error ? error.message : String(error)}`;
      this.setStatus("failed");
    }
  }

  private scheduleFrame(): void {
    if (this.disposed) return;
    const video = this.video as VideoWithFrameCallback;
    // 新しい映像が来た時だけ呼ばれる requestVideoFrameCallback を優先し，無ければ描画のフレームごとに見る
    if (typeof video.requestVideoFrameCallback === "function") {
      this.usingVideoCallback = true;
      this.frameHandle = video.requestVideoFrameCallback(this.onFrame);
    } else {
      this.usingVideoCallback = false;
      this.frameHandle = requestAnimationFrame(this.onFrame);
    }
  }

  private cancelFrame(): void {
    if (this.frameHandle === null) return;
    const video = this.video as VideoWithFrameCallback;
    if (this.usingVideoCallback) video.cancelVideoFrameCallback?.(this.frameHandle);
    else cancelAnimationFrame(this.frameHandle);
    this.frameHandle = null;
  }

  private readonly onFrame = (): void => {
    if (this.disposed) return;
    this.scheduleFrame();
    // 映像の時刻は performance.now() の基準にそろえる（PlayerInput.time・記録と同じ時計）
    const t = performance.now();
    if (this.status !== "running") return;
    if (this.inFlightSince !== null) {
      if (t - this.inFlightSince < IN_FLIGHT_TIMEOUT_MS) return;
      this.inFlightSince = null;
    }
    // 認識の間隔は映像の間隔（約 33 ms）単位でしか合わせられないため，少し手前から送ってよいことにする
    if (t - this.lastSentT < this.intervalMs - 8) return;
    const video = this.video;
    if (video.readyState < 2 || video.videoWidth === 0 || video.videoHeight === 0) return;
    this.lastSentT = t;
    this.inFlightSince = t;
    const id = ++this.frameId;
    if (this.worker !== null) this.sendToWorker(id, t);
    else this.detectOnMain(id, t);
  };

  private sendToWorker(id: number, t: number): void {
    const video = this.video;
    const width = Math.max(16, Math.round(Math.min(this.options.width ?? 640, video.videoWidth)));
    const height = Math.max(16, Math.round((width * video.videoHeight) / video.videoWidth));
    createImageBitmap(video, {
      resizeWidth: width,
      resizeHeight: height,
      resizeQuality: "medium",
    }).then(
      (bitmap) => {
        if (this.disposed || this.worker === null || id !== this.frameId) {
          bitmap.close();
          return;
        }
        this.post({ type: "frame", id, t, bitmap }, [bitmap]);
      },
      () => {
        if (id === this.frameId) this.inFlightSince = null;
      },
    );
  }

  private detectOnMain(id: number, t: number): void {
    // 描画のフレームの処理と重ならないよう，いったん手放してから認識する（認識の間は描画が止まる）
    setTimeout(() => {
      const detector = this.detector;
      if (this.disposed || detector === null || id !== this.frameId) return;
      const start = performance.now();
      try {
        const hands = detector.detect(this.video, t);
        const doneAt = performance.now();
        this.options.onResult({
          t,
          doneAt,
          inferMs: doneAt - start,
          width: this.video.videoWidth,
          height: this.video.videoHeight,
          hands,
        });
      } catch (error) {
        this.error = `認識に失敗しました: ${String(error)}`;
      } finally {
        this.inFlightSince = null;
      }
    }, 0);
  }
}
