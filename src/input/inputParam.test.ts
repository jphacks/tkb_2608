import { describe, expect, it } from "vitest";
import { IDLE_PLAYER_INPUT, type PlayerInput } from "../core/types";
import { quatFromYawPitch } from "./head/quat";
import { formatPlayerInput, parseInputKind } from "./inputParam";

describe("parseInputKind", () => {
  it.each([
    ["?input=mock", "mock"],
    ["?input=device", "device"],
    ["?input=MOCK", "mock"],
    ["?input=Device", "device"],
    ["?input=%20mock%20", "mock"],
    ["?scene=train&input=mock", "mock"],
    ["input=device", "device"],
  ])("%s → %s", (search, kind) => {
    expect(parseInputKind(search)).toBe(kind);
  });

  it.each(["", "?", "?input=", "?input=hands", "?input=mocks", "?scene=train", "?Input=mock"])(
    "%s → null（今までどおりの操作）",
    (search) => {
      expect(parseInputKind(search)).toBeNull();
    },
  );
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
