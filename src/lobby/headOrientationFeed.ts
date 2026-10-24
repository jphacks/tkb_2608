// 頭の向き用に，deviceorientation の最新の 1 件だけを持つ購読（薄い殻）．
// 仮実装．input/（担当D）の PlayerInput.head ができたら置き換える

import type { OrientationSample } from "./calibration";
import { screenAngle } from "./sensorFeed";

export interface HeadOrientationFeed {
  /** 最後に届いた端末の向き．まだ届いていない（PC・許可されていない等）なら null */
  readonly latest: OrientationSample | null;
  dispose(): void;
}

export function createHeadOrientationFeed(): HeadOrientationFeed {
  let latest: OrientationSample | null = null;
  const onOrientation = (event: DeviceOrientationEvent): void => {
    // PC の Chrome 等は値が null のイベントを送ることがあるため，その時はドラッグのままにする
    if (event.alpha === null || event.beta === null || event.gamma === null) return;
    latest = {
      t: performance.now() / 1000,
      alpha: event.alpha,
      beta: event.beta,
      gamma: event.gamma,
      screenAngle: screenAngle(),
    };
  };
  window.addEventListener("deviceorientation", onOrientation);
  return {
    get latest() {
      return latest;
    },
    dispose() {
      window.removeEventListener("deviceorientation", onOrientation);
    },
  };
}
