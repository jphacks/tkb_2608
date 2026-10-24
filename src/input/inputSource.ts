// 入力の入口（SPEC_01「input/」）．本物のセンサー（device）とキーボード・マウスのモック（mock），
// 記録の再生（replay．開発時だけ）を同じ形で返す．
// app/（今は src/main.ts）は read(now) を描画の直前に呼び，PlayerInput を受け取るだけにする．
// ハンドトラッキングはまだ無いため，hands は常に UNTRACKED_HAND
import { type CalibrationProfile, IDLE_PLAYER_INPUT, type PlayerInput } from "../core/types";
import { DeviceTracker } from "./deviceTracker";
import { MockInput } from "./mock/mockInput";
import {
  DEFAULT_INPUT_PARAMS,
  type InputParams,
  mergeParams,
  paramsFromCalibration,
} from "./params";
import {
  requestSensorPermission,
  type SensorPermission,
  startSensors,
} from "./sensors/sensorSource";
import type { MotionSample, OrientationSample, ScreenSample } from "./sensors/types";

export type InputKind = "device" | "mock" | "replay";

/**
 * replay: 再生する記録の指定．省いた項目は URL パラメータ（?log=・?from=・?loop=．replay/replayLog.ts の parseReplaySearch）から読む
 */
export interface ReplayOptions {
  /** 記録の中身（JSONL）．あれば log より優先する */
  readonly text?: string;
  /** logs/input/ の記録のファイル名．null なら開発サーバーの最も新しい記録 */
  readonly log?: string | null;
  /** 記録の最初の motion から何秒の所から流すか */
  readonly fromSec?: number;
  /** 最後まで流したら最初に戻るか（既定は戻る） */
  readonly loop?: boolean;
}

/** センサーの許可の結果（mock は常に not-required） */
export interface InputActivation {
  readonly motion: SensorPermission;
  readonly orientation: SensorPermission;
}

/** dev ページが判定の途中の値を記録するための口（サンプルを tracker に渡した後に呼ばれる） */
export interface InputObserver {
  readonly onMotion?: (sample: MotionSample, tracker: DeviceTracker) => void;
  readonly onOrientation?: (sample: OrientationSample, tracker: DeviceTracker) => void;
  readonly onScreen?: (sample: ScreenSample, tracker: DeviceTracker) => void;
}

export interface InputSourceOptions {
  readonly kind: InputKind;
  /**
   * lobby/ のキャリブレーションの結果．null（既定）なら既定のしきい値を使い，
   * 正面は最初に受け取った向きのヨーにする（仮の正面リセット）
   */
  readonly calibration?: CalibrationProfile | null;
  /** しきい値の上書き */
  readonly params?: Partial<InputParams> | null;
  /** mock: ドラッグで頭の向きを変える要素（既定は document.body） */
  readonly target?: HTMLElement;
  /** device: 判定の途中の値を見る（dev ページ用） */
  readonly observer?: InputObserver;
  /** replay: 再生する記録 */
  readonly replay?: ReplayOptions;
}

export interface InputSource {
  readonly kind: InputKind;
  /** 今の入力（描画の直前に呼ぶ．例外は投げない）．now は performance.now() の ms */
  read(now: number): PlayerInput;
  /**
   * センサーの許可を取る．iOS ではタップ（click）の処理の中で呼ぶ．
   * センサーの購読は作った時から始めているため，許可されればすぐに値が届く
   */
  activate(): Promise<InputActivation>;
  /** 今の向きを正面にする */
  recenter(): void;
  /** device・replay の判定の中身（dev ページ用）．mock・replay の読み込み前では null */
  readonly tracker: DeviceTracker | null;
  dispose(): void;
}

function createDeviceSource(options: InputSourceOptions): InputSource {
  const tracker = new DeviceTracker({ calibration: options.calibration, params: options.params });
  const observer = options.observer;
  const stopSensors = startSensors({
    onMotion: (s) => {
      tracker.onMotion(s);
      observer?.onMotion?.(s, tracker);
    },
    onOrientation: (s) => {
      tracker.onOrientation(s);
      observer?.onOrientation?.(s, tracker);
    },
    onScreen: (s) => {
      tracker.onScreen(s);
      observer?.onScreen?.(s, tracker);
    },
  });
  // 裏に回った・戻った時は dt が数秒〜数分に飛ぶため，体の判定を初期化する（experiment_山﨑/09）
  const onVisibility = () => tracker.reset();
  document.addEventListener("visibilitychange", onVisibility);
  return {
    kind: "device",
    tracker,
    read: (now) => tracker.read(now),
    activate: async () => {
      try {
        return await requestSensorPermission();
      } catch {
        return { motion: "denied", orientation: "denied" };
      }
    },
    recenter: () => tracker.recenter(),
    dispose: () => {
      stopSensors();
      document.removeEventListener("visibilitychange", onVisibility);
    },
  };
}

function createMockSource(options: InputSourceOptions): InputSource {
  // モックは判定をしないが，速さのなめらかさだけ本物の入力と同じ params を使う
  const params = mergeParams(
    paramsFromCalibration(DEFAULT_INPUT_PARAMS, options.calibration),
    options.params,
  );
  const mock = new MockInput(options.target ?? document.body, () => params);
  return {
    kind: "mock",
    tracker: null,
    read: (now) => mock.read(now),
    activate: () => Promise.resolve({ motion: "not-required", orientation: "not-required" }),
    recenter: () => mock.recenter(),
    dispose: () => mock.dispose(),
  };
}

/**
 * 記録の再生（replay）．再生の本体（replay/replaySource.ts）は開発時だけ動的に読み込み，本番のビルドに含めない
 * （import.meta.env.DEV が false の分岐ごと消える）．本番で指定された時は止まって立ったままの入力にする
 */
function createReplaySourceLazy(options: InputSourceOptions): InputSource {
  let inner: InputSource | null = null;
  let disposed = false;
  if (import.meta.env.DEV) {
    void import("./replay/replaySource").then(
      (m) => {
        if (!disposed) inner = m.createReplaySource(options);
      },
      () => undefined,
    );
  }
  return {
    kind: "replay",
    get tracker() {
      return inner?.tracker ?? null;
    },
    read: (now) => inner?.read(now) ?? { ...IDLE_PLAYER_INPUT, time: now },
    activate: () => Promise.resolve({ motion: "not-required", orientation: "not-required" }),
    recenter: () => inner?.recenter(),
    dispose: () => {
      disposed = true;
      inner?.dispose();
    },
  };
}

/** 入力を作る */
export function createInputSource(options: InputSourceOptions): InputSource {
  if (options.kind === "device") return createDeviceSource(options);
  if (options.kind === "replay") return createReplaySourceLazy(options);
  return createMockSource(options);
}
