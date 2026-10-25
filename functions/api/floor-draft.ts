/**
 * 配置の下書き（ES3．SPEC_02「配置の下書き」）のサーバー関数（Cloudflare Pages Functions．`POST /api/floor-draft`）．
 *
 * - 受け取るもの: multipart/form-data（`image`: 切り出した PNG，`width`・`depth`: マス目の大きさ）．画像は 4 MB まで
 * - Gemini（`GEMINI_MODEL`．既定は gemini-flash-latest）に画像を渡し，部屋の矩形のリストを構造化出力で受け取る
 * - 返すもの: 検査済みの矩形のリスト（`FloorDraftApiResponse`）．マス目への変換はブラウザ側で行う
 *
 * API キー（`GEMINI_API_KEY`）はここにだけ置く．画像・キーはログに出さない．校舎のデータは受け取らない
 */

import {
  DRAFT_ROOM_KINDS,
  FLOOR_DRAFT_FORM_FIELDS,
  type FloorDraftApiError,
  type FloorDraftApiResponse,
  MAX_FLOOR_DRAFT_GRID_SIZE,
  MAX_FLOOR_DRAFT_IMAGE_BYTES,
  parseDraftBoxes,
} from "../../src/core/floorDraftApi";

interface Env {
  readonly GEMINI_API_KEY?: string;
  readonly GEMINI_MODEL?: string;
}

const DEFAULT_MODEL = "gemini-flash-latest";

/** Gemini の応答を待つ上限（ms） */
const GEMINI_TIMEOUT_MS = 90_000;

/** multipart の区切り等の分だけ，画像の上限より大きい本文を許す（byte） */
const FORM_OVERHEAD_BYTES = 64 * 1024;

/** PNG の先頭 8 byte */
const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

/** Gemini の構造化出力の形（rooms: { name, kind, box: [ymin, xmin, ymax, xmax] }[]） */
const RESPONSE_SCHEMA = {
  type: "OBJECT",
  properties: {
    rooms: {
      type: "ARRAY",
      items: {
        type: "OBJECT",
        properties: {
          name: { type: "STRING" },
          kind: { type: "STRING", enum: [...DRAFT_ROOM_KINDS] },
          box: { type: "ARRAY", items: { type: "INTEGER" }, minItems: 4, maxItems: 4 },
        },
        required: ["name", "kind", "box"],
        propertyOrdering: ["name", "kind", "box"],
      },
    },
  },
  required: ["rooms"],
} as const;

function buildPrompt(width: number, depth: number): string {
  return [
    "これは日本の小学校の校舎の 1 フロア分の平面図（見取り図）の画像です．",
    "図に描かれた区画を，次の種類に分けてすべて矩形で列挙してください．",
    "- room: 部屋（普通教室・特別教室・図書室・トイレ・職員室・保健室・倉庫・準備室など）",
    "- corridor: 廊下（ホール・昇降口の中・渡り廊下を含む）",
    "- outdoor: 屋外（校庭・中庭・屋上・ベランダなど）",
    "- stairs: 階段",
    "- elevator: エレベーター",
    "規則:",
    "- box は [ymin, xmin, ymax, xmax] で，画像全体を 0〜1000 とした整数の座標にする（左上が 0）",
    "- name は図に書かれた部屋名の文字をそのまま使う（例: 「3年1組」「理科室」）．読めない・書かれていなければ空文字にする．廊下・屋外は空文字でよい",
    "- 1 つの部屋は 1 つの矩形にする．L 字の廊下などは複数の矩形に分けてよい",
    "- 矩形どうしはなるべく隙間なく接するようにする（壁の厚みの分の隙間を空けない）．重ねるのは大部屋の中の小部屋だけにする",
    "- 図の外の余白・凡例・文字だけの欄は含めない",
    `- この画像は ${width} × ${depth} マスの方眼に対応している（1 マスは画像の幅の 1/${width}）．マスより細かい区画は気にしなくてよい`,
  ].join("\n");
}

function jsonResponse(status: number, body: FloorDraftApiResponse | FloorDraftApiError): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" },
  });
}

const errorResponse = (status: number, error: string): Response => jsonResponse(status, { error });

/** 1〜上限の整数の文字列ならその数，そうでなければ null */
function parseGridSize(value: string | File | null): number | null {
  if (typeof value !== "string" || !/^\d{1,3}$/.test(value)) return null;
  const n = Number(value);
  return n >= 1 && n <= MAX_FLOOR_DRAFT_GRID_SIZE ? n : null;
}

/** byte 列を base64 にする（Workers には Buffer が無いため，btoa に少しずつ渡す） */
function toBase64(bytes: Uint8Array): string {
  let binary = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}

/** Gemini の応答の本文（候補の最初の文章）．無ければ null */
function responseText(json: unknown): string | null {
  if (typeof json !== "object" || json === null) return null;
  const candidates = (json as { readonly candidates?: unknown }).candidates;
  if (!Array.isArray(candidates) || candidates.length === 0) return null;
  const parts = (candidates[0] as { readonly content?: { readonly parts?: unknown } })?.content
    ?.parts;
  if (!Array.isArray(parts)) return null;
  const text = parts
    .map((p) => (typeof p?.text === "string" && p.thought !== true ? p.text : ""))
    .join("");
  return text === "" ? null : text;
}

export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  const apiKey = env.GEMINI_API_KEY;
  if (apiKey === undefined || apiKey === "") {
    return errorResponse(500, "サーバーに API キーが設定されていません");
  }

  const length = Number(request.headers.get("content-length") ?? "0");
  if (length > MAX_FLOOR_DRAFT_IMAGE_BYTES + FORM_OVERHEAD_BYTES) {
    return errorResponse(413, "画像が大きすぎます（4 MB まで）");
  }
  if (!(request.headers.get("content-type") ?? "").startsWith("multipart/form-data")) {
    return errorResponse(400, "送る形が正しくありません（multipart/form-data で送ってください）");
  }

  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return errorResponse(400, "送られた内容を読めませんでした");
  }
  const width = parseGridSize(form.get(FLOOR_DRAFT_FORM_FIELDS.width));
  const depth = parseGridSize(form.get(FLOOR_DRAFT_FORM_FIELDS.depth));
  if (width === null || depth === null) {
    return errorResponse(
      400,
      `マス目の大きさが正しくありません（1〜${MAX_FLOOR_DRAFT_GRID_SIZE} マス）`,
    );
  }
  const image = form.get(FLOOR_DRAFT_FORM_FIELDS.image);
  if (image === null || typeof image === "string") {
    return errorResponse(400, "画像が送られていません");
  }
  if (image.size > MAX_FLOOR_DRAFT_IMAGE_BYTES) {
    return errorResponse(413, "画像が大きすぎます（4 MB まで）");
  }
  const bytes = new Uint8Array(await image.arrayBuffer());
  if (bytes.length < PNG_SIGNATURE.length || PNG_SIGNATURE.some((b, i) => bytes[i] !== b)) {
    return errorResponse(400, "画像は PNG で送ってください");
  }

  const model =
    env.GEMINI_MODEL !== undefined && env.GEMINI_MODEL !== "" ? env.GEMINI_MODEL : DEFAULT_MODEL;
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`;
  let geminiResponse: Response;
  try {
    geminiResponse = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json", "x-goog-api-key": apiKey },
      body: JSON.stringify({
        contents: [
          {
            role: "user",
            parts: [
              { inline_data: { mime_type: "image/png", data: toBase64(bytes) } },
              { text: buildPrompt(width, depth) },
            ],
          },
        ],
        generationConfig: {
          responseMimeType: "application/json",
          responseSchema: RESPONSE_SCHEMA,
          temperature: 0,
        },
      }),
      signal: AbortSignal.timeout(GEMINI_TIMEOUT_MS),
    });
  } catch {
    return errorResponse(502, "AI につながりませんでした．やり直してください");
  }
  if (geminiResponse.status === 429) {
    return errorResponse(429, "AI の利用が混み合っています．しばらく待ってからやり直してください");
  }
  if (!geminiResponse.ok) {
    return errorResponse(502, `AI が下書きを作れませんでした（${geminiResponse.status}）`);
  }

  const text = responseText(await geminiResponse.json().catch(() => null));
  let parsed: unknown = null;
  try {
    parsed = text === null ? null : JSON.parse(text);
  } catch {
    parsed = null;
  }
  const rooms = parseDraftBoxes(parsed);
  if (rooms === null) {
    return errorResponse(
      502,
      "AI の応答から部屋を読み取れませんでした．写真の位置合わせを確かめてやり直してください",
    );
  }
  return jsonResponse(200, { rooms });
};
