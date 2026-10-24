// canvas で手続き生成するテクスチャ（画像ファイルを持たずに済ませる）．乱数はシード固定

import * as THREE from "three";
import { mulberry32, randomInt, randomRange } from "./random";

function createCanvas(
  width: number,
  height: number,
): [HTMLCanvasElement, CanvasRenderingContext2D] {
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("canvas の 2D コンテキストを取得できません");
  return [canvas, ctx];
}

/** 繰り返し貼る前提の設定（RepeatWrapping・異方性フィルタ・sRGB）でテクスチャにする */
function toRepeatTexture(canvas: HTMLCanvasElement, maxAnisotropy: number): THREE.CanvasTexture {
  const texture = new THREE.CanvasTexture(canvas);
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.anisotropy = maxAnisotropy;
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

/** 細かいまだら模様を描く．端をまたぐ点は反対側にも描いて継ぎ目を消す */
function drawMottle(
  ctx: CanvasRenderingContext2D,
  rand: () => number,
  size: number,
  count: number,
  rgb: string,
  maxAlpha: number,
): void {
  for (let i = 0; i < count; i++) {
    const x = rand() * size;
    const y = rand() * size;
    const s = randomRange(rand, 1, 3);
    ctx.fillStyle = `rgba(${rgb},${(rand() * maxAlpha).toFixed(3)})`;
    for (const ox of [0, -size]) {
      for (const oy of [0, -size]) {
        ctx.fillRect(x + ox, y + oy, s, s);
      }
    }
  }
}

/** 壁紙（薄い縦縞＋まだら）．1 枚 = 0.5m 四方 */
export function createWallpaperTexture(maxAnisotropy: number): THREE.CanvasTexture {
  const size = 256;
  const [canvas, ctx] = createCanvas(size, size);
  const rand = mulberry32(101);
  ctx.fillStyle = "#ece6da";
  ctx.fillRect(0, 0, size, size);
  ctx.fillStyle = "rgba(160,140,110,0.07)";
  for (let x = 0; x < size; x += 32) ctx.fillRect(x, 0, 10, size);
  drawMottle(ctx, rand, size, 2500, "120,105,85", 0.06);
  drawMottle(ctx, rand, size, 1200, "255,255,255", 0.12);
  return toRepeatTexture(canvas, maxAnisotropy);
}

/** フローリング（横向きの板 8 列，列ごとに継ぎ目をずらす）．1 枚 = 1.2m 四方 */
export function createFlooringTexture(maxAnisotropy: number): THREE.CanvasTexture {
  const size = 512;
  const rows = 8;
  const rowHeight = size / rows;
  const [canvas, ctx] = createCanvas(size, size);
  const rand = mulberry32(202);
  const boardColor = (): string => {
    const l = randomRange(rand, 44, 56);
    const s = randomRange(rand, 38, 48);
    return `hsl(${randomRange(rand, 26, 32).toFixed(1)},${s.toFixed(1)}%,${l.toFixed(1)}%)`;
  };
  for (let row = 0; row < rows; row++) {
    const y = row * rowHeight;
    // 1 列に 2 枚の板．継ぎ目の位置を列ごとにずらし，右端は左端へ回り込ませる
    const seam = Math.floor(rand() * size);
    ctx.fillStyle = boardColor();
    ctx.fillRect(0, y, size, rowHeight);
    ctx.fillStyle = boardColor();
    ctx.fillRect(seam, y, size / 2, rowHeight);
    ctx.fillRect(seam - size, y, size / 2, rowHeight);
    // 木目（横に流れる細い線．周期を幅の約数にして左右をつなげる）
    const lines = randomInt(rand, 5, 9);
    for (let i = 0; i < lines; i++) {
      const baseY = y + randomRange(rand, 4, rowHeight - 4);
      const amp = randomRange(rand, 0.5, 2.5);
      const waves = randomInt(rand, 1, 4);
      const phase = rand() * Math.PI * 2;
      ctx.strokeStyle = `rgba(80,52,30,${randomRange(rand, 0.1, 0.25).toFixed(3)})`;
      ctx.lineWidth = randomRange(rand, 0.6, 1.4);
      ctx.beginPath();
      for (let x = 0; x <= size; x += 8) {
        const yy = baseY + Math.sin((x / size) * Math.PI * 2 * waves + phase) * amp;
        if (x === 0) ctx.moveTo(x, yy);
        else ctx.lineTo(x, yy);
      }
      ctx.stroke();
    }
    // 継ぎ目（列の境と板の端）
    ctx.fillStyle = "rgba(55,35,20,0.55)";
    ctx.fillRect(0, y, size, 2);
    ctx.fillRect(seam, y, 2, rowHeight);
    ctx.fillRect((seam + size / 2) % size, y, 2, rowHeight);
  }
  return toRepeatTexture(canvas, maxAnisotropy);
}

/** 天井（白に近い色＋まだら）．1 枚 = 1m 四方 */
export function createCeilingTexture(maxAnisotropy: number): THREE.CanvasTexture {
  const size = 256;
  const [canvas, ctx] = createCanvas(size, size);
  const rand = mulberry32(303);
  ctx.fillStyle = "#f2f1ec";
  ctx.fillRect(0, 0, size, size);
  drawMottle(ctx, rand, size, 2000, "150,145,130", 0.06);
  return toRepeatTexture(canvas, maxAnisotropy);
}

/** 窓の外の景色の範囲（ワールド座標の高さ，m）．板の下端と上端に合わせる */
export interface SkyRange {
  readonly bottom: number;
  readonly top: number;
}

/** 窓の外の景色（空のグラデーション＋遠くの木々＋地面）．板全体に 1 枚で貼る */
export function createSkyTexture(range: SkyRange): THREE.CanvasTexture {
  const width = 512;
  const height = 512;
  const [canvas, ctx] = createCanvas(width, height);
  const rand = mulberry32(404);
  // ワールドの高さ（m）を canvas の y（px）に変換する
  const toY = (worldY: number): number =>
    ((range.top - worldY) / (range.top - range.bottom)) * height;
  const groundTop = toY(0.3);

  const sky = ctx.createLinearGradient(0, 0, 0, groundTop);
  sky.addColorStop(0, "#5c9bd5");
  sky.addColorStop(0.7, "#a9cbe6");
  sky.addColorStop(1, "#e6eff5");
  ctx.fillStyle = sky;
  ctx.fillRect(0, 0, width, groundTop);

  // 遠くの木々の帯（丸を重ねて輪郭をでこぼこにする．奥の列ほど霞ませる）
  const layers = [
    { color: "rgba(110,140,115,0.85)", top: 1.5, radius: [10, 18] },
    { color: "rgba(76,110,72,1)", top: 1.1, radius: [8, 14] },
  ] as const;
  for (const layer of layers) {
    ctx.fillStyle = layer.color;
    const crown = toY(layer.top);
    ctx.fillRect(0, crown, width, groundTop - crown + 1);
    for (let x = -10; x < width + 10; x += 6) {
      const r = randomRange(rand, layer.radius[0], layer.radius[1]);
      ctx.beginPath();
      ctx.arc(x, crown + randomRange(rand, -2, 6), r, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  const ground = ctx.createLinearGradient(0, groundTop, 0, height);
  ground.addColorStop(0, "#7ba25e");
  ground.addColorStop(1, "#557d40");
  ctx.fillStyle = ground;
  ctx.fillRect(0, groundTop, width, height - groundTop);

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}
