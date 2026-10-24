// センサーのイベント（に似た値）をサンプルの型に変換する（DOM に依存しない純粋な関数）．
// 例外は投げない．使えない値（NaN・null・Infinity）は項目ごとに null にし，何も残らなければサンプルごと捨てる
import type { Vec3 } from "../../core/types";
import type { MotionSample, OrientationSample, RotationRate, ScreenSample } from "./types";

/** DeviceMotionEventAcceleration と同じ形（各値は null になりうる） */
export interface XyzLike {
  readonly x: number | null;
  readonly y: number | null;
  readonly z: number | null;
}

/** DeviceMotionEventRotationRate と同じ形 */
export interface AbgLike {
  readonly alpha: number | null;
  readonly beta: number | null;
  readonly gamma: number | null;
}

/** DeviceMotionEvent のうち使う項目 */
export interface MotionEventLike {
  readonly timeStamp: number;
  readonly acceleration: XyzLike | null;
  readonly accelerationIncludingGravity: XyzLike | null;
  readonly rotationRate: AbgLike | null;
  readonly interval: number | null;
}

/** DeviceOrientationEvent のうち使う項目 */
export interface OrientationEventLike {
  readonly timeStamp: number;
  readonly alpha: number | null;
  readonly beta: number | null;
  readonly gamma: number | null;
  readonly absolute: boolean;
}

function isFiniteNumber(v: unknown): v is number {
  return typeof v === "number" && Number.isFinite(v);
}

/** 有限の数ならそのまま，そうでなければ null */
export function finiteOrNull(v: unknown): number | null {
  return isFiniteNumber(v) ? v : null;
}

/** 3 成分がすべて有限の時だけ Vec3 にする */
export function toVec3(v: XyzLike | null | undefined): Vec3 | null {
  if (v == null) return null;
  const { x, y, z } = v;
  if (!isFiniteNumber(x) || !isFiniteNumber(y) || !isFiniteNumber(z)) return null;
  return { x, y, z };
}

/** 3 成分がすべて有限の時だけ RotationRate にする */
export function toRotationRate(v: AbgLike | null | undefined): RotationRate | null {
  if (v == null) return null;
  const { alpha, beta, gamma } = v;
  if (!isFiniteNumber(alpha) || !isFiniteNumber(beta) || !isFiniteNumber(gamma)) return null;
  return { alpha, beta, gamma };
}

/** devicemotion → MotionSample．時刻が不正，または値が 1 つも取れなければ null（捨てる） */
export function toMotionSample(e: MotionEventLike): MotionSample | null {
  if (!isFiniteNumber(e.timeStamp)) return null;
  const acc = toVec3(e.acceleration);
  const accG = toVec3(e.accelerationIncludingGravity);
  const rot = toRotationRate(e.rotationRate);
  if (acc === null && accG === null && rot === null) return null;
  const interval = isFiniteNumber(e.interval) && e.interval > 0 ? e.interval : null;
  return { t: e.timeStamp, acc, accG, rot, interval };
}

/** deviceorientation → OrientationSample．時刻が不正，または角度が 1 つも取れなければ null */
export function toOrientationSample(e: OrientationEventLike): OrientationSample | null {
  if (!isFiniteNumber(e.timeStamp)) return null;
  const alpha = finiteOrNull(e.alpha);
  const beta = finiteOrNull(e.beta);
  const gamma = finiteOrNull(e.gamma);
  if (alpha === null && beta === null && gamma === null) return null;
  return { t: e.timeStamp, alpha, beta, gamma, absolute: e.absolute === true };
}

/** 画面の向きの角度を 0・90・180・270 に丸める（-90 は 270 にする）．不正なら 0 */
export function normalizeScreenAngle(angle: unknown): number {
  if (!isFiniteNumber(angle)) return 0;
  const quarter = Math.round(angle / 90);
  return (((quarter % 4) + 4) % 4) * 90;
}

/** 画面の向き → ScreenSample */
export function toScreenSample(
  t: number,
  angle: unknown,
  orientationType: string | null | undefined,
): ScreenSample {
  return {
    t: isFiniteNumber(t) ? t : 0,
    angle: normalizeScreenAngle(angle),
    orientationType: typeof orientationType === "string" ? orientationType : null,
  };
}
