// 見守り画面が中継につなぐ URL を，ビルドの設定（VITE_MONITOR_RELAY_URL）と部屋の ID から作る（ENV_04「中継の住所の渡し方」）．
// import.meta.env は読まず，値を受け取るだけにする（node でテストできるように）

/**
 * ビルドの設定の値から中継の住所を取り出す．
 * ws:// か wss:// で始まる文字列だけを受け付け，前後の空白と末尾の `/` を落とす．
 * 未設定・空・形の違う値は null（見守り画面は「中継の住所が設定されていません」と出す）
 */
export function resolveRelayBaseUrl(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim().replace(/\/+$/, "");
  if (!/^wss?:\/\/[^/?#\s]+/.test(trimmed)) return null;
  return trimmed;
}

/** 見守り画面（受け取るだけ）としてつなぐ URL（`<中継の住所>/rooms/<部屋の ID>?role=monitor`） */
export function createMonitorRelayUrl(baseUrl: string, roomId: string): string {
  return `${baseUrl}/rooms/${encodeURIComponent(roomId)}?role=monitor`;
}
