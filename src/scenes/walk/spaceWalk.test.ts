// 3 つの空間（部屋・電車・エレベーター）の歩行のテスト．Issue #31 の完了条件を基準にする:
// - どの空間でも壁・物をすり抜けない
// - 部屋で，しゃがんだときだけ机の下に入れる
// - エリアの出入りがイベントとして流れる
// 空間は canvas でテクスチャを描くため，node 環境では document を何もしない canvas に差し替えて組み立てる

import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { GameEvent } from "../../core/events";
import { IDLE_PLAYER_INPUT, type PlayerInput, type Quat } from "../../core/types";
import { createElevatorScene, type ElevatorSpace } from "../elevator/elevator";
import {
  CABIN,
  EYE_HEIGHT as ELEVATOR_EYE,
  type ElevatorDoorUserData,
} from "../elevator/elevatorLayout";
import { createWalkWorld } from "../index";
import { createRoomScene, type RoomSpace } from "../room/room";
import {
  ROOM,
  EYE_HEIGHT as ROOM_EYE,
  type DoorUserData as RoomDoorUserData,
  TABLE_ID,
  type TableUserData,
  tableUndersideY,
} from "../room/roomLayout";
import { createTrainScene, type TrainSpace } from "../train/train";
import {
  CAR,
  EYE_HEIGHT as TRAIN_EYE,
  type DoorUserData as TrainDoorUserData,
} from "../train/trainLayout";
import type { Space } from "../types";
import { blocksBody, circleOverlapsRect, DEFAULT_BODY, onFloor } from "./collision";
import { activeObstacles, stepWalk, type WalkState, type WalkWorld } from "./locomotion";
import { SpaceWalker } from "./walker";

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

const R = DEFAULT_BODY.radius;
const DT = 1 / 30;
/**
 * 重なりの判定の許容差（m）．押し出した直後の体は物にちょうど接するため，計算の誤差の分（0.1 mm）だけ許す
 */
const TOLERANCE = 1e-4;

function yawQuat(yaw: number): Quat {
  return { x: 0, y: Math.sin(yaw / 2), z: 0, w: Math.cos(yaw / 2) };
}

function frameInput(over: Partial<PlayerInput> = {}): PlayerInput {
  return { ...IDLE_PLAYER_INPUT, ...over };
}

/** 決まった乱数（mulberry32） */
function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** 体がふさぐ物と重なっている障害物の id（なければ空） */
function overlapping(state: WalkState, headTop: number, world: WalkWorld): string[] {
  return activeObstacles(world)
    .filter((o) => blocksBody(o, headTop, DEFAULT_BODY))
    .filter((o) => circleOverlapsRect(state.x, state.z, R - TOLERANCE, o))
    .map((o) => o.id);
}

interface ExploreResult {
  readonly violations: string[];
  readonly visited: WalkState[];
}

/**
 * 頭の向きを乱数で変えながら最大の速さで歩き回り，毎フレーム
 * 「体の中心が床の中にある」「ふさぐ物と重ならない」を確かめる
 */
function explore(
  world: WalkWorld,
  start: WalkState,
  bodyYaw: number,
  seed: number,
  frames: number,
  posture: (i: number) => PlayerInput["posture"],
): ExploreResult {
  const random = rng(seed);
  const violations: string[] = [];
  const visited: WalkState[] = [];
  let s = start;
  let yaw = random() * Math.PI * 2;
  for (let i = 0; i < frames; i++) {
    if (random() < 0.05) yaw = random() * Math.PI * 2;
    else yaw += (random() - 0.5) * 0.3;
    const prevTop = s.eyeHeight + DEFAULT_BODY.headClearance;
    s = stepWalk(
      s,
      frameInput({ walking: true, walkSpeed: 2, head: yawQuat(yaw), posture: posture(i) }),
      DT,
      world,
      bodyYaw,
    );
    visited.push(s);
    if (s.seat !== null) continue;
    const headTop = Math.max(prevTop, s.eyeHeight + DEFAULT_BODY.headClearance);
    if (!onFloor(world.floors, s.x, s.z)) violations.push(`frame ${i}: 床の外 (${s.x}, ${s.z})`);
    const hits = overlapping(s, headTop, world);
    if (hits.length > 0)
      violations.push(
        `frame ${i}: ${hits.join(",")} と重なる (${s.x.toFixed(3)}, ${s.z.toFixed(3)}, eye ${s.eyeHeight.toFixed(3)})`,
      );
  }
  return { violations, visited };
}

function startState(space: Space): WalkState {
  const p = space.startPosition;
  return {
    x: p.x,
    z: p.z,
    eyeHeight: p.y,
    posture: "standing",
    seat: null,
    standX: p.x,
    standZ: p.z,
  };
}

const standing = () => "standing" as const;
const crouching = () => "crouching" as const;
/** 2 秒ごとに立つ・しゃがむを切り替える */
const alternating = (i: number) => (Math.floor(i / 60) % 2 === 0 ? "standing" : "crouching");

function walkerFor(
  world: WalkWorld,
  position: { x: number; y: number; z: number },
  bodyYaw: number,
) {
  const events: GameEvent[] = [];
  const walker = new SpaceWalker(world, { position, bodyYaw }, (e) => events.push(e));
  return { walker, events };
}

function runWalker(walker: SpaceWalker, input: PlayerInput, seconds: number): void {
  const n = Math.round(seconds / DT);
  for (let i = 0; i < n; i++) walker.update({ dt: DT, input });
}

const WALK = (over: Partial<PlayerInput> = {}) =>
  frameInput({ walking: true, walkSpeed: 1, ...over });

// ---------------------------------------------------------------- 部屋

describe("部屋の歩行", () => {
  function setup() {
    const space = createRoomScene({ maxAnisotropy: 1 }) as RoomSpace;
    const world = createWalkWorld(space);
    const setDoor = (open: boolean) => {
      (space.parts.door.userData as RoomDoorUserData).open = open;
    };
    return { space, world, setDoor };
  }

  it("開始位置は床の中で，物と重ならない", () => {
    const { space, world } = setup();
    const s = startState(space);
    expect(onFloor(world.floors, s.x, s.z)).toBe(true);
    expect(overlapping(s, s.eyeHeight + DEFAULT_BODY.headClearance, world)).toEqual([]);
  });

  it("目の高さの基準は部屋の EYE_HEIGHT", () => {
    const { world } = setup();
    expect(world.eyeHeights.standing).toBe(ROOM_EYE.standing);
    expect(world.eyeHeights.crouching).toBe(ROOM_EYE.crouching);
  });

  it.each([1, 2, 3])(
    "ドアを閉じたまま歩き回っても壁・物をすり抜けず，廊下へ出ない（seed %i）",
    (seed) => {
      const { space, world, setDoor } = setup();
      setDoor(false);
      for (const posture of [standing, crouching, alternating]) {
        const { violations, visited } = explore(
          world,
          startState(space),
          space.startYaw,
          seed,
          1500,
          posture,
        );
        expect(violations).toEqual([]);
        expect(Math.max(...visited.map((s) => s.z))).toBeLessThanOrEqual(ROOM.depth / 2 - R + 1e-6);
      }
    },
  );

  it.each([1, 2])("ドアを開けて歩き回っても壁・物をすり抜けない（seed %i）", (seed) => {
    const { space, world, setDoor } = setup();
    setDoor(true);
    for (const posture of [standing, alternating]) {
      const { violations } = explore(world, startState(space), space.startYaw, seed, 2000, posture);
      expect(violations).toEqual([]);
    }
  });

  it("立ったままではテーブルの下に入れず，under-table のエリアに入らない", () => {
    const { space, world } = setup();
    const { walker, events } = walkerFor(world, space.startPosition, space.startYaw);
    // 開始の向き（+X）へ歩くとテーブルに当たる
    runWalker(walker, WALK(), 3);
    expect(walker.observe().areaIds).not.toContain("under-table");
    expect(events).not.toContainEqual({ type: "areaEntered", areaId: "under-table" });
    expect(walker.state.eyeHeight).toBeCloseTo(ROOM_EYE.standing);
  });

  it("しゃがむとテーブルの下に入れ，under-table に入ったイベントが流れる", () => {
    const { space, world } = setup();
    const { walker, events } = walkerFor(world, space.startPosition, space.startYaw);
    runWalker(walker, frameInput({ posture: "crouching" }), 1);
    runWalker(walker, WALK({ posture: "crouching" }), 1.2);
    expect(walker.observe().areaIds).toContain("under-table");
    expect(events).toContainEqual({ type: "areaEntered", areaId: "under-table" });
  });

  it("テーブルの下で立ち上がっても，頭のてっぺんは天板の下面より上に出ない", () => {
    const { space, world } = setup();
    const table = space.parts.byId.get(TABLE_ID);
    if (!table) throw new Error("テーブルがない");
    const underside = table.position.y + tableUndersideY((table.userData as TableUserData).size);
    const { walker } = walkerFor(world, space.startPosition, space.startYaw);
    runWalker(walker, frameInput({ posture: "crouching" }), 1);
    runWalker(walker, WALK({ posture: "crouching" }), 1.2);
    expect(walker.observe().areaIds).toContain("under-table");
    for (let i = 0; i < 90; i++) {
      walker.update({ dt: DT, input: frameInput({ posture: "standing" }) });
      expect(walker.state.eyeHeight + DEFAULT_BODY.headClearance).toBeLessThanOrEqual(
        underside + 1e-6,
      );
    }
    expect(walker.observe().areaIds).toContain("under-table");
  });

  it("テーブルの下から出ると立った目の高さに戻り，under-table を出たイベントが流れる", () => {
    const { space, world } = setup();
    const { walker, events } = walkerFor(world, space.startPosition, space.startYaw);
    runWalker(walker, frameInput({ posture: "crouching" }), 1);
    runWalker(walker, WALK({ posture: "crouching" }), 1.2);
    // 後ろ（-X）を向いて出る
    runWalker(walker, WALK({ posture: "standing", head: yawQuat(Math.PI) }), 1.5);
    runWalker(walker, frameInput({ posture: "standing" }), 1);
    expect(walker.observe().areaIds).not.toContain("under-table");
    expect(events).toContainEqual({ type: "areaExited", areaId: "under-table" });
    expect(walker.state.eyeHeight).toBeCloseTo(ROOM_EYE.standing);
  });

  describe("廊下へのドア", () => {
    // ドアの前（x=0.9．開口部の中心）から +Z（廊下）を向く
    const doorStart = { x: 0.9, y: ROOM_EYE.standing, z: 1.9 };
    const toHallway = Math.PI;

    it("閉じている間は廊下へ出られない", () => {
      const { world, setDoor } = setup();
      setDoor(false);
      const { walker, events } = walkerFor(world, doorStart, toHallway);
      runWalker(walker, WALK(), 3);
      expect(walker.state.z).toBeLessThanOrEqual(ROOM.depth / 2 - R + 1e-6);
      expect(walker.observe().areaIds).not.toContain("hallway");
      expect(events).not.toContainEqual({ type: "areaEntered", areaId: "hallway" });
    });

    it("開いていれば廊下へ出られ，door-front を出て hallway に入ったイベントが流れる", () => {
      const { world, setDoor } = setup();
      setDoor(true);
      const { walker, events } = walkerFor(world, doorStart, toHallway);
      expect(walker.observe().areaIds).toContain("door-front");
      runWalker(walker, WALK(), 3);
      expect(walker.observe().areaIds).toContain("hallway");
      expect(events).toContainEqual({ type: "areaEntered", areaId: "hallway" });
      expect(events).toContainEqual({ type: "areaExited", areaId: "door-front" });
    });

    it("途中でドアを閉じると，また通れなくなる", () => {
      const { world, setDoor } = setup();
      setDoor(true);
      setDoor(false);
      const { walker } = walkerFor(world, doorStart, toHallway);
      runWalker(walker, WALK(), 3);
      expect(walker.observe().areaIds).not.toContain("hallway");
    });
  });
});

// ---------------------------------------------------------------- 電車

describe("電車の歩行", () => {
  function setup() {
    const space = createTrainScene({ maxAnisotropy: 1 }) as TrainSpace;
    const world = createWalkWorld(space);
    const setDoor = (id: string, open: boolean) => {
      const group = space.parts.byId.get(id);
      if (!group) throw new Error(`ドアがない: ${id}`);
      (group.userData as TrainDoorUserData).open = open;
    };
    const setAllDoors = (open: boolean) => {
      for (const d of space.parts.doors) (d.userData as TrainDoorUserData).open = open;
    };
    return { space, world, setDoor, setAllDoors };
  }

  const HALF_W = CAR.width / 2;
  const HALF_L = CAR.length / 2;

  it("開始位置は床の中で，物と重ならない", () => {
    const { space, world } = setup();
    const s = startState(space);
    expect(onFloor(world.floors, s.x, s.z)).toBe(true);
    expect(overlapping(s, s.eyeHeight + DEFAULT_BODY.headClearance, world)).toEqual([]);
  });

  it("目の高さの基準は電車の EYE_HEIGHT（着座も含む）", () => {
    const { world } = setup();
    expect(world.eyeHeights.standing).toBe(TRAIN_EYE.standing);
    expect(world.eyeHeights.crouching).toBe(TRAIN_EYE.crouching);
    expect(world.seats.length).toBeGreaterThan(0);
    for (const seat of world.seats) expect(seat.eyeHeight).toBeCloseTo(TRAIN_EYE.seated);
  });

  it.each([1, 2, 3])(
    "ドアを閉じたまま歩き回っても壁・座席・手すりをすり抜けず，車外へ出ない（seed %i）",
    (seed) => {
      const { space, world, setAllDoors } = setup();
      setAllDoors(false);
      for (const posture of [standing, crouching, alternating]) {
        const { violations, visited } = explore(
          world,
          startState(space),
          space.startYaw,
          seed,
          1500,
          posture,
        );
        expect(violations).toEqual([]);
        for (const s of visited.filter((v) => v.seat === null)) {
          expect(Math.abs(s.x)).toBeLessThanOrEqual(HALF_W - R + 1e-6);
          expect(Math.abs(s.z)).toBeLessThanOrEqual(HALF_L - R + 1e-6);
        }
      }
    },
  );

  it.each([1, 2])("全部のドアを開けて歩き回っても壁・物をすり抜けない（seed %i）", (seed) => {
    const { space, world, setAllDoors } = setup();
    setAllDoors(true);
    for (const posture of [standing, alternating]) {
      const { violations } = explore(world, startState(space), space.startYaw, seed, 2500, posture);
      expect(violations).toEqual([]);
    }
  });

  it("全部のドアを開けても，右の側面（線路側）は開口部より外へ出ない", () => {
    const { space, world, setAllDoors } = setup();
    setAllDoors(true);
    for (const seed of [4, 5, 6]) {
      const { visited } = explore(world, startState(space), space.startYaw, seed, 2500, standing);
      for (const s of visited) expect(s.x).toBeLessThanOrEqual(HALF_W + 0.1 + 1e-6);
    }
    // ドアの正面から右へ歩き続けても同じ
    const { walker } = walkerFor(world, { x: 1.0, y: TRAIN_EYE.standing, z: -2.4 }, -Math.PI / 2);
    runWalker(walker, WALK(), 3);
    expect(walker.state.x).toBeGreaterThan(HALF_W - R);
    expect(walker.state.x).toBeLessThanOrEqual(HALF_W + 0.1 + 1e-6);
  });

  it("座席の端と縦の握り棒のすき間（体の直径より狭い）に押し込んでも，物と重ならない（厳密．許容差 0.1mm）", () => {
    // seat-right-1 の端（z=-3.47）と pole-door-right-1-front（z≈-3.13）の間へ +X に歩き続ける
    const { world } = setup();
    const { walker } = walkerFor(world, { x: 0.9, y: TRAIN_EYE.standing, z: -3.3 }, -Math.PI / 2);
    runWalker(walker, frameInput({ walking: true, walkSpeed: 2 }), 2);
    const s = walker.state;
    const hits = activeObstacles(world)
      .filter((o) => blocksBody(o, s.eyeHeight + DEFAULT_BODY.headClearance, DEFAULT_BODY))
      .filter((o) => circleOverlapsRect(s.x, s.z, R - 1e-4, o))
      .map((o) => o.id);
    expect(hits, `止まった位置 (${s.x.toFixed(3)}, ${s.z.toFixed(3)})`).toEqual([]);
  });

  describe("左のドア（ホーム側）", () => {
    // door-left-1 の正面（z=-2.4）から -X（ホーム）を向く
    const doorStart = { x: -1.0, y: TRAIN_EYE.standing, z: -2.4 };
    const toPlatform = Math.PI / 2;

    it("閉じている間はホームへ出られない", () => {
      const { world, setAllDoors } = setup();
      setAllDoors(false);
      const { walker, events } = walkerFor(world, doorStart, toPlatform);
      runWalker(walker, WALK(), 3);
      expect(walker.state.x).toBeGreaterThanOrEqual(-HALF_W + R - 1e-6);
      expect(events).not.toContainEqual({ type: "areaEntered", areaId: "platform" });
    });

    it("開けるとホームへ出られ，ドアの前を出てホームに入ったイベントが流れる", () => {
      const { world, setDoor } = setup();
      setDoor("door-left-1", true);
      const { walker, events } = walkerFor(world, doorStart, toPlatform);
      expect(walker.observe().areaIds).toContain("door-left-1-front");
      runWalker(walker, WALK(), 3);
      expect(walker.observe().areaIds).toContain("platform");
      expect(events).toContainEqual({ type: "areaExited", areaId: "door-left-1-front" });
      expect(events).toContainEqual({ type: "areaEntered", areaId: "platform" });
    });

    it("別のドア（door-left-2）を開けても door-left-1 は通れない", () => {
      const { world, setDoor } = setup();
      setDoor("door-left-2", true);
      const { walker } = walkerFor(world, doorStart, toPlatform);
      runWalker(walker, WALK(), 3);
      expect(walker.observe().areaIds).not.toContain("platform");
    });
  });

  describe("非常扉（前の妻面）", () => {
    const doorStart = { x: 0, y: TRAIN_EYE.standing, z: -4.4 };

    it("閉じている間は通路へ出られず，開けると出られる", () => {
      const closed = setup();
      const a = walkerFor(closed.world, doorStart, 0);
      runWalker(a.walker, WALK(), 3);
      expect(a.walker.state.z).toBeGreaterThanOrEqual(-HALF_L + R - 1e-6);

      const opened = setup();
      opened.setDoor("emergency-door", true);
      const b = walkerFor(opened.world, doorStart, 0);
      runWalker(b.walker, WALK(), 3);
      expect(b.walker.observe().areaIds).toContain("emergency-door-gangway");
      expect(b.events).toContainEqual({ type: "areaEntered", areaId: "emergency-door-gangway" });
    });
  });

  describe("着座", () => {
    it("座席に向かって歩いて止まり，振り返って（座席に背を向けて）しゃがむと座る．立つと元の位置へ戻る", () => {
      const { world } = setup();
      // 左の 7 人掛け（seat-left-2）の真ん中の席の前の通路から，座席（-X）へ歩く
      const seat = world.seats.find((s) => s.id === "seat-left-2-4");
      if (!seat) throw new Error(`座席がない: ${world.seats.map((s) => s.id).join(",")}`);
      const aisle = { x: 0, y: TRAIN_EYE.standing, z: seat.z };
      const { walker } = walkerFor(world, aisle, Math.PI / 2);
      runWalker(walker, WALK(), 3);
      const stood = { x: walker.state.x, z: walker.state.z };
      expect(walker.state.x).toBeLessThan(-0.5);
      // 頭を 180° 回して座席に背を向け，しゃがむ
      const backToSeat = yawQuat(Math.PI);
      runWalker(walker, frameInput({ posture: "crouching", head: backToSeat }), 2);
      expect(walker.state.seat?.id).toBe(seat.id);
      expect(walker.state.eyeHeight).toBeCloseTo(TRAIN_EYE.seated);
      expect(walker.state.x).toBeCloseTo(seat.x);
      expect(walker.state.z).toBeCloseTo(seat.z);
      // 座っている間は足踏みしても動かない
      runWalker(walker, WALK({ posture: "crouching", head: backToSeat }), 1);
      expect(walker.state.x).toBeCloseTo(seat.x);
      // 立つと座る前の位置へ戻り，立った目の高さになる
      runWalker(walker, frameInput({ posture: "standing", head: backToSeat }), 2);
      expect(walker.state.seat).toBeNull();
      expect(walker.state.x).toBeCloseTo(stood.x);
      expect(walker.state.z).toBeCloseTo(stood.z);
      expect(walker.state.eyeHeight).toBeCloseTo(TRAIN_EYE.standing);
    });

    it("座席の方を向いたまましゃがむと，座らずにしゃがむ（目はしゃがみの高さ）", () => {
      const { world } = setup();
      const seat = world.seats.find((s) => s.id === "seat-left-2-4");
      if (!seat) throw new Error("座席がない");
      const { walker } = walkerFor(world, { x: 0, y: TRAIN_EYE.standing, z: seat.z }, Math.PI / 2);
      runWalker(walker, WALK(), 3);
      runWalker(walker, frameInput({ posture: "crouching" }), 2);
      expect(walker.state.seat).toBeNull();
      expect(walker.state.eyeHeight).toBeCloseTo(TRAIN_EYE.crouching);
    });
  });
});

// ---------------------------------------------------------------- エレベーター

describe("エレベーターの歩行", () => {
  function setup() {
    const space = createElevatorScene({ maxAnisotropy: 1 }) as ElevatorSpace;
    const world = createWalkWorld(space);
    const setDoor = (open: boolean) => {
      for (const d of space.parts.doors) (d.userData as ElevatorDoorUserData).open = open;
    };
    return { space, world, setDoor };
  }

  it("開始位置は床の中で，物と重ならない", () => {
    const { space, world } = setup();
    const s = startState(space);
    expect(onFloor(world.floors, s.x, s.z)).toBe(true);
    expect(overlapping(s, s.eyeHeight + DEFAULT_BODY.headClearance, world)).toEqual([]);
  });

  it("目の高さの基準はエレベーターの EYE_HEIGHT", () => {
    const { world } = setup();
    expect(world.eyeHeights.standing).toBe(ELEVATOR_EYE.standing);
    expect(world.eyeHeights.crouching).toBe(ELEVATOR_EYE.crouching);
  });

  it.each([1, 2, 3])(
    "扉を閉じたまま歩き回っても壁・手すりをすり抜けず，かごの外へ出ない（seed %i）",
    (seed) => {
      const { space, world, setDoor } = setup();
      setDoor(false);
      for (const posture of [standing, crouching, alternating]) {
        const { violations, visited } = explore(
          world,
          startState(space),
          space.startYaw,
          seed,
          1500,
          posture,
        );
        expect(violations).toEqual([]);
        for (const s of visited) {
          expect(Math.abs(s.x)).toBeLessThanOrEqual(CABIN.width / 2 - R + 1e-6);
          expect(Math.abs(s.z)).toBeLessThanOrEqual(CABIN.depth / 2 - R + 1e-6);
        }
      }
    },
  );

  it.each([1, 2])("扉を開けて歩き回っても壁・物をすり抜けない（seed %i）", (seed) => {
    const { space, world, setDoor } = setup();
    setDoor(true);
    for (const posture of [standing, alternating]) {
      const { violations } = explore(world, startState(space), space.startYaw, seed, 2000, posture);
      expect(violations).toEqual([]);
    }
  });

  it("扉が閉じている間は乗り場へ出られない", () => {
    const { space, world, setDoor } = setup();
    setDoor(false);
    const { walker, events } = walkerFor(world, space.startPosition, space.startYaw);
    runWalker(walker, WALK(), 3);
    expect(walker.observe().areaIds).not.toContain("hall");
    expect(walker.observe().areaIds).toContain("door-front");
    expect(events).toEqual([{ type: "areaEntered", areaId: "door-front" }]);
  });

  it("扉を開けると乗り場へ出られ，かご・扉の前を出て乗り場に入ったイベントが流れる", () => {
    const { space, world, setDoor } = setup();
    setDoor(true);
    const { walker, events } = walkerFor(world, space.startPosition, space.startYaw);
    expect(walker.observe().areaIds).toEqual(["cabin"]);
    runWalker(walker, WALK(), 3);
    expect(walker.observe().areaIds).toEqual(["hall"]);
    expect(events).toContainEqual({ type: "areaEntered", areaId: "door-front" });
    expect(events).toContainEqual({ type: "areaExited", areaId: "cabin" });
    expect(events).toContainEqual({ type: "areaExited", areaId: "door-front" });
    expect(events).toContainEqual({ type: "areaEntered", areaId: "hall" });
    // 入る前に出る（door-front に入った後で出る．hall は最後）
    const idx = (type: GameEvent["type"], areaId: string) =>
      events.findIndex((e) => e.type === type && "areaId" in e && e.areaId === areaId);
    expect(idx("areaEntered", "door-front")).toBeLessThan(idx("areaExited", "door-front"));
    expect(idx("areaExited", "cabin")).toBeLessThan(idx("areaEntered", "hall"));
  });
});
