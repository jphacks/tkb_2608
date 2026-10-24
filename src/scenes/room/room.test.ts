// createRoomScene は canvas でテクスチャを描くため，node 環境では document を何もしない
// canvas に差し替えて組み立てだけを確かめる（描画結果は見ない）．要件（シナリオ PLAN_04 の H1）を基準にする

import * as THREE from "three";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { Space } from "../types";
import { createRoomScene, isRoomSpace, type RoomSpace } from "./room";
import {
  type BookUserData,
  BREAKER,
  BREAKER_PANEL_ID,
  type BreakerPanelUserData,
  type BreakerSwitchUserData,
  breakerSwitchHeight,
  COUNTER_ID,
  DOOR,
  DOOR_SPAN_X,
  type DoorUserData,
  GLASS_SHARDS,
  type GlassShardsUserData,
  HALLWAY,
  PENDANT_ID,
  ROOM,
  ROOM_AREAS,
  ROOM_FURNITURE,
  ROOM_START,
  roomDoorRotationY,
  roomFurnitureDef,
  STOVE_BURNERS,
  STOVE_ID,
  type StoveFlameUserData,
  type StoveKnobUserData,
  type StoveUserData,
  TABLE_ID,
  type TableLegUserData,
  type TableUserData,
  TV_ID,
  type TvUserData,
  tableLegId,
  WINDOW,
  type WindowGlassUserData,
} from "./roomLayout";

const HALF_D = ROOM.depth / 2;

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

function build(): RoomSpace {
  const space = createRoomScene({ maxAnisotropy: 1 });
  space.root.updateMatrixWorld(true);
  return space;
}

function isDescendantOf(object: THREE.Object3D, ancestor: THREE.Object3D): boolean {
  let p = object.parent;
  while (p) {
    if (p === ancestor) return true;
    p = p.parent;
  }
  return false;
}

function worldPos(o: THREE.Object3D): THREE.Vector3 {
  return o.getWorldPosition(new THREE.Vector3());
}

function box(o: THREE.Object3D): THREE.Box3 {
  return new THREE.Box3().setFromObject(o);
}

describe("createRoomScene", () => {
  it("id は room で，部屋の空間と判定される", () => {
    const space = build();
    expect(space.id).toBe("room");
    expect(isRoomSpace(space)).toBe(true);
    space.dispose();
  });

  it("parts を持たない Space・他の id は部屋と判定しない", () => {
    const other = { id: "train", root: new THREE.Group(), parts: {} } as unknown as Space;
    expect(isRoomSpace(other)).toBe(false);
    const noParts = { id: "room", root: new THREE.Group() } as unknown as Space;
    expect(isRoomSpace(noParts)).toBe(false);
  });

  it("開始位置は (-0.6, 1.6, 0.2)，向きは -π/2（+X のコンロを向く）", () => {
    const space = build();
    expect(space.startPosition.x).toBeCloseTo(-0.6);
    expect(space.startPosition.y).toBeCloseTo(1.6);
    expect(space.startPosition.z).toBeCloseTo(0.2);
    expect(space.startYaw).toBeCloseTo(-Math.PI / 2);
    expect(space.startPosition.toArray()).toEqual([...ROOM_START.position]);
  });

  it("shell と furniture は root の子で，互いに別（親子関係にない）", () => {
    const { root, parts } = build();
    expect(parts.shell.parent).toBe(root);
    expect(parts.furniture.parent).toBe(root);
    expect(parts.shell).not.toBe(parts.furniture);
    expect(isDescendantOf(parts.furniture, parts.shell)).toBe(false);
    expect(isDescendantOf(parts.shell, parts.furniture)).toBe(false);
  });

  it("窓ガラス・ガラスの破片・ドアは shell の子孫，家具の外", () => {
    const { parts } = build();
    for (const g of [parts.windowGlass, parts.glassShards, parts.door]) {
      expect(isDescendantOf(g, parts.shell), g.name).toBe(true);
      expect(isDescendantOf(g, parts.furniture), g.name).toBe(false);
    }
  });

  it("床・天井は shell の中にある", () => {
    const { parts } = build();
    expect(parts.shell.getObjectByName("floor")).toBeDefined();
    expect(parts.shell.getObjectByName("ceiling")).toBeDefined();
  });

  it("廊下・窓の外の景色・照明は root 直下（shell・furniture の外）", () => {
    const { root, parts } = build();
    expect(parts.hallway.parent).toBe(root);
    const outside = root.getObjectByName("outside-view");
    expect(outside?.parent).toBe(root);
    const lights: THREE.Light[] = [];
    root.traverse((o) => {
      if (o instanceof THREE.Light) lights.push(o);
    });
    expect(lights.length).toBeGreaterThan(0);
    // ペンダントライトの電球の光は家具（揺らす対象）の一部なので除く
    const roomLights = lights.filter((l) => !isDescendantOf(l, parts.pendant));
    expect(roomLights.length).toBeGreaterThan(0);
    for (const l of roomLights) {
      expect(l.parent, l.name).toBe(root);
    }
  });

  it("shell を動かすとドア・窓ガラスが一緒に動き，家具と廊下は動かない", () => {
    const { root, parts } = build();
    const shellTargets = [parts.door, parts.windowGlass];
    const others = [parts.tv, parts.stove.body, parts.hallway];
    const before = shellTargets.map(worldPos);
    const othersBefore = others.map(worldPos);
    parts.shell.position.set(0.05, 0.02, -0.03);
    root.updateMatrixWorld(true);
    shellTargets.forEach((g, i) => {
      const d = worldPos(g).sub(before[i]);
      expect(d.x).toBeCloseTo(0.05);
      expect(d.y).toBeCloseTo(0.02);
      expect(d.z).toBeCloseTo(-0.03);
    });
    others.forEach((g, i) => {
      expect(worldPos(g).distanceTo(othersBefore[i])).toBeCloseTo(0);
    });
  });

  it("家具は 15 個の独立した Group（furniture の直下）で，定義の位置にある", () => {
    const { parts } = build();
    expect(ROOM_FURNITURE).toHaveLength(15);
    for (const def of ROOM_FURNITURE) {
      const g = parts.byId.get(def.id);
      expect(g, def.id).toBeInstanceOf(THREE.Group);
      if (!g) continue;
      expect(g.parent).toBe(parts.furniture);
      const p = worldPos(g);
      expect(p.x).toBeCloseTo(def.position[0]);
      expect(p.y).toBeCloseTo(def.position[1]);
      expect(p.z).toBeCloseTo(def.position[2]);
      expect(g.userData.id).toBe(def.id);
      expect(g.userData.kind).toBe(def.kind);
    }
  });

  it("byId は id（= name）で各部品を引け，名前は一意", () => {
    const { parts } = build();
    const expected = [
      ...ROOM_FURNITURE.map((f) => f.id),
      ...[0, 1, 2, 3].map((i) => tableLegId(TABLE_ID, i)),
      ...STOVE_BURNERS.flatMap((b) => [b.knobId, b.flameId]),
      BREAKER.mainSwitchId,
      "window-glass",
      GLASS_SHARDS.id,
      "door",
    ];
    expect(new Set(expected).size).toBe(expected.length);
    expect(parts.byId.size).toBe(expected.length);
    for (const id of expected) {
      const g = parts.byId.get(id);
      expect(g, id).toBeDefined();
      expect(g?.name).toBe(id);
    }
    expect(parts.byId.get("door")).toBe(parts.door);
    expect(parts.byId.get("window-glass")).toBe(parts.windowGlass);
    expect(parts.byId.get(GLASS_SHARDS.id)).toBe(parts.glassShards);
    expect(parts.byId.get(PENDANT_ID)).toBe(parts.pendant);
    expect(parts.byId.get(TV_ID)).toBe(parts.tv);
    expect(parts.byId.get(STOVE_ID)).toBe(parts.stove.body);
    expect(parts.byId.get(BREAKER_PANEL_ID)).toBe(parts.breaker.panel);
    expect(parts.byId.get(BREAKER.mainSwitchId)).toBe(parts.breaker.mainSwitch);
  });

  it("areas は ROOM_AREAS と同じ", () => {
    const { parts } = build();
    expect(parts.areas).toBe(ROOM_AREAS);
  });

  it("本は本棚の中にあり，userData は kind:'book'", () => {
    const { parts } = build();
    const shelf = parts.byId.get("bookshelf");
    expect(parts.books.length).toBeGreaterThan(0);
    for (const b of parts.books) {
      expect(b).toBeInstanceOf(THREE.Mesh);
      expect((b.userData as BookUserData).kind).toBe("book");
      if (shelf) expect(isDescendantOf(b, shelf)).toBe(true);
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

describe("テーブルの脚", () => {
  it("4 本がそれぞれ独立した Group で，id・kind:'tableLeg'・grabbed:false を持つ", () => {
    const { parts } = build();
    const table = parts.byId.get(TABLE_ID);
    expect(table).toBeDefined();
    if (!table) return;
    expect(parts.tableLegs).toHaveLength(4);
    expect(new Set(parts.tableLegs).size).toBe(4);
    parts.tableLegs.forEach((leg) => {
      const data = leg.userData as TableLegUserData;
      expect(leg).toBeInstanceOf(THREE.Group);
      expect(data.kind).toBe("tableLeg");
      expect(data.grabbed).toBe(false);
      expect(data.id).toBe(leg.name);
      expect(data.tableId).toBe(TABLE_ID);
      expect(data.id).toBe(tableLegId(TABLE_ID, data.index - 1));
      expect(isDescendantOf(leg, table)).toBe(true);
    });
    expect(parts.tableLegs.map((l) => (l.userData as TableLegUserData).index).sort()).toEqual([
      1, 2, 3, 4,
    ]);
    expect((table.userData as TableUserData).legIds).toEqual(parts.tableLegs.map((l) => l.name));
  });

  it("脚は床に立ち，テーブルの床占有範囲の内側の四隅にある", () => {
    const { parts } = build();
    const def = roomFurnitureDef(TABLE_ID);
    const halfX = def.size.x / 2;
    const halfZ = def.size.z / 2;
    const quadrants = new Set<string>();
    for (const leg of parts.tableLegs) {
      const p = worldPos(leg);
      expect(p.y).toBeCloseTo(0);
      const dx = p.x - def.position[0];
      const dz = p.z - def.position[2];
      expect(Math.abs(dx)).toBeLessThan(halfX);
      expect(Math.abs(dz)).toBeLessThan(halfZ);
      quadrants.add(`${Math.sign(dx)},${Math.sign(dz)}`);
      const b = box(leg);
      expect(b.min.y).toBeCloseTo(0, 3);
    }
    expect(quadrants.size).toBe(4);
  });

  it("脚 1 本だけを動かしても他の脚は動かない（独立している）", () => {
    const { root, parts } = build();
    const [first, ...rest] = parts.tableLegs;
    const before = rest.map(worldPos);
    first.position.y += 0.1;
    root.updateMatrixWorld(true);
    rest.forEach((l, i) => {
      expect(worldPos(l).distanceTo(before[i])).toBeCloseTo(0);
    });
  });
});

describe("コンロ", () => {
  it("カウンターの上に載る（底面の高さがカウンターの天面）", () => {
    const { parts } = build();
    const counter = roomFurnitureDef(COUNTER_ID);
    expect(worldPos(parts.stove.body).y).toBeCloseTo(counter.size.y);
    expect((parts.stove.body.userData as StoveUserData).restsOn).toBe(COUNTER_ID);
  });

  it("口ごとにつまみ（on:true）と火（lit:true，表示中）が対応する", () => {
    const { parts } = build();
    const { stove, byId } = parts;
    expect(stove.knobs).toHaveLength(STOVE_BURNERS.length);
    expect(stove.flames).toHaveLength(STOVE_BURNERS.length);
    for (const knob of stove.knobs) {
      const k = knob.userData as StoveKnobUserData;
      expect(k.kind).toBe("stoveKnob");
      expect(k.on).toBe(true);
      expect(k.id).toBe(knob.name);
      expect(k.stoveId).toBe(STOVE_ID);
      expect(isDescendantOf(knob, stove.body)).toBe(true);
      const flame = byId.get(k.flameId);
      expect(flame, k.flameId).toBeDefined();
      expect((flame?.userData as StoveFlameUserData | undefined)?.knobId).toBe(k.id);
    }
    for (const flame of stove.flames) {
      const f = flame.userData as StoveFlameUserData;
      expect(f.kind).toBe("stoveFlame");
      expect(f.lit).toBe(true);
      expect(flame.visible).toBe(true);
      expect(f.id).toBe(flame.name);
      expect(f.stoveId).toBe(STOVE_ID);
      expect(isDescendantOf(flame, stove.body)).toBe(true);
      const knob = byId.get(f.knobId);
      expect((knob?.userData as StoveKnobUserData | undefined)?.flameId).toBe(f.id);
    }
    const body = stove.body.userData as StoveUserData;
    expect(body.knobIds).toEqual(STOVE_BURNERS.map((b) => b.knobId));
    expect(body.flameIds).toEqual(STOVE_BURNERS.map((b) => b.flameId));
  });

  it("火はコンロの上面より上，つまみはコンロの正面（開始位置の側 -X）にある", () => {
    const { parts } = build();
    const stoveTop = box(parts.stove.body);
    const def = roomFurnitureDef(STOVE_ID);
    for (const flame of parts.stove.flames) {
      expect(worldPos(flame).y).toBeGreaterThanOrEqual(def.position[1] + def.size.y - 1e-6);
    }
    for (const knob of parts.stove.knobs) {
      const p = worldPos(knob);
      expect(p.x).toBeLessThan(def.position[0]);
      expect(p.y).toBeLessThan(stoveTop.max.y);
    }
  });
});

describe("ブレーカー", () => {
  it("分電盤のメインスイッチは kind:'breakerSwitch'・on:true，高さ 1.2〜1.4m", () => {
    const { parts } = build();
    const { panel, mainSwitch } = parts.breaker;
    const data = mainSwitch.userData as BreakerSwitchUserData;
    expect(data.kind).toBe("breakerSwitch");
    expect(data.on).toBe(true);
    expect(data.id).toBe(mainSwitch.name);
    expect(data.panelId).toBe(BREAKER_PANEL_ID);
    expect(isDescendantOf(mainSwitch, panel)).toBe(true);
    const y = worldPos(mainSwitch).y;
    expect(y).toBeGreaterThanOrEqual(1.2);
    expect(y).toBeLessThanOrEqual(1.4);
    expect(y).toBeCloseTo(breakerSwitchHeight());
    expect(mainSwitch.getObjectByName(data.leverName)).toBeDefined();
    expect((panel.userData as BreakerPanelUserData).switchIds).toEqual([data.id]);
  });

  it("分電盤はドアの横の南の壁にある", () => {
    const { parts } = build();
    const b = box(parts.breaker.panel);
    expect(b.max.z).toBeCloseTo(HALF_D, 2);
    const gap = Math.max(b.min.x - DOOR_SPAN_X.maxX, DOOR_SPAN_X.minX - b.max.x);
    expect(gap).toBeGreaterThanOrEqual(0);
    expect(gap).toBeLessThan(0.6);
  });
});

describe("窓ガラスとガラスの破片", () => {
  it("窓ガラスは kind:'windowGlass'・broken:false で窓の開口部の中心にある", () => {
    const { parts } = build();
    const data = parts.windowGlass.userData as WindowGlassUserData;
    expect(data.kind).toBe("windowGlass");
    expect(data.broken).toBe(false);
    expect(data.width).toBeCloseTo(WINDOW.width);
    expect(data.height).toBeCloseTo(WINDOW.height);
    const p = worldPos(parts.windowGlass);
    expect(p.x).toBeCloseTo(WINDOW.centerX);
    expect(p.y).toBeCloseTo(WINDOW.bottom + WINDOW.height / 2);
    expect(p.z).toBeCloseTo(-HALF_D);
  });

  it("破片は kind:'glassShards' で既定は非表示，窓の近くの床にある", () => {
    const { parts } = build();
    const data = parts.glassShards.userData as GlassShardsUserData;
    expect(data.kind).toBe("glassShards");
    expect(data.count).toBe(GLASS_SHARDS.count);
    expect(parts.glassShards.visible).toBe(false);
    const b = box(parts.glassShards);
    expect(b.isEmpty()).toBe(false);
    expect(b.max.y).toBeLessThan(0.05);
    expect(b.min.y).toBeGreaterThanOrEqual(0);
    expect(b.min.z).toBeGreaterThanOrEqual(-HALF_D);
    expect(b.max.z).toBeLessThanOrEqual(-HALF_D + 1);
    expect(b.min.x).toBeGreaterThanOrEqual(WINDOW.centerX - WINDOW.width / 2 - 1e-6);
    expect(b.max.x).toBeLessThanOrEqual(WINDOW.centerX + WINDOW.width / 2 + 1e-6);
  });
});

describe("ドアと廊下", () => {
  it("ドアは open:false・openAngle:0 で閉じた向き", () => {
    const { parts } = build();
    const data = parts.door.userData as DoorUserData;
    expect(data.kind).toBe("door");
    expect(data.open).toBe(false);
    expect(data.openAngle).toBe(0);
    expect(data.width).toBeCloseTo(DOOR.width);
    expect(data.height).toBeCloseTo(DOOR.height);
    expect(parts.door.rotation.y).toBeCloseTo(roomDoorRotationY(data, 0));
  });

  it("閉じたドアの板は開口部をふさぐ", () => {
    const { parts } = build();
    const leaf = parts.door.getObjectByName("door-leaf");
    expect(leaf).toBeDefined();
    if (!leaf) return;
    const b = box(leaf);
    expect(b.min.x).toBeCloseTo(DOOR_SPAN_X.minX, 3);
    expect(b.max.x).toBeCloseTo(DOOR_SPAN_X.maxX, 3);
    expect(b.min.y).toBeCloseTo(0, 3);
    expect(b.max.y).toBeCloseTo(DOOR.height, 3);
    expect((b.min.z + b.max.z) / 2).toBeCloseTo(HALF_D, 2);
  });

  it("ドアを開くと板の先端が部屋の内側（z < 南の壁）へ動き，ヒンジは動かない", () => {
    const { root, parts } = build();
    const data = parts.door.userData as DoorUserData;
    const hinge = worldPos(parts.door);
    parts.door.rotation.y = roomDoorRotationY(data, Math.PI / 2);
    root.updateMatrixWorld(true);
    expect(worldPos(parts.door).distanceTo(hinge)).toBeCloseTo(0);
    const leaf = parts.door.getObjectByName("door-leaf");
    if (!leaf) throw new Error("door-leaf");
    const b = box(leaf);
    expect(b.min.z).toBeLessThan(HALF_D - DOOR.width * 0.9);
  });

  it("廊下は部屋の外（南の壁の向こう）にあり，ドアの開口部の正面を覆う", () => {
    const { parts } = build();
    const b = box(parts.hallway);
    expect(b.min.z).toBeGreaterThanOrEqual(HALF_D - 1e-6);
    expect(b.max.z).toBeCloseTo(HALLWAY.farZ, 3);
    expect(b.min.x).toBeLessThanOrEqual(DOOR_SPAN_X.minX);
    expect(b.max.x).toBeGreaterThanOrEqual(DOOR_SPAN_X.maxX);
    const floor = parts.hallway.getObjectByName("hallway-floor");
    expect(floor).toBeDefined();
    if (floor) {
      const fb = box(floor);
      // 床は部屋の壁の面（z=2.5）から始まり，開口部とつながる
      expect(fb.min.z).toBeCloseTo(HALF_D, 3);
      expect(fb.max.y).toBeCloseTo(0);
    }
  });
});

describe("テレビ・照明", () => {
  it("テレビは on:true で，画面の Mesh を持つ", () => {
    const { parts } = build();
    const data = parts.tv.userData as TvUserData;
    expect(data.kind).toBe("tv");
    expect(data.on).toBe(true);
    expect(parts.tv.getObjectByName(data.screenName)).toBeInstanceOf(THREE.Mesh);
  });

  it("ペンダントライトは天井から吊られ，テーブルの真上にある", () => {
    const { parts } = build();
    const p = worldPos(parts.pendant);
    const table = roomFurnitureDef(TABLE_ID);
    expect(p.y).toBeCloseTo(ROOM.height);
    expect(p.x).toBeCloseTo(table.position[0]);
    expect(p.z).toBeCloseTo(table.position[2]);
  });
});
