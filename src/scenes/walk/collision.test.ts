// 歩行の当たり判定（純粋な関数）のテスト．Issue #31「壁・物をすり抜けない」を基準にする

import { describe, expect, it } from "vitest";
import {
  type BodyShape,
  blocksBody,
  circleOverlapsRect,
  DEFAULT_BODY,
  headroomAt,
  moveWithCollision,
  type Obstacle,
  onFloor,
  pushOutOfRect,
  rectContains,
  resolveOverlaps,
  type XZRect,
} from "./collision";

const BODY: BodyShape = DEFAULT_BODY;
const R = BODY.radius;
const BIG_FLOOR: readonly XZRect[] = [{ minX: -10, maxX: 10, minZ: -10, maxZ: 10 }];

function box(
  id: string,
  minX: number,
  maxX: number,
  minZ: number,
  maxZ: number,
  minY = 0,
  maxY = 2,
): Obstacle {
  return { id, minX, maxX, minZ, maxZ, minY, maxY };
}

describe("circleOverlapsRect / pushOutOfRect", () => {
  const rect: XZRect = { minX: 0, maxX: 1, minZ: 0, maxZ: 1 };

  it("離れた円・接するだけの円は重ならず，押し出しても動かない", () => {
    expect(circleOverlapsRect(-0.5, 0.5, 0.2, rect)).toBe(false);
    expect(circleOverlapsRect(-0.2, 0.5, 0.2, rect)).toBe(false);
    expect(pushOutOfRect(-0.5, 0.5, 0.2, rect)).toEqual({ x: -0.5, z: 0.5 });
  });

  it("辺に食い込んだ円は辺の外へ半径ぶん離れた位置に押し出される", () => {
    const p = pushOutOfRect(-0.1, 0.5, 0.2, rect);
    expect(p.x).toBeCloseTo(-0.2);
    expect(p.z).toBeCloseTo(0.5);
    expect(circleOverlapsRect(p.x, p.z, 0.2 - 1e-9, rect)).toBe(false);
  });

  it("角に食い込んだ円は角から半径ぶん離れる", () => {
    const p = pushOutOfRect(-0.05, -0.05, 0.2, rect);
    expect(Math.hypot(p.x, p.z)).toBeCloseTo(0.2);
    expect(p.x).toBeLessThan(0);
    expect(p.z).toBeLessThan(0);
  });

  it("中心が矩形の中なら最も近い辺の外へ出る", () => {
    const p = pushOutOfRect(0.9, 0.5, 0.2, rect);
    expect(p.x).toBeCloseTo(1.2);
    expect(p.z).toBeCloseTo(0.5);
  });
});

describe("rectContains / onFloor", () => {
  it("境界上は含む．床は矩形の和", () => {
    const a: XZRect = { minX: 0, maxX: 1, minZ: 0, maxZ: 1 };
    const b: XZRect = { minX: 1, maxX: 2, minZ: 0, maxZ: 0.5 };
    expect(rectContains(a, 1, 1)).toBe(true);
    expect(rectContains(a, 1.0001, 1)).toBe(false);
    expect(onFloor([a, b], 1.5, 0.25)).toBe(true);
    expect(onFloor([a, b], 1.5, 0.75)).toBe(false);
  });
});

describe("blocksBody（高さの範囲）", () => {
  it("またげる高さ（stepHeight 以下）の物はふさがない", () => {
    expect(blocksBody(box("sill", 0, 1, 0, 1, 0, BODY.stepHeight), 1.7, BODY)).toBe(false);
    expect(blocksBody(box("step", 0, 1, 0, 1, 0, BODY.stepHeight + 0.01), 1.7, BODY)).toBe(true);
  });

  it("頭のてっぺんより上の物はふさがない．頭のてっぺんと下面が同じ高さでもふさがない", () => {
    expect(blocksBody(box("top", 0, 1, 0, 1, 0.68, 0.72), 0.65, BODY)).toBe(false);
    expect(blocksBody(box("top", 0, 1, 0, 1, 0.68, 0.72), 0.68, BODY)).toBe(false);
    expect(blocksBody(box("top", 0, 1, 0, 1, 0.68, 0.72), 0.7, BODY)).toBe(true);
  });
});

describe("moveWithCollision", () => {
  it("障害物が無ければ指定どおりに動く", () => {
    const p = moveWithCollision(0, 0, 0.3, -0.4, 1.7, [], BIG_FLOOR, BODY);
    expect(p.x).toBeCloseTo(0.3);
    expect(p.z).toBeCloseTo(-0.4);
  });

  it("薄い壁に向かって 1 回で大きく動いても，すり抜けない", () => {
    const wall = box("wall", 0, 0.02, -5, 5);
    const p = moveWithCollision(-1, 0, 3, 0, 1.7, [wall], BIG_FLOOR, BODY);
    expect(p.x).toBeLessThanOrEqual(0 - R + 1e-6);
    expect(p.x).toBeCloseTo(-R, 3);
  });

  it("壁に斜めに当たると壁に沿って滑る", () => {
    const wall = box("wall", 0, 0.1, -5, 5);
    const p = moveWithCollision(-0.5, 0, 1, 1, 1.7, [wall], BIG_FLOOR, BODY);
    expect(p.x).toBeCloseTo(-R, 3);
    expect(p.z).toBeGreaterThan(0.9);
  });

  it("体の中心は床の範囲の外へ出ない（床の端に沿って滑る）", () => {
    const floor: readonly XZRect[] = [{ minX: -1, maxX: 1, minZ: -1, maxZ: 1 }];
    const p = moveWithCollision(0.5, 0, 2, 0.5, 1.7, [], floor, BODY);
    expect(onFloor(floor, p.x, p.z)).toBe(true);
    expect(p.x).toBeLessThanOrEqual(1);
    expect(p.z).toBeGreaterThan(0.4);
  });

  it("頭より上の物（天板）は通り抜けられるが，頭がぶつかる高さなら止まる", () => {
    const top = box("top", 0, 1, -1, 1, 0.68, 0.72);
    const low = moveWithCollision(-0.5, 0, 1, 0, 0.65, [top], BIG_FLOOR, BODY);
    expect(low.x).toBeCloseTo(0.5);
    const high = moveWithCollision(-0.5, 0, 1, 0, 1.7, [top], BIG_FLOOR, BODY);
    expect(high.x).toBeCloseTo(-R, 3);
  });

  it("2 つの物の角に押し込んでも，どちらとも重ならない", () => {
    const a = box("a", 0, 1, -5, 5);
    const b = box("b", -5, 5, 0, 1);
    const p = moveWithCollision(-0.5, -0.5, 1, 1, 1.7, [a, b], BIG_FLOOR, BODY);
    expect(circleOverlapsRect(p.x, p.z, R - 1e-6, a)).toBe(false);
    expect(circleOverlapsRect(p.x, p.z, R - 1e-6, b)).toBe(false);
  });
});

describe("moveWithCollision: 体の直径より狭いすき間", () => {
  it("すき間（座席の端と縦の握り棒の間と同じ形）に押し込んでも，すき間を抜けて向こうへ出ない", () => {
    // 電車の seat-right-1 の端と pole-door-right-1-front の配置（すき間 0.324m < 直径 0.36m）
    const seat = box("seat", 0.85, 1.4, -4.9, -3.47, 0, 1.05);
    const pole = box("pole", 1.264, 1.296, -3.146, -3.114, 0, 2.3);
    const wall = box("wall", 1.4, 1.5, -5, 5, 0, 2.3);
    let p = { x: 0.9, z: -3.3 };
    for (let i = 0; i < 60; i++) {
      p = moveWithCollision(p.x, p.z, 0.067, 0, 1.7, [seat, pole, wall], BIG_FLOOR, BODY);
    }
    expect(p.x).toBeLessThan(1.4 - R + 1e-6);
  });
});

describe("resolveOverlaps", () => {
  it("ふさぐ物に重なった体を外へ出す．ふさがない高さの物は無視する", () => {
    const wall = box("wall", 0, 1, -1, 1);
    const p = resolveOverlaps(0.1, 0, 1.7, [wall], BODY);
    expect(circleOverlapsRect(p.x, p.z, R - 1e-6, wall)).toBe(false);
    const top = box("top", 0, 1, -1, 1, 0.68, 0.72);
    expect(resolveOverlaps(0.1, 0, 0.65, [top], BODY)).toEqual({ x: 0.1, z: 0 });
  });
});

describe("headroomAt", () => {
  it("頭上の物の下面のうち最も低い高さを返す．無ければ Infinity", () => {
    const top = box("top", 0, 1, -1, 1, 0.68, 0.72);
    const shelf = box("shelf", 0, 1, -1, 1, 1.5, 1.6);
    expect(headroomAt(0.5, 0, 0.65, [shelf, top], BODY)).toBeCloseTo(0.68);
    expect(headroomAt(-1, 0, 0.65, [top], BODY)).toBe(Number.POSITIVE_INFINITY);
  });

  it("体の縁が少しでも物の下にあれば頭上の物とみなす", () => {
    const top = box("top", 0, 1, -1, 1, 0.68, 0.72);
    expect(headroomAt(-R + 0.01, 0, 0.65, [top], BODY)).toBeCloseTo(0.68);
  });
});
