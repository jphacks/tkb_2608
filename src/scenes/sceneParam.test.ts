import { describe, expect, it } from "vitest";
import { DEFAULT_SCENE_ID, parseSceneId, resolveSceneId, type SceneId } from "./sceneParam";

describe("parseSceneId", () => {
  it.each([
    ["?scene=room", "room"],
    ["?scene=train", "train"],
    ["?scene=elevator", "elevator"],
    ["scene=room", "room"],
    ["?foo=1&scene=train", "train"],
  ])("%s → %s", (search, expected) => {
    expect(parseSceneId(search)).toBe(expected);
  });

  it("大文字小文字を区別しない", () => {
    expect(parseSceneId("?scene=ROOM")).toBe("room");
    expect(parseSceneId("?scene=Elevator")).toBe("elevator");
  });

  it("前後の空白を除く", () => {
    expect(parseSceneId("?scene=%20train%20")).toBe("train");
    expect(parseSceneId("?scene=+room+")).toBe("room");
  });

  it.each(["", "?", "?scene=", "?scene=kitchen", "?other=room", "?scene=ro%20om"])(
    "不正・指定なし %j は null",
    (search) => {
      expect(parseSceneId(search)).toBeNull();
    },
  );
});

describe("resolveSceneId", () => {
  const onlyRoom: SceneId[] = ["room"];

  it("既定のフォールバックは room", () => {
    expect(DEFAULT_SCENE_ID).toBe("room");
  });

  it("?scene=room は room", () => {
    expect(resolveSceneId("?scene=room", onlyRoom)).toBe("room");
  });

  it.each(["?scene=train", "?scene=elevator", "?scene=xxx", "", "?scene="])(
    "未実装・不正・指定なし %j は room にフォールバック",
    (search) => {
      expect(resolveSceneId(search, onlyRoom)).toBe("room");
    },
  );

  it("実装済みなら train も選べる", () => {
    expect(resolveSceneId("?scene=train", ["room", "train"])).toBe("train");
  });

  it("fallback を指定できる", () => {
    expect(resolveSceneId("?scene=bad", ["room", "train"], "train")).toBe("train");
  });
});
