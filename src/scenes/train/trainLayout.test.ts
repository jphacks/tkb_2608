import * as THREE from "three";
import { describe, expect, it } from "vitest";
import { computeFootprint, type Footprint, type Vec3Tuple } from "../common/furniture";
import { splitWallAroundOpenings, type WallRect, wallUAt } from "../common/wallLayout";
import {
  CAR,
  DOOR_CENTERS_Z,
  DOOR_COCK,
  DOOR_COCKS,
  EMERGENCY_DOOR_END,
  EMERGENCY_INTERCOM,
  END_WALLS,
  EYE_HEIGHT,
  evenlySpaced,
  GANGWAY_DOOR,
  GANGWAY_DOORS,
  localToCar,
  OUTSIDE_BOARD,
  PLATFORM,
  POLE,
  RACK_TOP,
  RAIL,
  SEAT,
  SEAT_SECTIONS,
  SIDE_DOOR,
  SIDE_DOORS,
  SIDE_WALLS,
  SIDE_WINDOWS,
  STRAP,
  STRAP_LENGTH,
  seatFacingYaw,
  seatLength,
  seatSlots,
  sideSign,
  slidingLeafX,
  slidingLeaves,
  TRAIN_HANDRAILS,
  TRAIN_LUGGAGE,
  TRAIN_RACKS,
  TRAIN_SEATS,
  TRAIN_START,
  TRAIN_STRAPS,
  TRAIN_WALLS,
  type TrainDoorDef,
} from "./trainLayout";

const HALF_L = 5;
const HALF_W = 1.4;
const EPS = 1e-9;

function seatFootprint(seat: (typeof TRAIN_SEATS)[number]): Footprint {
  return computeFootprint({ x: seat.position[0], z: seat.position[2] }, seat.rotationY, seat.size);
}

/** 点と床占有範囲（AABB）の水平距離（中にあれば 0） */
function distanceToFootprint(x: number, z: number, f: Footprint): number {
  const dx = Math.max(0, Math.abs(x - f.centerX) - f.halfX);
  const dz = Math.max(0, Math.abs(z - f.centerZ) - f.halfZ);
  return Math.hypot(dx, dz);
}

/** 側面のドアの開口部の Z の範囲 */
function doorZRange(door: TrainDoorDef): [number, number] {
  const z0 = door.wall.origin[2] + door.wall.dir[2] * door.opening.u0;
  const z1 = door.wall.origin[2] + door.wall.dir[2] * door.opening.u1;
  return [Math.min(z0, z1), Math.max(z0, z1)];
}

function rangesOverlap(a: [number, number], b: [number, number]): boolean {
  return Math.min(a[1], b[1]) - Math.max(a[0], b[0]) > EPS;
}

describe("車両の寸法", () => {
  it("長さ 10m × 幅 2.8m × 高さ 2.3m", () => {
    expect(CAR).toMatchObject({ length: 10, width: 2.8, height: 2.3 });
  });

  it("目の高さは立ち 1.6m・しゃがみ・着座（しゃがみ・着座は立ちより低い）", () => {
    expect(EYE_HEIGHT.standing).toBe(1.6);
    expect(EYE_HEIGHT.crouching).toBeGreaterThan(0);
    expect(EYE_HEIGHT.crouching).toBeLessThan(EYE_HEIGHT.standing);
    expect(EYE_HEIGHT.seated).toBeGreaterThan(SEAT.height);
    expect(EYE_HEIGHT.seated).toBeLessThan(EYE_HEIGHT.standing);
  });
});

describe("sideSign", () => {
  it("左は -1，右は +1", () => {
    expect(sideSign("left")).toBe(-1);
    expect(sideSign("right")).toBe(1);
  });
});

describe("壁 4 面", () => {
  const walls = Object.values(TRAIN_WALLS);

  it("4 面あり id は一意", () => {
    expect(walls).toHaveLength(4);
    expect(new Set(walls.map((w) => w.id)).size).toBe(4);
  });

  it("床の四隅を結び，長さは車両の辺と一致する", () => {
    for (const w of walls) {
      const endX = w.origin[0] + w.dir[0] * w.length;
      const endZ = w.origin[2] + w.dir[2] * w.length;
      for (const [x, z] of [
        [w.origin[0], w.origin[2]],
        [endX, endZ],
      ]) {
        expect(Math.abs(Math.abs(x) - HALF_W)).toBeLessThan(EPS);
        expect(Math.abs(Math.abs(z) - HALF_L)).toBeLessThan(EPS);
      }
    }
    expect(SIDE_WALLS.left.length).toBe(10);
    expect(SIDE_WALLS.right.length).toBe(10);
    expect(END_WALLS.front.length).toBe(2.8);
    expect(END_WALLS.rear.length).toBe(2.8);
  });

  it("法線は車内（原点の側）を向く", () => {
    for (const w of walls) {
      const toCenter = -w.origin[0] * w.normal[0] - w.origin[2] * w.normal[2];
      expect(toCenter).toBeGreaterThan(0);
    }
  });

  it("左の側面は -X，右の側面は +X にある", () => {
    expect(SIDE_WALLS.left.origin[0]).toBeCloseTo(-HALF_W);
    expect(SIDE_WALLS.right.origin[0]).toBeCloseTo(HALF_W);
  });
});

describe("slidingLeaves / slidingLeafX", () => {
  /** 扉の X の範囲 */
  function leafSpan(leaf: ReturnType<typeof slidingLeaves>[number], openAmount: number) {
    const x = slidingLeafX(leaf, openAmount);
    return [x - leaf.width / 2, x + leaf.width / 2] as [number, number];
  }

  it("2 枚: 左右の扉は幅が半分ずつで，閉じると開口部をすき間なくふさぐ", () => {
    const leaves = slidingLeaves(1.3, 2);
    expect(leaves).toHaveLength(2);
    expect(leaves[0].width + leaves[1].width).toBeCloseTo(1.3);
    const spans = leaves.map((l) => leafSpan(l, 0)).sort((a, b) => a[0] - b[0]);
    expect(spans[0][0]).toBeCloseTo(-0.65);
    expect(spans[0][1]).toBeCloseTo(spans[1][0]);
    expect(spans[1][1]).toBeCloseTo(0.65);
  });

  it("2 枚: 左右逆向きに開き，全開で開口部が全幅あく", () => {
    const leaves = slidingLeaves(1.3, 2);
    expect(new Set(leaves.map((l) => l.slideDirection))).toEqual(new Set([-1, 1]));
    for (const leaf of leaves) {
      const span = leafSpan(leaf, 1);
      expect(rangesOverlap(span, [-0.65, 0.65])).toBe(false);
    }
  });

  it("2 枚: suffix は一意", () => {
    const leaves = slidingLeaves(1.3, 2);
    expect(new Set(leaves.map((l) => l.suffix)).size).toBe(2);
  });

  it("1 枚: 閉じると開口部をふさぎ，全開で開口部が全幅あく", () => {
    const leaves = slidingLeaves(0.8, 1);
    expect(leaves).toHaveLength(1);
    const [closed0, closed1] = leafSpan(leaves[0], 0);
    expect(closed0).toBeCloseTo(-0.4);
    expect(closed1).toBeCloseTo(0.4);
    expect(rangesOverlap(leafSpan(leaves[0], 1), [-0.4, 0.4])).toBe(false);
  });

  it("openAmount 0 で閉じた位置，0.5 で半分，1 で全開", () => {
    const leaf = { closedX: 0.2, slideDirection: -1 as const, slideDistance: 0.6 };
    expect(slidingLeafX(leaf, 0)).toBeCloseTo(0.2);
    expect(slidingLeafX(leaf, 0.5)).toBeCloseTo(-0.1);
    expect(slidingLeafX(leaf, 1)).toBeCloseTo(-0.4);
  });

  it("openAmount の範囲外は 0〜1 に切り詰める", () => {
    const leaf = { closedX: 0.2, slideDirection: 1 as const, slideDistance: 0.6 };
    expect(slidingLeafX(leaf, -0.5)).toBeCloseTo(slidingLeafX(leaf, 0));
    expect(slidingLeafX(leaf, 2)).toBeCloseTo(slidingLeafX(leaf, 1));
  });
});

describe("側面のドア", () => {
  it("中心の Z は ±2.4", () => {
    expect([...DOOR_CENTERS_Z].sort((a, b) => a - b)).toEqual([-2.4, 2.4]);
  });

  it("両側面に 2 か所ずつ（計 4）", () => {
    expect(SIDE_DOORS).toHaveLength(4);
    expect(SIDE_DOORS.filter((d) => d.side === "left")).toHaveLength(2);
    expect(SIDE_DOORS.filter((d) => d.side === "right")).toHaveLength(2);
  });

  it("開口部は 1.3m × 1.85m で床から，壁の範囲内", () => {
    for (const d of SIDE_DOORS) {
      expect(d.opening.u1 - d.opening.u0).toBeCloseTo(SIDE_DOOR.width);
      expect(SIDE_DOOR.width).toBe(1.3);
      expect(d.opening.v0).toBe(0);
      expect(d.opening.v1).toBeCloseTo(1.85);
      expect(d.opening.u0).toBeGreaterThanOrEqual(0);
      expect(d.opening.u1).toBeLessThanOrEqual(d.wall.length);
      expect(d.opening.v1).toBeLessThan(CAR.height);
    }
  });

  it("開口部の中心が DOOR_CENTERS_Z の位置にある", () => {
    for (const side of ["left", "right"] as const) {
      const centers = SIDE_DOORS.filter((d) => d.side === side)
        .map((d) => {
          const [z0, z1] = doorZRange(d);
          return (z0 + z1) / 2;
        })
        .sort((a, b) => a - b);
      expect(centers[0]).toBeCloseTo(-2.4);
      expect(centers[1]).toBeCloseTo(2.4);
    }
  });

  it("左右 2 枚の引き戸で，閉じると開口部をふさぎ全開で全幅あく", () => {
    const half = SIDE_DOOR.width / 2;
    for (const d of SIDE_DOORS) {
      expect(d.kind).toBe("sideDoor");
      expect(d.leaves).toHaveLength(2);
      const closed = d.leaves.map((l) => slidingLeafX(l, 0));
      expect(Math.min(...closed) - d.leaves[0].width / 2).toBeCloseTo(-half);
      expect(Math.max(...closed) + d.leaves[0].width / 2).toBeCloseTo(half);
      for (const l of d.leaves) {
        const x = slidingLeafX(l, 1);
        expect(rangesOverlap([x - l.width / 2, x + l.width / 2], [-half, half])).toBe(false);
      }
    }
  });

  it("id は一意", () => {
    expect(new Set(SIDE_DOORS.map((d) => d.id)).size).toBe(SIDE_DOORS.length);
  });
});

describe("妻面の貫通扉・非常扉", () => {
  it("前後の端に 1 つずつあり，片方が非常扉", () => {
    expect(GANGWAY_DOORS).toHaveLength(2);
    expect(new Set(GANGWAY_DOORS.map((d) => d.end))).toEqual(new Set(["front", "rear"]));
    const emergency = GANGWAY_DOORS.filter((d) => d.kind === "emergencyDoor");
    expect(emergency).toHaveLength(1);
    expect(emergency[0].end).toBe(EMERGENCY_DOOR_END);
    expect(emergency[0].wall).toBe(END_WALLS[EMERGENCY_DOOR_END]);
  });

  it("開口部は妻面の中央で，壁の範囲内", () => {
    for (const d of GANGWAY_DOORS) {
      const center = (d.opening.u0 + d.opening.u1) / 2;
      expect(center).toBeCloseTo(d.wall.length / 2);
      expect(d.opening.u1 - d.opening.u0).toBeCloseTo(GANGWAY_DOOR.width);
      expect(d.opening.v0).toBe(0);
      expect(d.opening.v1).toBeLessThan(CAR.height);
      expect(d.leaves.length).toBeGreaterThanOrEqual(1);
    }
  });

  it("非常扉の横に手すりがある（開口部の外，扉の近く）", () => {
    const door = GANGWAY_DOORS.find((d) => d.kind === "emergencyDoor");
    const rail = TRAIN_HANDRAILS.find((h) => h.id === "emergency-door-handrail");
    expect(door).toBeDefined();
    expect(rail).toBeDefined();
    if (!door || !rail) return;
    const endZ = door.wall.origin[2];
    expect(Math.abs(rail.position[2] - endZ)).toBeLessThan(0.2);
    expect(Math.abs(rail.position[0])).toBeGreaterThan(GANGWAY_DOOR.width / 2);
    expect(Math.abs(rail.position[0])).toBeLessThan(GANGWAY_DOOR.width / 2 + 0.5);
  });
});

describe("壁の分割（側面のドアと窓）", () => {
  for (const side of ["left", "right"] as const) {
    it(`${side}: 開口部どうしは重ならず，片 + 開口部の面積 = 壁全体`, () => {
      const wall = SIDE_WALLS[side];
      const openings: WallRect[] = [
        ...SIDE_DOORS.filter((d) => d.side === side).map((d) => d.opening),
        ...SIDE_WINDOWS.filter((w) => w.wall === wall).map((w) => w.opening),
      ];
      const sorted = [...openings].sort((a, b) => a.u0 - b.u0);
      for (let i = 1; i < sorted.length; i++) {
        expect(sorted[i].u0).toBeGreaterThanOrEqual(sorted[i - 1].u1);
      }
      const rects = splitWallAroundOpenings(wall.length, CAR.height, openings);
      const area = (r: WallRect) => (r.u1 - r.u0) * (r.v1 - r.v0);
      const total = [...rects, ...openings].reduce((s, r) => s + area(r), 0);
      expect(total).toBeCloseTo(wall.length * CAR.height);
    });
  }
});

describe("seatLength / seatSlots", () => {
  it("座席の全長は 人数 × 1 人分の幅 + 袖仕切り 2 枚", () => {
    expect(seatLength(7)).toBeCloseTo(7 * SEAT.personWidth + 2 * SEAT.armThickness);
    expect(seatLength(3)).toBeCloseTo(3 * SEAT.personWidth + 2 * SEAT.armThickness);
  });

  it("人数分の着座位置が 1 人分の幅の間隔で中央揃えに並ぶ", () => {
    const slots = seatSlots(7);
    expect(slots).toHaveLength(7);
    expect(slots.map((s) => s.index)).toEqual([0, 1, 2, 3, 4, 5, 6]);
    for (let i = 1; i < slots.length; i++) {
      expect(slots[i].sitPosition[0] - slots[i - 1].sitPosition[0]).toBeCloseTo(SEAT.personWidth);
    }
    expect(slots[0].sitPosition[0] + slots[6].sitPosition[0]).toBeCloseTo(0);
    expect(slots[3].sitPosition[0]).toBeCloseTo(0);
  });

  it("着座位置は座面の上，座席の範囲内", () => {
    for (const persons of [3, 7]) {
      const half = seatLength(persons) / 2 - SEAT.armThickness;
      for (const s of seatSlots(persons)) {
        expect(s.sitPosition[1]).toBeCloseTo(SEAT.height);
        expect(Math.abs(s.sitPosition[0])).toBeLessThan(half);
        expect(Math.abs(s.sitPosition[2])).toBeLessThanOrEqual(SEAT.depth / 2);
      }
    }
  });

  it("座ったときの目の位置は着座の目の高さで，腰を下ろす位置の真上付近", () => {
    for (const s of seatSlots(3)) {
      expect(s.eyePosition[1]).toBe(EYE_HEIGHT.seated);
      expect(s.eyePosition[0]).toBeCloseTo(s.sitPosition[0]);
      expect(Math.abs(s.eyePosition[2] - s.sitPosition[2])).toBeLessThan(0.2);
      expect(Math.abs(s.eyePosition[2])).toBeLessThanOrEqual(SEAT.depth / 2);
    }
  });
});

describe("localToCar", () => {
  it("回転 0 なら平行移動のみ", () => {
    expect(localToCar({ position: [1, 2, 3], rotationY: 0 }, [0.5, 0.1, -0.2])).toEqual([
      1.5, 2.1, 2.8,
    ]);
  });

  it.each([0, Math.PI / 2, -Math.PI / 2, Math.PI, 0.7, -2.3])(
    "three の Object3D の localToWorld と一致する（rotationY=%f）",
    (rotationY) => {
      const position: Vec3Tuple = [-1.2, 0.3, 2.5];
      const local: Vec3Tuple = [0.4, 1.1, -0.3];
      const obj = new THREE.Object3D();
      obj.position.set(...position);
      obj.rotation.y = rotationY;
      obj.updateMatrixWorld(true);
      const expected = obj.localToWorld(new THREE.Vector3(...local));
      const actual = localToCar({ position, rotationY }, local);
      expect(actual[0]).toBeCloseTo(expected.x);
      expect(actual[1]).toBeCloseTo(expected.y);
      expect(actual[2]).toBeCloseTo(expected.z);
    },
  );
});

describe("seatFacingYaw", () => {
  it("-π〜π の範囲", () => {
    for (const r of [-7, -Math.PI, -1, 0, 1, Math.PI, 7]) {
      const yaw = seatFacingYaw(r);
      expect(yaw).toBeGreaterThanOrEqual(-Math.PI - EPS);
      expect(yaw).toBeLessThanOrEqual(Math.PI + EPS);
    }
  });

  it("左の座席は -π/2，右の座席は +π/2", () => {
    for (const seat of TRAIN_SEATS) {
      const expected = seat.side === "left" ? -Math.PI / 2 : Math.PI / 2;
      expect(seatFacingYaw(seat.rotationY)).toBeCloseTo(expected);
    }
  });

  it("座席の正面（通路側）を向く（yaw 0 で -Z，正で左へ回る）", () => {
    for (const seat of TRAIN_SEATS) {
      const yaw = seatFacingYaw(seat.rotationY);
      const look = [-Math.sin(yaw), -Math.cos(yaw)];
      const front = localToCar({ position: [0, 0, 0], rotationY: seat.rotationY }, [0, 0, 1]);
      expect(look[0]).toBeCloseTo(front[0]);
      expect(look[1]).toBeCloseTo(front[2]);
      // 通路（X=0）の向き
      expect(Math.sign(look[0])).toBe(-Math.sign(seat.position[0]));
    }
  });
});

describe("座席", () => {
  it("片側 3 区画（車端の優先席 2・ドア間のロングシート 1），計 6", () => {
    expect(TRAIN_SEATS).toHaveLength(6);
    for (const side of ["left", "right"] as const) {
      const seats = TRAIN_SEATS.filter((s) => s.side === side);
      expect(seats.filter((s) => s.kind === "longSeat")).toHaveLength(1);
      expect(seats.filter((s) => s.kind === "prioritySeat")).toHaveLength(2);
    }
    expect(SEAT_SECTIONS).toHaveLength(3);
  });

  it("id は一意", () => {
    expect(new Set(TRAIN_SEATS.map((s) => s.id)).size).toBe(TRAIN_SEATS.length);
  });

  it("ロングシートはドア間，優先席はドアより車端側", () => {
    const [front, rear] = [...DOOR_CENTERS_Z].sort((a, b) => a - b);
    for (const seat of TRAIN_SEATS) {
      const f = seatFootprint(seat);
      const z0 = f.centerZ - f.halfZ;
      const z1 = f.centerZ + f.halfZ;
      if (seat.kind === "longSeat") {
        expect(z0).toBeGreaterThan(front);
        expect(z1).toBeLessThan(rear);
      } else {
        expect(z1 < front || z0 > rear).toBe(true);
      }
    }
  });

  it("優先席は前後の車端に 1 つずつ（片側）", () => {
    for (const side of ["left", "right"] as const) {
      const zs = TRAIN_SEATS.filter((s) => s.side === side && s.kind === "prioritySeat").map(
        (s) => s.position[2],
      );
      expect(zs.some((z) => z < 0)).toBe(true);
      expect(zs.some((z) => z > 0)).toBe(true);
    }
  });

  it("車内に収まり，それぞれの側面の壁に沿う", () => {
    for (const seat of TRAIN_SEATS) {
      const f = seatFootprint(seat);
      expect(f.centerX - f.halfX).toBeGreaterThanOrEqual(-HALF_W - EPS);
      expect(f.centerX + f.halfX).toBeLessThanOrEqual(HALF_W + EPS);
      expect(f.centerZ - f.halfZ).toBeGreaterThanOrEqual(-HALF_L - EPS);
      expect(f.centerZ + f.halfZ).toBeLessThanOrEqual(HALF_L + EPS);
      const wallX = sideSign(seat.side) * HALF_W;
      expect(Math.abs(wallX - seat.position[0])).toBeCloseTo(f.halfX);
    }
  });

  it("ドアの開口部の前をふさがない", () => {
    for (const seat of TRAIN_SEATS) {
      const f = seatFootprint(seat);
      for (const door of SIDE_DOORS.filter((d) => d.side === seat.side)) {
        expect(rangesOverlap([f.centerZ - f.halfZ, f.centerZ + f.halfZ], doorZRange(door))).toBe(
          false,
        );
      }
    }
  });

  it("左右の座席の間に通路（1m 以上）がある", () => {
    const leftInner = Math.max(
      ...TRAIN_SEATS.filter((s) => s.side === "left").map((s) => {
        const f = seatFootprint(s);
        return f.centerX + f.halfX;
      }),
    );
    const rightInner = Math.min(
      ...TRAIN_SEATS.filter((s) => s.side === "right").map((s) => {
        const f = seatFootprint(s);
        return f.centerX - f.halfX;
      }),
    );
    expect(rightInner - leftInner).toBeGreaterThanOrEqual(1.0);
  });

  it("座席どうしは重ならない", () => {
    for (let i = 0; i < TRAIN_SEATS.length; i++) {
      for (let j = i + 1; j < TRAIN_SEATS.length; j++) {
        const a = seatFootprint(TRAIN_SEATS[i]);
        const b = seatFootprint(TRAIN_SEATS[j]);
        const ox = a.halfX + b.halfX - Math.abs(a.centerX - b.centerX);
        const oz = a.halfZ + b.halfZ - Math.abs(a.centerZ - b.centerZ);
        expect(ox <= EPS || oz <= EPS).toBe(true);
      }
    }
  });

  it("座ったときの目の位置は車内で着座の目の高さ", () => {
    for (const seat of TRAIN_SEATS) {
      for (const slot of seatSlots(seat.persons)) {
        const [x, y, z] = localToCar(seat, slot.eyePosition);
        expect(y).toBeCloseTo(EYE_HEIGHT.seated);
        expect(Math.abs(x)).toBeLessThan(HALF_W);
        expect(Math.abs(z)).toBeLessThan(HALF_L);
      }
    }
  });
});

describe("窓と網棚", () => {
  it("座席の区画ごとに，座席の上の窓がある", () => {
    expect(SIDE_WINDOWS).toHaveLength(TRAIN_SEATS.length);
    for (const seat of TRAIN_SEATS) {
      const f = seatFootprint(seat);
      const windows = SIDE_WINDOWS.filter((w) => w.wall === SIDE_WALLS[seat.side]).filter((w) => {
        const u = (w.opening.u0 + w.opening.u1) / 2;
        return Math.abs(u - wallUAt(w.wall, seat.position[0], seat.position[2])) < EPS;
      });
      expect(windows).toHaveLength(1);
      const w = windows[0];
      expect(w.opening.v0).toBeGreaterThanOrEqual(SEAT.height);
      expect(w.opening.v1).toBeLessThan(CAR.height);
      expect(w.opening.u1 - w.opening.u0).toBeLessThanOrEqual(f.halfZ * 2 + EPS);
    }
  });

  it("窓の id は一意", () => {
    expect(new Set(SIDE_WINDOWS.map((w) => w.id)).size).toBe(SIDE_WINDOWS.length);
  });

  it("網棚は座席ごとに 1 つ，座席の上（背もたれより高い）で同じ区画", () => {
    expect(TRAIN_RACKS).toHaveLength(TRAIN_SEATS.length);
    expect(new Set(TRAIN_RACKS.map((r) => r.id)).size).toBe(TRAIN_RACKS.length);
    for (const seat of TRAIN_SEATS) {
      const racks = TRAIN_RACKS.filter(
        (r) =>
          Math.abs(r.position[2] - seat.position[2]) < EPS &&
          Math.sign(r.position[0]) === Math.sign(seat.position[0]),
      );
      expect(racks).toHaveLength(1);
      const rack = racks[0];
      expect(rack.position[1]).toBeGreaterThan(SEAT.backTop);
      expect(rack.position[1]).toBeLessThan(CAR.height);
      expect(rack.size.x).toBeLessThanOrEqual(seat.size.x);
      expect(Math.abs(rack.position[0])).toBeLessThan(HALF_W);
    }
  });
});

describe("網棚の荷物", () => {
  it("1 つずつ独立（id 一意・固定されていない）", () => {
    expect(TRAIN_LUGGAGE.length).toBeGreaterThan(0);
    expect(new Set(TRAIN_LUGGAGE.map((l) => l.id)).size).toBe(TRAIN_LUGGAGE.length);
    for (const l of TRAIN_LUGGAGE) expect(l.anchored).toBe(false);
  });

  it("網棚の上面に載り，網棚からはみ出さない", () => {
    for (const l of TRAIN_LUGGAGE) {
      const rack = TRAIN_RACKS.find((r) => r.id === l.restsOn);
      expect(rack).toBeDefined();
      if (!rack) continue;
      expect(l.position[1]).toBeCloseTo(RACK_TOP);
      expect(l.origin).toBe("bottom");
      // 網棚のローカル座標へ戻す
      const dx = l.position[0] - rack.position[0];
      const dz = l.position[2] - rack.position[2];
      const c = Math.cos(rack.rotationY);
      const s = Math.sin(rack.rotationY);
      const localX = dx * c - dz * s;
      const localZ = dx * s + dz * c;
      expect(Math.abs(localZ)).toBeLessThan(1e-6);
      expect(Math.abs(localX) + l.size.x / 2).toBeLessThanOrEqual(rack.size.x / 2 + EPS);
      expect(l.size.z).toBeLessThanOrEqual(rack.size.z + EPS);
      expect(l.position[1] + l.size.y).toBeLessThan(CAR.height);
    }
  });

  it("同じ網棚の荷物どうしは重ならない", () => {
    for (let i = 0; i < TRAIN_LUGGAGE.length; i++) {
      for (let j = i + 1; j < TRAIN_LUGGAGE.length; j++) {
        const a = TRAIN_LUGGAGE[i];
        const b = TRAIN_LUGGAGE[j];
        if (a.restsOn !== b.restsOn) continue;
        const dist = Math.hypot(a.position[0] - b.position[0], a.position[2] - b.position[2]);
        expect(dist).toBeGreaterThanOrEqual((a.size.x + b.size.x) / 2 - EPS);
      }
    }
  });
});

describe("手すり", () => {
  const vertical = TRAIN_HANDRAILS.filter((h) => h.orientation === "vertical");
  const horizontal = TRAIN_HANDRAILS.filter((h) => h.orientation === "horizontal");

  it("id は一意", () => {
    expect(new Set(TRAIN_HANDRAILS.map((h) => h.id)).size).toBe(TRAIN_HANDRAILS.length);
  });

  it("各ドアの両脇に縦の手すりがある（開口部の外・近く）", () => {
    for (const door of SIDE_DOORS) {
      const [z0, z1] = doorZRange(door);
      const near = vertical.filter(
        (h) =>
          Math.sign(h.position[0]) === sideSign(door.side ?? "left") &&
          Math.abs(h.position[0]) > HALF_W - 0.4,
      );
      expect(near.some((h) => h.position[2] < z0 && z0 - h.position[2] < 0.3)).toBe(true);
      expect(near.some((h) => h.position[2] > z1 && h.position[2] - z1 < 0.3)).toBe(true);
    }
  });

  it("ロングシートの中央の前に縦の手すりがあり，座席と重ならない", () => {
    for (const seat of TRAIN_SEATS.filter((s) => s.kind === "longSeat")) {
      const f = seatFootprint(seat);
      const poles = vertical.filter(
        (h) =>
          Math.abs(h.position[2] - seat.position[2]) < 0.05 &&
          Math.sign(h.position[0]) === Math.sign(seat.position[0]),
      );
      expect(poles).toHaveLength(1);
      expect(distanceToFootprint(poles[0].position[0], poles[0].position[2], f)).toBeGreaterThan(
        POLE.diameter / 2 - EPS,
      );
    }
  });

  it("縦の手すりは座席と重ならない", () => {
    for (const h of vertical) {
      for (const seat of TRAIN_SEATS) {
        expect(
          distanceToFootprint(h.position[0], h.position[2], seatFootprint(seat)),
        ).toBeGreaterThan(0);
      }
    }
  });

  it("ドア脇・座席中央の縦の手すりは床から天井まで", () => {
    for (const h of vertical.filter((v) => v.id !== "emergency-door-handrail")) {
      expect(h.position[1]).toBe(0);
      expect(h.size.y).toBeCloseTo(CAR.height);
    }
  });

  it("横の手すりは左右 1 本ずつ，車両の長手方向（Z）に通る", () => {
    expect(horizontal).toHaveLength(2);
    expect(new Set(horizontal.map((h) => Math.sign(h.position[0])))).toEqual(new Set([-1, 1]));
    for (const h of horizontal) {
      expect(h.size.z).toBeGreaterThan(h.size.x);
      expect(h.size.z).toBeLessThanOrEqual(CAR.length);
      expect(h.position[1]).toBeLessThan(CAR.height);
      expect(h.position[1]).toBeGreaterThan(EYE_HEIGHT.standing);
    }
    expect(RAIL.length).toBeLessThanOrEqual(CAR.length);
  });

  it("すべて車内にある", () => {
    for (const h of TRAIN_HANDRAILS) {
      expect(Math.abs(h.position[0])).toBeLessThan(HALF_W);
      expect(Math.abs(h.position[2])).toBeLessThan(HALF_L);
    }
  });
});

describe("evenlySpaced", () => {
  it("間隔 pitch で中央揃え，範囲内", () => {
    const xs = evenlySpaced(9.2, 0.6);
    expect(xs).toHaveLength(16);
    for (let i = 1; i < xs.length; i++) expect(xs[i] - xs[i - 1]).toBeCloseTo(0.6);
    expect(xs[0] + xs[xs.length - 1]).toBeCloseTo(0);
    for (const x of xs) expect(Math.abs(x)).toBeLessThanOrEqual(4.6 + EPS);
  });

  it("span が pitch の倍数ちょうどなら両端に置く（浮動小数の誤差で 1 つ減らない）", () => {
    const xs = evenlySpaced(1.2, 0.4);
    expect(xs).toHaveLength(4);
    expect(xs[0]).toBeCloseTo(-0.6);
    expect(xs[3]).toBeCloseTo(0.6);
  });

  it("span が pitch より短ければ中央に 1 つ", () => {
    expect(evenlySpaced(0.3, 0.6)).toEqual([0]);
  });
});

describe("つり革", () => {
  it("32 本で id は一意", () => {
    expect(TRAIN_STRAPS).toHaveLength(32);
    expect(new Set(TRAIN_STRAPS.map((s) => s.id)).size).toBe(32);
  });

  it("横の手すりに掛かり，原点（上端）は手すりの位置", () => {
    for (const strap of TRAIN_STRAPS) {
      const rail = TRAIN_HANDRAILS.find((h) => h.id === strap.railId);
      expect(rail?.orientation).toBe("horizontal");
      if (!rail) continue;
      expect(strap.position[0]).toBeCloseTo(rail.position[0]);
      expect(strap.position[1]).toBeCloseTo(rail.position[1]);
      expect(Math.abs(strap.position[2] - rail.position[2])).toBeLessThanOrEqual(
        rail.size.z / 2 + EPS,
      );
    }
  });

  it("手すりごとに 0.6m の一定間隔で並ぶ", () => {
    expect(STRAP.pitch).toBe(0.6);
    const railIds = new Set(TRAIN_STRAPS.map((s) => s.railId));
    expect(railIds.size).toBe(2);
    for (const railId of railIds) {
      const zs = TRAIN_STRAPS.filter((s) => s.railId === railId)
        .map((s) => s.position[2])
        .sort((a, b) => a - b);
      expect(zs).toHaveLength(16);
      for (let i = 1; i < zs.length; i++) expect(zs[i] - zs[i - 1]).toBeCloseTo(0.6);
    }
  });

  it("輪の下端は床より上で，立った人の手が届く高さ（目の高さより上・天井より下）", () => {
    expect(STRAP_LENGTH).toBeGreaterThan(0);
    for (const strap of TRAIN_STRAPS) {
      const bottom = strap.position[1] - STRAP_LENGTH;
      expect(bottom).toBeGreaterThan(1.4);
      expect(strap.position[1]).toBeLessThan(CAR.height);
    }
  });
});

describe("非常用ドアコック・非常通報装置", () => {
  it("側面のドアごとに 1 つ，id は一意", () => {
    expect(DOOR_COCKS).toHaveLength(SIDE_DOORS.length);
    expect(new Set(DOOR_COCKS.map((c) => c.id)).size).toBe(DOOR_COCKS.length);
    expect(new Set(DOOR_COCKS.map((c) => c.doorId))).toEqual(new Set(SIDE_DOORS.map((d) => d.id)));
  });

  it("ドアの横（同じ側面の壁・開口部の外の近く）にある", () => {
    for (const cock of DOOR_COCKS) {
      const door = SIDE_DOORS.find((d) => d.id === cock.doorId);
      expect(door).toBeDefined();
      if (!door) continue;
      expect(Math.sign(cock.position[0])).toBe(sideSign(door.side ?? "left"));
      expect(HALF_W - Math.abs(cock.position[0])).toBeLessThan(0.1);
      const [z0, z1] = doorZRange(door);
      const half = DOOR_COCK.width / 2;
      const cz: [number, number] = [cock.position[2] - half, cock.position[2] + half];
      expect(rangesOverlap(cz, [z0, z1])).toBe(false);
      const gap = Math.max(z0 - cz[1], cz[0] - z1);
      expect(gap).toBeLessThan(0.5);
    }
  });

  it("座席と重ならない", () => {
    for (const cock of DOOR_COCKS) {
      for (const seat of TRAIN_SEATS) {
        const f = seatFootprint(seat);
        const dz = Math.abs(cock.position[2] - f.centerZ) - f.halfZ - DOOR_COCK.width / 2;
        const dx = Math.abs(cock.position[0] - f.centerX) - f.halfX;
        expect(dz > -EPS || dx > -EPS).toBe(true);
      }
    }
  });

  it("非常通報装置は車内の側面の壁にある", () => {
    expect(HALF_W - Math.abs(EMERGENCY_INTERCOM.position[0])).toBeLessThan(0.1);
    expect(Math.abs(EMERGENCY_INTERCOM.position[2])).toBeLessThan(HALF_L);
  });
});

describe("開始位置", () => {
  const [sx, sy, sz] = TRAIN_START.position;

  it("目の高さ 1.6m・指定の位置と向き", () => {
    expect(sy).toBe(1.6);
    expect(sx).toBeCloseTo(-0.92);
    expect(sz).toBeCloseTo(3.28);
    expect(TRAIN_START.yaw).toBeCloseTo(0.25);
  });

  it("車内にある", () => {
    expect(Math.abs(sx)).toBeLessThan(HALF_W);
    expect(Math.abs(sz)).toBeLessThan(HALF_L);
  });

  /** 開始位置に最も近い側面のドア */
  function nearestDoor(): { door: TrainDoorDef; distance: number } {
    const list = SIDE_DOORS.map((door) => {
      const [z0, z1] = doorZRange(door);
      const x = door.wall.origin[0];
      return { door, distance: Math.hypot(sx - x, sz - (z0 + z1) / 2) };
    }).sort((a, b) => a.distance - b.distance);
    return list[0];
  }

  it("ドア付近（開口部の中心から 1.5m 以内）", () => {
    expect(nearestDoor().distance).toBeLessThan(1.5);
  });

  it("すぐ横（0.6m 以内）に縦の手すりがあり，手すりとは重ならない", () => {
    const vertical = TRAIN_HANDRAILS.filter((h) => h.orientation === "vertical");
    const distances = vertical.map((h) => Math.hypot(h.position[0] - sx, h.position[2] - sz));
    expect(Math.min(...distances)).toBeLessThan(0.6);
    // 体の厚みのぶん（手すりの半径 + 0.1m）離れている
    expect(Math.min(...distances)).toBeGreaterThan(POLE.diameter / 2 + 0.1);
  });

  it("座席と重ならない（0.1m 以上離れている）", () => {
    for (const seat of TRAIN_SEATS) {
      expect(distanceToFootprint(sx, sz, seatFootprint(seat))).toBeGreaterThan(0.1);
    }
  });

  it("開始位置に近いドアには非常用ドアコックがある", () => {
    const { door } = nearestDoor();
    expect(DOOR_COCKS.some((c) => c.doorId === door.id)).toBe(true);
  });
});

describe("車外", () => {
  it("ホームは左側面の外にある", () => {
    expect(PLATFORM.side).toBe("left");
    expect(PLATFORM.gap).toBeGreaterThanOrEqual(0);
    expect(PLATFORM.width).toBeGreaterThan(0);
    expect(PLATFORM.length).toBeGreaterThanOrEqual(CAR.length);
    expect(Math.abs(PLATFORM.y)).toBeLessThan(0.3);
  });

  it("景色の板は車体の外", () => {
    expect(OUTSIDE_BOARD.distance).toBeGreaterThan(0);
    expect(OUTSIDE_BOARD.length).toBeGreaterThanOrEqual(CAR.length);
  });
});

describe("id の一意性（定義全体）", () => {
  it("座席・手すり・つり革・ドア・扉・ドアコック・通報装置・網棚・荷物の id が重ならない", () => {
    const doors = [...SIDE_DOORS, ...GANGWAY_DOORS];
    const ids = [
      ...TRAIN_SEATS.map((s) => s.id),
      ...TRAIN_HANDRAILS.map((h) => h.id),
      ...TRAIN_STRAPS.map((s) => s.id),
      ...doors.map((d) => d.id),
      ...doors.flatMap((d) => d.leaves.map((l) => `${d.id}-${l.suffix}`)),
      ...DOOR_COCKS.map((c) => c.id),
      EMERGENCY_INTERCOM.id,
      ...TRAIN_RACKS.map((r) => r.id),
      ...TRAIN_LUGGAGE.map((l) => l.id),
    ];
    expect(new Set(ids).size).toBe(ids.length);
  });
});
