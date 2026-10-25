// 見守り画面で受け取った状態をため，約 100 ms 遅らせた時刻の姿勢を前後の 2 つの状態から補間する（SPEC_01「見守り」の「見守り画面」の描き方）．
// 時刻は呼ぶ側が渡す（見守り画面の performance.now() の ms）．ブラウザ API に依存しない
import type { Posture } from "../core/types";
import type { MonitorState } from "../share/monitorState";

/** 描く時刻を受け取った時刻からどれだけ遅らせるか（ms）．間の状態を補間してなめらかに見せるため */
export const MONITOR_RENDER_DELAY_MS = 100;

/** ためておく状態の数の上限．描画が止まっている間（タブが裏に回った等）に溜まり続けないため */
export const MONITOR_BUFFER_LIMIT = 64;

/** 受け取った状態と，受け取った時刻（ms．見守り画面の performance.now()） */
export interface ReceivedMonitorState {
  readonly state: MonitorState;
  readonly receivedAt: number;
}

/** 描く姿勢（補間の結果．単位は MonitorState と同じ．x・z は m，yaw・pitch は rad，t は s） */
export interface MonitorPose {
  t: number;
  floor: number;
  posture: Posture;
  x: number;
  z: number;
  /** 0 が -Z 向きで右回りに増える（MonitorState.yaw と同じ．3D の向きにするには符号を反転する） */
  yaw: number;
  pitch: number;
}

/** 空の姿勢を作る（補間の結果の書き込み先．毎フレーム作らずに使い回す） */
export function createMonitorPose(): MonitorPose {
  return { t: 0, floor: 0, posture: "standing", x: 0, z: 0, yaw: 0, pitch: 0 };
}

const TWO_PI = Math.PI * 2;

/** 角度 a（rad）から b（rad）へ，近い回り方（差が −π 以上 π 未満）で alpha（0〜1）だけ進めた角度（rad） */
export function lerpAngle(a: number, b: number, alpha: number): number {
  const diff = ((((b - a + Math.PI) % TWO_PI) + TWO_PI) % TWO_PI) - Math.PI;
  return a + diff * alpha;
}

function copyState(out: MonitorPose, state: MonitorState): MonitorPose {
  out.t = state.t;
  out.floor = state.floor;
  out.posture = state.posture;
  out.x = state.x;
  out.z = state.z;
  out.yaw = state.yaw;
  out.pitch = state.pitch;
  return out;
}

/**
 * 状態 a から b への間を alpha（0〜1．範囲の外は収める）で補間して out に書く．
 * 位置（x・z）と t は直線で，向き（yaw・pitch）は近い回り方で補間する．
 * 姿勢と階は b に移った時（alpha が 1）に切り替え，階が変わる時は位置も向きも補間せずに a のまま（alpha が 1 で b）にする
 */
export function interpolateMonitorState(
  a: MonitorState,
  b: MonitorState,
  alpha: number,
  out: MonitorPose,
): MonitorPose {
  const k = Number.isFinite(alpha) ? Math.min(1, Math.max(0, alpha)) : 0;
  if (k >= 1) return copyState(out, b);
  if (a.floor !== b.floor) return copyState(out, a);
  out.t = a.t + (b.t - a.t) * k;
  out.floor = a.floor;
  out.posture = a.posture;
  out.x = a.x + (b.x - a.x) * k;
  out.z = a.z + (b.z - a.z) * k;
  out.yaw = lerpAngle(a.yaw, b.yaw, k);
  out.pitch = a.pitch + (b.pitch - a.pitch) * k;
  return out;
}

/**
 * ためた状態（受け取った順）から，描く時刻 renderTime（ms）の姿勢を out に書く．
 * renderTime が最初の状態より前なら最初の状態，最後の状態より後なら最後の状態のまま（先を見込んで動かさない）．
 * 状態が無ければ false（out は変えない）
 */
export function sampleMonitorStates(
  buffer: readonly ReceivedMonitorState[],
  renderTime: number,
  out: MonitorPose,
): boolean {
  const first = buffer[0];
  const last = buffer[buffer.length - 1];
  if (first === undefined || last === undefined) return false;
  if (renderTime <= first.receivedAt) {
    copyState(out, first.state);
    return true;
  }
  if (renderTime >= last.receivedAt) {
    copyState(out, last.state);
    return true;
  }
  for (let i = buffer.length - 2; i >= 0; i--) {
    const a = buffer[i];
    const b = buffer[i + 1];
    if (a === undefined || b === undefined || a.receivedAt > renderTime) continue;
    const span = b.receivedAt - a.receivedAt;
    interpolateMonitorState(
      a.state,
      b.state,
      span > 0 ? (renderTime - a.receivedAt) / span : 1,
      out,
    );
    return true;
  }
  copyState(out, first.state);
  return true;
}

/**
 * 描く時刻 renderTime（ms）の補間にもう使わない古い状態の数（先頭から何件捨ててよいか）．
 * renderTime 以前に受け取った最後の状態は補間の始まりに使うので残す
 */
export function staleMonitorStateCount(
  buffer: readonly ReceivedMonitorState[],
  renderTime: number,
): number {
  let lastAtOrBefore = -1;
  for (let i = 0; i < buffer.length; i++) {
    const item = buffer[i];
    if (item === undefined || item.receivedAt > renderTime) break;
    lastAtOrBefore = i;
  }
  return Math.max(0, lastAtOrBefore);
}
