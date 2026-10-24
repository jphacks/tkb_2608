/// <reference types="node" />
// 開発サーバー（vite）だけで動くプラグイン．フライトレコーダーが POST した JSONL を受け取り，
// logs/input/<YYYYMMDD-HHMMSS>_<セッション ID>.jsonl に追記する（experiment_山﨑/10「開発サーバーで受け取る口」）．
// apply: "serve" のため，本番のビルド（vite build）には影響しない．
// npm run tunnel で外から開ける状態になるため，セッション ID の書式・本文の大きさ・ファイルの大きさを制限する．
// 操作盤のページ（印の書き込み・時刻合わせ・端末の一覧）と再生のページ（記録の一覧・中身）の口も置く（INPUT_LOG_ROUTES）
import { createReadStream } from "node:fs";
import { appendFile, mkdir, readdir, stat } from "node:fs/promises";
import type { IncomingMessage, ServerResponse } from "node:http";
import path from "node:path";
import type { Plugin } from "vite";
import {
  INPUT_LOG_ENDPOINT,
  INPUT_LOG_ROUTES,
  isValidSessionId,
  MAX_REQUEST_BYTES,
} from "../recorder/logProtocol";
import { toRecordLine } from "../recorder/records";
import {
  buildLogFileName,
  checkJsonlBody,
  findLogFileForSession,
  isLogFileName,
  sortLogFileNames,
} from "./logFileName";
import {
  buildMarkRecord,
  createSessionInfo,
  recentSessions,
  type SessionInfo,
  updateSessionInfo,
} from "./sessionInfo";

/** 1 つのファイルの大きさの上限（バイト）．これを超えたら追記しない（ディスクを埋めないため） */
const MAX_FILE_BYTES = 200 * 1024 * 1024;

/** 印の本文の上限（バイト） */
const MAX_MARK_BYTES = 4 * 1024;

/** 操作盤に出す端末: 最後に記録を受け取ってからこの時間（ms）以内のもの */
const SESSION_LIST_MAX_AGE_MS = 10 * 60 * 1000;

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

function sendJson(res: ServerResponse, value: unknown): void {
  res.statusCode = 200;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Cache-Control", "no-store");
  res.end(JSON.stringify(value));
}

export function inputLogPlugin(): Plugin {
  /** セッション ID → ファイル名（最初の POST で決める） */
  const files = new Map<string, string>();
  /** ファイルごとの追記の順番待ち（同じファイルへの追記を混ぜない） */
  const queues = new Map<string, Promise<void>>();
  /** セッション ID → 端末の情報（操作盤の印の時刻の換算・端末の一覧用．開発サーバーを再起動すると消える） */
  const sessions = new Map<string, SessionInfo>();

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

      /** 同じファイルへの追記を順番に行う */
      function enqueue(name: string, text: string): Promise<"ok" | "too-large"> {
        const prev = queues.get(name) ?? Promise.resolve();
        const job = prev.then(() => append(name, text));
        queues.set(
          name,
          job.then(
            () => undefined,
            () => undefined,
          ),
        );
        return job;
      }

      async function handleRecords(req: IncomingMessage, res: ServerResponse, url: URL) {
        const sessionId = url.searchParams.get("session");
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
        const result = await enqueue(name, checked.text);
        const now = Date.now();
        sessions.set(
          sessionId,
          updateSessionInfo(
            sessions.get(sessionId) ?? createSessionInfo(sessionId, name, now),
            checked.text,
            now,
          ),
        );
        if (result === "too-large") send(res, 413, "log file too large");
        else send(res, 204);
      }

      async function handleMark(req: IncomingMessage, res: ServerResponse) {
        const now = Date.now();
        const body = await readBody(req, MAX_MARK_BYTES);
        if (body === null) {
          send(res, 413, "body too large");
          return;
        }
        let parsed: unknown;
        try {
          parsed = JSON.parse(body);
        } catch {
          send(res, 400, "body is not JSON");
          return;
        }
        const built = buildMarkRecord(parsed, sessions, now);
        if (!built.ok) {
          send(res, 400, built.reason);
          return;
        }
        const info = sessions.get(built.sessionId);
        const line = toRecordLine(built.record);
        if (info === undefined || line === null) {
          send(res, 400, "unknown session");
          return;
        }
        const result = await enqueue(info.file, `${line}\n`);
        if (result === "too-large") send(res, 413, "log file too large");
        else sendJson(res, built.record);
      }

      async function handleFile(res: ServerResponse, url: URL) {
        const name = url.searchParams.get("name");
        if (!isLogFileName(name)) {
          send(res, 400, "invalid name");
          return;
        }
        const file = path.join(dir, name);
        const exists = await stat(file).then(
          (s) => s.isFile(),
          () => false,
        );
        if (!exists) {
          send(res, 404, "not found");
          return;
        }
        res.statusCode = 200;
        res.setHeader("Content-Type", "application/x-ndjson; charset=utf-8");
        res.setHeader("Cache-Control", "no-store");
        createReadStream(file).pipe(res);
      }

      server.middlewares.use(
        INPUT_LOG_ENDPOINT,
        (req: IncomingMessage, res: ServerResponse, next: (err?: unknown) => void) => {
          const url = new URL(req.url ?? "", "http://localhost");
          const route = url.pathname.replace(/\/+$/, "");
          const method = req.method ?? "GET";
          let job: Promise<void> | null = null;
          if (method === "POST" && route === "") job = handleRecords(req, res, url);
          else if (method === "POST" && route === INPUT_LOG_ROUTES.mark) job = handleMark(req, res);
          else if (method === "GET" && route === INPUT_LOG_ROUTES.time) {
            sendJson(res, { serverTime: Date.now() });
            return;
          } else if (method === "GET" && route === INPUT_LOG_ROUTES.sessions) {
            sendJson(res, recentSessions(sessions.values(), Date.now(), SESSION_LIST_MAX_AGE_MS));
            return;
          } else if (method === "GET" && route === INPUT_LOG_ROUTES.list) {
            job = mkdir(dir, { recursive: true })
              .then(() => readdir(dir))
              .then((names) => sendJson(res, sortLogFileNames(names)));
          } else if (method === "GET" && route === INPUT_LOG_ROUTES.file)
            job = handleFile(res, url);
          if (job === null) {
            next();
            return;
          }
          job.catch((err: unknown) => {
            server.config.logger.error(`[input-log] 処理に失敗: ${String(err)}`);
            if (!res.headersSent) send(res, 500, "failed");
          });
        },
      );
    },
  };
}
