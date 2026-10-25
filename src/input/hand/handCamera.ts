// 手の入力の組み立て: カメラの映像 → 認識（handRecognizer.ts）→ 左右の振り分け → 片手ずつの追跡（handTracker.ts）．
// 描画のフレームごとに read(now) で PlayerInput.hands を読み，そのフレームの間隔から認識の頻度も調整する．
// 例外は外に投げない（認識が使えない時は両手とも未認識のまま．歩き・しゃがみには影響させない．experiment_山﨑/09）
import { type Handedness, type HandState, UNTRACKED_HAND } from "../../core/types";
import { type HandAssetUrls, resolveHandAssetUrls } from "./handAssets";
import { assignHands, type HandAnchors, rememberHandAnchors } from "./handedness";
import { DEFAULT_HAND_PARAMS, type HandParams, mergeHandParams } from "./handParams";
import { HandRecognizer, type RecognizerBackend, type RecognizerStatus } from "./handRecognizer";
import {
  createHandTrack,
  type HandTrack,
  observeHand,
  readHandTrack,
  resetHandTrack,
  toHandState,
} from "./handTracker";
import {
  INITIAL_RATE_CONTROL,
  type RateControlState,
  rateHz,
  stepRateControl,
} from "./rateControl";
import type { HandFrameResult, HandReading } from "./types";

export type Hands = Readonly<Record<Handedness, HandState>>;

const UNTRACKED_HANDS: Hands = { left: UNTRACKED_HAND, right: UNTRACKED_HAND };

export interface HandCameraOptions {
  /** しきい値の上書き */
  readonly params?: Partial<HandParams> | null;
  /** false でメインスレッドで認識する（既定: Worker が使えれば Worker） */
  readonly useWorker?: boolean;
  /** モデルと wasm の URL（既定: public/mediapipe/ の同梱物） */
  readonly urls?: HandAssetUrls;
  /** 認識の結果が届いた時（dev ページの表示・記録用） */
  readonly onResult?: (result: HandFrameResult) => void;
}

/** 認識の状態（dev ページの表示用） */
export interface HandCameraStats {
  readonly status: RecognizerStatus | "idle";
  readonly backend: RecognizerBackend | null;
  readonly delegate: string | null;
  readonly error: string | null;
  /** 今の認識の頻度の目標（回/秒） */
  readonly rateHz: number;
  /** 描画の fps（read の間隔から） */
  readonly fps: number;
  /** 認識そのものの時間と，映像から結果が届くまでの遅れ（ms．指数移動平均） */
  readonly inferMs: number;
  readonly latencyMs: number;
  /** 実際に結果が届いた頻度（回/秒．指数移動平均） */
  readonly resultHz: number;
}

/** 平均の重み */
const STATS_ALPHA = 0.1;

function ema(prev: number, v: number): number {
  return Number.isNaN(prev) ? v : prev + (v - prev) * STATS_ALPHA;
}

export class HandCamera {
  private params: HandParams;
  private readonly options: HandCameraOptions;
  private recognizer: HandRecognizer | null = null;
  private attachedStream: MediaStream | null = null;
  private readonly tracks: Record<Handedness, HandTrack> = {
    left: createHandTrack(),
    right: createHandTrack(),
  };
  /** 左右の振り分けに使う，各側の手が最後にいた画像の上の位置 */
  private anchors: HandAnchors = {};
  private rate: RateControlState = INITIAL_RATE_CONTROL;
  private appliedRateHz = Number.NaN;
  private inferMs = Number.NaN;
  private latencyMs = Number.NaN;
  private resultHz = Number.NaN;
  private lastResultT = Number.NaN;
  /** 最後に届いた認識の結果（dev ページで 21 点を重ねる） */
  lastResult: HandFrameResult | null = null;

  constructor(options: HandCameraOptions = {}) {
    this.options = options;
    this.params = mergeHandParams(DEFAULT_HAND_PARAMS, options.params);
  }

  get currentParams(): HandParams {
    return this.params;
  }

  /** しきい値の一部を変える（dev ページ用）．状態は保つ */
  setParams(overrides: Partial<HandParams>): void {
    this.params = mergeHandParams(this.params, overrides);
  }

  /** 認識している映像（dev ページで重ねて描く）．カメラが無ければ null */
  get video(): HTMLVideoElement | null {
    return this.recognizer?.video ?? null;
  }

  /**
   * カメラの映像を渡して認識を始める（null で止める）．映像そのもの（MediaStream）は止めない（渡した側のもの）．
   * 同じ映像を渡し直した時は何もしない
   */
  attach(stream: MediaStream | null): void {
    if (stream !== null && this.recognizer !== null && this.attachedStream === stream) return;
    this.recognizer?.dispose();
    this.recognizer = null;
    this.attachedStream = stream;
    resetHandTrack(this.tracks.left);
    resetHandTrack(this.tracks.right);
    this.anchors = {};
    if (stream === null) return;
    try {
      this.recognizer = new HandRecognizer({
        stream,
        urls: this.options.urls ?? resolveHandAssetUrls(import.meta.env.BASE_URL, location.href),
        useWorker: this.options.useWorker,
        width: this.params.recognizeWidthPx,
        onResult: (r) => this.onResult(r),
      });
      this.appliedRateHz = Number.NaN;
    } catch {
      this.recognizer = null;
    }
  }

  private onResult(r: HandFrameResult): void {
    try {
      this.lastResult = r;
      this.inferMs = ema(this.inferMs, r.inferMs);
      this.latencyMs = ema(this.latencyMs, r.doneAt - r.t);
      const dt = r.t - this.lastResultT;
      if (dt > 0 && dt < 1000) this.resultHz = ema(this.resultHz, 1000 / dt);
      this.lastResultT = r.t;
      const assigned = assignHands(r.hands, false, this.anchors, r.t);
      this.anchors = rememberHandAnchors(this.anchors, assigned, r.t);
      for (const side of ["left", "right"] as const) {
        observeHand(this.tracks[side], assigned[side] ?? null, r.t, r.width, r.height, this.params);
      }
      this.options.onResult?.(r);
    } catch {
      // 壊れた結果は捨てる（次の結果で戻る）
    }
  }

  /** 今の両手（描画の直前に 1 回呼ぶ．例外は投げない）．now は performance.now() の ms */
  read(now: number): Hands {
    if (this.recognizer === null) return UNTRACKED_HANDS;
    try {
      this.rate = stepRateControl(this.rate, now, this.params);
      const hz = rateHz(this.rate, this.params);
      if (hz !== this.appliedRateHz) {
        this.recognizer.setRateHz(hz);
        this.appliedRateHz = hz;
      }
      return {
        left: toHandState(readHandTrack(this.tracks.left, now, this.params)),
        right: toHandState(readHandTrack(this.tracks.right, now, this.params)),
      };
    } catch {
      return UNTRACKED_HANDS;
    }
  }

  /** つまむ・指を差す・人差し指の先も含めた両手の値（dev ページ用．状態は進めない） */
  readDetail(now: number): Readonly<Record<Handedness, HandReading>> {
    return {
      left: readHandTrack(this.tracks.left, now, this.params),
      right: readHandTrack(this.tracks.right, now, this.params),
    };
  }

  /** 片手の追跡の中身（dev ページで奥行き等を出す） */
  track(side: Handedness): Readonly<HandTrack> {
    return this.tracks[side];
  }

  get stats(): HandCameraStats {
    const r = this.recognizer;
    return {
      status: r?.status ?? "idle",
      backend: r?.backend ?? null,
      delegate: r?.delegate ?? null,
      error: r?.error ?? null,
      rateHz: rateHz(this.rate, this.params),
      fps: this.rate.fps,
      inferMs: this.inferMs,
      latencyMs: this.latencyMs,
      resultHz: this.resultHz,
    };
  }

  dispose(): void {
    this.attach(null);
  }
}
