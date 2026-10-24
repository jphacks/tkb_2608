// 手の形（experiment_山﨑/07「手の形」: 握る 0.6／0.4 のヒステリシス・つまむ・指を差すは 2 回続けたら確定）
import { describe, expect, it } from "vitest";
import {
  computeHandShape,
  gripOutput,
  INITIAL_CONFIRM,
  nextConfirmed,
  nextGripped,
  nextPinching,
  palmCenter,
  pinchAmount,
} from "./handShape";
import { FIST, handLandmarks, IMG_H, IMG_W, OPEN, POINT, TEST_HAND_PARAMS } from "./testHands";

const ASPECT = IMG_W / IMG_H;
const P = TEST_HAND_PARAMS;

function shapeOf(o: Parameters<typeof handLandmarks>[0] = {}) {
  const s = computeHandShape(handLandmarks(o), ASPECT, P);
  if (s === null) throw new Error("shape is null");
  return s;
}

describe("palmCenter", () => {
  it("手首と 4 本の指の付け根の平均", () => {
    const lm = Array.from({ length: 21 }, () => ({ x: 9, y: 9, z: 9 }));
    lm[0] = { x: 0, y: 0, z: 0 };
    lm[5] = { x: 1, y: 0, z: 0 };
    lm[9] = { x: 2, y: 0, z: 0 };
    lm[13] = { x: 3, y: 0, z: 0 };
    lm[17] = { x: 4, y: 5, z: 10 };
    expect(palmCenter(lm)).toEqual({ x: 2, y: 1, z: 2 });
  });
});

describe("computeHandShape", () => {
  it("開いた手: 4 本とも伸びていて握り具合は開いたとみなす値（0.4）より小さい．指は差していない", () => {
    const s = shapeOf({ curls: OPEN });
    expect(s.curls.every((c) => c < 0.1)).toBe(true);
    expect(s.grip).toBeLessThan(P.gripOff);
    expect(s.pointing).toBe(false);
  });

  it("握った手: 4 本とも曲がっていて握り具合は握ったとみなす値（0.6）より大きい．指は差していない", () => {
    const s = shapeOf({ curls: FIST });
    expect(s.curls.every((c) => c > 0.9)).toBe(true);
    expect(s.grip).toBeGreaterThan(P.gripOn);
    expect(s.pointing).toBe(false);
  });

  it("指を差す手: 人差し指だけが伸び，他が曲がっている", () => {
    const s = shapeOf({ curls: POINT });
    expect(s.curls[0]).toBeLessThan(P.pointIndexMaxCurl);
    expect(s.curls.slice(1).every((c) => c > P.pointOthersMinCurl)).toBe(true);
    expect(s.pointing).toBe(true);
  });

  it.each([
    ["中指も伸びている", [0, 0, 1, 1]],
    ["人差し指も曲がっている", [1, 1, 1, 1]],
    ["小指が伸びている", [0, 1, 1, 0]],
  ] as const)("%s時は指を差していない", (_, curls) => {
    expect(shapeOf({ curls }).pointing).toBe(false);
  });

  it("握り具合は 4 本の指の曲がりの平均で，0〜1 に収まる", () => {
    const s = shapeOf({ curls: [0, 1, 0, 1] });
    expect(s.grip).toBeCloseTo((s.curls[0] + s.curls[1] + s.curls[2] + s.curls[3]) / 4, 9);
    for (const c of [OPEN, FIST, POINT]) {
      const g = shapeOf({ curls: c }).grip;
      expect(g).toBeGreaterThanOrEqual(0);
      expect(g).toBeLessThanOrEqual(1);
    }
  });

  it("指の曲げを強めるほど握り具合が大きくなる", () => {
    const grips = [0, 0.25, 0.5, 0.75, 1].map((c) => shapeOf({ curls: [c, c, c, c] }).grip);
    for (let i = 1; i < grips.length; i++) expect(grips[i]).toBeGreaterThanOrEqual(grips[i - 1]);
    expect(grips[4]).toBeGreaterThan(grips[0]);
  });

  it("つまむ: 親指の先を人差し指の先に付けると距離の比が小さく，離すと大きい", () => {
    expect(shapeOf({ pinch: true }).pinchRatio).toBeLessThan(P.pinchOnRatio);
    expect(shapeOf({ pinch: false }).pinchRatio).toBeGreaterThan(P.pinchOffRatio);
  });

  it("手の大きさ（カメラからの距離）が変わっても同じ形の値になる", () => {
    for (const curls of [OPEN, FIST, POINT]) {
      const near = shapeOf({ curls, size: 0.3 });
      const far = shapeOf({ curls, size: 0.1 });
      expect(near.grip).toBeCloseTo(far.grip, 6);
      expect(near.pointing).toBe(far.pointing);
      expect(near.pinchRatio).toBeCloseTo(far.pinchRatio, 6);
    }
    expect(shapeOf({ size: 0.3 }).size).toBeCloseTo(3 * shapeOf({ size: 0.1 }).size, 6);
  });

  it("画像の縦横の比を直して計算する（横長の画像でも同じ形の値）", () => {
    const wide = computeHandShape(handLandmarks({ curls: FIST, aspect: 16 / 9 }), 16 / 9, P);
    const square = computeHandShape(handLandmarks({ curls: FIST, aspect: 1 }), 1, P);
    expect(wide?.grip).toBeCloseTo(square?.grip ?? Number.NaN, 6);
  });

  it("点が 21 個より少なければ null", () => {
    expect(computeHandShape(handLandmarks().slice(0, 20), ASPECT, P)).toBeNull();
    expect(computeHandShape([], ASPECT, P)).toBeNull();
  });

  it.each([Number.NaN, Number.POSITIVE_INFINITY])("値が有限でない点（%s）があれば null", (v) => {
    const lm = handLandmarks();
    lm[12] = { ...lm[12], y: v };
    expect(computeHandShape(lm, ASPECT, P)).toBeNull();
  });

  it.each([0, -1, Number.NaN])("縦横の比が %s なら null", (aspect) => {
    expect(computeHandShape(handLandmarks(), aspect, P)).toBeNull();
  });

  it("手の大きさが 0（すべての点が同じ所）なら null", () => {
    const lm = Array.from({ length: 21 }, () => ({ x: 0.5, y: 0.5, z: 0 }));
    expect(computeHandShape(lm, ASPECT, P)).toBeNull();
  });

  it("21 点より多くても計算できる", () => {
    const lm = [...handLandmarks({ curls: FIST }), { x: 0, y: 0, z: 0 }];
    expect(computeHandShape(lm, ASPECT, P)?.grip).toBeGreaterThan(P.gripOn);
  });
});

describe("nextGripped", () => {
  it.each([
    // 開いている時: 0.6 を超えたら握った
    [false, 0.0, false],
    [false, 0.5, false],
    [false, 0.6, false],
    [false, 0.61, true],
    [false, 1.0, true],
    // 握っている時: 0.4 を下回ったら開いた
    [true, 1.0, true],
    [true, 0.5, true],
    [true, 0.4, true],
    [true, 0.39, false],
    [true, 0.0, false],
  ])("前が %s で握り具合 %s → %s", (prev, raw, next) => {
    expect(nextGripped(prev, raw, 0.6, 0.4)).toBe(next);
  });

  it.each([Number.NaN, Number.POSITIVE_INFINITY])("握り具合が %s なら前の状態を保つ", (raw) => {
    expect(nextGripped(true, raw, 0.6, 0.4)).toBe(true);
    expect(nextGripped(false, raw, 0.6, 0.4)).toBe(false);
  });

  it("0.4〜0.6 の間を行き来しても状態は変わらない", () => {
    let g = false;
    for (const raw of [0.45, 0.55, 0.59, 0.41]) g = nextGripped(g, raw, 0.6, 0.4);
    expect(g).toBe(false);
    g = nextGripped(g, 0.7, 0.6, 0.4);
    for (const raw of [0.55, 0.41, 0.45, 0.59]) g = nextGripped(g, raw, 0.6, 0.4);
    expect(g).toBe(true);
  });
});

describe("gripOutput", () => {
  it.each([
    [true, 0.5, 0.6],
    [true, 0.3, 0.6],
    [true, 0.9, 0.9],
    [true, 2, 1],
    [false, 0.5, 0.4],
    [false, 0.9, 0.4],
    [false, 0.2, 0.2],
    [false, -1, 0],
  ])("握った状態 %s・握り具合 %s → %s", (gripped, raw, out) => {
    expect(gripOutput(gripped, raw, 0.6, 0.4)).toBeCloseTo(out, 9);
  });

  it("握った状態の間は 0.5 で区切っても握っている側，開いた状態の間は開いている側になる", () => {
    for (const raw of [0, 0.1, 0.39, 0.4, 0.5, 0.6, 0.61, 1]) {
      expect(gripOutput(true, raw, 0.6, 0.4)).toBeGreaterThan(0.5);
      expect(gripOutput(false, raw, 0.6, 0.4)).toBeLessThan(0.5);
    }
  });

  it("握り具合が有限でない時は，握っていれば 1，開いていれば 0", () => {
    expect(gripOutput(true, Number.NaN, 0.6, 0.4)).toBe(1);
    expect(gripOutput(false, Number.NaN, 0.6, 0.4)).toBe(0);
  });
});

describe("nextPinching", () => {
  it.each([
    [false, 0.1, true],
    [false, 0.25, false],
    [false, 0.3, false],
    [true, 0.3, true],
    [true, 0.4, true],
    [true, 0.41, false],
  ])("前が %s で距離の比 %s → %s", (prev, ratio, next) => {
    expect(nextPinching(prev, ratio, 0.25, 0.4)).toBe(next);
  });

  it("距離の比が有限でなければ前の状態を保つ", () => {
    expect(nextPinching(true, Number.NaN, 0.25, 0.4)).toBe(true);
    expect(nextPinching(false, Number.NaN, 0.25, 0.4)).toBe(false);
  });
});

describe("pinchAmount", () => {
  it.each([
    [0, 1],
    [0.2, 0.5],
    [0.4, 0],
    [1, 0],
    [-0.1, 1],
    [Number.NaN, 0],
    [Number.POSITIVE_INFINITY, 0],
  ])("距離の比 %s → %s", (ratio, amount) => {
    expect(pinchAmount(ratio, 0.4)).toBeCloseTo(amount, 9);
  });

  it("off が 0 以下なら 0", () => {
    expect(pinchAmount(0.1, 0)).toBe(0);
    expect(pinchAmount(0.1, -1)).toBe(0);
  });
});

describe("nextConfirmed", () => {
  it("今と違う結果が 2 回続いたら切り替わる", () => {
    const a = nextConfirmed(INITIAL_CONFIRM, true, 2);
    expect(a.value).toBe(false);
    const b = nextConfirmed(a, true, 2);
    expect(b).toEqual({ value: true, streak: 0 });
  });

  it("1 回だけ違う結果が出ても切り替わらず，数え直す", () => {
    let s = nextConfirmed(INITIAL_CONFIRM, true, 2);
    s = nextConfirmed(s, false, 2);
    expect(s).toEqual({ value: false, streak: 0 });
    s = nextConfirmed(s, true, 2);
    expect(s.value).toBe(false);
  });

  it("解除も 2 回続けて確かめる", () => {
    let s = { value: true, streak: 0 };
    s = nextConfirmed(s, false, 2);
    expect(s.value).toBe(true);
    s = nextConfirmed(s, false, 2);
    expect(s.value).toBe(false);
  });

  it.each([1, 0, -3])("回数が %s（1 以下）なら 1 回で切り替わる", (count) => {
    expect(nextConfirmed(INITIAL_CONFIRM, true, count).value).toBe(true);
  });

  it("同じ結果が続く時は前の状態のまま", () => {
    expect(nextConfirmed(INITIAL_CONFIRM, false, 2)).toBe(INITIAL_CONFIRM);
  });
});
