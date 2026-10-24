// 頭の向き（ヨー角）の計算（DOM・three.js に依存しない純粋な関数）．
// 座標系は three.js に合わせる（右手系，y が上，-z が正面）．ヨー角は Y 軸回りで，0 で -Z を向き，正で左へ回る

import type { Quat, Vec3 } from "../core/types";

const DEG_TO_RAD = Math.PI / 180;

/** 角度を (-π, π] に収める */
export function wrapAngle(angle: number): number {
  const twoPi = Math.PI * 2;
  const wrapped = angle - twoPi * Math.floor((angle + Math.PI) / twoPi);
  return wrapped === -Math.PI ? Math.PI : wrapped;
}

/** a から b への差（b - a）を (-π, π] で返す */
export function angleDifference(a: number, b: number): number {
  return wrapAngle(b - a);
}

/** 角度の平均（円周上の平均）．空なら null */
export function circularMean(angles: readonly number[]): number | null {
  if (angles.length === 0) return null;
  let sin = 0;
  let cos = 0;
  for (const a of angles) {
    sin += Math.sin(a);
    cos += Math.cos(a);
  }
  if (sin === 0 && cos === 0) return null;
  return wrapAngle(Math.atan2(sin, cos));
}

export function multiplyQuat(a: Quat, b: Quat): Quat {
  return {
    x: a.x * b.w + a.w * b.x + a.y * b.z - a.z * b.y,
    y: a.y * b.w + a.w * b.y + a.z * b.x - a.x * b.z,
    z: a.z * b.w + a.w * b.z + a.x * b.y - a.y * b.x,
    w: a.w * b.w - a.x * b.x - a.y * b.y - a.z * b.z,
  };
}

/** ベクトルを回転させる */
export function rotateVec(q: Quat, v: Vec3): Vec3 {
  // t = 2 * (q.xyz × v)，v' = v + w * t + q.xyz × t
  const tx = 2 * (q.y * v.z - q.z * v.y);
  const ty = 2 * (q.z * v.x - q.x * v.z);
  const tz = 2 * (q.x * v.y - q.y * v.x);
  return {
    x: v.x + q.w * tx + (q.y * tz - q.z * ty),
    y: v.y + q.w * ty + (q.z * tx - q.x * tz),
    z: v.z + q.w * tz + (q.x * ty - q.y * tx),
  };
}

/**
 * deviceorientation の値（度）と画面の回転角（screen.orientation.angle，度）から，
 * 端末の画面の奥（カメラの視線）の向きを表すクォータニオンを作る．
 * three.js の旧 DeviceOrientationControls と同じ変換（Euler YXZ → X 軸回りに -90° → Z 軸回りに -画面の回転角）
 */
export function deviceOrientationToQuat(
  alphaDeg: number,
  betaDeg: number,
  gammaDeg: number,
  screenAngleDeg: number,
): Quat {
  // Euler（x = beta，y = alpha，z = -gamma，順序 YXZ）
  const x = betaDeg * DEG_TO_RAD;
  const y = alphaDeg * DEG_TO_RAD;
  const z = -gammaDeg * DEG_TO_RAD;
  const c1 = Math.cos(x / 2);
  const c2 = Math.cos(y / 2);
  const c3 = Math.cos(z / 2);
  const s1 = Math.sin(x / 2);
  const s2 = Math.sin(y / 2);
  const s3 = Math.sin(z / 2);
  const euler: Quat = {
    x: s1 * c2 * c3 + c1 * s2 * s3,
    y: c1 * s2 * c3 - s1 * c2 * s3,
    z: c1 * c2 * s3 - s1 * s2 * c3,
    w: c1 * c2 * c3 + s1 * s2 * s3,
  };
  // 端末の背面を視線にする（X 軸回りに -90°）
  const half = Math.SQRT1_2;
  const lookOutOfBack: Quat = { x: -half, y: 0, z: 0, w: half };
  // 画面の回転（横向き等）を打ち消す（Z 軸回りに -angle）
  const screenHalf = (-screenAngleDeg * DEG_TO_RAD) / 2;
  const screen: Quat = { x: 0, y: 0, z: Math.sin(screenHalf), w: Math.cos(screenHalf) };
  return multiplyQuat(multiplyQuat(euler, lookOutOfBack), screen);
}

/** クォータニオンの視線（-Z）を水平面に落とした向きのヨー角（rad）．真上・真下を向いている時は 0 */
export function yawOfQuat(q: Quat): number {
  const forward = rotateVec(q, { x: 0, y: 0, z: -1 });
  if (Math.abs(forward.x) < 1e-9 && Math.abs(forward.z) < 1e-9) return 0;
  return wrapAngle(Math.atan2(-forward.x, -forward.z));
}

/** deviceorientation の値（度）から頭のヨー角（rad）を求める */
export function headYawFromDeviceOrientation(
  alphaDeg: number,
  betaDeg: number,
  gammaDeg: number,
  screenAngleDeg: number,
): number {
  return yawOfQuat(deviceOrientationToQuat(alphaDeg, betaDeg, gammaDeg, screenAngleDeg));
}
