// キャリブレーション用のセンサーの購読（薄い殻）．イベントの値をためて，毎フレーム drain() で取り出す．
// input/（担当D）ができたら，そちらの購読に置き換えてよい

import type { MotionSample, OrientationSample } from "./calibration";

export interface SensorFeed {
  /** 前回から届いたサンプルを取り出す */
  drain(): { motion: MotionSample[]; orientation: OrientationSample[] };
  dispose(): void;
}

/** 1 フレームの間にたまる上限（タブが裏に回った時等にたまり続けないため） */
const MAX_BUFFERED = 600;

/** 画面の回転角（度）．screen.orientation が無い古い iOS は window.orientation を使う */
export function screenAngle(): number {
  const angle = window.screen?.orientation?.angle;
  if (typeof angle === "number") return angle;
  const legacy = (window as unknown as { orientation?: number }).orientation;
  return typeof legacy === "number" ? legacy : 0;
}

export function createSensorFeed(): SensorFeed {
  let motion: MotionSample[] = [];
  let orientation: OrientationSample[] = [];

  const onMotion = (event: DeviceMotionEvent): void => {
    const a = event.accelerationIncludingGravity;
    if (a === null || a.x === null || a.y === null || a.z === null) return;
    if (motion.length >= MAX_BUFFERED) motion.shift();
    motion.push({ t: performance.now() / 1000, x: a.x, y: a.y, z: a.z });
  };
  const onOrientation = (event: DeviceOrientationEvent): void => {
    if (event.alpha === null || event.beta === null || event.gamma === null) return;
    if (orientation.length >= MAX_BUFFERED) orientation.shift();
    orientation.push({
      t: performance.now() / 1000,
      alpha: event.alpha,
      beta: event.beta,
      gamma: event.gamma,
      screenAngle: screenAngle(),
    });
  };

  window.addEventListener("devicemotion", onMotion);
  window.addEventListener("deviceorientation", onOrientation);

  return {
    drain() {
      const result = { motion, orientation };
      motion = [];
      orientation = [];
      return result;
    },
    dispose() {
      window.removeEventListener("devicemotion", onMotion);
      window.removeEventListener("deviceorientation", onOrientation);
    },
  };
}
