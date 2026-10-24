// センサーを購読する薄い殻．イベントを純粋な関数でサンプルに変えて渡すだけにする（experiment_山﨑/02）
import { toMotionSample, toOrientationSample, toScreenSample } from "./normalize";
import type { MotionSample, OrientationSample, ScreenSample } from "./types";

/** 許可の結果．unsupported はセンサーの API そのものが無い（PC のブラウザ等） */
export type SensorPermission = "granted" | "denied" | "not-required" | "unsupported";

type PermissionRequester = { requestPermission?: () => Promise<PermissionState> };

async function requestOne(ctor: PermissionRequester | undefined): Promise<SensorPermission> {
  if (ctor === undefined) return "unsupported";
  if (typeof ctor.requestPermission !== "function") return "not-required";
  try {
    return (await ctor.requestPermission()) === "granted" ? "granted" : "denied";
  } catch {
    // iOS はタップの中で呼ばないと例外になる
    return "denied";
  }
}

/**
 * センサーの許可を取る（iOS の DeviceMotionEvent.requestPermission 等）．
 * iOS ではタップの処理の中から同期的に呼ぶ必要があるため，ボタンの click の中で最初に呼ぶ
 */
export async function requestSensorPermission(): Promise<{
  motion: SensorPermission;
  orientation: SensorPermission;
}> {
  const motionCtor =
    typeof DeviceMotionEvent === "undefined"
      ? undefined
      : (DeviceMotionEvent as unknown as PermissionRequester);
  const orientationCtor =
    typeof DeviceOrientationEvent === "undefined"
      ? undefined
      : (DeviceOrientationEvent as unknown as PermissionRequester);
  // 2 つとも同じタップの中で呼ぶため，await を挟まずに同時に呼ぶ
  const [motion, orientation] = await Promise.all([
    requestOne(motionCtor),
    requestOne(orientationCtor),
  ]);
  return { motion, orientation };
}

/**
 * タップなしで許可の状態を確かめる（ページの読み込み時用．許可のダイアログは出さない）．
 * iOS で既に許可済みなら requestPermission はタップなしでも "granted" を返す．
 * まだ許可していなければタップが要るとして例外になるため，"needs-gesture" を返す（例外は外に出さない）
 */
export async function probeSensorPermission(): Promise<{
  motion: SensorPermission | "needs-gesture";
  orientation: SensorPermission | "needs-gesture";
}> {
  const probe = async (
    ctor: PermissionRequester | undefined,
  ): Promise<SensorPermission | "needs-gesture"> => {
    if (ctor === undefined) return "unsupported";
    if (typeof ctor.requestPermission !== "function") return "not-required";
    try {
      return (await ctor.requestPermission()) === "granted" ? "granted" : "denied";
    } catch {
      return "needs-gesture";
    }
  };
  const [motion, orientation] = await Promise.all([
    probe(
      typeof DeviceMotionEvent === "undefined"
        ? undefined
        : (DeviceMotionEvent as unknown as PermissionRequester),
    ),
    probe(
      typeof DeviceOrientationEvent === "undefined"
        ? undefined
        : (DeviceOrientationEvent as unknown as PermissionRequester),
    ),
  ]);
  return { motion, orientation };
}

export interface SensorHandlers {
  readonly onMotion?: (sample: MotionSample) => void;
  readonly onOrientation?: (sample: OrientationSample) => void;
  readonly onScreen?: (sample: ScreenSample) => void;
}

/** 今の画面の向きを読む */
export function readScreenSample(t: number = performance.now()): ScreenSample {
  const so = typeof screen !== "undefined" ? screen.orientation : undefined;
  // screen.orientation が無い古い Safari は window.orientation（非推奨）で代える
  const legacy = (window as unknown as { orientation?: number }).orientation;
  return toScreenSample(t, so?.angle ?? legacy, so?.type);
}

/**
 * devicemotion・deviceorientation・画面の向きの変化を購読する．
 * 開始時に今の画面の向きを 1 回渡す．戻り値の関数で購読をやめる
 */
export function startSensors(handlers: SensorHandlers): () => void {
  const onMotion = (e: DeviceMotionEvent) => {
    const sample = toMotionSample(e);
    if (sample !== null) handlers.onMotion?.(sample);
  };
  const onOrientation = (e: DeviceOrientationEvent) => {
    const sample = toOrientationSample(e);
    if (sample !== null) handlers.onOrientation?.(sample);
  };
  const onScreen = (e: Event) => {
    handlers.onScreen?.(readScreenSample(e.timeStamp));
  };

  window.addEventListener("devicemotion", onMotion);
  window.addEventListener("deviceorientation", onOrientation);
  const so = typeof screen !== "undefined" ? screen.orientation : undefined;
  if (so !== undefined) so.addEventListener("change", onScreen);
  else window.addEventListener("orientationchange", onScreen);

  handlers.onScreen?.(readScreenSample());

  return () => {
    window.removeEventListener("devicemotion", onMotion);
    window.removeEventListener("deviceorientation", onOrientation);
    if (so !== undefined) so.removeEventListener("change", onScreen);
    else window.removeEventListener("orientationchange", onScreen);
  };
}
