// 校舎の空間の歩行（schoolPlanWalk.ts）のエリアと，校舎の空間に集合場所の印が付くことのテスト．
// 基準は Issue #155 の完了条件（デモの校舎で集合場所が見える・集合場所のマスに入ると assembly のエリアに入る）．
// canvas は何もしない物に差し替える

import * as THREE from "three";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import type { GameEvent } from "../../core/events";
import { IDLE_PLAYER_INPUT, type PlayerInput } from "../../core/types";
import { DEMO_SCHOOL } from "../../share/samples/demoSchool";
import { areasAt } from "../walk/areas";
import { SpaceWalker } from "../walk/walker";
import { ASSEMBLY_MARKER_NAME } from "./assemblyMarker";
import { ASSEMBLY_AREA, CORRIDOR_AREA, OUTDOOR_AREA } from "./schoolAreas";
import { createSchoolScene, type SchoolSpace } from "./schoolPlanScene";
import { createSchoolWalkWorld } from "./schoolPlanWalk";

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

const WALK: PlayerInput = { ...IDLE_PLAYER_INPUT, walking: true, walkSpeed: 1 };

let space: SchoolSpace | undefined;

function build(mode: "learn" | "test" = "learn"): SchoolSpace {
  space = createSchoolScene(
    { maxAnisotropy: 1 },
    { ...DEMO_SCHOOL, drill: { ...DEMO_SCHOOL.drill, mode } },
  );
  return space;
}

afterEach(() => {
  space?.dispose();
  space = undefined;
});

describe("createSchoolScene の集合場所の印", () => {
  it.each(["learn", "test"] as const)("%s モードでも root の直下に集合場所の印がある", (mode) => {
    const s = build(mode);
    const marker = s.root.getObjectByName(ASSEMBLY_MARKER_NAME);
    expect(marker?.parent).toBe(s.root);
    expect(marker).toBe(s.assemblyMarker.object);
    expect(marker?.children.some((c) => c instanceof THREE.InstancedMesh)).toBe(true);
  });

  it("dispose で印を root から外す", () => {
    const s = build();
    s.dispose();
    space = undefined;
    expect(s.root.getObjectByName(ASSEMBLY_MARKER_NAME)).toBeUndefined();
  });
});

describe("createSchoolWalkWorld のエリア", () => {
  it.each([
    ["開始地点（1年1組）", 2.5, 2.5, ["room:0"]],
    ["廊下", 6.5, 6.5, [CORRIDOR_AREA]],
    ["校庭", 1.5, 11.5, [OUTDOOR_AREA]],
    ["集合場所", 8.5, 10.5, [ASSEMBLY_AREA, OUTDOOR_AREA]],
  ])("%s で SPEC_01 のエリアに入る", (_, x, z, expected) => {
    const world = createSchoolWalkWorld(build());
    const specIds = areasAt(world.areas, x, z).filter(
      (id) =>
        id === ASSEMBLY_AREA ||
        id === CORRIDOR_AREA ||
        id === OUTDOOR_AREA ||
        id.startsWith("room:"),
    );
    expect(specIds.sort()).toEqual([...expected].sort());
  });

  it("床の面のエリア（room-0-floor-0 等）も残す", () => {
    const world = createSchoolWalkWorld(build());
    expect(areasAt(world.areas, 2.5, 2.5)).toContain("room-0-floor-0");
  });

  it("歩いて集合場所に入ると areaEntered で assembly が流れる", () => {
    const s = build();
    const world = createSchoolWalkWorld(s);
    const events: GameEvent[] = [];
    // 集合場所のすぐ西（x = 7.5）から東を向いて歩く（向きは 0 で -Z，正で左へ回るので，東は -π/2）
    const walker = new SpaceWalker(
      world,
      { position: { x: 7.5, y: 1.6, z: 10.5 }, bodyYaw: -Math.PI / 2 },
      (e) => events.push(e),
    );
    expect(walker.observe().areaIds).not.toContain(ASSEMBLY_AREA);
    // 1 秒歩く（校舎の倍率 1.5 で x = 9.0．集合場所の中ほど）
    for (let i = 0; i < 30; i++) walker.update({ dt: 1 / 30, input: WALK });
    expect(events).toContainEqual({ type: "areaEntered", areaId: ASSEMBLY_AREA });
    expect(walker.observe().areaIds).toContain(ASSEMBLY_AREA);
  });
});
