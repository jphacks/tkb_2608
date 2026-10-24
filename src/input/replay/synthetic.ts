// 合成のセンサーの記録（頭を 1 つの軸のまわりに振る動き）．回転の中心から離れたスマホに出る接線・向心の加速度と，
// 傾きによる重力の向きの変化を物理どおりに作る．首振り・頷きを歩きと取り違える場面の再現と，
// 回転の差し引き（body/rotationCompensation.ts）の確かめに使う．純粋な関数
import type { MotionSample } from "../sensors/types";

/** 重力加速度（m/s^2） */
const G = 9.81;
const DEG = Math.PI / 180;

export interface HeadRotationSpec {
  /** 始まりの時刻（ms） */
  readonly startMs: number;
  /** 長さ（ms）とサンプルの間隔（ms） */
  readonly durationMs: number;
  readonly dtMs: number;
  /** 回す軸（端末の座標．x: 画面の右，y: 画面の上，z: 画面から手前）．始まりの姿勢では y が上 */
  readonly axis: "x" | "y" | "z";
  /** 振れの大きさ（deg）と周波数（Hz）．角度は A sin(2π f t) */
  readonly amplitudeDeg: number;
  readonly freqHz: number;
  /** 回転の中心からスマホまでの位置（m．端末の座標） */
  readonly lever: { readonly x: number; readonly y: number; readonly z: number };
  /** 体の上下の加速度（m/s^2．上が正．足踏み等．省略時 0） */
  readonly verticalAccel?: (tSec: number) => number;
}

/**
 * 端末の軸 axis のまわりに頭を振る間の devicemotion のサンプルを作る．
 * acc は α × r + ω × (ω × r)（端末の座標で r は一定）に体の上下の加速度を足したもの，
 * accG はそれに上向きの重力（端末の座標）を足したもの，rot はその軸の角速度（deg/s）
 */
export function synthHeadRotation(spec: HeadRotationSpec): MotionSample[] {
  const out: MotionSample[] = [];
  const n = Math.max(0, Math.round(spec.durationMs / spec.dtMs));
  const w = 2 * Math.PI * spec.freqHz;
  const A = spec.amplitudeDeg * DEG;
  const { x: rx, y: ry, z: rz } = spec.lever;
  for (let i = 0; i < n; i++) {
    const tMs = spec.startMs + i * spec.dtMs;
    const sec = (tMs - spec.startMs) / 1000;
    const th = A * Math.sin(w * sec);
    const om = A * w * Math.cos(w * sec);
    const al = -A * w * w * Math.sin(w * sec);
    const c = Math.cos(th);
    const s = Math.sin(th);
    // 角速度・角加速度のベクトルと，世界の上向きの端末の座標での向き（回転 R の転置を掛けたもの）
    let wv: [number, number, number];
    let av: [number, number, number];
    let up: [number, number, number];
    if (spec.axis === "x") {
      wv = [om, 0, 0];
      av = [al, 0, 0];
      up = [0, c, -s];
    } else if (spec.axis === "y") {
      wv = [0, om, 0];
      av = [0, al, 0];
      up = [0, 1, 0];
    } else {
      wv = [0, 0, om];
      av = [0, 0, al];
      up = [s, c, 0];
    }
    const [wx, wy, wz] = wv;
    const [ax, ay, az] = av;
    // α × r + ω × (ω × r)
    const cx = wy * rz - wz * ry;
    const cy = wz * rx - wx * rz;
    const cz = wx * ry - wy * rx;
    const bodyAv = spec.verticalAccel?.(sec) ?? 0;
    const accX = ay * rz - az * ry + (wy * cz - wz * cy) + bodyAv * up[0];
    const accY = az * rx - ax * rz + (wz * cx - wx * cz) + bodyAv * up[1];
    const accZ = ax * ry - ay * rx + (wx * cy - wy * cx) + bodyAv * up[2];
    out.push({
      t: tMs,
      acc: { x: accX, y: accY, z: accZ },
      accG: { x: accX + G * up[0], y: accY + G * up[1], z: accZ + G * up[2] },
      // rotationRate の並び: alpha は z 軸，beta は x 軸，gamma は y 軸まわり
      rot: { alpha: wz / DEG, beta: wx / DEG, gamma: wy / DEG },
      interval: spec.dtMs,
    });
  }
  return out;
}
