// createTrainScene は canvas でテクスチャを描くため，node 環境では document を何もしない
// canvas に差し替えて組み立てだけを確かめる（描画結果は見ない）

import * as THREE from "three";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { AVAILABLE_SPACE_IDS, createSpace } from "../index";
import { resolveSpaceId } from "../spaceParam";
import { createTrainScene, isTrainSpace, type TrainSpace } from "./train";
import {
  CAR,
  DOOR_COCKS,
  type DoorCockUserData,
  type DoorLeafUserData,
  type DoorUserData,
  GANGWAY_DOORS,
  type HandrailUserData,
  type SeatUserData,
  SIDE_DOORS,
  STRAP_LENGTH,
  type StrapUserData,
  slidingLeafX,
  TRAIN_HANDRAILS,
  TRAIN_LUGGAGE,
  TRAIN_SEATS,
  TRAIN_STRAPS,
} from "./trainLayout";

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

function build(): TrainSpace {
  return createTrainScene({ maxAnisotropy: 1 });
}

function isDescendantOf(object: THREE.Object3D, ancestor: THREE.Object3D): boolean {
  let p = object.parent;
  while (p) {
    if (p === ancestor) return true;
    p = p.parent;
  }
  return false;
}

describe("createTrainScene", () => {
  it("id は train で，電車の空間と判定される", () => {
    const space = build();
    expect(space.id).toBe("train");
    expect(isTrainSpace(space)).toBe(true);
  });

  it("開始位置はドア付近の (-0.92, 1.6, 3.28)，向きは 0.25", () => {
    const space = build();
    expect(space.startPosition.x).toBeCloseTo(-0.92);
    expect(space.startPosition.y).toBe(1.6);
    expect(space.startPosition.z).toBeCloseTo(3.28);
    expect(space.startYaw).toBeCloseTo(0.25);
  });

  it("車体（carBody）は root の子で，触れる・動かす対象はすべて carBody の子孫", () => {
    const { root, parts } = build();
    expect(parts.carBody.parent).toBe(root);
    expect(parts.carBody.name).toBe("carBody");
    const all = [
      ...parts.seats,
      ...parts.handrails,
      ...parts.straps,
      ...parts.doors,
      ...parts.doorLeaves,
      ...parts.doorCocks,
      ...parts.intercoms,
      ...parts.racks,
      ...parts.luggage,
    ];
    expect(all.length).toBeGreaterThan(0);
    for (const g of all) expect(isDescendantOf(g, parts.carBody)).toBe(true);
  });

  it("carBody を動かすと座席・つり革・ドアも一緒に動く", () => {
    const { root, parts } = build();
    root.updateMatrixWorld(true);
    const targets = [parts.seats[0], parts.straps[0], parts.doors[0]];
    const before = targets.map((g) => g.getWorldPosition(new THREE.Vector3()));
    parts.carBody.position.set(0.3, 0, -0.5);
    root.updateMatrixWorld(true);
    targets.forEach((g, i) => {
      const after = g.getWorldPosition(new THREE.Vector3());
      expect(after.x - before[i].x).toBeCloseTo(0.3);
      expect(after.z - before[i].z).toBeCloseTo(-0.5);
    });
  });

  it("ホームは車体の外（root 直下・左側面の外）にある", () => {
    const { root, parts } = build();
    const platform = root.getObjectByName("platform");
    expect(platform).toBeDefined();
    if (!platform) return;
    expect(isDescendantOf(platform, parts.carBody)).toBe(false);
    const box = new THREE.Box3().setFromObject(platform);
    expect(box.max.x).toBeLessThanOrEqual(-CAR.width / 2);
  });

  it("数は定義と一致する", () => {
    const { parts } = build();
    expect(parts.seats).toHaveLength(TRAIN_SEATS.length);
    expect(parts.handrails).toHaveLength(TRAIN_HANDRAILS.length);
    expect(parts.straps).toHaveLength(TRAIN_STRAPS.length);
    expect(parts.straps).toHaveLength(32);
    expect(parts.doors).toHaveLength(SIDE_DOORS.length + GANGWAY_DOORS.length);
    expect(parts.doorCocks).toHaveLength(DOOR_COCKS.length);
    expect(parts.luggage).toHaveLength(TRAIN_LUGGAGE.length);
    expect(parts.intercoms.length).toBeGreaterThanOrEqual(1);
  });

  it("id（= name）は一意で，byId ですべて引ける", () => {
    const { parts } = build();
    const all = [
      ...parts.seats,
      ...parts.handrails,
      ...parts.straps,
      ...parts.doors,
      ...parts.doorLeaves,
      ...parts.doorCocks,
      ...parts.intercoms,
      ...parts.racks,
      ...parts.luggage,
    ];
    const names = all.map((g) => g.name);
    expect(names.every((n) => n.length > 0)).toBe(true);
    expect(new Set(names).size).toBe(names.length);
    expect(parts.byId.size).toBe(all.length);
    for (const g of all) expect(parts.byId.get(g.name)).toBe(g);
  });

  it("手すり・つり革は grabbed=false の状態欄を持つ", () => {
    const { parts } = build();
    for (const g of parts.handrails) {
      const data = g.userData as HandrailUserData;
      expect(data.grabbed).toBe(false);
      expect(["vertical", "horizontal"]).toContain(data.orientation);
    }
    for (const g of parts.straps) {
      const data = g.userData as StrapUserData;
      expect(data.grabbed).toBe(false);
      expect(data.id).toBe(g.name);
      expect(data.kind).toBe("strap");
    }
  });

  it("つり革は 1 本ずつ独立し，原点が上端の支点（形は原点より下）", () => {
    const { parts } = build();
    for (const g of parts.straps) {
      const def = TRAIN_STRAPS.find((s) => s.id === g.name);
      expect(def).toBeDefined();
      if (!def) continue;
      expect(g.position.toArray()).toEqual(def.position.map((v) => expect.closeTo(v, 9)));
      expect((g.userData as StrapUserData).length).toBeCloseTo(STRAP_LENGTH);
      g.updateMatrixWorld(true);
      const box = new THREE.Box3();
      for (const child of g.children) box.expandByObject(child);
      // Group のローカル座標に戻す
      box.translate(g.getWorldPosition(new THREE.Vector3()).negate());
      expect(box.max.y).toBeLessThanOrEqual(1e-6);
      // 輪の下端は userData.length（支点から輪の下端まで）とほぼ一致する（1cm 以内）
      expect(Math.abs(box.min.y + STRAP_LENGTH)).toBeLessThan(0.01);
    }
    // 他のつり革と Group を共有しない（独立に揺らせる）
    expect(new Set(parts.straps).size).toBe(parts.straps.length);
  });

  it("ドアは open=false，扉は openAmount=0 で閉じた位置にある", () => {
    const { parts } = build();
    for (const door of parts.doors) {
      const data = door.userData as DoorUserData;
      expect(data.open).toBe(false);
      expect(data.openStyle).toBe("slide");
      expect(data.leafIds.length).toBeGreaterThanOrEqual(1);
      for (const leafId of data.leafIds) {
        const leaf = parts.byId.get(leafId);
        expect(leaf).toBeDefined();
        expect(leaf?.parent).toBe(door);
      }
    }
    for (const leaf of parts.doorLeaves) {
      const data = leaf.userData as DoorLeafUserData;
      expect(data.openAmount).toBe(0);
      expect(data.kind).toBe("doorLeaf");
      expect(leaf.position.x).toBeCloseTo(slidingLeafX(data, 0));
    }
  });

  it("側面のドアは開口部 1.3m × 1.85m で左右 2 枚", () => {
    const { parts } = build();
    const side = parts.doors.filter((d) => (d.userData as DoorUserData).kind === "sideDoor");
    expect(side).toHaveLength(4);
    for (const d of side) {
      const data = d.userData as DoorUserData;
      expect(data.width).toBeCloseTo(1.3);
      expect(data.height).toBeCloseTo(1.85);
      expect(data.leafIds).toHaveLength(2);
    }
  });

  it("扉を slidingLeafX で全開位置へ動かすと開口部が全幅あく", () => {
    const { parts } = build();
    for (const door of parts.doors) {
      const data = door.userData as DoorUserData;
      for (const leafId of data.leafIds) {
        const leaf = parts.byId.get(leafId);
        if (!leaf) throw new Error(leafId);
        const leafData = leaf.userData as DoorLeafUserData;
        leafData.openAmount = 1;
        leaf.position.x = slidingLeafX(leafData, leafData.openAmount);
        const x0 = leaf.position.x - leafData.size.x / 2;
        const x1 = leaf.position.x + leafData.size.x / 2;
        const overlap = Math.min(x1, data.width / 2) - Math.max(x0, -data.width / 2);
        expect(overlap).toBeLessThanOrEqual(1e-9);
      }
    }
  });

  it("非常扉がある", () => {
    const { parts } = build();
    const emergency = parts.doors.filter(
      (d) => (d.userData as DoorUserData).kind === "emergencyDoor",
    );
    expect(emergency).toHaveLength(1);
    expect(parts.byId.get("emergency-door-handrail")).toBeDefined();
  });

  it("座席は区画ごとの Group で，着座位置（目の位置）と向きを持つ", () => {
    const { parts } = build();
    for (const seat of parts.seats) {
      const data = seat.userData as SeatUserData;
      expect(data.slots).toHaveLength(data.persons);
      for (const slot of data.slots) expect(slot.eyePosition[1]).toBeCloseTo(1.2);
      expect(data.facingYaw).toBeCloseTo(data.side === "left" ? -Math.PI / 2 : Math.PI / 2);
    }
  });

  it("非常用ドアコックは opened=false で，対応するドアがある", () => {
    const { parts } = build();
    for (const cock of parts.doorCocks) {
      const data = cock.userData as DoorCockUserData;
      expect(data.opened).toBe(false);
      expect(parts.byId.get(data.doorId)).toBeDefined();
      expect(cock.getObjectByName(data.lidName)).toBeDefined();
    }
  });

  it("dispose で root が Scene から外れる", () => {
    const space = build();
    const scene = new THREE.Scene();
    scene.add(space.root);
    space.dispose();
    expect(space.root.parent).toBeNull();
  });
});

describe("空間の切り替え（?scene=）", () => {
  it("room と train が実装済み", () => {
    expect([...AVAILABLE_SPACE_IDS].sort()).toEqual(["room", "train"]);
  });

  it("?scene=train は train，?scene=room は room", () => {
    expect(resolveSpaceId("?scene=train", AVAILABLE_SPACE_IDS)).toBe("train");
    expect(resolveSpaceId("?scene=room", AVAILABLE_SPACE_IDS)).toBe("room");
  });

  it.each(["?scene=elevator", "?scene=bus", "?scene=", ""])(
    "%j は room にフォールバック",
    (search) => {
      expect(resolveSpaceId(search, AVAILABLE_SPACE_IDS)).toBe("room");
    },
  );

  it("createSpace で train と room を作れる（部屋は壊れていない）", () => {
    const train = createSpace("train", { maxAnisotropy: 1 });
    expect(train.id).toBe("train");
    train.dispose();
    const room = createSpace("room", { maxAnisotropy: 1 });
    expect(room.id).toBe("room");
    expect(room.root.children.length).toBeGreaterThan(0);
    room.dispose();
  });

  it("未実装の空間（elevator）は createSpace で例外", () => {
    expect(() => createSpace("elevator", { maxAnisotropy: 1 })).toThrow();
  });
});
