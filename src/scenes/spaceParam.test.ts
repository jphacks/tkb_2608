import { describe, expect, it } from "vitest";
import { DEFAULT_SPACE_ID, parseSpaceId, resolveSpaceId, type SpaceId } from "./spaceParam";

describe("parseSpaceId", () => {
  it.each([
    ["?scene=room", "room"],
    ["?scene=train", "train"],
    ["?scene=elevator", "elevator"],
    ["scene=room", "room"],
    ["?foo=1&scene=train", "train"],
  ])("%s → %s", (search, expected) => {
    expect(parseSpaceId(search)).toBe(expected);
  });

  it("大文字小文字を区別しない", () => {
    expect(parseSpaceId("?scene=ROOM")).toBe("room");
    expect(parseSpaceId("?scene=Elevator")).toBe("elevator");
  });

  it("前後の空白を除く", () => {
    expect(parseSpaceId("?scene=%20train%20")).toBe("train");
    expect(parseSpaceId("?scene=+room+")).toBe("room");
  });

  it.each(["", "?", "?scene=", "?scene=kitchen", "?other=room", "?scene=ro%20om"])(
    "不正・指定なし %j は null",
    (search) => {
      expect(parseSpaceId(search)).toBeNull();
    },
  );
});

describe("resolveSpaceId", () => {
  const onlyRoom: SpaceId[] = ["room"];

  it("既定のフォールバックは room", () => {
    expect(DEFAULT_SPACE_ID).toBe("room");
  });

  it("?scene=room は room", () => {
    expect(resolveSpaceId("?scene=room", onlyRoom)).toBe("room");
  });

  it.each(["?scene=train", "?scene=elevator", "?scene=xxx", "", "?scene="])(
    "未実装・不正・指定なし %j は room にフォールバック",
    (search) => {
      expect(resolveSpaceId(search, onlyRoom)).toBe("room");
    },
  );

  it("実装済みなら train も選べる", () => {
    expect(resolveSpaceId("?scene=train", ["room", "train"])).toBe("train");
  });

  it("fallback を指定できる", () => {
    expect(resolveSpaceId("?scene=bad", ["room", "train"], "train")).toBe("train");
  });
});
