// 図面の写真の下敷き（E1）の位置合わせの計算．「マス目の座標 ↔ 写真の画素」の変換（平行移動・回転・拡大）と，
// 合わせる操作（移動・縮尺・回転）・前回の位置の読み書きの形・マス目の範囲の切り出し（ES3 用）を純粋な関数で持つ．
// 描画（editorCanvas.ts）・ドラッグ（editor.ts）・切り出し（underlayPanel.ts）が同じ関数を使う
import type { PlanStorageLike } from "./planStorage";

/**
 * マス目の座標（マス．x が右，z が下．マス (x, z) の左上の角が (x, z)，中心が (x + 0.5, z + 0.5)）．
 * マスの添字と違い，整数でない値も使う
 */
export interface GridPoint {
  readonly x: number;
  readonly z: number;
}

/** 写真の画素の位置（px．u が右，v が下．写真の左上が (0, 0)） */
export interface ImagePoint {
  readonly u: number;
  readonly v: number;
}

/** 写真の大きさ（px） */
export interface ImageSize {
  readonly width: number;
  readonly height: number;
}

/** マス目の大きさ（マス） */
export interface GridSize {
  readonly width: number;
  readonly depth: number;
}

/**
 * 下敷きの写真をマス目のどこに敷くか．マス目の座標で持つので，画面の拡大縮小・マス目の大きさの変更でずれない．
 * 写真の解像度にもよらない（幅をマスで持つため，縮小して描いても同じ位置に重なる）
 */
export interface UnderlayPlacement {
  /** 写真の中心のマス目の座標（マス） */
  readonly centerX: number;
  readonly centerZ: number;
  /** 写真の幅（マス．縮尺．高さは写真の縦横比で決まる） */
  readonly widthCells: number;
  /** 回転（度．画面で時計回りが正．(-180, 180] にそろえる） */
  readonly rotationDeg: number;
}

/** 2 次元の変換 (u, v) → (a u + c v + e, b u + d v + f)．並びは CanvasRenderingContext2D.transform の引数と同じ */
export interface AffineMatrix {
  readonly a: number;
  readonly b: number;
  readonly c: number;
  readonly d: number;
  readonly e: number;
  readonly f: number;
}

/** 写真の幅の下限・上限（マス．小さすぎて見失う・大きすぎて画面に収まらないのを防ぐ） */
export const MIN_UNDERLAY_WIDTH_CELLS = 1;
export const MAX_UNDERLAY_WIDTH_CELLS = 1000;

/** 写真の中心がマス目から離れてよい範囲（マス．数値の打ち間違いで見失わないように） */
export const MAX_UNDERLAY_CENTER_OFFSET = 1000;

/** 不透明度（図面の線の濃さ）の既定値（0〜1．線がはっきり見え，塗りの色も分かる値） */
export const DEFAULT_UNDERLAY_OPACITY = 0.8;

/** 前回の位置を覚える localStorage のキー（写真そのものは保存しない） */
export const UNDERLAY_STORAGE_KEY = "tkb2608.editor.underlay";

/** 切り出す画像の長い辺の上限（px．ES3 で AI に渡す画像が大きくなりすぎないように） */
export const MAX_CROP_SIDE_PX = 2048;

/** 回転を (-180, 180] の度にそろえる．数でない時は 0 */
export function normalizeDegrees(deg: number): number {
  if (!Number.isFinite(deg)) return 0;
  const r = deg % 360;
  if (r > 180) return r - 360;
  if (r <= -180) return r + 360;
  // -0 を 0 にする（表示に「-0」が出ないように）
  return r === 0 ? 0 : r;
}

/** 写真の画素 → マス目の座標の変換 */
export function underlayMatrix(placement: UnderlayPlacement, size: ImageSize): AffineMatrix {
  const s = placement.widthCells / size.width;
  const rad = (placement.rotationDeg * Math.PI) / 180;
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);
  const a = s * cos;
  const b = s * sin;
  const c = -s * sin;
  const d = s * cos;
  const hw = size.width / 2;
  const hh = size.height / 2;
  return {
    a,
    b,
    c,
    d,
    e: placement.centerX - a * hw - c * hh,
    f: placement.centerZ - b * hw - d * hh,
  };
}

/** 写真の画素の位置が重なるマス目の座標 */
export function imageToGrid(
  placement: UnderlayPlacement,
  size: ImageSize,
  point: ImagePoint,
): GridPoint {
  const m = underlayMatrix(placement, size);
  return { x: m.a * point.u + m.c * point.v + m.e, z: m.b * point.u + m.d * point.v + m.f };
}

/** マス目の座標に重なる写真の画素の位置（写真の外も含めて求める） */
export function gridToImage(
  placement: UnderlayPlacement,
  size: ImageSize,
  point: GridPoint,
): ImagePoint {
  const s = placement.widthCells / size.width;
  const rad = (placement.rotationDeg * Math.PI) / 180;
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);
  const dx = point.x - placement.centerX;
  const dz = point.z - placement.centerZ;
  return {
    u: size.width / 2 + (cos * dx + sin * dz) / s,
    v: size.height / 2 + (-sin * dx + cos * dz) / s,
  };
}

/** Canvas の位置（CSS の px）をマス目の座標にする（マスの添字に丸めない．マス目の外も求める） */
export function canvasToGridPoint(
  layout: { readonly cellPx: number; readonly offsetX: number; readonly offsetY: number },
  px: number,
  py: number,
): GridPoint {
  return { x: (px - layout.offsetX) / layout.cellPx, z: (py - layout.offsetY) / layout.cellPx };
}

/** 初めて読み込んだ時の位置．回転なしで，写真全体がマス目全体に収まる大きさにして中央に置く */
export function fitUnderlay(size: ImageSize, grid: GridSize): UnderlayPlacement {
  const fit = Math.min(grid.width / size.width, grid.depth / size.height);
  return {
    centerX: grid.width / 2,
    centerZ: grid.depth / 2,
    widthCells: clampWidth(fit * size.width),
    rotationDeg: 0,
  };
}

/** 写真をマス目の座標で (dx, dz) マスずらす */
export function moveUnderlay(
  placement: UnderlayPlacement,
  dx: number,
  dz: number,
): UnderlayPlacement {
  if (!Number.isFinite(dx) || !Number.isFinite(dz)) return placement;
  return {
    ...placement,
    centerX: clampCenter(placement.centerX + dx),
    centerZ: clampCenter(placement.centerZ + dz),
  };
}

/**
 * 写真を pivot（マス目の座標）を動かさずに factor 倍する（ホイールでマウスの下を中心に拡大縮小する）．
 * 幅が下限・上限に当たる時はそこで止め，中心もその倍率で動かす
 */
export function scaleUnderlayAt(
  placement: UnderlayPlacement,
  factor: number,
  pivot: GridPoint,
): UnderlayPlacement {
  if (!(factor > 0) || !Number.isFinite(factor) || !isFinitePoint(pivot)) return placement;
  const widthCells = clampWidth(placement.widthCells * factor);
  const k = widthCells / placement.widthCells;
  return {
    ...placement,
    widthCells,
    centerX: clampCenter(pivot.x + (placement.centerX - pivot.x) * k),
    centerZ: clampCenter(pivot.z + (placement.centerZ - pivot.z) * k),
  };
}

/** 写真の中心から見た point の向き（度．画面で時計回りが正．Shift+ドラッグの回転に使う）．中心と同じ点なら null */
export function angleFromCenterDeg(placement: UnderlayPlacement, point: GridPoint): number | null {
  const dx = point.x - placement.centerX;
  const dz = point.z - placement.centerZ;
  if (!Number.isFinite(dx) || !Number.isFinite(dz) || (dx === 0 && dz === 0)) return null;
  return (Math.atan2(dz, dx) * 180) / Math.PI;
}

/** 写真を中心のまわりに deltaDeg 度回す（時計回りが正） */
export function rotateUnderlay(placement: UnderlayPlacement, deltaDeg: number): UnderlayPlacement {
  if (!Number.isFinite(deltaDeg)) return placement;
  return { ...placement, rotationDeg: normalizeDegrees(placement.rotationDeg + deltaDeg) };
}

/**
 * 数値の欄で入れた値を当てはめる．数でない値・範囲の外の値があれば null（呼び出し側が案内を出し，欄を元に戻す）．
 * 回転は (-180, 180] にそろえる
 */
export function updatePlacement(
  placement: UnderlayPlacement,
  patch: Partial<UnderlayPlacement>,
): UnderlayPlacement | null {
  const next = { ...placement, ...patch };
  if (!isValidPlacement(next)) return null;
  return { ...next, rotationDeg: normalizeDegrees(next.rotationDeg) };
}

/** 位置として受け付けるか（すべて有限の数で，中心・幅が範囲の中） */
export function isValidPlacement(p: UnderlayPlacement): boolean {
  return (
    Number.isFinite(p.centerX) &&
    Number.isFinite(p.centerZ) &&
    Number.isFinite(p.widthCells) &&
    Number.isFinite(p.rotationDeg) &&
    Math.abs(p.centerX) <= MAX_UNDERLAY_CENTER_OFFSET &&
    Math.abs(p.centerZ) <= MAX_UNDERLAY_CENTER_OFFSET &&
    p.widthCells >= MIN_UNDERLAY_WIDTH_CELLS &&
    p.widthCells <= MAX_UNDERLAY_WIDTH_CELLS
  );
}

/** 不透明度を 0〜1 にそろえる．数でない時は既定値 */
export function clampOpacity(opacity: number): number {
  if (!Number.isFinite(opacity)) return DEFAULT_UNDERLAY_OPACITY;
  return Math.min(1, Math.max(0, opacity));
}

/** 描く下敷き（表示している時だけ editorCanvas.ts に渡す） */
export interface UnderlayOverlay {
  readonly image: CanvasImageSource;
  /** image の大きさ（px．縮小して読み込んだ時は縮小後の大きさ） */
  readonly size: ImageSize;
  readonly placement: UnderlayPlacement;
  /** 不透明度（0〜1．エディタの図では図面の線の濃さ） */
  readonly opacity: number;
}

/**
 * 写真の描き方．plain はそのまま（切り出し用），lines は白黒にして乗算で重ねる
 * （紙の白は透けて下の塗りの色のまま，図面の黒い線だけが乗る．エディタの図用）
 */
export type UnderlayBlend = "plain" | "lines";

/** 下敷きを描くのに使う Canvas の操作だけを持つ型（テストで代わりを渡せるように） */
export type UnderlayDrawContext = Pick<
  CanvasRenderingContext2D,
  | "save"
  | "restore"
  | "transform"
  | "drawImage"
  | "globalAlpha"
  | "globalCompositeOperation"
  | "filter"
>;

/**
 * 下敷きの写真を描く．マス目の左上が Canvas の (originX, originY)（今の変換での座標），1 マスが cellPx の大きさ．
 * エディタの図（originX・Y は GridLayout の offsetX・Y．blend は lines）と ES3 の切り出し（0, 0．plain）で同じ変換を使う．
 * 描いた後は不透明度・重ね方・フィルターを元に戻す
 */
export function drawUnderlay(
  ctx: UnderlayDrawContext,
  overlay: UnderlayOverlay,
  originX: number,
  originY: number,
  cellPx: number,
  blend: UnderlayBlend = "plain",
): void {
  const m = underlayMatrix(overlay.placement, overlay.size);
  const before = {
    alpha: ctx.globalAlpha,
    composite: ctx.globalCompositeOperation,
    filter: ctx.filter,
  };
  ctx.save();
  ctx.globalAlpha = clampOpacity(overlay.opacity);
  if (blend === "lines") {
    // 写真の色（部屋のパステル調等）が塗りの色とぶつからないよう白黒にする．filter が効かないブラウザでは色のまま乗算で描く
    ctx.filter = "grayscale(1)";
    ctx.globalCompositeOperation = "multiply";
  }
  // マス目の座標 → Canvas の座標（平行移動と拡大）の後に，写真の画素 → マス目の座標を掛ける
  ctx.transform(cellPx, 0, 0, cellPx, originX, originY);
  ctx.transform(m.a, m.b, m.c, m.d, m.e, m.f);
  ctx.drawImage(overlay.image, 0, 0, overlay.size.width, overlay.size.height);
  ctx.restore();
  // restore で戻るはずだが，後に描く壁・印が乗算や白黒で描かれないよう念のため明示して戻す
  ctx.globalAlpha = before.alpha;
  ctx.globalCompositeOperation = before.composite;
  ctx.filter = before.filter;
}

/** マス目の範囲を切り出す画像の大きさ（px）と 1 マスの大きさ（px）．長い辺を maxSidePx にそろえる */
export interface CropSize {
  readonly width: number;
  readonly height: number;
  readonly cellPx: number;
}

/** マス目（width × depth マス）の範囲を，長い辺が maxSidePx の画像に切り出す時の大きさ */
export function underlayCropSize(grid: GridSize, maxSidePx: number = MAX_CROP_SIDE_PX): CropSize {
  const cellPx = maxSidePx / Math.max(grid.width, grid.depth);
  return {
    width: Math.max(1, Math.round(grid.width * cellPx)),
    height: Math.max(1, Math.round(grid.depth * cellPx)),
    cellPx,
  };
}

/** 切り出しの下地の色（写真の外は白．図面の紙と同じに見え，AI が「何もない」と読みやすいように） */
export const CROP_BACKGROUND = "#ffffff";

/** 切り出しに使う Canvas の操作だけを持つ型 */
export type UnderlayCropContext = UnderlayDrawContext &
  Pick<CanvasRenderingContext2D, "fillRect" | "fillStyle">;

/**
 * マス目の範囲（width × depth マス）に重なる写真を，crop の大きさの Canvas に描く（ES3 の FloorDraftProvider に渡す image）．
 * 合わせた位置・大きさ・回転を反映し，写真の外は白で塗る．不透明度は使わず，そのままの濃さで描く
 */
export function drawUnderlayCrop(
  ctx: UnderlayCropContext,
  overlay: UnderlayOverlay,
  crop: CropSize,
): void {
  ctx.save();
  ctx.fillStyle = CROP_BACKGROUND;
  ctx.fillRect(0, 0, crop.width, crop.height);
  ctx.restore();
  drawUnderlay(ctx, { ...overlay, opacity: 1 }, 0, 0, crop.cellPx);
}

/** 前回の下敷きの位置（写真のファイルの名前と大きさが同じ時だけ使う） */
export interface UnderlayMemory {
  readonly fileName: string;
  /** 読み込んだ写真の元の大きさ（px．縮小する前） */
  readonly imageWidth: number;
  readonly imageHeight: number;
  readonly placement: UnderlayPlacement;
  readonly opacity: number;
}

/** 前回の位置を文字列にする（localStorage に書く形） */
export function serializeUnderlayMemory(memory: UnderlayMemory): string {
  return JSON.stringify(memory);
}

/** localStorage から読んだ文字列を前回の位置にする．読めない・形が違う・範囲の外なら null（例外は投げない） */
export function parseUnderlayMemory(text: string | null): UnderlayMemory | null {
  if (text === null) return null;
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return null;
  }
  if (!isRecord(raw) || !isRecord(raw.placement)) return null;
  const { fileName, imageWidth, imageHeight, opacity } = raw;
  const p = raw.placement;
  if (
    typeof fileName !== "string" ||
    !isPositive(imageWidth) ||
    !isPositive(imageHeight) ||
    typeof opacity !== "number" ||
    typeof p.centerX !== "number" ||
    typeof p.centerZ !== "number" ||
    typeof p.widthCells !== "number" ||
    typeof p.rotationDeg !== "number"
  ) {
    return null;
  }
  const placement: UnderlayPlacement = {
    centerX: p.centerX,
    centerZ: p.centerZ,
    widthCells: p.widthCells,
    rotationDeg: normalizeDegrees(p.rotationDeg),
  };
  if (!isValidPlacement(placement)) return null;
  return { fileName, imageWidth, imageHeight, placement, opacity: clampOpacity(opacity) };
}

/**
 * 写真を読み込んだ時の位置と不透明度．前回と同じ名前・大きさの写真なら前回の位置，そうでなければマス目全体に収める
 * （size は元の大きさ（px））
 */
export function initialUnderlay(
  memory: UnderlayMemory | null,
  fileName: string,
  size: ImageSize,
  grid: GridSize,
): { readonly placement: UnderlayPlacement; readonly opacity: number; readonly restored: boolean } {
  if (
    memory !== null &&
    memory.fileName === fileName &&
    memory.imageWidth === size.width &&
    memory.imageHeight === size.height
  ) {
    return { placement: memory.placement, opacity: memory.opacity, restored: true };
  }
  return {
    placement: fitUnderlay(size, grid),
    opacity: memory?.opacity ?? DEFAULT_UNDERLAY_OPACITY,
    restored: false,
  };
}

/** 前回の位置を読む．Storage が無い・読めない時は null（例外は投げない） */
export function loadUnderlayMemory(storage: PlanStorageLike | null): UnderlayMemory | null {
  if (storage === null) return null;
  try {
    return parseUnderlayMemory(storage.getItem(UNDERLAY_STORAGE_KEY));
  } catch {
    return null;
  }
}

/** 前回の位置を書く．書けなくても止めない（位置を覚えるのはおまけのため，案内も出さない） */
export function saveUnderlayMemory(storage: PlanStorageLike | null, memory: UnderlayMemory): void {
  if (storage === null) return;
  try {
    storage.setItem(UNDERLAY_STORAGE_KEY, serializeUnderlayMemory(memory));
  } catch {
    // 容量超過・プライベートモード等．次に読み込んだ時はマス目全体に収めるだけなので無視する
  }
}

function clampWidth(widthCells: number): number {
  if (!Number.isFinite(widthCells)) return MIN_UNDERLAY_WIDTH_CELLS;
  return Math.min(MAX_UNDERLAY_WIDTH_CELLS, Math.max(MIN_UNDERLAY_WIDTH_CELLS, widthCells));
}

function clampCenter(value: number): number {
  return Math.min(MAX_UNDERLAY_CENTER_OFFSET, Math.max(-MAX_UNDERLAY_CENTER_OFFSET, value));
}

function isFinitePoint(p: GridPoint): boolean {
  return Number.isFinite(p.x) && Number.isFinite(p.z);
}

function isPositive(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value > 0;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
