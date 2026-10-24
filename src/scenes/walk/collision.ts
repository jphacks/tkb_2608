// 歩行の当たり判定（three に依存しない純粋な関数）．
// プレイヤーの体は XZ 平面の円（半径 radius）と，床から頭のてっぺんまでの高さの範囲で表す．
// 障害物は軸に沿った直方体（AABB）で，体と高さの範囲が重なる物だけが行く手をふさぐ．
// 頭より上にある物（テーブルの天板等）は通り抜けられる代わりに，その下で立ち上がれない（headroomAt）

/** XZ 平面の矩形（ワールド座標，m） */
export interface XZRect {
  readonly minX: number;
  readonly maxX: number;
  readonly minZ: number;
  readonly maxZ: number;
}

/** 障害物（軸に沿った直方体．y は床からの高さ） */
export interface Obstacle extends XZRect {
  readonly id: string;
  readonly minY: number;
  readonly maxY: number;
}

/** プレイヤーの体の形 */
export interface BodyShape {
  /** 体の半径（XZ 平面．m） */
  readonly radius: number;
  /** 目から頭のてっぺんまでの高さ（m） */
  readonly headClearance: number;
  /** これより低い物（敷居等）はまたげる（m） */
  readonly stepHeight: number;
}

/**
 * 体の形の既定値．半径はテーブルの脚の間（約 0.48m）に，しゃがんで入れる大きさにする
 */
export const DEFAULT_BODY: BodyShape = {
  radius: 0.18,
  headClearance: 0.1,
  stepHeight: 0.05,
};

/** 高さの比較の許容差（頭のてっぺんと天板の下面がちょうど同じ高さの時に，ふさがれないように） */
const HEIGHT_EPSILON = 1e-3;

/** 1 回で動かす最大の距離（壁の厚みより十分小さくし，すり抜けを防ぐ） */
const MAX_SUBSTEP = 0.05;

/** 押し出しを繰り返す回数（角で 2 つの物に同時に当たった時に収まるまで） */
const RESOLVE_PASSES = 3;

export interface XZ {
  readonly x: number;
  readonly z: number;
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(value, max));
}

/** 障害物が，頭のてっぺんの高さ headTop の体の行く手をふさぐか（高さの範囲が重なるか） */
export function blocksBody(obstacle: Obstacle, headTop: number, body: BodyShape): boolean {
  return obstacle.maxY > body.stepHeight && obstacle.minY < headTop - HEIGHT_EPSILON;
}

/** 円（中心 x, z・半径 r）が矩形と重なるか（接するだけは重ならない） */
export function circleOverlapsRect(x: number, z: number, r: number, rect: XZRect): boolean {
  const dx = x - clamp(x, rect.minX, rect.maxX);
  const dz = z - clamp(z, rect.minZ, rect.maxZ);
  return dx * dx + dz * dz < r * r;
}

/** 円を矩形の外へ最短で押し出した中心を返す．重なっていなければそのまま */
export function pushOutOfRect(x: number, z: number, r: number, rect: XZRect): XZ {
  const dx = x - clamp(x, rect.minX, rect.maxX);
  const dz = z - clamp(z, rect.minZ, rect.maxZ);
  const d2 = dx * dx + dz * dz;
  if (d2 >= r * r) return { x, z };
  if (d2 > 1e-12) {
    // 中心が矩形の外: 最も近い点から離れる向きへ
    const d = Math.sqrt(d2);
    const k = (r - d) / d;
    return { x: x + dx * k, z: z + dz * k };
  }
  // 中心が矩形の中: 最も近い辺の外へ
  const toMinX = x - rect.minX;
  const toMaxX = rect.maxX - x;
  const toMinZ = z - rect.minZ;
  const toMaxZ = rect.maxZ - z;
  const nearest = Math.min(toMinX, toMaxX, toMinZ, toMaxZ);
  if (nearest === toMinX) return { x: rect.minX - r, z };
  if (nearest === toMaxX) return { x: rect.maxX + r, z };
  if (nearest === toMinZ) return { x, z: rect.minZ - r };
  return { x, z: rect.maxZ + r };
}

/** 点が矩形の中か（境界を含む） */
export function rectContains(rect: XZRect, x: number, z: number): boolean {
  return x >= rect.minX && x <= rect.maxX && z >= rect.minZ && z <= rect.maxZ;
}

/** 点が床（矩形の和）のどれかの中か */
export function onFloor(floors: readonly XZRect[], x: number, z: number): boolean {
  for (const floor of floors) {
    if (rectContains(floor, x, z)) return true;
  }
  return false;
}

/** 体を，ふさぐ障害物すべての外へ押し出す（角では数回繰り返して収める） */
export function resolveOverlaps(
  x: number,
  z: number,
  headTop: number,
  obstacles: readonly Obstacle[],
  body: BodyShape,
): XZ {
  let px = x;
  let pz = z;
  for (let pass = 0; pass < RESOLVE_PASSES; pass++) {
    let moved = false;
    for (const o of obstacles) {
      if (!blocksBody(o, headTop, body)) continue;
      if (!circleOverlapsRect(px, pz, body.radius, o)) continue;
      const p = pushOutOfRect(px, pz, body.radius, o);
      px = p.x;
      pz = p.z;
      moved = true;
    }
    if (!moved) break;
  }
  return { x: px, z: pz };
}

/**
 * (x, z) から (dx, dz) だけ動かす．障害物に当たると押し戻され，壁に沿って滑る．
 * 中心が床（floors）の外に出る動きは，軸ごとに分けて床の中に残る向きだけ動かす．
 * 大きく動く時はすり抜けないよう小刻みに分けて動かす
 */
export function moveWithCollision(
  x: number,
  z: number,
  dx: number,
  dz: number,
  headTop: number,
  obstacles: readonly Obstacle[],
  floors: readonly XZRect[],
  body: BodyShape,
): XZ {
  const distance = Math.hypot(dx, dz);
  const steps = Math.max(1, Math.ceil(distance / MAX_SUBSTEP));
  const sx = dx / steps;
  const sz = dz / steps;
  let px = x;
  let pz = z;
  for (let i = 0; i < steps; i++) {
    const next = stepOnce(px, pz, sx, sz, headTop, obstacles, floors, body);
    px = next.x;
    pz = next.z;
  }
  return { x: px, z: pz };
}

function stepOnce(
  x: number,
  z: number,
  sx: number,
  sz: number,
  headTop: number,
  obstacles: readonly Obstacle[],
  floors: readonly XZRect[],
  body: BodyShape,
): XZ {
  // そのまま → X だけ → Z だけ の順に試し，床の中に残り，押し出した後にふさぐ物と重ならない最初の動きを採る．
  // 体の直径より狭いすき間に押し込むと，2 つの物の押し出しが収まらず重なったまま残るため，その動きは採らない．
  // ただし今の位置がすでに重なっている時（立ち上がった直後等）は，抜け出せるよう押し出しの結果をそのまま採る
  const candidates: readonly (readonly [number, number])[] = [
    [sx, sz],
    [sx, 0],
    [0, sz],
  ];
  const stuck = overlapsAny(x, z, headTop, obstacles, body);
  for (const [cx, cz] of candidates) {
    const p = resolveOverlaps(x + cx, z + cz, headTop, obstacles, body);
    if (!onFloor(floors, p.x, p.z)) continue;
    if (stuck || !overlapsAny(p.x, p.z, headTop, obstacles, body)) return p;
  }
  return { x, z };
}

/**
 * 押し出しの後に重なりが残っているかの許容差（m）．押し出した直後は体がちょうど接する位置にあり，
 * 計算の誤差でわずかに重なって見えるため，その分は重なりとみなさない
 */
const OVERLAP_EPSILON = 1e-6;

/** (x, z) に立つ体が，ふさぐ障害物のどれかと重なっているか */
function overlapsAny(
  x: number,
  z: number,
  headTop: number,
  obstacles: readonly Obstacle[],
  body: BodyShape,
): boolean {
  const r = body.radius - OVERLAP_EPSILON;
  for (const o of obstacles) {
    if (blocksBody(o, headTop, body) && circleOverlapsRect(x, z, r, o)) return true;
  }
  return false;
}

/**
 * (x, z) に立つ体の頭上の空き: 頭のてっぺん headTop 以上にあって体と XZ で重なる障害物の
 * 下面のうち最も低い高さ．無ければ Infinity．テーブルの下で立ち上がれる高さの上限に使う
 */
export function headroomAt(
  x: number,
  z: number,
  headTop: number,
  obstacles: readonly Obstacle[],
  body: BodyShape,
): number {
  let lowest = Number.POSITIVE_INFINITY;
  for (const o of obstacles) {
    if (o.minY < headTop - HEIGHT_EPSILON || o.minY >= lowest) continue;
    if (!circleOverlapsRect(x, z, body.radius, o)) continue;
    lowest = o.minY;
  }
  return lowest;
}
