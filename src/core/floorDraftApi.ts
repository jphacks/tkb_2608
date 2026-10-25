// 配置の下書き（ES3）のサーバー関数（functions/api/floor-draft.ts）とエディタの間で受け渡す形と，AI の出力の検査．
// ブラウザとサーバー関数（Cloudflare Pages Functions）の両方から import するため，DOM・Workers の API に依存しない

/** サーバー関数の住所（アプリと同じ配信元．ローカルでは Vite の server.proxy で wrangler pages dev へ流す） */
export const FLOOR_DRAFT_API_PATH = "/api/floor-draft";

/**
 * 要求は multipart/form-data．次の名前の欄を送る
 * - image: 切り出した画像（PNG）
 * - width・depth: マス目の大きさ（マス．10 進の整数の文字列）
 */
export const FLOOR_DRAFT_FORM_FIELDS = {
  image: "image",
  width: "width",
  depth: "depth",
} as const;

/** 送れる画像の大きさの上限（byte．4 MB） */
export const MAX_FLOOR_DRAFT_IMAGE_BYTES = 4 * 1024 * 1024;

/** マス目の幅・奥行きの上限（マス．エディタの MAX_GRID_SIZE と同じ値） */
export const MAX_FLOOR_DRAFT_GRID_SIZE = 80;

/** 正規化座標の上限（Gemini が物体の位置を返す標準の形．画像の左上が 0，右下が 1000） */
export const DRAFT_BOX_SCALE = 1000;

/** 部屋の名前の長さの上限（文字．長すぎる名前は切り詰める） */
export const MAX_DRAFT_ROOM_NAME_LENGTH = 40;

/** 1 回の応答で受け取る矩形の数の上限（マス目 80 × 80 に収まる数を大きく超える応答は捨てる） */
export const MAX_DRAFT_ROOMS = 400;

/** AI が見分ける部屋の種類 */
export const DRAFT_ROOM_KINDS = ["room", "corridor", "outdoor", "stairs", "elevator"] as const;

/** AI が見分ける部屋の種類（教室等・廊下・屋外・階段・エレベーター） */
export type DraftRoomKind = (typeof DRAFT_ROOM_KINDS)[number];

/** AI が読み取った部屋 1 つの矩形 */
export interface DraftRoomBox {
  /** 図の文字のままの部屋の名前（読めなければ空） */
  readonly name: string;
  readonly kind: DraftRoomKind;
  /** [ymin, xmin, ymax, xmax]．送った画像に対する 0〜1000 の正規化座標 */
  readonly box: readonly [number, number, number, number];
}

/** サーバー関数の成功時の応答（検査済みの矩形のリスト） */
export interface FloorDraftApiResponse {
  readonly rooms: readonly DraftRoomBox[];
}

/** サーバー関数の失敗時の応答（error は画面に出せる日本語の 1 文） */
export interface FloorDraftApiError {
  readonly error: string;
}

const isDraftRoomKind = (value: unknown): value is DraftRoomKind =>
  typeof value === "string" && (DRAFT_ROOM_KINDS as readonly string[]).includes(value);

const isBoxNumber = (value: unknown): value is number =>
  typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= DRAFT_BOX_SCALE;

/**
 * AI（またはサーバー関数）の出力を確かめ，使える矩形だけを返す．
 * rooms が配列でない時・使える矩形が 1 つも無い時は null．kind が知らない種類・box が 0〜1000 の 4 つの数でない要素は捨てる．
 * 名前が文字列でなければ空にし，長すぎれば切り詰める
 */
export function parseDraftBoxes(value: unknown): DraftRoomBox[] | null {
  if (typeof value !== "object" || value === null) return null;
  const rooms: unknown = (value as { readonly rooms?: unknown }).rooms;
  if (!Array.isArray(rooms)) return null;
  const result: DraftRoomBox[] = [];
  for (const item of rooms.slice(0, MAX_DRAFT_ROOMS)) {
    if (typeof item !== "object" || item === null) continue;
    const { name, kind, box } = item as {
      readonly name?: unknown;
      readonly kind?: unknown;
      readonly box?: unknown;
    };
    if (!isDraftRoomKind(kind)) continue;
    if (!Array.isArray(box) || box.length !== 4 || !box.every(isBoxNumber)) continue;
    result.push({
      name: typeof name === "string" ? name.trim().slice(0, MAX_DRAFT_ROOM_NAME_LENGTH) : "",
      kind,
      box: [box[0], box[1], box[2], box[3]],
    });
  }
  return result.length > 0 ? result : null;
}
