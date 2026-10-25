// SchoolPlan から組み立てた校舎の空間（?scene=school．schoolPlanScene.ts・schoolPlanWalk.ts）のテスト．
// 基準は Issue #92 の完了条件（デモの校舎の 1 フロアが組み上がる・壁・wall のマス・閉じたシャッターを通り抜けずに歩ける）．
// canvas は何もしない物に差し替える

import * as THREE from "three";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import type { SchoolPlan } from "../../core/schoolPlan";
import { IDLE_PLAYER_INPUT, type Posture } from "../../core/types";
import { DEMO_PITCH_SCHOOL } from "../../share/samples/demoPitchSchool";
import { DEMO_SCHOOL } from "../../share/samples/demoSchool";
import { detectErrorBehaviors, type ErrorBehaviors } from "../../sim/errorBehavior";
import { computeSpread } from "../../sim/spread";
import { RED_EDGE } from "../common/redEdge";
import { createSpace, createWalkWorld } from "../index";
import type { SpaceId } from "../types";
import { circleOverlapsRect, DEFAULT_BODY, moveWithCollision, onFloor } from "../walk/collision";
import {
  activeObstacles,
  initialWalkState,
  stepWalk,
  type WalkState,
  type WalkWorld,
} from "../walk/locomotion";
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
import { SCHOOL_WALK_SPEED_SCALE } from "./schoolPlanWalk";

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

function build(options: { shuttersClosed?: boolean; autoRedEdge?: boolean } = {}): SchoolSpace {
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

// ---- Issue #121: くぐり戸・燃えているマス・赤い表示・歩く速さ ----
// 基準は SPEC_01「VR 避難の規則」（火のマスには入れない・煙・赤い表示・歩く速さ）と SPEC_02「通れる・燃え広がる」
// （防火シャッターは閉じているが人はくぐり戸を通れる）．デモの校舎のシャッターは x = 12，くぐり戸は廊下の z = 6.6〜7.4

const SPREAD = computeSpread(DEMO_SCHOOL);
const cell = (x: number, z: number) => ({ floor: 0, x, z });

/** 校舎の空間に 1 フレーム分の時刻・目の位置・姿勢を渡す */
function frame(
  s: SchoolSpace,
  seconds: number,
  at: { x: number; z: number } | null,
  posture: Posture = "standing",
  dt: number | undefined = 1,
) {
  const eyeY = posture === "crouching" ? SCHOOL_EYE_HEIGHT.crouching : SCHOOL_EYE_HEIGHT.standing;
  s.update?.({ seconds, eye: at === null ? null : { x: at.x, y: eyeY, z: at.z }, posture, dt });
}

describe("校舎の空間の歩行（くぐり戸）", () => {
  it.each([
    ["西から東へ", { x: 11.5, z: 7.0 }, { x: 13.5, z: 7.0 }],
    ["東から西へ", { x: 13.5, z: 7.0 }, { x: 11.5, z: 7.0 }],
  ])("閉じたシャッターでもくぐり戸の中心（z = 7.0）は%s歩いて通れる", (_, from, to) => {
    const s = build();
    expect((s.parts.shutters[0]?.userData as FireShutterUserData | undefined)?.closed).toBe(true);
    const w = createWalkWorld(s);
    expect(reached(walk(w, from, to), to)).toBe(true);
  });

  it("くぐり戸を通っても，くぐり戸の外（z = 6.5・7.5）の幕は通れないまま", () => {
    const s = build();
    const w = createWalkWorld(s);
    expect(reached(walk(w, center(11, 6), center(13, 6)), center(13, 6))).toBe(false);
    expect(reached(walk(w, center(13, 7), center(11, 7)), center(11, 7))).toBe(false);
  });

  it("stepWalk で足踏みしてもくぐり戸を通って東へ抜けられる（敷居の高さで止まらない）", () => {
    const s = build();
    const w = createWalkWorld(s);
    let st: WalkState = initialWalkState(11.0, 7.0, SCHOOL_EYE_HEIGHT.standing);
    const input = { ...IDLE_PLAYER_INPUT, walking: true, walkSpeed: 1 };
    // 体の向き -π/2 で +X（東）へ進む
    for (let i = 0; i < 60; i++) st = stepWalk(st, input, 1 / 30, w, -Math.PI / 2);
    expect(st.x).toBeGreaterThan(13);
    expect(st.z).toBeCloseTo(7.0, 1);
  });

  it("くぐり戸をしゃがんでも通れる", () => {
    const s = build();
    const w = createWalkWorld(s);
    const end = moveWithCollision(
      11.5,
      7.0,
      2,
      0,
      SCHOOL_EYE_HEIGHT.crouching + DEFAULT_BODY.headClearance,
      activeObstacles(w),
      w.floors,
      DEFAULT_BODY,
    );
    expect(end.x).toBeCloseTo(13.5);
  });
});

describe("校舎の空間の歩行（燃えているマス）", () => {
  it("燃えうるマスの当たり判定が WalkWorld.doors に入っている", () => {
    const s = build();
    const w = createWalkWorld(s);
    expect(s.fireCells.doors.length).toBeGreaterThan(0);
    for (const d of s.fireCells.doors) expect(w.doors).toContain(d);
  });

  it("燃えているマスへは歩いて入れず，火が着く前なら入れる", () => {
    const s = build();
    const w = createWalkWorld(s);
    // 廊下の (15,7) から西へ．間の (14,7) に火が着く時刻の前後で比べる
    const from = center(15, 7);
    const to = center(13, 7);
    const fireAtPath = SPREAD.fireAt(cell(14, 7));
    expect(Number.isFinite(fireAtPath)).toBe(true);
    frame(s, fireAtPath - 1, from);
    const before = walk(w, from, center(14, 7));
    expect(reached(before, center(14, 7))).toBe(true);
    frame(s, fireAtPath, from);
    const after = walk(w, from, to);
    expect(after.x).toBeGreaterThanOrEqual(15 + DEFAULT_BODY.radius - 1e-6);
  });

  it("燃えているマスの中にいても，燃えていない隣のマスへ出られる（閉じ込められない）", () => {
    const s = build();
    const w = createWalkWorld(s);
    // (14,6) に火が着いた瞬間にそのマスの中にいる．南の (14,7) はまだ燃えていない
    const t = SPREAD.fireAt(cell(14, 6));
    expect(SPREAD.fireAt(cell(14, 7))).toBeGreaterThan(t);
    const here = center(14, 6);
    frame(s, t, here);
    expect(reached(walk(w, here, center(14, 7)), center(14, 7))).toBe(true);
  });

  it("stepWalk で燃えているマスの中に立ち止まっていても押し出されない（飛ばされない）", () => {
    const s = build();
    const w = createWalkWorld(s);
    const t = SPREAD.fireAt(cell(14, 6));
    let st: WalkState = initialWalkState(14.5, 6.5, SCHOOL_EYE_HEIGHT.standing);
    for (let i = 0; i < 30; i++) {
      frame(s, t + i / 30, { x: st.x, z: st.z });
      st = stepWalk(st, IDLE_PLAYER_INPUT, 1 / 30, w, 0);
    }
    expect(st.x).toBeCloseTo(14.5);
    expect(st.z).toBeCloseTo(6.5);
  });

  it("非常ベルの前（負の時刻）は火元のマスにも入れる", () => {
    const s = build();
    const w = createWalkWorld(s);
    const origin = DEMO_SCHOOL.drill.fireOrigins[0];
    if (!origin) throw new Error("火元が無い");
    const from = center(origin.x - 1, origin.z);
    frame(s, -5, from);
    expect(reached(walk(w, from, center(origin.x, origin.z)), center(origin.x, origin.z))).toBe(
      true,
    );
  });
});

describe("校舎の空間の歩く速さ", () => {
  it("校舎の WalkWorld は walkSpeedScale 1.5（SPEC_01 の既定）", () => {
    const s = build();
    expect(SCHOOL_WALK_SPEED_SCALE).toBe(1.5);
    expect(createWalkWorld(s).walkSpeedScale).toBe(1.5);
  });

  it("校舎の廊下で 1.0 m/s の足踏みをすると 1 秒に 1.5 m 進む", () => {
    const s = build();
    const w = createWalkWorld(s);
    let st: WalkState = initialWalkState(3.5, 6.5, SCHOOL_EYE_HEIGHT.standing);
    const input = { ...IDLE_PLAYER_INPUT, walking: true, walkSpeed: 1 };
    for (let i = 0; i < 30; i++) st = stepWalk(st, input, 1 / 30, w, -Math.PI / 2);
    expect(st.x).toBeCloseTo(5.0, 2);
  });

  it.each(["room", "train", "elevator", "school-parts"] as const)(
    "他の空間（%s）は歩く速さを変えない（倍率なしか 1）",
    (id: SpaceId) => {
      const other = createSpace(id, { maxAnisotropy: 1 });
      try {
        const scale = createWalkWorld(other).walkSpeedScale;
        expect(scale === undefined || scale === 1).toBe(true);
      } finally {
        other.dispose();
      }
    },
  );
});

describe("createSchoolScene（赤い表示）", () => {
  // 煙は来ているが火の 1 マス以内でない時刻と位置（シャッターの東の廊下 (13,7)）
  const smokyCell = { x: 13, z: 7 };
  const smokyPos = center(smokyCell.x, smokyCell.z);

  function smokyNotNearFireSeconds(): number {
    const t = SPREAD.smokeAt(cell(smokyCell.x, smokyCell.z));
    expect(Number.isFinite(t)).toBe(true);
    const expected = detectErrorBehaviors(DEMO_SCHOOL, SPREAD, {
      t: t + 0.5,
      floor: 0,
      x: smokyPos.x,
      z: smokyPos.z,
      posture: "standing",
    });
    // 前提: その時刻は煙の中で，火の 1 マス以内でない
    expect(expected).toEqual({ smokeStanding: true, nearFire: false, any: true });
    return t + 0.5;
  }

  it("赤い表示（red-edge）は root の子で，消えた状態で始まる", () => {
    const s = build();
    expect(s.redEdge.object.parent).toBe(s.root);
    expect(s.redEdge.active).toBe(false);
    expect(s.redEdge.object.visible).toBe(false);
    expect(s.errorBehaviors).toBeNull();
  });

  it("spread は computeSpread(plan) と同じ時刻を返す", () => {
    const s = build();
    for (const [x, z] of [
      [16, 2],
      [14, 6],
      [13, 7],
      [2, 2],
    ] as const) {
      expect(s.spread.fireAt(cell(x, z))).toBe(SPREAD.fireAt(cell(x, z)));
      expect(s.spread.smokeAt(cell(x, z))).toBe(SPREAD.smokeAt(cell(x, z)));
    }
  });

  it("autoRedEdge: 煙の中で立つと赤い表示が出て，しゃがむと消える", () => {
    const s = build({ autoRedEdge: true });
    const t = smokyNotNearFireSeconds();
    frame(s, t, smokyPos, "standing");
    expect(s.errorBehaviors).toMatchObject({ smokeStanding: true, nearFire: false, any: true });
    expect(s.redEdge.active).toBe(true);
    expect(s.redEdge.object.visible).toBe(true);
    frame(s, t, smokyPos, "crouching");
    expect(s.errorBehaviors).toMatchObject({ smokeStanding: false, nearFire: false, any: false });
    expect(s.redEdge.active).toBe(false);
    expect(s.redEdge.object.visible).toBe(false);
  });

  it("autoRedEdge: 煙が来る前は立っていても出ない", () => {
    const s = build({ autoRedEdge: true });
    frame(s, SPREAD.smokeAt(cell(smokyCell.x, smokyCell.z)) - 1, smokyPos, "standing");
    expect(s.redEdge.active).toBe(false);
  });

  it("autoRedEdge: 燃えているマスから 1 マス以内（斜め・壁越しも）ではしゃがんでいても出る", () => {
    const s = build({ autoRedEdge: true });
    // (14,6) が燃えた後，斜めの隣の (13,7) に立つ（(13,7) 自身はまだ燃えていない時刻）
    const t = SPREAD.fireAt(cell(14, 6));
    expect(SPREAD.fireAt(cell(13, 7))).toBeGreaterThan(t);
    frame(s, t, smokyPos, "crouching");
    expect(s.errorBehaviors?.nearFire).toBe(true);
    expect(s.redEdge.active).toBe(true);
  });

  it("autoRedEdge: 火から 2 マス以上離れ，煙の無い所では出ない", () => {
    const s = build({ autoRedEdge: true });
    frame(s, 100, center(2, 2), "standing");
    expect(s.errorBehaviors).toMatchObject({ any: false });
    expect(s.redEdge.active).toBe(false);
  });

  it("autoRedEdge: 判定は detectErrorBehaviors() とすべての場合で一致する", () => {
    const s = build({ autoRedEdge: true });
    const times = [-1, 0, 10, 14, 16, 20, 30, 36, 42, 48, 60, 100, 1000];
    const positions = [
      center(2, 2),
      center(4, 6),
      center(11, 7),
      { x: 11.95, z: 7.0 },
      { x: 12.05, z: 7.0 },
      center(13, 6),
      center(13, 7),
      center(14, 7),
      center(15, 6),
      center(16, 7),
      center(16, 9),
      center(14, 4),
    ];
    for (const t of times) {
      for (const p of positions) {
        for (const posture of ["standing", "crouching"] as const) {
          frame(s, t, p, posture);
          const expected: ErrorBehaviors = detectErrorBehaviors(DEMO_SCHOOL, SPREAD, {
            t,
            floor: 0,
            x: p.x,
            z: p.z,
            posture,
          });
          const label = `t=${t} (${p.x}, ${p.z}) ${posture}`;
          expect(s.errorBehaviors, label).toEqual(expected);
          expect(s.redEdge.active, label).toBe(expected.any);
        }
      }
    }
  });

  it("autoRedEdge: 姿勢が渡されない時は立っている扱い", () => {
    const s = build({ autoRedEdge: true });
    const t = smokyNotNearFireSeconds();
    s.update?.({ seconds: t, eye: { x: smokyPos.x, y: 1.6, z: smokyPos.z }, dt: 1 });
    expect(s.redEdge.active).toBe(true);
  });

  it("autoRedEdge: 目の位置が null の時は出さず，errorBehaviors は null", () => {
    const s = build({ autoRedEdge: true });
    const t = smokyNotNearFireSeconds();
    frame(s, t, smokyPos, "standing");
    expect(s.redEdge.active).toBe(true);
    frame(s, t, null);
    expect(s.redEdge.active).toBe(false);
    expect(s.errorBehaviors).toBeNull();
  });

  it("autoRedEdge: フレームの dt でフェードし（点滅しない），dt が無ければ瞬時に切り替える", () => {
    const s = build({ autoRedEdge: true });
    const t = smokyNotNearFireSeconds();
    frame(s, t, smokyPos, "standing", RED_EDGE.fadeSeconds / 2);
    expect(s.redEdge.opacity).toBeCloseTo(0.5);
    frame(s, t, smokyPos, "standing", RED_EDGE.fadeSeconds / 2);
    expect(s.redEdge.opacity).toBeCloseTo(1);
    // エラー行動の間は出し続ける
    for (let i = 0; i < 30; i++) frame(s, t + i * 0.01, smokyPos, "standing", 1 / 60);
    expect(s.redEdge.opacity).toBe(1);
    frame(s, t, smokyPos, "crouching", undefined);
    expect(s.redEdge.opacity).toBe(0);
  });

  it("autoRedEdge が既定（false）なら自分では出さず，errorBehaviors は null のまま", () => {
    const s = build();
    const t = smokyNotNearFireSeconds();
    frame(s, t, smokyPos, "standing");
    expect(s.redEdge.active).toBe(false);
    expect(s.redEdge.object.visible).toBe(false);
    expect(s.errorBehaviors).toBeNull();
  });

  it("autoRedEdge が false でも，外からの setActive に従い update(frame) の dt でフェードする", () => {
    const s = build();
    s.redEdge.setActive(true);
    frame(s, 0, center(2, 2), "standing", RED_EDGE.fadeSeconds);
    expect(s.redEdge.opacity).toBe(1);
    expect(s.redEdge.object.visible).toBe(true);
    // 外の指示を update が上書きしない（煙の無い所に立っていても出たまま）
    frame(s, 0, center(2, 2), "standing", 1);
    expect(s.redEdge.active).toBe(true);
    s.redEdge.setActive(false);
    frame(s, 0, center(2, 2), "standing", RED_EDGE.fadeSeconds);
    expect(s.redEdge.object.visible).toBe(false);
  });

  it('createSpace("school") は赤い表示を自分で判定する（煙の中で立つと出る）', () => {
    const s = createSpace("school", { maxAnisotropy: 1 });
    try {
      if (!isSchoolSpace(s)) throw new Error("校舎でない");
      const t = smokyNotNearFireSeconds();
      frame(s, t, smokyPos, "standing");
      expect(s.redEdge.active).toBe(true);
      frame(s, t, smokyPos, "crouching");
      expect(s.redEdge.active).toBe(false);
    } finally {
      s.dispose();
    }
  });

  it("dispose で赤い表示を root から外して解放する", () => {
    const s = build({ autoRedEdge: true });
    const disposed: string[] = [];
    const edge = s.redEdge.object;
    edge.geometry.addEventListener("dispose", () => disposed.push("geometry"));
    (edge.material as THREE.Material).addEventListener("dispose", () => disposed.push("material"));
    expect(() => s.dispose()).not.toThrow();
    space = undefined;
    expect(edge.parent).toBeNull();
    expect(disposed.sort()).toEqual(["geometry", "material"]);
  });
});

describe("校舎の空間のくぐり戸の扉（update で目の位置に合わせて開閉）", () => {
  // 基準は SPEC_02「通れる・燃え広がる」: 目がくぐり戸の中心から水平に 1.5 m 以内で開き始め，1.9 m を超えると閉じ始める．
  // 0.4 s で全開・90°．シャッターが開いている時は扉は閉じた状態．当たり判定は変わらない（くぐり戸は常に通れる）
  function setup(options: { shuttersClosed?: boolean } = {}) {
    const s = build(options);
    s.root.updateMatrixWorld(true);
    const shutter = s.parts.shutters[0];
    if (!shutter) throw new Error("シャッターがない");
    const data = shutter.userData as FireShutterUserData;
    const wicketCenter = shutter.localToWorld(new THREE.Vector3(data.wicket.centerX, 0, 0));
    return { s, shutter, data, wicketCenter };
  }

  it("組み上げた校舎のシャッターにくぐり戸の扉（<id>-wicket-leaf）が残っている（静的な結合で消えない）", () => {
    const { shutter, data } = setup();
    expect(shutter.getObjectByName(data.wicketLeafName)).toBeDefined();
  });

  it("目がくぐり戸に近づくと扉が開き，離れると閉じる", () => {
    const { s, data, wicketCenter } = setup();
    frame(s, 0, { x: wicketCenter.x - 3, z: wicketCenter.z }, "standing", 0.1);
    expect(data.wicketOpenAmount).toBe(0);
    for (let i = 0; i < 4; i++)
      frame(s, 0, { x: wicketCenter.x - 1, z: wicketCenter.z }, "standing", 0.1);
    expect(data.wicketOpenAmount).toBeCloseTo(1);
    expect(data.wicketOpen).toBe(true);
    for (let i = 0; i < 4; i++)
      frame(s, 0, { x: wicketCenter.x - 3, z: wicketCenter.z }, "standing", 0.1);
    expect(data.wicketOpenAmount).toBeCloseTo(0);
    expect(data.wicketOpen).toBe(false);
  });

  it("目が無い（null）フレームでは扉を閉じる", () => {
    const { s, data, wicketCenter } = setup();
    frame(s, 0, { x: wicketCenter.x - 1, z: wicketCenter.z }, "standing", 1);
    expect(data.wicketOpenAmount).toBe(1);
    frame(s, 0, null, "standing", 1);
    expect(data.wicketOpenAmount).toBe(0);
  });

  it("シャッターを開けて作った校舎では，近づいても扉は閉じたまま", () => {
    const { s, data, wicketCenter } = setup({ shuttersClosed: false });
    frame(s, 0, { x: wicketCenter.x - 0.5, z: wicketCenter.z }, "standing", 1);
    expect(data.wicketOpenAmount).toBe(0);
    expect(data.wicketOpen).toBe(false);
  });

  it("扉が開いても閉じても，くぐり戸の当たり判定は変わらない（くぐり戸は常に通れ，外の幕は通れない）", () => {
    const { s, wicketCenter } = setup();
    const w = createWalkWorld(s);
    const check = () => {
      expect(reached(walk(w, { x: 11.5, z: 7.0 }, { x: 13.5, z: 7.0 }), { x: 13.5, z: 7.0 })).toBe(
        true,
      );
      expect(reached(walk(w, center(11, 6), center(13, 6)), center(13, 6))).toBe(false);
    };
    check();
    frame(s, 0, { x: wicketCenter.x - 1, z: wicketCenter.z }, "standing", 1);
    check();
    frame(s, 0, { x: wicketCenter.x - 5, z: wicketCenter.z }, "standing", 1);
    check();
  });
});

describe("発表のデモ用の校舎（DEMO_PITCH_SCHOOL）の空間", () => {
  it("正解経路のマスの中心を順にたどると，閉じたシャッターのくぐり戸を通って集合場所まで歩ける", () => {
    space = createSchoolScene({ maxAnisotropy: 1 }, DEMO_PITCH_SCHOOL);
    const s = space;
    expect((s.parts.shutters[0]?.userData as FireShutterUserData | undefined)?.closed).toBe(true);
    const w = createWalkWorld(s);
    const route = DEMO_PITCH_SCHOOL.drill.route;
    for (let i = 1; i < route.length; i++) {
      const a = route[i - 1];
      const b = route[i];
      if (!a || !b) continue;
      // シャッターのマスは辺の中心ではなくくぐり戸の z = 7.0 を通る
      const pa = a.x === 12 || b.x === 12 ? { x: a.x + 0.5, z: 7.0 } : center(a.x, a.z);
      const pb = a.x === 12 || b.x === 12 ? { x: b.x + 0.5, z: 7.0 } : center(b.x, b.z);
      expect(reached(walk(w, pa, pb), pb), `(${a.x}, ${a.z}) → (${b.x}, ${b.z})`).toBe(true);
    }
  });

  it("西の昇降口があった (2,7) から校庭へは出られない", () => {
    space = createSchoolScene({ maxAnisotropy: 1 }, DEMO_PITCH_SCHOOL);
    const w = createWalkWorld(space);
    expect(reached(walk(w, center(2, 7), center(2, 9)), center(2, 9))).toBe(false);
  });
});
