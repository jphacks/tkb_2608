// クォータニオンの計算（three.js に依存しない純粋な数学）．
// 座標系は three.js と同じ（右手系，y が上，-z が正面）．掛け算の順も three.js の multiplyQuaternions(a, b) と同じ（a × b）．
// イベントごとに呼ぶ所でオブジェクトを作らないよう，結果を out に書き込む版を基本にする（experiment_山﨑/08）
import type { Quat } from "../../core/types";

/** 書き換えられるクォータニオン（内部の作業用） */
export interface MutableQuat {
  x: number;
  y: number;
  z: number;
  w: number;
}

export const DEG = Math.PI / 180;

export function identityQuat(): MutableQuat {
  return { x: 0, y: 0, z: 0, w: 1 };
}

export function copyQuat(out: MutableQuat, q: Quat): MutableQuat {
  out.x = q.x;
  out.y = q.y;
  out.z = q.z;
  out.w = q.w;
  return out;
}

/** out = a × b（a と b が out と同じでもよい） */
export function multiplyQuatInto(out: MutableQuat, a: Quat, b: Quat): MutableQuat {
  const { x: ax, y: ay, z: az, w: aw } = a;
  const { x: bx, y: by, z: bz, w: bw } = b;
  out.x = ax * bw + aw * bx + ay * bz - az * by;
  out.y = ay * bw + aw * by + az * bx - ax * bz;
  out.z = az * bw + aw * bz + ax * by - ay * bx;
  out.w = aw * bw - ax * bx - ay * by - az * bz;
  return out;
}

/** 新しく返す版 */
export function multiplyQuat(a: Quat, b: Quat): Quat {
  return multiplyQuatInto(identityQuat(), a, b);
}

/** 長さを 1 にする．長さが 0 か有限でなければ単位元にする */
export function normalizeQuatInto(out: MutableQuat, q: Quat): MutableQuat {
  const len = Math.hypot(q.x, q.y, q.z, q.w);
  if (!(len > 1e-12) || !Number.isFinite(len)) {
    out.x = 0;
    out.y = 0;
    out.z = 0;
    out.w = 1;
    return out;
  }
  out.x = q.x / len;
  out.y = q.y / len;
  out.z = q.z / len;
  out.w = q.w / len;
  return out;
}

/** 軸（単位ベクトル）まわりの角度 angle（rad）の回転 */
export function axisAngleQuatInto(
  out: MutableQuat,
  ax: number,
  ay: number,
  az: number,
  angle: number,
): MutableQuat {
  const s = Math.sin(angle / 2);
  out.x = ax * s;
  out.y = ay * s;
  out.z = az * s;
  out.w = Math.cos(angle / 2);
  return out;
}

/**
 * オイラー角（rad）から作る．順は "YXZ"（three.js の Quaternion.setFromEuler と同じ式）．
 * x・y・z はそれぞれ x 軸・y 軸・z 軸まわりの角度
 */
export function eulerYXZQuatInto(out: MutableQuat, x: number, y: number, z: number): MutableQuat {
  const c1 = Math.cos(x / 2);
  const c2 = Math.cos(y / 2);
  const c3 = Math.cos(z / 2);
  const s1 = Math.sin(x / 2);
  const s2 = Math.sin(y / 2);
  const s3 = Math.sin(z / 2);
  out.x = s1 * c2 * c3 + c1 * s2 * s3;
  out.y = c1 * s2 * c3 - s1 * c2 * s3;
  out.z = c1 * c2 * s3 - s1 * s2 * c3;
  out.w = c1 * c2 * c3 + s1 * s2 * s3;
  return out;
}

/**
 * ヨー（rad）．視線（-z）の水平の向きで，0 で -z，正で左（src/controls/lookAngles.ts と同じ向き）．
 * "YXZ" のオイラー角の y と同じ値（three.js の Euler.setFromQuaternion(q, "YXZ").y と同じ）
 */
export function yawOfQuat(q: Quat): number {
  const m23 = 2 * (q.y * q.z - q.w * q.x);
  if (Math.abs(m23) < 0.9999999) {
    const m13 = 2 * (q.x * q.z + q.w * q.y);
    const m33 = 1 - 2 * (q.x * q.x + q.y * q.y);
    return Math.atan2(m13, m33);
  }
  // 真上・真下（ジンバルロック）: three.js の Euler.setFromRotationMatrix と同じ扱い
  const m31 = 2 * (q.x * q.z - q.w * q.y);
  const m11 = 1 - 2 * (q.y * q.y + q.z * q.z);
  return Math.atan2(-m31, m11);
}

/** ピッチ（rad）．上を向くと正（"YXZ" のオイラー角の x） */
export function pitchOfQuat(q: Quat): number {
  const m23 = 2 * (q.y * q.z - q.w * q.x);
  return Math.asin(Math.max(-1, Math.min(1, -m23)));
}

/** ヨー・ピッチ（rad）から向きを作る（ヨー → ピッチの順に回す．ロールは 0） */
export function quatFromYawPitch(yaw: number, pitch: number): Quat {
  return eulerYXZQuatInto(identityQuat(), pitch, yaw, 0);
}

/** 2 つの向きの間の角度（rad．0〜π） */
export function angleBetweenQuats(a: Quat, b: Quat): number {
  const dot = Math.abs(a.x * b.x + a.y * b.y + a.z * b.z + a.w * b.w);
  return 2 * Math.acos(Math.min(1, dot));
}
