/// <reference types="node" />
// inputLogPlugin の受け取る口のテスト．開発サーバーの代わりに最小限の server を渡し，
// テスト用の一時ディレクトリを root にする（logs/ を汚さない．終わったら消す）
import { mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import type { IncomingMessage, ServerResponse } from "node:http";
import { tmpdir } from "node:os";
import path from "node:path";
import { Readable } from "node:stream";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { INPUT_LOG_ENDPOINT, MAX_REQUEST_BYTES } from "../recorder/logProtocol";
import { inputLogPlugin } from "./inputLogPlugin";

type Handler = (req: IncomingMessage, res: ServerResponse, next: () => void) => void;

let root: string;
let handler: Handler;
let mountedAt: string;

beforeEach(async () => {
  root = await mkdtemp(path.join(tmpdir(), "input-log-test-"));
  const plugin = inputLogPlugin();
  const server = {
    config: { root, logger: { info: () => {}, error: () => {} } },
    middlewares: {
      use(route: string, h: Handler) {
        mountedAt = route;
        handler = h;
      },
    },
  };
  const configure = plugin.configureServer as (s: unknown) => void;
  configure(server);
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

interface Result {
  status: number;
  body: string;
  nextCalled: boolean;
}

function request(method: string, url: string, body = ""): Promise<Result> {
  return new Promise((resolve) => {
    const req = Object.assign(Readable.from(body === "" ? [] : [Buffer.from(body)]), {
      method,
      url,
    }) as unknown as IncomingMessage;
    const res = {
      statusCode: 200,
      headersSent: false,
      setHeader() {},
      end(text?: string) {
        resolve({ status: this.statusCode, body: text ?? "", nextCalled: false });
      },
    };
    handler(req, res as unknown as ServerResponse, () =>
      resolve({ status: 0, body: "", nextCalled: true }),
    );
  });
}

const logDir = () => path.join(root, "logs", "input");

describe("inputLogPlugin", () => {
  it("開発サーバーだけで動き，/__input-log で受け取る", () => {
    expect(inputLogPlugin().apply).toBe("serve");
    expect(mountedAt).toBe(INPUT_LOG_ENDPOINT);
  });

  it("POST の JSONL を logs/input/<日時>_<セッション ID>.jsonl に追記する", async () => {
    const r1 = await request("POST", "/?session=abc123", '{"a":1}\n');
    expect(r1.status).toBe(204);
    const r2 = await request("POST", "/?session=abc123", '{"b":2}\r\n\n');
    expect(r2.status).toBe(204);
    const files = await readdir(logDir());
    expect(files).toHaveLength(1);
    expect(files[0]).toMatch(/^\d{8}-\d{6}_abc123\.jsonl$/);
    expect(await readFile(path.join(logDir(), files[0]), "utf8")).toBe('{"a":1}\n{"b":2}\n');
  });

  it("セッションごとに別のファイルにする", async () => {
    await request("POST", "/?session=s1", '{"a":1}');
    await request("POST", "/?session=s2", '{"a":2}');
    expect((await readdir(logDir())).sort()).toEqual([
      expect.stringMatching(/_s1\.jsonl$/),
      expect.stringMatching(/_s2\.jsonl$/),
    ]);
  });

  it("POST 以外は次へ回す", async () => {
    expect((await request("GET", "/?session=abc")).nextCalled).toBe(true);
  });

  it.each(["/", "/?session=", "/?session=..%2Fx", "/?session=a.b", `/?session=${"a".repeat(65)}`])(
    "セッション ID が不正（%s）なら 400 で書かない",
    async (url) => {
      const r = await request("POST", url, '{"a":1}');
      expect(r.status).toBe(400);
      await expect(readdir(logDir())).rejects.toThrow();
    },
  );

  it("JSON でない本文は 400 で書かない", async () => {
    const r = await request("POST", "/?session=abc", '{"a":1}\nnot json\n');
    expect(r.status).toBe(400);
    await expect(readdir(logDir())).rejects.toThrow();
  });

  it("1 MB を超える本文は 413 で書かない", async () => {
    const big = `{"x":"${"a".repeat(MAX_REQUEST_BYTES)}"}`;
    const r = await request("POST", "/?session=abc", big);
    expect(r.status).toBe(413);
    await expect(readdir(logDir())).rejects.toThrow();
  });

  it("空の本文は 204 でファイルを作らない", async () => {
    const r = await request("POST", "/?session=abc", "\n");
    expect(r.status).toBe(204);
    await expect(readdir(logDir())).rejects.toThrow();
  });
});
