// 生徒用の URL（`<配信先>?app#p=<埋め込みデータ>&room=<部屋の ID>`）と見守り画面の URL を組み立てる（SPEC_02「URL と QR への埋め込み」「長さの上限」，SPEC_01「見守り」）．
// location には触らず，配信先（origin + pathname）を引数で受け取る．エディタは QR を出す前に createShareLink を呼ぶ
import type { SchoolPlan } from "../core/schoolPlan";
import { createPlanFingerprint, ROOM_HASH_KEY } from "./monitorIds";
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
  /** 見守りの部屋の ID（`&room=` の後ろ．`p=` の後ろに並べる）．無い時は `room=` を付けない */
  readonly room?: string;
}

/** createShareLink に渡す条件 */
export interface ShareLinkOptions {
  /** 配信先の URL（`location.origin + location.pathname` の形．`?` と `#` は含めない） */
  readonly baseUrl: string;
  /**
   * 校舎の指紋（planFingerprint）から部屋の ID を引く．渡した時は生徒用の URL に `room=` を入れ，見守り画面の URL も作る．
   * エディタは localStorage の組から引く（同じ校舎データの間は同じ ID）
   */
  readonly resolveRoomId?: (planFingerprint: string) => string;
}

/** createShareLink の結果．作れない時は画面に出す理由（日本語の文）を並べる */
export type ShareLinkResult =
  | {
      readonly ok: true;
      /** 生徒用の URL（QR に載せる） */
      readonly url: string;
      /** 見守り画面の URL（resolveRoomId を渡した時だけ．`url` の `?app` を `?monitor` に替えたもの） */
      readonly monitorUrl?: string;
    }
  | { readonly ok: false; readonly reasons: readonly string[] };

/** スマホからは開けない，自分の PC だけを指す host の名前（URL の hostname の形．IPv6 は角括弧つきも受ける） */
const LOOPBACK_HOSTS: ReadonlySet<string> = new Set(["localhost", "127.0.0.1", "[::1]", "::1"]);

/**
 * hostname（`location.hostname`・`URL#hostname` の値）が自分の PC だけを指す名前か（localhost・127.0.0.1・::1）．
 * その配信先で作った生徒用の URL はスマホから開けないため，エディタが注意を出すのに使う．大文字・小文字は区別しない
 */
export function isLoopbackHost(hostname: string): boolean {
  return LOOPBACK_HOSTS.has(hostname.toLowerCase());
}

/** フラグメント（先頭の `#` を除く）を組む．`p=` を先に，`room=` をその後ろに `&` でつなぐ */
function buildFragment(fragment: ShareFragment): string {
  const hash = new URLSearchParams({ [PLAN_HASH_KEY]: fragment.plan });
  if (fragment.room !== undefined) hash.append(ROOM_HASH_KEY, fragment.room);
  return hash.toString();
}

/** 配信先とフラグメントの値から，生徒用の URL（`<baseUrl>?app#p=...&room=...`）を作る */
export function buildShareUrl(baseUrl: string, fragment: ShareFragment): string {
  return `${baseUrl}?app#${buildFragment(fragment)}`;
}

/** 配信先とフラグメントの値から，見守り画面の URL（`<baseUrl>?monitor#p=...&room=...`）を作る．生徒用の URL とフラグメントは同じ */
export function buildMonitorUrl(baseUrl: string, fragment: ShareFragment): string {
  return `${baseUrl}?monitor#${buildFragment(fragment)}`;
}

/**
 * 校舎から生徒用の URL を作る．validatePlan の誤りがある時と，URL 全体（`room=` を含む）が MAX_SHARE_URL_LENGTH を超える時は作らない．
 * resolveRoomId を渡した時は，埋め込みデータの指紋で部屋の ID を引いて `room=` を入れ，見守り画面の URL も返す．
 * 誤りは編集中の校舎の座標で出したいので，切り詰める前の校舎で確かめる（切り詰めは位置を落とさないので結果は変わらない）
 */
export async function createShareLink(
  plan: SchoolPlan,
  options: ShareLinkOptions,
): Promise<ShareLinkResult> {
  const errors = validatePlan(plan);
  if (errors.length > 0) return { ok: false, reasons: errors };

  const encoded = await encodePlan(trimVoidMargins(plan));
  const fragment: ShareFragment =
    options.resolveRoomId === undefined
      ? { plan: encoded }
      : { plan: encoded, room: options.resolveRoomId(await createPlanFingerprint(encoded)) };
  const url = buildShareUrl(options.baseUrl, fragment);
  if (url.length > MAX_SHARE_URL_LENGTH) {
    return {
      ok: false,
      reasons: [
        `${SHARE_LINK_REASONS.tooLong}（${url.length} 文字．${MAX_SHARE_URL_LENGTH} 文字まで）`,
      ],
    };
  }
  if (fragment.room === undefined) return { ok: true, url };
  return { ok: true, url, monitorUrl: buildMonitorUrl(options.baseUrl, fragment) };
}
