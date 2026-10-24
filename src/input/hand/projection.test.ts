// 2D の座標から頭の座標系の 3D の位置へ（experiment_山﨑/07「2D の座標から 3D の位置へ」）
import { describe, expect, it } from "vitest";
import {
  type CameraModel,
  estimateDepth,
  focalLengthPx,
  headToImage,
  imageToHead,
} from "./projection";
import { handLandmarks, IMG_H, IMG_W } from "./testHands";

function cam(o: Partial<CameraModel> = {}): CameraModel {
  return { hfovDeg: 65, width: IMG_W, height: IMG_H, offset: { x: 0, y: 0, z: -0.08 }, ...o };
}

describe("focalLengthPx", () => {
  it("横の画角 90° なら幅の半分", () => {
    expect(focalLengthPx({ hfovDeg: 90, width: 320 })).toBeCloseTo(160, 9);
  });

  it("画角が狭いほど焦点距離が長い", () => {
    expect(focalLengthPx({ hfovDeg: 50, width: 320 })).toBeGreaterThan(
      focalLengthPx({ hfovDeg: 65, width: 320 }),
    );
  });

  it.each([
    [0, 320],
    [-10, 320],
    [180, 320],
    [200, 320],
    [Number.NaN, 320],
    [65, 0],
    [65, -320],
    [65, Number.NaN],
  ])("画角 %s°・幅 %s px なら NaN", (hfovDeg, width) => {
    expect(focalLengthPx({ hfovDeg, width })).toBeNaN();
  });
});

describe("estimateDepth", () => {
  const C = cam();

  it("手のひらが大きく写るほど近い", () => {
    const near = estimateDepth(handLandmarks({ size: 0.3 }), C, 0.095, 0.15, 1.0);
    const mid = estimateDepth(handLandmarks({ size: 0.2 }), C, 0.095, 0.15, 1.0);
    const far = estimateDepth(handLandmarks({ size: 0.12 }), C, 0.095, 0.15, 1.0);
    expect(near).toBeLessThan(mid);
    expect(mid).toBeLessThan(far);
  });

  it("距離 ≒ 実際の長さ ÷ 画像上の長さ × 焦点距離", () => {
    const size = 0.2;
    const d = estimateDepth(handLandmarks({ size }), C, 0.095, 0.15, 1.0);
    expect(d).toBeCloseTo((0.095 * focalLengthPx(C)) / (size * IMG_H), 6);
    // 手を伸ばした距離（約 0.4〜0.6 m）になる大きさ
    expect(d).toBeGreaterThan(0.4);
    expect(d).toBeLessThan(0.6);
  });

  it("手が奥に傾いて画像の上で短く見えても，z を含めて長さを測る", () => {
    const flat = handLandmarks({ size: 0.2 });
    const tilted = flat.map((p, i) => (i === 9 ? { ...p, z: -0.1 } : p));
    const dFlat = estimateDepth(flat, C, 0.095, 0.15, 1.0);
    const dTilted = estimateDepth(tilted, C, 0.095, 0.15, 1.0);
    expect(dTilted).toBeLessThan(dFlat);
  });

  it("下限・上限に収める", () => {
    expect(estimateDepth(handLandmarks({ size: 0.9 }), C, 0.095, 0.15, 1.0)).toBe(0.15);
    expect(estimateDepth(handLandmarks({ size: 0.02 }), C, 0.095, 0.15, 1.0)).toBe(1.0);
  });

  it("点が足りない（中指の付け根が無い）なら NaN", () => {
    expect(estimateDepth(handLandmarks().slice(0, 9), C, 0.095, 0.15, 1.0)).toBeNaN();
    expect(estimateDepth([], C, 0.095, 0.15, 1.0)).toBeNaN();
  });

  it("手首と中指の付け根が同じ所なら NaN", () => {
    const lm = handLandmarks();
    lm[9] = lm[0];
    expect(estimateDepth(lm, C, 0.095, 0.15, 1.0)).toBeNaN();
  });

  it.each([
    ["手のひらの長さが 0", { palm: 0, c: C }],
    ["手のひらの長さが NaN", { palm: Number.NaN, c: C }],
    ["画角がおかしい", { palm: 0.095, c: cam({ hfovDeg: 0 }) }],
  ])("%s なら NaN", (_, { palm, c }) => {
    expect(estimateDepth(handLandmarks(), c, palm, 0.15, 1.0)).toBeNaN();
  });

  it("点に NaN があれば NaN", () => {
    const lm = handLandmarks();
    lm[0] = { ...lm[0], x: Number.NaN };
    expect(estimateDepth(lm, C, 0.095, 0.15, 1.0)).toBeNaN();
  });
});

describe("imageToHead", () => {
  const C = cam();

  it("画像の中央は，カメラの位置から視線の方向（-z）へ奥行き分の所", () => {
    const p = imageToHead({ x: 0.5, y: 0.5, z: 0 }, 0.5, C);
    expect(p?.x).toBeCloseTo(0, 9);
    expect(p?.y).toBeCloseTo(0, 9);
    expect(p?.z).toBeCloseTo(-0.58, 9);
  });

  it("画像の右は +x，画像の上は +y（背面カメラは左右反転しない）", () => {
    const right = imageToHead({ x: 0.8, y: 0.5, z: 0 }, 0.5, C);
    const up = imageToHead({ x: 0.5, y: 0.2, z: 0 }, 0.5, C);
    expect(right?.x).toBeGreaterThan(0);
    expect(up?.y).toBeGreaterThan(0);
  });

  it("画像の端は画角の半分の向き", () => {
    const p = imageToHead(
      { x: 1, y: 0.5, z: 0 },
      1,
      cam({ hfovDeg: 90, offset: { x: 0, y: 0, z: 0 } }),
    );
    expect(p?.x).toBeCloseTo(1, 9);
    expect(p?.z).toBeCloseTo(-1, 9);
  });

  it("カメラのずれを足す", () => {
    const p = imageToHead(
      { x: 0.5, y: 0.5, z: 0 },
      0.4,
      cam({ offset: { x: 0.03, y: -0.02, z: -0.1 } }),
    );
    expect(p).toEqual({ x: 0.03, y: -0.02, z: -0.5 });
  });

  it.each([
    ["奥行きが 0", { x: 0.5, y: 0.5, z: 0 }, 0, C],
    ["奥行きが負", { x: 0.5, y: 0.5, z: 0 }, -0.3, C],
    ["奥行きが NaN", { x: 0.5, y: 0.5, z: 0 }, Number.NaN, C],
    ["x が NaN", { x: Number.NaN, y: 0.5, z: 0 }, 0.5, C],
    ["y が Infinity", { x: 0.5, y: Number.POSITIVE_INFINITY, z: 0 }, 0.5, C],
    ["画角がおかしい", { x: 0.5, y: 0.5, z: 0 }, 0.5, cam({ hfovDeg: 0 })],
    ["高さが 0", { x: 0.5, y: 0.5, z: 0 }, 0.5, cam({ height: 0 })],
  ])("%s なら null", (_, p, d, c) => {
    expect(imageToHead(p, d, c)).toBeNull();
  });
});

describe("headToImage", () => {
  it.each([
    [0.5, 0.5, 0.45],
    [0.1, 0.2, 0.3],
    [0.9, 0.85, 0.8],
    [0, 0, 0.15],
    [1, 1, 1.0],
  ])("imageToHead の逆（(%s, %s)・奥行き %s m で往復すると元の点）", (x, y, d) => {
    const C = cam({ offset: { x: 0.02, y: -0.01, z: -0.08 } });
    const head = imageToHead({ x, y, z: 0 }, d, C);
    expect(head).not.toBeNull();
    const back = head ? headToImage(head, C) : null;
    expect(back?.x).toBeCloseTo(x, 9);
    expect(back?.y).toBeCloseTo(y, 9);
  });

  it("カメラより後ろ・カメラと同じ奥行きの点は null", () => {
    const C = cam();
    expect(headToImage({ x: 0, y: 0, z: 0.1 }, C)).toBeNull();
    expect(headToImage({ x: 0, y: 0, z: -0.08 }, C)).toBeNull();
  });

  it("値がおかしい時は null", () => {
    expect(headToImage({ x: Number.NaN, y: 0, z: -0.5 }, cam())).toBeNull();
    expect(headToImage({ x: 0, y: 0, z: -0.5 }, cam({ hfovDeg: 0 }))).toBeNull();
    expect(headToImage({ x: 0, y: 0, z: -0.5 }, cam({ width: 0 }))).toBeNull();
    expect(headToImage({ x: 0, y: 0, z: -0.5 }, cam({ height: 0 }))).toBeNull();
  });
});
