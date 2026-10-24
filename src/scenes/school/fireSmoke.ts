// 火と煙の見た目（F4）の組み立て．濃さは fireSmokeLayout.ts の純粋な関数で求める．
// - 煙: 階ごとに校舎全体を覆う SMOKE_LAYER_COUNT 枚の水平な板（全階で 1 つのメッシュ）．各マスの濃さを 1 マス 1 テクセルの
//   DataTexture に書き，なめらかに補間して読み，流れるノイズでむらと揺らぎを出す（マスの境目を見せない）
// - 炎: 決まった数の粒（1 つの InstancedBufferGeometry．描画 1 回）を燃えているマスの中から立ち上らせる．動きはシェーダーで時刻から求める
// - 床の照り返し: 燃えているマスの周りの床を加算の板 1 枚（階ごと）でうっすら照らす
// - 目の位置の煙: フォグ（FogExp2）の濃さで表す（しゃがむと晴れる）
// 校舎の root に object を足し，scene.fog に fog を付け，毎フレーム update(秒, 目の位置) を呼ぶだけで使える．光源は使わない

import * as THREE from "three";
import type { SchoolPlan } from "../../core/schoolPlan";
import type { SpreadMap } from "../../sim/spread";
import { disposeObjectTree } from "../common/meshHelpers";
import {
  type CellAtlas,
  cellTexelCoord,
  chooseParticleSpawn,
  createCellAtlas,
  createFireParticleSeeds,
  type EyePosition,
  eyeSmokeDensity,
  FIRE_LOOK,
  FIRE_PARTICLES,
  type FireParticleSeed,
  type FireSmokeCells,
  floorBaseY,
  HIDDEN_IGNITION_SECONDS,
  listFireSmokeCells,
  type ParticleSpawn,
  particleCycle,
  SMOKE_CEILING_HEIGHT,
  SMOKE_FOG,
  SMOKE_LAYER_COUNT,
  SMOKE_LOOK,
  smokeFogDensity,
  smokeLayerHeight,
  smokeLayerSpacing,
  sortByIgnition,
  writeCellTexels,
} from "./fireSmokeLayout";

/** 火と煙をまとめた Group の名前（テスト・確認用の表示で探すため） */
export const FIRE_SMOKE_NAME = "fire-smoke";

/** 炎の粒のメッシュの名前 */
export const FIRE_MESH_NAME = `${FIRE_SMOKE_NAME}-fire`;

/** 煙の層のメッシュの名前 */
export const SMOKE_MESH_NAME = `${FIRE_SMOKE_NAME}-smoke`;

/** 床の照り返しのメッシュの名前 */
export const GLOW_MESH_NAME = `${FIRE_SMOKE_NAME}-glow`;

/** 煙の層の基本の色（フォグの色と同じ灰色） */
export const SMOKE_LAYER_COLOR = SMOKE_FOG.color;

/**
 * 煙の層の見た目の値（仮の値．デモの校舎で見て決め直す）
 */
export const SMOKE_SHADE = {
  /** 煙の濃さ 1 で厚み 1 m を通した時の光の弱まり方（1/m）．層 1 枚の不透明度は 1 - exp(-値 × 濃さ × 厚み) */
  extinction: 0.9,
  /** 1 枚の層の不透明度の上限（0〜1） */
  maxOpacity: 0.92,
  /** 層を斜めに見た時の厚みの上限（真上から見た厚みの倍率）．真横から見て不透明になりすぎないようにする */
  maxSlant: 5,
  /** 濃い部分の色（火に近いほど・ノイズの谷ほどこの色に寄る） */
  darkColor: 0x2b2826,
  /** 薄い部分の色（ノイズの山） */
  lightColor: 0x7c7976,
  /** 火の近くの煙の下面を照らす色（加える量．0xRRGGBB） */
  glowColor: 0x6a2808,
  /** マスの境目を崩すために読む位置をずらす量（マス） */
  warpCells: 0.7,
  /** 煙のノイズの細かさ（1/m） */
  noiseScale: 0.55,
  /** 煙が流れる速さ（m/s 相当．ノイズの位置を動かす） */
  flowSpeed: 0.12,
} as const;

/** 床の照り返しの値 */
export const FIRE_GLOW = {
  /** 床の上に浮かせる高さ（m）．床の面と重なってちらつかないようにする */
  lift: 0.015,
  /** 照り返しの色（加算する明るさの最大．画面の色の値で 0〜1） */
  color: [0.5, 0.17, 0.04] as const,
} as const;

/** 炎の粒の見た目の値（シェーダーに埋め込む．色は画面の色の値で 0〜1） */
export const FIRE_PARTICLE_LOOK = {
  /** 寿命のうち炎として光る割合（0〜1）．残りは黒っぽい煙になって天井へ昇る */
  flamePart: 0.55,
  /** 煙になった粒が昇る高さ（m．床から） */
  smokeTop: SMOKE_CEILING_HEIGHT - 0.3,
  /** 炎の粒 1 つの明るさ（0〜1）．重なっても白く飛ばないよう低くする */
  emission: 0.3,
  /** 炎の粒 1 つの不透明度（0〜1）．後ろを少し隠し，加算だけで白く飛ぶのを防ぐ */
  flameAlpha: 0.18,
  /** 煙になった粒の不透明度（0〜1） */
  smokeAlpha: 0.45,
  core: [1.0, 0.84, 0.5] as const,
  orange: [1.0, 0.42, 0.08] as const,
  red: [0.5, 0.07, 0.02] as const,
  smoke: [0.06, 0.055, 0.05] as const,
} as const;

/** その時刻の様子（確認用の表示・テスト用．update のたびに書き換わる） */
export interface FireSmokeStats {
  /** 前の update の時刻（s） */
  readonly seconds: number;
  /** 燃えているマスの数 */
  readonly burningCells: number;
  /** 煙の濃さが 0 より大きいマスの数 */
  readonly smokyCells: number;
  /** 目の位置の煙の濃さ（0〜1）．目の位置を渡さなかった時は 0 */
  readonly eyeSmoke: number;
  /** フォグの濃さ（1/m） */
  readonly fogDensity: number;
}

/** 火と煙の見た目 */
export interface FireSmoke {
  /** 炎・煙の層・床の照り返しをまとめた Group（校舎の root に add する．ワールド座標で置いてあるので，root は原点のままでよい） */
  readonly object: THREE.Group;
  /**
   * 目の位置の煙を表すフォグ．空間全体に効くため，呼び出し側が scene.fog に付ける（scene.fog = fireSmoke.fog）．
   * 濃さは update が書き換える（煙の外では 0）．画面を切り替える時は呼び出し側が scene.fog を外す
   */
  readonly fog: THREE.FogExp2;
  /** 描画の対象のマス（火・煙が着くマス．確認用の表示・テスト用） */
  readonly cells: FireSmokeCells;
  /** 前の update の時の様子 */
  readonly stats: FireSmokeStats;
  /**
   * 今の時刻に合わせる．毎フレーム呼ぶ．
   * @param seconds 非常ベルからの秒数（s）．NaN・負の時刻は何も燃えていない状態になる
   * @param eye 目の位置（ワールド座標，m）．null の時はフォグを 0 にする（見下ろす視点等）．炎の粒を目に近いマスへ多く出すのにも使う
   */
  update(seconds: number, eye: EyePosition | null): void;
  /** ジオメトリ・マテリアル・テクスチャを解放する（object を親から外す・scene.fog を外すのは呼び出し側） */
  dispose(): void;
}

/** GLSL に埋め込む小数（整数でも小数点を付ける） */
function glslFloat(value: number): string {
  return value.toFixed(5);
}

function glslVec3(rgb: readonly [number, number, number]): string {
  return `vec3(${rgb.map(glslFloat).join(", ")})`;
}

/** 値ノイズと fbm（煙・炎で共通．テクスチャを使わずに求める） */
const NOISE_GLSL = /* glsl */ `
float fsHash(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}
float fsNoise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  float a = fsHash(i);
  float b = fsHash(i + vec2(1.0, 0.0));
  float c = fsHash(i + vec2(0.0, 1.0));
  float d = fsHash(i + vec2(1.0, 1.0));
  return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
}
float fsFbm(vec2 p) {
  float v = 0.0;
  float a = 0.5;
  for (int k = 0; k < 3; k++) {
    v += a * fsNoise(p);
    p = p * 2.03 + vec2(17.1, 9.2);
    a *= 0.5;
  }
  return v / 0.875;
}
`;

/**
 * マスごとの表を読む．線形補間の重みを smoothstep にして，マスの中心どうしの間をなめらかにつなぐ
 * （ただの線形補間だとマスの形のひし形の模様が出るため）．texel はテクセル単位の座標（テクセルの中心が +0.5）
 */
const SAMPLE_CELLS_GLSL = /* glsl */ `
uniform sampler2D uCells;
uniform vec2 uCellsSize;
vec4 sampleCells(vec2 texel) {
  vec2 q = texel - 0.5;
  vec2 i = floor(q);
  vec2 f = fract(q);
  f = f * f * (3.0 - 2.0 * f);
  return texture2D(uCells, (i + f + 0.5) / uCellsSize);
}
`;

/** 煙の層・床の照り返しの頂点シェーダー（板の頂点はワールド座標．aGrid はテクセルの座標，aHeight は床からの高さ） */
const CELL_PLANE_VERTEX_SHADER = /* glsl */ `
attribute vec2 aGrid;
attribute float aHeight;
varying vec2 vGrid;
varying float vHeight;
varying vec3 vWorld;
#include <fog_pars_vertex>
void main() {
  vGrid = aGrid;
  vHeight = aHeight;
  vec4 world = modelMatrix * vec4(position, 1.0);
  vWorld = world.xyz;
  vec4 mvPosition = viewMatrix * world;
  gl_Position = projectionMatrix * mvPosition;
  #include <fog_vertex>
}
`;

const SMOKE_FRAGMENT_SHADER = /* glsl */ `
uniform float uTime;
uniform float uSpacing;
uniform vec3 uColor;
uniform vec3 uDarkColor;
uniform vec3 uLightColor;
uniform vec3 uGlowColor;
varying vec2 vGrid;
varying float vHeight;
varying vec3 vWorld;
${NOISE_GLSL}
${SAMPLE_CELLS_GLSL}
#include <fog_pars_fragment>
// fireSmokeLayout.ts の smokeAtHeight と同じ式（天井に近いほど濃く，下の端をぼかす）
float smokeAtHeight(float d, float h) {
  float ceiling = ${glslFloat(SMOKE_CEILING_HEIGHT)};
  float bottom = ceiling - d * (ceiling - ${glslFloat(SMOKE_LOOK.fullBottom)});
  float haze = ${glslFloat(SMOKE_LOOK.hazeRatio)} * d;
  float bottomRatio = ${glslFloat(SMOKE_LOOK.bottomRatio)};
  if (h < bottom) {
    float t = smoothstep(bottom - ${glslFloat(SMOKE_LOOK.softEdge)}, bottom, h);
    return haze + (bottomRatio * d - haze) * t;
  }
  float span = ceiling - bottom;
  float t = span > 0.0 ? clamp((h - bottom) / span, 0.0, 1.0) : 1.0;
  return d * (bottomRatio + (1.0 - bottomRatio) * t);
}
void main() {
  // 層ごとに模様と流れる向きをずらし，重なった層が同じ模様に見えないようにする
  vec2 flow = vec2(0.8, 0.5 + 0.3 * sin(vHeight * 2.0)) * (uTime * ${glslFloat(SMOKE_SHADE.flowSpeed)});
  vec2 np = vWorld.xz * ${glslFloat(SMOKE_SHADE.noiseScale)} + vec2(vHeight * 3.7, vHeight * 1.3);
  vec2 warp = vec2(fsNoise(np * 0.7 + flow + 3.1), fsNoise(np * 0.7 - flow.yx + 7.7)) - 0.5;
  vec4 cell = sampleCells(vGrid + warp * ${glslFloat(SMOKE_SHADE.warpCells)});
  float d = cell.r;
  if (d < 0.004) discard;
  float n = fsFbm(np + warp * 1.5 + flow * 2.0);
  float s = smokeAtHeight(d, vHeight) * mix(0.3, 1.4, n);
  // 斜めに見るほど層の中を長く通るので濃くする（立体の煙を板で近づける）
  vec3 toEye = cameraPosition - vWorld;
  float slant = min(length(toEye) / max(abs(toEye.y), 1e-4), ${glslFloat(SMOKE_SHADE.maxSlant)});
  float alpha = 1.0 - exp(-${glslFloat(SMOKE_SHADE.extinction)} * s * uSpacing * slant);
  // 目の高さとほぼ同じ層は真横から見て線になるので消す（目の位置の煙はフォグで表す）
  alpha *= smoothstep(0.02, 0.25, abs(toEye.y));
  alpha = min(alpha, ${glslFloat(SMOKE_SHADE.maxOpacity)});
  if (alpha < 0.004) discard;
  vec3 color = mix(uDarkColor, uLightColor, n);
  color = mix(color, uColor, 0.4);
  color = mix(color, uDarkColor, clamp(cell.g * 0.8, 0.0, 1.0));
  // 下の層ほど火の照り返しを受ける
  float low = clamp((${glslFloat(SMOKE_CEILING_HEIGHT)} - vHeight) / ${glslFloat(SMOKE_CEILING_HEIGHT - SMOKE_LOOK.fullBottom)}, 0.0, 1.0);
  color += uGlowColor * cell.b * (0.4 + 0.6 * low);
  gl_FragColor = vec4(color, alpha);
  #include <colorspace_fragment>
  #include <fog_fragment>
}
`;

/** 床の照り返し（加算）．色は画面の色の値で書くので colorspace の変換をしない */
const GLOW_FRAGMENT_SHADER = /* glsl */ `
uniform float uTime;
varying vec2 vGrid;
varying float vHeight;
varying vec3 vWorld;
${NOISE_GLSL}
${SAMPLE_CELLS_GLSL}
void main() {
  float g = sampleCells(vGrid).b;
  if (g < 0.004) discard;
  float flicker = 0.7 + 0.3 * fsNoise(vWorld.xz * 1.3 + vec2(uTime * 2.1, -uTime * 1.7));
  gl_FragColor = vec4(${glslVec3(FIRE_GLOW.color)} * (g * flicker), 1.0);
}
`;

const P = FIRE_PARTICLE_LOOK;

/**
 * 炎の粒の頂点シェーダー．粒の年齢（0〜1）を時刻から求め（fireSmokeLayout.ts の particleCycle と同じ式の小数部分），
 * 昇る・揺れる・大きさを変える．カメラを向く板（ビルボード）にする
 * - aSeed: 生まれる時刻のずれ（0〜1）・寿命（s）・大きさのばらつき・揺れ方のばらつき
 * - aSpawn: 生まれる位置（x・床の y・z）と，割り当てたマスに火が着く時刻（s）
 * - aBoost: 粒の大きさの倍率
 */
const FIRE_VERTEX_SHADER = /* glsl */ `
attribute vec4 aSeed;
attribute vec4 aSpawn;
attribute float aBoost;
uniform float uTime;
varying vec2 vUv;
varying float vAge;
varying float vHeat;
varying float vSeed;
varying float vFade;
void main() {
  float burn = uTime - aSpawn.w;
  if (burn < 0.0) {
    // まだ燃えていない（出さない粒を含む）: 画面の外に置いて描かない
    gl_Position = vec4(0.0, 0.0, 2.0, 1.0);
    return;
  }
  float minI = ${glslFloat(FIRE_LOOK.minIntensity)};
  float heat = minI + (1.0 - minI) * smoothstep(0.0, ${glslFloat(FIRE_LOOK.growSeconds)}, burn);
  float age = fract(uTime / aSeed.y + aSeed.x);
  float flamePart = ${glslFloat(P.flamePart)};
  float flameTop = ${glslFloat(FIRE_LOOK.maxHeight)} * heat * (0.8 + 0.4 * aSeed.z);
  float y;
  float size;
  float spread = 0.0;
  if (age < flamePart) {
    float t = age / flamePart;
    // 上ほど速く昇り，細くなる
    y = flameTop * t * (0.6 + 0.4 * t);
    size = mix(0.62, 0.22, t);
  } else {
    float t = (age - flamePart) / (1.0 - flamePart);
    // 煙になって天井へ昇り，天井の近くで横へ広がる
    y = mix(flameTop, ${glslFloat(P.smokeTop)}, t * (2.0 - t));
    size = mix(0.3, 0.9, t);
    spread = t * t * 0.6;
  }
  // 大きさは m（マスの一辺 1 m を基準に決めた値）
  size *= (0.75 + 0.5 * aSeed.z) * mix(0.55, 1.0, heat) * aBoost;
  float swayAmp = 0.04 + 0.14 * age;
  float sa = aSeed.w * 6.2832;
  vec2 sway = vec2(
    sin(uTime * 2.7 + sa + y * 2.1),
    cos(uTime * 2.3 + aSeed.w * 5.1 + y * 1.7)
  ) * swayAmp + vec2(cos(sa), sin(sa)) * spread;
  vec3 center = vec3(aSpawn.x + sway.x, aSpawn.y + 0.05 + y, aSpawn.z + sway.y);
  vec4 mv = modelViewMatrix * vec4(center, 1.0);
  // 粒ごとに板を回して，ノイズの模様の向きをそろえない
  float angle = sa + uTime * (aSeed.z - 0.5);
  float c = cos(angle);
  float s = sin(angle);
  mv.xy += vec2(c * position.x - s * position.y, s * position.x + c * position.y) * size;
  gl_Position = projectionMatrix * mv;
  vUv = position.xy * 2.0;
  vAge = age;
  vHeat = heat;
  vSeed = aSeed.w;
  // 生まれる時と消える時をなめらかにし，目の前に来た粒は消す（画面を覆うと重く，見にくいため）
  vFade = smoothstep(0.0, 0.08, age) * (1.0 - smoothstep(0.8, 1.0, age)) * smoothstep(0.2, 0.8, -mv.z);
}
`;

/**
 * 炎の粒のフラグメントシェーダー．円いぼかしをノイズで崩した形にし，年齢で「白黄の芯 → 橙 → 暗い赤 → 黒っぽい煙」と色を変える．
 * 出力は乗算済みのアルファ（合成は One, OneMinusSrcAlpha）: 炎は光を足しつつ後ろを少しだけ隠し，煙は普通に後ろを隠す．
 * 色は画面の色の値で書くので colorspace の変換をしない
 */
const FIRE_FRAGMENT_SHADER = /* glsl */ `
uniform float uTime;
varying vec2 vUv;
varying float vAge;
varying float vHeat;
varying float vSeed;
varying float vFade;
${NOISE_GLSL}
void main() {
  float r = length(vUv);
  if (r > 1.0) discard;
  float n = fsNoise(vUv * 2.2 + vec2(vSeed * 37.0, vSeed * 11.0 - uTime * 1.6)) * 0.65
    + fsNoise(vUv * 4.7 + vec2(vSeed * 13.0 + uTime * 0.9, vSeed * 29.0)) * 0.35;
  float shape = 1.0 - smoothstep(0.15, 1.0, r + (n - 0.5) * 0.7);
  float a = shape * shape * vFade;
  if (a < 0.004) discard;
  float flamePart = ${glslFloat(P.flamePart)};
  float flame = 1.0 - smoothstep(flamePart * 0.75, flamePart * 1.2, vAge);
  float t = clamp(vAge / flamePart, 0.0, 1.0);
  vec3 col = mix(${glslVec3(P.core)}, ${glslVec3(P.orange)}, smoothstep(0.0, 0.4, t));
  col = mix(col, ${glslVec3(P.red)}, smoothstep(0.4, 1.0, t));
  col = mix(col, ${glslVec3(P.core)}, (1.0 - r) * (1.0 - t) * 0.5);
  vec3 emit = col * (${glslFloat(P.emission)} * mix(0.6, 1.0, vHeat) * a * flame);
  float smokeA = a * (1.0 - flame) * ${glslFloat(P.smokeAlpha)};
  gl_FragColor = vec4(emit + ${glslVec3(P.smoke)} * smokeA, a * flame * ${glslFloat(P.flameAlpha)} + smokeA);
}
`;

/** 水平な板（4 頂点）を足す．位置はワールド座標，aGrid はテクセルの座標 */
function pushPlane(
  positions: number[],
  grids: number[],
  heights: number[],
  indices: number[],
  atlas: CellAtlas,
  cellSize: number,
  floor: number,
  sizeX: number,
  sizeZ: number,
  y: number,
  heightAboveFloor: number,
): void {
  const base = positions.length / 3;
  for (const [x, z] of [
    [0, 0],
    [sizeX, 0],
    [sizeX, sizeZ],
    [0, sizeZ],
  ] as const) {
    positions.push(x, y, z);
    const t = cellTexelCoord(atlas, cellSize, floor, x, z);
    grids.push(t.u, t.v);
    heights.push(heightAboveFloor);
  }
  indices.push(base, base + 2, base + 1, base, base + 3, base + 2);
}

/**
 * 全ての階の水平な板をまとめた形を作る．layers は床からの高さの並び（煙の層は天井の側から，照り返しは 1 枚）
 */
function createCellPlanesGeometry(
  plan: SchoolPlan,
  atlas: CellAtlas,
  layers: readonly number[],
): THREE.BufferGeometry {
  const positions: number[] = [];
  const grids: number[] = [];
  const heights: number[] = [];
  const indices: number[] = [];
  plan.floors.forEach((floor, f) => {
    const baseY = floorBaseY(floor.level);
    for (const h of layers) {
      pushPlane(
        positions,
        grids,
        heights,
        indices,
        atlas,
        plan.cellSize,
        f,
        floor.width * plan.cellSize,
        floor.depth * plan.cellSize,
        baseY + h,
        h,
      );
    }
  });
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute("aGrid", new THREE.Float32BufferAttribute(grids, 2));
  geometry.setAttribute("aHeight", new THREE.Float32BufferAttribute(heights, 1));
  geometry.setIndex(indices);
  return geometry;
}

/** 炎の粒の形（1 × 1 の板を粒の数だけ instancing で描く） */
function createParticleGeometry(seeds: readonly FireParticleSeed[]): {
  geometry: THREE.InstancedBufferGeometry;
  spawn: THREE.InstancedBufferAttribute;
  boost: THREE.InstancedBufferAttribute;
} {
  const geometry = new THREE.InstancedBufferGeometry();
  geometry.setAttribute(
    "position",
    new THREE.Float32BufferAttribute([-0.5, -0.5, 0, 0.5, -0.5, 0, 0.5, 0.5, 0, -0.5, 0.5, 0], 3),
  );
  geometry.setIndex([0, 1, 2, 0, 2, 3]);
  const count = seeds.length;
  const seedArray = new Float32Array(count * 4);
  seeds.forEach((s, i) => {
    seedArray.set([s.phase, s.lifeSeconds, s.size, s.sway], i * 4);
  });
  geometry.setAttribute("aSeed", new THREE.InstancedBufferAttribute(seedArray, 4));
  const spawnArray = new Float32Array(count * 4);
  for (let i = 0; i < count; i++) spawnArray[i * 4 + 3] = HIDDEN_IGNITION_SECONDS;
  const spawn = new THREE.InstancedBufferAttribute(spawnArray, 4);
  spawn.setUsage(THREE.DynamicDrawUsage);
  const boost = new THREE.InstancedBufferAttribute(new Float32Array(count).fill(1), 1);
  boost.setUsage(THREE.DynamicDrawUsage);
  geometry.setAttribute("aSpawn", spawn);
  geometry.setAttribute("aBoost", boost);
  geometry.instanceCount = count;
  return { geometry, spawn, boost };
}

/**
 * 火と煙の見た目を作る．spread は computeSpread(plan) の結果（作る時に 1 回だけ読む）．
 * 火も煙も着かない校舎では，中身が空の object を返す（update はフォグを 0 にするだけ）
 */
export function createFireSmoke(plan: SchoolPlan, spread: SpreadMap): FireSmoke {
  const cells = listFireSmokeCells(plan, spread);
  const group = new THREE.Group();
  group.name = FIRE_SMOKE_NAME;
  const fog = new THREE.FogExp2(SMOKE_FOG.color, 0);
  const timeUniform = { value: 0 };

  // ---- マスごとの濃さの表（1 マス 1 テクセル．全階を 1 枚に積む） ----
  const atlas = createCellAtlas(plan);
  const texelData = new Uint8Array(atlas.width * atlas.height * 4);
  const texelScratch = new Uint8Array(texelData.length);
  const cellTexture = new THREE.DataTexture(
    texelData,
    atlas.width,
    atlas.height,
    THREE.RGBAFormat,
    THREE.UnsignedByteType,
  );
  cellTexture.name = `${FIRE_SMOKE_NAME}-cells`;
  cellTexture.magFilter = THREE.LinearFilter;
  cellTexture.minFilter = THREE.LinearFilter;
  cellTexture.generateMipmaps = false;
  cellTexture.wrapS = THREE.ClampToEdgeWrapping;
  cellTexture.wrapT = THREE.ClampToEdgeWrapping;
  cellTexture.needsUpdate = true;
  // テクスチャ・時刻の uniform は煙と照り返しのマテリアルで共有する（UniformsUtils.merge に通すと複製されるため直接渡す）
  const cellsUniform = { value: cellTexture };
  const cellsSizeUniform = {
    value: new THREE.Vector2(atlas.width, atlas.height),
  };

  // ---- 床の照り返し: 階ごとに 1 枚（全階で 1 つのメッシュ）．火が着かない校舎では作らない ----
  if (cells.fire.length > 0) {
    const material = new THREE.ShaderMaterial({
      name: GLOW_MESH_NAME,
      uniforms: {
        uTime: timeUniform,
        uCells: cellsUniform,
        uCellsSize: cellsSizeUniform,
      },
      vertexShader: CELL_PLANE_VERTEX_SHADER,
      fragmentShader: GLOW_FRAGMENT_SHADER,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      fog: false,
    });
    const mesh = new THREE.Mesh(createCellPlanesGeometry(plan, atlas, [FIRE_GLOW.lift]), material);
    mesh.name = GLOW_MESH_NAME;
    mesh.frustumCulled = false;
    mesh.renderOrder = 0;
    group.add(mesh);
  }

  // ---- 煙の層: 階ごとに SMOKE_LAYER_COUNT 枚（全階で 1 つのメッシュ）．天井の側から順に描く ----
  if (cells.smoke.length > 0) {
    const layers = Array.from({ length: SMOKE_LAYER_COUNT }, (_, i) => smokeLayerHeight(i));
    const material = new THREE.ShaderMaterial({
      name: SMOKE_MESH_NAME,
      uniforms: {
        ...THREE.UniformsUtils.clone(THREE.UniformsLib.fog),
        uTime: timeUniform,
        uCells: cellsUniform,
        uCellsSize: cellsSizeUniform,
        uSpacing: { value: smokeLayerSpacing() },
        uColor: { value: new THREE.Color(SMOKE_LAYER_COLOR) },
        uDarkColor: { value: new THREE.Color(SMOKE_SHADE.darkColor) },
        uLightColor: { value: new THREE.Color(SMOKE_SHADE.lightColor) },
        uGlowColor: { value: new THREE.Color(SMOKE_SHADE.glowColor) },
      },
      vertexShader: CELL_PLANE_VERTEX_SHADER,
      fragmentShader: SMOKE_FRAGMENT_SHADER,
      transparent: true,
      depthWrite: false,
      side: THREE.DoubleSide,
      fog: true,
    });
    const mesh = new THREE.Mesh(createCellPlanesGeometry(plan, atlas, layers), material);
    mesh.name = SMOKE_MESH_NAME;
    mesh.frustumCulled = false;
    mesh.renderOrder = 1;
    group.add(mesh);
  }

  // ---- 炎の粒: FIRE_PARTICLES.count 個（描画 1 回）．火が着かない校舎では作らない ----
  const sortedFire = sortByIgnition(cells.fire);
  const particleCount = FIRE_PARTICLES.count;
  const seeds = createFireParticleSeeds(particleCount);
  // 粒ごとの「今の生まれ直しの回数」．変わった粒だけ位置を書き直す（NaN は未設定）
  const cycles = new Float64Array(particleCount).fill(Number.NaN);
  const spawn: ParticleSpawn = {
    active: false,
    x: 0,
    y: 0,
    z: 0,
    ignition: 0,
    boost: 1,
  };
  let fireMesh: THREE.Mesh | null = null;
  let spawnAttr: THREE.InstancedBufferAttribute | null = null;
  let boostAttr: THREE.InstancedBufferAttribute | null = null;
  if (cells.fire.length > 0) {
    const particles = createParticleGeometry(seeds);
    spawnAttr = particles.spawn;
    boostAttr = particles.boost;
    // 炎は光を足し，煙は後ろを隠す（乗算済みのアルファ）．光源は付けない．煙の中でも火の位置が分かるようフォグを効かせない
    const material = new THREE.ShaderMaterial({
      name: FIRE_MESH_NAME,
      uniforms: { uTime: timeUniform },
      vertexShader: FIRE_VERTEX_SHADER,
      fragmentShader: FIRE_FRAGMENT_SHADER,
      transparent: true,
      depthWrite: false,
      blending: THREE.CustomBlending,
      blendEquation: THREE.AddEquation,
      blendSrc: THREE.OneFactor,
      blendDst: THREE.OneMinusSrcAlphaFactor,
      fog: false,
    });
    fireMesh = new THREE.Mesh(particles.geometry, material);
    fireMesh.name = FIRE_MESH_NAME;
    // 粒の位置はシェーダーで決まるため，視野外の判定をしない（校舎全体に広がる）
    fireMesh.frustumCulled = false;
    fireMesh.renderOrder = 2;
    group.add(fireMesh);
  }

  const stats = {
    seconds: Number.NaN,
    burningCells: 0,
    smokyCells: 0,
    eyeSmoke: 0,
    fogDensity: 0,
  };

  /** 表を書き直し，中身が変わった時だけ GPU へ送る */
  function updateCells(seconds: number): void {
    const counts = writeCellTexels(plan, cells, atlas, seconds, texelScratch);
    stats.burningCells = counts.burningCells;
    stats.smokyCells = counts.smokyCells;
    let changed = false;
    for (let i = 0; i < texelData.length; i++) {
      if (texelData[i] !== texelScratch[i]) {
        changed = true;
        break;
      }
    }
    if (changed) {
      texelData.set(texelScratch);
      cellTexture.needsUpdate = true;
    }
  }

  /** 生まれ直した粒だけ，燃えているマスの中の新しい位置を書く */
  function updateParticles(seconds: number, eye: EyePosition | null): void {
    if (fireMesh === null || spawnAttr === null || boostAttr === null) return;
    // 時刻が NaN・無限の時は粒の年齢を求められないので描かない
    fireMesh.visible = Number.isFinite(seconds);
    if (!fireMesh.visible) return;
    const spawnArray = spawnAttr.array as Float32Array;
    const boostArray = boostAttr.array as Float32Array;
    let changed = false;
    for (let i = 0; i < particleCount; i++) {
      const cycle = particleCycle(seeds[i], seconds);
      if (cycle === cycles[i]) continue;
      cycles[i] = cycle;
      chooseParticleSpawn(sortedFire, i, cycle, seeds[i], plan.cellSize, eye, spawn);
      const o = i * 4;
      spawnArray[o] = spawn.x;
      spawnArray[o + 1] = spawn.y;
      spawnArray[o + 2] = spawn.z;
      spawnArray[o + 3] = spawn.ignition;
      boostArray[i] = spawn.boost;
      changed = true;
    }
    if (changed) {
      spawnAttr.needsUpdate = true;
      boostAttr.needsUpdate = true;
    }
  }

  const fireSmoke: FireSmoke = {
    object: group,
    fog,
    cells,
    stats,
    update(seconds, eye) {
      // シェーダーの時刻は有限の時だけ進める（NaN を渡すと揺れ・粒の年齢が壊れるため）
      if (Number.isFinite(seconds)) timeUniform.value = seconds;
      stats.seconds = seconds;
      updateCells(seconds);
      updateParticles(seconds, eye);
      stats.eyeSmoke = eye === null ? 0 : eyeSmokeDensity(plan, spread, seconds, eye);
      stats.fogDensity = smokeFogDensity(stats.eyeSmoke);
      fog.density = stats.fogDensity;
    },
    dispose() {
      disposeObjectTree(group);
      // ShaderMaterial の uniforms の中のテクスチャは disposeObjectTree が見つけないため，別に解放する
      cellTexture.dispose();
    },
  };
  // 作った直後から時刻 0（非常ベル）の見た目にしておく
  fireSmoke.update(0, null);
  return fireSmoke;
}
