import { describe, expect, it } from "vitest";
import { isPortraitViewport } from "./viewportOrientation";

describe("isPortraitViewport", () => {
  it.each([
    [390, 844],
    [1, 2],
    [100, 100.5],
  ])("縦が横より長い（%d × %d）時は縦長", (w, h) => {
    expect(isPortraitViewport(w, h)).toBe(true);
  });

  it.each([
    [844, 390],
    [1920, 1080],
    [100.5, 100],
  ])("横が縦より長い（%d × %d）時は縦長でない", (w, h) => {
    expect(isPortraitViewport(w, h)).toBe(false);
  });

  it("正方形は縦長とみなさない", () => {
    expect(isPortraitViewport(500, 500)).toBe(false);
  });

  it.each([
    [0, 844],
    [390, 0],
    [0, 0],
    [-390, 844],
    [390, -844],
    [-844, -390],
  ])("0 以下の値（%d × %d）は縦長とみなさない", (w, h) => {
    expect(isPortraitViewport(w, h)).toBe(false);
  });

  it.each([
    [Number.NaN, 844],
    [390, Number.NaN],
    [390, Number.POSITIVE_INFINITY],
    [Number.POSITIVE_INFINITY, 844],
    [Number.NEGATIVE_INFINITY, 844],
    [Number.NaN, Number.NaN],
  ])("有限でない値（%d × %d）は縦長とみなさない", (w, h) => {
    expect(isPortraitViewport(w, h)).toBe(false);
  });
});
