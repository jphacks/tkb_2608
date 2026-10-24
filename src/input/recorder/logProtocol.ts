// フライトレコーダー（ブラウザ）と開発サーバーのプラグイン（Node）で共有する約束事．
// どちらからも import するため，DOM にも Node にも依存させない

/** 記録を受け取る開発サーバーの口（POST．?session=<セッション ID>，本文は JSONL） */
export const INPUT_LOG_ENDPOINT = "/__input-log";

/**
 * 記録の口の下に置く小さな口（すべて開発サーバーだけ．src/input/dev/inputLogPlugin.ts）．
 * - time（GET）: 開発サーバーの Date.now() を返す（時刻合わせ）
 * - sessions（GET）: 記録を送ってきている端末の一覧（操作盤のページ用）
 * - mark（POST）: 印を記録に書き込む（操作盤のページ用）
 * - list（GET）: logs/input/ の記録の一覧．file（GET ?name=）: 記録の中身（再生用）
 */
export const INPUT_LOG_ROUTES = {
  time: "/time",
  sessions: "/sessions",
  mark: "/mark",
  list: "/list",
  file: "/file",
} as const;

/** 印の種類の書式（英小文字・数字・ハイフン．記録にそのまま書くため短く限る） */
export const MARK_KIND_PATTERN = /^[a-z0-9-]{1,32}$/;

/** 印に添える説明の長さの上限（文字） */
export const MAX_MARK_NOTE_LENGTH = 200;

/** 1 回の POST の本文の上限（バイト）．レコーダーの 1 回の送信はこれより小さくする */
export const MAX_REQUEST_BYTES = 1024 * 1024;

/** セッション ID の書式．ファイル名に使うため英数字とハイフンだけにする（パス・トラバーサル対策） */
export const SESSION_ID_PATTERN = /^[A-Za-z0-9-]{1,64}$/;

export function isValidSessionId(id: unknown): id is string {
  return typeof id === "string" && SESSION_ID_PATTERN.test(id);
}

/**
 * 送信の応答の扱い．
 * - ok: 送信済みにする
 * - retry: 残して次回もう一度送る（つながらない・サーバーの一時的な失敗）
 * - reject: 何度送っても受け取られない（本文が不正等）．先に進むため送信済みにし，記録はダウンロード用に残す
 * status が null は通信そのものの失敗（fetch の例外）
 */
export type SendOutcome = "ok" | "retry" | "reject";

export function classifySendStatus(status: number | null): SendOutcome {
  if (status === null) return "retry";
  if (status >= 200 && status < 300) return "ok";
  // 408（タイムアウト）・429（多すぎる）は時間を置けば通る
  if (status === 408 || status === 429) return "retry";
  // 404 は開発サーバーにプラグインが無い（本番の配信等）．後でつながる可能性があるため残す
  if (status === 404) return "retry";
  if (status >= 400 && status < 500) return "reject";
  return "retry";
}

const ID_CHARS = "0123456789abcdefghijklmnopqrstuvwxyz";

/** セッション ID を作る（小文字の英数字 length 文字．length は 1〜64 に収める）．random は [0, 1) を返す関数 */
export function createSessionId(random: () => number = Math.random, length = 8): string {
  // SESSION_ID_PATTERN を満たすよう 1〜64 文字の整数に収める（NaN・非有限は既定の 8）
  const n = Number.isFinite(length) ? Math.min(64, Math.max(1, Math.floor(length))) : 8;
  let id = "";
  for (let i = 0; i < n; i++) {
    const r = random();
    const index = Number.isFinite(r) ? Math.floor(Math.abs(r) * ID_CHARS.length) : 0;
    id += ID_CHARS[Math.min(index, ID_CHARS.length - 1)];
  }
  return id;
}
