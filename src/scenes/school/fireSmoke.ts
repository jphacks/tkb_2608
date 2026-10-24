// 火と煙の見た目（F4）の組み立て．濃さは fireSmokeLayout.ts の純粋な関数で求める．
// - 煙: 階ごとに校舎全体を覆う SMOKE_LAYER_COUNT 枚の水平な板（全階で 1 つのメッシュ）．各マスの濃さを 1 マス 1 テクセルの
//   DataTexture に書き，なめらかに補間して読む（マスの境目を見せない）．4 段の billow ノイズを時刻でうねらせ，黒〜濃い灰色の
//   もくもくした塊にする．天井の膜（smokeShadeAtHeight）で，着いたばかりの煙が天井を這い，時間とともに下へ厚くなる様子を出す
// - 炎: 決まった数の粒（1 つの InstancedBufferGeometry．描画 1 回）を燃えているマスの中から立ち上らせる．動きはシェーダーで時刻から求める．
//   炎は根元が白〜黄，先が橙〜赤の縦長のしずく形で，昇りながらマスの中心へ寄って細く消える（ほぼ加算で光る）．
//   一部の粒（isEmberParticle）は炎の後に火の粉になって舞い上がる（粒の数・描画の回数は増やさない）
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
  isEmberParticle,
  listFireSmokeCells,
  type ParticleSpawn,
  particleCycle,
  SMOKE_CEILING_HEIGHT,
  SMOKE_FOG,
  SMOKE_LAYER_COUNT,
  SMOKE_LOOK,
  SMOKE_SHEET,
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
  /** 濃い部分の色（火に近いほど・塊の間の筋・下面ほどこの色に寄る．火災の煙は黒い） */
  darkColor: 0x0c0b0a,
  /** 明るい部分の色（塊の盛り上がった所） */
  lightColor: 0x55514d,
  /** 火の近くの煙の下面を照らす色（加える量．0xRRGGBB） */
  glowColor: 0x6a2808,
  /** マスの境目を崩すために読む位置をずらす量（マス） */
  warpCells: 0.7,
  /** 煙のノイズの細かさ（1/m）．塊 1 つがおよそ 1 / 値 m */
  noiseScale: 0.45,
  /** 煙が流れる速さ（m/s 相当．ノイズの位置を動かす） */
  flowSpeed: 0.12,
  /** 最も下の層で塊がまばらになる度合い（0〜1）．下面をもくもくさせ，天井の側は一様に近くする */
  lowSparseness: 0.25,
  /** 先端（煙の濃さが小さい所）をノイズで削る深さ（濃さ 0〜1 の単位）．先端を丸い塊が這い出す形にする */
  frontDepth: 0.15,
  /** 先端のぼかしの幅（濃さ 0〜1 の単位） */
  frontSoftness: 0.06,
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
  /** 寿命のうち炎として光る割合（0〜1）．残りは黒っぽい煙（火の粉の粒は火の粉）になって天井へ昇る */
  flamePart: 0.55,
  /** 煙になった粒が昇る高さ（m．床から） */
  smokeTop: SMOKE_CEILING_HEIGHT - 0.3,
  /** 炎の粒 1 つの明るさ（0〜1）．重なると根元が白く光る程度にする */
  emission: 0.34,
  /** 炎の粒の外側のにじみ（光って見える柔らかい縁）の明るさ（芯に対する割合） */
  halo: 0.35,
  /** 炎の粒 1 つの不透明度（0〜1）．ほぼ加算にしつつ，わずかに後ろを隠して白く飛びすぎるのを防ぐ */
  flameAlpha: 0.08,
  /** 煙になった粒の不透明度（0〜1） */
  smokeAlpha: 0.45,
  /** 炎の粒の縦横比（上の端で．根元は baseStretch）．縦に長いしずく形にする */
  stretch: 2.2,
  baseStretch: 1.5,
  /** 炎の先で生まれた位置からマスの中心へ寄せる割合（0〜1）．上ほど細くなる炎の形にする */
  taper: 0.6,
  /** 炎の揺らぎ（高さが伸び縮みする割合．0〜1） */
  flicker: 0.18,
  /** 火の粉の大きさ（m） */
  emberSize: 0.05,
  /** 火の粉の明るさ（0〜1 を超えてよい．小さいので明るくして見せる） */
  emberEmission: 1.4,
  /** 火の粉が昇る最も高い所（m．床から．天井より下） */
  emberTop: SMOKE_CEILING_HEIGHT - 0.1,
  /** 根元（白〜黄）・黄・橙・先（暗い赤）・煙の色 */
  white: [1.0, 0.95, 0.78] as const,
  yellow: [1.0, 0.74, 0.25] as const,
  orange: [1.0, 0.4, 0.07] as const,
  red: [0.55, 0.08, 0.02] as const,
  smoke: [0.05, 0.045, 0.04] as const,
  /** 火の粉の熱い時・冷えた時の色 */
  emberHot: [1.0, 0.75, 0.35] as const,
  emberCool: [0.8, 0.18, 0.03] as const,
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

/** 値ノイズ（煙・炎・照り返しで共通．テクスチャを使わずに求める） */
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
`;

/**
 * billow ノイズ（|2n - 1| を 4 段重ねる）．0 に近い所が塊の間の筋，大きい所が盛り上がった塊になり，もくもくした煙に見える
 */
const BILLOW_GLSL = /* glsl */ `
float fsBillow(vec2 p) {
  float v = 0.0;
  float a = 0.5;
  for (int k = 0; k < 4; k++) {
    v += a * abs(fsNoise(p) * 2.0 - 1.0);
    p = p * 2.07 + vec2(17.1, 9.2);
    a *= 0.5;
  }
  return v / 0.9375;
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
${BILLOW_GLSL}
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
// fireSmokeLayout.ts の smokeShadeAtHeight と同じ式（天井の膜を下限にする）
float smokeShadeAtHeight(float d, float h) {
  float ceiling = ${glslFloat(SMOKE_CEILING_HEIGHT)};
  float bottom = ceiling - d * (ceiling - ${glslFloat(SMOKE_LOOK.fullBottom)});
  float inside = smoothstep(bottom - ${glslFloat(SMOKE_LOOK.softEdge)}, bottom, h);
  float sheet = ${glslFloat(SMOKE_SHEET.strength)} * pow(d, ${glslFloat(SMOKE_SHEET.exponent)}) * inside;
  return max(smokeAtHeight(d, h), sheet);
}
void main() {
  float t = uTime * ${glslFloat(SMOKE_SHADE.flowSpeed)};
  // 層ごとに模様と流れる向きをずらし，重なった層が同じ模様に見えないようにする
  vec2 drift = vec2(0.8, 0.5 + 0.3 * sin(vHeight * 2.0)) * t;
  vec2 np = vWorld.xz * ${glslFloat(SMOKE_SHADE.noiseScale)} + vec2(vHeight * 3.7, vHeight * 1.3);
  // うねり: 流れと別の向き・速さで動くずらしで，模様が平行に流れるだけでなく形を変えながら渦を巻くようにする
  vec2 warp = vec2(
    fsNoise(np * 0.5 + drift + vec2(3.1, t * 0.7)),
    fsNoise(np * 0.5 - drift.yx + vec2(7.7 - t * 0.6, 1.9))
  ) - 0.5;
  vec4 cell = sampleCells(vGrid + warp * ${glslFloat(SMOKE_SHADE.warpCells)});
  float d = cell.r;
  if (d < 0.004) discard;
  float puff = smoothstep(0.08, 0.62, fsBillow(np + warp * 2.2 + drift * 1.5));
  float low = clamp((${glslFloat(SMOKE_CEILING_HEIGHT)} - vHeight) / ${glslFloat(SMOKE_CEILING_HEIGHT - SMOKE_LOOK.fullBottom)}, 0.0, 1.0);
  // 下の層ほど塊がまばら（下から見上げると煙の下面がもくもくして見える）
  float sparse = ${glslFloat(SMOKE_SHADE.lowSparseness)} * low;
  float cover = smoothstep(sparse - 0.15, sparse + 0.3, puff);
  // 先端（濃さが小さい所）をノイズで削り，丸い塊が這い出すように見せる
  float front = smoothstep(0.0, ${glslFloat(SMOKE_SHADE.frontSoftness)}, d - (1.0 - puff) * ${glslFloat(SMOKE_SHADE.frontDepth)});
  float s = smokeShadeAtHeight(d, vHeight) * cover * front * mix(0.55, 1.35, puff);
  // 斜めに見るほど層の中を長く通るので濃くする（立体の煙を板で近づける）
  vec3 toEye = cameraPosition - vWorld;
  float slant = min(length(toEye) / max(abs(toEye.y), 1e-4), ${glslFloat(SMOKE_SHADE.maxSlant)});
  float alpha = 1.0 - exp(-${glslFloat(SMOKE_SHADE.extinction)} * s * uSpacing * slant);
  // 目の高さとほぼ同じ層は真横から見て線になるので消す（目の位置の煙はフォグで表す）
  alpha *= smoothstep(0.02, 0.25, abs(toEye.y));
  alpha = min(alpha, ${glslFloat(SMOKE_SHADE.maxOpacity)});
  if (alpha < 0.004) discard;
  // 盛り上がった塊は明るく，塊の間の筋と下面（光が届かない）は黒に近くする
  vec3 color = mix(uDarkColor, uLightColor, puff * puff);
  color *= 1.0 - 0.35 * low;
  color = mix(color, uColor, 0.2);
  color = mix(color, uDarkColor, clamp(cell.g * 0.8, 0.0, 1.0));
  // 下の層ほど火の照り返しを受ける（塊の盛り上がった所ほど強く）
  color += uGlowColor * cell.b * (0.3 + 0.5 * low) * (0.4 + 0.6 * puff);
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
  // 炎の揺らぎに合わせて明るさを不規則に変える（速い揺れと遅い揺れを重ねる）
  float flicker = 0.6 + 0.25 * fsNoise(vWorld.xz * 1.3 + vec2(uTime * 2.1, -uTime * 1.7))
    + 0.15 * fsNoise(vWorld.xz * 0.6 + vec2(-uTime * 6.3, uTime * 5.1));
  gl_FragColor = vec4(${glslVec3(FIRE_GLOW.color)} * (g * flicker), 1.0);
}
`;

const P = FIRE_PARTICLE_LOOK;

/**
 * 炎の粒の頂点シェーダー．粒の年齢（0〜1）を時刻から求め（fireSmokeLayout.ts の particleCycle と同じ式の小数部分），
 * 昇る・揺れる・大きさを変える．カメラを向く板（ビルボード）にする
 * - aSeed: 生まれる時刻のずれ（0〜1）・寿命（s）・大きさのばらつき・揺れ方のばらつき
 * - aSpawn: 生まれる位置（x・床の y・z）と，割り当てたマスに火が着く時刻（s）
 * - aCenter: 割り当てたマスの中心（x・z）．炎の先をここへ寄せて細くする
 * - aBoost: 粒の大きさの倍率
 * - aKind: 1 なら炎の後に火の粉になる粒（isEmberParticle）
 * 炎の間は板を画面の上で「世界の上」へ向けた縦長にし，煙・火の粉になったら粒ごとに回す
 */
const FIRE_VERTEX_SHADER = /* glsl */ `
attribute vec4 aSeed;
attribute vec4 aSpawn;
attribute vec2 aCenter;
attribute float aBoost;
attribute float aKind;
uniform float uTime;
varying vec2 vUv;
varying float vAge;
varying float vHeat;
varying float vSeed;
varying float vFade;
varying float vFlame;
varying float vEmber;
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
  // 揺らぎ: 場所ごとに炎の高さが不規則に伸び縮みする（周期の違う 2 つの波を重ねる）
  float flick = 1.0 - ${glslFloat(P.flicker)} * (0.5
    + 0.3 * sin(uTime * 7.3 + aSpawn.x * 1.7 + aSpawn.z * 2.3)
    + 0.2 * sin(uTime * 12.7 + aSeed.w * 6.0));
  float flameTop = ${glslFloat(FIRE_LOOK.maxHeight)} * heat * (0.8 + 0.4 * aSeed.z) * flick;
  vec2 offset = aSpawn.xz - aCenter;
  bool ember = aKind > 0.5;
  float y;
  float size;
  float stretch = 1.0;
  float spread = 0.0;
  float swayAmp = 0.04 + 0.14 * age;
  if (age < flamePart) {
    float t = age / flamePart;
    // 上ほど速く昇り，マスの中心へ寄って細くなる
    y = flameTop * t * (0.6 + 0.4 * t);
    offset *= 1.0 - ${glslFloat(P.taper)} * t;
    size = mix(0.55, 0.17, t);
    stretch = mix(${glslFloat(P.baseStretch)}, ${glslFloat(P.stretch)}, t);
  } else {
    float t = (age - flamePart) / (1.0 - flamePart);
    offset *= 1.0 - ${glslFloat(P.taper)};
    if (ember) {
      // 火の粉: 炎の先から速く舞い上がり，大きくジグザグに揺れる
      y = mix(flameTop, ${glslFloat(P.emberTop)}, t * (2.0 - t) * (0.6 + 0.4 * aSeed.z));
      size = ${glslFloat(P.emberSize)} / max(aBoost, 1.0);
      swayAmp = 0.1 + 0.35 * t;
    } else {
      // 煙になって天井へ昇り，天井の近くで横へ広がる
      y = mix(flameTop, ${glslFloat(P.smokeTop)}, t * (2.0 - t));
      size = mix(0.3, 0.9, t);
      spread = t * t * 0.6;
    }
  }
  // 大きさは m（マスの一辺 1 m を基準に決めた値）
  size *= (0.75 + 0.5 * aSeed.z) * mix(0.55, 1.0, heat) * aBoost;
  float sa = aSeed.w * 6.2832;
  vec2 sway = vec2(
    sin(uTime * 2.7 + sa + y * 2.1),
    cos(uTime * 2.3 + aSeed.w * 5.1 + y * 1.7)
  ) * swayAmp + vec2(cos(sa), sin(sa)) * spread;
  vec3 center = vec3(aCenter.x + offset.x + sway.x, aSpawn.y + 0.05 + y, aCenter.y + offset.y + sway.y);
  vec4 mv = modelViewMatrix * vec4(center, 1.0);
  float flame = 1.0 - smoothstep(flamePart * 0.75, flamePart * 1.2, age);
  // 炎は画面の上での世界の上向きに伸ばす（真上・真下から見る時は画面の上）．煙・火の粉は粒ごとに回して模様の向きをそろえない
  vec2 up = (viewMatrix * vec4(0.0, 1.0, 0.0, 0.0)).xy;
  float upLength = length(up);
  up = upLength > 0.2 ? up / upLength : vec2(0.0, 1.0);
  float angle = sa + uTime * (aSeed.z - 0.5);
  vec2 axisY = normalize(mix(vec2(-sin(angle), cos(angle)), up, flame) + vec2(1e-4, 0.0));
  vec2 axisX = vec2(axisY.y, -axisY.x);
  mv.xy += (axisX * position.x + axisY * position.y * mix(1.0, stretch, flame)) * size;
  gl_Position = projectionMatrix * mv;
  vUv = position.xy * 2.0;
  vAge = age;
  vHeat = heat;
  vSeed = aSeed.w;
  vFlame = flame;
  vEmber = ember ? 1.0 : 0.0;
  // 生まれる時と消える時をなめらかにし，目の前に来た粒は消す（画面を覆うと重く，見にくいため）
  vFade = smoothstep(0.0, 0.08, age) * (1.0 - smoothstep(0.8, 1.0, age)) * smoothstep(0.2, 0.8, -mv.z);
}
`;

/**
 * 炎の粒のフラグメントシェーダー．
 * - 炎: 上ほど細いしずく形をノイズで崩し，根元（年齢の若い粒・粒の下側）は白〜黄，先は橙〜暗い赤にする．
 *   柔らかい縁と外側のにじみ（halo）を足し，ほぼ加算で光らせる
 * - 煙: 円いぼかしをノイズで崩した黒っぽい塊（普通に後ろを隠す）
 * - 火の粉: 小さく明るい点．冷えるほど赤く暗くなる（ノイズを使わず軽くする）
 * 出力は乗算済みのアルファ（合成は One, OneMinusSrcAlpha）．色は画面の色の値で書くので colorspace の変換をしない
 */
const FIRE_FRAGMENT_SHADER = /* glsl */ `
uniform float uTime;
varying vec2 vUv;
varying float vAge;
varying float vHeat;
varying float vSeed;
varying float vFade;
varying float vFlame;
varying float vEmber;
${NOISE_GLSL}
void main() {
  vec2 q = vUv;
  float r2 = dot(q, q);
  if (r2 > 1.0) discard;
  float flamePart = ${glslFloat(P.flamePart)};
  if (vEmber > 0.5 && vFlame < 0.5) {
    float cool = clamp((vAge - flamePart) / (1.0 - flamePart), 0.0, 1.0);
    float dot2 = (1.0 - r2) * (1.0 - r2);
    vec3 col = mix(${glslVec3(P.emberHot)}, ${glslVec3(P.emberCool)}, cool);
    gl_FragColor = vec4(col * (${glslFloat(P.emberEmission)} * dot2 * (1.0 - cool * 0.7) * vFade), 0.0);
    return;
  }
  // 炎は上（q.y が +）ほど細くする
  float up01 = clamp(q.y * 0.5 + 0.5, 0.0, 1.0);
  vec2 p = vec2(q.x / mix(1.0, mix(1.15, 0.45, up01), vFlame), q.y);
  float n = fsNoise(q * 2.2 + vec2(vSeed * 37.0, vSeed * 11.0 - uTime * 1.6)) * 0.65
    + fsNoise(q * 4.7 + vec2(vSeed * 13.0 + uTime * 0.9, vSeed * 29.0 - uTime * 2.3)) * 0.35;
  float r = length(p) + (n - 0.5) * 0.75;
  float shape = 1.0 - smoothstep(0.1, 1.0, r);
  float a = shape * shape * vFade;
  float halo = ${glslFloat(P.halo)} * exp(-3.0 * r2) * vFade;
  if (a + halo * vFlame < 0.004) discard;
  float t = clamp(vAge / flamePart, 0.0, 1.0);
  // 粒の中でも下側ほど熱く（白〜黄），上側ほど冷たい（橙〜赤）
  float tc = clamp(t + q.y * 0.18, 0.0, 1.0);
  vec3 col = mix(${glslVec3(P.white)}, ${glslVec3(P.yellow)}, smoothstep(0.0, 0.25, tc));
  col = mix(col, ${glslVec3(P.orange)}, smoothstep(0.2, 0.55, tc));
  col = mix(col, ${glslVec3(P.red)}, smoothstep(0.55, 1.0, tc));
  col = mix(col, ${glslVec3(P.white)}, clamp((1.0 - r) * (1.0 - t), 0.0, 1.0) * 0.5);
  vec3 emit = col * (${glslFloat(P.emission)} * mix(0.6, 1.0, vHeat) * (a + halo * (1.0 - 0.6 * t)) * vFlame);
  float smokeA = a * (1.0 - vFlame) * ${glslFloat(P.smokeAlpha)};
  gl_FragColor = vec4(emit + ${glslVec3(P.smoke)} * smokeA, a * vFlame * ${glslFloat(P.flameAlpha)} + smokeA);
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
  center: THREE.InstancedBufferAttribute;
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
  const center = new THREE.InstancedBufferAttribute(new Float32Array(count * 2), 2);
  center.setUsage(THREE.DynamicDrawUsage);
  const boost = new THREE.InstancedBufferAttribute(new Float32Array(count).fill(1), 1);
  boost.setUsage(THREE.DynamicDrawUsage);
  const kind = new Float32Array(count);
  for (let i = 0; i < count; i++) kind[i] = isEmberParticle(i) ? 1 : 0;
  geometry.setAttribute("aSpawn", spawn);
  geometry.setAttribute("aCenter", center);
  geometry.setAttribute("aBoost", boost);
  geometry.setAttribute("aKind", new THREE.InstancedBufferAttribute(kind, 1));
  geometry.instanceCount = count;
  return { geometry, spawn, center, boost };
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
    centerX: 0,
    centerZ: 0,
    ignition: 0,
    boost: 1,
  };
  let fireMesh: THREE.Mesh | null = null;
  let spawnAttr: THREE.InstancedBufferAttribute | null = null;
  let centerAttr: THREE.InstancedBufferAttribute | null = null;
  let boostAttr: THREE.InstancedBufferAttribute | null = null;
  if (cells.fire.length > 0) {
    const particles = createParticleGeometry(seeds);
    spawnAttr = particles.spawn;
    centerAttr = particles.center;
    boostAttr = particles.boost;
    // 炎・火の粉はほぼ加算で光を足し，煙は後ろを隠す（乗算済みのアルファ）．光源は付けない．煙の中でも火の位置が分かるようフォグを効かせない
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
    if (fireMesh === null || spawnAttr === null || centerAttr === null || boostAttr === null) {
      return;
    }
    // 時刻が NaN・無限の時は粒の年齢を求められないので描かない
    fireMesh.visible = Number.isFinite(seconds);
    if (!fireMesh.visible) return;
    const spawnArray = spawnAttr.array as Float32Array;
    const centerArray = centerAttr.array as Float32Array;
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
      // 出さない粒は中心を前の値のまま残す（シェーダーで描かないので使わない）
      if (spawn.active) {
        centerArray[i * 2] = spawn.centerX;
        centerArray[i * 2 + 1] = spawn.centerZ;
      }
      boostArray[i] = spawn.boost;
      changed = true;
    }
    if (changed) {
      spawnAttr.needsUpdate = true;
      centerAttr.needsUpdate = true;
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
