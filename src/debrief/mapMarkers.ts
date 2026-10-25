// 結果画面の地図の訓練条件の印（火元の炎・開始地点の人と向きの矢印・集合場所の枠と旗）の位置と大きさ（純粋な関数）．
// 形と比率はエディタの図（src/editor/editorCanvas.ts の drawMarkers）を書き写したもので，マス 1 つの大きさ（cellPx）に合わせて決める
import { type CanvasPoint, type MapLayout, type MapPoint, mapToCanvas } from "./mapLayout";
import type { MapCell } from "./mapOverlay";

/** 印の白い縁取りの太さの半分（CSS の px．縁取りは線の太さをこの 2 倍にして塗りの下に描く） */
export function markerOutlineWidth(cellPx: number): number {
  return Math.max(1, cellPx * 0.06);
}

/** 炎のしずく形（中心と半分の高さ．すべて CSS の px） */
export interface FlameShape {
  readonly cx: number;
  readonly cy: number;
  readonly size: number;
}

/** 火元の印（外側の炎と，少し下に寄せた内側の炎） */
export interface FireMarker {
  readonly outer: FlameShape;
  readonly inner: FlameShape;
}

/** 火元のマスの炎の印の位置と大きさ */
export function fireMarker(layout: MapLayout, cell: MapCell): FireMarker {
  const c = mapToCanvas(layout, { u: cell.x + 0.5, v: cell.z + 0.5 });
  const s = layout.cellPx;
  return {
    outer: { cx: c.x, cy: c.y, size: s * 0.36 },
    inner: { cx: c.x, cy: c.y + s * 0.1, size: s * 0.18 },
  };
}

/** 集合場所の印（マスの内側の枠と，竿と三角の旗．すべて CSS の px） */
export interface AssemblyMarker {
  /** 枠の左上と幅・高さ（線の中心の位置） */
  readonly frame: {
    readonly x: number;
    readonly y: number;
    readonly width: number;
    readonly height: number;
  };
  /** 枠の線の太さ */
  readonly frameWidth: number;
  /** 竿の下端と上端 */
  readonly poleBottom: CanvasPoint;
  readonly poleTop: CanvasPoint;
  /** 竿の線の太さ */
  readonly poleWidth: number;
  /** 旗の三角（竿の上端・旗の先・竿の途中） */
  readonly flag: readonly [CanvasPoint, CanvasPoint, CanvasPoint];
}

/** 集合場所のマスの枠と旗の位置と大きさ */
export function assemblyMarker(layout: MapLayout, cell: MapCell): AssemblyMarker {
  const s = layout.cellPx;
  const left = layout.offsetX + cell.x * s;
  const top = layout.offsetY + cell.z * s;
  const inset = Math.max(2, s * 0.1);
  const poleX = left + s * 0.38;
  return {
    frame: { x: left + inset, y: top + inset, width: s - inset * 2, height: s - inset * 2 },
    frameWidth: Math.max(2, s * 0.1),
    poleBottom: { x: poleX, y: top + s * 0.75 },
    poleTop: { x: poleX, y: top + s * 0.25 },
    poleWidth: Math.max(1, s * 0.05),
    flag: [
      { x: poleX, y: top + s * 0.25 },
      { x: left + s * 0.68, y: top + s * 0.36 },
      { x: poleX, y: top + s * 0.47 },
    ],
  };
}

/** 円（中心と半径．CSS の px） */
export interface Circle {
  readonly x: number;
  readonly y: number;
  readonly r: number;
}

/** 開始地点の印（向きの矢印と，人の印の丸・頭・胴の半円．すべて CSS の px） */
export interface StartMarker {
  /** 向きの矢印の三角（先端・根元の 2 点）．向きが分からない時は null */
  readonly arrow: readonly [CanvasPoint, CanvasPoint, CanvasPoint] | null;
  /** 人の印の地の丸 */
  readonly body: Circle;
  /** 白い頭の丸 */
  readonly head: Circle;
  /** 白い胴の半円（上半分の弧で描く） */
  readonly torso: Circle;
}

/**
 * 開始地点の人の印と向きの矢印の位置と大きさ．at はマスの中心（地図の座標），direction は地図の上の長さ 1 の向き
 * （mapLayout.ts の yawToMapDirection）．direction が null か数でない時は矢印を出さない
 */
export function startMarker(
  layout: MapLayout,
  at: MapPoint,
  direction: MapPoint | null,
): StartMarker {
  const s = layout.cellPx;
  const c = mapToCanvas(layout, at);
  let arrow: StartMarker["arrow"] = null;
  if (direction !== null && Number.isFinite(direction.u) && Number.isFinite(direction.v)) {
    const { u, v } = direction;
    const baseX = c.x + u * s * 0.2;
    const baseY = c.y + v * s * 0.2;
    const half = s * 0.2;
    // 人の印の外へ三角の先を出す（根元は印の中に隠れる）
    arrow = [
      { x: c.x + u * s * 0.48, y: c.y + v * s * 0.48 },
      { x: baseX - v * half, y: baseY + u * half },
      { x: baseX + v * half, y: baseY - u * half },
    ];
  }
  const r = s * 0.24;
  return {
    arrow,
    body: { x: c.x, y: c.y, r },
    head: { x: c.x, y: c.y - r * 0.35, r: r * 0.3 },
    torso: { x: c.x, y: c.y + r * 0.6, r: r * 0.5 },
  };
}
