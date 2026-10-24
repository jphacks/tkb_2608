// 確認用の空間（?scene=school-parts．schoolPartsPreview.ts・schoolPartsWalk.ts）のテスト．構造と歩行を確かめる．
// 基準は Issue #73（全パーツを見られる・シャッターの開・閉を切り替えられる・ジオメトリの結合）と引継ぎメモ
// （動く物は結合から外す・外側だけの教室のドアは開かない）．canvas は何もしない物に差し替える

import * as THREE from "three";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { createDevDoors } from "../devDoors";
import { createSpace, createWalkWorld } from "../index";
import { DEFAULT_BODY, moveWithCollision, onFloor } from "../walk/collision";
import { activeObstacles, type WalkWorld } from "../walk/locomotion";
import type { FireShutterUserData, SchoolDoorUserData, SchoolEdgeUserData } from "./schoolLayout";
import { isDynamicSchoolObject, setFireShutterClosed, setSchoolDoorOpen } from "./schoolParts";
import {
  createSchoolPartsScene,
  isSchoolPartsSpace,
  type SchoolPartsSpace,
} from "./schoolPartsPreview";
import {
  PREVIEW_EYE_HEIGHT,
  PREVIEW_GROUND,
  PREVIEW_START,
  previewParts,
} from "./schoolPartsPreviewLayout";

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

let space: SchoolPartsSpace;

function build(): SchoolPartsSpace {
  space = createSchoolPartsScene({ maxAnisotropy: 1 });
  space.root.updateMatrixWorld(true);
  return space;
}

afterEach(() => {
  space?.dispose();
});

function part(s: SchoolPartsSpace, id: string): THREE.Group {
  const g = s.parts.byId.get(id);
  if (!g) throw new Error(`パーツがない: ${id}`);
  return g;
}

const HEAD = PREVIEW_EYE_HEIGHT.standing + DEFAULT_BODY.headClearance;

function walk(w: WalkWorld, from: { x: number; z: number }, to: { x: number; z: number }) {
  return moveWithCollision(
    from.x,
    from.z,
    to.x - from.x,
    to.z - from.z,
    HEAD,
    activeObstacles(w),
    w.floors,
    DEFAULT_BODY,
  );
}

function reached(end: { x: number; z: number }, to: { x: number; z: number }): boolean {
  return Math.hypot(end.x - to.x, end.z - to.z) < 0.05;
}

/** 辺の Group のローカル座標の点を root の座標へ */
function edgePoint(group: THREE.Object3D, x: number, z: number) {
  const p = new THREE.Vector3(x, 0, z).applyMatrix4(group.matrixWorld);
  return { x: p.x, z: p.z };
}

describe("createSchoolPartsScene", () => {
  it("id・背景・開始位置（目の高さ・向き）を持ち，isSchoolPartsSpace で判定できる", () => {
    const s = build();
    expect(s.id).toBe("school-parts");
    expect(isSchoolPartsSpace(s)).toBe(true);
    expect(s.startPosition.toArray()).toEqual([
      PREVIEW_START.x,
      PREVIEW_EYE_HEIGHT.standing,
      PREVIEW_START.z,
    ]);
    expect(s.startYaw).toBe(PREVIEW_START.yaw);
  });

  it("一覧のパーツをすべて 1 つずつ Group として持ち，id で引ける（userData も残る）", () => {
    const s = build();
    const list = previewParts();
    expect(s.parts.byId.size).toBe(list.length);
    for (const p of list) {
      const g = part(s, p.id);
      expect(g.parent).toBe(s.parts.parts);
      expect((g.userData as { id?: string }).id).toBe(p.id);
      expect(g.position.x).toBeCloseTo(p.placement.x);
      expect(g.position.z).toBeCloseTo(p.placement.z);
      expect(g.rotation.y).toBeCloseTo(p.placement.rotationY);
    }
  });

  it("ドアは 8 か所（教室ごとに前後 2 つ．うち外側だけの教室の開かないドアは 4），防火シャッターは 2 か所（閉 1・開 1）", () => {
    const s = build();
    expect(s.parts.doors).toHaveLength(8);
    const locked = s.parts.doors.filter((d) => (d.userData as SchoolDoorUserData).locked);
    expect(locked).toHaveLength(4);
    expect(s.parts.shutters).toHaveLength(2);
    expect(s.parts.shutters.map((g) => (g.userData as FireShutterUserData).closed).sort()).toEqual([
      false,
      true,
    ]);
    for (const d of s.parts.doors) {
      expect((d.userData as SchoolEdgeUserData).edgeKind).toBe("door");
    }
  });

  it("動かない Mesh はマテリアルごとに結合し，元より少ない Mesh になる", () => {
    const s = build();
    expect(s.parts.mergeStats.createdMeshes).toBeGreaterThan(0);
    expect(s.parts.mergeStats.mergedMeshes).toBeGreaterThan(s.parts.mergeStats.createdMeshes);
    const merged = s.parts.parts.children.filter((o) => o.name.startsWith("merged-"));
    expect(merged).toHaveLength(s.parts.mergeStats.createdMeshes);
  });

  it("結合の後も動く物（扉・シャッターの幕・座板）は Mesh を持ったまま元のパーツの下に残る", () => {
    const s = build();
    const hasMesh = (o: THREE.Object3D) => {
      let found = false;
      o.traverse((c) => {
        if (c instanceof THREE.Mesh) found = true;
      });
      return found;
    };
    for (const d of s.parts.doors) {
      const leaf = d.getObjectByName((d.userData as SchoolDoorUserData).leafName);
      if (!leaf) throw new Error("扉がない");
      expect(isDynamicSchoolObject(leaf)).toBe(true);
      expect(hasMesh(leaf)).toBe(true);
    }
    for (const sh of s.parts.shutters) {
      const data = sh.userData as FireShutterUserData;
      const curtain = sh.getObjectByName(data.curtainName);
      const bar = sh.getObjectByName(data.openBarName);
      if (!curtain || !bar) throw new Error("シャッターの部品がない");
      expect(hasMesh(curtain)).toBe(true);
      expect(bar).toBeInstanceOf(THREE.Mesh);
    }
  });

  it("結合した Mesh は動く物を含まない（パーツの下に残る静的な Mesh は動く物の中か InstancedMesh か，一つだけのマテリアルの物）", () => {
    const s = build();
    const remaining: THREE.Mesh[] = [];
    for (const g of s.parts.byId.values()) {
      g.traverse((o) => {
        if (!(o instanceof THREE.Mesh) || o instanceof THREE.InstancedMesh) return;
        for (let p: THREE.Object3D | null = o; p && p !== g; p = p.parent) {
          if (isDynamicSchoolObject(p)) return;
        }
        remaining.push(o);
      });
    }
    // 結合されずに残った静的な Mesh は，同じマテリアルの静的な Mesh が他に無い物だけ
    const byMaterial = new Map<THREE.Material, number>();
    for (const m of remaining) {
      const mat = m.material as THREE.Material;
      byMaterial.set(mat, (byMaterial.get(mat) ?? 0) + 1);
    }
    for (const count of byMaterial.values()) expect(count).toBe(1);
  });

  it("結合の後も扉の開閉・シャッターの開・閉ができる", () => {
    const s = build();
    const door = s.parts.doors.find((d) => !(d.userData as SchoolDoorUserData).locked);
    if (!door) throw new Error("開くドアがない");
    const data = door.userData as SchoolDoorUserData;
    const leaf = door.getObjectByName(data.leafName);
    const before = leaf?.position.x ?? Number.NaN;
    expect(setSchoolDoorOpen(door, true)).toBe(true);
    expect(leaf?.position.x).not.toBeCloseTo(before);
    const shutter = s.parts.shutters[0];
    if (!shutter) throw new Error("シャッターがない");
    const sd = shutter.userData as FireShutterUserData;
    setFireShutterClosed(shutter, !sd.closed);
    expect(shutter.getObjectByName(sd.curtainName)?.visible).toBe(sd.closed);
  });

  it("dispose でジオメトリを解放する", () => {
    const s = build();
    const geometries: THREE.BufferGeometry[] = [];
    s.root.traverse((o) => {
      if (o instanceof THREE.Mesh) geometries.push(o.geometry);
    });
    const spies = geometries.slice(0, 5).map((g) => vi.spyOn(g, "dispose"));
    s.dispose();
    for (const spy of spies) expect(spy).toHaveBeenCalled();
    space = createSchoolPartsScene({ maxAnisotropy: 1 });
  });

  it('createSpace("school-parts") でも作れる', () => {
    space = createSpace("school-parts", { maxAnisotropy: 1 }) as SchoolPartsSpace;
    expect(isSchoolPartsSpace(space)).toBe(true);
  });
});

describe("確認用の空間の歩行", () => {
  function setup() {
    const s = build();
    const w = createWalkWorld(s);
    return { s, w };
  }

  it("床は外の地面とパーツの床・出口の外で，開始位置は床の上で何にも重ならない", () => {
    const { w } = setup();
    expect(w.floors).toContainEqual(PREVIEW_GROUND);
    expect(onFloor(w.floors, PREVIEW_START.x, PREVIEW_START.z)).toBe(true);
    const end = walk(w, PREVIEW_START, PREVIEW_START);
    expect(end).toEqual({ x: PREVIEW_START.x, z: PREVIEW_START.z });
    expect(w.eyeHeights).toEqual(PREVIEW_EYE_HEIGHT);
    expect(w.areas.some((a) => a.id === "a-exit-outside")).toBe(true);
    expect(w.areas.some((a) => a.id === "b-exit-outside")).toBe(true);
  });

  it.each(["a", "b"])("棟 %s: 外から出口を通って廊下へ入れる", (block) => {
    const { s, w } = setup();
    const exit = part(s, `${block}-exit`);
    const outside = edgePoint(exit, 0, -1);
    const inside = edgePoint(exit, 0, 1);
    expect(reached(walk(w, outside, inside), inside)).toBe(true);
    expect(reached(walk(w, inside, outside), outside)).toBe(true);
  });

  it("外から窓付きの壁は通れない", () => {
    const { s, w } = setup();
    const wall = part(s, "a-south-1");
    const outside = edgePoint(wall, 0, -1);
    const inside = edgePoint(wall, 0, 1);
    expect(reached(walk(w, outside, inside), inside)).toBe(false);
  });

  it("閉じたシャッター（棟 a）は廊下を通れず，開けると通れる．開いたシャッター（棟 b）は通れる", () => {
    const { s, w } = setup();
    const a = part(s, "a-shutter");
    const from = edgePoint(a, 0, 1);
    const to = edgePoint(a, 0, -1);
    expect(reached(walk(w, from, to), to)).toBe(false);
    setFireShutterClosed(a, false);
    expect(reached(walk(w, from, to), to)).toBe(true);
    const b = part(s, "b-shutter");
    expect(reached(walk(w, edgePoint(b, 0, 1), edgePoint(b, 0, -1)), edgePoint(b, 0, -1))).toBe(
      true,
    );
  });

  it("開かないドア（外側だけの教室）は通れず，開くドアは開けると教室へ入れる", () => {
    const { s, w } = setup();
    const doorCenter = (g: THREE.Group, z: number) => {
      const leaf = g.getObjectByName((g.userData as SchoolDoorUserData).leafName);
      if (!leaf) throw new Error("扉がない");
      const closedX = (leaf.userData as { closedX: number }).closedX;
      return edgePoint(g, closedX, z);
    };
    // 棟 a の長方形の教室は外側だけ
    const locked = part(s, "a-rect-door-back");
    expect((locked.userData as SchoolDoorUserData).locked).toBe(true);
    setSchoolDoorOpen(locked, true);
    const lockedTo = doorCenter(locked, -0.5);
    expect(reached(walk(w, doorCenter(locked, 1), lockedTo), lockedTo)).toBe(false);
    // 棟 a の正方形の教室は中身あり
    const open = part(s, "a-square-door-back");
    const to = doorCenter(open, -0.5);
    expect(reached(walk(w, doorCenter(open, 1), to), to)).toBe(false);
    setSchoolDoorOpen(open, true);
    expect(reached(walk(w, doorCenter(open, 1), to), to)).toBe(true);
  });

  it("確認用のドアの一覧は開かないドアを除いたドア 4 つとシャッター 2 つ", () => {
    const { s } = setup();
    const doors = createDevDoors(s);
    expect(doors).toHaveLength(6);
    const ids = doors.map((d) => d.id);
    for (const g of s.parts.doors) {
      const data = g.userData as SchoolDoorUserData;
      expect(ids.includes(data.id)).toBe(!data.locked);
    }
    const shutter = doors.find((d) => d.id === "a-shutter");
    expect(shutter?.isOpen()).toBe(false);
    shutter?.setOpen(true);
    expect((part(s, "a-shutter").userData as FireShutterUserData).closed).toBe(false);
  });
});
