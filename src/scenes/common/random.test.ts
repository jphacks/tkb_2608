import { describe, expect, it } from "vitest";
import { mulberry32, randomInt, randomRange } from "./random";

function take(rand: () => number, n: number): number[] {
  return Array.from({ length: n }, () => rand());
}

describe("mulberry32", () => {
  it("同じシードなら同じ列を返す", () => {
    expect(take(mulberry32(42), 100)).toEqual(take(mulberry32(42), 100));
  });

  it("異なるシードなら異なる列を返す", () => {
    expect(take(mulberry32(1), 10)).not.toEqual(take(mulberry32(2), 10));
  });

  it("値は常に [0, 1) に収まる", () => {
    for (const seed of [0, 1, 123456789, 0xffffffff, -1]) {
      for (const v of take(mulberry32(seed), 2000)) {
        expect(v).toBeGreaterThanOrEqual(0);
        expect(v).toBeLessThan(1);
      }
    }
  });

  it("呼ぶたびに値が変わる（定数列ではない）", () => {
    const values = new Set(take(mulberry32(7), 100));
    expect(values.size).toBeGreaterThan(90);
  });
});

describe("randomRange", () => {
  it("[min, max) に収まる", () => {
    const rand = mulberry32(3);
    for (let i = 0; i < 2000; i++) {
      const v = randomRange(rand, -2.5, 4);
      expect(v).toBeGreaterThanOrEqual(-2.5);
      expect(v).toBeLessThan(4);
    }
  });

  it("rand が 0 なら min を返す", () => {
    expect(randomRange(() => 0, 1, 5)).toBe(1);
  });

  it("rand が 1 未満の最大値でも max 未満", () => {
    expect(randomRange(() => 1 - Number.EPSILON, 1, 5)).toBeLessThan(5);
  });

  it("rand=0.5 なら中央", () => {
    expect(randomRange(() => 0.5, 2, 6)).toBe(4);
  });
});

describe("randomInt", () => {
  it("[min, max] の整数を返し，両端が出る", () => {
    const rand = mulberry32(99);
    const seen = new Set<number>();
    for (let i = 0; i < 5000; i++) {
      const v = randomInt(rand, 2, 6);
      expect(Number.isInteger(v)).toBe(true);
      expect(v).toBeGreaterThanOrEqual(2);
      expect(v).toBeLessThanOrEqual(6);
      seen.add(v);
    }
    expect([...seen].sort()).toEqual([2, 3, 4, 5, 6]);
  });

  it("rand の境界値で min と max を返す", () => {
    expect(randomInt(() => 0, 3, 8)).toBe(3);
    expect(randomInt(() => 1 - Number.EPSILON, 3, 8)).toBe(8);
  });

  it("min と max が同じならその値", () => {
    expect(randomInt(mulberry32(5), 4, 4)).toBe(4);
  });

  it("負の範囲でも動く", () => {
    const rand = mulberry32(11);
    for (let i = 0; i < 500; i++) {
      const v = randomInt(rand, -3, -1);
      expect(v).toBeGreaterThanOrEqual(-3);
      expect(v).toBeLessThanOrEqual(-1);
    }
  });
});
