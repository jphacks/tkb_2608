/// <reference types="node" />
// inputLogPlugin の受け取る口のテスト．開発サーバーの代わりに最小限の server を渡し，
// テスト用の一時ディレクトリを root にする（logs/ を汚さない．終わったら消す）
import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import type { IncomingMessage, ServerResponse } from "node:http";
import { tmpdir } from "node:os";
import path from "node:path";
import { Readable, Writable } from "node:stream";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
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
  headers: Record<string, string>;
  nextCalled: boolean;
}

/** 応答の代わり（記録の中身はストリームで流すため Writable にする） */
class FakeResponse extends Writable {
  statusCode = 200;
  headersSent = false;
  readonly headers: Record<string, string> = {};
  readonly chunks: Buffer[] = [];
  setHeader(name: string, value: string | number): this {
    this.headers[name.toLowerCase()] = String(value);
    return this;
  }
  override _write(chunk: unknown, _enc: BufferEncoding, cb: (err?: Error | null) => void): void {
    this.headersSent = true;
    this.chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk)));
    cb();
  }
}

function request(method: string, url: string, body = ""): Promise<Result> {
  return new Promise((resolve) => {
    const req = Object.assign(Readable.from(body === "" ? [] : [Buffer.from(body)]), {
      method,
      url,
    }) as unknown as IncomingMessage;
    const res = new FakeResponse();
    res.on("finish", () =>
      resolve({
        status: res.statusCode,
        body: Buffer.concat(res.chunks).toString("utf8"),
        headers: res.headers,
        nextCalled: false,
      }),
    );
    handler(req, res as unknown as ServerResponse, () =>
      resolve({ status: 0, body: "", headers: {}, nextCalled: true }),
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

// ---- 操作盤・再生の口（INPUT_LOG_ROUTES．experiment_山﨑/10・ENV_04「担当D の dev ページ」） ----

const SID = "phone1";

/** スマホの記録の送信（meta と時刻合わせの clock） */
function deviceRecords(o: { clock?: boolean; meta?: boolean } = {}): string {
  const lines: string[] = [];
  if (o.meta !== false) {
    lines.push(JSON.stringify({ type: "meta", t: 0, page: "goggles", timeOrigin: 1_000_000 }));
  }
  if (o.clock !== false) {
    lines.push(JSON.stringify({ type: "clock", t: 1000, serverTime: Date.now(), rtt: 4 }));
  }
  lines.push(
    JSON.stringify({
      type: "state",
      t: 1500,
      event: "e",
      posture: "standing",
      loco: "idle",
      walking: false,
    }),
  );
  return `${lines.join("\n")}\n`;
}

async function logFile(): Promise<string> {
  const files = await readdir(logDir());
  expect(files).toHaveLength(1);
  return readFile(path.join(logDir(), files[0]), "utf8");
}

describe("inputLogPlugin: GET /time", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("開発サーバーの Date.now() を JSON で返す（キャッシュさせない）", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(1_700_000_000_123);
    const r = await request("GET", "/time");
    expect(r.status).toBe(200);
    expect(JSON.parse(r.body)).toEqual({ serverTime: 1_700_000_000_123 });
    expect(r.headers["content-type"]).toContain("application/json");
    expect(r.headers["cache-control"]).toBe("no-store");
  });

  it("末尾の / があっても同じ口", async () => {
    const r = await request("GET", "/time/");
    expect(r.status).toBe(200);
    expect(typeof JSON.parse(r.body).serverTime).toBe("number");
  });

  it("POST は次へ回す", async () => {
    expect((await request("POST", "/time", "{}")).nextCalled).toBe(true);
  });
});

describe("inputLogPlugin: GET /sessions", () => {
  it("記録を受け取る前は空", async () => {
    const r = await request("GET", "/sessions");
    expect(r.status).toBe(200);
    expect(JSON.parse(r.body)).toEqual([]);
  });

  it("記録を送ってきた端末を，ファイル名・ページ・時刻合わせ・判定の状態つきで返す", async () => {
    await request("POST", `/?session=${SID}`, deviceRecords());
    const list = JSON.parse((await request("GET", "/sessions")).body);
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({
      sessionId: SID,
      page: "goggles",
      timeOrigin: 1_000_000,
      clock: { t: 1000, rtt: 4 },
      lastState: { t: 1500, posture: "standing", walking: false },
    });
    expect(list[0].file).toMatch(/^\d{8}-\d{6}_phone1\.jsonl$/);
  });

  it("壊れた送信（400）では端末を覚えない", async () => {
    await request("POST", `/?session=${SID}`, "not json");
    expect(JSON.parse((await request("GET", "/sessions")).body)).toEqual([]);
  });
});

describe("inputLogPlugin: POST /mark", () => {
  it("知っている端末の記録に印を追記し，書いた印を返す", async () => {
    await request("POST", `/?session=${SID}`, deviceRecords());
    const r = await request(
      "POST",
      "/mark",
      JSON.stringify({ session: SID, kind: "false-walk", note: "見回しで進んだ" }),
    );
    expect(r.status).toBe(200);
    const mark = JSON.parse(r.body);
    expect(mark).toMatchObject({
      type: "mark",
      kind: "false-walk",
      note: "見回しで進んだ",
      source: "panel",
      clock: "sync",
    });
    expect(Number.isFinite(mark.t)).toBe(true);
    const lines = (await logFile()).trim().split("\n");
    expect(JSON.parse(lines[lines.length - 1])).toEqual(mark);
  });

  it("時刻合わせの前の端末には壁時計で換算した印を書く", async () => {
    await request("POST", `/?session=${SID}`, deviceRecords({ clock: false }));
    const r = await request("POST", "/mark", JSON.stringify({ session: SID, kind: "other" }));
    expect(r.status).toBe(200);
    expect(JSON.parse(r.body).clock).toBe("wall");
  });

  it("書式は正しいが知らないセッション（開発サーバーの再起動後等）は 400 でファイルを作らない", async () => {
    const r = await request(
      "POST",
      "/mark",
      JSON.stringify({ session: "unknown1", kind: "other" }),
    );
    expect(r.status).toBe(400);
    expect(r.body).toBe("unknown session");
    await expect(readdir(logDir())).rejects.toThrow();
  });

  it.each(["../phone1", "../../etc/passwd", "phone1/../x", "phone1.jsonl", "", "a".repeat(65)])(
    "セッションの書式が不正（%j）なら 400 で書かない",
    async (session) => {
      await request("POST", `/?session=${SID}`, deviceRecords());
      const before = await logFile();
      const r = await request("POST", "/mark", JSON.stringify({ session, kind: "other" }));
      expect(r.status).toBe(400);
      expect(await logFile()).toBe(before);
      expect(await readdir(logDir())).toHaveLength(1);
    },
  );

  it.each([
    ["種類が不正", { session: SID, kind: "../x" }],
    ["種類が無い", { session: SID }],
    ["説明が文字列でない", { session: SID, kind: "other", note: 1 }],
    ["配列", [SID]],
  ])("本文が不正（%s）なら 400 で書かない", async (_, body) => {
    await request("POST", `/?session=${SID}`, deviceRecords());
    const before = await logFile();
    const r = await request("POST", "/mark", JSON.stringify(body));
    expect(r.status).toBe(400);
    expect(await logFile()).toBe(before);
  });

  it("JSON でない本文は 400", async () => {
    await request("POST", `/?session=${SID}`, deviceRecords());
    const r = await request("POST", "/mark", "not json");
    expect(r.status).toBe(400);
  });

  it("4 KB を超える本文は 413 で書かない", async () => {
    await request("POST", `/?session=${SID}`, deviceRecords());
    const before = await logFile();
    const r = await request(
      "POST",
      "/mark",
      JSON.stringify({ session: SID, kind: "other", note: "a".repeat(5000) }),
    );
    expect(r.status).toBe(413);
    expect(await logFile()).toBe(before);
  });

  it("時刻合わせも meta も無い端末には書かない（400）", async () => {
    await request("POST", `/?session=${SID}`, deviceRecords({ clock: false, meta: false }));
    const before = await logFile();
    const r = await request("POST", "/mark", JSON.stringify({ session: SID, kind: "other" }));
    expect(r.status).toBe(400);
    expect(await logFile()).toBe(before);
  });

  it("GET は次へ回す", async () => {
    expect((await request("GET", "/mark")).nextCalled).toBe(true);
  });
});

describe("inputLogPlugin: GET /list", () => {
  it("記録が無ければ空", async () => {
    const r = await request("GET", "/list");
    expect(r.status).toBe(200);
    expect(JSON.parse(r.body)).toEqual([]);
  });

  it("記録のファイル名だけを新しい順に返す（ほかのファイルは出さない）", async () => {
    await mkdir(logDir(), { recursive: true });
    for (const name of [
      "20261024-100000_a.jsonl",
      "20261025-100000_b.jsonl",
      "secret.txt",
      "notes.jsonl",
    ]) {
      await writeFile(path.join(logDir(), name), "{}\n");
    }
    const r = await request("GET", "/list");
    expect(JSON.parse(r.body)).toEqual(["20261025-100000_b.jsonl", "20261024-100000_a.jsonl"]);
  });
});

describe("inputLogPlugin: GET /file", () => {
  const NAME = "20261024-100000_abc.jsonl";
  const CONTENT = '{"type":"motion","t":1}\n{"type":"motion","t":2}\n';

  beforeEach(async () => {
    await mkdir(logDir(), { recursive: true });
    await writeFile(path.join(logDir(), NAME), CONTENT);
    // logs/input/ の外にある，読まれてはいけないファイル
    await writeFile(path.join(root, "secret.jsonl"), "SECRET\n");
    await writeFile(path.join(root, "logs", "20261024-100000_abc.jsonl"), "SECRET\n");
  });

  it("記録の中身をそのまま返す（キャッシュさせない）", async () => {
    const r = await request("GET", `/file?name=${NAME}`);
    expect(r.status).toBe(200);
    expect(r.body).toBe(CONTENT);
    expect(r.headers["content-type"]).toContain("application/x-ndjson");
    expect(r.headers["cache-control"]).toBe("no-store");
  });

  it("書式は正しいが無い記録は 404", async () => {
    const r = await request("GET", "/file?name=20261024-100000_none.jsonl");
    expect(r.status).toBe(404);
  });

  it("記録の名前のフォルダは 404（ファイルだけを返す）", async () => {
    await mkdir(path.join(logDir(), "20261024-100000_dir.jsonl"));
    const r = await request("GET", "/file?name=20261024-100000_dir.jsonl");
    expect(r.status).toBe(404);
  });

  it.each([
    "/file",
    "/file?name=",
    "/file?name=../secret.jsonl",
    "/file?name=..%2Fsecret.jsonl",
    "/file?name=..%2F..%2Fsecret.jsonl",
    "/file?name=..%5Csecret.jsonl",
    "/file?name=..%2F20261024-100000_abc.jsonl",
    "/file?name=%2Fetc%2Fpasswd",
    "/file?name=%2Ftmp%2Fsecret.jsonl",
    "/file?name=20261024-100000_abc.jsonl%2F..%2F..%2Fsecret.jsonl",
    "/file?name=20261024-100000_abc.jsonl%00",
    "/file?name=secret.jsonl",
    "/file?name=.",
    "/file?name=..",
    "/file?name=20261024-100000_abc.json",
  ])("記録のファイル名の書式に合わない名前（%s）は 400 で中身を返さない", async (url) => {
    const r = await request("GET", url);
    expect(r.status).toBe(400);
    expect(r.body).not.toContain("SECRET");
    expect(r.body).not.toContain("motion");
  });

  it("name を 2 つ付けても最初の名前だけを見る（外へ出られない）", async () => {
    const r = await request("GET", `/file?name=${NAME}&name=../secret.jsonl`);
    expect(r.status).toBe(200);
    expect(r.body).toBe(CONTENT);
    const r2 = await request("GET", `/file?name=../secret.jsonl&name=${NAME}`);
    expect(r2.status).toBe(400);
  });

  it("POST は次へ回す", async () => {
    expect((await request("POST", `/file?name=${NAME}`, "x")).nextCalled).toBe(true);
  });
});

describe("inputLogPlugin: 知らない口", () => {
  it.each([
    ["GET", "/unknown"],
    ["GET", "/files"],
    ["PUT", "/mark"],
    ["DELETE", "/file?name=20261024-100000_abc.jsonl"],
    ["POST", "/list"],
  ])("%s %s は次へ回す", async (method, url) => {
    expect((await request(method, url)).nextCalled).toBe(true);
  });
});
