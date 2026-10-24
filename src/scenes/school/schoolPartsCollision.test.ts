// パーツからの当たり判定の取り出し（schoolPartsCollision.ts）のテスト．基準は Issue #73（壁・閉じたシャッター等の
// 通れない範囲を既存の当たり判定（walk/）で使える形で取れる）と引継ぎメモ（外側だけの教室のドアは locked で
// 当たり判定でも通れない）．体を実際に動かして（moveWithCollision）通れる・通れないを確かめる

import * as THREE from "three";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { DEFAULT_BODY, moveWithCollision, type XZRect } from "../walk/collision";
import { activeObstacles, type WalkWorld } from "../walk/locomotion";
import { createClassroom } from "./classroom";
import { classroomLayout } from "./classroomLayout";
import { edgePlacementBetween, POST_SIZE, type XZPoint } from "./schoolLayout";
import {
  createFloorSurface,
  createSchoolEdge,
  createSchoolPartContext,
  createSchoolPost,
  disposeSchoolPartContext,
  type EdgeBuildOptions,
  type SchoolPartContext,
  setFireShutterClosed,
  setSchoolDoorOpen,
} from "./schoolParts";
import { collectSchoolCollision } from "./schoolPartsCollision";

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

let context: SchoolPartContext;

beforeAll(() => {
  vi.stubGlobal("document", {
    createElement: (tag: string) => {
      if (tag !== "canvas") throw new Error(`unexpected element: ${tag}`);
      const ctx = fakeContext();
      return { width: 0, height: 0, getContext: () => ctx };
    },
  });
  context = createSchoolPartContext(1);
});

afterAll(() => {
  disposeSchoolPartContext(context);
  vi.unstubAllGlobals();
});

const STANDING_HEAD = 1.6 + DEFAULT_BODY.headClearance;
/** 辺の両側に広く取った床（辺の物だけを確かめるため，床の外へ出る動きで止まらないようにする） */
const WIDE_FLOOR: XZRect = { minX: -10, maxX: 10, minZ: -10, maxZ: 10 };

/** 東西に伸びる辺（(-L/2, 0) → (L/2, 0)．ローカル +Z = ワールド +Z）を 1 つ置いた root */
function sceneWithEdge(options: Partial<EdgeBuildOptions> & Pick<EdgeBuildOptions, "kind">) {
  const root = new THREE.Group();
  const edge = createSchoolEdge(context, { length: 4, height: 3, id: "e", ...options });
  root.add(edge);
  return { root, edge, collision: collectSchoolCollision(root) };
}

function world(collision: ReturnType<typeof collectSchoolCollision>): WalkWorld {
  return {
    floors: [WIDE_FLOOR, ...collision.floors],
    obstacles: collision.obstacles,
    doors: collision.doors,
    areas: collision.areas,
    eyeHeights: { standing: 1.6, crouching: 0.9 },
    seats: [],
  };
}

/** from から to へまっすぐ歩き，着いた位置を返す */
function walk(w: WalkWorld, from: XZPoint, to: XZPoint): XZPoint {
  return moveWithCollision(
    from.x,
    from.z,
    to.x - from.x,
    to.z - from.z,
    STANDING_HEAD,
    activeObstacles(w),
    w.floors,
    DEFAULT_BODY,
  );
}

function crosses(w: WalkWorld, x: number, fromZ = 1, toZ = -1): boolean {
  const end = walk(w, { x, z: fromZ }, { x, z: toZ });
  return Math.sign(end.z) === Math.sign(toZ) && Math.abs(end.z - toZ) < 0.05;
}

describe("collectSchoolCollision の辺の物", () => {
  it("無地の壁は通れない", () => {
    const { collision } = sceneWithEdge({ kind: "wall" });
    expect(collision.doors).toEqual([]);
    for (const x of [-1.5, 0, 1.5]) expect(crosses(world(collision), x)).toBe(false);
  });

  it("窓付きの壁は窓の所でも通れない", () => {
    const { collision } = sceneWithEdge({ kind: "windowWall" });
    for (const x of [-1, 0, 1]) expect(crosses(world(collision), x)).toBe(false);
  });

  it("閉じたドアは通れず，開けると開口部を通れる（開閉は後から反映される）", () => {
    const { edge, collision } = sceneWithEdge({ kind: "door" });
    expect(collision.doors.map((d) => d.id)).toEqual(["e"]);
    const w = world(collision);
    const doorway = collision.doors[0]?.obstacle;
    if (!doorway) throw new Error("ドアの範囲がない");
    const x = (doorway.minX + doorway.maxX) / 2;
    expect(crosses(w, x)).toBe(false);
    setSchoolDoorOpen(edge, true);
    expect(crosses(w, x)).toBe(true);
    expect(crosses(w, x, -1, 1)).toBe(true);
    // 開口部の外（壁の板）は開いていても通れない
    expect(crosses(w, 1.7)).toBe(false);
    setSchoolDoorOpen(edge, false);
    expect(crosses(w, x)).toBe(false);
  });

  it("開けた状態で作ったドアは通れる", () => {
    const { collision } = sceneWithEdge({ kind: "door", open: true });
    const doorway = collision.doors[0]?.obstacle;
    if (!doorway) throw new Error("ドアの範囲がない");
    expect(crosses(world(collision), (doorway.minX + doorway.maxX) / 2)).toBe(true);
  });

  it("locked のドアは開けようとしても通れない", () => {
    const { edge, collision } = sceneWithEdge({ kind: "door", locked: true, open: true });
    const doorway = collision.doors[0]?.obstacle;
    if (!doorway) throw new Error("ドアの範囲がない");
    const x = (doorway.minX + doorway.maxX) / 2;
    expect(crosses(world(collision), x)).toBe(false);
    setSchoolDoorOpen(edge, true);
    expect(crosses(world(collision), x)).toBe(false);
  });

  it("出口は開口部を通れ，内（+Z）から外（-Z）へ出ると外のエリアに入る", () => {
    const { collision } = sceneWithEdge({ kind: "exit" });
    expect(collision.doors).toEqual([]);
    expect(crosses(world(collision), 0, 1, -1)).toBe(true);
    expect(crosses(world(collision), 0, -1, 1)).toBe(true);
    const outside = collision.areas.find((a) => a.id === "e-outside");
    if (!outside) throw new Error("外のエリアがない");
    expect(outside.maxZ).toBeLessThanOrEqual(0);
    expect(outside.minX).toBeLessThanOrEqual(-1);
    expect(outside.maxX).toBeGreaterThanOrEqual(1);
    expect(collision.floors).toContainEqual({
      minX: outside.minX,
      maxX: outside.maxX,
      minZ: outside.minZ,
      maxZ: outside.maxZ,
    });
  });

  it("出口の外のポーチだけを床にしても，内から外へ出られる", () => {
    const { collision } = sceneWithEdge({ kind: "exit" });
    const inside: XZRect = { minX: -2, maxX: 2, minZ: 0, maxZ: 3 };
    const w: WalkWorld = { ...world(collision), floors: [inside, ...collision.floors] };
    const end = walk(w, { x: 0, z: 1 }, { x: 0, z: -1 });
    expect(end.z).toBeCloseTo(-1);
  });

  it("閉じた防火シャッターは通れず，開けると通れる", () => {
    const { edge, collision } = sceneWithEdge({ kind: "fireShutter", closed: true });
    expect(collision.doors.map((d) => d.id)).toEqual(["e"]);
    const w = world(collision);
    for (const x of [-1, 0, 1]) expect(crosses(w, x)).toBe(false);
    setFireShutterClosed(edge, false);
    for (const x of [-1, 0, 1]) expect(crosses(w, x)).toBe(true);
    setFireShutterClosed(edge, true);
    expect(crosses(w, 0)).toBe(false);
  });

  it("開いたシャッターでも両端のガイドレールは残る", () => {
    const { collision } = sceneWithEdge({ kind: "fireShutter" });
    expect(collision.obstacles.map((o) => o.id).sort()).toEqual(["e-rail-0", "e-rail-1"]);
  });

  it("しゃがんでも閉じたシャッターの下はくぐれない（幕は床まで）", () => {
    const { collision } = sceneWithEdge({ kind: "fireShutter", closed: true });
    const w = world(collision);
    const end = moveWithCollision(
      0,
      1,
      0,
      -2,
      0.9 + DEFAULT_BODY.headClearance,
      activeObstacles(w),
      w.floors,
      DEFAULT_BODY,
    );
    expect(end.z).toBeGreaterThan(0);
  });
});

describe("collectSchoolCollision の置き方", () => {
  it("回して置いた辺（北へ進む辺．ローカル +Z が東）の当たり判定も置いた先の向きになる", () => {
    const root = new THREE.Group();
    const { placement, length } = edgePlacementBetween({ x: 0, z: 2 }, { x: 0, z: -2 });
    const edge = createSchoolEdge(context, { kind: "wall", length, height: 3, id: "w" });
    edge.position.set(placement.x, 0, placement.z);
    edge.rotation.y = placement.rotationY;
    root.add(edge);
    const [o] = collectSchoolCollision(root).obstacles;
    if (!o) throw new Error("壁がない");
    expect(o.minX).toBeCloseTo(-0.06);
    expect(o.maxX).toBeCloseTo(0.06);
    expect(o.minZ).toBeCloseTo(-2 + POST_SIZE / 2);
    expect(o.maxZ).toBeCloseTo(2 - POST_SIZE / 2);
  });

  it("root の配下の入れ子の Group の位置も足し，root 自身の位置・回転は root の座標として除く", () => {
    const root = new THREE.Group();
    root.position.set(50, 0, -20);
    root.rotation.y = Math.PI / 2;
    const inner = new THREE.Group();
    inner.position.set(10, 0, 0);
    const floor = createFloorSurface(context, {
      kind: "corridor",
      width: 4,
      depth: 2,
      ceilingHeight: 3,
      id: "f",
    });
    floor.position.set(1, 0, 2);
    inner.add(floor);
    root.add(inner);
    const { floors, areas } = collectSchoolCollision(root);
    expect(floors).toHaveLength(1);
    const [f] = floors;
    expect(f?.minX).toBeCloseTo(9);
    expect(f?.maxX).toBeCloseTo(13);
    expect(f?.minZ).toBeCloseTo(1);
    expect(f?.maxZ).toBeCloseTo(3);
    expect(areas).toEqual([{ id: "f", ...f }]);
  });

  it("柱は端点を中心にした障害物になる", () => {
    const root = new THREE.Group();
    const post = createSchoolPost(context, { height: 3, id: "p" });
    post.position.set(4, 0, -4);
    root.add(post);
    expect(collectSchoolCollision(root).obstacles).toEqual([
      {
        id: "p",
        minX: 4 - POST_SIZE / 2,
        maxX: 4 + POST_SIZE / 2,
        minZ: -4 - POST_SIZE / 2,
        maxZ: -4 + POST_SIZE / 2,
        minY: 0,
        maxY: 3,
      },
    ]);
  });

  it("壁と柱を並べると，角の柱と壁の板の間に体が通れる隙間が無い", () => {
    const root = new THREE.Group();
    const corners: XZPoint[] = [
      { x: 0, z: 0 },
      { x: 4, z: 0 },
      { x: 4, z: -4 },
    ];
    for (const [i, [a, b]] of [
      [corners[0], corners[1]],
      [corners[1], corners[2]],
    ].entries()) {
      if (!a || !b) throw new Error("unreachable");
      const { placement, length } = edgePlacementBetween(a, b);
      const e = createSchoolEdge(context, { kind: "wall", length, height: 3, id: `w${i}` });
      e.position.set(placement.x, 0, placement.z);
      e.rotation.y = placement.rotationY;
      root.add(e);
    }
    for (const [i, c] of corners.entries()) {
      const p = createSchoolPost(context, { height: 3, id: `p${i}` });
      p.position.set(c.x, 0, c.z);
      root.add(p);
    }
    const w = world(collectSchoolCollision(root));
    // 角の柱の外から斜めに内側へ抜けようとしても抜けられない
    const end = walk(w, { x: 4.5, z: 0.5 }, { x: 3.5, z: -0.5 });
    expect(end.x > 4 || end.z > 0).toBe(true);
  });
});

describe("collectSchoolCollision の教室", () => {
  it("中身ありの教室は机・椅子・教卓・黒板を障害物にし，床の面をエリアにする", () => {
    const root = new THREE.Group();
    const room = createClassroom(context, { width: 8, depth: 8, ceilingHeight: 3, id: "r" });
    room.position.set(4, 0, -4);
    root.add(room);
    const collision = collectSchoolCollision(root);
    expect(collision.obstacles).toHaveLength(classroomLayout(8, 8).desks.length * 2 + 2);
    expect(collision.obstacles.every((o) => o.id.startsWith("r-"))).toBe(true);
    expect(collision.floors).toHaveLength(1);
    expect(collision.floors[0]).toEqual({ minX: 0, maxX: 8, minZ: -8, maxZ: 0 });
    expect(collision.areas.map((a) => a.id)).toEqual(["r-surface"]);
  });

  it("外側だけの教室は障害物を持たない（床だけ）", () => {
    const root = new THREE.Group();
    root.add(
      createClassroom(context, {
        width: 8,
        depth: 8,
        ceilingHeight: 3,
        id: "s",
        interior: "shell",
      }),
    );
    const collision = collectSchoolCollision(root);
    expect(collision.obstacles).toEqual([]);
    expect(collision.floors).toHaveLength(1);
  });
});
