// 結果画面の地図を Canvas 2D に描く薄い殻．座標の変換・縮尺・重ねるものの組み立ては mapLayout.ts・mapOverlay.ts の純粋な関数で行う
import type { Floor } from "../core/schoolPlan";
import { type MapLayout, type MapPoint, mapToCanvas } from "./mapLayout";
import type { MapCell, MapOverlay, MapPolyline } from "./mapOverlay";
import { CELL_COLORS, OVERLAY_COLORS } from "./mapStyle";

/**
 * 1 つの階の地図と重ねるものを描く．ctx は CSS の px で描ける変換（devicePixelRatio を掛けた setTransform）にしておく
 */
export function drawDebriefMap(
  ctx: CanvasRenderingContext2D,
  floor: Floor,
  overlay: MapOverlay,
  layout: MapLayout,
  canvasCssWidth: number,
  canvasCssHeight: number,
): void {
  ctx.clearRect(0, 0, canvasCssWidth, canvasCssHeight);
  ctx.fillStyle = OVERLAY_COLORS.background;
  ctx.fillRect(0, 0, canvasCssWidth, canvasCssHeight);
  const cell = layout.cellPx;
  if (cell <= 0) return;

  // マス目
  for (let z = 0; z < floor.depth; z++) {
    for (let x = 0; x < floor.width; x++) {
      const color = CELL_COLORS[floor.cells[z * floor.width + x]];
      if (color === null || color === undefined) continue;
      ctx.fillStyle = color;
      ctx.fillRect(layout.offsetX + x * cell, layout.offsetY + z * cell, cell, cell);
    }
  }
  drawGrid(ctx, floor, layout);
  for (const fire of overlay.fireOrigins) fillCell(ctx, layout, fire, OVERLAY_COLORS.fireOrigin);
  drawRoomLabels(ctx, overlay, layout);
  for (const spot of overlay.assembly) frameCell(ctx, layout, spot, OVERLAY_COLORS.assembly);

  // 線は下から 正解経路 → 煙の中で立っていた帯 → 自分の経路 → 外れた区間 の順に重ねる
  const width = Math.max(2, cell * 0.22);
  for (const line of overlay.correctRoute) {
    strokeLine(ctx, layout, line, OVERLAY_COLORS.correctRoute, width * 1.6, 0.55);
  }
  for (const line of overlay.smokeStanding) {
    strokeLine(ctx, layout, line, OVERLAY_COLORS.smokeStanding, width * 3.2, 1);
  }
  for (const line of overlay.ownPath)
    strokeLine(ctx, layout, line, OVERLAY_COLORS.ownPath, width, 1);
  for (const line of overlay.offRoute) {
    strokeLine(ctx, layout, line, OVERLAY_COLORS.offRoute, width * 1.2, 1);
  }

  for (const point of overlay.nearFire) {
    drawDot(ctx, layout, point, Math.max(4, cell * 0.32), OVERLAY_COLORS.nearFire);
  }
  if (overlay.start !== null) drawRing(ctx, layout, overlay.start, Math.max(5, cell * 0.38));
}

function drawGrid(ctx: CanvasRenderingContext2D, floor: Floor, layout: MapLayout): void {
  ctx.strokeStyle = OVERLAY_COLORS.grid;
  ctx.lineWidth = 1;
  ctx.beginPath();
  for (let x = 0; x <= floor.width; x++) {
    const px = Math.round(layout.offsetX + x * layout.cellPx) + 0.5;
    ctx.moveTo(px, layout.offsetY);
    ctx.lineTo(px, layout.offsetY + layout.heightPx);
  }
  for (let z = 0; z <= floor.depth; z++) {
    const py = Math.round(layout.offsetY + z * layout.cellPx) + 0.5;
    ctx.moveTo(layout.offsetX, py);
    ctx.lineTo(layout.offsetX + layout.widthPx, py);
  }
  ctx.stroke();
}

function fillCell(
  ctx: CanvasRenderingContext2D,
  layout: MapLayout,
  cell: MapCell,
  color: string,
): void {
  ctx.fillStyle = color;
  ctx.fillRect(
    layout.offsetX + cell.x * layout.cellPx,
    layout.offsetY + cell.z * layout.cellPx,
    layout.cellPx,
    layout.cellPx,
  );
}

function frameCell(
  ctx: CanvasRenderingContext2D,
  layout: MapLayout,
  cell: MapCell,
  color: string,
): void {
  const line = Math.max(2, layout.cellPx * 0.12);
  ctx.strokeStyle = color;
  ctx.lineWidth = line;
  ctx.strokeRect(
    layout.offsetX + cell.x * layout.cellPx + line / 2,
    layout.offsetY + cell.z * layout.cellPx + line / 2,
    layout.cellPx - line,
    layout.cellPx - line,
  );
}

function drawRoomLabels(
  ctx: CanvasRenderingContext2D,
  overlay: MapOverlay,
  layout: MapLayout,
): void {
  const size = Math.max(10, Math.min(18, layout.cellPx * 0.6));
  ctx.font = `bold ${size}px system-ui, -apple-system, "Hiragino Sans", sans-serif`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillStyle = OVERLAY_COLORS.label;
  for (const label of overlay.roomLabels) {
    const at = mapToCanvas(layout, label.at);
    ctx.fillText(label.name, at.x, at.y);
  }
}

function strokeLine(
  ctx: CanvasRenderingContext2D,
  layout: MapLayout,
  line: MapPolyline,
  color: string,
  width: number,
  alpha: number,
): void {
  if (line.length === 0) return;
  ctx.save();
  ctx.globalAlpha = alpha;
  if (line.length === 1) {
    drawDot(ctx, layout, line[0], width / 2, color);
    ctx.restore();
    return;
  }
  ctx.strokeStyle = color;
  ctx.lineWidth = width;
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  ctx.beginPath();
  line.forEach((point, i) => {
    const p = mapToCanvas(layout, point);
    if (i === 0) ctx.moveTo(p.x, p.y);
    else ctx.lineTo(p.x, p.y);
  });
  ctx.stroke();
  ctx.restore();
}

function drawDot(
  ctx: CanvasRenderingContext2D,
  layout: MapLayout,
  point: MapPoint,
  radius: number,
  color: string,
): void {
  const p = mapToCanvas(layout, point);
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.arc(p.x, p.y, radius, 0, Math.PI * 2);
  ctx.fill();
  // 線の上でも見分けられるよう白い縁を付ける
  ctx.strokeStyle = "#ffffff";
  ctx.lineWidth = Math.max(1.5, radius * 0.3);
  ctx.stroke();
}

function drawRing(
  ctx: CanvasRenderingContext2D,
  layout: MapLayout,
  point: MapPoint,
  radius: number,
): void {
  const p = mapToCanvas(layout, point);
  ctx.fillStyle = "#ffffff";
  ctx.strokeStyle = OVERLAY_COLORS.start;
  ctx.lineWidth = Math.max(2, radius * 0.4);
  ctx.beginPath();
  ctx.arc(p.x, p.y, radius, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();
}
