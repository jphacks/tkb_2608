// SchoolPlan から組み立てた校舎の空間（?scene=school．schoolPlanScene.ts・schoolPlanWalk.ts）のテスト．
// 基準は Issue #92 の完了条件（デモの校舎の 1 フロアが組み上がる・壁・wall のマス・閉じたシャッターを通り抜けずに歩ける）．
// canvas は何もしない物に差し替える

import type * as THREE from "three";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { DEMO_SCHOOL } from "../../share/samples/demoSchool";
import { createSpace, createWalkWorld } from "../index";
import { circleOverlapsRect, DEFAULT_BODY, moveWithCollision, onFloor } from "../walk/collision";
import { activeObstacles, type WalkWorld } from "../walk/locomotion";
import type {
  FireShutterUserData,
  SchoolBlockUserData,
  SchoolEdgeUserData,
  SchoolPostUserData,
} from "./schoolLayout";
import { setFireShutterClosed } from "./schoolParts";
import { SCHOOL_EYE_HEIGHT } from "./schoolPlanLayout";
import { createSchoolScene, isSchoolSpace, type SchoolSpace } from "./schoolPlanScene";

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

let space: SchoolSpace | undefined;

function build(options: { shuttersClosed?: boolean } = {}): SchoolSpace {
  space = createSchoolScene({ maxAnisotropy: 1 }, DEMO_SCHOOL, options);
  return space;
}

afterEach(() => {
  space?.dispose();
  space = undefined;
});

const HEAD = SCHOOL_EYE_HEIGHT.standing + DEFAULT_BODY.headClearance;

/** マス (x, z) の中心 */
const center = (x: number, z: number) => ({ x: x + 0.5, z: z + 0.5 });

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

function partsOfKind(s: SchoolSpace, kind: string): THREE.Group[] {
  return [...s.parts.byId.values()].filter((g) => (g.userData as { kind?: unknown }).kind === kind);
}

describe("createSchoolScene", () => {
  it("id・開始位置（開始地点のマスの中心・目の高さ）・向きを持ち，isSchoolSpace で判定できる", () => {
    const s = build();
    expect(s.id).toBe("school");
    expect(isSchoolSpace(s)).toBe(true);
    expect(s.startPosition.toArray()).toEqual([2.5, SCHOOL_EYE_HEIGHT.standing, 2.5]);
    expect(s.startYaw).toBe(0);
    expect(s.plan).toBe(DEMO_SCHOOL);
  });

  it("並べ方（layout）の床の面・壁・柱・直方体・シャッターを 1 つずつ Group として持つ", () => {
    const s = build();
    const { layout } = s;
    expect(partsOfKind(s, "schoolFloor")).toHaveLength(layout.floors.length);
    expect(partsOfKind(s, "schoolEdge")).toHaveLength(layout.walls.length + layout.shutters.length);
    expect(partsOfKind(s, "schoolPost")).toHaveLength(layout.posts.length);
    expect(partsOfKind(s, "schoolBlock")).toHaveLength(layout.blocks.length);
    expect(partsOfKind(s, "schoolLintel")).toHaveLength(layout.lintels.length);
    for (const w of layout.walls) {
      const data = s.parts.byId.get(w.id)?.userData as SchoolEdgeUserData | undefined;
      expect(data?.edgeKind).toBe(w.kind);
      expect(data?.length).toBeCloseTo(Math.hypot(w.to.x - w.from.x, w.to.z - w.from.z));
      expect(data?.height).toBe(layout.ceilingHeight);
    }
  });

  it("壁は 2 点の中点に置き，辺の向きに回す（X に沿う壁は回さない・Z に沿う壁は 90°）", () => {
    const s = build();
    for (const w of s.layout.walls) {
      const g = s.parts.byId.get(w.id);
      expect(g?.position.x).toBeCloseTo((w.from.x + w.to.x) / 2);
      expect(g?.position.z).toBeCloseTo((w.from.z + w.to.z) / 2);
      const alongX = w.from.z === w.to.z;
      expect(Math.abs(Math.cos(g?.rotation.y ?? Number.NaN))).toBeCloseTo(alongX ? 1 : 0);
    }
  });

  it("wall のマスの直方体はマスの範囲と天井の高さの大きさ", () => {
    const s = build();
    for (const b of s.layout.blocks) {
      const g = s.parts.byId.get(b.id);
      const data = g?.userData as SchoolBlockUserData | undefined;
      expect(data?.width).toBe(b.rect.maxX - b.rect.minX);
      expect(data?.depth).toBe(b.rect.maxZ - b.rect.minZ);
      expect(data?.height).toBe(3);
      expect(g?.position.x).toBe((b.rect.minX + b.rect.maxX) / 2);
      expect(g?.position.z).toBe((b.rect.minZ + b.rect.maxZ) / 2);
    }
  });

  it("柱は格子点に置き，高さは天井まで", () => {
    const s = build();
    for (const p of s.layout.posts) {
      const g = s.parts.byId.get(p.id);
      expect(g?.position.x).toBe(p.x);
      expect(g?.position.z).toBe(p.z);
      expect((g?.userData as SchoolPostUserData | undefined)?.height).toBe(3);
    }
  });

  it("防火シャッターは既定で閉じて作る．shuttersClosed: false なら開けて作る", () => {
    const closed = build();
    expect(closed.parts.shutters).toHaveLength(1);
    expect((closed.parts.shutters[0]?.userData as FireShutterUserData | undefined)?.closed).toBe(
      true,
    );
    closed.dispose();
    const open = build({ shuttersClosed: false });
    expect((open.parts.shutters[0]?.userData as FireShutterUserData | undefined)?.closed).toBe(
      false,
    );
  });

  it("動かない Mesh はマテリアルごとに結合し，元より少ない Mesh になる", () => {
    const s = build();
    expect(s.parts.mergeStats.mergedMeshes).toBeGreaterThan(s.parts.mergeStats.createdMeshes);
  });

  it("屋外のマスには天井を張らない（屋内の床の面は屋外と重ならない）", () => {
    const s = build();
    for (const f of s.layout.floors) {
      for (const o of s.layout.outdoor) {
        const overlaps =
          f.rect.minX < o.maxX &&
          o.minX < f.rect.maxX &&
          f.rect.minZ < o.maxZ &&
          o.minZ < f.rect.maxZ;
        expect(overlaps).toBe(false);
      }
    }
  });

  it('createSpace("school") でも作れ，dispose できる', () => {
    const s = createSpace("school", { maxAnisotropy: 1 });
    expect(isSchoolSpace(s)).toBe(true);
    expect(s.root.children.length).toBeGreaterThan(0);
    s.dispose();
  });
});

describe("校舎の空間の歩行", () => {
  function setup(options: { shuttersClosed?: boolean } = {}) {
    const s = build(options);
    const w = createWalkWorld(s);
    return { s, w };
  }

  it("開始位置は床の上で何にも重ならない．目の高さは校舎の値", () => {
    const { s, w } = setup();
    const start = { x: s.startPosition.x, z: s.startPosition.z };
    expect(onFloor(w.floors, start.x, start.z)).toBe(true);
    for (const o of activeObstacles(w)) {
      expect(circleOverlapsRect(start.x, start.z, DEFAULT_BODY.radius, o)).toBe(false);
    }
    expect(w.eyeHeights).toEqual(SCHOOL_EYE_HEIGHT);
  });

  it("床の範囲は屋内の床の面と屋外のマス（体の中心はマス目の外・void・wall のマスへ出ない）", () => {
    const { s, w } = setup();
    expect(w.floors).toEqual(expect.arrayContaining([...s.layout.outdoor]));
    expect(onFloor(w.floors, -0.5, 10)).toBe(false);
    expect(onFloor(w.floors, 10, 13.5)).toBe(false);
    expect(onFloor(w.floors, 12.5, 2.5)).toBe(false);
  });

  it("正解経路のマスの中心を順にたどると，1年1組のドア・西の昇降口を通って集合場所まで歩ける", () => {
    const { w } = setup();
    const route = DEMO_SCHOOL.drill.route;
    for (let i = 1; i < route.length; i++) {
      const a = route[i - 1];
      const b = route[i];
      if (!a || !b) continue;
      const to = center(b.x, b.z);
      expect(
        reached(walk(w, center(a.x, a.z), to), to),
        `(${a.x}, ${a.z}) → (${b.x}, ${b.z})`,
      ).toBe(true);
    }
  });

  it.each([
    ["1年1組から廊下へ（ドアでない所の壁）", center(2, 4), center(2, 6)],
    ["1年1組から 1年2組へ（教室どうしの壁）", center(5, 2), center(6, 2)],
    ["廊下から校庭へ（昇降口でない所の外壁）", center(5, 7), center(5, 8)],
    ["校庭から廊下へ（外壁）", center(9, 8), center(9, 7)],
    ["1年2組から理科室へ（wall のマス）", center(11, 2), center(13, 2)],
    ["校庭のシャッターの下の柱（wall のマス）", center(11, 8), center(13, 8)],
    ["閉じたシャッター（廊下の西から東へ）", center(11, 6), center(13, 6)],
    ["閉じたシャッター（廊下の東から西へ）", center(13, 7), center(11, 7)],
  ])("%s は通り抜けられない", (_, from, to) => {
    const { w } = setup();
    expect(reached(walk(w, from, to), to)).toBe(false);
  });

  it("シャッターを開けると廊下を東西に通れる", () => {
    const { s, w } = setup();
    const shutter = s.parts.shutters[0];
    if (!shutter) throw new Error("シャッターがない");
    setFireShutterClosed(shutter, false);
    expect(reached(walk(w, center(11, 6), center(13, 6)), center(13, 6))).toBe(true);
  });

  it("東の昇降口から校庭へ出られる", () => {
    const { w } = setup();
    expect(reached(walk(w, center(16, 7), center(16, 9)), center(16, 9))).toBe(true);
  });

  it("校庭の端（マス目の外）へは出られない", () => {
    const { w } = setup();
    const end = walk(w, center(5, 12), { x: 5.5, z: 15 });
    expect(end.z).toBeLessThanOrEqual(13);
  });
});
