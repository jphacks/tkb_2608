import { describe, expect, it } from "vitest";
import { type HandState, UNTRACKED_HAND, type Vec3 } from "../core/types";
import {
  type HandScreenView,
  handScreenPoints,
  handToScreen,
  isAnyPointInRect,
  isOnScreen,
  isPointInRect,
  type ScreenRect,
} from "./homeHandStart";

/** 横 90 度（tan 45° = 1），目の位置から見る */
const view = (over: Partial<HandScreenView> = {}): HandScreenView => ({
  fovDeg: 90,
  axis: "horizontal",
  originZ: 0,
  ...over,
});

const hand = (position: Vec3, tracked = true): HandState => ({ tracked, position, grip: 0 });

const rect = (over: Partial<ScreenRect> = {}): ScreenRect => ({
  left: 100,
  top: 200,
  right: 300,
  bottom: 260,
  ...over,
});

describe("handToScreen", () => {
  it("正面の手は画面の真ん中", () => {
    expect(handToScreen({ x: 0, y: 0, z: -0.4 }, view(), 800, 400)).toEqual({ x: 400, y: 200 });
  });

  it("横の画角の端（x = 奥行き）は画面の右端，上は y が小さくなる", () => {
    const p = handToScreen({ x: 0.4, y: 0.1, z: -0.4 }, view(), 800, 400);
    expect(p?.x).toBeCloseTo(800);
    // 縦の画角の半分の tan = 1 × 400 / 800 = 0.5．y / 奥行き = 0.25 は上半分の半ば
    expect(p?.y).toBeCloseTo(100);
  });

  it("縦の画角で合わせると，横は画面の縦横比で広がる", () => {
    const p = handToScreen({ x: 0.8, y: -0.4, z: -0.4 }, view({ axis: "vertical" }), 800, 400);
    expect(p?.x).toBeCloseTo(800);
    expect(p?.y).toBeCloseTo(400);
  });

  it("見る点の位置（originZ）からの奥行きで写す", () => {
    // 見る点が z = -0.1 なので，奥行きは 0.3
    const p = handToScreen({ x: 0.3, y: 0, z: -0.4 }, view({ originZ: -0.1 }), 800, 400);
    expect(p?.x).toBeCloseTo(800);
  });

  it("画面の外の点もそのまま返す", () => {
    const p = handToScreen({ x: -0.8, y: 0, z: -0.4 }, view(), 800, 400);
    expect(p?.x).toBeCloseTo(-400);
  });

  it.each([
    ["見る点の上", { x: 0, y: 0, z: 0 }],
    ["見る点より後ろ", { x: 0, y: 0, z: 0.2 }],
    ["NaN", { x: Number.NaN, y: 0, z: -0.4 }],
    ["奥行きが無限", { x: 0, y: 0, z: Number.NEGATIVE_INFINITY }],
  ])("%s は null", (_, position) => {
    expect(handToScreen(position, view(), 800, 400)).toBeNull();
  });

  it.each([
    ["画角 0", view({ fovDeg: 0 }), 800, 400],
    ["画角 180", view({ fovDeg: 180 }), 800, 400],
    ["画角 NaN", view({ fovDeg: Number.NaN }), 800, 400],
    ["幅 0", view(), 0, 400],
    ["高さが負", view(), 800, -1],
    ["幅が無限", view(), Number.POSITIVE_INFINITY, 400],
  ])("%s は null", (_, v, width, height) => {
    expect(handToScreen({ x: 0, y: 0, z: -0.4 }, v, width, height)).toBeNull();
  });
});

describe("isOnScreen", () => {
  it.each([
    [{ x: 0, y: 0 }, true],
    [{ x: 800, y: 400 }, true],
    [{ x: -0.1, y: 10 }, false],
    [{ x: 10, y: 400.1 }, false],
  ])("%o → %s", (point, expected) => {
    expect(isOnScreen(point, 800, 400)).toBe(expected);
  });
});

describe("isPointInRect", () => {
  it.each([
    ["中", { x: 200, y: 230 }, 0, true],
    ["角（境界）", { x: 100, y: 200 }, 0, true],
    ["左の外", { x: 99, y: 230 }, 0, false],
    ["余白の中", { x: 90, y: 270 }, 16, true],
    ["余白の外", { x: 83, y: 230 }, 16, false],
    ["負の余白は 0 とみなす", { x: 99, y: 230 }, -10, false],
    ["NaN の余白は 0 とみなす", { x: 99, y: 230 }, Number.NaN, false],
    ["NaN の点は入らない", { x: Number.NaN, y: 230 }, 16, false],
  ])("%s", (_, point, margin, expected) => {
    expect(isPointInRect(point, rect(), margin)).toBe(expected);
  });
});

describe("handScreenPoints", () => {
  it("見失った手・画面の外の手は null", () => {
    const points = handScreenPoints(
      { left: hand({ x: -0.8, y: 0, z: -0.4 }), right: UNTRACKED_HAND },
      view(),
      800,
      400,
    );
    expect(points).toEqual({ left: null, right: null });
  });

  it("見えている手は画面の上の点", () => {
    const points = handScreenPoints(
      { left: hand({ x: 0, y: 0, z: -0.4 }), right: hand({ x: 0.2, y: 0, z: -0.4 }) },
      view(),
      800,
      400,
    );
    expect(points.left).toEqual({ x: 400, y: 200 });
    expect(points.right?.x).toBeCloseTo(600);
  });

  it("tracked が false なら位置が画面の中でも null", () => {
    const points = handScreenPoints(
      { left: hand({ x: 0, y: 0, z: -0.4 }, false), right: UNTRACKED_HAND },
      view(),
      800,
      400,
    );
    expect(points.left).toBeNull();
  });
});

describe("isAnyPointInRect", () => {
  it.each([
    ["どちらも無い", null, null, false],
    ["左が入る", { x: 200, y: 230 }, null, true],
    ["右が入る", { x: 0, y: 0 }, { x: 150, y: 210 }, true],
    ["どちらも外", { x: 0, y: 0 }, { x: 500, y: 230 }, false],
  ])("%s", (_, left, right, expected) => {
    expect(isAnyPointInRect({ left, right }, rect())).toBe(expected);
  });
});
