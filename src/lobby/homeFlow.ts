// 画面の切り替えの頼み（goTo）を，許可の画面を 1 回だけにする方針で読み替える（DOM に依存しない純粋な関数）
//
// 方針（Issue #40）
// - 許可の画面（start）は起動直後の 1 回だけ．許可と音の再生の解除は再読み込みまで有効なため，取り直さない
// - 許可を取り終えた後に start が頼まれた時は，ホーム（home）へ読み替える
//   （取得済みのカメラの映像・AudioContext を保ったまま，ホームから始め直す）

import type { SceneId } from "../core/scene";

/** 許可を取り終えた後に，許可の画面の代わりに出す画面 */
export const AFTER_PERMISSIONS_SCENE: SceneId = "home";

/**
 * 頼まれた画面を，実際に出す画面に読み替える．
 * permissionsDone は，許可の画面で許可を取り終えた（取れた機器を受け取った）か
 */
export function resolveSceneRequest(requested: SceneId, permissionsDone: boolean): SceneId {
  if (requested === "start" && permissionsDone) return AFTER_PERMISSIONS_SCENE;
  return requested;
}
