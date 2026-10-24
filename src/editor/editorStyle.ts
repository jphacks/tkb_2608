// エディタの上から見た図の色と，道具箱に出すパーツの名前（データだけ）．
// マスの色は結果画面の地図（src/debrief/mapStyle.ts）と同じ値にそろえる（SPEC_01．関数・定数は共有せず，ここに書き写す）
import type { CellKind, DrillMode } from "../core/schoolPlan";
import type { Facing, MarkerKind } from "./editorState";

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
  /** 印の縁取り（教室の淡い色・壁の暗い線のどちらの上でも形が分かるように白で縁取る） */
  markerOutline: "#ffffff",
  /** 火元の炎の外側・内側 */
  fire: "#e23b2e",
  fireCore: "#ffb020",
  /** 開始地点の人の印と向きの矢印 */
  start: "#1d4fd8",
  /** 集合場所の枠と旗 */
  assembly: "#18a34a",
  /**
   * 延焼のプレビューで火が着いているマスに重ねる色（結果画面の火元のマス（src/debrief/mapStyle.ts の fireOrigin）と同じ赤．
   * 下のマスの種類が透けるよう半透明）
   */
  spreadFire: "rgba(229, 57, 53, 0.55)",
  /** 延焼のプレビューで煙だけが着いているマスに重ねる色（結果画面の煙の帯（smokeStanding）と同じ灰色） */
  spreadSmoke: "rgba(70, 76, 90, 0.55)",
} as const;

/** 道具箱に出す訓練条件の道具の順番・名前・色見本 */
export const MARKER_TOOLS: readonly {
  readonly kind: MarkerKind;
  readonly label: string;
  readonly color: string;
}[] = [
  { kind: "fireOrigin", label: "火元", color: EDITOR_COLORS.fire },
  { kind: "start", label: "開始地点（教室）", color: EDITOR_COLORS.start },
  { kind: "assembly", label: "集合場所（屋外）", color: EDITOR_COLORS.assembly },
];

/** 訓練条件の印の名前（マウスの下のマスの表示に使う） */
export const MARKER_LABELS: Readonly<Record<MarkerKind, string>> = {
  fireOrigin: "火元",
  start: "開始地点",
  assembly: "集合場所",
};

/** 開始時の向きのボタンの文字（画面の上下左右） */
export const FACING_LABELS: Readonly<Record<Facing, string>> = {
  up: "↑ 上",
  right: "→ 右",
  down: "↓ 下",
  left: "← 左",
};

/** 訓練のモードの選び方（道具箱に出す順番・名前・説明） */
export const DRILL_MODES: readonly {
  readonly mode: DrillMode;
  readonly label: string;
  readonly hint: string;
}[] = [
  { mode: "learn", label: "学習", hint: "床に正解経路の矢印を出す" },
  { mode: "test", label: "テスト", hint: "正解経路を出さない" },
];

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
