// FlightRecorder の送信の扱い（fetch とブラウザのグローバルを差し替えて確かめる）
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { FlightRecorder } from "./flightRecorder";
import { INPUT_LOG_ENDPOINT, isValidSessionId } from "./logProtocol";

type FetchResult = number | "throw";

let results: FetchResult[];
let calls: { url: string; init: RequestInit }[];

beforeEach(() => {
  results = [];
  calls = [];
  vi.stubGlobal("window", {
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    devicePixelRatio: 2,
  });
  vi.stubGlobal("screen", { width: 390, height: 844 });
  vi.stubGlobal("navigator", { userAgent: "test-agent" });
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init: RequestInit) => {
      calls.push({ url, init });
      const r = results.shift() ?? 204;
      if (r === "throw") throw new TypeError("Failed to fetch");
      return { status: r } as Response;
    }),
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
});

function linesOf(body: BodyInit | null | undefined): unknown[] {
  return String(body)
    .trimEnd()
    .split("\n")
    .map((l) => JSON.parse(l));
}

describe("FlightRecorder", () => {
  it("最初に meta を記録する", () => {
    const rec = new FlightRecorder({ page: "sensors", extra: { permission: "granted" } });
    expect(isValidSessionId(rec.sessionId)).toBe(true);
    const [meta] = linesOf(rec.toJsonl()) as Record<string, unknown>[];
    expect(meta).toMatchObject({
      type: "meta",
      sessionId: rec.sessionId,
      page: "sensors",
      version: 1,
      userAgent: "test-agent",
      screen: { width: 390, height: 844, dpr: 2 },
      extra: { permission: "granted" },
    });
  });

  it("flush でたまった行を /__input-log?session=<ID> に POST し，成功したら送信済みにする", async () => {
    const rec = new FlightRecorder({ page: "sensors" });
    rec.record({ type: "visibility", t: 1, state: "hidden" });
    await rec.flush();
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe(`${INPUT_LOG_ENDPOINT}?session=${rec.sessionId}`);
    expect(calls[0].init.method).toBe("POST");
    expect(linesOf(calls[0].init.body)).toHaveLength(2);
    expect(rec.status()).toMatchObject({ pending: 0, sent: 2, lastOutcome: "ok", lastStatus: 204 });
    await rec.flush();
    expect(calls).toHaveLength(1);
  });

  it.each<FetchResult>(["throw", 404, 503])("%s なら残して次回同じ行を送り直す", async (r) => {
    const rec = new FlightRecorder({ page: "sensors" });
    results = [r];
    await rec.flush();
    expect(rec.status()).toMatchObject({ pending: 1, sent: 0, lastOutcome: "retry" });
    rec.record({ type: "visibility", t: 1, state: "visible" });
    await rec.flush();
    expect(calls).toHaveLength(2);
    expect(String(calls[1].init.body).startsWith(String(calls[0].init.body))).toBe(true);
    expect(rec.status()).toMatchObject({ pending: 0, sent: 2, lastOutcome: "ok" });
  });

  it("400 なら拒否として送信済みにし，ダウンロード用には残す", async () => {
    const rec = new FlightRecorder({ page: "sensors" });
    results = [400];
    await rec.flush();
    expect(rec.status()).toMatchObject({ pending: 0, rejected: 1, lastOutcome: "reject" });
    expect(linesOf(rec.toJsonl())).toHaveLength(1);
  });

  it("1 回の上限を超える分は続けて送る", async () => {
    const rec = new FlightRecorder({
      page: "sensors",
      buffer: { maxRetainedBytes: 1_000_000, maxBatchBytes: 200 },
    });
    for (let i = 0; i < 20; i++) rec.record({ type: "visibility", t: i, state: "visible" });
    await rec.flush();
    expect(calls.length).toBeGreaterThan(1);
    const sent = calls.flatMap((c) => linesOf(c.init.body));
    expect(sent).toHaveLength(21);
    expect(rec.status().pending).toBe(0);
  });

  it("flushOnExit は keepalive で残りを送る", async () => {
    const rec = new FlightRecorder({ page: "protocol" });
    await rec.flushOnExit();
    expect(calls).toHaveLength(1);
    expect(calls[0].init.keepalive).toBe(true);
    expect(rec.status().pending).toBe(0);
    // 続けて呼んでも同じ行を送らない
    await rec.flushOnExit();
    expect(calls).toHaveLength(1);
  });

  it("送信中に flushOnExit が来たら続きだけを送り，行を欠かさない", async () => {
    const rec = new FlightRecorder({ page: "sensors" });
    let release: (() => void) | undefined;
    const fetchMock = vi.fn(async (url: string, init: RequestInit) => {
      calls.push({ url, init });
      if (calls.length === 1) await new Promise<void>((r) => (release = r));
      return { status: 204 } as Response;
    });
    vi.stubGlobal("fetch", fetchMock);
    const flushing = rec.flush();
    await vi.waitFor(() => expect(release).toBeDefined());
    rec.record({ type: "visibility", t: 5, state: "hidden" });
    await rec.flushOnExit();
    release?.();
    await flushing;
    const all = calls.flatMap((c) => linesOf(c.init.body)) as { type: string }[];
    expect(all.map((r) => r.type)).toEqual(["meta", "visibility"]);
    expect(rec.status()).toMatchObject({ pending: 0, sent: 2 });
  });
});
