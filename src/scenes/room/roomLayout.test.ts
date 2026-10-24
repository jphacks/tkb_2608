// 部屋（リビング）の配置（three 非依存の定数と純粋な関数）．要件（シナリオ PLAN_04 の H1）を基準に確かめる

import { describe, expect, it } from "vitest";
import { computeFootprint, type Footprint } from "../common/furniture";
import { mulberry32 } from "../common/random";
import { splitWallAroundOpening, wallPointToWorld, wallRectCenter } from "../common/wallLayout";
import {
  BOOKSHELF_ID,
  BREAKER_PANEL_ID,
  breakerSwitchHeight,
  COUNTER_ID,
  DOOR,
  DOOR_OPENING,
  DOOR_SPAN_X,
  EYE_HEIGHT,
  type FloorRect,
  furnitureDefFootprint,
  GLASS_SHARDS,
  glassShardLayout,
  HALLWAY,
  HALLWAY_DOOR_OPENING,
  HALLWAY_WALLS,
  ROOM,
  ROOM_AREAS,
  ROOM_FURNITURE,
  ROOM_START,
  type RoomArea,
  type RoomAreaId,
  roomDoorRotationY,
  roomFurnitureDef,
  STOVE_BURNERS,
  STOVE_ID,
  TABLE_ID,
  TV_ID,
  tableLegId,
  tableLegLocalPositions,
  tableUndersideY,
  WALL_THICKNESS,
  WALLS,
  WINDOW,
  WINDOW_OPENING,
} from "./roomLayout";

const HALF_W = 3;
const HALF_D = 2.5;
const EPS = 1e-9;

const START_X = ROOM_START.position[0];
const START_Z = ROOM_START.position[2];

function rectOf(fp: Footprint): FloorRect {
  return {
    minX: fp.centerX - fp.halfX,
    maxX: fp.centerX + fp.halfX,
    minZ: fp.centerZ - fp.halfZ,
    maxZ: fp.centerZ + fp.halfZ,
  };
}

function defRect(id: string): FloorRect {
  return rectOf(furnitureDefFootprint(roomFurnitureDef(id)));
}

function area(id: RoomAreaId): RoomArea {
  const a = ROOM_AREAS.find((x) => x.id === id);
  if (!a) throw new Error(id);
  return a;
}

function inside(r: FloorRect, x: number, z: number): boolean {
  return x > r.minX && x < r.maxX && z > r.minZ && z < r.maxZ;
}

function rectsOverlap(a: FloorRect, b: FloorRect): boolean {
  return (
    Math.min(a.maxX, b.maxX) - Math.max(a.minX, b.minX) > 1e-6 &&
    Math.min(a.maxZ, b.maxZ) - Math.max(a.minZ, b.minZ) > 1e-6
  );
}

function rectContains(outer: FloorRect, inner: FloorRect): boolean {
  return (
    inner.minX >= outer.minX - EPS &&
    inner.maxX <= outer.maxX + EPS &&
    inner.minZ >= outer.minZ - EPS &&
    inner.maxZ <= outer.maxZ + EPS
  );
}

function center(r: FloorRect): [number, number] {
  return [(r.minX + r.maxX) / 2, (r.minZ + r.maxZ) / 2];
}

/** 点から矩形までの距離（内側は 0） */
function distToRect(r: FloorRect, x: number, z: number): number {
  const dx = Math.max(r.minX - x, 0, x - r.maxX);
  const dz = Math.max(r.minZ - z, 0, z - r.maxZ);
  return Math.hypot(dx, dz);
}

/** 開始の向き（yaw）から見た前・左の単位ベクトル（XZ）．yaw=0 で -Z を向き，正で左へ回る */
const FORWARD: [number, number] = [-Math.sin(ROOM_START.yaw), -Math.cos(ROOM_START.yaw)];
const LEFT: [number, number] = [-Math.cos(ROOM_START.yaw), Math.sin(ROOM_START.yaw)];

/** 開始位置から見た (前, 左) の成分 */
function relative(x: number, z: number): { forward: number; left: number } {
  const dx = x - START_X;
  const dz = z - START_Z;
  return {
    forward: dx * FORWARD[0] + dz * FORWARD[1],
    left: dx * LEFT[0] + dz * LEFT[1],
  };
}

const floorDefs = ROOM_FURNITURE.filter((f) => f.mount === "floor");

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

  it("壁の厚みは正", () => {
    expect(WALL_THICKNESS).toBeGreaterThan(0);
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
  it("中心 x=DOOR.centerX，幅 0.85，高さ 2（床から）", () => {
    expect(DOOR_OPENING.u1 - DOOR_OPENING.u0).toBeCloseTo(0.85);
    expect(DOOR_OPENING.v0).toBe(0);
    expect(DOOR_OPENING.v1).toBeCloseTo(2);
    const c = wallRectCenter(WALLS.south, DOOR_OPENING);
    expect(c[0]).toBeCloseTo(DOOR.centerX);
    expect(c[2]).toBeCloseTo(HALF_D);
  });

  it("タスクで示された値と一致する（u0=1.675，u1=2.525）", () => {
    expect(DOOR_OPENING.u0).toBeCloseTo(1.675);
    expect(DOOR_OPENING.u1).toBeCloseTo(2.525);
  });

  it("DOOR_SPAN_X は開口部のワールドの x の範囲と一致する", () => {
    const xs = [
      wallPointToWorld(WALLS.south, DOOR_OPENING.u0, 0)[0],
      wallPointToWorld(WALLS.south, DOOR_OPENING.u1, 0)[0],
    ].sort((a, b) => a - b);
    expect(DOOR_SPAN_X.minX).toBeCloseTo(xs[0]);
    expect(DOOR_SPAN_X.maxX).toBeCloseTo(xs[1]);
  });

  it("壁の中に収まり，分割すると 3 枚（床まで開く）", () => {
    expect(DOOR_OPENING.u0).toBeGreaterThan(0);
    expect(DOOR_OPENING.u1).toBeLessThan(WALLS.south.length);
    expect(splitWallAroundOpening(WALLS.south.length, ROOM.height, DOOR_OPENING)).toHaveLength(3);
  });

  it("開始位置から見て右にある", () => {
    const c = wallRectCenter(WALLS.south, DOOR_OPENING);
    expect(relative(c[0], c[2]).left).toBeLessThan(0);
  });
});

describe("roomDoorRotationY", () => {
  const door = { closedRotationY: Math.PI, openInwardSign: 1 as const, maxOpenAngle: 1.5 };

  it("開き角 0 で閉じた向き", () => {
    expect(roomDoorRotationY(door, 0)).toBeCloseTo(Math.PI);
  });

  it("開き角の向きは openInwardSign に従う", () => {
    expect(roomDoorRotationY(door, 0.5)).toBeCloseTo(Math.PI + 0.5);
    expect(roomDoorRotationY({ ...door, openInwardSign: -1 }, 0.5)).toBeCloseTo(Math.PI - 0.5);
  });

  it("0〜maxOpenAngle に丸める", () => {
    expect(roomDoorRotationY(door, -1)).toBeCloseTo(Math.PI);
    expect(roomDoorRotationY(door, 10)).toBeCloseTo(Math.PI + 1.5);
  });
});

describe("目の高さ", () => {
  it("立ち 1.6m，しゃがみ 0.55m", () => {
    expect(EYE_HEIGHT.standing).toBeCloseTo(1.6);
    expect(EYE_HEIGHT.crouching).toBeCloseTo(0.55);
  });

  it("しゃがんだ目の高さはテーブルの天板の下面より低い（テーブルの下に潜れる）", () => {
    const table = roomFurnitureDef(TABLE_ID);
    expect(tableUndersideY(table.size)).toBeLessThan(table.size.y);
    expect(EYE_HEIGHT.crouching).toBeLessThan(tableUndersideY(table.size));
  });
});

describe("開始位置", () => {
  it("(-0.6, 1.6, 0.2) で +X 向き（yaw=-π/2）", () => {
    expect(ROOM_START.position[0]).toBeCloseTo(-0.6);
    expect(ROOM_START.position[1]).toBeCloseTo(EYE_HEIGHT.standing);
    expect(ROOM_START.position[2]).toBeCloseTo(0.2);
    expect(ROOM_START.yaw).toBeCloseTo(-Math.PI / 2);
    expect(FORWARD[0]).toBeCloseTo(1);
    expect(FORWARD[1]).toBeCloseTo(0);
  });

  it("居間の中央付近（中心から 1.5m 以内）", () => {
    expect(Math.hypot(START_X, START_Z)).toBeLessThan(1.5);
  });

  it("開始位置はどの家具の床占有範囲にも入らない", () => {
    for (const f of ROOM_FURNITURE) {
      if (f.mount !== "floor") continue;
      expect(inside(rectOf(furnitureDefFootprint(f)), START_X, START_Z), f.id).toBe(false);
    }
  });

  it("開始位置はどのエリアにも入っていない", () => {
    for (const a of ROOM_AREAS) {
      expect(inside(a, START_X, START_Z), a.id).toBe(false);
    }
  });
});

describe("開始位置から見た配置（H1）", () => {
  function centerOf(id: string): { forward: number; left: number } {
    const def = roomFurnitureDef(id);
    return relative(def.position[0], def.position[2]);
  }

  it("奥（正面）にコンロ", () => {
    const r = centerOf(STOVE_ID);
    expect(r.forward).toBeGreaterThan(0);
    expect(Math.abs(r.left)).toBeLessThan(r.forward);
  });

  it("左に窓と背の高い本棚", () => {
    const w = wallRectCenter(WALLS.north, WINDOW_OPENING);
    expect(relative(w[0], w[2]).left).toBeGreaterThan(0);
    expect(centerOf(BOOKSHELF_ID).left).toBeGreaterThan(0);
    // 背の高い本棚（立った目の高さに近い）
    expect(roomFurnitureDef(BOOKSHELF_ID).size.y).toBeGreaterThanOrEqual(1.5);
    expect(roomFurnitureDef(BOOKSHELF_ID).tipRisk).toBe("high");
  });

  it("右にドアとブレーカー", () => {
    expect(relative(DOOR.centerX, HALF_D).left).toBeLessThan(0);
    expect(centerOf(BREAKER_PANEL_ID).left).toBeLessThan(0);
  });

  it("後ろにテレビ", () => {
    const r = centerOf(TV_ID);
    expect(r.forward).toBeLessThan(0);
    expect(Math.abs(r.left)).toBeLessThan(-r.forward);
  });

  it("近くにテーブル（床占有範囲まで 1.5m 以内）", () => {
    expect(distToRect(defRect(TABLE_ID), START_X, START_Z)).toBeLessThan(1.5);
  });
});

describe("家具", () => {
  it("15 点で id は重複しない", () => {
    expect(ROOM_FURNITURE).toHaveLength(15);
    expect(new Set(ROOM_FURNITURE.map((f) => f.id)).size).toBe(15);
  });

  it("テーブル・本棚・コンロ・カウンター・分電盤・テレビがある", () => {
    const kinds = new Set(ROOM_FURNITURE.map((f) => f.kind));
    for (const k of ["table", "bookshelf", "stove", "kitchenCounter", "breakerPanel", "tv"]) {
      expect(kinds.has(k as never), k).toBe(true);
    }
    expect(roomFurnitureDef(TABLE_ID).kind).toBe("table");
    expect(roomFurnitureDef(STOVE_ID).kind).toBe("stove");
    expect(roomFurnitureDef(COUNTER_ID).kind).toBe("kitchenCounter");
    expect(roomFurnitureDef(BREAKER_PANEL_ID).kind).toBe("breakerPanel");
    expect(roomFurnitureDef(TV_ID).kind).toBe("tv");
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

  it("restsOn は存在する家具を指し，その上面に載り，床占有範囲が下の家具に収まる", () => {
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
      expect(
        rectContains(rectOf(furnitureDefFootprint(base)), rectOf(furnitureDefFootprint(f))),
        `${f.id} on ${base.id}`,
      ).toBe(true);
    }
  });

  it("コンロはカウンターの上に載る", () => {
    const stove = roomFurnitureDef(STOVE_ID);
    expect(stove.restsOn).toBe(COUNTER_ID);
    expect(stove.mount).toBe("top");
  });

  it("天井吊りは天井に，壁掛けは壁に接する", () => {
    for (const f of ROOM_FURNITURE) {
      if (f.mount === "ceiling") {
        expect(f.origin).toBe("top");
        expect(f.position[1]).toBeCloseTo(ROOM.height);
      }
      if (f.mount === "wall") {
        const fp = furnitureDefFootprint(f);
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
    for (let i = 0; i < floorDefs.length; i++) {
      for (let j = i + 1; j < floorDefs.length; j++) {
        const a = rectOf(furnitureDefFootprint(floorDefs[i]));
        const b = rectOf(furnitureDefFootprint(floorDefs[j]));
        expect(rectsOverlap(a, b), `${floorDefs[i].id} と ${floorDefs[j].id}`).toBe(false);
      }
    }
  });

  it("床置きの家具はドアの開口部の前（内側 0.5m）をふさがない", () => {
    const front: FloorRect = {
      minX: DOOR_SPAN_X.minX,
      maxX: DOOR_SPAN_X.maxX,
      minZ: HALF_D - 0.5,
      maxZ: HALF_D,
    };
    expect(front.maxX - front.minX).toBeCloseTo(DOOR.width);
    expect((front.minX + front.maxX) / 2).toBeCloseTo(DOOR.centerX);
    for (const f of floorDefs) {
      expect(rectsOverlap(rectOf(furnitureDefFootprint(f)), front), f.id).toBe(false);
    }
  });

  it("ドアが部屋の内側へ開く範囲（ヒンジ中心・半径はドアの幅）に床置きの家具が無い", () => {
    const hingeX = DOOR.hingeSide === "left" ? DOOR_SPAN_X.maxX : DOOR_SPAN_X.minX;
    for (const f of floorDefs) {
      expect(distToRect(rectOf(furnitureDefFootprint(f)), hingeX, HALF_D), f.id).toBeGreaterThan(
        DOOR.width,
      );
    }
  });

  it("roomFurnitureDef は id で引け，無い id は例外", () => {
    for (const f of ROOM_FURNITURE) expect(roomFurnitureDef(f.id)).toBe(f);
    expect(() => roomFurnitureDef("no-such-furniture")).toThrow();
  });

  it("furnitureDefFootprint は位置・回転・寸法から床占有範囲を求める", () => {
    for (const f of ROOM_FURNITURE) {
      expect(furnitureDefFootprint(f)).toEqual(
        computeFootprint({ x: f.position[0], z: f.position[2] }, f.rotationY, f.size),
      );
    }
  });
});

describe("テーブル", () => {
  const table = roomFurnitureDef(TABLE_ID);

  it("脚 4 本の位置は天板の四隅の内側で，床（y=0）に立つ", () => {
    const legs = tableLegLocalPositions(table.size);
    expect(legs).toHaveLength(4);
    const signs = legs.map(([x, , z]) => `${Math.sign(x)},${Math.sign(z)}`);
    expect(signs).toEqual(["-1,-1", "1,-1", "-1,1", "1,1"]);
    for (const [x, y, z] of legs) {
      expect(y).toBe(0);
      expect(Math.abs(x)).toBeLessThan(table.size.x / 2);
      expect(Math.abs(z)).toBeLessThan(table.size.z / 2);
    }
    expect(new Set(legs.map((p) => p.join(","))).size).toBe(4);
  });

  it("脚の id は「テーブルの id-leg-番号（1 から）」", () => {
    expect(tableLegId(TABLE_ID, 0)).toBe(`${TABLE_ID}-leg-1`);
    expect(tableLegId("t", 3)).toBe("t-leg-4");
    const ids = [0, 1, 2, 3].map((i) => tableLegId(TABLE_ID, i));
    expect(new Set(ids).size).toBe(4);
  });

  it("天板の下面は天板の高さより低く，床より高い", () => {
    const y = tableUndersideY(table.size);
    expect(y).toBeGreaterThan(0);
    expect(y).toBeLessThan(table.size.y);
  });

  it("開始位置から潜り込める側（開始位置に面した側）に椅子が無い", () => {
    const t = defRect(TABLE_ID);
    // 開始位置からテーブルへの向きで，テーブルの手前の辺の外側 0.6m の帯
    const [cx, cz] = center(t);
    const dx = cx - START_X;
    const dz = cz - START_Z;
    const approach: FloorRect =
      Math.abs(dx) >= Math.abs(dz)
        ? dx > 0
          ? { minX: t.minX - 0.6, maxX: t.minX, minZ: t.minZ, maxZ: t.maxZ }
          : { minX: t.maxX, maxX: t.maxX + 0.6, minZ: t.minZ, maxZ: t.maxZ }
        : dz > 0
          ? { minX: t.minX, maxX: t.maxX, minZ: t.minZ - 0.6, maxZ: t.minZ }
          : { minX: t.minX, maxX: t.maxX, minZ: t.maxZ, maxZ: t.maxZ + 0.6 };
    for (const f of floorDefs) {
      if (f.id === TABLE_ID) continue;
      expect(rectsOverlap(rectOf(furnitureDefFootprint(f)), approach), f.id).toBe(false);
    }
  });
});

describe("コンロ", () => {
  it("口ごとにつまみと火が 1 対 1 で対応し，id は重複しない", () => {
    expect(STOVE_BURNERS.length).toBeGreaterThanOrEqual(1);
    const ids = STOVE_BURNERS.flatMap((b) => [b.knobId, b.flameId]);
    expect(new Set(ids).size).toBe(ids.length);
    STOVE_BURNERS.forEach((b, i) => {
      expect(b.index).toBe(i + 1);
      expect(Math.abs(b.x)).toBeLessThan(roomFurnitureDef(STOVE_ID).size.x / 2);
    });
  });
});

describe("ブレーカー", () => {
  const panel = roomFurnitureDef(BREAKER_PANEL_ID);

  it("メインスイッチは手の判定のため高さ 1.2〜1.4m（1.33m）", () => {
    expect(breakerSwitchHeight()).toBeGreaterThanOrEqual(1.2);
    expect(breakerSwitchHeight()).toBeLessThanOrEqual(1.4);
    expect(breakerSwitchHeight()).toBeCloseTo(1.33);
  });

  it("分電盤はドアのある南の壁に掛かり，ドアの横（開口部の外，0.6m 以内）にある", () => {
    expect(panel.mount).toBe("wall");
    const r = defRect(BREAKER_PANEL_ID);
    expect(r.maxZ).toBeCloseTo(HALF_D);
    const overlapsDoor = Math.min(r.maxX, DOOR_SPAN_X.maxX) - Math.max(r.minX, DOOR_SPAN_X.minX);
    expect(overlapsDoor).toBeLessThanOrEqual(1e-6);
    const gap = Math.max(r.minX - DOOR_SPAN_X.maxX, DOOR_SPAN_X.minX - r.maxX);
    expect(gap).toBeGreaterThanOrEqual(0);
    expect(gap).toBeLessThan(0.6);
  });

  it("分電盤はドアの開口部の枠と重ならない（枠の外）", () => {
    const r = defRect(BREAKER_PANEL_ID);
    const frameMin = DOOR_SPAN_X.minX - DOOR.frameWidth;
    const frameMax = DOOR_SPAN_X.maxX + DOOR.frameWidth;
    expect(Math.min(r.maxX, frameMax) - Math.max(r.minX, frameMin)).toBeLessThanOrEqual(1e-6);
  });
});

describe("ガラスの破片", () => {
  it("範囲は窓の近くの床（窓の幅の中，北の壁から 1m 以内）で部屋の中", () => {
    const a = GLASS_SHARDS.area;
    expect(a.minX).toBeGreaterThanOrEqual(WINDOW.centerX - WINDOW.width / 2 - EPS);
    expect(a.maxX).toBeLessThanOrEqual(WINDOW.centerX + WINDOW.width / 2 + EPS);
    expect(a.minZ).toBeGreaterThanOrEqual(-HALF_D);
    expect(a.maxZ).toBeLessThanOrEqual(-HALF_D + 1);
    expect(a.maxX).toBeGreaterThan(a.minX);
    expect(a.maxZ).toBeGreaterThan(a.minZ);
  });

  it("glassShardLayout は count 枚を返し，同じ乱数列なら同じ並び", () => {
    const args = [
      GLASS_SHARDS.count,
      GLASS_SHARDS.area,
      GLASS_SHARDS.minSize,
      GLASS_SHARDS.maxSize,
    ] as const;
    const a = glassShardLayout(mulberry32(1), ...args);
    const b = glassShardLayout(mulberry32(1), ...args);
    expect(a).toHaveLength(GLASS_SHARDS.count);
    expect(a).toEqual(b);
    expect(glassShardLayout(mulberry32(2), ...args)).not.toEqual(a);
  });

  it.each([
    ["シード固定の乱数", () => mulberry32(GLASS_SHARDS.seed)],
    ["常に 0", () => () => 0],
    ["常に 1 に近い値", () => () => 0.999999],
  ] as const)("%s でも破片は範囲からはみ出さず，大きさは min〜max", (_label, makeRand) => {
    const area = GLASS_SHARDS.area;
    const shards = glassShardLayout(
      makeRand(),
      20,
      area,
      GLASS_SHARDS.minSize,
      GLASS_SHARDS.maxSize,
    );
    for (const s of shards) {
      expect(s.size).toBeGreaterThanOrEqual(GLASS_SHARDS.minSize - EPS);
      expect(s.size).toBeLessThanOrEqual(GLASS_SHARDS.maxSize + EPS);
      expect(s.x - s.size / 2).toBeGreaterThanOrEqual(area.minX - EPS);
      expect(s.x + s.size / 2).toBeLessThanOrEqual(area.maxX + EPS);
      expect(s.z - s.size / 2).toBeGreaterThanOrEqual(area.minZ - EPS);
      expect(s.z + s.size / 2).toBeLessThanOrEqual(area.maxZ + EPS);
      expect(["triangle", "quad"]).toContain(s.shape);
    }
  });

  it("count=0 なら空", () => {
    expect(glassShardLayout(mulberry32(1), 0, GLASS_SHARDS.area, 0.04, 0.1)).toEqual([]);
  });
});

describe("廊下", () => {
  it("部屋の外（南の壁の向こう）にあり，ドアの開口部の x の範囲を含む", () => {
    expect(HALLWAY.floorMinZ).toBeGreaterThanOrEqual(HALF_D - EPS);
    expect(HALLWAY.nearZ).toBeCloseTo(HALF_D + WALL_THICKNESS);
    expect(HALLWAY.farZ).toBeGreaterThan(HALLWAY.nearZ);
    expect(HALLWAY.minX).toBeLessThanOrEqual(DOOR_SPAN_X.minX);
    expect(HALLWAY.maxX).toBeGreaterThanOrEqual(DOOR_SPAN_X.maxX);
    // 人が通れる幅
    expect(HALLWAY.farZ - HALLWAY.nearZ).toBeGreaterThanOrEqual(0.8);
  });

  it("廊下の部屋側の壁の開口部は部屋のドアの開口部と同じ x の範囲・高さ", () => {
    const xs = [
      wallPointToWorld(HALLWAY_WALLS.near, HALLWAY_DOOR_OPENING.u0, 0)[0],
      wallPointToWorld(HALLWAY_WALLS.near, HALLWAY_DOOR_OPENING.u1, 0)[0],
    ].sort((a, b) => a - b);
    expect(xs[0]).toBeCloseTo(DOOR_SPAN_X.minX);
    expect(xs[1]).toBeCloseTo(DOOR_SPAN_X.maxX);
    expect(HALLWAY_DOOR_OPENING.v0).toBe(0);
    expect(HALLWAY_DOOR_OPENING.v1).toBeCloseTo(DOOR.height);
    expect(wallPointToWorld(HALLWAY_WALLS.near, 0, 0)[2]).toBeCloseTo(HALLWAY.nearZ);
  });

  it("廊下の壁の法線は廊下の内側を向く", () => {
    const cx = (HALLWAY.minX + HALLWAY.maxX) / 2;
    const cz = (HALLWAY.nearZ + HALLWAY.farZ) / 2;
    for (const w of Object.values(HALLWAY_WALLS)) {
      const mid = wallPointToWorld(w, w.length / 2, 0);
      const dot = w.normal[0] * (cx - mid[0]) + w.normal[2] * (cz - mid[2]);
      expect(dot, w.id).toBeGreaterThan(0);
    }
  });
});

describe("エリア（ROOM_AREAS）", () => {
  const ids: RoomAreaId[] = [
    "under-table",
    "near-window",
    "near-bookshelf",
    "glass-shards",
    "stove-front",
    "breaker-front",
    "door-front",
    "hallway",
  ];

  it("8 種類が 1 つずつある", () => {
    expect(ROOM_AREAS.map((a) => a.id).sort()).toEqual([...ids].sort());
  });

  it("どれも広さを持つ（min < max）", () => {
    for (const a of ROOM_AREAS) {
      expect(a.maxX, a.id).toBeGreaterThan(a.minX);
      expect(a.maxZ, a.id).toBeGreaterThan(a.minZ);
    }
  });

  it("hallway 以外は部屋の中，hallway は部屋の外", () => {
    const room: FloorRect = { minX: -HALF_W, maxX: HALF_W, minZ: -HALF_D, maxZ: HALF_D };
    for (const a of ROOM_AREAS) {
      if (a.id === "hallway") {
        expect(a.minZ).toBeGreaterThanOrEqual(HALF_D - EPS);
      } else {
        expect(rectContains(room, a), a.id).toBe(true);
      }
    }
  });

  it("under-table はテーブルの床占有範囲の中", () => {
    const t = defRect(TABLE_ID);
    const a = area("under-table");
    expect(rectContains(t, a)).toBe(true);
    const [x, z] = center(t);
    expect(inside(a, x, z)).toBe(true);
  });

  it("near-window は窓の前（窓の幅を覆い，北の壁に接する）", () => {
    const a = area("near-window");
    expect(a.minX).toBeLessThanOrEqual(WINDOW.centerX - WINDOW.width / 2);
    expect(a.maxX).toBeGreaterThanOrEqual(WINDOW.centerX + WINDOW.width / 2);
    expect(a.minZ).toBeCloseTo(-HALF_D);
  });

  it("near-bookshelf は本棚の前（本棚の幅を覆い，本棚の正面に接する）", () => {
    const s = defRect(BOOKSHELF_ID);
    const a = area("near-bookshelf");
    expect(a.minX).toBeLessThanOrEqual(s.minX);
    expect(a.maxX).toBeGreaterThanOrEqual(s.maxX);
    expect(a.minZ).toBeCloseTo(s.maxZ);
    expect(rectsOverlap(a, s)).toBe(false);
  });

  it("glass-shards は破片の範囲と一致し，窓の前の範囲に入る", () => {
    const a = area("glass-shards");
    expect(a).toMatchObject(GLASS_SHARDS.area);
    expect(rectContains(area("near-window"), a)).toBe(true);
  });

  it("stove-front はコンロの前（カウンターの手前に接し，コンロの z の範囲を覆う）", () => {
    const c = defRect(COUNTER_ID);
    const s = defRect(STOVE_ID);
    const a = area("stove-front");
    expect(a.maxX).toBeCloseTo(c.minX);
    expect(a.minZ).toBeLessThanOrEqual(s.minZ);
    expect(a.maxZ).toBeGreaterThanOrEqual(s.maxZ);
    expect(rectsOverlap(a, c)).toBe(false);
  });

  it("breaker-front は分電盤の前（分電盤の x の範囲を覆い，南の壁に接する）", () => {
    const p = defRect(BREAKER_PANEL_ID);
    const a = area("breaker-front");
    expect(a.minX).toBeLessThanOrEqual(p.minX);
    expect(a.maxX).toBeGreaterThanOrEqual(p.maxX);
    expect(a.maxZ).toBeCloseTo(HALF_D);
  });

  it("door-front はドアの前（開口部の x の範囲を覆い，南の壁に接する）", () => {
    const a = area("door-front");
    expect(a.minX).toBeLessThanOrEqual(DOOR_SPAN_X.minX + EPS);
    expect(a.maxX).toBeGreaterThanOrEqual(DOOR_SPAN_X.maxX - EPS);
    expect(a.maxZ).toBeCloseTo(HALF_D);
  });

  it("hallway は廊下の床を覆い，door-front とドアの開口部でつながる", () => {
    const a = area("hallway");
    expect(a.minX).toBeLessThanOrEqual(DOOR_SPAN_X.minX);
    expect(a.maxX).toBeGreaterThanOrEqual(DOOR_SPAN_X.maxX);
    expect(a.minZ).toBeCloseTo(HALF_D);
    expect(a.maxZ).toBeCloseTo(HALLWAY.farZ);
    expect(a.minZ).toBeLessThanOrEqual(area("door-front").maxZ + EPS);
  });
});

describe("通り道（開始位置 → テーブル → コンロ → ブレーカー → ドア）", () => {
  // 床を格子に分け，人の幅 0.6m（半径 0.3m）が通れるセルだけで順に辿れるかを幅優先探索で確かめる
  const PERSON_RADIUS = 0.3;
  const STEP = 0.05;
  const nx = Math.round(ROOM.width / STEP);
  const nz = Math.round(ROOM.depth / STEP);
  const obstacles = floorDefs.map((f) => ({ id: f.id, rect: rectOf(furnitureDefFootprint(f)) }));
  const cellX = (i: number) => -HALF_W + (i + 0.5) * STEP;
  const cellZ = (k: number) => -HALF_D + (k + 0.5) * STEP;

  function free(i: number, k: number): boolean {
    const x = cellX(i);
    const z = cellZ(k);
    if (x < -HALF_W + PERSON_RADIUS || x > HALF_W - PERSON_RADIUS) return false;
    if (z < -HALF_D + PERSON_RADIUS || z > HALF_D - PERSON_RADIUS) return false;
    return obstacles.every((o) => distToRect(o.rect, x, z) >= PERSON_RADIUS);
  }

  function reachable(from: [number, number], goal: (x: number, z: number) => boolean): boolean {
    const toCell = (x: number, z: number): [number, number] => [
      Math.floor((x + HALF_W) / STEP),
      Math.floor((z + HALF_D) / STEP),
    ];
    const [si, sk] = toCell(from[0], from[1]);
    if (!free(si, sk)) return false;
    const seen = new Uint8Array(nx * nz);
    const queue: [number, number][] = [[si, sk]];
    seen[sk * nx + si] = 1;
    while (queue.length > 0) {
      const next = queue.shift();
      if (!next) break;
      const [i, k] = next;
      if (goal(cellX(i), cellZ(k))) return true;
      for (const [di, dk] of [
        [1, 0],
        [-1, 0],
        [0, 1],
        [0, -1],
      ]) {
        const ni = i + di;
        const nk = k + dk;
        if (ni < 0 || nk < 0 || ni >= nx || nk >= nz) continue;
        if (seen[nk * nx + ni] || !free(ni, nk)) continue;
        seen[nk * nx + ni] = 1;
        queue.push([ni, nk]);
      }
    }
    return false;
  }

  /** 経由地（エリアの中で，人が立てる点） */
  function standPoint(goal: (x: number, z: number) => boolean): [number, number] {
    for (let k = 0; k < nz; k++) {
      for (let i = 0; i < nx; i++) {
        if (free(i, k) && goal(cellX(i), cellZ(k))) return [cellX(i), cellZ(k)];
      }
    }
    throw new Error("立てる点がありません");
  }

  const table = defRect(TABLE_ID);
  const nearTable = (x: number, z: number) => distToRect(table, x, z) <= PERSON_RADIUS + 0.1;
  const inArea = (id: RoomAreaId) => (x: number, z: number) => inside(area(id), x, z);

  it("開始位置は家具から人の半径以上離れて立てる", () => {
    for (const o of obstacles) {
      expect(distToRect(o.rect, START_X, START_Z), o.id).toBeGreaterThanOrEqual(PERSON_RADIUS);
    }
  });

  it("開始位置からテーブルの際まで行ける", () => {
    expect(reachable([START_X, START_Z], nearTable)).toBe(true);
  });

  it("テーブル → コンロの前 → ブレーカーの前 → ドアの前と順に辿れる", () => {
    const legs: [(x: number, z: number) => boolean, (x: number, z: number) => boolean][] = [
      [nearTable, inArea("stove-front")],
      [inArea("stove-front"), inArea("breaker-front")],
      [inArea("breaker-front"), inArea("door-front")],
    ];
    for (const [from, to] of legs) {
      expect(reachable(standPoint(from), to)).toBe(true);
    }
  });
});
