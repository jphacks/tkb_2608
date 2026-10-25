// URL に校舎データ（#p=）が無い時に使う既定の校舎（DOM に依存しない）．
// 体験（?app・?app&pc・?app&demo・?app&input=mock 等の ?app 系すべて）と見守り（?monitor 系）が同じ校舎を使う．
// トップの入口（「PC で体験する」?app&pc・「スマホ＋VR ゴーグルで体験する」?app）から入った審査員が，
// 開始直後に隣の理科室が燃えているとわかり，防火シャッターのくぐり戸を通る場面を体験できるよう，発表のデモ用の校舎にする．
// 見守り画面と生徒の端末は #p= が無い時の校舎の指紋がどちらも "demo" で見分けられないため，同じ校舎を返す必要がある
import type { SchoolPlan } from "../core/schoolPlan";
import { DEMO_PITCH_SCHOOL } from "../share/samples/demoPitchSchool";

/** #p= が無い時の既定の校舎（?app 系・?monitor 系で共通．?demo の有無で変えない） */
export const FALLBACK_PLAN: SchoolPlan = DEMO_PITCH_SCHOOL;
