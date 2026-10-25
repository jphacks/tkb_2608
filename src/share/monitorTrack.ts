// 見守りで避難が終わった時に送る記録（DrillTrack）のバイト列と，中継の上限（4 KiB）に収まる知らせへの分け方・つなぎ方
// （SPEC_01「見守り」の段階 1「知らせ」の track）．JSON のままだと 1 件 60 バイトほどになり，150 秒の記録（750 件）で 40 KB を超えるため，
// 1 件 10 バイトのバイト列にし，2,400 バイトごとに分けて base64url にする
import type { DrillSample, DrillTrack } from "../core/drill";
import type { Posture } from "../core/types";
import { base64UrlToBytes, bytesToBase64Url } from "./base64url";
import { MONITOR_TRACK_MAX_PARTS, type MonitorTrackNotice } from "./monitorNotice";

/** バイト列の形の版 */
const TRACK_FORMAT_VERSION = 1;

/** 先頭の大きさ（バイト．版 u8・件数 u32） */
const HEADER_BYTES = 5;

/** 1 件の大きさ（バイト．t f32・x i16（cm）・z i16（cm）・floor u8・posture u8） */
export const MONITOR_TRACK_SAMPLE_BYTES = 10;

/**
 * 1 つの知らせに入れるバイト列の大きさ（バイト）．base64url で 3,200 文字になり，
 * JSON の残り（150 バイトほど）を足しても中継の上限 4,096 バイトに収まる
 */
export const MONITOR_TRACK_CHUNK_BYTES = 2400;

const I16_MIN = -32768;
const I16_MAX = 32767;

const POSTURE_TO_BYTE: Readonly<Record<Posture, number>> = { standing: 0, crouching: 1 };
const BYTE_TO_POSTURE: readonly Posture[] = ["standing", "crouching"];

/**
 * 記録をバイト列にする（リトルエンディアン．x・z は cm に丸めて約 ±327 m に収める）．
 * 値が有限でない・階が 0〜255 の整数でない件がある時は null（送らない）
 */
export function encodeMonitorTrack(track: DrillTrack): Uint8Array<ArrayBuffer> | null {
  const { samples } = track;
  const bytes = new Uint8Array(HEADER_BYTES + samples.length * MONITOR_TRACK_SAMPLE_BYTES);
  const view = new DataView(bytes.buffer);
  view.setUint8(0, TRACK_FORMAT_VERSION);
  view.setUint32(1, samples.length, true);
  let offset = HEADER_BYTES;
  for (const s of samples) {
    if (!Number.isFinite(Math.fround(s.t)) || !Number.isFinite(s.x) || !Number.isFinite(s.z)) {
      return null;
    }
    if (!Number.isInteger(s.floor) || s.floor < 0 || s.floor > 255) return null;
    const posture = POSTURE_TO_BYTE[s.posture];
    if (posture === undefined) return null;
    view.setFloat32(offset, s.t, true);
    view.setInt16(offset + 4, Math.min(I16_MAX, Math.max(I16_MIN, Math.round(s.x * 100))), true);
    view.setInt16(offset + 6, Math.min(I16_MAX, Math.max(I16_MIN, Math.round(s.z * 100))), true);
    view.setUint8(offset + 8, s.floor);
    view.setUint8(offset + 9, posture);
    offset += MONITOR_TRACK_SAMPLE_BYTES;
  }
  return bytes;
}

/**
 * バイト列を記録に戻す（x・z は m に戻す）．
 * 版が違う・長さが件数に合わない・t が有限でない・floor が floorCount（校舎の階の数）以上・posture が 0／1 でない時は null（例外を投げない）
 */
export function decodeMonitorTrack(bytes: Uint8Array, floorCount: number): DrillTrack | null {
  if (bytes.byteLength < HEADER_BYTES) return null;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (view.getUint8(0) !== TRACK_FORMAT_VERSION) return null;
  const count = view.getUint32(1, true);
  if (bytes.byteLength !== HEADER_BYTES + count * MONITOR_TRACK_SAMPLE_BYTES) return null;
  const samples: DrillSample[] = [];
  let offset = HEADER_BYTES;
  for (let i = 0; i < count; i++) {
    const t = view.getFloat32(offset, true);
    const floor = view.getUint8(offset + 8);
    const posture = BYTE_TO_POSTURE[view.getUint8(offset + 9)];
    if (!Number.isFinite(t) || floor >= floorCount || posture === undefined) return null;
    samples.push({
      t,
      floor,
      x: view.getInt16(offset + 4, true) / 100,
      z: view.getInt16(offset + 6, true) / 100,
      posture,
    });
    offset += MONITOR_TRACK_SAMPLE_BYTES;
  }
  return { samples };
}

/**
 * 記録を track の知らせに分ける．バイト列にできない・分ける数が MONITOR_TRACK_MAX_PARTS を超える時は空の配列（送らない）
 */
export function splitMonitorTrack(
  studentId: number,
  trackId: number,
  track: DrillTrack,
): MonitorTrackNotice[] {
  const bytes = encodeMonitorTrack(track);
  if (bytes === null) return [];
  const parts = Math.max(1, Math.ceil(bytes.byteLength / MONITOR_TRACK_CHUNK_BYTES));
  if (parts > MONITOR_TRACK_MAX_PARTS) return [];
  const notices: MonitorTrackNotice[] = [];
  for (let part = 0; part < parts; part++) {
    const chunk = bytes.subarray(
      part * MONITOR_TRACK_CHUNK_BYTES,
      (part + 1) * MONITOR_TRACK_CHUNK_BYTES,
    );
    notices.push({
      type: "track",
      studentId,
      trackId,
      part,
      parts,
      data: bytesToBase64Url(chunk),
    });
  }
  return notices;
}

/**
 * 受け取った部分（base64url．part の順に並べ，まだ届いていない所は undefined）をつないで記録に戻す．
 * 足りない・読めない部分がある時は null
 */
export function joinMonitorTrack(
  parts: readonly (string | undefined)[],
  floorCount: number,
): DrillTrack | null {
  const chunks: Uint8Array[] = [];
  let length = 0;
  for (let i = 0; i < parts.length; i++) {
    const data = parts[i];
    if (data === undefined) return null;
    const chunk = base64UrlToBytes(data);
    if (chunk === null) return null;
    chunks.push(chunk);
    length += chunk.byteLength;
  }
  if (chunks.length === 0) return null;
  const bytes = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return decodeMonitorTrack(bytes, floorCount);
}
