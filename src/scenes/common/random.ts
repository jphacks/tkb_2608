// シード固定の擬似乱数．手続きテクスチャや本の並びを毎回同じ見た目にするために使う

/** mulberry32 の擬似乱数を作る．返す関数は呼ぶたびに [0, 1) の値を返す */
export function mulberry32(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** [min, max) の実数を返す */
export function randomRange(rand: () => number, min: number, max: number): number {
  return min + (max - min) * rand();
}

/** [min, max] の整数を返す */
export function randomInt(rand: () => number, min: number, max: number): number {
  return Math.min(max, Math.floor(min + (max - min + 1) * rand()));
}
