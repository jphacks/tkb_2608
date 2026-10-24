// 結果画面の地図の色と凡例（データだけ）．正解経路は緑・自分の経路は青・外れた区間は橙・火に近づいた点は赤（SPEC_01「結果の評価」）．
// マスの色はエディタ（src/editor/．まだ無い）ができたらそちらに見た目をそろえる（関数は共有しない）
import type { CellKind } from "../core/schoolPlan";

/** マスの種類ごとの塗りの色（void は塗らない） */
export const CELL_COLORS: Readonly<Record<CellKind, string | null>> = {
  void: null,
  classroom: "#efe9da",
  corridor: "#cfd6df",
  wall: "#3b4252",
  door: "#b08850",
  exit: "#f2c94c",
  shutter: "#7a5cc0",
  outdoor: "#c9b68e",
};

/** 重ねる線・印の色 */
export const OVERLAY_COLORS = {
  /** 正解経路 */
  correctRoute: "#21a95a",
  /** 自分の経路 */
  ownPath: "#2f6fe0",
  /** 外れた区間 */
  offRoute: "#ff8a1f",
  /** 火に近づいた点 */
  nearFire: "#e53935",
  /** 煙の中で立っていた区間（煙の色の灰色の太い帯．自分の経路の下に敷く） */
  smokeStanding: "rgba(70, 76, 90, 0.55)",
  /** 火元のマス */
  fireOrigin: "rgba(229, 57, 53, 0.45)",
  /** 集合場所のマスの縁 */
  assembly: "#21a95a",
  /** 開始地点の印 */
  start: "#10141c",
  /** マスの境目 */
  grid: "rgba(16, 20, 28, 0.12)",
  /** 教室の名前 */
  label: "rgba(16, 20, 28, 0.6)",
  /** 地図の下地（void のマス・余白） */
  background: "#26303f",
} as const;

/** 凡例の印の形 */
export type LegendShape = "line" | "band" | "dot" | "cell" | "ring" | "frame";

export interface LegendItem {
  readonly label: string;
  readonly color: string;
  readonly shape: LegendShape;
}

/** 凡例（地図の下に出す順） */
export const MAP_LEGEND: readonly LegendItem[] = [
  { label: "正解経路", color: OVERLAY_COLORS.correctRoute, shape: "line" },
  { label: "自分の経路", color: OVERLAY_COLORS.ownPath, shape: "line" },
  { label: "外れた所", color: OVERLAY_COLORS.offRoute, shape: "line" },
  { label: "煙の中で立っていた所", color: OVERLAY_COLORS.smokeStanding, shape: "band" },
  { label: "火に近づいた所", color: OVERLAY_COLORS.nearFire, shape: "dot" },
  { label: "火元", color: OVERLAY_COLORS.fireOrigin, shape: "cell" },
  { label: "スタート", color: OVERLAY_COLORS.start, shape: "ring" },
  { label: "集合場所", color: OVERLAY_COLORS.assembly, shape: "frame" },
];
