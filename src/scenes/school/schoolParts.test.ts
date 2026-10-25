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
  setFireShutterWicketOpen,
  setSchoolDoorOpen,
  updateFireShutterWicket,
} from "./schoolParts";
import { WICKET_AUTO } from "./shutterWicket";

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

describe("防火シャッターのくぐり戸の扉（SPEC_02「通れる・燃え広がる」）", () => {
  // 基準: 目がくぐり戸の中心から水平に 1.5 m 以内で開き始め，1.9 m を超えると閉じ始める．閉から全開まで 0.4 s・全開 90°．
  // 体験者のいる側と反対へ開く（閉じ切った状態から開く時に決める）．シャッターが開いている時は扉を閉じておく
  function shutter(overrides: Partial<EdgeBuildOptions> = {}) {
    const group = createSchoolEdge(
      context,
      edgeOptions({ kind: "fireShutter", id: "s", length: 3, closed: true, ...overrides }),
    );
    group.updateMatrixWorld(true);
    const data = group.userData as FireShutterUserData;
    const leaf = group.getObjectByName(data.wicketLeafName);
    const curtain = group.getObjectByName(data.curtainName);
    if (!leaf || !curtain) throw new Error("くぐり戸の扉がない");
    return { group, data, leaf, curtain };
  }

  /** くぐり戸の中心から，ローカルの (dx, dz) だけ離れた目の位置（ワールド座標．立った目の高さ） */
  function eyeAt(group: THREE.Object3D, dx: number, dz: number) {
    const data = group.userData as FireShutterUserData;
    return group.localToWorld(new THREE.Vector3(data.wicket.centerX + dx, 1.5, dz));
  }

  /** 扉の蝶番の反対の端（+X の端）の，シャッターのローカルの Z */
  function freeEndZ(group: THREE.Object3D, leaf: THREE.Object3D): number {
    group.updateMatrixWorld(true);
    const data = group.userData as FireShutterUserData;
    const p = leaf.localToWorld(new THREE.Vector3(data.wicket.width, 1, 0));
    return group.worldToLocal(p).z;
  }

  it("扉は幕の中にあり，名前は <id>-wicket-leaf．扉の板と取っ手は扉の中，座板は幕の直下", () => {
    const { data, leaf, curtain } = shutter();
    expect(data.wicketLeafName).toBe("s-wicket-leaf");
    expect(leaf.parent).toBe(curtain);
    expect(leaf.getObjectByName("s-wicket")).toBeDefined();
    expect(leaf.getObjectByName("s-handle")).toBeDefined();
    expect(curtain.getObjectByName("s-curtain-bottom-bar")?.parent).toBe(curtain);
    expect(leaf.getObjectByName("s-curtain-bottom-bar")).toBeUndefined();
  });

  it("扉の原点はくぐり戸の -X の縦の辺（蝶番）", () => {
    const { data, leaf } = shutter();
    expect(leaf.position.x).toBeCloseTo(data.wicket.centerX - data.wicket.width / 2);
    expect(leaf.position.z).toBeCloseTo(0);
  });

  it("閉じた扉はくぐり戸の開口をふさぐ（扉の板の外接箱がくぐり戸の範囲と重なる）", () => {
    const { group, data, leaf } = shutter();
    const wicketMesh = leaf.getObjectByName("s-wicket");
    if (!wicketMesh) throw new Error("扉の板がない");
    const box = localBox(group, (o) => o === wicketMesh);
    expect(box.min.x).toBeCloseTo(data.wicket.centerX - data.wicket.width / 2);
    expect(box.max.x).toBeCloseTo(data.wicket.centerX + data.wicket.width / 2);
    expect(box.min.y).toBeCloseTo(data.wicket.bottom);
    expect(box.max.y).toBeCloseTo(data.wicket.bottom + data.wicket.height);
  });

  it("作った時は扉が閉じている（開き具合 0・回転 0・近づいていない）", () => {
    const { data, leaf } = shutter();
    expect(data).toMatchObject({ wicketOpen: false, wicketOpenAmount: 0, wicketApproached: false });
    expect(leaf.rotation.y).toBeCloseTo(0);
  });

  it("扉は動く物（静的な結合から外れる）", () => {
    const { leaf } = shutter();
    // 扉自身か，それを含む幕が動く物であること
    expect(
      isDynamicSchoolObject(leaf) || isDynamicSchoolObject(leaf.parent as THREE.Object3D),
    ).toBe(true);
  });

  describe("setFireShutterWicketOpen", () => {
    it("全開で 90° 回り，userData が開いた状態になる", () => {
      const { group, data, leaf } = shutter();
      setFireShutterWicketOpen(group, 1, 1);
      expect(data).toMatchObject({ wicketOpen: true, wicketOpenAmount: 1, wicketSwing: 1 });
      expect(Math.abs(leaf.rotation.y)).toBeCloseTo(Math.PI / 2);
    });

    it("swing 1 は -Z の側へ，-1 は +Z の側へ開く", () => {
      const a = shutter();
      setFireShutterWicketOpen(a.group, 1, 1);
      expect(freeEndZ(a.group, a.leaf)).toBeLessThan(-0.5);
      const b = shutter();
      setFireShutterWicketOpen(b.group, 1, -1);
      expect(freeEndZ(b.group, b.leaf)).toBeGreaterThan(0.5);
    });

    it("0 で閉じる（回転 0・wicketOpen が false）", () => {
      const { group, data, leaf } = shutter();
      setFireShutterWicketOpen(group, 1, -1);
      setFireShutterWicketOpen(group, 0);
      expect(data).toMatchObject({ wicketOpen: false, wicketOpenAmount: 0 });
      expect(leaf.rotation.y).toBeCloseTo(0);
    });

    it("swing を省くと今の向きのまま", () => {
      const { group, data } = shutter();
      setFireShutterWicketOpen(group, 0.5, -1);
      setFireShutterWicketOpen(group, 1);
      expect(data.wicketSwing).toBe(-1);
    });

    it.each([
      [2, 1],
      [-1, 0],
      [Number.NaN, 0],
    ])("範囲外の開き具合 %s は %s に切り詰める", (input, expected) => {
      const { group, data } = shutter();
      setFireShutterWicketOpen(group, input, 1);
      expect(data.wicketOpenAmount).toBe(expected);
      expect(data.wicketOpen).toBe(expected > 0);
    });
  });

  describe("updateFireShutterWicket", () => {
    it("1.5 m 以内に入ると開き始め，0.4 s で全開になる", () => {
      const { group, data, leaf } = shutter();
      const eye = eyeAt(group, 0, 1.4);
      updateFireShutterWicket(group, eye, 0.1);
      expect(data.wicketOpenAmount).toBeCloseTo(0.25);
      expect(data.wicketOpen).toBe(true);
      updateFireShutterWicket(group, eye, 0.1);
      updateFireShutterWicket(group, eye, 0.1);
      updateFireShutterWicket(group, eye, 0.1);
      expect(data.wicketOpenAmount).toBeCloseTo(1);
      expect(Math.abs(leaf.rotation.y)).toBeCloseTo(WICKET_AUTO.maxAngle);
    });

    it("距離は水平（XZ）で測る．目の高さは見ない", () => {
      const { group, data } = shutter();
      const eye = eyeAt(group, 0, 1.4);
      eye.y = 10;
      updateFireShutterWicket(group, eye, 0.1);
      expect(data.wicketOpenAmount).toBeGreaterThan(0);
    });

    it("距離は辺に沿う向き（X）のずれも含めて，くぐり戸の中心から測る", () => {
      const { group, data } = shutter();
      // 中心から X に 1.2・Z に 1.2（水平の距離は約 1.70 m．1.5 m より遠い）
      updateFireShutterWicket(group, eyeAt(group, 1.2, 1.2), 0.1);
      expect(data.wicketOpenAmount).toBe(0);
      // 中心から X に 1.0・Z に 1.0（約 1.41 m）
      updateFireShutterWicket(group, eyeAt(group, 1.0, 1.0), 0.1);
      expect(data.wicketOpenAmount).toBeGreaterThan(0);
    });

    it("くぐり戸がずれていても，ずれた中心から測る", () => {
      const { group, data } = shutter({ wicketOffset: 0.6, length: 4 });
      expect(data.wicket.centerX).toBeCloseTo(0.6);
      // 辺の中心から 1.4 m（くぐり戸の中心からは X に 0.6 ずれて約 1.52 m）
      updateFireShutterWicket(group, group.localToWorld(new THREE.Vector3(0, 1.5, 1.4)), 0.1);
      expect(data.wicketOpenAmount).toBe(0);
    });

    it("1.5 m より遠くて閉じている時は開かない", () => {
      const { group, data } = shutter();
      updateFireShutterWicket(group, eyeAt(group, 0, 1.7), 0.1);
      expect(data).toMatchObject({ wicketOpenAmount: 0, wicketOpen: false });
    });

    it("開いた後は 1.5〜1.9 m の間では開いたまま，1.9 m を超えると閉じ始め 0.4 s で閉じる", () => {
      const { group, data, leaf } = shutter();
      updateFireShutterWicket(group, eyeAt(group, 0, 1.0), 1);
      expect(data.wicketOpenAmount).toBe(1);
      updateFireShutterWicket(group, eyeAt(group, 0, 1.8), 0.1);
      expect(data.wicketOpenAmount).toBe(1);
      updateFireShutterWicket(group, eyeAt(group, 0, 2.0), 0.1);
      expect(data.wicketOpenAmount).toBeCloseTo(0.75);
      // 1.9 m より内へ戻っても，閉じ始めた後は 1.5 m より内へ来るまで閉じ続ける
      updateFireShutterWicket(group, eyeAt(group, 0, 1.8), 0.1);
      expect(data.wicketOpenAmount).toBeCloseTo(0.5);
      updateFireShutterWicket(group, eyeAt(group, 0, 2.0), 0.1);
      updateFireShutterWicket(group, eyeAt(group, 0, 2.0), 0.1);
      expect(data.wicketOpenAmount).toBeCloseTo(0);
      expect(data.wicketOpen).toBe(false);
      expect(leaf.rotation.y).toBeCloseTo(0);
    });

    it.each([
      ["+Z の側", 1.0],
      ["-Z の側", -1.0],
    ])("%s から近づくと反対の側へ開く", (_, z) => {
      const { group, leaf } = shutter();
      updateFireShutterWicket(group, eyeAt(group, 0, z), 1);
      const end = freeEndZ(group, leaf);
      expect(Math.sign(end)).toBe(-Math.sign(z));
      expect(Math.abs(end)).toBeGreaterThan(0.5);
    });

    it("開いている途中で反対の側へ回り込んでも向きは変わらない（閉じ切ってから決め直す）", () => {
      const { group, data } = shutter();
      updateFireShutterWicket(group, eyeAt(group, 0, 1.0), 0.1);
      expect(data.wicketSwing).toBe(1);
      updateFireShutterWicket(group, eyeAt(group, 0, -1.0), 0.1);
      updateFireShutterWicket(group, eyeAt(group, 0, -1.0), 1);
      expect(data.wicketSwing).toBe(1);
      // 離れて閉じ切った後に -Z の側から近づくと +Z の側へ開く
      updateFireShutterWicket(group, eyeAt(group, 0, -3), 1);
      expect(data.wicketOpenAmount).toBe(0);
      updateFireShutterWicket(group, eyeAt(group, 0, -1.0), 0.1);
      expect(data.wicketSwing).toBe(-1);
    });

    it("シャッターがワールドで回っていても，シャッターのローカルで距離と側を測る", () => {
      const parent = new THREE.Group();
      const { group, data, leaf } = shutter();
      parent.add(group);
      parent.position.set(10, 0, 5);
      parent.rotation.y = Math.PI / 2;
      parent.updateMatrixWorld(true);
      const eye = eyeAt(group, 0, 1.2);
      updateFireShutterWicket(group, eye, 1);
      expect(data.wicketOpenAmount).toBe(1);
      expect(Math.sign(freeEndZ(group, leaf))).toBe(-1);
    });

    it("dt が無ければ瞬時に開閉する", () => {
      const { group, data } = shutter();
      updateFireShutterWicket(group, eyeAt(group, 0, 1.0));
      expect(data.wicketOpenAmount).toBe(1);
      updateFireShutterWicket(group, eyeAt(group, 0, 3.0));
      expect(data.wicketOpenAmount).toBe(0);
    });

    it("目が無い（null）なら閉じる", () => {
      const { group, data } = shutter();
      updateFireShutterWicket(group, eyeAt(group, 0, 1.0), 1);
      expect(data.wicketOpenAmount).toBe(1);
      updateFireShutterWicket(group, null, 1);
      expect(data).toMatchObject({ wicketOpenAmount: 0, wicketOpen: false });
    });

    it("シャッターが開いている時は，近づいても扉は閉じたまま", () => {
      const { group, data, leaf } = shutter({ closed: false });
      updateFireShutterWicket(group, eyeAt(group, 0, 0.5), 1);
      expect(data).toMatchObject({ wicketOpenAmount: 0, wicketOpen: false });
      expect(leaf.rotation.y).toBeCloseTo(0);
    });

    it("扉が開いた後にシャッターを開けると，扉は閉じた状態に戻る", () => {
      const { group, data, leaf } = shutter();
      updateFireShutterWicket(group, eyeAt(group, 0, 1.0), 1);
      expect(data.wicketOpenAmount).toBe(1);
      setFireShutterClosed(group, false);
      updateFireShutterWicket(group, eyeAt(group, 0, 1.0), 0.01);
      expect(data).toMatchObject({ wicketOpenAmount: 0, wicketOpen: false });
      expect(leaf.rotation.y).toBeCloseTo(0);
    });
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
