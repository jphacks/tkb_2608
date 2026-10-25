// 検証（verifier）がつないでよい先の判定．検証対象はローカルの開発サーバー（npm run dev）だけ（.claude/verify-profile.md）．
// 許可リストに無い URL はすべて拒否し，本番・staging・外部 API は拒否リストとしても持つ（許可リストの設定ミスで届かないように）．

export const DEV_PORT = 5173;
export const BASE_URL = `http://127.0.0.1:${DEV_PORT}`;

/** つないでよいオリジン（ローカルの開発サーバーだけ） */
const ALLOWED_ORIGINS = new Set([BASE_URL, `http://localhost:${DEV_PORT}`]);

/** 許可リストに関わらず拒否するホスト（本番・staging・見守りの中継・Gemini） */
const DENIED_HOST_PATTERNS = [
  /(^|\.)tkb2608\.pages\.dev$/,
  /(^|\.)workers\.dev$/,
  /(^|\.)trycloudflare\.com$/,
  /^generativelanguage\.googleapis\.com$/,
];

/**
 * 開発サーバーの中でも拒否するパス．/api/ は Vite が npm run functions:dev（Gemini を呼ぶサーバー関数）へ流すため，
 * 人間が起動していると検証が API の利用料を使ってしまう
 */
const DENIED_PATH_PREFIXES = ["/api/"];

/** ページの中で読み込まれても検証の外に出ない（ブラウザが自分で解決する）スキーム */
const LOCAL_SCHEMES = new Set(["data:", "blob:", "about:"]);

/** url がつないでよい先か */
export function isAllowed(url) {
  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    return false;
  }
  if (LOCAL_SCHEMES.has(parsed.protocol)) return true;
  if (DENIED_HOST_PATTERNS.some((p) => p.test(parsed.hostname))) return false;
  // WebSocket（Vite の HMR）は http のオリジンに直して比べる
  const origin = parsed.origin.replace(/^ws(s?):/, "http$1:");
  if (!ALLOWED_ORIGINS.has(origin)) return false;
  return !DENIED_PATH_PREFIXES.some((prefix) => parsed.pathname.startsWith(prefix));
}

/** つないではいけない先なら例外を投げる */
export function assertAllowed(url) {
  if (!isAllowed(url)) {
    throw new Error(`検証の対象外の接続先です（ローカルの開発サーバーだけを許可）: ${url}`);
  }
}
