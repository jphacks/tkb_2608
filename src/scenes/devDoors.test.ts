// 確認用のドアボタン（devDoors）のテスト．人間が承認した仕様を基準にする:
// - 押すと，体の中心（XZ）から 1.5 m 以内で最も近いドア 1 つだけの開閉を切り替える．範囲内に無ければ何もしない
// - 電車の両開きドア・エレベーターの扉は，複数の板をまとめて 1 つのドアとして開閉する
// 空間は canvas でテクスチャを描くため，node 環境では document を何もしない canvas に差し替えて組み立てる

import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { IDLE_PLAYER_INPUT } from "../core/types";
import {
  createDevDoors,
  DEV_DOOR_REACH,
  type DevDoor,
  findNearbyDevDoor,
  nearestDoorIndex,
} from "./devDoors";
import { createElevatorScene } from "./elevator/elevator";
import type { ElevatorDoorLeafUserData, ElevatorDoorUserData } from "./elevator/elevatorLayout";
import { createWalkWorld } from "./index";
import { createRoomScene } from "./room/room";
import type { DoorUserData as RoomDoorUserData } from "./room/roomLayout";
import { createTrainScene } from "./train/train";
import type { DoorLeafUserData, DoorUserData as TrainDoorUserData } from "./train/trainLayout";
import { SpaceWalker } from "./walk/walker";

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

/** ボタンを押した時の処理（main.ts と同じ: 近くのドア 1 つだけを切り替え，無ければ何もしない） */
function press(doors: readonly DevDoor[], player: { x: number; z: number }): DevDoor | null {
  const door = findNearbyDevDoor(doors, player);
  if (door) door.setOpen(!door.isOpen());
  return door;
}

describe("nearestDoorIndex", () => {
  const centers = [
    { x: 0, z: 0 },
    { x: 1, z: 0 },
    { x: 5, z: 5 },
  ];

  it("範囲は 1.5 m", () => {
    expect(DEV_DOOR_REACH).toBe(1.5);
  });

  it("範囲内で最も近いものの添字を返す", () => {
    expect(nearestDoorIndex(centers, { x: 0.8, z: 0.2 })).toBe(1);
    expect(nearestDoorIndex(centers, { x: 0.2, z: 0.2 })).toBe(0);
    expect(nearestDoorIndex(centers, { x: 4.5, z: 4.5 })).toBe(2);
  });

  it("距離は XZ 平面で測り，ちょうど 1.5 m は範囲内，それを超えると範囲外", () => {
    expect(nearestDoorIndex([{ x: 0, z: 0 }], { x: 0.9, z: 1.2 })).toBe(0);
    expect(nearestDoorIndex([{ x: 0, z: 0 }], { x: 0, z: 1.5 })).toBe(0);
    expect(nearestDoorIndex([{ x: 0, z: 0 }], { x: 0, z: 1.5001 })).toBeNull();
  });

  it("範囲内に無ければ null．ドアが無くても null", () => {
    expect(nearestDoorIndex(centers, { x: -3, z: -3 })).toBeNull();
    expect(nearestDoorIndex([], { x: 0, z: 0 })).toBeNull();
  });

  it("maxDistance を指定できる", () => {
    expect(nearestDoorIndex(centers, { x: 0, z: 0.8 }, 0.5)).toBeNull();
    expect(nearestDoorIndex(centers, { x: 0, z: 0.8 }, 1)).toBe(0);
  });
});

describe("部屋の確認用ドア", () => {
  it("廊下へのドア 1 つ．近くで押すと開閉が切り替わり，歩行の当たり判定も切り替わる", () => {
    const space = createRoomScene({ maxAnisotropy: 1 });
    const doors = createDevDoors(space);
    expect(doors).toHaveLength(1);
    const [door] = doors as [DevDoor];
    const data = space.parts.door.userData as RoomDoorUserData;
    expect(data.open).toBe(false);

    const near = { x: door.center.x, z: door.center.z - 1.0 };
    expect(press(doors, near)).toBe(door);
    expect(data.open).toBe(true);
    expect(door.isOpen()).toBe(true);

    // 開いたドアを歩いて通れる（当たり判定が userData.open を読む）
    const world = createWalkWorld(space);
    const walker = new SpaceWalker(
      world,
      { position: { x: door.center.x, y: 1.6, z: 1.9 }, bodyYaw: Math.PI },
      () => {},
    );
    for (let i = 0; i < 90; i++)
      walker.update({ dt: 1 / 30, input: { ...IDLE_PLAYER_INPUT, walking: true, walkSpeed: 1 } });
    expect(walker.observe().areaIds).toContain("hallway");

    // もう一度押すと閉じる
    press(doors, near);
    expect(data.open).toBe(false);
  });

  it("開いたドアは見た目（回転）も変わり，閉じると元に戻る", () => {
    const space = createRoomScene({ maxAnisotropy: 1 });
    const [door] = createDevDoors(space) as [DevDoor];
    const closedRotation = space.parts.door.rotation.y;
    door.setOpen(true);
    expect(space.parts.door.rotation.y).not.toBeCloseTo(closedRotation);
    door.setOpen(false);
    expect(space.parts.door.rotation.y).toBeCloseTo(closedRotation);
  });

  it("ドアから 1.5 m より遠くで押しても何も変わらない", () => {
    const space = createRoomScene({ maxAnisotropy: 1 });
    const doors = createDevDoors(space);
    const [door] = doors as [DevDoor];
    expect(press(doors, { x: door.center.x, z: door.center.z - 1.6 })).toBeNull();
    expect((space.parts.door.userData as RoomDoorUserData).open).toBe(false);
    // 開始位置からも遠い
    expect(press(doors, space.startPosition)).toBeNull();
  });
});

describe("電車の確認用ドア", () => {
  it("側面の 4 か所と妻面の 2 か所がそれぞれ 1 つのドアになる", () => {
    const space = createTrainScene({ maxAnisotropy: 1 });
    const ids = createDevDoors(space).map((d) => d.id);
    expect(ids).toHaveLength(6);
    expect(new Set(ids)).toEqual(new Set(space.parts.doors.map((d) => d.name)));
  });

  it("近くの側面のドア 1 つだけが開き，その両開きの扉 2 枚がまとめて開く（他のドアは閉じたまま）", () => {
    const space = createTrainScene({ maxAnisotropy: 1 });
    const doors = createDevDoors(space);
    const target = doors.find((d) => d.id === "door-left-1");
    if (!target) throw new Error("door-left-1 がない");
    const pressed = press(doors, { x: target.center.x + 1.0, z: target.center.z });
    expect(pressed?.id).toBe("door-left-1");

    for (const d of space.parts.doors) {
      expect((d.userData as TrainDoorUserData).open, d.name).toBe(d.name === "door-left-1");
    }
    const leaves = space.parts.doorLeaves.filter(
      (l) => (l.userData as DoorLeafUserData).doorId === "door-left-1",
    );
    expect(leaves).toHaveLength(2);
    for (const leaf of leaves) expect((leaf.userData as DoorLeafUserData).openAmount).toBe(1);
    // 他のドアの扉は閉じたまま
    const others = space.parts.doorLeaves.filter(
      (l) => (l.userData as DoorLeafUserData).doorId !== "door-left-1",
    );
    for (const leaf of others) expect((leaf.userData as DoorLeafUserData).openAmount).toBe(0);

    press(doors, { x: target.center.x + 1.0, z: target.center.z });
    for (const leaf of leaves) expect((leaf.userData as DoorLeafUserData).openAmount).toBe(0);
    expect(target.isOpen()).toBe(false);
  });

  it("開けると扉の板の位置が動き，閉じると元の位置に戻る", () => {
    const space = createTrainScene({ maxAnisotropy: 1 });
    const doors = createDevDoors(space);
    const target = doors.find((d) => d.id === "door-left-1") as DevDoor;
    const leaves = space.parts.doorLeaves.filter(
      (l) => (l.userData as DoorLeafUserData).doorId === "door-left-1",
    );
    const closed = leaves.map((l) => l.position.x);
    target.setOpen(true);
    for (const [i, l] of leaves.entries())
      expect(l.position.x).not.toBeCloseTo(closed[i] as number);
    // 2 枚は反対の向きへ動く
    const [a, b] = leaves.map((l, i) => l.position.x - (closed[i] as number)) as [number, number];
    expect(Math.sign(a)).toBe(-Math.sign(b));
    target.setOpen(false);
    for (const [i, l] of leaves.entries()) expect(l.position.x).toBeCloseTo(closed[i] as number);
  });

  it("2 つのドアの両方が範囲内なら，近い方だけを切り替える", () => {
    const space = createTrainScene({ maxAnisotropy: 1 });
    const doors = createDevDoors(space);
    const left = doors.find((d) => d.id === "door-left-1") as DevDoor;
    const right = doors.find((d) => d.id === "door-right-1") as DevDoor;
    // 車幅 2.8m．中央より少し左（左のドアから 1.3m・右のドアから 1.5m．どちらも範囲内）→ 左だけ
    const player = { x: left.center.x + 1.3, z: left.center.z };
    expect(Math.hypot(right.center.x - player.x, right.center.z - player.z)).toBeLessThanOrEqual(
      1.5,
    );
    expect(press(doors, player)?.id).toBe("door-left-1");
    expect(left.isOpen()).toBe(true);
    expect(right.isOpen()).toBe(false);
  });

  it("どのドアからも 1.5 m より遠ければ何もしない", () => {
    const space = createTrainScene({ maxAnisotropy: 1 });
    const doors = createDevDoors(space);
    // 車内の中央（z=0）はどのドアからも遠い（側面のドアは z=±2.4，妻面は z=±5）
    expect(press(doors, { x: 0, z: 0 })).toBeNull();
    for (const d of space.parts.doors) expect((d.userData as TrainDoorUserData).open).toBe(false);
  });
});

describe("エレベーターの確認用ドア", () => {
  it("扉 2 枚をまとめて 1 つのドアとして開閉する", () => {
    const space = createElevatorScene({ maxAnisotropy: 1 });
    const doors = createDevDoors(space);
    expect(doors).toHaveLength(1);
    const pressed = press(doors, space.startPosition);
    expect(pressed).not.toBeNull();
    const group = space.parts.doors[0];
    if (!group) throw new Error("扉がない");
    const data = group.userData as ElevatorDoorUserData;
    expect(data.open).toBe(true);
    expect(data.openAmount).toBe(1);
    const leaves = space.parts.doorLeaves.filter(
      (l) => (l.userData as ElevatorDoorLeafUserData).doorId === data.id,
    );
    expect(leaves).toHaveLength(2);
    for (const leaf of leaves)
      expect((leaf.userData as ElevatorDoorLeafUserData).openAmount).toBe(1);

    press(doors, space.startPosition);
    expect(data.open).toBe(false);
    expect(data.openAmount).toBe(0);
    for (const leaf of leaves)
      expect((leaf.userData as ElevatorDoorLeafUserData).openAmount).toBe(0);
  });

  it("乗り場の奥（扉から 1.5 m より遠く）で押しても何もしない", () => {
    const space = createElevatorScene({ maxAnisotropy: 1 });
    const doors = createDevDoors(space);
    const [door] = doors as [DevDoor];
    expect(press(doors, { x: door.center.x, z: door.center.z - 2 })).toBeNull();
    expect(door.isOpen()).toBe(false);
  });
});
