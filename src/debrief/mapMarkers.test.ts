// 結果画面の地図の訓練条件の印（mapMarkers.ts）の位置と大きさのテスト．ピクセルは見ず，印の形を決める数だけを確かめる．
// 基準は docs/04_SPEC/SPEC_01 のモジュール表の debrief/（地図の描き方はエディタと同じ見た目にそろえ，印の比率は mapMarkers.ts に
// 書き写す．火元の炎の印・開始地点の人の印と向きの矢印・集合場所の枠と旗）と Issue #175（エディタの drawMarkers の比率にそろえる）
import { describe, expect, it } from "vitest";
import type { MapLayout, MapPoint } from "./mapLayout";
import { assemblyMarker, fireMarker, markerOutlineWidth, startMarker } from "./mapMarkers";

const layout = (overrides: Partial<MapLayout> = {}): MapLayout => ({
  cellPx: 20,
  offsetX: 8,
  offsetY: 8,
  widthPx: 380,
  heightPx: 260,
  ...overrides,
});

describe("markerOutlineWidth", () => {
  it("マスの大きさの 6%（エディタと同じ）", () => {
    expect(markerOutlineWidth(40)).toBeCloseTo(2.4);
    expect(markerOutlineWidth(100)).toBeCloseTo(6);
  });

  it.each([0, 1, 10, 16])("小さいマスでも 1 px より細くしない（cellPx %s）", (cellPx) => {
    expect(markerOutlineWidth(cellPx)).toBe(1);
  });

  it("マスが大きいほど太い（比例）", () => {
    expect(markerOutlineWidth(200)).toBeCloseTo(markerOutlineWidth(100) * 2);
  });
});

describe("fireMarker", () => {
  it("外側の炎はマスの中心に，半分の高さはマスの 0.36", () => {
    const m = fireMarker(layout(), { x: 2, z: 1 });
    // 中心は offset + (x + 0.5) * cellPx
    expect(m.outer.cx).toBeCloseTo(8 + 2.5 * 20);
    expect(m.outer.cy).toBeCloseTo(8 + 1.5 * 20);
    expect(m.outer.size).toBeCloseTo(20 * 0.36);
  });

  it("内側の炎は外側より小さく（0.18），マスの 0.1 だけ下に寄せる", () => {
    const m = fireMarker(layout(), { x: 2, z: 1 });
    expect(m.inner.cx).toBeCloseTo(m.outer.cx);
    expect(m.inner.cy).toBeCloseTo(m.outer.cy + 20 * 0.1);
    expect(m.inner.size).toBeCloseTo(20 * 0.18);
    expect(m.inner.size).toBeLessThan(m.outer.size);
  });

  it("大きさはマスの大きさに比例する", () => {
    const small = fireMarker(layout({ cellPx: 10 }), { x: 0, z: 0 });
    const large = fireMarker(layout({ cellPx: 30 }), { x: 0, z: 0 });
    expect(large.outer.size).toBeCloseTo(small.outer.size * 3);
    expect(large.inner.size).toBeCloseTo(small.inner.size * 3);
  });

  it("炎はマスの中に収まる", () => {
    const s = 24;
    const m = fireMarker(layout({ cellPx: s, offsetX: 0, offsetY: 0 }), { x: 3, z: 2 });
    for (const f of [m.outer, m.inner]) {
      expect(f.cy - f.size).toBeGreaterThanOrEqual(2 * s);
      expect(f.cy + f.size).toBeLessThanOrEqual(3 * s);
    }
  });

  it("cellPx が 0 でも数で返す（大きさ 0）", () => {
    const m = fireMarker(layout({ cellPx: 0 }), { x: 2, z: 1 });
    expect(m.outer.size).toBe(0);
    expect(m.inner.size).toBe(0);
    expect(m.outer.cx).toBe(8);
    expect(m.outer.cy).toBe(8);
  });
});

describe("assemblyMarker", () => {
  it("枠はマスの内側に 0.1 だけ寄せ，線の太さもマスの 0.1", () => {
    const m = assemblyMarker(layout({ cellPx: 40 }), { x: 1, z: 2 });
    const left = 8 + 40;
    const top = 8 + 80;
    expect(m.frame.x).toBeCloseTo(left + 4);
    expect(m.frame.y).toBeCloseTo(top + 4);
    expect(m.frame.width).toBeCloseTo(32);
    expect(m.frame.height).toBeCloseTo(32);
    expect(m.frameWidth).toBeCloseTo(4);
  });

  it("竿はマスの左から 0.38，上下は 0.25〜0.75．旗は竿の上端から 0.68 の所へ出る三角", () => {
    const m = assemblyMarker(layout({ cellPx: 40 }), { x: 1, z: 2 });
    const left = 8 + 40;
    const top = 8 + 80;
    const poleX = left + 40 * 0.38;
    expect(m.poleBottom.x).toBeCloseTo(poleX);
    expect(m.poleBottom.y).toBeCloseTo(top + 30);
    expect(m.poleTop.x).toBeCloseTo(poleX);
    expect(m.poleTop.y).toBeCloseTo(top + 10);
    expect(m.poleWidth).toBeCloseTo(2);
    expect(m.flag[0].x).toBeCloseTo(poleX);
    expect(m.flag[0].y).toBeCloseTo(top + 10);
    expect(m.flag[1].x).toBeCloseTo(left + 40 * 0.68);
    expect(m.flag[1].y).toBeCloseTo(top + 40 * 0.36);
    expect(m.flag[2].x).toBeCloseTo(poleX);
    expect(m.flag[2].y).toBeCloseTo(top + 40 * 0.47);
  });

  it("旗の根元は竿の上端と同じ点", () => {
    const m = assemblyMarker(layout(), { x: 4, z: 0 });
    expect(m.flag[0]).toEqual(m.poleTop);
  });

  it("小さいマスでは枠の寄せ・太さは 2 px，竿は 1 px より細くしない", () => {
    const m = assemblyMarker(layout({ cellPx: 10 }), { x: 0, z: 0 });
    expect(m.frame.x).toBeCloseTo(8 + 2);
    expect(m.frame.width).toBeCloseTo(10 - 4);
    expect(m.frameWidth).toBe(2);
    expect(m.poleWidth).toBe(1);
  });

  it("cellPx が 0 でも例外を投げず，太さは下限の値", () => {
    const m = assemblyMarker(layout({ cellPx: 0 }), { x: 3, z: 3 });
    expect(m.frameWidth).toBe(2);
    expect(m.poleWidth).toBe(1);
    expect(m.poleTop).toEqual({ x: 8, y: 8 });
  });
});

describe("startMarker", () => {
  const at: MapPoint = { u: 2.5, v: 1.5 };
  const center = { x: 8 + 2.5 * 20, y: 8 + 1.5 * 20 };

  it("人の印の丸はマスの中心に半径 0.24．頭・胴は丸の半径に対する比率", () => {
    const m = startMarker(layout(), at, { u: 0, v: -1 });
    const r = 20 * 0.24;
    expect(m.body.x).toBeCloseTo(center.x);
    expect(m.body.y).toBeCloseTo(center.y);
    expect(m.body.r).toBeCloseTo(r);
    expect(m.head.x).toBeCloseTo(center.x);
    expect(m.head.y).toBeCloseTo(center.y - r * 0.35);
    expect(m.head.r).toBeCloseTo(r * 0.3);
    expect(m.torso.x).toBeCloseTo(center.x);
    expect(m.torso.y).toBeCloseTo(center.y + r * 0.6);
    expect(m.torso.r).toBeCloseTo(r * 0.5);
  });

  it("上向き: 矢印の先は中心からマスの 0.48 上，根元は 0.2 上で左右に 0.2 ずつ広がる", () => {
    const m = startMarker(layout(), at, { u: 0, v: -1 });
    if (m.arrow === null) throw new Error("矢印がありません");
    const [tip, a, b] = m.arrow;
    expect(tip.x).toBeCloseTo(center.x);
    expect(tip.y).toBeCloseTo(center.y - 20 * 0.48);
    expect(a.y).toBeCloseTo(center.y - 20 * 0.2);
    expect(b.y).toBeCloseTo(center.y - 20 * 0.2);
    expect(Math.abs(a.x - b.x)).toBeCloseTo(20 * 0.4);
    expect((a.x + b.x) / 2).toBeCloseTo(center.x);
  });

  it.each([
    ["右", { u: 1, v: 0 }],
    ["下", { u: 0, v: 1 }],
    ["左", { u: -1, v: 0 }],
  ])("%s向き: 矢印の先はその向きにマスの 0.48 だけ出る", (_, dir) => {
    const m = startMarker(layout(), at, dir);
    const tip = m.arrow?.[0];
    expect(tip?.x).toBeCloseTo(center.x + dir.u * 20 * 0.48);
    expect(tip?.y).toBeCloseTo(center.y + dir.v * 20 * 0.48);
  });

  it("矢印の先は人の印の丸の外に出る", () => {
    const m = startMarker(layout(), at, { u: Math.SQRT1_2, v: Math.SQRT1_2 });
    const tip = m.arrow?.[0];
    expect(tip).toBeDefined();
    if (tip === undefined) return;
    expect(Math.hypot(tip.x - center.x, tip.y - center.y)).toBeGreaterThan(m.body.r);
  });

  it("大きさはマスの大きさに比例する", () => {
    const small = startMarker(layout({ cellPx: 10, offsetX: 0, offsetY: 0 }), at, { u: 1, v: 0 });
    const large = startMarker(layout({ cellPx: 30, offsetX: 0, offsetY: 0 }), at, { u: 1, v: 0 });
    expect(large.body.r).toBeCloseTo(small.body.r * 3);
    expect(large.arrow?.[0].x).toBeCloseTo((small.arrow?.[0].x ?? Number.NaN) * 3);
  });

  it("向きが null の時は矢印を出さない（人の印は出す）", () => {
    const m = startMarker(layout(), at, null);
    expect(m.arrow).toBeNull();
    expect(m.body.r).toBeCloseTo(20 * 0.24);
  });

  it.each([
    { u: Number.NaN, v: 0 },
    { u: 0, v: Number.NaN },
    { u: Number.POSITIVE_INFINITY, v: 0 },
    { u: 0, v: Number.NEGATIVE_INFINITY },
  ])("向きが数でない時は矢印を出さない（%o）", (dir) => {
    expect(startMarker(layout(), at, dir).arrow).toBeNull();
  });

  it("cellPx が 0 でも例外を投げず，印の大きさは 0", () => {
    const m = startMarker(layout({ cellPx: 0 }), at, { u: 0, v: -1 });
    expect(m.body.r).toBe(0);
    expect(m.body.x).toBe(8);
  });
});
