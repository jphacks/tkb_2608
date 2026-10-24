// エディタの上から見た図を Canvas 2D に描く薄い殻．配置・壁の辺・教室の名前の位置は editorLayout.ts の純粋な関数で求める
import type { Floor, Room } from "../core/schoolPlan";
import type { CellXZ } from "../sim/grid";
import { type DrillMarkers, type GridLayout, roomLabels, wallEdges } from "./editorLayout";
import { yawToGridDirection } from "./editorState";
import { CELL_COLORS, EDITOR_COLORS, roomColor } from "./editorStyle";

/** 開始地点の印（位置と向き）．向きは startYaw（rad．約束は editorState.ts の FACING_YAW） */
export interface StartMarker {
  readonly cell: CellXZ;
  readonly yaw: number;
}

/**
 * 1 つの階のマス目・壁・教室の名前・訓練条件の印・マウスの下のマスを描く．ctx は CSS の px で描ける変換
 * （devicePixelRatio を掛けた setTransform）にしておく
 */
export function drawEditorGrid(
  ctx: CanvasRenderingContext2D,
  floor: Floor,
  rooms: readonly Room[],
  layout: GridLayout,
  canvasCssWidth: number,
  canvasCssHeight: number,
  hover: CellXZ | null,
  markers: DrillMarkers,
  startYaw: number,
): void {
  ctx.fillStyle = EDITOR_COLORS.background;
  ctx.fillRect(0, 0, canvasCssWidth, canvasCssHeight);
  const { cellPx, offsetX, offsetY } = layout;
  const widthPx = cellPx * floor.width;
  const heightPx = cellPx * floor.depth;

  // void のマスにも境目を出し，マス目の広さが分かるようにする
  drawGridLines(ctx, floor, layout, EDITOR_COLORS.voidGrid);
  for (let z = 0; z < floor.depth; z++) {
    for (let x = 0; x < floor.width; x++) {
      const i = z * floor.width + x;
      const kind = floor.cells[i];
      const color = kind === "classroom" ? roomColor(floor.roomOf[i]) : CELL_COLORS[kind];
      if (color === null) continue;
      ctx.fillStyle = color;
      ctx.fillRect(offsetX + x * cellPx, offsetY + z * cellPx, cellPx, cellPx);
    }
  }
  drawGridLines(ctx, floor, layout, EDITOR_COLORS.grid);

  // 3D で薄い壁が立つ辺
  ctx.strokeStyle = EDITOR_COLORS.wall;
  ctx.lineWidth = Math.max(2, cellPx * 0.12);
  ctx.lineCap = "square";
  ctx.beginPath();
  for (const edge of wallEdges(floor)) {
    ctx.moveTo(offsetX + edge.x1 * cellPx, offsetY + edge.z1 * cellPx);
    ctx.lineTo(offsetX + edge.x2 * cellPx, offsetY + edge.z2 * cellPx);
  }
  ctx.stroke();

  // 教室の名前
  const size = Math.max(10, Math.min(18, cellPx * 0.6));
  ctx.font = `bold ${size}px system-ui, -apple-system, "Hiragino Sans", sans-serif`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillStyle = EDITOR_COLORS.label;
  for (const label of roomLabels(floor, rooms)) {
    ctx.fillText(label.name, offsetX + label.x * cellPx, offsetY + label.z * cellPx);
  }

  drawMarkers(ctx, layout, markers, startYaw);

  if (hover !== null && hover.x < floor.width && hover.z < floor.depth) {
    ctx.strokeStyle = EDITOR_COLORS.hover;
    ctx.lineWidth = 2;
    ctx.strokeRect(
      offsetX + hover.x * cellPx + 1,
      offsetY + hover.z * cellPx + 1,
      cellPx - 2,
      cellPx - 2,
    );
  }

  // マス目の外枠（大きさを変えた時に範囲が分かるように）
  ctx.strokeStyle = EDITOR_COLORS.voidGrid;
  ctx.lineWidth = 1;
  ctx.strokeRect(offsetX - 0.5, offsetY - 0.5, widthPx + 1, heightPx + 1);
}

function drawGridLines(
  ctx: CanvasRenderingContext2D,
  floor: Floor,
  layout: GridLayout,
  color: string,
): void {
  const { cellPx, offsetX, offsetY } = layout;
  // マスが小さすぎる時は線だらけで塗りが見えなくなるので描かない
  if (cellPx < 4) return;
  ctx.strokeStyle = color;
  ctx.lineWidth = 1;
  ctx.beginPath();
  for (let x = 0; x <= floor.width; x++) {
    const px = Math.round(offsetX + x * cellPx) + 0.5;
    ctx.moveTo(px, offsetY);
    ctx.lineTo(px, offsetY + floor.depth * cellPx);
  }
  for (let z = 0; z <= floor.depth; z++) {
    const py = Math.round(offsetY + z * cellPx) + 0.5;
    ctx.moveTo(offsetX, py);
    ctx.lineTo(offsetX + floor.width * cellPx, py);
  }
  ctx.stroke();
}

/** 訓練条件の印を描く（集合場所の枠 → 火元 → 開始地点の順．同じマスに重なっても開始地点が上に見える） */
function drawMarkers(
  ctx: CanvasRenderingContext2D,
  layout: GridLayout,
  markers: DrillMarkers,
  startYaw: number,
): void {
  const { cellPx, offsetX, offsetY } = layout;
  const outline = Math.max(1, cellPx * 0.06);
  ctx.lineJoin = "round";

  for (const { x, z } of markers.assembly) {
    const left = offsetX + x * cellPx;
    const top = offsetY + z * cellPx;
    // 緑の枠（白で縁取り，屋外の色の上でも見える）
    const inset = Math.max(2, cellPx * 0.1);
    ctx.lineWidth = Math.max(2, cellPx * 0.1) + outline * 2;
    ctx.strokeStyle = EDITOR_COLORS.markerOutline;
    ctx.strokeRect(left + inset, top + inset, cellPx - inset * 2, cellPx - inset * 2);
    ctx.lineWidth = Math.max(2, cellPx * 0.1);
    ctx.strokeStyle = EDITOR_COLORS.assembly;
    ctx.strokeRect(left + inset, top + inset, cellPx - inset * 2, cellPx - inset * 2);
    // 小さな旗（竿と三角）
    const poleX = left + cellPx * 0.38;
    const poleTop = top + cellPx * 0.25;
    const poleBottom = top + cellPx * 0.75;
    ctx.lineWidth = Math.max(1, cellPx * 0.05);
    ctx.strokeStyle = EDITOR_COLORS.assembly;
    ctx.beginPath();
    ctx.moveTo(poleX, poleBottom);
    ctx.lineTo(poleX, poleTop);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(poleX, poleTop);
    ctx.lineTo(left + cellPx * 0.68, top + cellPx * 0.36);
    ctx.lineTo(poleX, top + cellPx * 0.47);
    ctx.closePath();
    ctx.fillStyle = EDITOR_COLORS.assembly;
    ctx.fill();
  }

  for (const { x, z } of markers.fireOrigins) {
    const cx = offsetX + (x + 0.5) * cellPx;
    const cy = offsetY + (z + 0.5) * cellPx;
    flamePath(ctx, cx, cy, cellPx * 0.36);
    ctx.lineWidth = outline * 2;
    ctx.strokeStyle = EDITOR_COLORS.markerOutline;
    ctx.stroke();
    ctx.fillStyle = EDITOR_COLORS.fire;
    ctx.fill();
    flamePath(ctx, cx, cy + cellPx * 0.1, cellPx * 0.18);
    ctx.fillStyle = EDITOR_COLORS.fireCore;
    ctx.fill();
  }

  if (markers.start !== null) {
    const cx = offsetX + (markers.start.x + 0.5) * cellPx;
    const cy = offsetY + (markers.start.z + 0.5) * cellPx;
    const dir = yawToGridDirection(startYaw);
    // 向きの矢印（人の印の外へ向けて三角を出す）．向きが数でない時は矢印を描かない
    if (Number.isFinite(dir.x) && Number.isFinite(dir.z)) {
      const tipX = cx + dir.x * cellPx * 0.48;
      const tipY = cy + dir.z * cellPx * 0.48;
      const baseX = cx + dir.x * cellPx * 0.2;
      const baseY = cy + dir.z * cellPx * 0.2;
      const half = cellPx * 0.2;
      ctx.beginPath();
      ctx.moveTo(tipX, tipY);
      ctx.lineTo(baseX - dir.z * half, baseY + dir.x * half);
      ctx.lineTo(baseX + dir.z * half, baseY - dir.x * half);
      ctx.closePath();
      ctx.lineWidth = outline * 2;
      ctx.strokeStyle = EDITOR_COLORS.markerOutline;
      ctx.stroke();
      ctx.fillStyle = EDITOR_COLORS.start;
      ctx.fill();
    }
    // 人の印（頭の丸と胴の半円）
    const r = cellPx * 0.24;
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.lineWidth = outline * 2;
    ctx.strokeStyle = EDITOR_COLORS.markerOutline;
    ctx.stroke();
    ctx.fillStyle = EDITOR_COLORS.start;
    ctx.fill();
    ctx.fillStyle = EDITOR_COLORS.markerOutline;
    ctx.beginPath();
    ctx.arc(cx, cy - r * 0.35, r * 0.3, 0, Math.PI * 2);
    ctx.fill();
    ctx.beginPath();
    ctx.arc(cx, cy + r * 0.6, r * 0.5, Math.PI, 0);
    ctx.closePath();
    ctx.fill();
  }
}

/** 炎の形（下が丸く上がとがったしずく形）の道．(cx, cy) が中心，size が半分の高さ（px） */
function flamePath(ctx: CanvasRenderingContext2D, cx: number, cy: number, size: number): void {
  ctx.beginPath();
  ctx.moveTo(cx, cy - size);
  ctx.bezierCurveTo(cx + size * 0.9, cy - size * 0.2, cx + size * 0.8, cy + size, cx, cy + size);
  ctx.bezierCurveTo(cx - size * 0.8, cy + size, cx - size * 0.9, cy - size * 0.2, cx, cy - size);
  ctx.closePath();
}
