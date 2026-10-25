/**
 * 見守りの中継（Cloudflare Workers + Durable Objects．SPEC_01「見守り」の段階 1 の「中継」）．
 *
 * - 接続: `wss://<中継>/rooms/<部屋の ID>?role=student` と `?role=monitor`
 * - 部屋の ID ごとに Durable Object（`Room`）を 1 つ使う．student から届いたものを，同じ部屋の monitor 全員にそのまま流す
 * - monitor から届いたものは捨てる．中身は読まない
 * - 何も保存しない（storage を使わず，メモリにも持たない）．誰もいなくなった部屋は何も残さない
 * - 1 回の大きさが 4 KiB を超えるものは捨てる
 *
 * WebSocket Hibernation API を使い，メッセージの無い間は Durable Object を眠らせて費用を抑える．
 * 眠っても接続は保たれ，役割は接続のタグ（`acceptWebSocket` の第 2 引数）に持たせる．
 */

import { exceedsMaxMessageBytes, isValidRoomId, parseRole, parseRoomPath } from "./rules";

export interface Env {
  ROOM: DurableObjectNamespace;
}

function textResponse(status: number, body: string): Response {
  return new Response(body, { status, headers: { "content-type": "text/plain; charset=utf-8" } });
}

// Workers のモジュールの形は入口（fetch）を default export で渡す決まりのため，ここだけ default export を使う
export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    const roomId = parseRoomPath(url.pathname);
    if (roomId === null) return textResponse(404, "not found");
    if (!isValidRoomId(roomId)) return textResponse(400, "invalid room id");
    if (parseRole(url.searchParams.get("role")) === null) return textResponse(400, "invalid role");
    if (request.headers.get("Upgrade")?.toLowerCase() !== "websocket") {
      return textResponse(426, "expected websocket");
    }

    const stub = env.ROOM.get(env.ROOM.idFromName(roomId));
    return stub.fetch(request);
  },
} satisfies ExportedHandler<Env>;

/** 1 つの部屋．接続を受け，student から届いたものを monitor 全員へ流す． */
export class Room implements DurableObject {
  constructor(private readonly ctx: DurableObjectState) {}

  async fetch(request: Request): Promise<Response> {
    // Worker の入口で確かめ済みだが，Durable Object を直接呼ばれても困らないように確かめ直す
    const role = parseRole(new URL(request.url).searchParams.get("role"));
    if (role === null) return textResponse(400, "invalid role");
    if (request.headers.get("Upgrade")?.toLowerCase() !== "websocket") {
      return textResponse(426, "expected websocket");
    }

    const pair = new WebSocketPair();
    const [client, server] = [pair[0], pair[1]];
    this.ctx.acceptWebSocket(server, [role]);
    return new Response(null, { status: 101, webSocket: client });
  }

  async webSocketMessage(ws: WebSocket, message: string | ArrayBuffer): Promise<void> {
    if (!this.ctx.getTags(ws).includes("student")) return;
    if (exceedsMaxMessageBytes(message)) return;

    for (const monitor of this.ctx.getWebSockets("monitor")) {
      try {
        monitor.send(message);
      } catch {
        // 閉じかけの接続への送信の失敗は無視する（届かなくてよい）
      }
    }
  }

  async webSocketClose(ws: WebSocket, code: number, reason: string): Promise<void> {
    closeQuietly(ws, code, reason);
  }

  async webSocketError(ws: WebSocket): Promise<void> {
    closeQuietly(ws, 1011, "error");
  }
}

/** 相手から閉じられた接続を閉じ返す（すでに閉じていれば何もしない）． */
function closeQuietly(ws: WebSocket, code: number, reason: string): void {
  try {
    // 1005（理由なし）・1006（異常切断）は送り返せない番号なので 1000 にする
    ws.close(code === 1005 || code === 1006 ? 1000 : code, reason);
  } catch {
    // すでに閉じている
  }
}
