/**
 * 見守りの中継の判定（役割・部屋の ID・大きさ）．Workers の API に依存しない純粋な関数で，node 上でテストできる．
 */

/** 接続の役割（SPEC_01「中継」）． */
export type Role = "student" | "monitor";

/** 1 回のメッセージの大きさの上限（バイト）． */
export const MAX_MESSAGE_BYTES = 4096;

/** 部屋の ID の形（base64url の文字で 8〜64 文字．SPEC_01「部屋の ID と URL」）． */
const ROOM_ID_PATTERN = /^[A-Za-z0-9_-]{8,64}$/;

/** `/rooms/<部屋の ID>` の形のパス． */
const ROOM_PATH_PATTERN = /^\/rooms\/([^/]+)$/;

/** `/rooms/<部屋の ID>` の形のパスから部屋の ID の部分を取り出す（形の検査はしない）．形に合わなければ null． */
export function parseRoomPath(pathname: string): string | null {
  return ROOM_PATH_PATTERN.exec(pathname)?.[1] ?? null;
}

/** 文字列を役割として読む．役割でなければ null． */
export function parseRole(value: string | null): Role | null {
  return value === "student" || value === "monitor" ? value : null;
}

/** 部屋の ID の形に合うか． */
export function isValidRoomId(value: string): boolean {
  return ROOM_ID_PATTERN.test(value);
}

const encoder = new TextEncoder();

/** メッセージの大きさ（バイト．文字列は UTF-8 で数える）． */
export function messageBytes(message: string | ArrayBuffer): number {
  if (typeof message !== "string") return message.byteLength;
  return encoder.encode(message).byteLength;
}

/** メッセージの大きさが上限（`MAX_MESSAGE_BYTES`）を超えるか． */
export function exceedsMaxMessageBytes(message: string | ArrayBuffer): boolean {
  // UTF-8 では UTF-16 の 1 単位が最大 3 バイトなので，短い文字列は数えなくても上限に収まると分かる
  // （状態は 1 秒に 20〜30 回届くため，ほとんどの知らせで UTF-8 への変換を省く）
  if (typeof message === "string" && message.length * 3 <= MAX_MESSAGE_BYTES) return false;
  return messageBytes(message) > MAX_MESSAGE_BYTES;
}
