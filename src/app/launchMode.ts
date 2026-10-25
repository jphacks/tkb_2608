// 起動の経路を URL パラメータから決める（DOM に依存しない純粋な関数）
// - 既定（パラメータ無し・どれにも当たらない）: 教員用のホーム画面（本番でも使う．進む先は ?editor だけ）
// - ?app: 体験の流れ（開始画面 → ロビー → シナリオ → 結果）
// - ?debrief: 結果画面だけを，デモの校舎と手で作った記録で表示する（開発用．?app が優先）
// - ?audio: 避難の音（audio/）だけを鳴らして確かめる（開発用．?app・?debrief が優先）
// - ?editor: 教員用のエディタ（本番でも使う．?app・?debrief・?audio が優先）
// - ?monitor: 教員用の見守り画面（本番でも使う．?app・?debrief・?audio・?editor が優先）
// - ?viewer・?scene=・?input=: 空間のビューア（PC 確認用．上のどれも当たらない時．?scene=room 等の開発の URL をそのまま使える）

export type LaunchMode = "home" | "viewer" | "app" | "debrief" | "audio" | "editor" | "monitor";

export function resolveLaunchMode(search: string): LaunchMode {
  const params = new URLSearchParams(search);
  if (isOn(params.get("app"))) return "app";
  if (isOn(params.get("debrief"))) return "debrief";
  if (isOn(params.get("audio"))) return "audio";
  if (isOn(params.get("editor"))) return "editor";
  if (isOn(params.get("monitor"))) return "monitor";
  // ?scene=・?input= は値で空間・入力を選ぶため，値が 0・false でも付いていればビューアにする
  if (isOn(params.get("viewer")) || params.has("scene") || params.has("input")) return "viewer";
  return "home";
}

/** URL パラメータが付いていて，0・false（大文字小文字を問わない）でないか */
function isOn(value: string | null): boolean {
  return value !== null && value !== "0" && value.toLowerCase() !== "false";
}

/**
 * 左右 2 画面で描画するか．?stereo=1 / ?stereo=0 で指定でき，無ければタッチ主体の端末（スマホ）なら 2 画面
 */
export function resolveStereo(search: string, coarsePointer: boolean): boolean {
  const value = new URLSearchParams(search).get("stereo");
  if (value === "1" || value === "true") return true;
  if (value === "0" || value === "false") return false;
  return coarsePointer;
}

/**
 * デバッグ用の切り替え（?debug）．有効な時だけ，ロビーの開始ボタンの注視での開始と，
 * Enter / Space による手順の飛ばしを使える（本実装の開始は input/ の PlayerInput.hands の手だけ）
 */
export function resolveDebug(search: string): boolean {
  const value = new URLSearchParams(search).get("debug");
  return value !== null && value !== "0" && value.toLowerCase() !== "false";
}

/**
 * デモ用の起動（?app&demo）．開始画面の後，ホーム・ロビー・① 授業中の教室を飛ばし，
 * 付ける案内（カウントダウン）を挟んで ② 非常ベルと校内放送から訓練を始める（?app の時だけ意味を持つ）
 */
export function resolveDemo(search: string): boolean {
  return isOn(new URLSearchParams(search).get("demo"));
}
