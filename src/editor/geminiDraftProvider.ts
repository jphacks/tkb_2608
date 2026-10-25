// AI（Gemini．サーバー関数 functions/api/floor-draft.ts 経由）で配置の下書きを作る FloorDraftProvider（ES3）．
// API キーはサーバー関数が持ち，ブラウザは画像とマス目の大きさだけを送る．矩形 → マス目の変換は draftFromBoxes.ts で行う
import {
  FLOOR_DRAFT_API_PATH,
  FLOOR_DRAFT_FORM_FIELDS,
  MAX_FLOOR_DRAFT_IMAGE_BYTES,
  parseDraftBoxes,
} from "../core/floorDraftApi";
import type { FloorDraft, FloorDraftProvider } from "../core/schoolPlan";
import { draftFromBoxes } from "./draftFromBoxes";

/** 失敗した時に画面に出す理由 */
export const GEMINI_DRAFT_MESSAGES = {
  tooLarge:
    "画像が大きすぎて送れません（4 MB まで）．マス目を小さくするか，写真を選び直してください",
  rateLimited: "AI の利用が混み合っています．しばらく待ってからやり直してください",
  network: "サーバーにつながりませんでした．通信を確かめてやり直してください",
  badResponse: "AI の応答を読めませんでした．やり直してください",
  failed: (status: number) => `下書きを作れませんでした（${status}）．やり直してください`,
} as const;

/** fetch の代わりを渡せるようにする（既定は window.fetch） */
type FetchLike = (input: string, init: RequestInit) => Promise<Response>;

/** Gemini を使う下書きの仕組みを作る（endpoint は既定でアプリと同じ配信元の /api/floor-draft） */
export function createGeminiDraftProvider(
  endpoint: string = FLOOR_DRAFT_API_PATH,
  fetchImpl: FetchLike = (input, init) => fetch(input, init),
): FloorDraftProvider {
  return {
    label: "AI で下書きを作る",
    async createDraft({ image, width, depth }): Promise<FloorDraft> {
      if (image.size > MAX_FLOOR_DRAFT_IMAGE_BYTES) throw new Error(GEMINI_DRAFT_MESSAGES.tooLarge);
      const body = new FormData();
      body.append(FLOOR_DRAFT_FORM_FIELDS.image, image, "floor.png");
      body.append(FLOOR_DRAFT_FORM_FIELDS.width, String(width));
      body.append(FLOOR_DRAFT_FORM_FIELDS.depth, String(depth));
      let response: Response;
      try {
        response = await fetchImpl(endpoint, { method: "POST", body });
      } catch {
        throw new Error(GEMINI_DRAFT_MESSAGES.network);
      }
      const json: unknown = await response.json().catch(() => null);
      if (!response.ok) throw new Error(failureMessage(response.status, json));
      // サーバー関数でも確かめているが，受け取った側でも確かめ直す（形が違えば変換で壊れるため）
      const boxes = parseDraftBoxes(json);
      if (boxes === null) throw new Error(GEMINI_DRAFT_MESSAGES.badResponse);
      return draftFromBoxes(boxes, width, depth);
    },
  };
}

/** 失敗の応答の理由（429 は待つよう案内し，ほかはサーバー関数の理由があればそれを使う） */
function failureMessage(status: number, json: unknown): string {
  if (status === 429) return GEMINI_DRAFT_MESSAGES.rateLimited;
  if (status === 413) return GEMINI_DRAFT_MESSAGES.tooLarge;
  const error =
    typeof json === "object" && json !== null ? (json as { readonly error?: unknown }).error : null;
  return typeof error === "string" && error !== "" ? error : GEMINI_DRAFT_MESSAGES.failed(status);
}
