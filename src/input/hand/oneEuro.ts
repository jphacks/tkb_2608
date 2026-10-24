// One Euro フィルタと，フィルタ後の速さを使った短い外挿（experiment_山﨑/07「なめらかさ」）．純粋な関数．
// 遅い動きでは強く平滑化して止めた手の震えを消し，速い動きでは平滑化を弱めて遅れを増やさない
import type { Vec3 } from "../../core/types";

export interface OneEuroParams {
  /** 止めた時の遮断周波数（Hz） */
  readonly minCutoffHz: number;
  /** 速さ（単位/s）に応じて遮断周波数を上げる度合い */
  readonly beta: number;
  /** 速さの見積もりの遮断周波数（Hz） */
  readonly dCutoffHz: number;
}

/** 3 次元の One Euro フィルタの状態．速さは単位/s */
export interface OneEuroVec3 {
  readonly x: number;
  readonly y: number;
  readonly z: number;
  readonly vx: number;
  readonly vy: number;
  readonly vz: number;
  /** 最後に更新した時刻（ms） */
  readonly t: number;
}

/** 平滑化の係数．dtSec は前回からの時間（s） */
export function smoothingAlpha(cutoffHz: number, dtSec: number): number {
  if (!(cutoffHz > 0) || !(dtSec > 0)) return 1;
  const tau = 1 / (2 * Math.PI * cutoffHz);
  return 1 / (1 + tau / dtSec);
}

/** 最初の値で始める（速さは 0） */
export function createOneEuroVec3(p: Vec3, tMs: number): OneEuroVec3 {
  return { x: p.x, y: p.y, z: p.z, vx: 0, vy: 0, vz: 0, t: tMs };
}

/**
 * 新しい値 p（時刻 tMs）でフィルタを進める．時刻が進んでいない・値が有限でない時は state をそのまま返す．
 * 速さの大きさで遮断周波数を決め，3 軸に同じ強さをかける（軸ごとに強さが変わって形が歪まないようにする）
 */
export function stepOneEuroVec3(
  state: OneEuroVec3,
  p: Vec3,
  tMs: number,
  params: OneEuroParams,
): OneEuroVec3 {
  if (!Number.isFinite(p.x) || !Number.isFinite(p.y) || !Number.isFinite(p.z)) return state;
  const dt = (tMs - state.t) / 1000;
  if (!(dt > 0)) return state;
  const ad = smoothingAlpha(params.dCutoffHz, dt);
  const vx = state.vx + ad * ((p.x - state.x) / dt - state.vx);
  const vy = state.vy + ad * ((p.y - state.y) / dt - state.vy);
  const vz = state.vz + ad * ((p.z - state.z) / dt - state.vz);
  const speed = Math.hypot(vx, vy, vz);
  const a = smoothingAlpha(params.minCutoffHz + Math.max(0, params.beta) * speed, dt);
  return {
    x: state.x + a * (p.x - state.x),
    y: state.y + a * (p.y - state.y),
    z: state.z + a * (p.z - state.z),
    vx,
    vy,
    vz,
    t: tMs,
  };
}

export interface ExtrapolateParams {
  /** 外挿する時間の上限（ms） */
  readonly maxMs: number;
  /** 速さが弱まる時定数（ms）．0 以下なら弱めない */
  readonly decayMs: number;
  /** 速さの上限（単位/s） */
  readonly maxSpeed: number;
}

/**
 * フィルタ後の位置を，今の時刻 nowMs まで速さで先に進める．
 * 先に進める時間は maxMs まで（それ以上は止める）．速さは時定数 decayMs で指数的に弱める
 * （進む距離 = v·τ·(1 − e^(−Δ/τ))）
 */
export function extrapolateVec3(state: OneEuroVec3, nowMs: number, p: ExtrapolateParams): Vec3 {
  const ahead = Math.min(Math.max(0, nowMs - state.t), Math.max(0, p.maxMs));
  if (!(ahead > 0) || !Number.isFinite(ahead)) return { x: state.x, y: state.y, z: state.z };
  let { vx, vy, vz } = state;
  const speed = Math.hypot(vx, vy, vz);
  if (!Number.isFinite(speed)) return { x: state.x, y: state.y, z: state.z };
  if (speed > p.maxSpeed && speed > 0) {
    const k = p.maxSpeed / speed;
    vx *= k;
    vy *= k;
    vz *= k;
  }
  const sec =
    p.decayMs > 0 ? (p.decayMs / 1000) * (1 - Math.exp(-ahead / p.decayMs)) : ahead / 1000;
  return { x: state.x + vx * sec, y: state.y + vy * sec, z: state.z + vz * sec };
}
