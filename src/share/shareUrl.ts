// 生徒用の URL（`<配信先>?app#p=<埋め込みデータ>`）を組み立てる（SPEC_02「URL と QR への埋め込み」「長さの上限」）．
// location には触らず，配信先（origin + pathname）を引数で受け取る．エディタは QR を出す前に createShareLink を呼ぶ
import type { SchoolPlan } from "../core/schoolPlan";
import { encodePlan } from "./planCodec";
import { PLAN_HASH_KEY } from "./planHash";
import { trimVoidMargins } from "./trimPlan";
import { validatePlan } from "./validatePlan";

/** URL 全体の長さの上限（文字）．PC の画面に出した QR をスマホのカメラで確実に読める密度の目安（SPEC_02） */
export const MAX_SHARE_URL_LENGTH = 1500;

/** URL を作れない時の理由の文 */
export const SHARE_LINK_REASONS = {
  tooLong: "校舎が大きすぎます．使わない部分を消してください",
} as const;

/** URL のフラグメントに載せる値．後から値を足す時（見守りの部屋の ID 等）はここに項目を足す */
export interface ShareFragment {
  /** 埋め込みデータ（encodePlan の出力．`#p=` の後ろ） */
  readonly plan: string;
}

/** createShareLink に渡す条件 */
export interface ShareLinkOptions {
  /** 配信先の URL（`location.origin + location.pathname` の形．`?` と `#` は含めない） */
  readonly baseUrl: string;
}

/** createShareLink の結果．作れない時は画面に出す理由（日本語の文）を並べる */
export type ShareLinkResult =
  | { readonly ok: true; readonly url: string }
  | { readonly ok: false; readonly reasons: readonly string[] };

/** 配信先とフラグメントの値から，生徒用の URL（`<baseUrl>?app#p=...`）を作る */
export function buildShareUrl(baseUrl: string, fragment: ShareFragment): string {
  const hash = new URLSearchParams({ [PLAN_HASH_KEY]: fragment.plan });
  return `${baseUrl}?app#${hash.toString()}`;
}

/**
 * 校舎から生徒用の URL を作る．validatePlan の誤りがある時と，URL 全体が MAX_SHARE_URL_LENGTH を超える時は作らない．
 * 誤りは編集中の校舎の座標で出したいので，切り詰める前の校舎で確かめる（切り詰めは位置を落とさないので結果は変わらない）
 */
export async function createShareLink(
  plan: SchoolPlan,
  options: ShareLinkOptions,
): Promise<ShareLinkResult> {
  const errors = validatePlan(plan);
  if (errors.length > 0) return { ok: false, reasons: errors };

  const encoded = await encodePlan(trimVoidMargins(plan));
  const url = buildShareUrl(options.baseUrl, { plan: encoded });
  if (url.length > MAX_SHARE_URL_LENGTH) {
    return {
      ok: false,
      reasons: [
        `${SHARE_LINK_REASONS.tooLong}（${url.length} 文字．${MAX_SHARE_URL_LENGTH} 文字まで）`,
      ],
    };
  }
  return { ok: true, url };
}
