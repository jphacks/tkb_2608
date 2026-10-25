// 結果画面の地図の色と凡例（データと色の選び方）．正解経路は緑・自分の経路は青・外れた区間は橙・火に近づいた点は赤（SPEC_01「結果の評価」）．
// マス・教室・壁・訓練条件の印の色はエディタ（src/editor/editorStyle.ts）にそろえる（SPEC_01．関数・定数は共有せず，ここに書き写す）
import type { CellKind } from "../core/schoolPlan";

/** マスの種類ごとの塗りの色（void は塗らず下地のまま．教室は ROOM_COLORS で教室ごとに分ける） */
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

/** 教室ごとの塗りの色（教室の添字で順に使い，足りなければ最初に戻る．エディタと同じ並び） */
export const ROOM_COLORS: readonly string[] = [
  "#efe9da",
  "#dcebd5",
  "#f3dcd9",
  "#d8e4f2",
  "#efe2bf",
  "#e5d9ef",
  "#d3ece9",
  "#f2d9e6",
];

/** 教室の添字の塗りの色（整数でない添字は先頭の色．負の添字も剰余で表の中に収める） */
export function roomColor(room: number): string {
  const n = ROOM_COLORS.length;
  // NaN・Infinity は剰余が NaN になり色が引けないため先頭の色にする
  if (!Number.isFinite(room)) return ROOM_COLORS[0];
  return ROOM_COLORS[((Math.trunc(room) % n) + n) % n];
}

/** マスの塗りの色（教室は教室ごとの色，void は null で塗らない） */
export function cellFillColor(kind: CellKind, room: number): string | null {
  if (kind === "classroom") return roomColor(room);
  return CELL_COLORS[kind] ?? null;
}

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
  /** 火元の炎の印の外側（エディタと同じ） */
  fire: "#e23b2e",
  /** 火元の炎の印の内側（エディタと同じ） */
  fireCore: "#ffb020",
  /** 集合場所の枠と旗（エディタと同じ） */
  assembly: "#18a34a",
  /** 開始地点の人の印と向きの矢印（エディタと同じ） */
  start: "#1d4fd8",
  /** 印の縁取り（教室の淡い色・壁の暗い線・経路の線のどの上でも形が分かるように白で縁取る） */
  markerOutline: "#ffffff",
  /** 薄い壁が立つ辺 */
  wall: "#10141c",
  /** マスの境目 */
  grid: "rgba(16, 20, 28, 0.12)",
  /** void のマスの境目（暗い下地の上で見えるように明るくする） */
  voidGrid: "rgba(255, 255, 255, 0.08)",
  /** 教室の名前 */
  label: "rgba(16, 20, 28, 0.7)",
  /** 地図の下地（void のマス・余白） */
  background: "#26303f",
} as const;

/** 凡例の印の形（flame は炎のしずく形，person は人の印の丸） */
export type LegendShape = "line" | "band" | "dot" | "flame" | "person" | "frame";

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
  { label: "火元", color: OVERLAY_COLORS.fire, shape: "flame" },
  { label: "スタート", color: OVERLAY_COLORS.start, shape: "person" },
  { label: "集合場所", color: OVERLAY_COLORS.assembly, shape: "frame" },
];
