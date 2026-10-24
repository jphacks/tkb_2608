// センサーの 1 サンプルを表す型（three.js・ブラウザ API に依存しない素のデータ）．
// 時刻 t はイベントの timeStamp（performance.now() と同じ基準の ms）．
// 値が取れない・NaN の項目は null にする（Android の一部では acceleration が null になる．experiment_山﨑/09）
import type { Vec3 } from "../../core/types";

/** 角速度（deg/s）．DeviceMotionEvent.rotationRate と同じ軸の名前 */
export interface RotationRate {
  readonly alpha: number;
  readonly beta: number;
  readonly gamma: number;
}

/** devicemotion の 1 サンプル */
export interface MotionSample {
  readonly t: number;
  /** 重力を除いた加速度（m/s^2）．端末が出さない時は null */
  readonly acc: Vec3 | null;
  /** 重力を含む加速度（m/s^2） */
  readonly accG: Vec3 | null;
  readonly rot: RotationRate | null;
  /** 端末が申告するサンプルの間隔（ms）．実際の間隔は t の差で見る */
  readonly interval: number | null;
}

/** deviceorientation の 1 サンプル（deg） */
export interface OrientationSample {
  readonly t: number;
  readonly alpha: number | null;
  readonly beta: number | null;
  readonly gamma: number | null;
  readonly absolute: boolean;
}

/** 画面の向き（screen.orientation）の変化 */
export interface ScreenSample {
  readonly t: number;
  /** 0・90・180・270（deg） */
  readonly angle: number;
  /** "landscape-primary" 等．取れない時は null */
  readonly orientationType: string | null;
}
