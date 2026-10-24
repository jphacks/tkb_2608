// 校舎のパーツ用の手続きテクスチャ（廊下の床・吸音板の天井・黒板・シャッターの幕・すりガラス）．乱数はシード固定

import * as THREE from "three";
import { mulberry32, randomRange } from "../common/random";
import { createCanvas, drawMottle, toRepeatTexture } from "../common/textures";

/** テクスチャ 1 枚が表す大きさ（m）．UV はこの大きさで割った値にする */
export const SCHOOL_TILE_SIZE = {
  classroomFloor: 1.2,
  corridorFloor: 0.6,
  classroomCeiling: 0.6,
  corridorCeiling: 1,
  shutter: 0.5,
} as const;

/** 廊下の床（30cm 角のビニル床タイル 2 × 2 枚．タイルごとに色をわずかに変える）．1 枚 = 0.6m 四方 */
export function createCorridorFloorTexture(maxAnisotropy: number): THREE.CanvasTexture {
  const size = 256;
  const half = size / 2;
  const [canvas, ctx] = createCanvas(size, size);
  const rand = mulberry32(511);
  for (let i = 0; i < 2; i++) {
    for (let j = 0; j < 2; j++) {
      const l = randomRange(rand, 74, 80);
      ctx.fillStyle = `hsl(150,8%,${l.toFixed(1)}%)`;
      ctx.fillRect(i * half, j * half, half, half);
    }
  }
  drawMottle(ctx, rand, size, 2200, "90,100,95", 0.12);
  drawMottle(ctx, rand, size, 900, "255,255,255", 0.15);
  // 目地（端をまたいでつながるよう両端に半分ずつ描く）
  ctx.fillStyle = "rgba(70,75,72,0.45)";
  for (const p of [0, half, size - 1]) {
    ctx.fillRect(p, 0, 1, size);
    ctx.fillRect(0, p, size, 1);
  }
  return toRepeatTexture(canvas, maxAnisotropy);
}

/** 教室の天井（白い吸音板．細かい穴と板の継ぎ目）．1 枚 = 0.6m 四方 */
export function createAcousticCeilingTexture(maxAnisotropy: number): THREE.CanvasTexture {
  const size = 256;
  const [canvas, ctx] = createCanvas(size, size);
  const rand = mulberry32(512);
  ctx.fillStyle = "#f4f3ee";
  ctx.fillRect(0, 0, size, size);
  // 虫食い状の小さな穴
  for (let i = 0; i < 1400; i++) {
    const x = rand() * size;
    const y = rand() * size;
    ctx.fillStyle = `rgba(120,115,105,${randomRange(rand, 0.15, 0.4).toFixed(3)})`;
    ctx.fillRect(x, y, randomRange(rand, 1, 2.5), 1);
  }
  ctx.fillStyle = "rgba(150,145,135,0.6)";
  ctx.fillRect(0, 0, size, 2);
  ctx.fillRect(0, 0, 2, size);
  return toRepeatTexture(canvas, maxAnisotropy);
}

/** 黒板（濃い緑にチョークを消した跡のまだら）．板全体に 1 枚で貼る */
export function createBlackboardTexture(maxAnisotropy: number): THREE.CanvasTexture {
  const width = 512;
  const height = 192;
  const [canvas, ctx] = createCanvas(width, height);
  const rand = mulberry32(513);
  ctx.fillStyle = "#1f4a36";
  ctx.fillRect(0, 0, width, height);
  // 黒板消しで横に拭いた跡
  for (let i = 0; i < 60; i++) {
    ctx.fillStyle = `rgba(230,240,230,${randomRange(rand, 0.02, 0.06).toFixed(3)})`;
    ctx.fillRect(
      rand() * width,
      rand() * height,
      randomRange(rand, 40, 140),
      randomRange(rand, 8, 24),
    );
  }
  // 右端の日付と日直の欄（細い線だけ）
  ctx.strokeStyle = "rgba(240,240,230,0.55)";
  ctx.lineWidth = 2;
  ctx.strokeRect(width - 70, 16, 54, height - 32);
  ctx.beginPath();
  ctx.moveTo(width - 70, height / 2);
  ctx.lineTo(width - 16, height / 2);
  ctx.stroke();
  const texture = new THREE.CanvasTexture(canvas);
  texture.anisotropy = maxAnisotropy;
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

/** 防火シャッターの幕（横に並ぶスラットの段）．1 枚 = 0.5m 四方 */
export function createShutterTexture(maxAnisotropy: number): THREE.CanvasTexture {
  const size = 128;
  const slats = 6;
  const pitch = size / slats;
  const [canvas, ctx] = createCanvas(size, size);
  const rand = mulberry32(514);
  ctx.fillStyle = "#b4b8bb";
  ctx.fillRect(0, 0, size, size);
  for (let i = 0; i < slats; i++) {
    const y = i * pitch;
    const gradient = ctx.createLinearGradient(0, y, 0, y + pitch);
    gradient.addColorStop(0, "rgba(255,255,255,0.25)");
    gradient.addColorStop(0.5, "rgba(255,255,255,0)");
    gradient.addColorStop(1, "rgba(0,0,0,0.25)");
    ctx.fillStyle = gradient;
    ctx.fillRect(0, y, size, pitch);
    ctx.fillStyle = "rgba(60,62,64,0.6)";
    ctx.fillRect(0, y, size, 1);
  }
  drawMottle(ctx, rand, size, 400, "80,80,80", 0.08);
  return toRepeatTexture(canvas, maxAnisotropy);
}
