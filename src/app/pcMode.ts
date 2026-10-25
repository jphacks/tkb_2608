// PC モード（?app&pc．ゴーグル・センサー無しに PC のマウスとキーボードで体験する流れ）の判定・URL・文言・開始の向き
// （DOM・three.js に依存しない純粋な関数．Issue #205）．
// ?app&input=mock（入力だけを PC にした，スマホと同じ流れ．開発・自動検証でロビーの手順を確かめるのに使う）とは別に持つ
import type { CellRef } from "../core/schoolPlan";

/**
 * PC モードか（?pc．値が 0・false なら付けていない扱い）．PC モードの入力は常に PC のキーボード・マウス（mock）で，
 * センサーの許可・ゴーグルの案内・ロビーのキャリブレーションを飛ばす（mock はしきい値も手のカメラも使わないため）
 */
export function resolvePcMode(search: string): boolean {
  const value = new URLSearchParams(search).get("pc");
  return value !== null && value !== "0" && value.toLowerCase() !== "false";
}

/** トップ（パラメータ無しの教員用のホーム画面）の URL．PC モードの「トップへ」の行き先 */
export function buildTopHref(pathname: string): string {
  return pathname === "" ? "/" : pathname;
}

/** PC モードの操作の説明（開始画面・避難の画面の隅で使う．1 行ずつ） */
export const PC_CONTROLS_LINES: readonly string[] = [
  "W／↑: 歩く",
  "S／↓: ゆっくり歩く",
  "C: しゃがむ／立つ",
  "ドラッグ: 見回す",
];

/** PC モードの結果画面の「ホームへ」の文字（PC ではトップの画面へ戻る） */
export const PC_HOME_LABEL = "トップへ";

/**
 * 開始の向きの目印にする，正解経路の何マス先か．開始地点の隣のマスだけだと教室の中で横を向くことがあるため，少し先を見る
 */
export const ROUTE_FACING_LOOKAHEAD_CELLS = 3;

/**
 * 開始地点から正解経路の少し先のマスを向く向き（rad．0 で -Z，正で左へ回る．Space.startYaw と同じ約束）．
 * マスの中心どうしの向きなのでマスの大きさは要らない．開始地点と同じ階の，開始地点と違うマスのうち，
 * lookahead 番目（無ければ最後）を見る．向けるマスが無い・値が壊れている時は null（校舎データの開始の向きのまま）
 */
export function routeFacingYaw(
  start: CellRef,
  route: readonly CellRef[],
  lookahead: number = ROUTE_FACING_LOOKAHEAD_CELLS,
): number | null {
  const ahead = route.filter(
    (cell) =>
      cell.floor === start.floor &&
      Number.isFinite(cell.x) &&
      Number.isFinite(cell.z) &&
      (cell.x !== start.x || cell.z !== start.z),
  );
  if (ahead.length === 0 || !Number.isFinite(start.x) || !Number.isFinite(start.z)) return null;
  const index = Math.min(Math.max(0, Math.floor(lookahead) - 1), ahead.length - 1);
  const target = ahead[index];
  if (target === undefined) return null;
  const dx = target.x - start.x;
  const dz = target.z - start.z;
  // 向き yaw で前（-Z）を回すと (-sin yaw, -cos yaw) になるので，その逆を解く
  const yaw = Math.atan2(-dx, -dz);
  return yaw === 0 ? 0 : yaw;
}
