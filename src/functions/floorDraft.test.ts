// 配置の下書き（ES3）のサーバー関数（functions/api/floor-draft.ts の onRequestPost）のテスト．
// Gemini への通信は globalThis.fetch を差し替えて代わりの応答を返し，実際の API は呼ばない．
// vitest の include が src/**/*.test.ts のため src に置く（functions/ の中に置くと Pages Functions の経路になってしまう）．
// tsconfig（src 用）は Workers の型（PagesFunction）を持たないため，型を付けて動的に読み込む（src/scripts/tunnel.test.ts と同じ）．
// 基準は docs/04_SPEC/SPEC_02「配置の下書き」（送るのは画像とマス目の大きさだけ・API キーはサーバー関数に置く）と，PR #168 で決めたこと
// （multipart/form-data の image・width・depth．画像は 4 MB まで，マス目は 80 マスまで．既定のモデルは gemini-3.5-flash．
// GEMINI_MODEL で上書きし，空文字なら既定）
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MAX_FLOOR_DRAFT_IMAGE_BYTES } from "../core/floorDraftApi";

interface Env {
  readonly GEMINI_API_KEY?: string;
  readonly GEMINI_MODEL?: string;
}

interface FloorDraftFunctionModule {
  onRequestPost(context: { request: Request; env: Env }): Promise<Response>;
}

const FUNCTION_PATH: string = "../../functions/api/floor-draft.ts";
const { onRequestPost } = (await import(
  /* @vite-ignore */ FUNCTION_PATH
)) as FloorDraftFunctionModule;

/** テスト用の偽の API キー（本物のキーは使わない） */
const KEY = "test-key-not-real";
const ENV: Env = { GEMINI_API_KEY: KEY };

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

/** PNG の先頭 8 byte に続けて size byte になる画像 */
function png(size = 32): Blob {
  const bytes = new Uint8Array(Math.max(size, PNG_SIGNATURE.length));
  bytes.set(PNG_SIGNATURE);
  for (let i = PNG_SIGNATURE.length; i < bytes.length; i++) bytes[i] = i % 256;
  return new Blob([bytes], { type: "image/png" });
}

/** 送る欄（既定は正しい要求．null の欄は送らない） */
function form(
  fields: Partial<Record<"image" | "width" | "depth", Blob | string | null>> = {},
): FormData {
  const all: Record<string, Blob | string | null> = {
    image: png(),
    width: "10",
    depth: "8",
    ...fields,
  };
  const f = new FormData();
  for (const [name, value] of Object.entries(all)) {
    if (value === null) continue;
    if (typeof value === "string") f.append(name, value);
    else f.append(name, value, "floor.png");
  }
  return f;
}

const post = (body: FormData | string, headers: Record<string, string> = {}): Request =>
  new Request("https://example.test/api/floor-draft", { method: "POST", body, headers });

const call = (request: Request, env: Env = ENV): Promise<Response> =>
  onRequestPost({ request, env });

const ROOMS = [
  { name: "1年1組", kind: "room", box: [0, 0, 500, 1000] },
  { name: "", kind: "corridor", box: [500, 0, 1000, 1000] },
];

/** Gemini の generateContent の応答（本文の文字列を 1 つの part で返す） */
const geminiResponse = (text: string, extraParts: unknown[] = []): Response =>
  new Response(
    JSON.stringify({ candidates: [{ content: { parts: [...extraParts, { text }] } }] }),
    { status: 200, headers: { "content-type": "application/json" } },
  );

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  fetchMock = vi.fn(async () => geminiResponse(JSON.stringify({ rooms: ROOMS })));
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

async function expectError(response: Response, status: number): Promise<string> {
  expect(response.status).toBe(status);
  const body = (await response.json()) as { error?: unknown };
  expect(typeof body.error).toBe("string");
  expect(body.error).not.toBe("");
  return body.error as string;
}

describe("onRequestPost（POST /api/floor-draft）", () => {
  describe("成功", () => {
    it("Gemini の矩形を検査して { rooms } で返す", async () => {
      const response = await call(post(form()));
      expect(response.status).toBe(200);
      expect(response.headers.get("content-type")).toContain("application/json");
      expect(response.headers.get("cache-control")).toBe("no-store");
      expect(await response.json()).toEqual({ rooms: ROOMS });
    });

    it("Gemini の応答の使えない矩形は捨てて返す", async () => {
      fetchMock.mockImplementation(async () =>
        geminiResponse(
          JSON.stringify({ rooms: [...ROOMS, { name: "x", kind: "lava", box: [0, 0, 1, 1] }] }),
        ),
      );
      expect(await (await call(post(form()))).json()).toEqual({ rooms: ROOMS });
    });

    it("考えの途中（thought）の part は本文に混ぜない", async () => {
      fetchMock.mockImplementation(async () =>
        geminiResponse(JSON.stringify({ rooms: ROOMS }), [{ text: "考え中…", thought: true }]),
      );
      const response = await call(post(form()));
      expect(response.status).toBe(200);
    });

    it("応答に API キーを含めない", async () => {
      const text = await (await call(post(form()))).text();
      expect(text).not.toContain(KEY);
    });

    it.each(["1", "80"])("マス目の大きさ %s は受け付ける", async (size) => {
      const response = await call(post(form({ width: size, depth: size })));
      expect(response.status).toBe(200);
    });

    it("ちょうど 4 MB の画像は受け付ける", async () => {
      const response = await call(post(form({ image: png(MAX_FLOOR_DRAFT_IMAGE_BYTES) })));
      expect(response.status).toBe(200);
    });
  });

  describe("Gemini への要求", () => {
    const sent = (): { url: string; init: RequestInit; body: Record<string, unknown> } => {
      expect(fetchMock).toHaveBeenCalledTimes(1);
      const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
      return { url, init, body: JSON.parse(init.body as string) as Record<string, unknown> };
    };

    it("既定のモデルは gemini-3.5-flash", async () => {
      await call(post(form()));
      expect(sent().url).toBe(
        "https://generativelanguage.googleapis.com/v1beta/models/gemini-3.5-flash:generateContent",
      );
    });

    it("GEMINI_MODEL でモデルを変えられる", async () => {
      await call(post(form()), { ...ENV, GEMINI_MODEL: "gemini-x-pro" });
      expect(sent().url).toContain("/models/gemini-x-pro:generateContent");
    });

    it("GEMINI_MODEL が空文字なら既定のモデル", async () => {
      await call(post(form()), { ...ENV, GEMINI_MODEL: "" });
      expect(sent().url).toContain("/models/gemini-3.5-flash:generateContent");
    });

    it("API キーは URL ではなくヘッダーで渡す", async () => {
      await call(post(form()));
      const { url, init } = sent();
      expect(url).not.toContain(KEY);
      expect(new Headers(init.headers).get("x-goog-api-key")).toBe(KEY);
      expect(init.method).toBe("POST");
    });

    it("送られた画像を PNG のまま base64 で渡す（校舎のデータは送らない）", async () => {
      const image = png(100);
      await call(post(form({ image })));
      const { body } = sent();
      const contents = body.contents as { parts: Record<string, unknown>[] }[];
      const inline = contents[0].parts.find((p) => "inline_data" in p)?.inline_data as {
        mime_type: string;
        data: string;
      };
      expect(inline.mime_type).toBe("image/png");
      const expected = Buffer.from(await image.arrayBuffer()).toString("base64");
      expect(inline.data).toBe(expected);
    });

    it("JSON の構造化出力で矩形を求める", async () => {
      await call(post(form()));
      const config = sent().body.generationConfig as Record<string, unknown>;
      expect(config.responseMimeType).toBe("application/json");
      expect(config.responseSchema).toBeDefined();
    });
  });

  describe("要求の誤り", () => {
    it("API キーが無ければ 500 で，Gemini を呼ばない", async () => {
      await expectError(await call(post(form()), {}), 500);
      await expectError(await call(post(form()), { GEMINI_API_KEY: "" }), 500);
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it("multipart/form-data でなければ 400", async () => {
      const request = post(JSON.stringify({ width: 10 }), { "content-type": "application/json" });
      await expectError(await call(request), 400);
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it("本文の大きさ（content-length）が上限を大きく超えれば 413", async () => {
      const request = new Request("https://example.test/api/floor-draft", {
        method: "POST",
        headers: {
          "content-type": "multipart/form-data; boundary=x",
          "content-length": String(MAX_FLOOR_DRAFT_IMAGE_BYTES * 2),
        },
        body: "--x--",
      });
      await expectError(await call(request), 413);
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it.each<[string, Partial<Record<"width" | "depth", string | null>>]>([
      ["幅が 0", { width: "0" }],
      ["幅が 81", { width: "81" }],
      ["奥行きが 81", { depth: "81" }],
      ["幅が負", { width: "-1" }],
      ["幅が小数", { width: "1.5" }],
      ["幅が数でない", { width: "abc" }],
      ["幅が空", { width: "" }],
      ["幅が無い", { width: null }],
      ["奥行きが無い", { depth: null }],
      ["幅が 4 桁", { width: "0010" }],
    ])("%s なら 400", async (_, fields) => {
      await expectError(await call(post(form(fields))), 400);
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it("画像が無ければ 400", async () => {
      await expectError(await call(post(form({ image: null }))), 400);
    });

    it("画像の欄が文字列なら 400", async () => {
      await expectError(await call(post(form({ image: "data:image/png;base64,AAAA" }))), 400);
    });

    it("4 MB を超える画像は 413", async () => {
      await expectError(
        await call(post(form({ image: png(MAX_FLOOR_DRAFT_IMAGE_BYTES + 1) }))),
        413,
      );
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it.each<[string, Blob]>([
      ["JPEG", new Blob([new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 0, 0, 0, 0, 0])])],
      ["空", new Blob([])],
      ["PNG の先頭より短い", new Blob([new Uint8Array(PNG_SIGNATURE.slice(0, 4))])],
    ])("PNG でない画像（%s）は 400", async (_, image) => {
      await expectError(await call(post(form({ image }))), 400);
      expect(fetchMock).not.toHaveBeenCalled();
    });
  });

  describe("Gemini の失敗", () => {
    it("Gemini につながらなければ 502", async () => {
      fetchMock.mockImplementation(async () => {
        throw new TypeError("network");
      });
      await expectError(await call(post(form())), 502);
    });

    it("Gemini が 429 なら 429（混み合っている）", async () => {
      fetchMock.mockImplementation(async () => new Response("{}", { status: 429 }));
      await expectError(await call(post(form())), 429);
    });

    it.each([400, 403, 500, 503])("Gemini が %d なら 502", async (status) => {
      fetchMock.mockImplementation(async () => new Response("{}", { status }));
      await expectError(await call(post(form())), 502);
    });

    it.each<[string, () => Response]>([
      ["本文が JSON でない", () => geminiResponse("これは JSON ではありません")],
      ["rooms が無い", () => geminiResponse(JSON.stringify({ boxes: ROOMS }))],
      ["rooms が空", () => geminiResponse(JSON.stringify({ rooms: [] }))],
      ["候補が無い", () => new Response(JSON.stringify({ candidates: [] }), { status: 200 })],
      ["応答が JSON でない", () => new Response("oops", { status: 200 })],
      [
        "本文が考えの途中だけ",
        () =>
          new Response(
            JSON.stringify({
              candidates: [
                { content: { parts: [{ text: JSON.stringify({ rooms: ROOMS }), thought: true }] } },
              ],
            }),
            { status: 200 },
          ),
      ],
    ])("Gemini の応答が読めない（%s）なら 502", async (_, make) => {
      fetchMock.mockImplementation(async () => make());
      await expectError(await call(post(form())), 502);
    });

    it("失敗の応答にも API キーを含めない", async () => {
      fetchMock.mockImplementation(async () => new Response(`bad key ${KEY}`, { status: 500 }));
      const text = await (await call(post(form()))).text();
      expect(text).not.toContain(KEY);
    });
  });
});
