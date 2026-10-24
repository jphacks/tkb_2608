// SpaceWalker（ScenarioWorld の実装）のテスト．
// Issue #31「エリアの出入りを GameEvent（areaEntered／areaExited）で流し，observe() で今いるエリアを返す」

import * as THREE from "three";
import { describe, expect, it } from "vitest";
import type { GameEvent } from "../../core/events";
import { IDLE_PLAYER_INPUT, type PlayerInput } from "../../core/types";
import type { WalkWorld } from "./locomotion";
import { SpaceWalker } from "./walker";

const WORLD: WalkWorld = {
  floors: [{ minX: -10, maxX: 10, minZ: -10, maxZ: 10 }],
  obstacles: [],
  doors: [],
  // a と b は隣り合う（z = -1 の境で接する），c は離れている
  areas: [
    { id: "a", minX: -1, maxX: 1, minZ: -1, maxZ: 1 },
    { id: "b", minX: -1, maxX: 1, minZ: -3, maxZ: -1.02 },
    { id: "c", minX: -1, maxX: 1, minZ: -8, maxZ: -6 },
  ],
  eyeHeights: { standing: 1.6, crouching: 0.55 },
  seats: [],
};

const WALK: PlayerInput = { ...IDLE_PLAYER_INPUT, walking: true, walkSpeed: 1 };

function setup(start = { x: 0, y: 1.6, z: 0 }, bodyYaw = 0) {
  const events: GameEvent[] = [];
  const walker = new SpaceWalker(WORLD, { position: start, bodyYaw }, (e) => events.push(e));
  return { walker, events };
}

describe("SpaceWalker", () => {
  it("開始位置のエリアは observe() で返し，イベントとしては流さない", () => {
    const { walker, events } = setup();
    expect(walker.observe().areaIds).toEqual(["a"]);
    walker.update({ dt: 1 / 30, input: IDLE_PLAYER_INPUT });
    expect(events).toEqual([]);
    expect(walker.observe().areaIds).toEqual(["a"]);
  });

  it("エリアを出入りするとイベントが流れ，observe() が今のエリアを返す", () => {
    const { walker, events } = setup();
    // -Z へ 2 秒（z = -2．a を出て b に入る）
    for (let i = 0; i < 60; i++) walker.update({ dt: 1 / 30, input: WALK });
    expect(walker.observe().areaIds).toEqual(["b"]);
    expect(events).toContainEqual({ type: "areaExited", areaId: "a" });
    expect(events).toContainEqual({ type: "areaEntered", areaId: "b" });
    // 各エリアの出入りは 1 回ずつ
    expect(events.filter((e) => e.type === "areaEntered" && e.areaId === "b")).toHaveLength(1);
    expect(events.filter((e) => e.type === "areaExited" && e.areaId === "a")).toHaveLength(1);
  });

  it("同じフレームで出入りが重なると，出た（areaExited）→ 入った（areaEntered）の順に流す", () => {
    const { walker, events } = setup({ x: 0, y: 1.6, z: -0.99 });
    // 1 フレームで 0.1m 進み，a（z ≧ -1）から b（z ≦ -1.02）へ移る
    walker.update({ dt: 0.1, input: WALK });
    expect(events).toEqual([
      { type: "areaExited", areaId: "a" },
      { type: "areaEntered", areaId: "b" },
    ]);
  });

  it("どのエリアにもいない時は空の一覧を返す．離れたエリアにはイベントが流れない", () => {
    const { walker, events } = setup({ x: 0, y: 1.6, z: -4 });
    expect(walker.observe().areaIds).toEqual([]);
    walker.update({ dt: 0.1, input: WALK });
    expect(walker.observe().areaIds).toEqual([]);
    expect(events).toEqual([]);
  });

  it("applyTo は rig を今の位置・目の高さ・体の向きに合わせる", () => {
    const { walker } = setup({ x: 0.5, y: 1.6, z: 0 }, Math.PI / 2);
    const rig = new THREE.Object3D();
    walker.applyTo(rig);
    expect(rig.position.x).toBeCloseTo(0.5);
    expect(rig.position.y).toBeCloseTo(1.6);
    expect(rig.position.z).toBeCloseTo(0);
    expect(rig.rotation.y).toBeCloseTo(Math.PI / 2);
    // 体が左 90°（-X 向き）なので -X へ進む
    for (let i = 0; i < 10; i++) walker.update({ dt: 0.1, input: WALK });
    walker.applyTo(rig);
    expect(rig.position.x).toBeCloseTo(-0.5, 2);
    expect(rig.position.z).toBeCloseTo(0, 5);
  });
});
