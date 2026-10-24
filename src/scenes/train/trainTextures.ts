// 電車のテクスチャ（canvas で手続き生成．乱数はシード固定）

import * as THREE from "three";
import { mulberry32, randomInt, randomRange } from "../common/random";
import { createCanvas, drawMottle, toRepeatTexture } from "../common/textures";

/** 床（灰色のゴム床＋細かい粒）．1 枚 = 1m 四方 */
export function createTrainFloorTexture(maxAnisotropy: number): THREE.CanvasTexture {
  const size = 256;
  const [canvas, ctx] = createCanvas(size, size);
  const rand = mulberry32(601);
  ctx.fillStyle = "#8d8f8c";
  ctx.fillRect(0, 0, size, size);
  drawMottle(ctx, rand, size, 3000, "60,62,60", 0.18);
  drawMottle(ctx, rand, size, 1500, "235,235,230", 0.15);
  return toRepeatTexture(canvas, maxAnisotropy);
}

/**
 * 座席のモケット（1 枚 = 1 人分．両端に区切りの濃い線）．
 * 座面・背もたれの箱に貼り，repeat.x を人数にする
 */
export function createSeatFabricTexture(
  baseColor: string,
  seed: number,
  maxAnisotropy: number,
): THREE.CanvasTexture {
  const size = 128;
  const [canvas, ctx] = createCanvas(size, size);
  const rand = mulberry32(seed);
  ctx.fillStyle = baseColor;
  ctx.fillRect(0, 0, size, size);
  drawMottle(ctx, rand, size, 1500, "0,0,0", 0.12);
  drawMottle(ctx, rand, size, 600, "255,255,255", 0.08);
  ctx.fillStyle = "rgba(0,0,0,0.35)";
  ctx.fillRect(0, 0, 3, size);
  ctx.fillRect(size - 3, 0, 3, size);
  return toRepeatTexture(canvas, maxAnisotropy);
}

/** 景色の範囲（ワールド座標の高さ，m）と地面の高さ */
export interface CityscapeRange {
  readonly bottom: number;
  readonly top: number;
  readonly groundY: number;
}

/**
 * 窓の外の街並み（空のグラデーション＋ビルの並び＋地面）．
 * 横方向に繰り返し貼れるよう，左右の端をまたぐビルは反対側にも描く
 */
export function createCityscapeTexture(range: CityscapeRange): THREE.CanvasTexture {
  const width = 1024;
  const height = 512;
  const [canvas, ctx] = createCanvas(width, height);
  const rand = mulberry32(707);
  const toY = (worldY: number): number =>
    ((range.top - worldY) / (range.top - range.bottom)) * height;
  const groundTop = toY(range.groundY);

  const sky = ctx.createLinearGradient(0, 0, 0, groundTop);
  sky.addColorStop(0, "#5c9bd5");
  sky.addColorStop(0.7, "#a9cbe6");
  sky.addColorStop(1, "#e6eff5");
  ctx.fillStyle = sky;
  ctx.fillRect(0, 0, width, groundTop);

  // ビル（奥の列は淡く，手前の列は濃く．窓の明かりの点を並べる）
  const layers = [
    { tone: [168, 180, 192], minH: 4, maxH: 9, windows: 0.25 },
    { tone: [120, 128, 138], minH: 2, maxH: 6, windows: 0.4 },
  ] as const;
  for (const layer of layers) {
    let x = 0;
    while (x < width) {
      const w = randomInt(rand, 30, 90);
      const top = toY(range.groundY + randomRange(rand, layer.minH, layer.maxH));
      const shade = randomRange(rand, -12, 12);
      const [r, g, b] = layer.tone.map((c) => Math.round(c + shade));
      for (const ox of [0, -width]) {
        ctx.fillStyle = `rgb(${r},${g},${b})`;
        ctx.fillRect(x + ox, top, w, groundTop - top + 1);
        ctx.fillStyle = `rgba(230,236,240,${layer.windows})`;
        for (let wy = top + 6; wy < groundTop - 6; wy += 10) {
          for (let wx = x + 5; wx < x + w - 6; wx += 9) ctx.fillRect(wx + ox, wy, 4, 5);
        }
      }
      x += w + randomInt(rand, 0, 12);
    }
  }

  const ground = ctx.createLinearGradient(0, groundTop, 0, height);
  ground.addColorStop(0, "#8a8a80");
  ground.addColorStop(1, "#5d6b4a");
  ctx.fillStyle = ground;
  ctx.fillRect(0, groundTop, width, height - groundTop);

  const texture = new THREE.CanvasTexture(canvas);
  texture.wrapS = THREE.RepeatWrapping;
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

/** ドア上の案内表示の画面（黒地に次の駅の案内） */
export function createDoorDisplayTexture(): THREE.CanvasTexture {
  const [canvas, ctx] = createCanvas(256, 64);
  ctx.fillStyle = "#06080b";
  ctx.fillRect(0, 0, 256, 64);
  ctx.fillStyle = "#ffb43a";
  ctx.font = "bold 22px sans-serif";
  ctx.textBaseline = "middle";
  ctx.fillText("次は", 14, 32);
  ctx.fillStyle = "#f2f2f2";
  ctx.font = "bold 30px sans-serif";
  ctx.fillText("防災中央", 72, 32);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}
