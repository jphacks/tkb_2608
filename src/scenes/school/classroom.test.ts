// 教室のパーツの three.js の組み立て（classroom.ts）のテスト．基準は引継ぎメモ:
// createClassroom(ctx, { interior: "furnished" | "shell" })．shell は机・椅子・黒板・教卓・照明を作らない．
// 原点は床の面の中心で，黒板は -Z 側．canvas は何もしない物に差し替える

import * as THREE from "three";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { createClassroom } from "./classroom";
import { type ClassroomUserData, classroomLayout } from "./classroomLayout";
import {
  createSchoolPartContext,
  disposeSchoolPartContext,
  type SchoolPartContext,
} from "./schoolParts";

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

function names(group: THREE.Object3D): string[] {
  const list: string[] = [];
  group.traverse((o) => {
    if (o instanceof THREE.Mesh) list.push(o.name);
  });
  return list.sort();
}

describe("createClassroom", () => {
  it("中身ありは床の面（照明つき）・机と椅子・教卓・黒板を持つ", () => {
    const room = createClassroom(context, { width: 8, depth: 8, ceilingHeight: 3, id: "r" });
    expect(room.name).toBe("r");
    expect(names(room)).toEqual(
      [
        "r-blackboard",
        "r-blackboard-frame",
        "r-desks-metal",
        "r-desks-storage",
        "r-desks-wood",
        "r-surface-ceiling",
        "r-surface-floor",
        "r-surface-lights",
        "r-teacher-desk",
        "r-teacher-desk-top",
      ].sort(),
    );
  });

  it("userData に中身の有無と机の列数・行数を持つ（classroomLayout と同じ）", () => {
    const room = createClassroom(context, { width: 7, depth: 9, ceilingHeight: 3, id: "r" });
    const layout = classroomLayout(7, 9);
    const data: ClassroomUserData = {
      kind: "schoolClassroom",
      id: "r",
      width: 7,
      depth: 9,
      ceilingHeight: 3,
      interior: "furnished",
      furnished: true,
      columns: layout.columns,
      rows: layout.rows,
    };
    expect(room.userData).toEqual(data);
  });

  it("机と椅子は机の数だけの InstancedMesh にまとめる（机 1 組に天板・座面・背もたれ）", () => {
    const room = createClassroom(context, { width: 8, depth: 8, ceilingHeight: 3, id: "r" });
    const wood = room.getObjectByName("r-desks-wood");
    expect(wood).toBeInstanceOf(THREE.InstancedMesh);
    expect((wood as THREE.InstancedMesh).count).toBe(classroomLayout(8, 8).desks.length * 3);
  });

  it("黒板は -Z の側，教卓は黒板と机の間", () => {
    const room = createClassroom(context, { width: 8, depth: 8, ceilingHeight: 3, id: "r" });
    const board = room.getObjectByName("r-blackboard");
    const top = room.getObjectByName("r-teacher-desk-top");
    if (!board || !top) throw new Error("黒板・教卓がない");
    expect(board.position.z).toBeLessThan(-3.5);
    expect(top.position.z).toBeGreaterThan(board.position.z);
    const firstDesk = Math.min(...classroomLayout(8, 8).desks.map((d) => d.z));
    expect(top.position.z).toBeLessThan(firstDesk);
  });

  it("外側だけ（shell）は床・天井だけで，机・椅子・黒板・教卓・照明を作らない", () => {
    const room = createClassroom(context, {
      width: 8,
      depth: 8,
      ceilingHeight: 3,
      id: "s",
      interior: "shell",
    });
    expect(names(room)).toEqual(["s-surface-ceiling", "s-surface-floor"]);
    expect(room.userData).toMatchObject({
      interior: "shell",
      furnished: false,
      columns: 0,
      rows: 0,
    });
  });

  it("下限より小さい教室は中身ありを指定しても中身を作らない", () => {
    const room = createClassroom(context, { width: 2, depth: 2, ceilingHeight: 3, id: "t" });
    expect(room.userData).toMatchObject({ interior: "furnished", furnished: false });
    expect(room.getObjectByName("t-desks-wood")).toBeUndefined();
    expect(room.getObjectByName("t-blackboard")).toBeUndefined();
  });

  it("床の面は子として 1 つ持ち，教室の床（schoolFloor）として当たり判定に使える", () => {
    const room = createClassroom(context, { width: 8, depth: 6, ceilingHeight: 3, id: "r" });
    const surface = room.getObjectByName("r-surface");
    expect(surface?.userData).toMatchObject({
      kind: "schoolFloor",
      floorKind: "classroom",
      width: 8,
      depth: 6,
      ceilingHeight: 3,
    });
  });

  it("天井が低すぎる・幅が数でないと RangeError", () => {
    expect(() => createClassroom(context, { width: 8, depth: 8, ceilingHeight: 2 })).toThrow(
      RangeError,
    );
    expect(() =>
      createClassroom(context, { width: Number.NaN, depth: 8, ceilingHeight: 3 }),
    ).toThrow(RangeError);
  });
});
