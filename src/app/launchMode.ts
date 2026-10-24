// 起動の経路を URL パラメータから決める（DOM に依存しない純粋な関数）
// - 既定: 空間のビューア（?scene=room 等．PC 確認用．従来どおり）
// - ?app: 体験の流れ（開始画面 → ロビー → シナリオ）

export type LaunchMode = "viewer" | "app";

export function resolveLaunchMode(search: string): LaunchMode {
  const value = new URLSearchParams(search).get("app");
  if (value === null || value === "0" || value.toLowerCase() === "false") return "viewer";
  return "app";
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
