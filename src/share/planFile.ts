// 校舎（SchoolPlan）を人が読める JSON の文字列にして，ファイル（書き出し・読み込み）と localStorage に保存する形式．
// 中身は URL の埋め込みデータを圧縮する前の JSON と同じ形（planCodec.ts の planToJson）で，読み戻しも同じ検査（planFromJson）を通す
import type { SchoolPlan } from "../core/schoolPlan";
import { type PlanJsonResult, planFromJson, planToJson } from "./planCodec";

/** 書き出すファイルの拡張子 */
export const PLAN_FILE_EXTENSION = ".json";

/** 書き出すファイルの MIME タイプ */
export const PLAN_FILE_MIME = "application/json";

/**
 * 読み込む文字列の長さの上限（文字）．80×80 マスの校舎でも数十 KB に収まるため，これを超えるものは校舎のファイルではないとみなし，
 * 読み込む前に打ち切る（URL の埋め込みデータの展開後の上限と同じ 1 MiB）
 */
export const MAX_PLAN_TEXT_LENGTH = 1024 * 1024;

/** 学校名が空・使えない文字だけの時のファイル名（拡張子を除く） */
const FALLBACK_FILE_NAME = "校舎";

/** ファイル名（拡張子を除く）の長さの上限（文字）．OS のファイル名の上限（255 バイト程度）に収める */
const MAX_FILE_NAME_LENGTH = 60;

/** Windows・macOS でファイル名に使えない文字（このほか制御文字も使えない） */
const UNSAFE_FILE_NAME_CHARS: ReadonlySet<string> = new Set([
  "\\",
  "/",
  ":",
  "*",
  "?",
  '"',
  "<",
  ">",
  "|",
]);

/** ファイル名に使えない文字（UNSAFE_FILE_NAME_CHARS と制御文字）か */
function isUnsafeFileNameChar(ch: string): boolean {
  const code = ch.codePointAt(0) ?? 0;
  return UNSAFE_FILE_NAME_CHARS.has(ch) || code < 0x20 || code === 0x7f;
}

/** Windows で予約されているファイル名（拡張子を付けても使えない） */
const RESERVED_FILE_NAME = /^(con|prn|aux|nul|com[0-9]|lpt[0-9])$/iu;

/**
 * 読み込みの失敗の理由の文（形・版・中身の理由は planFromJson の reason を使う）．
 * ファイルと localStorage の両方で出すので，「ファイル」とは書かない
 */
export const PLAN_FILE_REASONS = {
  tooLarge: "データが大きすぎます",
  notJson: "データの中身を JSON として読み取れません",
} as const;

/** 校舎の書き方．pretty はファイル用（字下げして人が読める形），省くと localStorage 用（1 行に詰める） */
export interface SerializePlanOptions {
  readonly pretty?: boolean;
}

/** 校舎を保存用の JSON の文字列にする．中身は確かめない（誤りのある編集の途中も保存する） */
export function serializePlan(plan: SchoolPlan, options: SerializePlanOptions = {}): string {
  const text = JSON.stringify(planToJson(plan), null, options.pretty === true ? 2 : undefined);
  return options.pretty === true ? `${text}\n` : text;
}

/**
 * serializePlan の文字列を校舎に戻す．例外は投げず，形・版・中身の検査は planFromJson と同じ結果を返す
 * （invalidPlan の時も校舎を持つので，エディタは誤りのある校舎を開ける）
 */
export function parsePlanText(text: string): PlanJsonResult {
  if (text.length > MAX_PLAN_TEXT_LENGTH) {
    return { ok: false, kind: "corrupted", reason: PLAN_FILE_REASONS.tooLarge };
  }
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    return { ok: false, kind: "corrupted", reason: PLAN_FILE_REASONS.notJson };
  }
  return planFromJson(json);
}

/**
 * 学校名から書き出すファイルの名前（拡張子つき）を作る．ファイル名に使えない文字は「_」に置き換え，
 * 前後の空白と末尾の「.」を除く．空になった時は「校舎」にする
 */
export function planFileName(name: string): string {
  const replaced = Array.from(name, (ch) => (isUnsafeFileNameChar(ch) ? "_" : ch))
    .join("")
    .replace(/\s+/gu, " ")
    .trim();
  // 文字の途中（サロゲートペアの片方）で切らないよう，コードポイントで数える
  const shortened = Array.from(replaced).slice(0, MAX_FILE_NAME_LENGTH).join("");
  // Windows は末尾の「.」と空白を捨てるため，残すと別の名前になる
  const trimmed = shortened.replace(/[.\s]+$/u, "");
  const base = trimmed === "" ? FALLBACK_FILE_NAME : trimmed;
  return `${RESERVED_FILE_NAME.test(base) ? `${base}_` : base}${PLAN_FILE_EXTENSION}`;
}
