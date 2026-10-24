// ?input=mock の歩行（Issue #53）の統合テスト．
// 担当D の入力の入口（createInputSource({ kind: "mock" })）にキー・ドラッグの出来事を流し，
// read(now) の PlayerInput を実物の空間（room・train・elevator の createWalkWorld）の SpaceWalker に渡す．
// main.ts の startInputWalk と同じく，dt は read に渡す時刻（performance.now() 相当）の差から求め，
// rig の向きは space.startYaw，カメラ（rig の子）には PlayerInput.head をそのまま入れる．
// E キーのドア開閉は InputPreview の onDoorToggle に，main.ts と同じ「近くのドアを 1 つ切り替える」処理をつなぐ．
// node 環境のため，window・document・HTMLElement と canvas を最小限の代わりに差し替える（afterEach で戻す）

import * as THREE from "three";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { GameEvent } from "./core/events";
import type { PlayerInput } from "./core/types";
import { createInputSource, type InputSource } from "./input/inputSource";
import { TEST_PARAMS } from "./input/testFixtures";
import { DOOR_TOGGLE_KEY, InputPreview } from "./inputPreview";
import { createDevDoors, findNearbyDevDoor } from "./scenes/devDoors";
import { createElevatorScene } from "./scenes/elevator/elevator";
import { createWalkWorld } from "./scenes/index";
import { createRoomScene } from "./scenes/room/room";
import { EYE_HEIGHT as ROOM_EYE } from "./scenes/room/roomLayout";
import { createTrainScene } from "./scenes/train/train";
import { EYE_HEIGHT as TRAIN_EYE } from "./scenes/train/trainLayout";
import type { Space } from "./scenes/types";
import { blocksBody, circleOverlapsRect, DEFAULT_BODY, onFloor } from "./scenes/walk/collision";
import { activeObstacles, type WalkWorld } from "./scenes/walk/locomotion";
import { SpaceWalker } from "./scenes/walk/walker";

// ---------------------------------------------------------------- ブラウザの代わり

/** 何もしない 2D コンテキスト（空間のテクスチャを描くため） */
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

/** ドラッグを受ける要素（renderer.domElement の代わり） */
function fakeTarget(): HTMLElement {
  const captured = new Set<number>();
  return Object.assign(new EventTarget(), {
    style: {},
    setPointerCapture: (id: number) => captured.add(id),
    hasPointerCapture: (id: number) => captured.has(id),
    releasePointerCapture: (id: number) => captured.delete(id),
  }) as unknown as HTMLElement;
}

let windowTarget: EventTarget;

beforeEach(() => {
  windowTarget = new EventTarget();
  vi.stubGlobal("window", windowTarget);
  // MockInput は入力欄へのキーを奪わないよう instanceof HTMLElement を見る（window からの出来事は該当しない）
  vi.stubGlobal("HTMLElement", class {});
  vi.stubGlobal("document", {
    body: Object.assign(fakeTarget(), { appendChild: () => {} }),
    createElement: (tag: string) => {
      if (tag === "canvas") {
        const ctx = fakeContext();
        return { width: 0, height: 0, getContext: () => ctx };
      }
      // InputPreview の左上の表示
      return { style: {}, textContent: "", remove: () => {} };
    },
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

// ---------------------------------------------------------------- 操作

function key(type: "keydown" | "keyup", code: string, repeat = false): void {
  windowTarget.dispatchEvent(
    Object.assign(new Event(type), { code, repeat, ctrlKey: false, metaKey: false, altKey: false }),
  );
}

/** キーを 1 回押して離す */
function tap(code: string): void {
  key("keydown", code);
  key("keyup", code);
}

/** マウスのドラッグ量（px．DEFAULT_MOCK_OPTIONS の 0.004 rad/px） */
const RAD_PER_PX = 0.004;

/** 頭のヨーを delta（rad．正で左）だけ回すドラッグ（左へドラッグで左を向く） */
function dragYaw(target: HTMLElement, delta: number): void {
  const pointer = (type: string, x: number, y: number) =>
    target.dispatchEvent(Object.assign(new Event(type), { pointerId: 1, clientX: x, clientY: y }));
  pointer("pointerdown", 500, 300);
  pointer("pointermove", 500 - delta / RAD_PER_PX, 300);
  pointer("pointerup", 500 - delta / RAD_PER_PX, 300);
}

/** 頭のピッチを delta（rad．正で上）だけ回すドラッグ */
function dragPitch(target: HTMLElement, delta: number): void {
  const pointer = (type: string, x: number, y: number) =>
    target.dispatchEvent(Object.assign(new Event(type), { pointerId: 1, clientX: x, clientY: y }));
  pointer("pointerdown", 500, 300);
  pointer("pointermove", 500, 300 - delta / RAD_PER_PX);
  pointer("pointerup", 500, 300 - delta / RAD_PER_PX);
}

// ---------------------------------------------------------------- main.ts の startInputWalk 相当

const FRAME_MS = 1000 / 60;

interface Harness {
  readonly space: Space;
  readonly world: WalkWorld;
  readonly walker: SpaceWalker;
  readonly source: InputSource;
  readonly target: HTMLElement;
  readonly rig: THREE.Object3D;
  readonly camera: THREE.PerspectiveCamera;
  readonly events: GameEvent[];
  /** seconds 秒分のフレームを進める（毎フレーム read → walker.update → rig・カメラへ反映） */
  run(seconds: number): PlayerInput;
  /** E キーで近くのドアを開閉できるようにする（InputPreview をつなぐ） */
  withDoorKey(): InputPreview;
  dispose(): void;
}

function harness(
  space: Space,
  start: { x: number; y: number; z: number } = space.startPosition,
): Harness {
  const world = createWalkWorld(space);
  const events: GameEvent[] = [];
  // 体の向きは main.ts と同じく space.startYaw に固定する（開始位置だけテストで変えることがある）
  const walker = new SpaceWalker(world, { position: start, bodyYaw: space.startYaw }, (e) =>
    events.push(e),
  );
  const target = fakeTarget();
  const source = createInputSource({ kind: "mock", params: TEST_PARAMS, target });
  const rig = new THREE.Object3D();
  const camera = new THREE.PerspectiveCamera();
  rig.add(camera);
  walker.applyTo(rig);

  let now = 1000;
  let lastNow: number | null = null;
  let last: PlayerInput = source.read(now);
  let preview: InputPreview | null = null;

  const frame = (): PlayerInput => {
    const input = preview ? preview.read(now) : source.read(now);
    const dt = lastNow === null ? 0 : (now - lastNow) / 1000;
    lastNow = now;
    walker.update({ dt, input });
    walker.applyTo(rig);
    camera.quaternion.set(input.head.x, input.head.y, input.head.z, input.head.w);
    now += FRAME_MS;
    return input;
  };
  frame();

  const devDoors = createDevDoors(space);
  return {
    space,
    world,
    walker,
    source,
    target,
    rig,
    camera,
    events,
    run(seconds) {
      const n = Math.round((seconds * 1000) / FRAME_MS);
      for (let i = 0; i < n; i++) last = frame();
      return last;
    },
    withDoorKey() {
      preview = new InputPreview(source, {
        onDoorToggle: () => {
          const door = findNearbyDevDoor(devDoors, walker.state);
          if (door) door.setOpen(!door.isOpen());
        },
      });
      return preview;
    },
    dispose() {
      if (preview) preview.dispose();
      else source.dispose();
      space.dispose();
    },
  };
}

/** 体がふさぐ物と重なっている障害物の id（押し出しの誤差 0.1 mm は許す） */
function overlapping(h: Harness): string[] {
  const s = h.walker.state;
  const headTop = s.eyeHeight + DEFAULT_BODY.headClearance;
  return activeObstacles(h.world)
    .filter((o) => blocksBody(o, headTop, DEFAULT_BODY))
    .filter((o) => circleOverlapsRect(s.x, s.z, DEFAULT_BODY.radius - 1e-4, o))
    .map((o) => o.id);
}

/** カメラのワールドの視線の水平の向き（yaw．0 で -Z，正で左） */
function cameraYaw(h: Harness): number {
  h.rig.updateMatrixWorld(true);
  const d = h.camera.getWorldDirection(new THREE.Vector3());
  return Math.atan2(-d.x, -d.z);
}

/** 角度の差を (-π, π] に */
function angleDiff(a: number, b: number): number {
  const d = a - b;
  return Math.atan2(Math.sin(d), Math.cos(d));
}

/** (dx, dz) の進んだ向き（yaw．0 で -Z，正で左） */
function moveYaw(dx: number, dz: number): number {
  return Math.atan2(-dx, -dz);
}

const SPACES = [
  ["room", () => createRoomScene({ maxAnisotropy: 1 })],
  ["train", () => createTrainScene({ maxAnisotropy: 1 })],
  ["elevator", () => createElevatorScene({ maxAnisotropy: 1 })],
] as const;

// ---------------------------------------------------------------- 5. 向き

describe("?input=mock の向きと進む向き", () => {
  it.each(SPACES)("%s: 開始時は空間の startYaw の方向を向く", (_id, create) => {
    const h = harness(create());
    expect(angleDiff(cameraYaw(h), h.space.startYaw)).toBeCloseTo(0, 6);
    h.dispose();
  });

  it.each(SPACES)(
    "%s: 頭を正面のまま W で歩くと startYaw の方向へ進み，カメラの向きと進む向きが一致する",
    (_id, create) => {
      const h = harness(create());
      const before = { ...h.walker.state };
      key("keydown", "KeyW");
      h.run(0.4);
      const dx = h.walker.state.x - before.x;
      const dz = h.walker.state.z - before.z;
      expect(Math.hypot(dx, dz)).toBeGreaterThan(0.05);
      expect(angleDiff(moveYaw(dx, dz), h.space.startYaw)).toBeCloseTo(0, 3);
      expect(angleDiff(moveYaw(dx, dz), cameraYaw(h))).toBeCloseTo(0, 3);
      h.dispose();
    },
  );

  it.each([
    ["左へ 90°", Math.PI / 2],
    ["右へ 90°", -Math.PI / 2],
    ["右へ 45°", -Math.PI / 4],
  ])("部屋: ドラッグで頭を%s回して歩くと，その方向（カメラの向き）へ進む", (_label, delta) => {
    const h = harness(createRoomScene({ maxAnisotropy: 1 }));
    dragYaw(h.target, delta);
    h.run(0.1);
    expect(angleDiff(cameraYaw(h), h.space.startYaw + delta)).toBeCloseTo(0, 2);
    const before = { ...h.walker.state };
    key("keydown", "KeyW");
    h.run(0.3);
    const dx = h.walker.state.x - before.x;
    const dz = h.walker.state.z - before.z;
    expect(Math.hypot(dx, dz)).toBeGreaterThan(0.03);
    expect(angleDiff(moveYaw(dx, dz), h.space.startYaw + delta)).toBeCloseTo(0, 2);
    expect(angleDiff(moveYaw(dx, dz), cameraYaw(h))).toBeCloseTo(0, 2);
    h.dispose();
  });

  it("上下を見ても（ピッチ）進む向きと速さは変わらない", () => {
    const flat = harness(createRoomScene({ maxAnisotropy: 1 }));
    key("keydown", "KeyW");
    flat.run(0.4);
    const flatState = { ...flat.walker.state };
    flat.dispose();
    key("keyup", "KeyW");

    const tilted = harness(createRoomScene({ maxAnisotropy: 1 }));
    dragPitch(tilted.target, -0.6);
    key("keydown", "KeyW");
    tilted.run(0.4);
    expect(tilted.walker.state.x).toBeCloseTo(flatState.x, 6);
    expect(tilted.walker.state.z).toBeCloseTo(flatState.z, 6);
    tilted.dispose();
  });
});

// ---------------------------------------------------------------- 1. W・S と壁・家具

describe("?input=mock の W・S と当たり判定", () => {
  it("W は約 1.0 m/s，S は約 0.5 m/s で進み，キーを離すと止まる", () => {
    // 電車の通路（開始位置）から startYaw 方向へ．速さが落ち着いた後の 0.5 秒で測る
    const measure = (code: string) => {
      const h = harness(createTrainScene({ maxAnisotropy: 1 }));
      key("keydown", code);
      h.run(0.6);
      const a = { ...h.walker.state };
      const input = h.run(0.5);
      const b = { ...h.walker.state };
      key("keyup", code);
      h.run(1.5);
      const c = { ...h.walker.state };
      h.run(0.5);
      const d = { ...h.walker.state };
      h.dispose();
      return { speed: Math.hypot(b.x - a.x, b.z - a.z) / 0.5, input, c, d };
    };
    const w = measure("KeyW");
    expect(w.input).toMatchObject({ walking: true });
    expect(w.speed).toBeGreaterThan(0.9);
    expect(w.speed).toBeLessThan(1.05);
    const s = measure("KeyS");
    expect(s.speed).toBeGreaterThan(0.4);
    expect(s.speed).toBeLessThan(0.55);
    // 離した後は止まる
    expect(Math.hypot(w.d.x - w.c.x, w.d.z - w.c.z)).toBeLessThan(1e-9);
    expect(Math.hypot(s.d.x - s.c.x, s.d.z - s.c.z)).toBeLessThan(1e-9);
  });

  it("S は後ろへ進まない（向いている方向へゆっくり進む）", () => {
    const h = harness(createTrainScene({ maxAnisotropy: 1 }));
    const before = { ...h.walker.state };
    key("keydown", "KeyS");
    h.run(0.5);
    const dx = h.walker.state.x - before.x;
    const dz = h.walker.state.z - before.z;
    expect(Math.hypot(dx, dz)).toBeGreaterThan(0.02);
    expect(angleDiff(moveYaw(dx, dz), h.space.startYaw)).toBeCloseTo(0, 3);
    h.dispose();
  });

  it.each(SPACES)(
    "%s: W・S を押し続けて 8 方向へ歩いても，床の外へ出ず壁・家具と重ならない",
    (_id, create) => {
      for (const code of ["KeyW", "KeyS"]) {
        for (let i = 0; i < 8; i++) {
          const h = harness(create());
          dragYaw(h.target, (i * Math.PI) / 4);
          key("keydown", code);
          for (let t = 0; t < 40; t++) {
            h.run(0.25);
            expect(onFloor(h.world.floors, h.walker.state.x, h.walker.state.z)).toBe(true);
            expect(overlapping(h), `${code} 方向 ${i} の ${t * 0.25} 秒`).toEqual([]);
          }
          key("keyup", code);
          h.dispose();
        }
      }
    },
  );

  it("部屋: 立ったまま W で開始の向きへ歩くとテーブルに当たって止まり，下に入らない", () => {
    const h = harness(createRoomScene({ maxAnisotropy: 1 }));
    key("keydown", "KeyW");
    h.run(3);
    const a = { ...h.walker.state };
    h.run(1);
    expect(h.walker.state.x).toBeCloseTo(a.x, 6);
    expect(h.walker.state.z).toBeCloseTo(a.z, 6);
    expect(h.walker.observe().areaIds).not.toContain("under-table");
    expect(h.events).not.toContainEqual({ type: "areaEntered", areaId: "under-table" });
    expect(h.walker.state.eyeHeight).toBeCloseTo(ROOM_EYE.standing);
    h.dispose();
  });
});

// ---------------------------------------------------------------- 2. C と机の下

describe("?input=mock の C（しゃがみ）", () => {
  it("部屋: C でしゃがんでから W で歩くと机の下に入れ，under-table に入ったイベントが流れる", () => {
    const h = harness(createRoomScene({ maxAnisotropy: 1 }));
    tap("KeyC");
    const input = h.run(0.8);
    expect(input.posture).toBe("crouching");
    expect(h.walker.state.eyeHeight).toBeCloseTo(ROOM_EYE.crouching);
    key("keydown", "KeyW");
    h.run(2);
    expect(h.walker.observe().areaIds).toContain("under-table");
    expect(h.events).toContainEqual({ type: "areaEntered", areaId: "under-table" });
    h.dispose();
  });

  it("部屋: 机の下でもう一度 C を押して立とうとしても，頭は天板の下に収まり机の下に留まる", () => {
    const h = harness(createRoomScene({ maxAnisotropy: 1 }));
    tap("KeyC");
    h.run(0.8);
    key("keydown", "KeyW");
    h.run(2);
    key("keyup", "KeyW");
    h.run(0.5);
    expect(h.walker.observe().areaIds).toContain("under-table");
    tap("KeyC");
    const input = h.run(1);
    expect(input.posture).toBe("standing");
    expect(h.walker.observe().areaIds).toContain("under-table");
    expect(h.walker.state.eyeHeight).toBeLessThan(ROOM_EYE.standing - 0.1);
    h.dispose();
  });

  it("C を押しっぱなし（キーの繰り返し）にしても，しゃがみと立ちが交互に切り替わらない", () => {
    const h = harness(createRoomScene({ maxAnisotropy: 1 }));
    key("keydown", "KeyC");
    for (let i = 0; i < 5; i++) key("keydown", "KeyC", true);
    key("keyup", "KeyC");
    expect(h.run(0.8).posture).toBe("crouching");
    h.dispose();
  });
});

// ---------------------------------------------------------------- 3. ドアと E キー

describe("?input=mock の E（近くのドアの開閉）", () => {
  // 部屋のドアの前（開口部の中心 x=0.9）．体の向きは startYaw（+X）のまま，頭を右へ 90° 回して廊下（+Z）を向く
  const roomDoorFront = { x: 0.9, y: ROOM_EYE.standing, z: 1.9 };

  it("部屋: ドアが閉じていると廊下へ出られず，E で開けると出られる", () => {
    const h = harness(createRoomScene({ maxAnisotropy: 1 }), roomDoorFront);
    h.withDoorKey();
    dragYaw(h.target, -Math.PI / 2);
    key("keydown", "KeyW");
    h.run(3);
    expect(h.walker.observe().areaIds).not.toContain("hallway");
    expect(h.walker.state.z).toBeLessThan(2.5);
    key("keyup", "KeyW");
    h.run(0.5);

    tap(DOOR_TOGGLE_KEY);
    key("keydown", "KeyW");
    h.run(3);
    expect(h.walker.observe().areaIds).toContain("hallway");
    expect(h.events).toContainEqual({ type: "areaEntered", areaId: "hallway" });
    h.dispose();
  });

  it("部屋: E を 2 回押すと閉じ直し，また通れない", () => {
    const h = harness(createRoomScene({ maxAnisotropy: 1 }), roomDoorFront);
    h.withDoorKey();
    dragYaw(h.target, -Math.PI / 2);
    tap(DOOR_TOGGLE_KEY);
    tap(DOOR_TOGGLE_KEY);
    key("keydown", "KeyW");
    h.run(3);
    expect(h.walker.observe().areaIds).not.toContain("hallway");
    h.dispose();
  });

  it("部屋: E を押しっぱなし（キーの繰り返し）にしても開閉が繰り返されない", () => {
    const h = harness(createRoomScene({ maxAnisotropy: 1 }), roomDoorFront);
    h.withDoorKey();
    dragYaw(h.target, -Math.PI / 2);
    key("keydown", DOOR_TOGGLE_KEY);
    key("keydown", DOOR_TOGGLE_KEY, true);
    key("keydown", DOOR_TOGGLE_KEY, true);
    key("keyup", DOOR_TOGGLE_KEY);
    key("keydown", "KeyW");
    h.run(3);
    expect(h.walker.observe().areaIds).toContain("hallway");
    h.dispose();
  });

  it("部屋: ドアから遠い開始位置で E を押してもドアは開かない", () => {
    const h = harness(createRoomScene({ maxAnisotropy: 1 }));
    h.withDoorKey();
    tap(DOOR_TOGGLE_KEY);
    const doors = createDevDoors(h.space);
    expect(doors.every((d) => !d.isOpen())).toBe(true);
    h.dispose();
  });

  it("エレベーター: 開始の向きのまま W で歩くと閉じた扉で止まり，E で開けると乗り場へ出られる", () => {
    const h = harness(createElevatorScene({ maxAnisotropy: 1 }));
    h.withDoorKey();
    key("keydown", "KeyW");
    h.run(3);
    expect(h.walker.observe().areaIds).not.toContain("hall");
    key("keyup", "KeyW");
    h.run(0.5);
    tap(DOOR_TOGGLE_KEY);
    key("keydown", "KeyW");
    h.run(3);
    expect(h.walker.observe().areaIds).toEqual(["hall"]);
    h.dispose();
  });

  it("InputPreview.read は渡した InputSource の read と同じ PlayerInput を返す", () => {
    const target = fakeTarget();
    const a = createInputSource({ kind: "mock", params: TEST_PARAMS, target });
    const preview = new InputPreview(a);
    key("keydown", "KeyW");
    tap("KeyC");
    const p = preview.read(100);
    expect(p).toMatchObject({ time: 100, posture: "crouching", walking: true });
    preview.dispose();
  });
});

// ---------------------------------------------------------------- 4. 電車の座席

describe("?input=mock で電車の座席に座る", () => {
  it("座席へ歩いて止まり，ドラッグで振り返って C でしゃがむと座る．もう一度 C で立つと元の位置へ戻る", () => {
    const space = createTrainScene({ maxAnisotropy: 1 });
    const world = createWalkWorld(space);
    const seat = world.seats.find((s) => s.id === "seat-left-2-4");
    if (!seat) throw new Error("座席がない");
    // 座席の前の通路から．体の向きは startYaw のまま，頭を回して座席（-X．yaw π/2）を向く
    const h = harness(space, { x: 0, y: TRAIN_EYE.standing, z: seat.z });
    dragYaw(h.target, Math.PI / 2 - space.startYaw);
    key("keydown", "KeyW");
    h.run(3);
    key("keyup", "KeyW");
    h.run(1);
    expect(h.walker.state.x).toBeLessThan(-0.5);
    const stood = { x: h.walker.state.x, z: h.walker.state.z };

    dragYaw(h.target, Math.PI);
    h.run(0.1);
    tap("KeyC");
    h.run(2);
    expect(h.walker.state.seat?.id).toBe(seat.id);
    expect(h.walker.state.eyeHeight).toBeCloseTo(TRAIN_EYE.seated);

    // 座っている間は W を押しても動かない
    key("keydown", "KeyW");
    h.run(1);
    key("keyup", "KeyW");
    h.run(1);
    expect(h.walker.state.x).toBeCloseTo(seat.x);
    expect(h.walker.state.z).toBeCloseTo(seat.z);

    tap("KeyC");
    h.run(2);
    expect(h.walker.state.seat).toBeNull();
    expect(h.walker.state.x).toBeCloseTo(stood.x);
    expect(h.walker.state.z).toBeCloseTo(stood.z);
    expect(h.walker.state.eyeHeight).toBeCloseTo(TRAIN_EYE.standing);
    h.dispose();
  });

  it("座席の方を向いたまま C でしゃがむと座らない", () => {
    const space = createTrainScene({ maxAnisotropy: 1 });
    const world = createWalkWorld(space);
    const seat = world.seats.find((s) => s.id === "seat-left-2-4");
    if (!seat) throw new Error("座席がない");
    const h = harness(space, { x: 0, y: TRAIN_EYE.standing, z: seat.z });
    dragYaw(h.target, Math.PI / 2 - space.startYaw);
    key("keydown", "KeyW");
    h.run(3);
    key("keyup", "KeyW");
    h.run(1);
    tap("KeyC");
    h.run(2);
    expect(h.walker.state.seat).toBeNull();
    expect(h.walker.state.eyeHeight).toBeCloseTo(TRAIN_EYE.crouching);
    h.dispose();
  });
});
