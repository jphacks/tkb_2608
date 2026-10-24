// 効果音の波形を作る純粋な関数（同じ種なら同じ波形・値の範囲・長さ）のテスト
import { describe, expect, it } from "vitest";
import {
  babbleEnvelope,
  bellStrikeEnvelope,
  classroomKnocks,
  createRandom,
  fireCrackles,
  type Random,
  sampleCount,
  whiteNoise,
} from "./synthData";

const RATE = 8000;

function inRange(data: Float32Array, min: number, max: number): boolean {
  for (const v of data) if (!(v >= min && v <= max)) return false;
  return true;
}

describe("createRandom", () => {
  it("同じ種なら同じ並び", () => {
    const a = createRandom(42);
    const b = createRandom(42);
    for (let i = 0; i < 100; i++) expect(a()).toBe(b());
  });

  it("違う種なら違う並び", () => {
    const a = createRandom(1);
    const b = createRandom(2);
    const xs = Array.from({ length: 10 }, () => a());
    const ys = Array.from({ length: 10 }, () => b());
    expect(xs).not.toEqual(ys);
  });

  it.each([0, 1, -1, 2 ** 32 + 5, 1.5, Number.NaN])("種 %s でも 0 以上 1 未満", (seed) => {
    const r = createRandom(seed);
    for (let i = 0; i < 1000; i++) {
      const v = r();
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
    }
  });
});

describe("sampleCount", () => {
  it("サンプリング周波数 × 秒数（四捨五入）", () => {
    expect(sampleCount(8000, 1)).toBe(8000);
    expect(sampleCount(44100, 0.5)).toBe(22050);
  });

  it.each([
    [8000, 0],
    [8000, -1],
    [0, 1],
    [Number.NaN, 1],
    [8000, Number.NaN],
    [8000, Number.POSITIVE_INFINITY],
  ])("(%s, %s) は 1", (rate, seconds) => {
    expect(sampleCount(rate, seconds)).toBe(1);
  });
});

/** 種付きの乱数を受ける波形の関数を同じ形で確かめる */
const SEEDED: [
  string,
  (rate: number, seconds: number, random: Random) => Float32Array,
  number,
  number,
][] = [
  ["whiteNoise", whiteNoise, -1, 1],
  ["babbleEnvelope", (r, s, rnd) => babbleEnvelope(r, s, rnd), 0, 1],
  ["classroomKnocks", classroomKnocks, -1, 1],
  ["fireCrackles", (r, s, rnd) => fireCrackles(r, s, rnd), -1, 1],
];

describe.each(SEEDED)("%s", (_, make, min, max) => {
  it("同じ種なら同じ波形", () => {
    expect(make(RATE, 2, createRandom(7))).toEqual(make(RATE, 2, createRandom(7)));
  });

  it("違う種なら違う波形", () => {
    expect(make(RATE, 2, createRandom(7))).not.toEqual(make(RATE, 2, createRandom(8)));
  });

  it("長さはサンプリング周波数 × 秒数", () => {
    expect(make(RATE, 2, createRandom(1)).length).toBe(2 * RATE);
    expect(make(RATE, 0.5, createRandom(1)).length).toBe(RATE / 2);
  });

  it(`値は ${min}〜${max} で NaN が無い`, () => {
    for (const seed of [1, 2, 3, 99]) {
      expect(inRange(make(RATE, 3, createRandom(seed)), min, max)).toBe(true);
    }
  });

  it("無音ではない", () => {
    expect(make(RATE, 3, createRandom(1)).some((v) => v !== 0)).toBe(true);
  });

  it.each([0, -1, Number.NaN])("秒数が %s でも 1 サンプルで止まらない", (seconds) => {
    const data = make(RATE, seconds, createRandom(1));
    expect(data.length).toBe(1);
    expect(inRange(data, min, max)).toBe(true);
  });
});

describe("fireCrackles", () => {
  it("1 秒あたりの数を多くしても -1〜1 に収まる", () => {
    expect(inRange(fireCrackles(RATE, 1, createRandom(3), 500), -1, 1)).toBe(true);
  });
});

describe("babbleEnvelope", () => {
  it("話し手の数を変えても 0〜1 に収まる", () => {
    for (const speakers of [1, 2, 8]) {
      expect(inRange(babbleEnvelope(RATE, 3, createRandom(5), speakers), 0, 1)).toBe(true);
    }
  });
});

describe("bellStrikeEnvelope", () => {
  it("長さは 1 打ち分（サンプリング周波数 / 打つ回数）", () => {
    expect(bellStrikeEnvelope(RATE, 20, 0.02).length).toBe(RATE / 20);
  });

  it("0〜1 で，0 から立ち上がって最大になった後は減っていく", () => {
    const data = bellStrikeEnvelope(RATE, 20, 0.02);
    expect(inRange(data, 0, 1)).toBe(true);
    expect(data[0]).toBe(0);
    let peak = 0;
    for (let i = 1; i < data.length; i++) if (data[i] > data[peak]) peak = i;
    expect(data[peak]).toBeGreaterThan(0.5);
    for (let i = peak + 1; i < data.length; i++) expect(data[i]).toBeLessThanOrEqual(data[i - 1]);
  });

  it("同じ引数なら同じ波形", () => {
    expect(bellStrikeEnvelope(RATE, 18, 0.03)).toEqual(bellStrikeEnvelope(RATE, 18, 0.03));
  });

  it.each([0, Number.NaN, -5])("打つ回数が %s でも 1 サンプル以上", (hz) => {
    expect(bellStrikeEnvelope(RATE, hz, 0.02).length).toBeGreaterThanOrEqual(1);
  });
});
