// AI で下書きを作る仕組み（createGeminiDraftProvider）のテスト．fetch を差し替え，実際の通信はしない．
// 基準は docs/04_SPEC/SPEC_02「配置の下書き」（FloorDraftProvider・送るのは画像とマス目の大きさだけ）と，PR #168 で決めたこと
// （multipart/form-data の image・width・depth．画像は 4 MB まで．応答は矩形のリストで，ブラウザがマス目に変換する）
import { describe, expect, it, vi } from "vitest";
import {
  FLOOR_DRAFT_API_PATH,
  FLOOR_DRAFT_FORM_FIELDS,
  MAX_FLOOR_DRAFT_IMAGE_BYTES,
} from "../core/floorDraftApi";
import { draftFromBoxes } from "./draftFromBoxes";
import { draftRejection } from "./editorState";
import { createGeminiDraftProvider, GEMINI_DRAFT_MESSAGES } from "./geminiDraftProvider";

const ROOMS = [
  { name: "1年1組", kind: "room", box: [0, 0, 500, 1000] },
  { name: "", kind: "corridor", box: [500, 0, 1000, 1000] },
] as const;

const jsonResponse = (status: number, body: unknown): Response =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });

/** 決まった応答を返す fetch の代わり（呼ばれた引数を覚える） */
const fakeFetch = (response: Response | (() => Promise<Response>)) =>
  vi.fn(async (_input: string, _init: RequestInit) =>
    typeof response === "function" ? response() : response,
  );

const png = (bytes = 16): Blob => new Blob([new Uint8Array(bytes)], { type: "image/png" });

const request = (overrides: Partial<{ image: Blob; width: number; depth: number }> = {}) => ({
  image: png(),
  width: 6,
  depth: 4,
  ...overrides,
});

describe("createGeminiDraftProvider", () => {
  it("ボタンの名前は「AI で下書きを作る」", () => {
    expect(createGeminiDraftProvider(undefined, fakeFetch(jsonResponse(200, {}))).label).toBe(
      "AI で下書きを作る",
    );
  });

  it("既定では /api/floor-draft に POST する", async () => {
    const fetchImpl = fakeFetch(jsonResponse(200, { rooms: ROOMS }));
    await createGeminiDraftProvider(undefined, fetchImpl).createDraft(request());
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const [url, init] = fetchImpl.mock.calls[0];
    expect(url).toBe(FLOOR_DRAFT_API_PATH);
    expect(FLOOR_DRAFT_API_PATH).toBe("/api/floor-draft");
    expect(init.method).toBe("POST");
  });

  it("渡した住所に送る", async () => {
    const fetchImpl = fakeFetch(jsonResponse(200, { rooms: ROOMS }));
    await createGeminiDraftProvider("https://example.test/x", fetchImpl).createDraft(request());
    expect(fetchImpl.mock.calls[0][0]).toBe("https://example.test/x");
  });

  it("画像・幅・奥行きだけを multipart/form-data（FormData）で送る", async () => {
    const fetchImpl = fakeFetch(jsonResponse(200, { rooms: ROOMS }));
    const image = png(32);
    await createGeminiDraftProvider(undefined, fetchImpl).createDraft(
      request({ image, width: 12, depth: 7 }),
    );
    const body = fetchImpl.mock.calls[0][1].body;
    expect(body).toBeInstanceOf(FormData);
    const form = body as FormData;
    expect([...form.keys()].sort()).toEqual(
      [
        FLOOR_DRAFT_FORM_FIELDS.image,
        FLOOR_DRAFT_FORM_FIELDS.width,
        FLOOR_DRAFT_FORM_FIELDS.depth,
      ].sort(),
    );
    expect(FLOOR_DRAFT_FORM_FIELDS).toEqual({ image: "image", width: "width", depth: "depth" });
    expect(form.get("width")).toBe("12");
    expect(form.get("depth")).toBe("7");
    const sent = form.get("image");
    expect(sent).toBeInstanceOf(Blob);
    expect((sent as Blob).size).toBe(32);
  });

  it("応答の矩形をマス目の下書きにして返す（当てられる形）", async () => {
    const fetchImpl = fakeFetch(jsonResponse(200, { rooms: ROOMS }));
    const result = await createGeminiDraftProvider(undefined, fetchImpl).createDraft(request());
    expect(result.width).toBe(6);
    expect(result.depth).toBe(4);
    expect(result).toEqual(
      draftFromBoxes(
        [...ROOMS].map((r) => ({ ...r, box: [...r.box] as [number, number, number, number] })),
        6,
        4,
      ),
    );
    expect(draftRejection(result)).toBeNull();
    expect(result.rooms).toEqual([{ name: "1年1組" }]);
  });

  it("応答の使えない矩形は捨てて変換する", async () => {
    const fetchImpl = fakeFetch(
      jsonResponse(200, { rooms: [...ROOMS, { name: "x", kind: "lava", box: [0, 0, 1, 1] }] }),
    );
    const result = await createGeminiDraftProvider(undefined, fetchImpl).createDraft(request());
    expect(draftRejection(result)).toBeNull();
  });

  it("4 MB を超える画像は送らずに失敗する", async () => {
    const fetchImpl = fakeFetch(jsonResponse(200, { rooms: ROOMS }));
    const provider = createGeminiDraftProvider(undefined, fetchImpl);
    await expect(
      provider.createDraft(request({ image: png(MAX_FLOOR_DRAFT_IMAGE_BYTES + 1) })),
    ).rejects.toThrow(GEMINI_DRAFT_MESSAGES.tooLarge);
    expect(fetchImpl).not.toHaveBeenCalled();
    expect(MAX_FLOOR_DRAFT_IMAGE_BYTES).toBe(4 * 1024 * 1024);
  });

  it("ちょうど 4 MB の画像は送る", async () => {
    const fetchImpl = fakeFetch(jsonResponse(200, { rooms: ROOMS }));
    await createGeminiDraftProvider(undefined, fetchImpl).createDraft(
      request({ image: png(MAX_FLOOR_DRAFT_IMAGE_BYTES) }),
    );
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("通信に失敗したらつながらなかった理由で失敗する", async () => {
    const fetchImpl = vi.fn(async (_input: string, _init: RequestInit): Promise<Response> => {
      throw new TypeError("Failed to fetch");
    });
    await expect(
      createGeminiDraftProvider(undefined, fetchImpl).createDraft(request()),
    ).rejects.toThrow(GEMINI_DRAFT_MESSAGES.network);
  });

  it.each<[number, unknown, string]>([
    [429, { error: "混んでいる" }, GEMINI_DRAFT_MESSAGES.rateLimited],
    [413, { error: "大きい" }, GEMINI_DRAFT_MESSAGES.tooLarge],
    [400, { error: "マス目の大きさが正しくありません" }, "マス目の大きさが正しくありません"],
    [502, { error: "AI につながりませんでした" }, "AI につながりませんでした"],
    [500, { error: "" }, GEMINI_DRAFT_MESSAGES.failed(500)],
    [500, { message: "x" }, GEMINI_DRAFT_MESSAGES.failed(500)],
    [503, null, GEMINI_DRAFT_MESSAGES.failed(503)],
  ])("%d の応答（%j）なら理由を付けて失敗する", async (status, body, message) => {
    const fetchImpl = fakeFetch(jsonResponse(status, body));
    await expect(
      createGeminiDraftProvider(undefined, fetchImpl).createDraft(request()),
    ).rejects.toThrow(message);
  });

  it("失敗の応答が JSON でなくても状態の番号で失敗する", async () => {
    const fetchImpl = fakeFetch(new Response("<html>Bad Gateway</html>", { status: 502 }));
    await expect(
      createGeminiDraftProvider(undefined, fetchImpl).createDraft(request()),
    ).rejects.toThrow(GEMINI_DRAFT_MESSAGES.failed(502));
  });

  it.each<[string, () => Response]>([
    ["JSON でない", () => new Response("not json", { status: 200 })],
    ["rooms が無い", () => jsonResponse(200, { error: "x" })],
    ["rooms が空", () => jsonResponse(200, { rooms: [] })],
    ["使える矩形が無い", () => jsonResponse(200, { rooms: [{ kind: "room", box: [0, 0] }] })],
  ])("成功の応答が%sなら読めなかった理由で失敗する", async (_, make) => {
    const fetchImpl = fakeFetch(make());
    await expect(
      createGeminiDraftProvider(undefined, fetchImpl).createDraft(request()),
    ).rejects.toThrow(GEMINI_DRAFT_MESSAGES.badResponse);
  });
});
