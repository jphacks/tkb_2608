// 見守りで使う ID と指紋（部屋の ID・生徒の ID・校舎の指紋）を作る・確かめる（SPEC_01「見守り」の段階 1「部屋の ID と URL」）．
// 乱数と SHA-256 には crypto.getRandomValues・crypto.subtle.digest だけを使う（share/ の依存の例外）．sessionStorage・localStorage には触らず，置くのは呼ぶ側
import { bytesToBase64Url } from "./base64url";
import { PLAN_HASH_KEY } from "./planHash";

/** フラグメントの中で部屋の ID を置く名前（`#p=...&room=<部屋の ID>`） */
export const ROOM_HASH_KEY = "room";

/** 部屋の ID を作る時の乱数の大きさ（バイト）．base64url にすると 16 文字 */
export const ROOM_ID_RANDOM_BYTES = 12;

/** 部屋の ID として受け付ける形（base64url の文字で 8〜64 文字） */
const ROOM_ID_PATTERN = /^[A-Za-z0-9_-]{8,64}$/;

/** `p=` が無い（デモの校舎）時の校舎の指紋 */
export const DEMO_PLAN_FINGERPRINT = "demo";

/** 校舎の指紋に使う SHA-256 の先頭の大きさ（バイト）．base64url にすると 11 文字 */
const PLAN_FINGERPRINT_BYTES = 8;

/** 生徒の ID の最大値（u32） */
const STUDENT_ID_MAX = 0xffffffff;

/** 部屋の ID を作る（12 バイトの乱数を base64url にした 16 文字） */
export function createRoomId(): string {
  const bytes = new Uint8Array(ROOM_ID_RANDOM_BYTES);
  crypto.getRandomValues(bytes);
  return bytesToBase64Url(bytes);
}

/** 部屋の ID の形（base64url の文字で 8〜64 文字）に合うか．手で書いた ID もこの形なら受け付ける */
export function isRoomId(value: string): boolean {
  return ROOM_ID_PATTERN.test(value);
}

/**
 * フラグメント（`location.hash` の形．先頭の `#` はあっても無くてもよい）から部屋の ID を取る．
 * `room=` が無い・形に合わない時は null（中継につながない）
 */
export function getRoomIdFromHash(hash: string): string | null {
  const params = new URLSearchParams(hash.startsWith("#") ? hash.slice(1) : hash);
  const roomId = params.get(ROOM_HASH_KEY);
  return roomId !== null && isRoomId(roomId) ? roomId : null;
}

/** 生徒の ID を作る（1〜4294967295 の乱数．0 は使わない） */
export function createStudentId(): number {
  const value = new Uint32Array(1);
  do {
    crypto.getRandomValues(value);
  } while (value[0] === 0);
  return value[0];
}

/** 生徒の ID として正しい数か（1〜4294967295 の整数） */
export function isStudentId(value: unknown): value is number {
  return (
    typeof value === "number" && Number.isInteger(value) && value >= 1 && value <= STUDENT_ID_MAX
  );
}

/**
 * sessionStorage 等に文字で置いた生徒の ID を数に戻す．
 * 無い（null）・10 進の整数でない・範囲の外の時は null（呼ぶ側が createStudentId で作り直す）
 */
export function parseStudentId(text: string | null): number | null {
  if (text === null || !/^[0-9]{1,10}$/.test(text)) return null;
  const value = Number(text);
  return isStudentId(value) ? value : null;
}

/**
 * 校舎の指紋（planFingerprint）を作る．
 * フラグメントの `p` の値（埋め込みデータの文字列そのもの）の SHA-256 の先頭 8 バイトを base64url にした 11 文字．
 * encoded が null（`p=` が無い＝デモの校舎）の時は `demo`
 */
export async function createPlanFingerprint(encoded: string | null): Promise<string> {
  if (encoded === null) return DEMO_PLAN_FINGERPRINT;
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(encoded));
  return bytesToBase64Url(new Uint8Array(digest, 0, PLAN_FINGERPRINT_BYTES));
}

/** フラグメントから `p` の値を取り出して校舎の指紋を作る（loadPlanFromHash と同じ読み方．`p=` が無ければ `demo`） */
export function createPlanFingerprintFromHash(hash: string): Promise<string> {
  const params = new URLSearchParams(hash.startsWith("#") ? hash.slice(1) : hash);
  return createPlanFingerprint(params.get(PLAN_HASH_KEY));
}
