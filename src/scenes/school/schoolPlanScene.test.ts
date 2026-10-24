// SchoolPlan から組み立てた校舎の空間（?scene=school．schoolPlanScene.ts・schoolPlanWalk.ts）のテスト．
// 基準は Issue #92 の完了条件（デモの校舎の 1 フロアが組み上がる・壁・wall のマス・閉じたシャッターを通り抜けずに歩ける）．
// canvas は何もしない物に差し替える

import * as THREE from "three";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import type { SchoolPlan } from "../../core/schoolPlan";
import { DEMO_SCHOOL } from "../../share/samples/demoSchool";
import { computeSpread } from "../../sim/spread";
import { createSpace, createWalkWorld } from "../index";
import { circleOverlapsRect, DEFAULT_BODY, moveWithCollision, onFloor } from "../walk/collision";
import { activeObstacles, type WalkWorld } from "../walk/locomotion";
import { FIRE_SMOKE_NAME, SMOKE_MESH_NAME } from "./fireSmoke";
import { eyeSmokeDensity, smokeFogDensity } from "./fireSmokeLayout";
import { ROUTE_ARROWS_NAME } from "./routeArrows";
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

/** デモの校舎の訓練条件だけを上書きした校舎 */
function demoWith(drill: Partial<SchoolPlan["drill"]>): SchoolPlan {
  return { ...DEMO_SCHOOL, drill: { ...DEMO_SCHOOL.drill, ...drill } };
}

function buildPlan(plan: SchoolPlan): SchoolSpace {
  space = createSchoolScene({ maxAnisotropy: 1 }, plan);
  return space;
}

/** 理科室の火元 (16, 2) の隣のマスの目の位置（十分後に煙が濃い）．立った目 1.6 m・しゃがんだ目 0.9 m */
const smokyStandingEye = { x: 15.5, y: 1.6, z: 2.5 };
const smokyCrouchingEye = { x: 15.5, y: 0.9, z: 2.5 };

describe("createSchoolScene（床の矢印と火と煙）", () => {
  it("学習モードでは床の矢印（route-arrows）と火と煙（fire-smoke）が root の直下にある", () => {
    const s = build();
    expect(DEMO_SCHOOL.drill.mode).toBe("learn");
    expect(s.routeArrows).not.toBeNull();
    expect(s.routeArrows?.object.name).toBe(ROUTE_ARROWS_NAME);
    expect(s.routeArrows?.object.parent).toBe(s.root);
    expect(s.routeArrows?.placements.length).toBeGreaterThan(0);
    expect(s.fireSmoke.object.name).toBe(FIRE_SMOKE_NAME);
    expect(s.fireSmoke.object.parent).toBe(s.root);
  });

  it("矢印と火と煙は結合の対象（parts）の外にある", () => {
    const s = build();
    let insideParts = false;
    s.parts.parts.traverse((o) => {
      if (o === s.routeArrows?.object || o === s.fireSmoke.object) insideParts = true;
      if (o.name.startsWith(ROUTE_ARROWS_NAME) || o.name.startsWith(FIRE_SMOKE_NAME)) {
        insideParts = true;
      }
    });
    expect(insideParts).toBe(false);
  });

  it("テストモードでは routeArrows が null で，root の中に矢印が無い（火と煙はある）", () => {
    const s = buildPlan(demoWith({ mode: "test" }));
    expect(s.routeArrows).toBeNull();
    expect(s.root.getObjectByName(ROUTE_ARROWS_NAME)).toBeUndefined();
    expect(s.root.getObjectByName(`${ROUTE_ARROWS_NAME}-mesh`)).toBeUndefined();
    expect(s.fireSmoke.object.parent).toBe(s.root);
  });

  it("fog は FogExp2 で，fireSmoke.fog と同じもの", () => {
    const s = build();
    expect(s.fog).toBeInstanceOf(THREE.FogExp2);
    expect(s.fog).toBe(s.fireSmoke.fog);
  });

  it("update を持ち，渡した時刻が fireSmoke の様子に入る", () => {
    const s = build();
    expect(typeof s.update).toBe("function");
    s.update?.({ seconds: 42, eye: null });
    expect(s.fireSmoke.stats.seconds).toBe(42);
    s.update?.({ seconds: 90, eye: smokyStandingEye });
    expect(s.fireSmoke.stats.seconds).toBe(90);
  });

  it("煙の中で立つとフォグが濃く，しゃがむと薄くなる（F4．しゃがむと晴れる）", () => {
    const s = build();
    const spread = computeSpread(DEMO_SCHOOL);
    s.update?.({ seconds: 1000, eye: smokyStandingEye });
    const standing = s.fog.density;
    expect(standing).toBeGreaterThan(0);
    expect(standing).toBeCloseTo(
      smokeFogDensity(eyeSmokeDensity(DEMO_SCHOOL, spread, 1000, smokyStandingEye)),
      12,
    );
    s.update?.({ seconds: 1000, eye: smokyCrouchingEye });
    expect(s.fog.density).toBeLessThan(standing);
    expect(s.fog.density).toBeCloseTo(
      smokeFogDensity(eyeSmokeDensity(DEMO_SCHOOL, spread, 1000, smokyCrouchingEye)),
      12,
    );
    expect(s.fireSmoke.stats.fogDensity).toBe(s.fog.density);
  });

  it("非常ベルの時点（0 秒）は煙が届いておらずフォグは 0．時間がたつと濃くなる", () => {
    const s = build();
    s.update?.({ seconds: 0, eye: smokyStandingEye });
    expect(s.fog.density).toBe(0);
    s.update?.({ seconds: 1000, eye: smokyStandingEye });
    expect(s.fog.density).toBeGreaterThan(0);
  });

  it("目の位置が null の時はフォグを 0 にする", () => {
    const s = build();
    s.update?.({ seconds: 1000, eye: smokyStandingEye });
    expect(s.fog.density).toBeGreaterThan(0);
    s.update?.({ seconds: 1000, eye: null });
    expect(s.fog.density).toBe(0);
  });

  it("THREE.Vector3 を目の位置としてそのまま渡せる", () => {
    const s = build();
    const eye = new THREE.Vector3(smokyStandingEye.x, smokyStandingEye.y, smokyStandingEye.z);
    s.update?.({ seconds: 1000, eye });
    expect(s.fog.density).toBeGreaterThan(0);
  });

  it("テストモードでも update で火と煙が進む", () => {
    const s = buildPlan(demoWith({ mode: "test" }));
    s.update?.({ seconds: 1000, eye: smokyStandingEye });
    expect(s.fireSmoke.stats.seconds).toBe(1000);
    expect(s.fog.density).toBeGreaterThan(0);
  });

  it("dispose で例外を出さず，矢印と火と煙を root から外して解放する（煙の DataTexture も）", () => {
    const s = build();
    const disposed: string[] = [];
    const arrowMesh = s.routeArrows?.object.getObjectByName(`${ROUTE_ARROWS_NAME}-mesh`);
    if (!(arrowMesh instanceof THREE.Mesh)) throw new Error("矢印の Mesh が無い");
    arrowMesh.geometry.addEventListener("dispose", () => disposed.push("arrow:geometry"));
    const smoke = s.fireSmoke.object.getObjectByName(SMOKE_MESH_NAME);
    if (!(smoke instanceof THREE.Mesh) || !(smoke.material instanceof THREE.ShaderMaterial)) {
      throw new Error("煙の層の Mesh が無い");
    }
    const tex = smoke.material.uniforms.uCells.value;
    if (!(tex instanceof THREE.DataTexture)) throw new Error("uCells が DataTexture でない");
    tex.addEventListener("dispose", () => disposed.push("smoke:texture"));
    smoke.geometry.addEventListener("dispose", () => disposed.push("smoke:geometry"));
    const routeObject = s.routeArrows?.object;
    const fireObject = s.fireSmoke.object;

    expect(() => s.dispose()).not.toThrow();
    space = undefined;

    expect(disposed).toEqual(
      expect.arrayContaining(["arrow:geometry", "smoke:texture", "smoke:geometry"]),
    );
    expect(routeObject?.parent).toBeNull();
    expect(fireObject.parent).toBeNull();
  });

  it("テストモード（矢印なし）でも dispose で例外を出さない", () => {
    const s = buildPlan(demoWith({ mode: "test" }));
    expect(() => s.dispose()).not.toThrow();
    space = undefined;
  });
});
