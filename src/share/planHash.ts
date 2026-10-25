// URL のフラグメント（`#p=<埋め込みデータ>`）から，生徒の体験で使う校舎を決める（SPEC_01「起動の切り替え」・SPEC_02「URL と QR への埋め込み」）．
// location には触らず文字列を受け取る．app/ は起動時に結果を Session.plan・Session.planLoadError に書くだけにする
import type { PlanLoadError, SchoolPlan } from "../core/schoolPlan";
import { decodePlan } from "./planCodec";
import { DEMO_SCHOOL } from "./samples/demoSchool";

/** フラグメントの中で埋め込みデータを置く名前（`#p=<埋め込みデータ>`） */
export const PLAN_HASH_KEY = "p";

/** loadPlanFromHash の結果．Session の plan・planLoadError にそのまま書く */
export interface PlanFromHash {
  /** 使う校舎．読み込めなかった時は null */
  readonly plan: SchoolPlan | null;
  /** 読み込めなかった理由．読み込めた時と `#p=` が無い時は null */
  readonly planLoadError: PlanLoadError | null;
}

/**
 * フラグメント（`location.hash` の形．先頭の `#` はあっても無くてもよい）から校舎を決める．
 * - `#p=<埋め込みデータ>`: decodePlan の結果（失敗した時は plan を null にし，理由を planLoadError に入れる）
 * - `#p=`（中身が空）: QR の読み取りが途中で切れた等の壊れたデータとして失敗にする（decodePlan が corrupted を返す）
 * - `#p=` が無い（フラグメントが空・別の値だけ）: fallback（既定は同梱のデモの校舎．`&demo` の時は発表のデモ用の校舎を渡す）
 *
 * フラグメントは `a=1&p=...` のようにほかの値と並べてもよい（URLSearchParams で読む．base64url の `-`・`_` はそのまま通る）
 */
export async function loadPlanFromHash(
  hash: string,
  fallback: SchoolPlan = DEMO_SCHOOL,
): Promise<PlanFromHash> {
  const params = new URLSearchParams(hash.startsWith("#") ? hash.slice(1) : hash);
  const encoded = params.get(PLAN_HASH_KEY);
  if (encoded === null) return { plan: fallback, planLoadError: null };

  const decoded = await decodePlan(encoded);
  if (decoded.ok) return { plan: decoded.plan, planLoadError: null };
  return { plan: null, planLoadError: { kind: decoded.kind, reason: decoded.reason } };
}
