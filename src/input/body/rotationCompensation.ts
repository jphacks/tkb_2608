// 頭の回転による加速度の見積もり（experiment_山﨑/04 ④「頭の回転による揺れを差し引く処理」）．
// スマホは首の回転の中心より前にあるため，首を振るだけで加速度センサーに接線・向心の加速度が出る
// （首振りで 2〜6 m/s^2 の上下の揺れ）．角速度 ω・角加速度 α と，回転の中心からスマホまでの位置 r から
// a_rot = α × r + ω × (ω × r) を求め，上下の加速度を出す前に差し引く．1 サンプルあたり O(1)．純粋な関数（状態を書き換える）
import type { RotationRate } from "../sensors/types";

/** 端末の座標（W3C の DeviceMotionEvent と同じ: x は画面の右，y は画面の上，z は画面から手前）の 3 成分 */
export interface DeviceVec {
  x: number;
  y: number;
  z: number;
}

export interface RotationCompState {
  /** 前のサンプルの角速度（rad/s．端末の x・y・z 軸まわり） */
  wx: number;
  wy: number;
  wz: number;
  /** 前のサンプルの角速度があるか（角加速度を差分で求めるため） */
  ready: boolean;
}

export function createRotationCompState(): RotationCompState {
  return { wx: 0, wy: 0, wz: 0, ready: false };
}

export function resetRotationComp(s: RotationCompState): void {
  s.wx = 0;
  s.wy = 0;
  s.wz = 0;
  s.ready = false;
}

const DEG = Math.PI / 180;

/**
 * 角加速度を差分で求める最小の間隔（秒）．時刻がほぼ同じサンプルが続くと差分が跳ねるため，
 * それより短い間隔では角加速度を 0 として扱う（向心の項だけを使う）
 */
const MIN_DIFF_DT_SEC = 0.004;

/**
 * 1 サンプル分進め，回転による加速度（m/s^2．端末の座標）を out に書く．
 * rot は DeviceMotionEvent.rotationRate と同じ並び（alpha: z 軸，beta: x 軸，gamma: y 軸まわり．deg/s），
 * lever は回転の中心からスマホ（加速度センサー）までの位置（m．端末の座標），dtSec は前のサンプルからの時間（秒）．
 * 角速度が無い・壊れている時は out を 0 にして false を返す（差し引かない）
 */
export function updateRotationComp(
  s: RotationCompState,
  rot: RotationRate | null,
  dtSec: number,
  lever: Readonly<DeviceVec>,
  out: DeviceVec,
): boolean {
  out.x = 0;
  out.y = 0;
  out.z = 0;
  if (
    rot === null ||
    !Number.isFinite(rot.alpha) ||
    !Number.isFinite(rot.beta) ||
    !Number.isFinite(rot.gamma) ||
    !Number.isFinite(lever.x) ||
    !Number.isFinite(lever.y) ||
    !Number.isFinite(lever.z)
  ) {
    resetRotationComp(s);
    return false;
  }
  const wx = rot.beta * DEG;
  const wy = rot.gamma * DEG;
  const wz = rot.alpha * DEG;
  let ax = 0;
  let ay = 0;
  let az = 0;
  if (s.ready && dtSec >= MIN_DIFF_DT_SEC) {
    ax = (wx - s.wx) / dtSec;
    ay = (wy - s.wy) / dtSec;
    az = (wz - s.wz) / dtSec;
  }
  s.wx = wx;
  s.wy = wy;
  s.wz = wz;
  s.ready = true;

  const rx = lever.x;
  const ry = lever.y;
  const rz = lever.z;
  // 接線の項 α × r
  const tx = ay * rz - az * ry;
  const ty = az * rx - ax * rz;
  const tz = ax * ry - ay * rx;
  // 向心の項 ω × (ω × r)
  const cx = wy * rz - wz * ry;
  const cy = wz * rx - wx * rz;
  const cz = wx * ry - wy * rx;
  const nx = wy * cz - wz * cy;
  const ny = wz * cx - wx * cz;
  const nz = wx * cy - wy * cx;
  out.x = tx + nx;
  out.y = ty + ny;
  out.z = tz + nz;
  return true;
}
