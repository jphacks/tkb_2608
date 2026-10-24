// エレベーターのテクスチャ（canvas で手続き生成．乱数はシード固定）

import * as THREE from "three";
import { mulberry32, randomRange } from "../common/random";
import { createCanvas, drawMottle, toRepeatTexture } from "../common/textures";
import {
  BUTTON_LABEL_KEYS,
  CAPACITY,
  directionSign,
  type ElevatorButtonKey,
  formatFloorLabel,
  type IndicatorDirection,
  type PanelLayout,
} from "./elevatorLayout";

/**
 * ステンレスのヘアライン（縦の細い筋＋左端に板の継ぎ目）．1 枚 = 板 1 枚（TILE_SIZE.wall 四方）．
 * 筋は縦に通しているため上下にはつながる
 */
export function createHairlineTexture(maxAnisotropy: number): THREE.CanvasTexture {
  const size = 256;
  const [canvas, ctx] = createCanvas(size, size);
  const rand = mulberry32(901);
  ctx.fillStyle = "#b7bcc1";
  ctx.fillRect(0, 0, size, size);
  for (let x = 0; x < size; x++) {
    const light = rand() < 0.5;
    ctx.fillStyle = light
      ? `rgba(255,255,255,${randomRange(rand, 0, 0.18).toFixed(3)})`
      : `rgba(40,45,50,${randomRange(rand, 0, 0.12).toFixed(3)})`;
    ctx.fillRect(x, 0, 1, size);
  }
  // 板の継ぎ目（左端の細い影）
  ctx.fillStyle = "rgba(30,32,36,0.55)";
  ctx.fillRect(0, 0, 2, size);
  ctx.fillStyle = "rgba(255,255,255,0.35)";
  ctx.fillRect(2, 0, 1, size);
  return toRepeatTexture(canvas, maxAnisotropy);
}

/** 床のタイル（石目調のタイル 1 枚＋目地）．1 枚 = TILE_SIZE.floor 四方 */
export function createTileFloorTexture(
  baseColor: string,
  seed: number,
  maxAnisotropy: number,
): THREE.CanvasTexture {
  const size = 256;
  const [canvas, ctx] = createCanvas(size, size);
  const rand = mulberry32(seed);
  ctx.fillStyle = baseColor;
  ctx.fillRect(0, 0, size, size);
  drawMottle(ctx, rand, size, 2500, "40,40,40", 0.16);
  drawMottle(ctx, rand, size, 1500, "255,255,255", 0.14);
  // 目地（上端と左端．繰り返すと四方を囲む）
  ctx.fillStyle = "rgba(45,45,45,0.6)";
  ctx.fillRect(0, 0, size, 3);
  ctx.fillRect(0, 0, 3, size);
  return toRepeatTexture(canvas, maxAnisotropy);
}

/** 操作盤の板のテクスチャの解像度（px / m） */
const PANEL_PX_PER_M = 540;

/**
 * 操作盤の板（ヘアライン＋スピーカーの格子＋定員・積載量）．位置は layout の grille・capacity．
 * 板全体に 1 枚で貼る（ボタンは別の Mesh で上に重ねる）
 */
export function createPanelPlateTexture(layout: PanelLayout): THREE.CanvasTexture {
  const panelHeight = layout.top - layout.bottom;
  const width = Math.round(layout.width * PANEL_PX_PER_M);
  const height = Math.round(panelHeight * PANEL_PX_PER_M);
  const [canvas, ctx] = createCanvas(width, height);
  const rand = mulberry32(911);
  // 床からの高さ（m）と板の中心からの X（m）を canvas の px に変換する
  const toY = (y: number): number => ((layout.top - y) / panelHeight) * height;
  const toX = (x: number): number => (x / layout.width + 0.5) * width;

  ctx.fillStyle = "#c9cdd1";
  ctx.fillRect(0, 0, width, height);
  for (let x = 0; x < width; x++) {
    ctx.fillStyle = `rgba(255,255,255,${randomRange(rand, 0, 0.2).toFixed(3)})`;
    ctx.fillRect(x, 0, 1, height);
  }
  ctx.strokeStyle = "rgba(60,64,70,0.6)";
  ctx.lineWidth = 2;
  ctx.strokeRect(1, 1, width - 2, height - 2);

  // スピーカーの格子（インターホン．小さな穴を並べる）
  const g = layout.grille;
  ctx.fillStyle = "#3a3d42";
  for (let y = toY(g.y1) + 3; y < toY(g.y0) - 2; y += 6) {
    for (let x = toX(g.x0) + 3; x < toX(g.x1) - 2; x += 6) {
      ctx.beginPath();
      ctx.arc(x, y, 1.6, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  // 定員・積載量（白地に 2 行）
  const c = layout.capacity;
  const cTop = toY(c.y1);
  const cBottom = toY(c.y0);
  const cx = (toX(c.x0) + toX(c.x1)) / 2;
  ctx.fillStyle = "#f4f4f0";
  ctx.fillRect(toX(c.x0), cTop, toX(c.x1) - toX(c.x0), cBottom - cTop);
  ctx.fillStyle = "#222428";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.font = "bold 11px sans-serif";
  const lineH = (cBottom - cTop) / 2;
  ctx.fillText(`定員 ${CAPACITY.persons}名`, cx, cTop + lineH * 0.55);
  ctx.fillText(`積載 ${CAPACITY.loadKg}kg`, cx, cTop + lineH * 1.45);

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

/** ボタンのラベルのテクスチャの 1 マスの大きさ（px） */
const LABEL_CELL = 64;

/** 開閉の記号（向かい合う 2 つの三角と中央の縦線．open は外向き，close は内向き） */
function drawDoorSymbol(ctx: CanvasRenderingContext2D, cx: number, open: boolean): void {
  const cy = LABEL_CELL / 2;
  ctx.fillRect(cx - 1.5, cy - 14, 3, 28);
  for (const sign of [-1, 1]) {
    // open は三角の先を外へ（中央から離れる向き），close は内へ
    const tip = open ? cx + sign * 22 : cx + sign * 5;
    const base = open ? cx + sign * 7 : cx + sign * 20;
    ctx.beginPath();
    ctx.moveTo(tip, cy);
    ctx.lineTo(base, cy - 9);
    ctx.lineTo(base, cy + 9);
    ctx.closePath();
    ctx.fill();
  }
}

/** 非常連絡のベルのアイコン */
function drawBell(ctx: CanvasRenderingContext2D, cx: number): void {
  const cy = LABEL_CELL / 2;
  ctx.beginPath();
  ctx.moveTo(cx - 15, cy + 9);
  ctx.quadraticCurveTo(cx - 11, cy + 4, cx - 11, cy - 3);
  ctx.arc(cx, cy - 4, 11, Math.PI, 0);
  ctx.quadraticCurveTo(cx + 11, cy + 4, cx + 15, cy + 9);
  ctx.closePath();
  ctx.fill();
  ctx.fillRect(cx - 2, cy - 19, 4, 5);
  ctx.beginPath();
  ctx.arc(cx, cy + 13, 4, 0, Math.PI * 2);
  ctx.fill();
}

/**
 * ボタンの面のラベル（横に 1 マスずつ並べた 1 枚．BUTTON_LABEL_KEYS の順）．
 * 階は数字，開閉は記号，非常連絡は黄色の地にベル．面のマテリアルの色を掛けて点灯の色にする
 */
export function createButtonLabelTexture(): THREE.CanvasTexture {
  const count = BUTTON_LABEL_KEYS.length;
  const [canvas, ctx] = createCanvas(LABEL_CELL * count, LABEL_CELL);
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  BUTTON_LABEL_KEYS.forEach((key, i) => {
    const x0 = i * LABEL_CELL;
    const cx = x0 + LABEL_CELL / 2;
    const emergency = key === "emergency-call";
    ctx.fillStyle = emergency ? "#f5c518" : "#f2f2ee";
    ctx.fillRect(x0, 0, LABEL_CELL, LABEL_CELL);
    // 縁の輪
    ctx.strokeStyle = emergency ? "#8a6a00" : "#9aa0a6";
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.arc(cx, LABEL_CELL / 2, LABEL_CELL / 2 - 3, 0, Math.PI * 2);
    ctx.stroke();
    ctx.fillStyle = "#1d1f23";
    if (emergency) drawBell(ctx, cx);
    else if (key === "open" || key === "close") drawDoorSymbol(ctx, cx, key === "open");
    else {
      ctx.font = "bold 40px sans-serif";
      ctx.fillText(key.replace("floor-", ""), cx, LABEL_CELL / 2 + 2);
    }
  });
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

/** ラベルのテクスチャの中で key のマスの横の範囲（0〜1） */
export function buttonLabelURange(key: ElevatorButtonKey): { u0: number; u1: number } {
  const i = Math.max(0, BUTTON_LABEL_KEYS.indexOf(key));
  const n = BUTTON_LABEL_KEYS.length;
  return { u0: i / n, u1: (i + 1) / n };
}

/** 階の表示の canvas の大きさ（px） */
export const INDICATOR_CANVAS = { width: 256, height: 96 } as const;

/** 階の表示を描く（黒地．左に上下の矢印，右に階の数字．スマホでも読めるよう太く大きく） */
export function drawFloorIndicator(
  ctx: CanvasRenderingContext2D,
  floor: number,
  direction: IndicatorDirection,
): void {
  const { width, height } = INDICATOR_CANVAS;
  ctx.fillStyle = "#07080a";
  ctx.fillRect(0, 0, width, height);
  const sign = directionSign(direction);
  if (sign !== 0) {
    const cx = 62;
    const cy = height / 2;
    ctx.fillStyle = "#3fe07a";
    ctx.beginPath();
    ctx.moveTo(cx, cy - sign * 30);
    ctx.lineTo(cx - 28, cy + sign * 22);
    ctx.lineTo(cx + 28, cy + sign * 22);
    ctx.closePath();
    ctx.fill();
  }
  ctx.fillStyle = "#ff8c1a";
  ctx.font = "bold 78px sans-serif";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(formatFloorLabel(floor), 172, height / 2 + 4);
}

/** 階の表示のテクスチャ（描き直しは drawFloorIndicator のあと needsUpdate） */
export function createFloorIndicatorTexture(
  floor: number,
  direction: IndicatorDirection,
): THREE.CanvasTexture {
  const [canvas, ctx] = createCanvas(INDICATOR_CANVAS.width, INDICATOR_CANVAS.height);
  drawFloorIndicator(ctx, floor, direction);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}
