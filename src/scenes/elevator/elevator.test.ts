// createElevatorScene は canvas でテクスチャを描くため，node 環境では document を何もしない
// canvas に差し替えて組み立てだけを確かめる（描画結果は見ない）

import * as THREE from "three";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { slidingLeafX } from "../common/slidingDoor";
import type { Space } from "../types";
import { createElevatorScene, type ElevatorSpace, isElevatorSpace } from "./elevator";
import { setElevatorButtonLit, setFloorIndicator } from "./elevatorFixtures";
import {
  CABIN,
  CABIN_DOOR_ID,
  type CabinLightUserData,
  CONTROL_PANELS,
  type ControlPanelUserData,
  ELEVATOR_BUTTONS,
  type ElevatorButtonUserData,
  type ElevatorDoorLeafUserData,
  type ElevatorDoorUserData,
  type ElevatorHandrailUserData,
  FLOOR_INDICATOR_ID,
  type FloorIndicatorUserData,
} from "./elevatorLayout";

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

function build(): ElevatorSpace {
  return createElevatorScene({ maxAnisotropy: 1 });
}

function isDescendantOf(object: THREE.Object3D, ancestor: THREE.Object3D): boolean {
  let p = object.parent;
  while (p) {
    if (p === ancestor) return true;
    p = p.parent;
  }
  return false;
}

function allGroups(space: ElevatorSpace): THREE.Group[] {
  const { parts } = space;
  return [
    ...parts.doors,
    ...parts.doorLeaves,
    ...parts.panels,
    ...parts.buttons,
    ...parts.handrails,
    parts.indicator,
    ...parts.lights,
  ];
}

function worldPos(o: THREE.Object3D): THREE.Vector3 {
  return o.getWorldPosition(new THREE.Vector3());
}

describe("createElevatorScene", () => {
  it("id は elevator で，エレベーターの空間と判定される", () => {
    const space = build();
    expect(space.id).toBe("elevator");
    expect(isElevatorSpace(space)).toBe(true);
    space.dispose();
  });

  it("parts を持たない Space・他の id はエレベーターと判定しない", () => {
    const fake = { id: "room", root: new THREE.Group() } as unknown as Space;
    expect(isElevatorSpace(fake)).toBe(false);
    const noParts = { id: "elevator", root: new THREE.Group() } as unknown as Space;
    expect(isElevatorSpace(noParts)).toBe(false);
  });

  it("開始位置は (0, 1.6, 0.25)，向きは 0（扉の -Z を向く）", () => {
    const space = build();
    expect(space.startPosition.x).toBeCloseTo(0);
    expect(space.startPosition.y).toBeCloseTo(1.6);
    expect(space.startPosition.z).toBeCloseTo(0.25);
    expect(space.startYaw).toBeCloseTo(0);
  });

  it("かご（cabin）は root の子で，扉・操作盤・ボタン・手すり・表示・照明・床壁天井はその子孫", () => {
    const space = build();
    const { root, parts } = space;
    expect(parts.cabin.parent).toBe(root);
    expect(parts.cabin.name).toBe("cabin");
    for (const g of allGroups(space)) expect(isDescendantOf(g, parts.cabin), g.name).toBe(true);
    const { surfaces } = parts;
    for (const m of [surfaces.floor, surfaces.ceiling, ...Object.values(surfaces.walls)]) {
      expect(isDescendantOf(m, parts.cabin)).toBe(true);
    }
  });

  it("乗り場（hall）と環境光は cabin の外（root 直下）", () => {
    const { root, parts } = build();
    expect(parts.hall.parent).toBe(root);
    expect(isDescendantOf(parts.hall, parts.cabin)).toBe(false);
    expect(parts.ambient.parent).toBe(root);
  });

  it("cabin を動かすとかごの中身が一緒に動き，乗り場は動かない", () => {
    const { root, parts } = build();
    root.updateMatrixWorld(true);
    const targets = [
      parts.doors[0],
      parts.buttons[0],
      parts.handrails[0],
      parts.indicator,
      parts.surfaces.floor,
    ];
    const before = targets.map(worldPos);
    const hallBefore = worldPos(parts.hall);
    parts.cabin.position.set(0.05, 1.2, -0.03);
    root.updateMatrixWorld(true);
    targets.forEach((g, i) => {
      const d = worldPos(g).sub(before[i]);
      expect(d.x).toBeCloseTo(0.05);
      expect(d.y).toBeCloseTo(1.2);
      expect(d.z).toBeCloseTo(-0.03);
    });
    expect(worldPos(parts.hall).distanceTo(hallBefore)).toBeCloseTo(0);
  });

  it("床・壁 4 面・天井は個別の Mesh", () => {
    const { surfaces } = build().parts;
    const meshes = [surfaces.floor, surfaces.ceiling, ...Object.values(surfaces.walls)];
    expect(meshes).toHaveLength(6);
    for (const m of meshes) expect(m).toBeInstanceOf(THREE.Mesh);
    expect(new Set(meshes).size).toBe(6);
  });

  it("床は y=0，天井は y=2.3，壁はかごを囲む", () => {
    const { root, parts } = build();
    root.updateMatrixWorld(true);
    const { surfaces } = parts;
    const box = (o: THREE.Object3D) => new THREE.Box3().setFromObject(o);
    expect(box(surfaces.floor).max.y).toBeCloseTo(0);
    expect(box(surfaces.ceiling).min.y).toBeCloseTo(CABIN.height);
    expect(box(surfaces.walls.front).max.z).toBeCloseTo(-CABIN.depth / 2);
    expect(box(surfaces.walls.rear).min.z).toBeCloseTo(CABIN.depth / 2);
    expect(box(surfaces.walls.right).min.x).toBeCloseTo(CABIN.width / 2);
    expect(box(surfaces.walls.left).max.x).toBeCloseTo(-CABIN.width / 2);
  });

  it("数: 扉 1・扉の板 2・操作盤 2・ボタン 16・手すり 3・照明 2，byId は 27 個", () => {
    const { parts } = build();
    expect(parts.doors).toHaveLength(1);
    expect(parts.doorLeaves).toHaveLength(2);
    expect(parts.panels).toHaveLength(CONTROL_PANELS.length);
    expect(parts.panels).toHaveLength(2);
    expect(parts.buttons).toHaveLength(16);
    expect(parts.buttons).toHaveLength(ELEVATOR_BUTTONS.length);
    expect(parts.handrails).toHaveLength(3);
    expect(parts.lights).toHaveLength(2);
    expect(parts.byId.size).toBe(27);
  });

  it("id（= name）は一意で，byId ですべて引ける", () => {
    const space = build();
    const groups = allGroups(space);
    const names = groups.map((g) => g.name);
    expect(names.every((n) => n.length > 0)).toBe(true);
    expect(new Set(names).size).toBe(names.length);
    for (const g of groups) expect(space.parts.byId.get(g.name)).toBe(g);
    expect(space.parts.byId.get(CABIN_DOOR_ID)).toBe(space.parts.doors[0]);
    expect(space.parts.byId.get(FLOOR_INDICATOR_ID)).toBe(space.parts.indicator);
  });

  it("dispose で root が Scene から外れる", () => {
    const space = build();
    const scene = new THREE.Scene();
    scene.add(space.root);
    space.dispose();
    expect(space.root.parent).toBeNull();
  });
});

describe("扉", () => {
  it("open=false・openAmount=0・locked=false，開口部 1.0m × 2.1m の 2 枚", () => {
    const { parts } = build();
    const door = parts.doors[0];
    const data = door.userData as ElevatorDoorUserData;
    expect(data.kind).toBe("elevatorDoor");
    expect(data.open).toBe(false);
    expect(data.openAmount).toBe(0);
    expect(data.locked).toBe(false);
    expect(data.openStyle).toBe("slide");
    expect(data.width).toBeCloseTo(1.0);
    expect(data.height).toBeCloseTo(2.1);
    expect(data.leafIds).toHaveLength(2);
    for (const leafId of data.leafIds) {
      const leaf = parts.byId.get(leafId);
      expect(leaf?.parent).toBe(door);
    }
  });

  it("扉は正面（-Z）の中央", () => {
    const { root, parts } = build();
    root.updateMatrixWorld(true);
    const p = worldPos(parts.doors[0]);
    expect(p.x).toBeCloseTo(0);
    expect(p.y).toBeCloseTo(0);
    expect(p.z).toBeCloseTo(-CABIN.depth / 2);
  });

  it("扉の板は openAmount=0 で閉じた位置にあり，閉じると開口部をふさぐ", () => {
    const { parts } = build();
    const spans = parts.doorLeaves
      .map((leaf) => {
        const data = leaf.userData as ElevatorDoorLeafUserData;
        expect(data.kind).toBe("doorLeaf");
        expect(data.doorId).toBe(CABIN_DOOR_ID);
        expect(data.openAmount).toBe(0);
        expect(leaf.position.x).toBeCloseTo(slidingLeafX(data, 0));
        return [leaf.position.x - data.size.x / 2, leaf.position.x + data.size.x / 2] as const;
      })
      .sort((a, b) => a[0] - b[0]);
    expect(spans[0][0]).toBeCloseTo(-0.5);
    expect(spans[0][1]).toBeCloseTo(spans[1][0]);
    expect(spans[1][1]).toBeCloseTo(0.5);
  });

  it("扉を slidingLeafX で全開位置へ動かすと開口部が全幅あく", () => {
    const { parts } = build();
    const width = (parts.doors[0].userData as ElevatorDoorUserData).width;
    for (const leaf of parts.doorLeaves) {
      const data = leaf.userData as ElevatorDoorLeafUserData;
      data.openAmount = 1;
      leaf.position.x = slidingLeafX(data, data.openAmount);
      const x0 = leaf.position.x - data.size.x / 2;
      const x1 = leaf.position.x + data.size.x / 2;
      expect(Math.min(x1, width / 2) - Math.max(x0, -width / 2)).toBeLessThanOrEqual(1e-9);
    }
  });

  it("三方枠は扉とは別の構造（扉の Group の外）", () => {
    const { parts } = build();
    const frame = parts.cabin.getObjectByName("door-frame");
    expect(frame).toBeDefined();
    if (!frame) return;
    expect(isDescendantOf(frame, parts.doors[0])).toBe(false);
    for (const leaf of parts.doorLeaves) expect(isDescendantOf(frame, leaf)).toBe(false);
  });

  it("locked を true にしても扉の構造は壊れない（E2 の閉じ込め用の状態欄）", () => {
    const { parts } = build();
    const data = parts.doors[0].userData as ElevatorDoorUserData;
    data.locked = true;
    const door = parts.byId.get(CABIN_DOOR_ID);
    expect((door?.userData as ElevatorDoorUserData | undefined)?.locked).toBe(true);
  });
});

describe("操作盤とボタン", () => {
  it("操作盤の userData は buttonIds で自分のボタン（子）を指す", () => {
    const { parts } = build();
    for (const panel of parts.panels) {
      const data = panel.userData as ControlPanelUserData;
      expect(data.kind).toBe("controlPanel");
      expect(["main", "sub"]).toContain(data.role);
      expect(data.buttonIds).toHaveLength(8);
      for (const id of data.buttonIds) {
        const button = parts.byId.get(id);
        expect(button?.parent).toBe(panel);
        expect((button?.userData as ElevatorButtonUserData | undefined)?.panelId).toBe(data.id);
      }
    }
  });

  it("ボタンは pressed=false・lit=false で，action・floor を持つ", () => {
    const { parts } = build();
    for (const b of parts.buttons) {
      const data = b.userData as ElevatorButtonUserData;
      expect(data.kind).toBe("elevatorButton");
      expect(data.id).toBe(b.name);
      expect(data.pressed).toBe(false);
      expect(data.lit).toBe(false);
      expect(["floor", "open", "close", "emergencyCall"]).toContain(data.action);
      if (data.action === "floor") expect(data.floor).toBeGreaterThanOrEqual(1);
      else expect(data.floor).toBeNull();
    }
  });

  it("両方の操作盤で同じ操作（action・floor）のボタンがそろう", () => {
    const { parts } = build();
    const opsOf = (panelId: string) =>
      parts.buttons
        .map((b) => b.userData as ElevatorButtonUserData)
        .filter((d) => d.panelId === panelId)
        .map((d) => `${d.action}:${d.floor}`)
        .sort();
    const [a, b] = parts.panels.map((p) => opsOf(p.name));
    expect(a).toEqual(b);
    expect(a).toHaveLength(8);
  });

  it("ボタンの位置（ワールド）は定義の position と一致し，0.9〜1.4m の高さにある", () => {
    const { root, parts } = build();
    root.updateMatrixWorld(true);
    for (const b of parts.buttons) {
      const def = ELEVATOR_BUTTONS.find((d) => d.id === b.name);
      expect(def).toBeDefined();
      if (!def) continue;
      const p = worldPos(b);
      expect(p.distanceTo(new THREE.Vector3(...def.position))).toBeLessThan(0.03);
      expect(p.y).toBeGreaterThanOrEqual(0.9);
      expect(p.y).toBeLessThanOrEqual(1.4);
    }
  });

  it("setElevatorButtonLit で lit と面のマテリアルが切り替わる", () => {
    const { parts } = build();
    const button = parts.buttons[0];
    const data = button.userData as ElevatorButtonUserData;
    const face = button.getObjectByName(data.faceName) as THREE.Mesh;
    expect(face).toBeInstanceOf(THREE.Mesh);
    expect(face.material).toBe(parts.buttonMaterials.buttonFace);
    setElevatorButtonLit(button, true, parts.buttonMaterials);
    expect(data.lit).toBe(true);
    expect(face.material).toBe(parts.buttonMaterials.buttonLit);
    setElevatorButtonLit(button, false, parts.buttonMaterials);
    expect(data.lit).toBe(false);
    expect(face.material).toBe(parts.buttonMaterials.buttonFace);
    // 他のボタンは変わらない
    const other = parts.buttons[1].userData as ElevatorButtonUserData;
    expect(other.lit).toBe(false);
  });
});

describe("手すり", () => {
  it("奥・左右の 3 本で grabbed=false，高さ 0.85m 程度", () => {
    const { root, parts } = build();
    root.updateMatrixWorld(true);
    const walls = parts.handrails.map((h) => (h.userData as ElevatorHandrailUserData).wall).sort();
    expect(walls).toEqual(["left", "rear", "right"]);
    for (const h of parts.handrails) {
      const data = h.userData as ElevatorHandrailUserData;
      expect(data.grabbed).toBe(false);
      expect(data.id).toBe(h.name);
      expect(worldPos(h).y).toBeCloseTo(0.85, 2);
    }
  });
});

describe("階の表示", () => {
  it("扉の上にあり，currentFloor・direction を持つ", () => {
    const { root, parts } = build();
    root.updateMatrixWorld(true);
    const p = worldPos(parts.indicator);
    expect(p.y).toBeGreaterThan(2.1);
    expect(p.y).toBeLessThan(CABIN.height);
    expect(p.x).toBeCloseTo(0);
    expect(p.z).toBeCloseTo(-CABIN.depth / 2, 1);
    const data = parts.indicator.userData as FloorIndicatorUserData;
    expect(data.kind).toBe("floorIndicator");
    expect(typeof data.currentFloor).toBe("number");
    expect(["up", "down", "none"]).toContain(data.direction);
  });

  it("setFloorIndicator で currentFloor・direction が変わり，テクスチャが描き直される", () => {
    const { parts } = build();
    const data = parts.indicator.userData as FloorIndicatorUserData;
    const screen = parts.indicator.getObjectByName(data.screenName) as THREE.Mesh;
    const map = (screen.material as THREE.MeshBasicMaterial).map;
    expect(map).toBeTruthy();
    const version = map?.version ?? 0;
    setFloorIndicator(parts.indicator, 4, "up");
    expect(data.currentFloor).toBe(4);
    expect(data.direction).toBe("up");
    expect(map?.version ?? 0).toBeGreaterThan(version);
    setFloorIndicator(parts.indicator, 0, "down");
    expect(data.currentFloor).toBe(0);
    expect(data.direction).toBe("down");
    setFloorIndicator(parts.indicator, 3, "none");
    expect(data.direction).toBe("none");
  });
});

describe("照明", () => {
  it("天井の照明は on=true（光源が点灯），非常灯は on=false（光源の強さ 0）", () => {
    const { parts } = build();
    const byKind = (kind: CabinLightUserData["kind"]) =>
      parts.lights.find((l) => (l.userData as CabinLightUserData).kind === kind);
    const ceiling = byKind("ceilingLight");
    const emergency = byKind("emergencyLight");
    expect(ceiling).toBeDefined();
    expect(emergency).toBeDefined();
    if (!ceiling || !emergency) return;
    const c = ceiling.userData as CabinLightUserData;
    const e = emergency.userData as CabinLightUserData;
    expect(c.on).toBe(true);
    expect(c.emergency).toBe(false);
    expect(e.on).toBe(false);
    expect(e.emergency).toBe(true);
    const cLight = ceiling.getObjectByName(c.lightName) as THREE.PointLight;
    const eLight = emergency.getObjectByName(e.lightName) as THREE.PointLight;
    expect(cLight).toBeInstanceOf(THREE.PointLight);
    expect(eLight).toBeInstanceOf(THREE.PointLight);
    expect(cLight.intensity).toBeGreaterThan(0);
    expect(eLight.intensity).toBe(0);
  });

  it("照明は天井の高さにある", () => {
    const { root, parts } = build();
    root.updateMatrixWorld(true);
    for (const l of parts.lights) expect(worldPos(l).y).toBeCloseTo(CABIN.height);
  });
});
