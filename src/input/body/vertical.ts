// 重力の向きへの射影（experiment_山﨑/04 ①）．頭を傾けても上下の加速度だけを取り出す．
// 重力の向きは accelerationIncludingGravity の低域通過（約 0.3 Hz）で求める．純粋な関数（状態を書き換える）
import type { MotionSample } from "../sensors/types";

export interface VerticalState {
  /** 重力の向きの見積もり（accelerationIncludingGravity の低域通過．静止時は上向き） */
  gx: number;
  gy: number;
  gz: number;
  ready: boolean;
}

export function createVerticalState(): VerticalState {
  return { gx: 0, gy: 0, gz: 0, ready: false };
}

export function resetVertical(s: VerticalState): void {
  s.gx = 0;
  s.gy = 0;
  s.gz = 0;
  s.ready = false;
}

/** 重力の見積もりがこれ（m/s^2）より小さい時は向きが定まらないとして射影しない */
const MIN_GRAVITY = 1;

/**
 * 1 サンプル分，重力の見積もりを進め，上下の加速度（m/s^2．上向きが正，重力を除いた値）を返す．
 * acceleration（重力を除いた値）があればそれを射影し，無い端末では accelerationIncludingGravity − 重力で代える．
 * 求められない時は NaN．成分に NaN・Infinity を含む値は使わない（experiment_山﨑/09）．dtSec は前のサンプルからの時間（秒）．0 なら重力の見積もりを動かさない
 *
 * 加速度と重力の向きの両方が同じ符号の規約（W3C: 静止時の accelerationIncludingGravity は上向き）で届けば，
 * 端末が両方の符号を逆にしていても，内積の符号は変わらない
 */
/** 3 成分がすべて有限か（normalize.ts を通らない値・テストの値でも NaN を混ぜないため） */
function isFiniteVec(v: { x: number; y: number; z: number } | null): v is {
  x: number;
  y: number;
  z: number;
} {
  return v !== null && Number.isFinite(v.x) && Number.isFinite(v.y) && Number.isFinite(v.z);
}

export function updateVertical(
  s: VerticalState,
  sample: MotionSample,
  dtSec: number,
  cutoffHz: number,
): number {
  // 非有限の成分がある値は無いものとして扱う（そのサンプルを捨てる．重力の見積もりに混ぜない）
  const accG = isFiniteVec(sample.accG) ? sample.accG : null;
  const acc = isFiniteVec(sample.acc) ? sample.acc : null;
  if (accG !== null) {
    if (!s.ready) {
      s.gx = accG.x;
      s.gy = accG.y;
      s.gz = accG.z;
      s.ready = true;
    } else if (dtSec > 0) {
      const k = 1 - Math.exp(-2 * Math.PI * cutoffHz * dtSec);
      s.gx += (accG.x - s.gx) * k;
      s.gy += (accG.y - s.gy) * k;
      s.gz += (accG.z - s.gz) * k;
    }
  }
  if (!s.ready) return Number.NaN;
  const g = Math.hypot(s.gx, s.gy, s.gz);
  if (!(g > MIN_GRAVITY)) return Number.NaN;
  const ux = s.gx / g;
  const uy = s.gy / g;
  const uz = s.gz / g;
  if (acc !== null) return acc.x * ux + acc.y * uy + acc.z * uz;
  if (accG !== null) return accG.x * ux + accG.y * uy + accG.z * uz - g;
  return Number.NaN;
}

/** 角速度の大きさ（deg/s）．無ければ NaN */
export function gyroMagnitude(sample: MotionSample): number {
  const r = sample.rot;
  return r === null ? Number.NaN : Math.hypot(r.alpha, r.beta, r.gamma);
}
