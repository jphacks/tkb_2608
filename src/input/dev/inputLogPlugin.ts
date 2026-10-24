/// <reference types="node" />
// 開発サーバー（vite）だけで動くプラグイン．フライトレコーダーが POST した JSONL を受け取り，
// logs/input/<YYYYMMDD-HHMMSS>_<セッション ID>.jsonl に追記する（experiment_山﨑/10「開発サーバーで受け取る口」）．
// apply: "serve" のため，本番のビルド（vite build）には影響しない．
// npm run tunnel で外から開ける状態になるため，セッション ID の書式・本文の大きさ・ファイルの大きさを制限する
import { appendFile, mkdir, readdir, stat } from "node:fs/promises";
import type { IncomingMessage, ServerResponse } from "node:http";
import path from "node:path";
import type { Plugin } from "vite";
import { INPUT_LOG_ENDPOINT, isValidSessionId, MAX_REQUEST_BYTES } from "../recorder/logProtocol";
import { buildLogFileName, checkJsonlBody, findLogFileForSession } from "./logFileName";

/** 1 つのファイルの大きさの上限（バイト）．これを超えたら追記しない（ディスクを埋めないため） */
const MAX_FILE_BYTES = 200 * 1024 * 1024;

/** 本文を上限つきで読む．上限を超えたら null */
function readBody(req: IncomingMessage, limit: number): Promise<string | null> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    let over = false;
    req.on("data", (chunk: Buffer) => {
      if (over) return;
      size += chunk.length;
      if (size > limit) {
        over = true;
        chunks.length = 0;
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => resolve(over ? null : Buffer.concat(chunks).toString("utf8")));
    req.on("error", reject);
  });
}

function send(res: ServerResponse, status: number, message?: string): void {
  res.statusCode = status;
  if (message !== undefined) {
    res.setHeader("Content-Type", "text/plain; charset=utf-8");
    res.end(message);
  } else res.end();
}

export function inputLogPlugin(): Plugin {
  /** セッション ID → ファイル名（最初の POST で決める） */
  const files = new Map<string, string>();
  /** ファイルごとの追記の順番待ち（同じファイルへの追記を混ぜない） */
  const queues = new Map<string, Promise<void>>();

  return {
    name: "input-log",
    apply: "serve",
    configureServer(server) {
      const dir = path.resolve(server.config.root, "logs", "input");

      async function resolveFile(sessionId: string): Promise<string | null> {
        const known = files.get(sessionId);
        if (known !== undefined) return known;
        await mkdir(dir, { recursive: true });
        const existing = findLogFileForSession(await readdir(dir), sessionId);
        const name = existing ?? buildLogFileName(new Date(), sessionId);
        if (name === null) return null;
        files.set(sessionId, name);
        if (existing === null) {
          server.config.logger.info(`[input-log] 記録を開始: logs/input/${name}`, {
            timestamp: true,
          });
        }
        return name;
      }

      async function append(name: string, text: string): Promise<"ok" | "too-large"> {
        const file = path.join(dir, name);
        const size = await stat(file).then(
          (s) => s.size,
          () => 0,
        );
        if (size + Buffer.byteLength(text) > MAX_FILE_BYTES) return "too-large";
        await appendFile(file, text, "utf8");
        return "ok";
      }

      server.middlewares.use(
        INPUT_LOG_ENDPOINT,
        (req: IncomingMessage, res: ServerResponse, next: (err?: unknown) => void) => {
          if (req.method !== "POST") {
            next();
            return;
          }
          void (async () => {
            const sessionId = new URL(req.url ?? "", "http://localhost").searchParams.get(
              "session",
            );
            if (!isValidSessionId(sessionId)) {
              send(res, 400, "invalid session");
              return;
            }
            const body = await readBody(req, MAX_REQUEST_BYTES);
            if (body === null) {
              send(res, 413, "body too large");
              return;
            }
            const checked = checkJsonlBody(body);
            if (!checked.ok) {
              send(res, 400, checked.reason);
              return;
            }
            if (checked.lineCount === 0) {
              send(res, 204);
              return;
            }
            const name = await resolveFile(sessionId);
            if (name === null) {
              send(res, 400, "invalid session");
              return;
            }
            const prev = queues.get(name) ?? Promise.resolve();
            const job = prev.then(() => append(name, checked.text));
            queues.set(
              name,
              job.then(
                () => undefined,
                () => undefined,
              ),
            );
            const result = await job;
            if (result === "too-large") send(res, 413, "log file too large");
            else send(res, 204);
          })().catch((err: unknown) => {
            server.config.logger.error(`[input-log] 書き込みに失敗: ${String(err)}`);
            if (!res.headersSent) send(res, 500, "write failed");
          });
        },
      );
    },
  };
}
