// エディタの上から見た図を Canvas 2D に描く薄い殻．配置・壁の辺・教室の名前の位置は editorLayout.ts の純粋な関数で求める
import type { Floor, Room } from "../core/schoolPlan";
import type { CellXZ } from "../sim/grid";
import { type GridLayout, roomLabels, wallEdges } from "./editorLayout";
import { CELL_COLORS, EDITOR_COLORS, roomColor } from "./editorStyle";

/**
 * 1 つの階のマス目・壁・教室の名前・マウスの下のマスを描く．ctx は CSS の px で描ける変換
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
