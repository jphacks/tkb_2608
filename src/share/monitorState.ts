// 見守りで 1 秒に 20〜30 回送る状態（20 バイト．リトルエンディアン）とバイト列の変換，通し番号の比べ方（SPEC_01「見守り」の段階 1「状態」）．
// 送る側が毎回 new しなくて済むよう，用意した DataView に書き込む形にしている
import type { Posture } from "../core/types";
import { isStudentId } from "./monitorIds";

/** 状態のバイト列の長さ（バイト） */
export const MONITOR_STATE_BYTES = 20;

/** 向き（yaw・pitch）の 1 単位（rad）．i16 で −π 以上 π 未満を表す */
const ANGLE_UNIT = Math.PI / 32768;

/** 通し番号の周期（u16） */
const SEQ_MODULO = 65536;

const I16_MIN = -32768;
const I16_MAX = 32767;

/** 送る状態（単位は送る前のもの．x・z は m，yaw・pitch は rad） */
export interface MonitorState {
  /** 生徒の ID（1〜4294967295） */
  readonly studentId: number;
  /** 通し番号（0〜65535．書く時は 65536 で割った余りにする） */
  readonly seq: number;
  /** 階（SchoolPlan.floors の添字．DrillSample.floor と同じ） */
  readonly floor: number;
  readonly posture: Posture;
  /** 非常ベルからの秒数（s）．非常ベルの前は負の数 */
  readonly t: number;
  /** ワールド座標の X（m）．送る時は cm に丸めて約 ±327 m に収める */
  readonly x: number;
  /** ワールド座標の Z（m）．同上 */
  readonly z: number;
  /** 水平の向き（rad）．0 が -Z 向きで右回りに増える（DrillSetup.startYaw と同じ）．送る時は −π 以上 π 未満に直す */
  readonly yaw: number;
  /** 上下の向き（rad．上が正）．送る時は ±π/2 に収める */
  readonly pitch: number;
}

const POSTURE_TO_BYTE: Readonly<Record<Posture, number>> = { standing: 0, crouching: 1 };
const BYTE_TO_POSTURE: readonly Posture[] = ["standing", "crouching"];

const clamp = (value: number, min: number, max: number): number =>
  Math.min(max, Math.max(min, value));

/** 角度（rad）を −π 以上 π 未満に直して π / 32768 rad 単位の i16 にする */
function yawToI16(yaw: number): number {
  const units = Math.round(yaw / ANGLE_UNIT);
  // 65536 単位で 1 周．−32768〜32767 に折り返す（丸めで +π ちょうどになったものも −π になる）
  return ((((units + 32768) % SEQ_MODULO) + SEQ_MODULO) % SEQ_MODULO) - 32768;
}

/**
 * 状態を view の先頭から 20 バイトに書き込む．
 * x・z は cm に丸めて i16 に収め，yaw は −π 以上 π 未満に，pitch は ±π/2 に直す．seq は 65536 で割った余りにする．
 * 値が有限でない・studentId や floor が範囲の外・view が 20 バイトより短い時は何も書かずに false を返す（その回は送らない）
 */
export function writeMonitorState(view: DataView, state: MonitorState): boolean {
  const { studentId, seq, floor, posture, t, x, z, yaw, pitch } = state;
  if (view.byteLength < MONITOR_STATE_BYTES) return false;
  if (!isStudentId(studentId)) return false;
  if (!Number.isInteger(seq) || !Number.isInteger(floor) || floor < 0 || floor > 255) return false;
  const postureByte = POSTURE_TO_BYTE[posture];
  if (postureByte === undefined) return false;
  // f32 にすると大きすぎる t は Infinity になるので，丸めた後で確かめる
  if (!Number.isFinite(Math.fround(t))) return false;
  if (![x, z, yaw, pitch].every(Number.isFinite)) return false;

  view.setUint32(0, studentId, true);
  view.setUint16(4, ((seq % SEQ_MODULO) + SEQ_MODULO) % SEQ_MODULO, true);
  view.setUint8(6, floor);
  view.setUint8(7, postureByte);
  view.setFloat32(8, t, true);
  view.setInt16(12, clamp(Math.round(x * 100), I16_MIN, I16_MAX), true);
  view.setInt16(14, clamp(Math.round(z * 100), I16_MIN, I16_MAX), true);
  view.setInt16(16, yawToI16(yaw), true);
  view.setInt16(18, Math.round(clamp(pitch, -Math.PI / 2, Math.PI / 2) / ANGLE_UNIT), true);
  return true;
}

/**
 * 受け取ったバイト列を状態に戻す（x・z は m，yaw・pitch は rad に戻す）．
 * 長さが 20 バイトでない・studentId が 0・posture が 0／1 でない・t が有限でない・floor が floorCount（校舎の階の数）以上のものは null（例外を投げない）
 */
export function readMonitorState(
  data: ArrayBuffer | ArrayBufferView,
  floorCount: number,
): MonitorState | null {
  if (data.byteLength !== MONITOR_STATE_BYTES) return null;
  const view = ArrayBuffer.isView(data)
    ? new DataView(data.buffer, data.byteOffset, data.byteLength)
    : new DataView(data);

  const studentId = view.getUint32(0, true);
  const floor = view.getUint8(6);
  const posture = BYTE_TO_POSTURE[view.getUint8(7)];
  const t = view.getFloat32(8, true);
  if (studentId === 0 || posture === undefined || !Number.isFinite(t) || floor >= floorCount) {
    return null;
  }
  return {
    studentId,
    seq: view.getUint16(4, true),
    floor,
    posture,
    t,
    x: view.getInt16(12, true) / 100,
    z: view.getInt16(14, true) / 100,
    yaw: view.getInt16(16, true) * ANGLE_UNIT,
    pitch: view.getInt16(18, true) * ANGLE_UNIT,
  };
}

/** 次に送る通し番号（65535 の次は 0） */
export function nextMonitorSeq(seq: number): number {
  return (seq + 1) % SEQ_MODULO;
}

/**
 * 通し番号 seq が，直前に受け取った lastSeq より新しいか．
 * 差 =（seq − lastSeq）を 65536 で割った余り（0〜65535）が 1〜32767 なら新しい．
 * 0（重複）と 32768〜65535（遅れて届いた古いもの）は false（捨てる）
 */
export function isNewerMonitorSeq(seq: number, lastSeq: number): boolean {
  const diff = (((seq - lastSeq) % SEQ_MODULO) + SEQ_MODULO) % SEQ_MODULO;
  return diff >= 1 && diff <= 32767;
}
