import { describe, expect, it } from "vitest";
import { IDLE_PLAYER_INPUT, type PlayerInput, UNTRACKED_HAND } from "../core/types";
import { quatFromYawPitch } from "./head/quat";
import { formatHands, formatPlayerInput, parseInputKind } from "./inputParam";

describe("parseInputKind", () => {
  it.each([
    ["?input=mock", "mock"],
    ["?input=device", "device"],
    ["?input=MOCK", "mock"],
    ["?input=Device", "device"],
    ["?input=%20mock%20", "mock"],
    ["?scene=train&input=mock", "mock"],
    ["input=device", "device"],
    ["?input=replay", "replay"],
    ["?input=REPLAY", "replay"],
    ["?scene=train&input=replay&log=20261024-143537_o0qich1i.jsonl&from=30", "replay"],
    ["?app&input=replay", "replay"],
  ])("%s → %s", (search, kind) => {
    expect(parseInputKind(search)).toBe(kind);
  });

  it.each([
    "",
    "?",
    "?input=",
    "?input=hands",
    "?input=mocks",
    "?input=replays",
    "?scene=train",
    "?Input=mock",
  ])("%s → null（今までどおりの操作）", (search) => {
    expect(parseInputKind(search)).toBeNull();
  });
});

describe("formatPlayerInput", () => {
  it("posture・walking・walkSpeed・頭のヨーとピッチを出す", () => {
    const input: PlayerInput = {
      ...IDLE_PLAYER_INPUT,
      head: quatFromYawPitch((30 * Math.PI) / 180, (-10 * Math.PI) / 180),
      posture: "crouching",
      walking: true,
      walkSpeed: 0.987,
    };
    const text = formatPlayerInput(input);
    expect(text.split("\n")).toHaveLength(3);
    expect(text).toContain("crouching");
    expect(text).toContain("true");
    expect(text).toContain("0.99 m/s");
    expect(text).toContain("yaw 30°");
    expect(text).toContain("pitch -10°");
  });

  it("入力が無い時の値", () => {
    const text = formatPlayerInput(IDLE_PLAYER_INPUT);
    expect(text).toContain("standing");
    expect(text).toContain("false");
    expect(text).toContain("0.00 m/s");
    expect(text).toContain("yaw 0°");
    expect(text).toContain("pitch 0°");
  });
});

describe("formatHands", () => {
  it("認識していない手は - を出す", () => {
    expect(formatHands({ left: UNTRACKED_HAND, right: UNTRACKED_HAND })).toBe("hands    L -  R -");
  });

  it("認識している手は位置（m）と grip を小数 2 桁で出す", () => {
    const text = formatHands({
      left: UNTRACKED_HAND,
      right: { tracked: true, position: { x: 0.123, y: -0.2, z: -0.456 }, grip: 0.6 },
    });
    expect(text).toBe("hands    L -  R (0.12, -0.20, -0.46) grip 0.60");
  });

  it("両手とも出す（1 行）", () => {
    const h = { tracked: true, position: { x: 0, y: 0, z: -0.5 }, grip: 1 };
    const text = formatHands({ left: h, right: h });
    expect(text.split("\n")).toHaveLength(1);
    expect(text).toContain("L (0.00, 0.00, -0.50) grip 1.00");
    expect(text).toContain("R (0.00, 0.00, -0.50) grip 1.00");
  });
});
