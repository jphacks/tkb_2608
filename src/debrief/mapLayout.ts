// 結果画面の地図の座標の変換と縮尺の決め方（DOM・Canvas に依存しない純粋な関数）．
// 地図の座標は「マスの単位」で，マス (x, z) は u ∈ [x, x + 1)，v ∈ [z, z + 1) を占める（docs/04_SPEC/SPEC_02「座標」）

/** 地図の上の点（マスの単位．u は右（X）向き，v は下（Z）向き．マス (x, z) の中心は (x + 0.5, z + 0.5)） */
export interface MapPoint {
  readonly u: number;
  readonly v: number;
}

/** Canvas の上の点（CSS の px．左上が原点） */
export interface CanvasPoint {
  readonly x: number;
  readonly y: number;
}

/**
 * ワールド座標（m）を地図の座標（マスの単位）に変換する．
 * SPEC_02 ではマス (x, z) の中心がワールドの ((x + 0.5) * cellSize, (z + 0.5) * cellSize) なので，
 * ワールドの値を cellSize で割るとマスの単位になる（マスの左上の角がワールドの (x * cellSize, z * cellSize)）．
 * 座標が有限でない・cellSize が正でない時は null
 */
export function worldToMap(x: number, z: number, cellSize: number): MapPoint | null {
  if (!Number.isFinite(x) || !Number.isFinite(z)) return null;
  if (!Number.isFinite(cellSize) || cellSize <= 0) return null;
  return { u: x / cellSize, v: z / cellSize };
}

/** マスの中心の地図の座標 */
export function cellCenter(cell: { readonly x: number; readonly z: number }): MapPoint {
  return { u: cell.x + 0.5, v: cell.z + 0.5 };
}

/** 地図を Canvas に置く時の縮尺と位置 */
export interface MapLayout {
  /** 1 マスの大きさ（CSS の px）．描けない時は 0 */
  readonly cellPx: number;
  /** 地図の左上の角の位置（CSS の px） */
  readonly offsetX: number;
  readonly offsetY: number;
  /** 地図の幅と高さ（CSS の px） */
  readonly widthPx: number;
  readonly heightPx: number;
}

export interface MapFitOptions {
  /** 地図の周りの余白（CSS の px） */
  readonly paddingPx: number;
  /** 1 マスの大きさの上限（CSS の px．PC の広い画面で間延びしないため） */
  readonly maxCellPx: number;
}

/** 地図の縮尺の既定値．スマホの横向き（高さ 350 px 前後）でデモの校舎（奥行き 13 マス）が 1 マス 24 px 程度になる */
export const DEFAULT_MAP_FIT: MapFitOptions = { paddingPx: 8, maxCellPx: 40 };

/** Canvas の大きさと地図の縮尺 */
export interface MapCanvasFit {
  /** Canvas の CSS の幅と高さ（px．地図と余白がちょうど収まる大きさ） */
  readonly cssWidth: number;
  readonly cssHeight: number;
  readonly layout: MapLayout;
}

/**
 * 幅 widthCells × 奥行き depthCells の地図を，maxWidthPx × maxHeightPx の中に縦横比を保って最も大きく収める．
 * 1 マスの大きさは整数の px に切り捨てる（マスの境目がにじまないため．ただし 1 px より小さくはしない）．
 * マスの数・大きさが正の有限の数でない時は，1 マスを 0 px（描かない）にする
 */
export function fitMapCanvas(
  widthCells: number,
  depthCells: number,
  maxWidthPx: number,
  maxHeightPx: number,
  options: MapFitOptions = DEFAULT_MAP_FIT,
): MapCanvasFit {
  const padding = Math.max(0, options.paddingPx);
  const valid =
    isPositiveFinite(widthCells) &&
    isPositiveFinite(depthCells) &&
    isPositiveFinite(maxWidthPx) &&
    isPositiveFinite(maxHeightPx);
  if (!valid) {
    return {
      cssWidth: 0,
      cssHeight: 0,
      layout: { cellPx: 0, offsetX: padding, offsetY: padding, widthPx: 0, heightPx: 0 },
    };
  }
  const fit = Math.min(
    (maxWidthPx - 2 * padding) / widthCells,
    (maxHeightPx - 2 * padding) / depthCells,
  );
  const cellPx = Math.max(1, Math.min(options.maxCellPx, Math.floor(fit)));
  const widthPx = cellPx * widthCells;
  const heightPx = cellPx * depthCells;
  return {
    cssWidth: widthPx + 2 * padding,
    cssHeight: heightPx + 2 * padding,
    layout: { cellPx, offsetX: padding, offsetY: padding, widthPx, heightPx },
  };
}

/** 地図の座標を Canvas の座標（CSS の px）に変換する */
export function mapToCanvas(layout: MapLayout, point: MapPoint): CanvasPoint {
  return {
    x: layout.offsetX + point.u * layout.cellPx,
    y: layout.offsetY + point.v * layout.cellPx,
  };
}

function isPositiveFinite(value: number): boolean {
  return Number.isFinite(value) && value > 0;
}

/**
 * startYaw（rad．0 が -Z（地図の上）向き，右回りに増える．core/schoolPlan.ts の DrillSetup.startYaw）が向く
 * 地図の上の方向（u は右，v は下に増える．長さ 1）．エディタの開始地点の矢印と同じ約束．数でない時は null
 */
export function yawToMapDirection(yaw: number): MapPoint | null {
  if (!Number.isFinite(yaw)) return null;
  return { u: Math.sin(yaw), v: -Math.cos(yaw) };
}
