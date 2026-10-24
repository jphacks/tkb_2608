// 校舎のパーツの three.js の組み立て（schoolParts.ts）のテスト．構造（物の数・名前・位置・userData）を見る．
// 基準は Issue #73 と引継ぎメモ: 床の面は中心の床の上が原点（幅＝X・奥行き＝Z），辺の物は辺の中心の床の上が原点で
// 辺はローカル X に沿い，引き戸は +Z 側・出口の外は -Z 側．シャッターは開・閉を切り替えられる．
// 外側だけの教室のドアは開かない（locked）．開閉で動く物は userData.kind で結合から外す．
// マテリアルは canvas でテクスチャを描くため，document を何もしない canvas に差し替えて組み立てだけを確かめる

import * as THREE from "three";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import {
  DOOR,
  doorLeafLayout,
  type EdgeKind,
  edgeLayout,
  type FireShutterUserData,
  type FloorSurfaceUserData,
  minEdgeLength,
  POST_SIZE,
  type SchoolDoorLeafUserData,
  type SchoolDoorUserData,
  WALL_THICKNESS,
} from "./schoolLayout";
import {
  createFloorSurface,
  createSchoolEdge,
  createSchoolPartContext,
  createSchoolPost,
  disposeSchoolPartContext,
  type EdgeBuildOptions,
  isDynamicSchoolObject,
  type SchoolPartContext,
  setFireShutterClosed,
  setSchoolDoorOpen,
} from "./schoolParts";

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

const EDGE_KINDS: readonly EdgeKind[] = ["wall", "windowWall", "door", "exit", "fireShutter"];

function edgeOptions(overrides: Partial<EdgeBuildOptions> = {}): EdgeBuildOptions {
  return { kind: "wall", length: 4, height: 3, ...overrides };
}

/** パーツの Group 内の Mesh だけを集めた外接箱（Group のローカル座標） */
function localBox(group: THREE.Object3D, filter?: (o: THREE.Object3D) => boolean): THREE.Box3 {
  group.updateMatrixWorld(true);
  const inverse = group.matrixWorld.clone().invert();
  const box = new THREE.Box3();
  group.traverse((o) => {
    if (!(o instanceof THREE.Mesh) || (filter && !filter(o))) return;
    o.geometry.computeBoundingBox();
    const b = o.geometry.boundingBox?.clone();
    if (!b) return;
    b.applyMatrix4(new THREE.Matrix4().multiplyMatrices(inverse, o.matrixWorld));
    box.union(b);
  });
  return box;
}

function meshNames(group: THREE.Object3D): string[] {
  const names: string[] = [];
  group.traverse((o) => {
    if (o instanceof THREE.Mesh) names.push(o.name);
  });
  return names;
}

describe("createFloorSurface", () => {
  it("名前と userData を持ち，床（y=0）・天井（天井の高さ）・照明の 3 つの Mesh を持つ", () => {
    const group = createFloorSurface(context, {
      kind: "corridor",
      width: 8,
      depth: 3,
      ceilingHeight: 3,
      id: "c1",
    });
    expect(group.name).toBe("c1");
    const data: FloorSurfaceUserData = {
      kind: "schoolFloor",
      id: "c1",
      floorKind: "corridor",
      width: 8,
      depth: 3,
      ceilingHeight: 3,
    };
    expect(group.userData).toEqual(data);
    expect(meshNames(group).sort()).toEqual(["c1-ceiling", "c1-floor", "c1-lights"]);
    expect(group.getObjectByName("c1-floor")?.position.y).toBe(0);
    expect(group.getObjectByName("c1-ceiling")?.position.y).toBe(3);
  });

  it("床は中心が原点で，幅がローカル X・奥行きがローカル Z", () => {
    const group = createFloorSurface(context, {
      kind: "classroom",
      width: 8,
      depth: 6,
      ceilingHeight: 3,
    });
    // id を省くと Group は "classroom-floor"，床の Mesh は "classroom-floor-floor"
    const floor = group.getObjectByName("classroom-floor-floor");
    if (!floor) throw new Error("床がない");
    const box = localBox(group, (o) => o === floor);
    expect(box.min.x).toBeCloseTo(-4);
    expect(box.max.x).toBeCloseTo(4);
    expect(box.min.z).toBeCloseTo(-3);
    expect(box.max.z).toBeCloseTo(3);
    expect(box.max.y).toBeCloseTo(0);
  });

  it("床は上を，天井は下を向く", () => {
    const group = createFloorSurface(context, {
      kind: "classroom",
      width: 4,
      depth: 4,
      ceilingHeight: 3,
      id: "f",
    });
    group.updateMatrixWorld(true);
    const up = (name: string) => {
      const mesh = group.getObjectByName(name);
      if (!mesh) throw new Error(name);
      return new THREE.Vector3(0, 0, 1).transformDirection(mesh.matrixWorld).y;
    };
    expect(up("f-floor")).toBeCloseTo(1);
    expect(up("f-ceiling")).toBeCloseTo(-1);
  });

  it("教室と廊下で床・天井のマテリアルが違う", () => {
    const a = createFloorSurface(context, {
      kind: "classroom",
      width: 4,
      depth: 4,
      ceilingHeight: 3,
      id: "a",
    });
    const b = createFloorSurface(context, {
      kind: "corridor",
      width: 4,
      depth: 4,
      ceilingHeight: 3,
      id: "b",
    });
    const mat = (g: THREE.Object3D, n: string) => (g.getObjectByName(n) as THREE.Mesh).material;
    expect(mat(a, "a-floor")).not.toBe(mat(b, "b-floor"));
    expect(mat(a, "a-ceiling")).not.toBe(mat(b, "b-ceiling"));
  });

  it("lights: false なら照明を作らない", () => {
    const group = createFloorSurface(context, {
      kind: "classroom",
      width: 8,
      depth: 8,
      ceilingHeight: 3,
      id: "s",
      lights: false,
    });
    expect(meshNames(group).sort()).toEqual(["s-ceiling", "s-floor"]);
  });

  it("下限より小さい・天井が低いと RangeError", () => {
    expect(() =>
      createFloorSurface(context, { kind: "corridor", width: 0.4, depth: 3, ceilingHeight: 3 }),
    ).toThrow(RangeError);
    expect(() =>
      createFloorSurface(context, { kind: "corridor", width: 4, depth: 3, ceilingHeight: 2.4 }),
    ).toThrow(RangeError);
  });
});

describe("createSchoolEdge の共通の約束", () => {
  it.each(EDGE_KINDS)("%s: name・userData（kind・edgeKind・長さ・高さ）を持つ", (kind) => {
    const group = createSchoolEdge(context, edgeOptions({ kind, id: `e-${kind}` }));
    expect(group.name).toBe(`e-${kind}`);
    expect(group.userData).toMatchObject({
      kind: "schoolEdge",
      id: `e-${kind}`,
      edgeKind: kind,
      length: 4,
      height: 3,
    });
  });

  it.each(
    EDGE_KINDS.flatMap((kind) => [minEdgeLength(kind), 3, 4, 6].map((l) => [kind, l] as const)),
  )("%s（%d m）: 見た目は両端の柱の半分を除いた範囲に収まり，床から天井まで", (kind, length) => {
    const group = createSchoolEdge(context, edgeOptions({ kind, length, open: true }));
    const box = localBox(group);
    const half = (length - POST_SIZE) / 2;
    expect(box.min.x).toBeGreaterThanOrEqual(-half - 1e-6);
    expect(box.max.x).toBeLessThanOrEqual(half + 1e-6);
    expect(box.max.y).toBeLessThanOrEqual(3 + 1e-6);
    // 出口のポーチは地面より少し高い土間で，地面に少し沈める
    expect(box.min.y).toBeGreaterThanOrEqual(kind === "exit" ? -0.03 : -1e-6);
  });

  it.each(["wall", "windowWall", "door", "exit"] as const)(
    "%s: 壁の板は辺の線を中心に厚み WALL_THICKNESS",
    (kind) => {
      const group = createSchoolEdge(context, edgeOptions({ kind, id: "w" }));
      const wall = group.getObjectByName("w-wall");
      if (!wall) throw new Error("壁の板がない");
      const box = localBox(group, (o) => o === wall);
      expect(box.min.z).toBeCloseTo(-WALL_THICKNESS / 2);
      expect(box.max.z).toBeCloseTo(WALL_THICKNESS / 2);
      expect(box.min.y).toBeCloseTo(0);
      expect(box.max.y).toBeCloseTo(3);
    },
  );

  it.each(EDGE_KINDS)("%s: 下限をわずかに下回る長さ・低い天井は RangeError", (kind) => {
    expect(() =>
      createSchoolEdge(context, edgeOptions({ kind, length: minEdgeLength(kind) - 0.001 })),
    ).toThrow(RangeError);
    expect(() => createSchoolEdge(context, edgeOptions({ kind, height: 2.4999 }))).toThrow(
      RangeError,
    );
    expect(() => createSchoolEdge(context, edgeOptions({ kind, length: Number.NaN }))).toThrow(
      RangeError,
    );
  });

  it("id を省くと種類の名前になる", () => {
    expect(createSchoolEdge(context, edgeOptions({ kind: "exit" })).name).toBe("exit");
  });
});

describe("createSchoolEdge の窓付きの壁", () => {
  it("既定は透明なガラス，frosted ならすりガラスのマテリアル", () => {
    const clear = createSchoolEdge(context, edgeOptions({ kind: "windowWall", id: "a" }));
    const frosted = createSchoolEdge(
      context,
      edgeOptions({ kind: "windowWall", id: "b", glass: "frosted" }),
    );
    expect(clear.userData).toMatchObject({ glass: "clear" });
    expect(frosted.userData).toMatchObject({ glass: "frosted" });
    expect((clear.getObjectByName("a-glass") as THREE.Mesh).material).toBe(context.materials.glass);
    expect((frosted.getObjectByName("b-glass") as THREE.Mesh).material).toBe(
      context.materials.frostedGlass,
    );
  });

  it("窓が入らない短い辺はガラスを作らない（無地の壁になる）", () => {
    const group = createSchoolEdge(
      context,
      edgeOptions({ kind: "windowWall", length: 1, id: "s" }),
    );
    expect(group.getObjectByName("s-glass")).toBeUndefined();
    expect(group.getObjectByName("s-wall")).toBeDefined();
  });
});

describe("createSchoolEdge のドア", () => {
  function door(overrides: Partial<EdgeBuildOptions> = {}) {
    const group = createSchoolEdge(context, edgeOptions({ kind: "door", id: "d", ...overrides }));
    const data = group.userData as SchoolDoorUserData;
    const leaf = group.getObjectByName(data.leafName);
    if (!leaf) throw new Error("扉がない");
    return { group, data, leaf, leafData: leaf.userData as SchoolDoorLeafUserData };
  }

  it("既定は閉じていて開く．扉は +Z の側にあり，開口部の中央をふさぐ", () => {
    const { data, leaf, leafData } = door();
    expect(data).toMatchObject({ open: false, openAmount: 0, locked: false, leafName: "d-leaf" });
    expect(leafData).toMatchObject({ kind: "schoolDoorLeaf", doorId: "d", openAmount: 0 });
    const expected = doorLeafLayout(edgeLayout("door", 4, 3));
    expect(leaf.position.x).toBeCloseTo(expected.closedX);
    expect(leaf.position.z).toBeGreaterThan(WALL_THICKNESS / 2);
  });

  it("扉の大きさは開口部の実寸（幅 1.0 m 以上・高さ 2.0 m）", () => {
    const { leaf } = door();
    const box = new THREE.Box3().setFromObject(leaf);
    expect(box.max.x - box.min.x).toBeGreaterThanOrEqual(DOOR.width);
    expect(box.max.y).toBeCloseTo(DOOR.height);
  });

  it("open: true で作ると開いた位置（+X へ開口部の幅だけ）", () => {
    const { data, leaf, leafData } = door({ open: true });
    expect(data).toMatchObject({ open: true, openAmount: 1 });
    expect(leaf.position.x).toBeCloseTo(leafData.closedX + DOOR.width);
  });

  it("setSchoolDoorOpen で開閉すると userData と扉の位置が変わる", () => {
    const { group, data, leaf, leafData } = door();
    expect(setSchoolDoorOpen(group, true)).toBe(true);
    expect(data).toMatchObject({ open: true, openAmount: 1 });
    expect(leafData.openAmount).toBe(1);
    expect(leaf.position.x).toBeCloseTo(leafData.closedX + DOOR.width);
    expect(setSchoolDoorOpen(group, false)).toBe(true);
    expect(data).toMatchObject({ open: false, openAmount: 0 });
    expect(leaf.position.x).toBeCloseTo(leafData.closedX);
  });

  it("locked のドアは open: true でも閉じて作り，setSchoolDoorOpen でも開かない", () => {
    const { group, data, leaf, leafData } = door({ locked: true, open: true });
    expect(data).toMatchObject({ open: false, openAmount: 0, locked: true });
    expect(setSchoolDoorOpen(group, true)).toBe(false);
    expect(data.open).toBe(false);
    expect(leaf.position.x).toBeCloseTo(leafData.closedX);
  });

  it("locked のドアの扉の小窓はすりガラス，開くドアは指定のガラス", () => {
    const locked = door({ locked: true, glass: "clear" });
    const glass = (leaf: THREE.Object3D) =>
      (leaf.getObjectByName("d-leaf-glass") as THREE.Mesh).material;
    expect(glass(locked.leaf)).toBe(context.materials.frostedGlass);
    expect(glass(door().leaf)).toBe(context.materials.glass);
    expect(glass(door({ glass: "frosted" }).leaf)).toBe(context.materials.frostedGlass);
  });
});

describe("createSchoolEdge の出口", () => {
  it("ポーチと庇は -Z の側（外），誘導灯は +Z の側（内）", () => {
    const group = createSchoolEdge(context, edgeOptions({ kind: "exit", id: "x" }));
    const apron = group.getObjectByName("x-apron");
    const canopy = group.getObjectByName("x-canopy");
    const sign = group.getObjectByName("x-exit-sign");
    if (!apron || !canopy || !sign) throw new Error("出口の部品がない");
    // ポーチは敷居（壁の中）と外の土間をまとめた物
    expect(localBox(group, (o) => o === apron).min.z).toBeLessThan(-WALL_THICKNESS / 2);
    expect(localBox(group, (o) => o === canopy).max.z).toBeLessThanOrEqual(
      -WALL_THICKNESS / 2 + 1e-6,
    );
    expect(localBox(group, (o) => o === sign).min.z).toBeGreaterThanOrEqual(
      WALL_THICKNESS / 2 - 1e-6,
    );
  });

  it("庇は天井より低い（天井 2.5 m でも）", () => {
    const group = createSchoolEdge(context, edgeOptions({ kind: "exit", id: "x", height: 2.5 }));
    const canopy = group.getObjectByName("x-canopy");
    expect(localBox(group, (o) => o === canopy).max.y).toBeLessThanOrEqual(2.5 + 1e-6);
  });
});

describe("createSchoolEdge の防火シャッター", () => {
  function shutter(overrides: Partial<EdgeBuildOptions> = {}) {
    const group = createSchoolEdge(
      context,
      edgeOptions({ kind: "fireShutter", id: "s", length: 3, ...overrides }),
    );
    const data = group.userData as FireShutterUserData;
    const curtain = group.getObjectByName(data.curtainName);
    const bar = group.getObjectByName(data.openBarName);
    if (!curtain || !bar) throw new Error("シャッターの部品がない");
    return { group, data, curtain, bar };
  }

  it("既定は開いていて，幕は見えず座板が見える", () => {
    const { data, curtain, bar } = shutter();
    expect(data).toMatchObject({
      closed: false,
      wicketOpen: false,
      wicketOffset: 0,
      curtainName: "s-curtain",
      openBarName: "s-open-bar",
    });
    expect(curtain.visible).toBe(false);
    expect(bar.visible).toBe(true);
    expect(curtain.userData).toMatchObject({ kind: "fireShutterCurtain", shutterId: "s" });
    expect(bar.userData).toMatchObject({ kind: "fireShutterOpenBar", shutterId: "s" });
  });

  it("closed: true で作ると幕が見え，座板は見えない", () => {
    const { data, curtain, bar } = shutter({ closed: true });
    expect(data.closed).toBe(true);
    expect(curtain.visible).toBe(true);
    expect(bar.visible).toBe(false);
  });

  it("setFireShutterClosed で開・閉を切り替えられる", () => {
    const { group, data, curtain, bar } = shutter();
    setFireShutterClosed(group, true);
    expect([data.closed, curtain.visible, bar.visible]).toEqual([true, true, false]);
    setFireShutterClosed(group, false);
    expect([data.closed, curtain.visible, bar.visible]).toEqual([false, false, true]);
  });

  it("くぐり戸の位置を userData に持ち，幕の中にくぐり戸の扉がある", () => {
    const { data, curtain } = shutter({ wicketOffset: 0.2 });
    expect(data.wicketOffset).toBe(0.2);
    expect(data.wicket.centerX).toBeCloseTo(0.2);
    expect(data.wicket.width).toBeGreaterThanOrEqual(0.75);
    expect(data.wicket.height).toBeGreaterThanOrEqual(1.8);
    expect(data.wicket.bottom).toBeLessThanOrEqual(0.15);
    const wicket = curtain.getObjectByName("s-wicket");
    expect(wicket).toBeDefined();
    expect(wicket?.position.x ?? Number.NaN).toBeCloseTo(0);
  });

  it("幕は床から収納箱の下まで，辺の線の上にある", () => {
    const { group, curtain } = shutter({ closed: true });
    const box = localBox(group, (o) => {
      for (let p: THREE.Object3D | null = o; p; p = p.parent) if (p === curtain) return true;
      return false;
    });
    expect(box.min.y).toBeCloseTo(0);
    expect(box.max.y).toBeLessThanOrEqual(3 - 0.4 + 1e-6);
    expect(Math.abs(box.min.z)).toBeLessThanOrEqual(WALL_THICKNESS / 2);
    expect(Math.abs(box.max.z)).toBeLessThanOrEqual(WALL_THICKNESS / 2);
  });
});

describe("isDynamicSchoolObject", () => {
  it("引き戸の扉・シャッターの幕と座板は動く物，壁・パーツの Group は動かない物", () => {
    const d = createSchoolEdge(context, edgeOptions({ kind: "door", id: "d" }));
    const s = createSchoolEdge(context, edgeOptions({ kind: "fireShutter", id: "s" }));
    const named = (g: THREE.Object3D, n: string) => {
      const o = g.getObjectByName(n);
      if (!o) throw new Error(n);
      return o;
    };
    expect(isDynamicSchoolObject(named(d, "d-leaf"))).toBe(true);
    expect(isDynamicSchoolObject(named(s, "s-curtain"))).toBe(true);
    expect(isDynamicSchoolObject(named(s, "s-open-bar"))).toBe(true);
    expect(isDynamicSchoolObject(named(d, "d-wall"))).toBe(false);
    expect(isDynamicSchoolObject(d)).toBe(false);
    expect(isDynamicSchoolObject(new THREE.Object3D())).toBe(false);
  });
});

describe("createSchoolPost", () => {
  it("原点は端点の床の上で，POST_SIZE 四方・床から天井まで", () => {
    const post = createSchoolPost(context, { height: 2.6, id: "p" });
    expect(post.name).toBe("p");
    expect(post.userData).toEqual({ kind: "schoolPost", id: "p", height: 2.6 });
    const box = localBox(post);
    expect(box.min.x).toBeCloseTo(-POST_SIZE / 2);
    expect(box.max.x).toBeCloseTo(POST_SIZE / 2);
    expect(box.min.z).toBeCloseTo(-POST_SIZE / 2);
    expect(box.max.z).toBeCloseTo(POST_SIZE / 2);
    expect(box.min.y).toBeCloseTo(0);
    expect(box.max.y).toBeCloseTo(2.6);
  });
});

describe("SchoolPartContext", () => {
  it("マテリアルはパーツ間で共有する（2 つの壁の板が同じマテリアル）", () => {
    const a = createSchoolEdge(context, edgeOptions({ id: "a" }));
    const b = createSchoolEdge(context, edgeOptions({ id: "b", length: 6 }));
    expect((a.getObjectByName("a-wall") as THREE.Mesh).material).toBe(
      (b.getObjectByName("b-wall") as THREE.Mesh).material,
    );
  });

  it("disposeSchoolPartContext でマテリアルと単位立方体を解放する", () => {
    const own = createSchoolPartContext(1);
    const material = vi.spyOn(own.materials.wall, "dispose");
    const box = vi.spyOn(own.unitBox, "dispose");
    disposeSchoolPartContext(own);
    expect(material).toHaveBeenCalled();
    expect(box).toHaveBeenCalled();
  });
});
