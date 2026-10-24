// 火と煙の見た目（F4）の濃さの計算（three に依存しない純粋な関数）．各マスに火・煙が着く時刻（SpreadMap）と今の時刻から，
// 炎の強さ・煙の濃さ・高さごとの煙の濃さ・目の位置から見た煙の濃さ，マスごとの濃さの表（テクスチャの中身）と炎の粒の出る位置を求める．
// 組み立て（three のメッシュ・シェーダー）は fireSmoke.ts．
// 時刻は非常ベルを 0 とした秒（s）．座標の決まりは docs/04_SPEC/SPEC_02_校舎データの形式.md「座標」を正とする

import type { CellKind, SchoolPlan } from "../../core/schoolPlan";
import { cellIndex, isInside } from "../../sim/grid";
import type { SpreadMap } from "../../sim/spread";
import { mulberry32 } from "../common/random";
import { FLOOR_HEIGHT } from "./routeArrowsLayout";

/** 天井の高さ（m．床から．SPEC_02「座標」の「天井の高さは 3 m」） */
export const SMOKE_CEILING_HEIGHT = 3;

/**
 * 火の見た目の値．
 * 着いた瞬間から小さな炎を出し（燃えているマスは fireAt ≤ 今の時刻．sim/spread.ts の isNearFire と同じ定義），
 * growSeconds かけて最大の大きさにする
 */
export const FIRE_LOOK = {
  /** 着いてから最大の大きさになるまでの秒数（s） */
  growSeconds: 4,
  /** 着いた瞬間の強さ（0〜1）．0 にすると燃えているのに何も見えない時間ができるため */
  minIntensity: 0.35,
  /** 最大の強さの炎の高さ（m）．天井（3 m）に届かない高さにする */
  maxHeight: 1.8,
  /** 炎の幅のマスの一辺に対する割合 */
  widthRatio: 0.9,
} as const;

/**
 * 煙の見た目の値（仮の値．デモの校舎で見て決め直す）．
 * 煙は天井から溜まり，着いてから rampSeconds かけて層の下の端が fullBottom まで下りてくる．
 * fullBottom を立った目（1.6 m）としゃがんだ目（0.9 m）の間に置き，しゃがむと煙の層の下に出て視界が晴れるようにする
 */
export const SMOKE_LOOK = {
  /** 着いてから最も濃くなるまでの秒数（s） */
  rampSeconds: 20,
  /** 最も濃い時の煙の層の下の端の高さ（m．床から） */
  fullBottom: 1.2,
  /** 層の下の端をぼかす幅（m）．下の端からこの幅だけ下で 0 になる */
  softEdge: 0.3,
  /** 層の下の端での濃さの割合（0〜1）．天井で 1 になる */
  bottomRatio: 0.5,
  /** 層の下（床の近く）にも残る薄い煙の割合（0〜1）．しゃがんでも全く無いわけではないことを示す */
  hazeRatio: 0.12,
} as const;

/**
 * フォグ（THREE.FogExp2）の濃さの値．目の位置の煙の濃さ（0〜1）に maxDensity を掛ける．
 * FogExp2 で見通せる距離（色が 95% 煙になる距離）は約 1.73 / density（m）．
 * 最も濃い煙で立つと約 3.5 m，しゃがむと約 18 m 先まで見える
 */
export const SMOKE_FOG = {
  /** 目の位置の煙が最も濃い（1）時のフォグの濃さ（1/m） */
  maxDensity: 0.8,
  /** 煙の色（灰色．0xRRGGBB） */
  color: 0x4a4744,
} as const;

/**
 * 煙を描く値．煙は，目から奥へ並べた視線に垂直な薄い板（スライス）で描く．板 1 枚は視線に沿った奥行きの区間を受け持ち，
 * 区間のうち煙の入る高さの部分を画素ごとに 1 点読む（簡易なレイマーチング）．板は常に目の方を向くので，床に平行な面に見えない．
 * 壁は板ごとに奥行きで隠すので，壁の奥の煙は見えない．板の数がそのまま 1 画素で煙を読む回数になるため，スマホに合わせて少なくする
 */
export const SMOKE_VOLUME = {
  /** 板の枚数（1 つのメッシュ．描画 1 回） */
  sliceCount: 6,
  /** 最も手前の区間の始まり（m．目からの奥行き）．カメラの near より奥に置く */
  nearest: 0.3,
  /** 最も奥の区間の終わり（m．最も手前の区間の始まりから）．それより奥はフォグで見えにくいので描かない */
  reach: 30,
  /**
   * 煙を描く最も低い高さ（m．床から）．しゃがんだ目（0.9 m）より上・最も濃い煙の下の端（SMOKE_LOOK.fullBottom）より下に置き，
   * しゃがんで前を見ると煙の外に出る（視界が晴れる）ようにする
   */
  bottom: 0.95,
  /** 煙を描く最も高い高さ（m．床から．天井） */
  top: SMOKE_CEILING_HEIGHT,
} as const;

/** 板が受け持つ区間（0〜1 の位置．0 が最も手前，1 が最も奥．奥行きは smokeSliceDepth で求める） */
export interface SmokeSlice {
  /** 区間の始まり */
  readonly start: number;
  /** 板を置く位置（区間の真ん中） */
  readonly center: number;
  /** 区間の終わり */
  readonly end: number;
}

/**
 * 板の区間の並び（奥から手前の順．半透明を奥から重ねて描くため）．0〜1 を count 等分する．
 * 奥行きは smokeSliceDepth で手前ほど細かく割るので，近くの煙ほど細かく読む
 */
export function smokeSlices(count: number = SMOKE_VOLUME.sliceCount): SmokeSlice[] {
  const n = Number.isFinite(count) ? Math.max(1, Math.floor(count)) : 1;
  return Array.from({ length: n }, (_, k) => {
    const i = n - 1 - k;
    return { start: i / n, center: (i + 0.5) / n, end: (i + 1) / n };
  });
}

/** 板の描く奥行きの範囲（m．目からの奥行き）．smokeSliceRange が書き換える */
export interface SmokeSliceRange {
  near: number;
  far: number;
}

/**
 * 区間の位置 t（0〜1）の奥行き（m）．near〜far を等比に割る（手前ほど細かい）．シェーダーにも同じ式がある
 */
export function smokeSliceDepth(t: number, range: Readonly<SmokeSliceRange>): number {
  return range.near * (range.far / range.near) ** t;
}

/** 校舎の煙が入りうる範囲（ワールド座標，m） */
export interface SmokeBounds {
  readonly minX: number;
  readonly minY: number;
  readonly minZ: number;
  readonly maxX: number;
  readonly maxY: number;
  readonly maxZ: number;
}

/** 校舎の煙が入りうる範囲を求める（全ての階の床から天井まで．作る時に 1 回だけ呼ぶ） */
export function smokeBounds(plan: Pick<SchoolPlan, "floors" | "cellSize">): SmokeBounds {
  let maxX = 0;
  let maxZ = 0;
  let minY = Number.POSITIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;
  for (const floor of plan.floors) {
    maxX = Math.max(maxX, floor.width * plan.cellSize);
    maxZ = Math.max(maxZ, floor.depth * plan.cellSize);
    const base = floorBaseY(floor.level);
    minY = Math.min(minY, base + SMOKE_VOLUME.bottom);
    maxY = Math.max(maxY, base + SMOKE_VOLUME.top);
  }
  if (plan.floors.length === 0) {
    minY = 0;
    maxY = 0;
  }
  return { minX: 0, minY, minZ: 0, maxX, maxY, maxZ };
}

/**
 * 目の位置（ワールド座標，m）から，板を並べる奥行きの範囲を求めて out に書く（毎フレーム呼ぶので新しい値を作らない）．
 * - 目が校舎の中: 最も手前（SMOKE_VOLUME.nearest）から reach 先まで．校舎の最も遠い角より奥には置かない
 * - 目が校舎の外（見下ろす視点等）: 校舎の最も近い所から reach 先まで（最も遠い角より奥には置かない）
 * 目の位置が NaN・無限の時は，目が校舎の中にいる時と同じ既定の範囲にする
 */
export function smokeSliceRange(
  bounds: SmokeBounds,
  eyeX: number,
  eyeY: number,
  eyeZ: number,
  out: SmokeSliceRange,
): SmokeSliceRange {
  const { nearest, reach } = SMOKE_VOLUME;
  if (!Number.isFinite(eyeX) || !Number.isFinite(eyeY) || !Number.isFinite(eyeZ)) {
    out.near = nearest;
    out.far = nearest + reach;
    return out;
  }
  const nx = Math.max(bounds.minX - eyeX, 0, eyeX - bounds.maxX);
  const ny = Math.max(bounds.minY - eyeY, 0, eyeY - bounds.maxY);
  const nz = Math.max(bounds.minZ - eyeZ, 0, eyeZ - bounds.maxZ);
  const fx = Math.max(Math.abs(eyeX - bounds.minX), Math.abs(eyeX - bounds.maxX));
  const fy = Math.max(Math.abs(eyeY - bounds.minY), Math.abs(eyeY - bounds.maxY));
  const fz = Math.max(Math.abs(eyeZ - bounds.minZ), Math.abs(eyeZ - bounds.maxZ));
  const near = Math.max(nearest, Math.hypot(nx, ny, nz));
  const far = Math.min(Math.hypot(fx, fy, fz), near + reach);
  out.near = near;
  // 校舎がとても小さい・遠い時も区間が潰れないよう，奥を手前の 2 倍以上にする
  out.far = Math.max(far, near * 2);
  return out;
}

/** 目の位置（ワールド座標，m）．THREE.Vector3 もそのまま渡せる */
export interface EyePosition {
  readonly x: number;
  readonly y: number;
  readonly z: number;
}

/** 火または煙が着くマス 1 つ（描画の対象．着かないマスは含めない） */
export interface FireSmokeCell {
  /** SchoolPlan.floors の添字 */
  readonly floor: number;
  readonly x: number;
  readonly z: number;
  /** マスの中心のワールド座標（m） */
  readonly centerX: number;
  readonly centerZ: number;
  /** その階の床の高さ（m．(level - 1) * FLOOR_HEIGHT） */
  readonly baseY: number;
  /** 着く時刻（s） */
  readonly seconds: number;
}

/** 描画の対象のマス（火・煙のそれぞれ） */
export interface FireSmokeCells {
  /** 火が着くマス（着く時刻が有限のマスだけ） */
  readonly fire: readonly FireSmokeCell[];
  /** 煙が着くマス（着く時刻が有限のマスだけ） */
  readonly smoke: readonly FireSmokeCell[];
}

/** 0〜1 の範囲に収める．NaN は 0 */
function clamp01(value: number): number {
  if (!(value > 0)) return 0;
  return Math.min(value, 1);
}

/** 0〜1 をなめらかに 0〜1 へ写す（始めと終わりの変化をゆるやかにして，急に現れたように見せない） */
function smoothstep01(t: number): number {
  const c = clamp01(t);
  return c * c * (3 - 2 * c);
}

/**
 * 着いてからの経過時間（s）．まだ着いていない・着かない（Infinity）・時刻が NaN の時は null．
 * 時刻ちょうどは 0（着いている）
 */
function elapsedSince(arrivalSeconds: number, nowSeconds: number): number | null {
  if (Number.isNaN(arrivalSeconds) || Number.isNaN(nowSeconds)) return null;
  if (arrivalSeconds === Infinity || nowSeconds < arrivalSeconds) return null;
  const elapsed = nowSeconds - arrivalSeconds;
  // 着く時刻が -Infinity（最初から燃えている扱い）でも有限の値にする
  return Number.isFinite(elapsed) ? elapsed : Number.MAX_VALUE;
}

/**
 * 今の時刻（s）でのマスの炎の強さ（0〜1）．0 は燃えていない．
 * 火が着く時刻ちょうどから燃えている（FIRE_LOOK.minIntensity）とし，growSeconds で 1 になる
 */
export function fireIntensity(fireSeconds: number, nowSeconds: number): number {
  const elapsed = elapsedSince(fireSeconds, nowSeconds);
  if (elapsed === null) return 0;
  const { growSeconds, minIntensity } = FIRE_LOOK;
  return minIntensity + (1 - minIntensity) * smoothstep01(elapsed / growSeconds);
}

/**
 * 今の時刻（s）でのマスの煙の濃さ（0〜1）．煙が着く時刻ちょうどは 0 で，SMOKE_LOOK.rampSeconds かけて 1 になる．
 * 着かない（Infinity）・まだ着いていない・NaN は 0
 */
export function smokeDensity(smokeSeconds: number, nowSeconds: number): number {
  const elapsed = elapsedSince(smokeSeconds, nowSeconds);
  if (elapsed === null) return 0;
  return smoothstep01(elapsed / SMOKE_LOOK.rampSeconds);
}

/**
 * マスの煙の濃さ（0〜1）での，煙の層の下の端の高さ（m．床から）．
 * 濃さ 0 で天井（SMOKE_CEILING_HEIGHT），1 で SMOKE_LOOK.fullBottom まで下りる
 */
export function smokeLayerBottom(density: number): number {
  return SMOKE_CEILING_HEIGHT - clamp01(density) * (SMOKE_CEILING_HEIGHT - SMOKE_LOOK.fullBottom);
}

/**
 * マスの煙の濃さ（0〜1）での，床からの高さ（m）ごとの煙の濃さ（0〜1）．天井に近いほど濃い．
 * - 層の下の端より softEdge 以上下: 薄い煙（hazeRatio × 濃さ）だけ
 * - 下の端の softEdge 下〜下の端: 薄い煙から bottomRatio × 濃さまでなめらかに上がる
 * - 下の端〜天井: bottomRatio × 濃さから濃さまで上がる（天井より上は天井と同じ）
 */
export function smokeAtHeight(density: number, heightAboveFloor: number): number {
  const d = clamp01(density);
  if (d === 0 || Number.isNaN(heightAboveFloor)) return 0;
  const { softEdge, bottomRatio, hazeRatio } = SMOKE_LOOK;
  const bottom = smokeLayerBottom(d);
  const haze = hazeRatio * d;
  if (heightAboveFloor < bottom) {
    const t = smoothstep01((heightAboveFloor - (bottom - softEdge)) / softEdge);
    return haze + (bottomRatio * d - haze) * t;
  }
  const span = SMOKE_CEILING_HEIGHT - bottom;
  const t = span > 0 ? clamp01((heightAboveFloor - bottom) / span) : 1;
  return d * (bottomRatio + (1 - bottomRatio) * t);
}

/**
 * 煙の層の見た目のための値（濃さの計算 smokeAtHeight・eyeSmokeDensity には使わない．描画の濃淡だけに使う）．
 * 煙は天井に当たって薄い膜のように這って広がり，時間とともに下へ厚くなる．smokeAtHeight は着いたばかりの薄い煙を
 * ほとんど見せないため，層の下の端より上では「天井の膜」の濃さを下限として見せ，先端が天井を這う様子を出す
 */
export const SMOKE_SHEET = {
  /** 天井の膜の濃さの上限（0〜1．最も濃い煙で層の下の端より上に残る濃さ） */
  strength: 0.8,
  /** 膜の濃さの立ち上がり（濃さ d の何乗か）．1 より小さいほど着いてすぐ濃く見える */
  exponent: 0.5,
} as const;

/**
 * 描画する煙の濃淡（0〜1）．濃さ density（0〜1）のマスの床からの高さ（m）ごとの値．
 * smokeAtHeight と，天井の膜（strength × density^exponent．層の下の端より上で効き，下の端の softEdge 下で 0）の大きい方．
 * - 着いたばかり（density が小さい）: 下の端が天井の近くにあるので，天井の近くだけが薄く見える
 * - 時間とともに下の端が下りて，膜が下へ厚くなる
 * 目の位置の煙・フォグには使わない（しゃがむと晴れる挙動は smokeAtHeight のまま）
 */
export function smokeShadeAtHeight(density: number, heightAboveFloor: number): number {
  const d = clamp01(density);
  if (d === 0 || Number.isNaN(heightAboveFloor)) return 0;
  const base = smokeAtHeight(d, heightAboveFloor);
  const bottom = smokeLayerBottom(d);
  const { softEdge } = SMOKE_LOOK;
  const inside = smoothstep01((heightAboveFloor - (bottom - softEdge)) / softEdge);
  const sheet = SMOKE_SHEET.strength * d ** SMOKE_SHEET.exponent * inside;
  return Math.max(base, sheet);
}

/** 階の床の高さ（m）．SPEC_02「座標」 */
export function floorBaseY(level: number): number {
  return (level - 1) * FLOOR_HEIGHT;
}

/** 着く時刻の表から，着く時刻が有限（Infinity・NaN でない）のマスを並べる */
function collectCells(
  plan: Pick<SchoolPlan, "cellSize" | "floors">,
  table: readonly (readonly number[])[],
): FireSmokeCell[] {
  const cells: FireSmokeCell[] = [];
  plan.floors.forEach((floor, f) => {
    const seconds = table[f];
    if (seconds === undefined) return;
    const baseY = floorBaseY(floor.level);
    for (let z = 0; z < floor.depth; z++) {
      for (let x = 0; x < floor.width; x++) {
        const t = seconds[cellIndex(floor, x, z)];
        if (!Number.isFinite(t)) continue;
        cells.push({
          floor: f,
          x,
          z,
          centerX: (x + 0.5) * plan.cellSize,
          centerZ: (z + 0.5) * plan.cellSize,
          baseY,
          seconds: t,
        });
      }
    }
  });
  return cells;
}

/**
 * 描画の対象のマス（火・煙が着くマス）を並べる．作る時に 1 回だけ呼ぶ．
 * 着く時刻が Infinity・NaN のマスは，いつまでも何も描かないので含めない（描画の数を減らす）
 */
export function listFireSmokeCells(
  plan: Pick<SchoolPlan, "cellSize" | "floors">,
  spread: Pick<SpreadMap, "fireSeconds" | "smokeSeconds">,
): FireSmokeCells {
  return {
    fire: collectCells(plan, spread.fireSeconds),
    smoke: collectCells(plan, spread.smokeSeconds),
  };
}

/** 煙が入りうるマス（空間のあるマス）か．柱・何もないマスは目の位置の煙の重み付けから外す */
function hasAir(kind: CellKind): boolean {
  return kind !== "wall" && kind !== "void";
}

/**
 * 目の位置（ワールド座標，m）での煙の濃さ（0〜1）．目の高さで決まるので，しゃがむ（目が低い）と小さくなる．
 * - 目のある階は，床の高さ（(level - 1) * FLOOR_HEIGHT）〜その FLOOR_HEIGHT 上の範囲に目がある階
 * - マスの境目で急に変わらないよう，周りの 4 つのマスの中心の濃さを距離で重み付けして混ぜる（柱・何もないマス・マス目の外は除く）
 * - 目のある階が無い・時刻や位置が NaN の時は 0
 */
export function eyeSmokeDensity(
  plan: Pick<SchoolPlan, "cellSize" | "floors">,
  spread: Pick<SpreadMap, "smokeSeconds">,
  nowSeconds: number,
  eye: EyePosition,
): number {
  if (Number.isNaN(nowSeconds) || !Number.isFinite(eye.x + eye.y + eye.z)) return 0;
  if (!(plan.cellSize > 0)) return 0;
  for (let f = 0; f < plan.floors.length; f++) {
    const floor = plan.floors[f];
    const baseY = floorBaseY(floor.level);
    const height = eye.y - baseY;
    if (height < 0 || height >= FLOOR_HEIGHT) continue;
    const seconds = spread.smokeSeconds[f];
    if (seconds === undefined) return 0;
    // マスの中心を格子点とみなした座標での位置
    const gx = eye.x / plan.cellSize - 0.5;
    const gz = eye.z / plan.cellSize - 0.5;
    const x0 = Math.floor(gx);
    const z0 = Math.floor(gz);
    const fx = gx - x0;
    const fz = gz - z0;
    let weighted = 0;
    let totalWeight = 0;
    for (let dz = 0; dz <= 1; dz++) {
      for (let dx = 0; dx <= 1; dx++) {
        const x = x0 + dx;
        const z = z0 + dz;
        if (!isInside(floor, x, z)) continue;
        const i = cellIndex(floor, x, z);
        if (!hasAir(floor.cells[i])) continue;
        const w = (dx === 0 ? 1 - fx : fx) * (dz === 0 ? 1 - fz : fz);
        if (w <= 0) continue;
        weighted += w * smokeDensity(seconds[i], nowSeconds);
        totalWeight += w;
      }
    }
    if (totalWeight <= 0) return 0;
    return smokeAtHeight(weighted / totalWeight, height);
  }
  return 0;
}

/** 目の位置の煙の濃さ（0〜1）から，フォグ（THREE.FogExp2）の濃さ（1/m）を求める */
export function smokeFogDensity(eyeSmoke: number): number {
  return SMOKE_FOG.maxDensity * clamp01(eyeSmoke);
}

// ---- マスごとの濃さの表（1 マス 1 テクセルの RGBA のテクスチャの中身） ----

/**
 * 表のチャンネル（RGBA の何番目か）．シェーダーは線形補間で読むので，マスの境目でなめらかに変わる
 * - smoke: 煙の濃さ（0〜1）．柱・何もないマス・屋外は 0（煙の層を出さない）
 * - fire: 炎の強さ（0〜1）．煙の色を火の近くほど暗くするのに使う
 * - glow: 床を照らす明るさ（0〜1）．燃えているマスとその周り 1 マスに広げる
 */
export const CELL_CHANNEL = { smoke: 0, fire: 1, glow: 2 } as const;

/** 燃えているマスの周り 1 マス（斜めを含む）を照らす明るさの割合（0〜1） */
export const FIRE_GLOW_SPREAD = 0.5;

/**
 * 全ての階のマスを 1 枚のテクスチャに並べる配置．各階の周りに 1 テクセルの 0 の縁を付けて縦に積む
 * （縁が無いと，線形補間で隣の階のマスや反対の端の値が混ざるため）
 */
export interface CellAtlas {
  /** テクスチャの幅（テクセル．最も広い階の幅 + 2） */
  readonly width: number;
  /** テクスチャの高さ（テクセル．各階の奥行き + 2 の合計） */
  readonly height: number;
  /** 各階の z = 0 のマスの行（テクセル）．並びは SchoolPlan.floors と同じ */
  readonly floorRows: readonly number[];
}

/** 階の周りに付ける 0 の縁の幅（テクセル） */
export const CELL_ATLAS_BORDER = 1;

/** 校舎のマスを並べるテクスチャの配置を求める．作る時に 1 回だけ呼ぶ */
export function createCellAtlas(plan: Pick<SchoolPlan, "floors">): CellAtlas {
  const b = CELL_ATLAS_BORDER;
  let width = 1;
  let height = 0;
  const floorRows: number[] = [];
  for (const floor of plan.floors) {
    width = Math.max(width, floor.width + 2 * b);
    floorRows.push(height + b);
    height += floor.depth + 2 * b;
  }
  return { width, height: Math.max(1, height), floorRows };
}

/** マスのテクセルの番号（行 × 幅 + 列．バイトの位置は 4 倍） */
export function cellTexel(atlas: CellAtlas, floor: number, x: number, z: number): number {
  return (atlas.floorRows[floor] + z) * atlas.width + x + CELL_ATLAS_BORDER;
}

/**
 * マスの位置（ワールド座標の x・z，m）を，テクスチャのテクセルの座標（テクセル単位．テクセルの中心が +0.5）に写す．
 * シェーダーに渡す頂点の座標に使う（マス x の中心がテクセル x + 縁 の中心に来る）
 */
export function cellTexelCoord(
  atlas: CellAtlas,
  cellSize: number,
  floor: number,
  worldX: number,
  worldZ: number,
): { readonly u: number; readonly v: number } {
  return {
    u: worldX / cellSize + CELL_ATLAS_BORDER,
    v: atlas.floorRows[floor] + worldZ / cellSize,
  };
}

/** 煙の層を出すマスか（柱・何もないマス・屋外の上には煙を描かない） */
function showsSmoke(kind: CellKind | undefined): boolean {
  return kind !== undefined && kind !== "wall" && kind !== "void" && kind !== "outdoor";
}

/** 0〜1 をテクセルの 1 バイト（0〜255）にする */
function toByte(value: number): number {
  return Math.round(clamp01(value) * 255);
}

/** writeCellTexels の結果（その時刻の数） */
export interface CellTexelCounts {
  /** 燃えているマスの数 */
  readonly burningCells: number;
  /** 煙の濃さが 0 より大きいマスの数（煙の層を出さないマスも数える） */
  readonly smokyCells: number;
}

/**
 * 今の時刻（s）の各マスの煙の濃さ・炎の強さ・床の明るさを，テクスチャの中身（RGBA，1 マス 4 バイト）に書く．
 * out は atlas.width * atlas.height * 4 バイトで，全体を 0 にしてから書く（書かないマス・縁は 0）
 */
export function writeCellTexels(
  plan: Pick<SchoolPlan, "floors">,
  cells: FireSmokeCells,
  atlas: CellAtlas,
  nowSeconds: number,
  out: Uint8Array,
): CellTexelCounts {
  out.fill(0);
  let smokyCells = 0;
  for (const c of cells.smoke) {
    const d = smokeDensity(c.seconds, nowSeconds);
    if (d <= 0) continue;
    smokyCells++;
    const floor = plan.floors[c.floor];
    if (!showsSmoke(floor.cells[cellIndex(floor, c.x, c.z)])) continue;
    out[cellTexel(atlas, c.floor, c.x, c.z) * 4 + CELL_CHANNEL.smoke] = toByte(d);
  }
  let burningCells = 0;
  for (const c of cells.fire) {
    const k = fireIntensity(c.seconds, nowSeconds);
    if (k <= 0) continue;
    burningCells++;
    const floor = plan.floors[c.floor];
    out[cellTexel(atlas, c.floor, c.x, c.z) * 4 + CELL_CHANNEL.fire] = toByte(k);
    for (let dz = -1; dz <= 1; dz++) {
      for (let dx = -1; dx <= 1; dx++) {
        if (!isInside(floor, c.x + dx, c.z + dz)) continue;
        const o = cellTexel(atlas, c.floor, c.x + dx, c.z + dz) * 4 + CELL_CHANNEL.glow;
        const glow = toByte(dx === 0 && dz === 0 ? k : k * FIRE_GLOW_SPREAD);
        if (glow > out[o]) out[o] = glow;
      }
    }
  }
  return { burningCells, smokyCells };
}

// ---- 炎の粒（決まった数の粒を，燃えているマスに割り当てて立ち上らせる） ----

/**
 * 炎の粒の値．粒は lifeSeconds ごとに生まれ直し，生まれる時に燃えているマスの中のランダムな位置に置き直す．
 * 粒の動き（昇る・揺れる・色が変わる）は時刻からシェーダーで求めるので，CPU は生まれ直した粒の位置だけを書く
 */
export const FIRE_PARTICLES = {
  /** 粒の総数．燃えているマスの数によらず一定（描画 1 回） */
  count: 600,
  /** 1 マスあたりの粒の数の上限．燃えているマスが少ない時に 1 マスに集まりすぎないようにする */
  maxPerCell: 20,
  /** 粒が生まれてから消えるまでの秒数の基準（s） */
  lifeSeconds: 1.2,
  /** 粒ごとの寿命のばらつき（基準に対する割合．±この半分） */
  lifeJitter: 0.4,
  /** 粒の生まれる範囲の幅（マスの一辺に対する割合）．1 より大きくして隣のマスの炎とつなげる */
  spawnSpread: 1.25,
  /** 粒の数が上限より少ないマスで，粒を大きくする倍率の上限 */
  maxBoost: 2,
  /** 生まれ直す時に選ぶマスの候補の数．目に近い方を選び，見えやすい火の粒を多くする */
  candidates: 2,
} as const;

/**
 * 火の粉の値．粒のうち一部は，炎として光った後に黒い煙にならず，火の粉（小さく明るい点）になって舞い上がる．
 * 描画は炎の粒と同じ 1 回（粒の数も増やさない）
 */
export const FIRE_EMBERS = {
  /** 粒のうち火の粉になる割合（0〜1） */
  ratio: 0.15,
  /** 火の粉か否かを決める乱数の塩（hash01 の salt．粒の位置の乱数と重ならない値） */
  salt: 303,
} as const;

/** index 番目の粒が火の粉になるか（粒ごとに固定．作る時に 1 回だけ求めてシェーダーへ渡す） */
export function isEmberParticle(index: number): boolean {
  return hash01(index, 0, FIRE_EMBERS.salt) < FIRE_EMBERS.ratio;
}

/** 粒が出ない（隠す）時に書く火の着く時刻（s）．シェーダーで「まだ燃えていない」として描かない */
export const HIDDEN_IGNITION_SECONDS = 1e6;

/** 粒ごとに決まった値（作る時に 1 回だけ決める） */
export interface FireParticleSeed {
  /** 生まれる時刻のずれ（寿命に対する割合．0〜1） */
  readonly phase: number;
  /** 寿命（s） */
  readonly lifeSeconds: number;
  /** 大きさのばらつき（0〜1） */
  readonly size: number;
  /** 揺れ方のばらつき（0〜1） */
  readonly sway: number;
}

/** 粒ごとの決まった値を種付きの乱数で作る（毎回同じ見た目にする） */
export function createFireParticleSeeds(
  count: number = FIRE_PARTICLES.count,
  seed = 0x5eed_f14e,
): FireParticleSeed[] {
  const rand = mulberry32(seed);
  const { lifeSeconds, lifeJitter } = FIRE_PARTICLES;
  return Array.from({ length: count }, () => ({
    phase: rand(),
    lifeSeconds: lifeSeconds * (1 + lifeJitter * (rand() - 0.5)),
    size: rand(),
    sway: rand(),
  }));
}

/**
 * 粒の今の生まれ直しの回数（整数）．シェーダーでは同じ式の小数部分を粒の年齢（0〜1）にする．
 * 時刻が NaN の時は NaN
 */
export function particleCycle(seed: FireParticleSeed, nowSeconds: number): number {
  return Math.floor(nowSeconds / seed.lifeSeconds + seed.phase);
}

/** cycle 回目に粒が生まれた時刻（s） */
export function particleCycleStart(seed: FireParticleSeed, cycle: number): number {
  return (cycle - seed.phase) * seed.lifeSeconds;
}

/** 火が着くマスを着く時刻の早い順に並べる（燃えているマスが常に先頭に並ぶようにする） */
export function sortByIgnition(cells: readonly FireSmokeCell[]): FireSmokeCell[] {
  return [...cells].sort((a, b) => a.seconds - b.seconds);
}

/** 着く時刻の早い順に並んだマスのうち，時刻 nowSeconds に燃えているマスの数（二分探索）．NaN は 0 */
export function burningCountAt(sorted: readonly FireSmokeCell[], nowSeconds: number): number {
  if (Number.isNaN(nowSeconds)) return 0;
  let lo = 0;
  let hi = sorted.length;
  while (lo < hi) {
    const mid = (lo + hi) >>> 1;
    if (sorted[mid].seconds <= nowSeconds) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

/** 2 つの整数と塩から決まる 0〜1 の値（粒・生まれ直しの回数ごとの乱数．状態を持たず毎回同じ値） */
export function hash01(a: number, b: number, salt: number): number {
  let h = Math.imul((a | 0) ^ 0x9e3779b9, 0x85ebca6b) ^ Math.imul(((b | 0) + salt) | 0, 0xc2b2ae35);
  h ^= h >>> 16;
  h = Math.imul(h, 0x7feb352d);
  h ^= h >>> 15;
  h = Math.imul(h, 0x846ca68b);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

/** 粒の生まれる位置（chooseParticleSpawn が書き換える．毎フレーム new しないため使い回す） */
export interface ParticleSpawn {
  /** 粒を出すか */
  active: boolean;
  /** 生まれる位置（ワールド座標，m．y は床の高さ） */
  x: number;
  y: number;
  z: number;
  /** 割り当てたマスの中心（ワールド座標，m）．炎の粒が昇りながら中心へ寄って先が細くなるのに使う．出さない時は前の値のまま */
  centerX: number;
  centerZ: number;
  /** 割り当てたマスに火が着く時刻（s）．出さない時は HIDDEN_IGNITION_SECONDS */
  ignition: number;
  /** 粒の大きさの倍率（1〜FIRE_PARTICLES.maxBoost） */
  boost: number;
}

/**
 * index 番目の粒の cycle 回目の生まれる位置を決めて out に書く．
 * - 粒が生まれた時刻に燃えているマスの中から乱数で選ぶ（目の位置を渡すと，候補のうち目に近いマスを選ぶ）
 * - 燃えているマスが少ない時は 1 マスあたり maxPerCell 個までにし，余った粒は出さない
 * - 燃えているマスが多く 1 マスあたりの粒が少ない時は，粒を大きくして隙間を埋める
 * - 位置はマスの中心から spawnSpread × マスの一辺の範囲（隣のマスに少しはみ出す）
 */
export function chooseParticleSpawn(
  sorted: readonly FireSmokeCell[],
  index: number,
  cycle: number,
  seed: FireParticleSeed,
  cellSize: number,
  eye: EyePosition | null,
  out: ParticleSpawn,
  count: number = FIRE_PARTICLES.count,
): void {
  const { maxPerCell, candidates, spawnSpread, maxBoost } = FIRE_PARTICLES;
  const burning = Number.isFinite(cycle)
    ? burningCountAt(sorted, particleCycleStart(seed, cycle))
    : 0;
  if (burning === 0 || index >= Math.min(count, burning * maxPerCell)) {
    out.active = false;
    out.ignition = HIDDEN_IGNITION_SECONDS;
    out.boost = 1;
    return;
  }
  let chosen = sorted[Math.min(burning - 1, Math.floor(hash01(index, cycle, 0) * burning))];
  if (eye !== null) {
    let best = Infinity;
    for (let c = 0; c < candidates; c++) {
      const cell = sorted[Math.min(burning - 1, Math.floor(hash01(index, cycle, c) * burning))];
      const d = Math.hypot(cell.centerX - eye.x, cell.baseY - eye.y, cell.centerZ - eye.z);
      if (d < best) {
        best = d;
        chosen = cell;
      }
    }
  }
  const range = spawnSpread * cellSize;
  out.active = true;
  out.x = chosen.centerX + (hash01(index, cycle, 101) - 0.5) * range;
  out.y = chosen.baseY;
  out.z = chosen.centerZ + (hash01(index, cycle, 202) - 0.5) * range;
  out.centerX = chosen.centerX;
  out.centerZ = chosen.centerZ;
  // 最初から燃えている扱い（-Infinity）でもシェーダーに有限の値を渡す
  out.ignition = Math.max(chosen.seconds, -HIDDEN_IGNITION_SECONDS);
  const perCell = count / burning;
  out.boost = perCell >= maxPerCell ? 1 : Math.min(maxBoost, Math.sqrt(maxPerCell / perCell));
}
