// 空間の切り替え（?scene=）．room・train・elevator・school-parts の 4 空間を選べ，未知の値・指定なしは room にフォールバックする．
// 各空間は canvas でテクスチャを描くため，document を何もしない canvas に差し替えて組み立てだけを確かめる

import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { createElevatorScene } from "./elevator/elevator";
import { AVAILABLE_SPACE_IDS, createSpace } from "./index";
import { createRoomScene } from "./room/room";
import { createSchoolPartsScene } from "./school/schoolPartsPreview";
import { resolveSpaceId } from "./spaceParam";
import { createTrainScene } from "./train/train";

// createSpace が選んだ id の factory だけを呼ぶことを確かめるため，各 factory を本物を呼ぶスパイにする
vi.mock("./room/room", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./room/room")>();
  return { ...actual, createRoomScene: vi.fn(actual.createRoomScene) };
});
vi.mock("./train/train", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./train/train")>();
  return { ...actual, createTrainScene: vi.fn(actual.createTrainScene) };
});
vi.mock("./elevator/elevator", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./elevator/elevator")>();
  return { ...actual, createElevatorScene: vi.fn(actual.createElevatorScene) };
});
vi.mock("./school/schoolPartsPreview", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./school/schoolPartsPreview")>();
  return { ...actual, createSchoolPartsScene: vi.fn(actual.createSchoolPartsScene) };
});

/** 何もしない 2D コンテキスト（メソッドは空の関数，グラデーション等は空のオブジェクト） */
function fakeContext(): CanvasRenderingContext2D {
  const store: Record<string | symbol, unknown> = {};
  const noopResult = { addColorStop: () => {}, width: 0 };
  return new Proxy(store, {
    get: (target, prop) => (prop in target ? target[prop] : () => noopResult),
    set: (target, prop, value) => {
      target[prop] = value;
      return true;
    },
  }) as unknown as CanvasRenderingContext2D;
}

beforeAll(() => {
  vi.stubGlobal("document", {
    createElement: (tag: string) => {
      if (tag !== "canvas") throw new Error(`unexpected element: ${tag}`);
      const ctx = fakeContext();
      return { width: 0, height: 0, getContext: () => ctx };
    },
  });
});

afterAll(() => {
  vi.unstubAllGlobals();
});

afterEach(() => {
  vi.mocked(createRoomScene).mockClear();
  vi.mocked(createTrainScene).mockClear();
  vi.mocked(createElevatorScene).mockClear();
  vi.mocked(createSchoolPartsScene).mockClear();
});

describe("空間の切り替え（?scene=）", () => {
  it("room・train・elevator・school-parts が実装済み", () => {
    expect([...AVAILABLE_SPACE_IDS].sort()).toEqual(["elevator", "room", "school-parts", "train"]);
  });

  it.each([
    ["?scene=room", "room"],
    ["?scene=train", "train"],
    ["?scene=elevator", "elevator"],
    ["?scene=ELEVATOR", "elevator"],
    ["?scene=school-parts", "school-parts"],
  ])("%s は %s", (search, expected) => {
    expect(resolveSpaceId(search, AVAILABLE_SPACE_IDS)).toBe(expected);
  });

  it.each(["?scene=bus", "?scene=kitchen", "?scene=", "?other=train", ""])(
    "未知の値・指定なし %j は room にフォールバック",
    (search) => {
      expect(resolveSpaceId(search, AVAILABLE_SPACE_IDS)).toBe("room");
    },
  );

  it.each(["room", "train", "elevator", "school-parts"] as const)(
    "createSpace(%j) で作れる",
    (id) => {
      const space = createSpace(id, { maxAnisotropy: 1 });
      expect(space.id).toBe(id);
      expect(space.root.children.length).toBeGreaterThan(0);
      space.dispose();
    },
  );

  it("createSpace は選んだ空間の factory だけを呼ぶ", () => {
    const factories = {
      room: vi.mocked(createRoomScene),
      train: vi.mocked(createTrainScene),
      elevator: vi.mocked(createElevatorScene),
      "school-parts": vi.mocked(createSchoolPartsScene),
    };
    for (const id of ["elevator", "train", "room", "school-parts"] as const) {
      for (const f of Object.values(factories)) f.mockClear();
      createSpace(id, { maxAnisotropy: 1 }).dispose();
      for (const [key, f] of Object.entries(factories)) {
        expect(f).toHaveBeenCalledTimes(key === id ? 1 : 0);
      }
    }
  });
});
