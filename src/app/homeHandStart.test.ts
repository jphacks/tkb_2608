import { describe, expect, it } from "vitest";
import { DEFAULT_HAND_PARAMS } from "../input/hand/handParams";
import { applyMockHandPointer, INITIAL_MOCK_HAND, mockHandState } from "../input/mock/mockHand";
import { handToScreen } from "../lobby/homeHandStart";
import {
  createHomeHandPress,
  createHomeHandStart,
  HOME_HAND_PRESS_CONFIG,
  homeHandScreenView,
} from "./homeHandStart";

describe("homeHandScreenView", () => {
  it.each(["device", "replay"] as const)("%s は背面カメラの画角と位置で写す", (kind) => {
    expect(homeHandScreenView(kind)).toEqual({
      fovDeg: DEFAULT_HAND_PARAMS.cameraHfovDeg,
      axis: "horizontal",
      originZ: DEFAULT_HAND_PARAMS.cameraOffsetZM,
    });
  });

  it("mock はマウスの下に印が出る（マウスの位置から作った手を写すと元の位置に戻る）", () => {
    const view = homeHandScreenView("mock");
    const width = 1280;
    const height = 720;
    const mouse = applyMockHandPointer(INITIAL_MOCK_HAND, 900, 500, width, height);
    const p = handToScreen(mockHandState(mouse).position, view, width, height);
    expect(p?.x).toBeCloseTo(900);
    expect(p?.y).toBeCloseTo(500);
  });
});

describe("createHomeHandPress", () => {
  it("出してから armSeconds の間はかざしても数えない", () => {
    const press = createHomeHandPress();
    // armSeconds（1 秒）の間かざし続けても押さない
    for (let i = 0; i < 10; i += 1) expect(press.advance(0.1, true)).toBe(false);
    expect(press.progress).toBe(0);
  });

  it("押せるようになってから holdSeconds かざしたら，押したフレームだけ true", () => {
    const press = createHomeHandPress({ ...HOME_HAND_PRESS_CONFIG, armSeconds: 0 });
    const results: boolean[] = [];
    for (let i = 0; i < 12; i += 1) results.push(press.advance(0.1, true));
    expect(results.filter((r) => r)).toHaveLength(1);
    expect(press.progress).toBe(1);
  });

  it("離れたら数え直す", () => {
    const press = createHomeHandPress({ ...HOME_HAND_PRESS_CONFIG, armSeconds: 0 });
    press.advance(0.5, true);
    expect(press.progress).toBeCloseTo(0.5);
    press.advance(0.1, false);
    expect(press.progress).toBe(0);
  });

  it("dt が NaN・負の時は進まない", () => {
    const press = createHomeHandPress({ ...HOME_HAND_PRESS_CONFIG, armSeconds: 0 });
    press.advance(0.1, true);
    expect(press.advance(Number.NaN, true)).toBe(false);
    expect(press.advance(-1, true)).toBe(false);
    expect(press.progress).toBeCloseTo(0.1);
  });
});

describe("createHomeHandStart", () => {
  it.each([
    ["mock", true],
    ["device", false],
    ["replay", false],
  ] as const)("%s のクリックを下の画面へ通すか: %s", (kind, expected) => {
    const start = createHomeHandStart({
      kind,
      handsUsable: () => true,
      isPaused: () => false,
    });
    expect(start.pointerThrough).toBe(expected);
  });

  it("手を認識できるか・止めるかは渡した関数をそのまま使う", () => {
    let usable = false;
    let paused = true;
    const start = createHomeHandStart({
      kind: "device",
      handsUsable: () => usable,
      isPaused: () => paused,
    });
    expect(start.handsUsable()).toBe(false);
    expect(start.isPaused?.()).toBe(true);
    usable = true;
    paused = false;
    expect(start.handsUsable()).toBe(true);
    expect(start.isPaused?.()).toBe(false);
  });

  it("押した判定は呼ぶたびに新しく作る", () => {
    const start = createHomeHandStart({
      kind: "mock",
      handsUsable: () => true,
      isPaused: () => false,
    });
    const a = start.createPress();
    a.advance(2, true);
    a.advance(0.5, true);
    expect(a.progress).toBeCloseTo(0.5);
    expect(start.createPress().progress).toBe(0);
  });
});
