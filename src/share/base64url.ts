// バイト列と base64url（`+` → `-`，`/` → `_`，末尾の `=` を除く）の変換．URL のフラグメントにそのまま置ける文字だけにする．
// atob・btoa を使わず自前で書き，ブラウザと Node で同じ結果になる純粋な関数にしている

const ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";

const CHAR_TO_VALUE: ReadonlyMap<string, number> = new Map(
  [...ALPHABET].map((ch, value) => [ch, value]),
);

/** バイト列を base64url の文字列にする（末尾の `=` は付けない） */
export function bytesToBase64Url(bytes: Uint8Array): string {
  let text = "";
  for (let i = 0; i < bytes.length; i += 3) {
    const b0 = bytes[i];
    const b1 = i + 1 < bytes.length ? bytes[i + 1] : 0;
    const b2 = i + 2 < bytes.length ? bytes[i + 2] : 0;
    const bits = (b0 << 16) | (b1 << 8) | b2;
    text += ALPHABET[(bits >> 18) & 63] + ALPHABET[(bits >> 12) & 63];
    if (i + 1 < bytes.length) text += ALPHABET[(bits >> 6) & 63];
    if (i + 2 < bytes.length) text += ALPHABET[bits & 63];
  }
  return text;
}

/**
 * base64url の文字列をバイト列に戻す．
 * base64url に無い文字（`=` を含む）がある・長さが合わない（4 で割って 1 余る）時は null を返す
 */
export function base64UrlToBytes(text: string): Uint8Array<ArrayBuffer> | null {
  if (text.length % 4 === 1) return null;
  const values: number[] = [];
  for (const ch of text) {
    const value = CHAR_TO_VALUE.get(ch);
    if (value === undefined) return null;
    values.push(value);
  }
  const bytes = new Uint8Array(Math.floor((values.length * 6) / 8));
  let byteIndex = 0;
  for (let i = 0; i < values.length; i += 4) {
    const v0 = values[i];
    const v1 = values[i + 1];
    const v2 = i + 2 < values.length ? values[i + 2] : 0;
    const v3 = i + 3 < values.length ? values[i + 3] : 0;
    const bits = (v0 << 18) | (v1 << 12) | (v2 << 6) | v3;
    bytes[byteIndex++] = (bits >> 16) & 255;
    if (i + 2 < values.length) bytes[byteIndex++] = (bits >> 8) & 255;
    if (i + 3 < values.length) bytes[byteIndex++] = bits & 255;
  }
  return bytes;
}
