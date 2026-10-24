// エディタの上から見た図の色と，道具箱に出すパーツの名前（データだけ）．
// マスの色は結果画面の地図（src/debrief/mapStyle.ts）と同じ値にそろえる（SPEC_01．関数・定数は共有せず，ここに書き写す）
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

/**
 * 教室ごとの塗りの色（教室の添字で順に使い，足りなければ最初に戻る）．
 * 結果画面の教室の色（#efe9da）を先頭にし，隣の教室と見分けられる淡い色を続ける
 */
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

/** 教室の添字の塗りの色 */
export function roomColor(room: number): string {
  const n = ROOM_COLORS.length;
  // 整数でない添字（NaN・Infinity）は先頭の色にする（剰余が NaN になり色が引けないため）
  if (!Number.isFinite(room)) return ROOM_COLORS[0];
  return ROOM_COLORS[((Math.trunc(room) % n) + n) % n];
}

/** 重ねる線・文字の色 */
export const EDITOR_COLORS = {
  /** 図の下地（void のマス・余白．結果画面の地図と同じ） */
  background: "#26303f",
  /** マスの境目 */
  grid: "rgba(16, 20, 28, 0.12)",
  /** void のマスの境目（暗い下地の上で見えるように明るくする） */
  voidGrid: "rgba(255, 255, 255, 0.08)",
  /** 薄い壁が立つ辺 */
  wall: "#10141c",
  /** 教室の名前 */
  label: "rgba(16, 20, 28, 0.7)",
  /** マウスの下のマスの縁 */
  hover: "rgba(47, 111, 224, 0.9)",
} as const;

/** 道具箱に出すパーツ（教室以外）の順番と名前 */
export const PART_TOOLS: readonly {
  readonly kind: Exclude<CellKind, "classroom">;
  readonly label: string;
}[] = [
  { kind: "corridor", label: "廊下" },
  { kind: "wall", label: "壁・柱" },
  { kind: "door", label: "ドア" },
  { kind: "exit", label: "出口（昇降口）" },
  { kind: "shutter", label: "防火シャッター" },
  { kind: "outdoor", label: "屋外（校庭）" },
  { kind: "void", label: "何もない（消す）" },
];

/** マスの種類の名前（マウスの下のマスの表示に使う） */
export const CELL_KIND_LABELS: Readonly<Record<CellKind, string>> = {
  void: "何もない",
  classroom: "教室",
  corridor: "廊下",
  wall: "壁・柱",
  door: "ドア",
  exit: "出口（昇降口）",
  shutter: "防火シャッター",
  outdoor: "屋外（校庭）",
};
