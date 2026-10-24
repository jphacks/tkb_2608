// 頭の向き（experiment_山﨑/03）．deviceorientation をクォータニオンに変え，正面リセットと短い先読みをして返す．
// DOM・three.js に依存しない純粋な関数．状態は書き換える版（update*）を基本にし，テスト用に新しく返す版（step*）も置く
import type { Quat } from "../../core/types";
import type { InputParams } from "../params";
import type { MotionSample, OrientationSample } from "../sensors/types";
import {
  axisAngleQuatInto,
  DEG,
  eulerYXZQuatInto,
  identityQuat,
  type MutableQuat,
  multiplyQuatInto,
  normalizeQuatInto,
  yawOfQuat,
} from "./quat";

/** 端末の座標系から three.js の座標系へ合わせる回転（x 軸まわりに -90°） */
const Q_DEVICE_TO_THREE: Quat = { x: -Math.SQRT1_2, y: 0, z: 0, w: Math.SQRT1_2 };

/**
 * deviceorientation の角度（deg）から，画面の向きの補正をする前の向きを求めて out に書く．
 * three.js の旧 DeviceOrientationControls と同じ式: Euler(beta, alpha, -gamma, "YXZ") × (x 軸 -90°)
 */
export function deviceQuatInto(
  out: MutableQuat,
  alphaDeg: number,
  betaDeg: number,
  gammaDeg: number,
): MutableQuat {
  eulerYXZQuatInto(out, betaDeg * DEG, alphaDeg * DEG, -gammaDeg * DEG);
  return multiplyQuatInto(out, out, Q_DEVICE_TO_THREE);
}

const scratchScreen = identityQuat();

/** 画面の向き（deg．screen.orientation.angle）の分だけ z 軸まわりに戻す: out = q × (z 軸 -angle) */
export function applyScreenAngleInto(
  out: MutableQuat,
  q: Quat,
  screenAngleDeg: number,
): MutableQuat {
  axisAngleQuatInto(scratchScreen, 0, 0, 1, -screenAngleDeg * DEG);
  return multiplyQuatInto(out, q, scratchScreen);
}

/**
 * deviceorientation の角度（deg）と画面の向き（deg）から頭の向きを求める（新しく返す版）．
 * 旧 DeviceOrientationControls の setObjectQuaternion と同じ結果になる
 */
export function deviceOrientationToQuat(
  alphaDeg: number,
  betaDeg: number,
  gammaDeg: number,
  screenAngleDeg: number,
): Quat {
  const q = deviceQuatInto(identityQuat(), alphaDeg, betaDeg, gammaDeg);
  return applyScreenAngleInto(q, q, screenAngleDeg);
}

const scratchDelta = identityQuat();

/**
 * 角速度で先読みする: out = q × 回転(ω × leadMs)．q は画面の向きの補正の前の向き（端末の座標系の角速度をそのまま右から掛ける）．
 * 角速度（deg/s）は DeviceMotionEvent.rotationRate と同じ並び（alpha: z 軸，beta: x 軸，gamma: y 軸まわり）．
 * 角速度が minDps より小さい・leadMs が 0 以下・値が有限でなければ先読みしない（q をそのまま写す）
 */
export function predictQuatInto(
  out: MutableQuat,
  q: Quat,
  rateAlpha: number,
  rateBeta: number,
  rateGamma: number,
  leadMs: number,
  minDps: number,
): MutableQuat {
  // 端末の x・y・z 軸まわりの角速度
  const wx = rateBeta;
  const wy = rateGamma;
  const wz = rateAlpha;
  const speed = Math.hypot(wx, wy, wz);
  if (!(leadMs > 0) || !Number.isFinite(speed) || speed < minDps || speed <= 0) {
    out.x = q.x;
    out.y = q.y;
    out.z = q.z;
    out.w = q.w;
    return out;
  }
  const angle = speed * DEG * (leadMs / 1000);
  axisAngleQuatInto(scratchDelta, wx / speed, wy / speed, wz / speed, angle);
  return multiplyQuatInto(out, q, scratchDelta);
}

/** 頭の向きの状態 */
export interface HeadState {
  /** 向きのサンプルを 1 つでも受け取ったか */
  hasOrientation: boolean;
  /** 画面の向きの補正の前の向き（端末の座標系 → three.js の座標系） */
  device: MutableQuat;
  /** 最後の向きのサンプルの時刻（ms） */
  orientationT: number;
  /** 画面の向き（deg．0・90・180・270） */
  screenAngle: number;
  /** 最後の角速度（deg/s．rotationRate の並び） */
  rateAlpha: number;
  rateBeta: number;
  rateGamma: number;
  /** 最後の角速度の時刻（ms）．無ければ -Infinity */
  rateT: number;
  /**
   * 正面とみなすヨー（rad）．CalibrationProfile が無い時の仮の正面リセット．
   * null なら次の向きのサンプルのヨーを正面にする（最初のサンプル・画面の向きが変わった時・recenter の後）
   */
  yawZero: number | null;
  /** true なら CalibrationProfile.yawOffset より yawZero を優先する（recenter した後） */
  yawZeroOverrides: boolean;
}

export function createHeadState(): HeadState {
  return {
    hasOrientation: false,
    device: identityQuat(),
    orientationT: Number.NEGATIVE_INFINITY,
    screenAngle: 0,
    rateAlpha: 0,
    rateBeta: 0,
    rateGamma: 0,
    rateT: Number.NEGATIVE_INFINITY,
    yawZero: null,
    yawZeroOverrides: false,
  };
}

export function cloneHeadState(s: HeadState): HeadState {
  return { ...s, device: { ...s.device } };
}

const scratchHead = identityQuat();

/** 画面の向きの補正までした（正面リセット・先読みの前の）頭の向き */
function currentRawQuatInto(out: MutableQuat, s: HeadState): MutableQuat {
  return applyScreenAngleInto(out, s.device, s.screenAngle);
}

/** deviceorientation の 1 サンプルを反映する．角度が 1 つでも欠けていれば捨てる（例外は投げない） */
export function updateHeadOrientation(s: HeadState, sample: OrientationSample): void {
  const { alpha, beta, gamma } = sample;
  if (alpha === null || beta === null || gamma === null) return;
  if (!Number.isFinite(alpha) || !Number.isFinite(beta) || !Number.isFinite(gamma)) return;
  deviceQuatInto(s.device, alpha, beta, gamma);
  s.hasOrientation = true;
  s.orientationT = sample.t;
  if (s.yawZero === null) s.yawZero = yawOfQuat(currentRawQuatInto(scratchHead, s));
}

/** devicemotion の角速度だけを反映する（先読み用）．角速度が無いサンプルは無視する */
export function updateHeadRotation(s: HeadState, sample: MotionSample): void {
  const r = sample.rot;
  if (r === null) return;
  s.rateAlpha = r.alpha;
  s.rateBeta = r.beta;
  s.rateGamma = r.gamma;
  s.rateT = sample.t;
}

/**
 * 画面の向きを反映する．向きが変わったら仮の正面（yawZero）を取り直す
 * （ゴーグルへの入れ方を左右反対にした時．experiment_山﨑/03）
 */
export function updateHeadScreenAngle(s: HeadState, angleDeg: number): void {
  if (!Number.isFinite(angleDeg) || angleDeg === s.screenAngle) return;
  s.screenAngle = angleDeg;
  s.yawZero = null;
  s.yawZeroOverrides = false;
}

/** 今の向きを正面にする（次の向きのサンプルで取り直す．CalibrationProfile より優先する） */
export function recenterHead(s: HeadState): void {
  if (s.hasOrientation) s.yawZero = yawOfQuat(currentRawQuatInto(scratchHead, s));
  else s.yawZero = null;
  s.yawZeroOverrides = true;
}

/** 正面とみなすヨー（rad）．calibrationYaw は CalibrationProfile.yawOffset（無ければ null） */
export function frontYaw(s: HeadState, calibrationYaw: number | null): number {
  if (calibrationYaw !== null && Number.isFinite(calibrationYaw) && !s.yawZeroOverrides) {
    return calibrationYaw;
  }
  return s.yawZero ?? 0;
}

/**
 * 頭の向き（正面リセット・先読み済み）を out に書く．
 * 向きのサンプルがまだ無ければ単位元（正面）．角速度のサンプルが古い時は先読みしない
 */
export function readHeadInto(
  out: MutableQuat,
  s: HeadState,
  now: number,
  params: InputParams,
  calibrationYaw: number | null,
): MutableQuat {
  if (!s.hasOrientation) {
    out.x = 0;
    out.y = 0;
    out.z = 0;
    out.w = 1;
    return out;
  }
  const fresh = now - s.rateT <= params.headPredictionMaxAgeMs;
  predictQuatInto(
    out,
    s.device,
    s.rateAlpha,
    s.rateBeta,
    s.rateGamma,
    fresh ? params.headPredictionMs : 0,
    params.headPredictionMinDps,
  );
  applyScreenAngleInto(out, out, s.screenAngle);
  // 正面リセット: 世界の y 軸まわりに -正面のヨーだけ回す（左から掛ける）
  axisAngleQuatInto(scratchHead, 0, 1, 0, -frontYaw(s, calibrationYaw));
  multiplyQuatInto(out, scratchHead, out);
  return normalizeQuatInto(out, out);
}

/** 新しく返す版 */
export function readHead(
  s: HeadState,
  now: number,
  params: InputParams,
  calibrationYaw: number | null,
): Quat {
  return readHeadInto(identityQuat(), s, now, params, calibrationYaw);
}

/** テスト用: 向きのサンプルを反映した新しい状態を返す */
export function stepHeadOrientation(s: HeadState, sample: OrientationSample): HeadState {
  const next = cloneHeadState(s);
  updateHeadOrientation(next, sample);
  return next;
}

/** テスト用: 角速度を反映した新しい状態を返す */
export function stepHeadRotation(s: HeadState, sample: MotionSample): HeadState {
  const next = cloneHeadState(s);
  updateHeadRotation(next, sample);
  return next;
}
