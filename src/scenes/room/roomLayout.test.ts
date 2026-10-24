import { describe, expect, it } from "vitest";
import { computeFootprint } from "../common/furniture";
import { splitWallAroundOpening, wallPointToWorld, wallRectCenter } from "../common/wallLayout";
import {
  DOOR_OPENING,
  ROOM,
  ROOM_FURNITURE,
  ROOM_START,
  WALLS,
  WINDOW_OPENING,
} from "./roomLayout";

const HALF_W = 3;
const HALF_D = 2.5;
const EPS = 1e-9;

describe("部屋の寸法", () => {
  it("6m × 5m × 高さ 2.4m", () => {
    expect(ROOM).toMatchObject({ width: 6, depth: 5, height: 2.4 });
  });
});

describe("壁 4 面", () => {
  const walls = Object.values(WALLS);

  it("4 面ある", () => {
    expect(walls).toHaveLength(4);
  });

  it("各面は床の四隅を結び，長さは部屋の辺と一致する", () => {
    const corners = new Set(["-3,-2.5", "3,-2.5", "3,2.5", "-3,2.5"]);
    for (const w of walls) {
      const start = wallPointToWorld(w, 0, 0);
      const end = wallPointToWorld(w, w.length, 0);
      expect(start[1]).toBe(0);
      expect(corners.has(`${start[0]},${start[2]}`)).toBe(true);
      expect(corners.has(`${end[0]},${end[2]}`)).toBe(true);
    }
  });

  it("法線は部屋の内側（原点側）を向く", () => {
    for (const w of walls) {
      const mid = wallPointToWorld(w, w.length / 2, 0);
      const toCenter = [-mid[0], -mid[2]];
      expect(w.normal[0] * toCenter[0] + w.normal[2] * toCenter[1]).toBeGreaterThan(0);
    }
  });

  it("北は -Z（z=-2.5），南は +Z（z=2.5）", () => {
    expect(wallPointToWorld(WALLS.north, 1, 0)[2]).toBe(-HALF_D);
    expect(wallPointToWorld(WALLS.south, 1, 0)[2]).toBe(HALF_D);
  });
});

describe("窓（-Z 壁）", () => {
  it("中心 x=0，幅 2，下端 0.8，高さ 1.2", () => {
    expect(WINDOW_OPENING.u1 - WINDOW_OPENING.u0).toBeCloseTo(2);
    expect(WINDOW_OPENING.v0).toBeCloseTo(0.8);
    expect(WINDOW_OPENING.v1 - WINDOW_OPENING.v0).toBeCloseTo(1.2);
    const c = wallRectCenter(WALLS.north, WINDOW_OPENING);
    expect(c[0]).toBeCloseTo(0);
    expect(c[2]).toBeCloseTo(-HALF_D);
  });

  it("タスクで示された値と一致する", () => {
    expect(WINDOW_OPENING).toEqual({ u0: 2, u1: 4, v0: 0.8, v1: 2 });
  });

  it("壁の中に収まり，分割すると 4 枚", () => {
    expect(splitWallAroundOpening(WALLS.north.length, ROOM.height, WINDOW_OPENING)).toHaveLength(4);
  });
});

describe("ドア（+Z 壁）", () => {
  it("中心 x=0，幅 0.85，高さ 2（床から）", () => {
    expect(DOOR_OPENING.u1 - DOOR_OPENING.u0).toBeCloseTo(0.85);
    expect(DOOR_OPENING.v0).toBe(0);
    expect(DOOR_OPENING.v1).toBeCloseTo(2);
    const c = wallRectCenter(WALLS.south, DOOR_OPENING);
    expect(c[0]).toBeCloseTo(0);
    expect(c[2]).toBeCloseTo(HALF_D);
  });

  it("タスクで示された値と一致する", () => {
    expect(DOOR_OPENING.u0).toBeCloseTo(2.575);
    expect(DOOR_OPENING.u1).toBeCloseTo(3.425);
  });
});

describe("開始位置", () => {
  it("(0, 1.6, 1.8) で -Z 向き（yaw=0）", () => {
    expect(ROOM_START.position[0]).toBeCloseTo(0);
    expect(ROOM_START.position[1]).toBeCloseTo(1.6);
    expect(ROOM_START.position[2]).toBeCloseTo(1.8);
    expect(ROOM_START.yaw).toBe(0);
  });

  it("開始位置はどの家具の床占有範囲にも入らない", () => {
    for (const f of ROOM_FURNITURE) {
      if (f.mount !== "floor") continue;
      const fp = computeFootprint({ x: f.position[0], z: f.position[2] }, f.rotationY, f.size);
      const inside =
        Math.abs(ROOM_START.position[0] - fp.centerX) < fp.halfX &&
        Math.abs(ROOM_START.position[2] - fp.centerZ) < fp.halfZ;
      expect(inside, f.id).toBe(false);
    }
  });
});

describe("家具", () => {
  it("12 点で id は重複しない", () => {
    expect(ROOM_FURNITURE).toHaveLength(12);
    expect(new Set(ROOM_FURNITURE.map((f) => f.id)).size).toBe(12);
  });

  it.each(ROOM_FURNITURE.map((f) => [f.id, f] as const))("%s は部屋の中に収まる", (_id, f) => {
    const fp = computeFootprint({ x: f.position[0], z: f.position[2] }, f.rotationY, f.size);
    expect(fp.centerX - fp.halfX).toBeGreaterThanOrEqual(-HALF_W - EPS);
    expect(fp.centerX + fp.halfX).toBeLessThanOrEqual(HALF_W + EPS);
    expect(fp.centerZ - fp.halfZ).toBeGreaterThanOrEqual(-HALF_D - EPS);
    expect(fp.centerZ + fp.halfZ).toBeLessThanOrEqual(HALF_D + EPS);

    const y = f.position[1];
    const h = f.size.y;
    const [bottom, top] =
      f.origin === "bottom" ? [y, y + h] : f.origin === "top" ? [y - h, y] : [y - h / 2, y + h / 2];
    expect(bottom).toBeGreaterThanOrEqual(-EPS);
    expect(top).toBeLessThanOrEqual(ROOM.height + EPS);
  });

  it("寸法・質量は正", () => {
    for (const f of ROOM_FURNITURE) {
      expect(f.size.x).toBeGreaterThan(0);
      expect(f.size.y).toBeGreaterThan(0);
      expect(f.size.z).toBeGreaterThan(0);
      expect(f.mass).toBeGreaterThan(0);
    }
  });

  it("restsOn は存在する家具を指し，その上面に載る", () => {
    const byId = new Map(ROOM_FURNITURE.map((f) => [f.id, f]));
    for (const f of ROOM_FURNITURE) {
      if (f.restsOn === null) {
        expect(f.mount).not.toBe("top");
        continue;
      }
      const base = byId.get(f.restsOn);
      expect(base, f.id).toBeDefined();
      if (!base) continue;
      expect(f.mount).toBe("top");
      expect(f.position[1]).toBeCloseTo(base.position[1] + base.size.y);
    }
  });

  it("天井吊りは天井に，壁掛けは壁に接する", () => {
    for (const f of ROOM_FURNITURE) {
      if (f.mount === "ceiling") {
        expect(f.origin).toBe("top");
        expect(f.position[1]).toBeCloseTo(ROOM.height);
      }
      if (f.mount === "wall") {
        const fp = computeFootprint({ x: f.position[0], z: f.position[2] }, f.rotationY, f.size);
        const touches =
          Math.abs(fp.centerX - fp.halfX + HALF_W) < 1e-6 ||
          Math.abs(fp.centerX + fp.halfX - HALF_W) < 1e-6 ||
          Math.abs(fp.centerZ - fp.halfZ + HALF_D) < 1e-6 ||
          Math.abs(fp.centerZ + fp.halfZ - HALF_D) < 1e-6;
        expect(touches, f.id).toBe(true);
      }
    }
  });

  it("床置きの家具どうしの床占有範囲は重ならない", () => {
    const floor = ROOM_FURNITURE.filter((f) => f.mount === "floor").map((f) => ({
      id: f.id,
      fp: computeFootprint({ x: f.position[0], z: f.position[2] }, f.rotationY, f.size),
    }));
    for (let i = 0; i < floor.length; i++) {
      for (let j = i + 1; j < floor.length; j++) {
        const a = floor[i].fp;
        const b = floor[j].fp;
        const overlap =
          Math.abs(a.centerX - b.centerX) < a.halfX + b.halfX - 1e-6 &&
          Math.abs(a.centerZ - b.centerZ) < a.halfZ + b.halfZ - 1e-6;
        expect(overlap, `${floor[i].id} と ${floor[j].id}`).toBe(false);
      }
    }
  });

  it("床置きの家具はドアの開口部の前（内側 0.5m）をふさがない", () => {
    for (const f of ROOM_FURNITURE) {
      if (f.mount !== "floor") continue;
      const fp = computeFootprint({ x: f.position[0], z: f.position[2] }, f.rotationY, f.size);
      const blocks =
        Math.abs(fp.centerX - 0) < fp.halfX + 0.425 && fp.centerZ + fp.halfZ > HALF_D - 0.5;
      expect(blocks, f.id).toBe(false);
    }
  });
});
