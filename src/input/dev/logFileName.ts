// 記録のファイル名の生成と，受け取った本文の検査（DOM にも Node にも依存しない純粋な関数）．
// 開発サーバーのプラグイン（inputLogPlugin.ts）と，dev ページのダウンロードの両方から使う
import { isValidSessionId } from "../recorder/logProtocol";

function pad2(n: number): string {
  return String(n).padStart(2, "0");
}

/** 日時を YYYYMMDD-HHMMSS（その環境のローカル時刻）にする．不正な日時なら null */
export function formatLogTimestamp(date: Date): string | null {
  if (Number.isNaN(date.getTime())) return null;
  const ymd = `${date.getFullYear()}${pad2(date.getMonth() + 1)}${pad2(date.getDate())}`;
  const hms = `${pad2(date.getHours())}${pad2(date.getMinutes())}${pad2(date.getSeconds())}`;
  return `${ymd}-${hms}`;
}

/**
 * 記録のファイル名 <YYYYMMDD-HHMMSS>_<セッション ID>.jsonl を作る．
 * セッション ID が書式に合わない（"../" 等を含む）・日時が不正なら null（変換せずに拒否する）
 */
export function buildLogFileName(date: Date, sessionId: string): string | null {
  if (!isValidSessionId(sessionId)) return null;
  const stamp = formatLogTimestamp(date);
  return stamp === null ? null : `${stamp}_${sessionId}.jsonl`;
}

const LOG_FILE_PATTERN = /^\d{8}-\d{6}_([A-Za-z0-9-]{1,64})\.jsonl$/;

/**
 * 記録のファイル名の書式（<YYYYMMDD-HHMMSS>_<セッション ID>.jsonl）か．
 * 再生のために中身を返す時，"../" 等でほかのファイルを読ませないよう，この書式の名前だけを受け付ける
 */
export function isLogFileName(name: unknown): name is string {
  return typeof name === "string" && LOG_FILE_PATTERN.test(name);
}

/** 記録のファイル名だけを残し，新しい順（名前の日時の降順）に並べる */
export function sortLogFileNames(names: readonly string[]): string[] {
  return names.filter(isLogFileName).sort((a, b) => (a < b ? 1 : a > b ? -1 : 0));
}

/** そのセッションの既存のファイル（開発サーバーを再起動した後も同じファイルに追記するため）．無ければ null */
export function findLogFileForSession(
  fileNames: readonly string[],
  sessionId: string,
): string | null {
  if (!isValidSessionId(sessionId)) return null;
  const pattern = /^\d{8}-\d{6}_([A-Za-z0-9-]+)\.jsonl$/;
  // 同じセッションのファイルが複数あれば，名前（日時）の最も新しいもの
  let found: string | null = null;
  for (const name of fileNames) {
    const m = pattern.exec(name);
    if (m !== null && m[1] === sessionId && (found === null || name > found)) found = name;
  }
  return found;
}

export type JsonlBodyCheck =
  | { readonly ok: true; readonly text: string; readonly lineCount: number }
  | { readonly ok: false; readonly reason: string };

/**
 * 受け取った本文が JSONL（各行が JSON のオブジェクト）かを確かめ，追記する形（各行の末尾に改行）にする．
 * 空行は飛ばす．1 行でも不正なら全体を拒否する（ファイルに途中まで書かない）
 */
export function checkJsonlBody(body: string): JsonlBodyCheck {
  const lines: string[] = [];
  const rawLines = body.split("\n");
  for (let i = 0; i < rawLines.length; i++) {
    const line = rawLines[i].replace(/\r$/, "");
    if (line.trim() === "") continue;
    let value: unknown;
    try {
      value = JSON.parse(line);
    } catch {
      return { ok: false, reason: `line ${i + 1} is not JSON` };
    }
    if (value === null || typeof value !== "object" || Array.isArray(value)) {
      return { ok: false, reason: `line ${i + 1} is not a JSON object` };
    }
    lines.push(line);
  }
  return {
    ok: true,
    text: lines.length === 0 ? "" : `${lines.join("\n")}\n`,
    lineCount: lines.length,
  };
}
