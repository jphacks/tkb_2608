// 結果画面の地図を Canvas 2D に描く薄い殻．座標の変換・縮尺・重ねるもの・印の位置は mapLayout.ts・mapOverlay.ts・mapMarkers.ts の
// 純粋な関数で求める．マス・壁・教室の名前・印の見た目はエディタの図（src/editor/editorCanvas.ts）にそろえる（関数は共有せず書き写す）
import type { Floor } from "../core/schoolPlan";
import { type MapLayout, type MapPoint, mapToCanvas } from "./mapLayout";
import {
  assemblyMarker,
  type Circle,
  type FlameShape,
  fireMarker,
  markerOutlineWidth,
  startMarker,
} from "./mapMarkers";
import type { MapOverlay, MapPolyline } from "./mapOverlay";
import { cellFillColor, OVERLAY_COLORS } from "./mapStyle";

/**
 * 1 つの階の地図と重ねるものを描く．ctx は CSS の px で描ける変換（devicePixelRatio を掛けた setTransform）にしておく．
 * 下から マス目 → 壁 → 教室の名前 → 経路・区間 → 訓練条件の印 → 火に近づいた点 の順に重ねる
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

  // void のマスにも境目を出し，マス目の広さが分かるようにする（エディタと同じ）
  drawGrid(ctx, floor, layout, OVERLAY_COLORS.voidGrid);
  for (let z = 0; z < floor.depth; z++) {
    for (let x = 0; x < floor.width; x++) {
      const i = z * floor.width + x;
      const color = cellFillColor(floor.cells[i], floor.roomOf[i]);
      if (color === null) continue;
      ctx.fillStyle = color;
      ctx.fillRect(layout.offsetX + x * cell, layout.offsetY + z * cell, cell, cell);
    }
  }
  drawGrid(ctx, floor, layout, OVERLAY_COLORS.grid);
  drawWalls(ctx, overlay, layout);
  drawRoomLabels(ctx, overlay, layout);

  // 線は下から 正解経路 → 煙の中で立っていた帯 → 自分の経路 → 外れた区間 の順に重ねる．
  // 正解経路はエディタと同じく白で縁取り，教室ごとの淡い色（緑系の色を含む）の上でも見分けられるようにする
  const width = Math.max(2, cell * 0.22);
  const outline = markerOutlineWidth(cell);
  for (const line of overlay.correctRoute) {
    strokeLine(ctx, layout, line, OVERLAY_COLORS.markerOutline, width * 1.6 + outline * 2, 0.6);
    strokeLine(ctx, layout, line, OVERLAY_COLORS.correctRoute, width * 1.6, 0.6);
  }
  for (const line of overlay.smokeStanding) {
    strokeLine(ctx, layout, line, OVERLAY_COLORS.smokeStanding, width * 3.2, 1);
  }
  for (const line of overlay.ownPath)
    strokeLine(ctx, layout, line, OVERLAY_COLORS.ownPath, width, 1);
  for (const line of overlay.offRoute) {
    strokeLine(ctx, layout, line, OVERLAY_COLORS.offRoute, width * 1.2, 1);
  }

  // 印は経路の上に描く（エディタと同じく経路の端で印が隠れないように）
  drawMarkers(ctx, overlay, layout);

  // 火に近づいた点は評価の印なので最も上に描く（火元の炎の印のそばに出ても見えるように白い縁が付く）
  for (const point of overlay.nearFire) {
    drawDot(ctx, layout, point, Math.max(4, cell * 0.32), OVERLAY_COLORS.nearFire);
  }

  // マス目の外枠（エディタと同じ）
  ctx.strokeStyle = OVERLAY_COLORS.voidGrid;
  ctx.lineWidth = 1;
  ctx.strokeRect(
    layout.offsetX - 0.5,
    layout.offsetY - 0.5,
    cell * floor.width + 1,
    cell * floor.depth + 1,
  );
}

function drawGrid(
  ctx: CanvasRenderingContext2D,
  floor: Floor,
  layout: MapLayout,
  color: string,
): void {
  // マスが小さすぎる時は線だらけで塗りが見えなくなるので描かない（エディタと同じ）
  if (layout.cellPx < 4) return;
  ctx.strokeStyle = color;
  ctx.lineWidth = 1;
  ctx.beginPath();
  for (let x = 0; x <= floor.width; x++) {
    const px = Math.round(layout.offsetX + x * layout.cellPx) + 0.5;
    ctx.moveTo(px, layout.offsetY);
    ctx.lineTo(px, layout.offsetY + floor.depth * layout.cellPx);
  }
  for (let z = 0; z <= floor.depth; z++) {
    const py = Math.round(layout.offsetY + z * layout.cellPx) + 0.5;
    ctx.moveTo(layout.offsetX, py);
    ctx.lineTo(layout.offsetX + floor.width * layout.cellPx, py);
  }
  ctx.stroke();
}

/** 3D で薄い壁が立つ辺（教室の境界）を描く */
function drawWalls(ctx: CanvasRenderingContext2D, overlay: MapOverlay, layout: MapLayout): void {
  if (overlay.walls.length === 0) return;
  ctx.strokeStyle = OVERLAY_COLORS.wall;
  ctx.lineWidth = Math.max(2, layout.cellPx * 0.12);
  ctx.lineCap = "square";
  ctx.beginPath();
  for (const edge of overlay.walls) {
    const a = mapToCanvas(layout, { u: edge.u1, v: edge.v1 });
    const b = mapToCanvas(layout, { u: edge.u2, v: edge.v2 });
    ctx.moveTo(a.x, a.y);
    ctx.lineTo(b.x, b.y);
  }
  ctx.stroke();
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

/** 訓練条件の印を描く（集合場所の枠 → 火元 → 開始地点の順．同じマスに重なっても開始地点が上に見える．エディタと同じ） */
function drawMarkers(ctx: CanvasRenderingContext2D, overlay: MapOverlay, layout: MapLayout): void {
  const outline = markerOutlineWidth(layout.cellPx);
  ctx.lineJoin = "round";
  ctx.lineCap = "butt";

  for (const spot of overlay.assembly) {
    const m = assemblyMarker(layout, spot);
    const { x, y, width, height } = m.frame;
    ctx.lineWidth = m.frameWidth + outline * 2;
    ctx.strokeStyle = OVERLAY_COLORS.markerOutline;
    ctx.strokeRect(x, y, width, height);
    ctx.lineWidth = m.frameWidth;
    ctx.strokeStyle = OVERLAY_COLORS.assembly;
    ctx.strokeRect(x, y, width, height);
    ctx.lineWidth = m.poleWidth;
    ctx.beginPath();
    ctx.moveTo(m.poleBottom.x, m.poleBottom.y);
    ctx.lineTo(m.poleTop.x, m.poleTop.y);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(m.flag[0].x, m.flag[0].y);
    ctx.lineTo(m.flag[1].x, m.flag[1].y);
    ctx.lineTo(m.flag[2].x, m.flag[2].y);
    ctx.closePath();
    ctx.fillStyle = OVERLAY_COLORS.assembly;
    ctx.fill();
  }

  for (const fire of overlay.fireOrigins) {
    const m = fireMarker(layout, fire);
    flamePath(ctx, m.outer);
    ctx.lineWidth = outline * 2;
    ctx.strokeStyle = OVERLAY_COLORS.markerOutline;
    ctx.stroke();
    ctx.fillStyle = OVERLAY_COLORS.fire;
    ctx.fill();
    flamePath(ctx, m.inner);
    ctx.fillStyle = OVERLAY_COLORS.fireCore;
    ctx.fill();
  }

  if (overlay.start !== null) {
    const m = startMarker(layout, overlay.start, overlay.startDirection);
    if (m.arrow !== null) {
      ctx.beginPath();
      ctx.moveTo(m.arrow[0].x, m.arrow[0].y);
      ctx.lineTo(m.arrow[1].x, m.arrow[1].y);
      ctx.lineTo(m.arrow[2].x, m.arrow[2].y);
      ctx.closePath();
      ctx.lineWidth = outline * 2;
      ctx.strokeStyle = OVERLAY_COLORS.markerOutline;
      ctx.stroke();
      ctx.fillStyle = OVERLAY_COLORS.start;
      ctx.fill();
    }
    circlePath(ctx, m.body);
    ctx.lineWidth = outline * 2;
    ctx.strokeStyle = OVERLAY_COLORS.markerOutline;
    ctx.stroke();
    ctx.fillStyle = OVERLAY_COLORS.start;
    ctx.fill();
    ctx.fillStyle = OVERLAY_COLORS.markerOutline;
    circlePath(ctx, m.head);
    ctx.fill();
    ctx.beginPath();
    ctx.arc(m.torso.x, m.torso.y, m.torso.r, Math.PI, 0);
    ctx.closePath();
    ctx.fill();
  }
}

function circlePath(ctx: CanvasRenderingContext2D, c: Circle): void {
  ctx.beginPath();
  ctx.arc(c.x, c.y, c.r, 0, Math.PI * 2);
}

/** 炎の形（下が丸く上がとがったしずく形）の道（エディタの flamePath と同じ形） */
function flamePath(ctx: CanvasRenderingContext2D, flame: FlameShape): void {
  const { cx, cy, size } = flame;
  ctx.beginPath();
  ctx.moveTo(cx, cy - size);
  ctx.bezierCurveTo(cx + size * 0.9, cy - size * 0.2, cx + size * 0.8, cy + size, cx, cy + size);
  ctx.bezierCurveTo(cx - size * 0.8, cy + size, cx - size * 0.9, cy - size * 0.2, cx, cy - size);
  ctx.closePath();
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
