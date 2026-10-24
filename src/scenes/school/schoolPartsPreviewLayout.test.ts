// 確認用の空間に並べるパーツの一覧（schoolPartsPreviewLayout.ts）のテスト．定義の整合性を確かめる．
// 基準は Issue #73（完了条件: 1 マス分の大きさで原点と向きの約束がそろい，隣に並べても隙間や重なりが出ない）と
// 引継ぎメモ（辺の物は下限を下回らない・壁の交わる点に柱・外側だけの教室の廊下側はすりガラスと開かないドア・
// 引き戸は +Z 側・出口の外は -Z 側）

import { describe, expect, it } from "vitest";
import { edgeLayout, minEdgeLength, placePoint, placeRect, type XZPoint } from "./schoolLayout";
import {
  PREVIEW_BLOCKS,
  PREVIEW_GROUND,
  PREVIEW_START,
  type PreviewBlockSpec,
  type PreviewPart,
  previewBlockParts,
  previewParts,
} from "./schoolPartsPreviewLayout";

type EdgePart = Extract<PreviewPart, { type: "edge" }>;

const EPS = 1e-6;
const parts = previewParts();
const edges = parts.filter((p): p is EdgePart => p.type === "edge");

function endpoints(edge: EdgePart): [XZPoint, XZPoint] {
  return [
    placePoint({ x: -edge.length / 2, z: 0 }, edge.placement),
    placePoint({ x: edge.length / 2, z: 0 }, edge.placement),
  ];
}

/** 辺のローカル +Z の側（辺の中心から dist だけ離れた点） */
function sidePoint(edge: EdgePart, localZ: number): XZPoint {
  return placePoint({ x: 0, z: localZ }, edge.placement);
}

function blockOf(id: string): PreviewBlockSpec {
  const block = PREVIEW_BLOCKS.find((b) => id.startsWith(`${b.id}-`));
  if (!block) throw new Error(`棟がない: ${id}`);
  return block;
}

function edge(id: string): EdgePart {
  const found = edges.find((e) => e.id === id);
  if (!found) throw new Error(`辺がない: ${id}`);
  return found;
}

describe("previewParts", () => {
  it("2 棟で，大きさ（天井の高さ・廊下の幅）が違う", () => {
    expect(PREVIEW_BLOCKS).toHaveLength(2);
    const [a, b] = PREVIEW_BLOCKS;
    expect(a?.ceilingHeight).not.toBe(b?.ceilingHeight);
    expect(a?.corridorWidth).not.toBe(b?.corridorWidth);
  });

  it("id は重ならず，棟の id で始まる", () => {
    expect(new Set(parts.map((p) => p.id)).size).toBe(parts.length);
    for (const p of parts) blockOf(p.id);
  });

  it("全種類のパーツ（教室・廊下・壁・窓付きの壁・ドア・出口・防火シャッター・柱）を含む", () => {
    expect(parts.some((p) => p.type === "classroom")).toBe(true);
    expect(parts.some((p) => p.type === "floor" && p.kind === "corridor")).toBe(true);
    expect(parts.some((p) => p.type === "post")).toBe(true);
    const kinds = new Set(edges.map((e) => e.kind));
    expect([...kinds].sort()).toEqual(["door", "exit", "fireShutter", "wall", "windowWall"]);
  });

  it("各棟に中身ありと外側だけの教室が 1 つずつある", () => {
    for (const block of PREVIEW_BLOCKS) {
      const rooms = previewBlockParts(block).filter((p) => p.type === "classroom");
      expect(rooms).toHaveLength(2);
      expect(rooms.map((r) => (r.type === "classroom" ? r.interior : "")).sort()).toEqual([
        "furnished",
        "shell",
      ]);
    }
  });

  it("各パーツの天井の高さは棟の天井の高さ", () => {
    for (const p of parts) {
      const h = p.type === "edge" ? p.height : p.type === "post" ? p.height : p.ceilingHeight;
      expect(h).toBe(blockOf(p.id).ceilingHeight);
    }
  });

  it("辺の長さはどれも種類の下限以上（作る時に RangeError にならない）", () => {
    for (const e of edges) {
      expect(e.length, e.id).toBeGreaterThanOrEqual(minEdgeLength(e.kind));
      expect(() => edgeLayout(e.kind, e.length, e.height)).not.toThrow();
    }
  });

  it("辺の端点にはすべて柱があり，柱は辺の端点にだけある", () => {
    // -0 と 0 を同じにするため，丸めてから 0 を足す
    const r = (v: number) => (Math.round(v * 1000) / 1000 + 0).toFixed(3);
    const key = (p: XZPoint) => `${r(p.x)},${r(p.z)}`;
    const ends = new Set(edges.flatMap(endpoints).map(key));
    const posts = parts
      .filter((p) => p.type === "post")
      .map((p) => key({ x: p.placement.x, z: p.placement.z }));
    expect(new Set(posts).size).toBe(posts.length);
    expect(new Set(posts)).toEqual(ends);
  });

  it("同じ線の上の辺どうしは端点でしか接せず，重ならない", () => {
    for (const [i, a] of edges.entries()) {
      const [a0, a1] = endpoints(a);
      for (const b of edges.slice(i + 1)) {
        const [b0, b1] = endpoints(b);
        const horizontal = [a0, a1, b0, b1].every((p) => Math.abs(p.z - a0.z) < EPS);
        const vertical = [a0, a1, b0, b1].every((p) => Math.abs(p.x - a0.x) < EPS);
        if (!horizontal && !vertical) continue;
        const along = (p: XZPoint) => (horizontal ? p.x : p.z);
        const [aMin, aMax] = [Math.min(along(a0), along(a1)), Math.max(along(a0), along(a1))];
        const [bMin, bMax] = [Math.min(along(b0), along(b1)), Math.max(along(b0), along(b1))];
        const overlap = Math.min(aMax, bMax) - Math.max(aMin, bMin);
        expect(overlap, `${a.id} と ${b.id}`).toBeLessThanOrEqual(EPS);
      }
    }
  });

  it("床の面（教室・廊下）どうしは重ならず，間に隙間もない（棟の床の面積の和が棟の外形に等しい）", () => {
    for (const block of PREVIEW_BLOCKS) {
      const rects = previewBlockParts(block)
        .filter((p) => p.type === "floor" || p.type === "classroom")
        .map((p) => {
          if (p.type !== "floor" && p.type !== "classroom") throw new Error("unreachable");
          const half = { x: p.width / 2, z: p.depth / 2 };
          return placeRect(
            { minX: -half.x, maxX: half.x, minZ: -half.z, maxZ: half.z },
            p.placement,
          );
        });
      for (const [i, a] of rects.entries()) {
        for (const b of rects.slice(i + 1)) {
          const ox = Math.min(a.maxX, b.maxX) - Math.max(a.minX, b.minX);
          const oz = Math.min(a.maxZ, b.maxZ) - Math.max(a.minZ, b.minZ);
          expect(ox <= EPS || oz <= EPS).toBe(true);
        }
      }
      // 廊下は全長，教室は廊下の北に接する
      const corridorArea = (block.squareSize + block.rectDepth) * block.corridorWidth;
      const roomsArea = block.squareSize ** 2 + block.rectDepth * block.rectWidth;
      const total = rects.reduce((s, r) => s + (r.maxX - r.minX) * (r.maxZ - r.minZ), 0);
      expect(total).toBeCloseTo(corridorArea + roomsArea, 6);
    }
  });

  it("教室は黒板（ローカル -Z）を東に向ける", () => {
    for (const p of parts) {
      if (p.type !== "classroom") continue;
      const board = placePoint({ x: 0, z: -1 }, p.placement);
      expect(board.x - p.placement.x).toBeCloseTo(1);
      expect(board.z - p.placement.z).toBeCloseTo(0);
    }
  });
});

describe("previewParts の廊下側のドアと窓", () => {
  it("外側だけの教室の廊下側はすりガラスと開かないドア，中身ありは透明で開くドア", () => {
    for (const block of PREVIEW_BLOCKS) {
      const rectInterior = block.squareInterior === "furnished" ? "shell" : "furnished";
      for (const [room, interior] of [
        ["square", block.squareInterior],
        ["rect", rectInterior],
      ] as const) {
        const expected =
          interior === "shell"
            ? { glass: "frosted", locked: true }
            : { glass: "clear", locked: false };
        for (const name of ["door-back", "corridor-window", "door-front"]) {
          expect(edge(`${block.id}-${room}-${name}`)).toMatchObject(expected);
        }
      }
    }
  });

  it("引き戸の扉（ローカル +Z）は廊下の側にある", () => {
    for (const e of edges.filter((x) => x.kind === "door")) {
      const block = blockOf(e.id);
      const p = sidePoint(e, 0.5);
      expect(p.z - block.originZ, e.id).toBeGreaterThan(0);
      expect(p.z - block.originZ, e.id).toBeLessThan(block.corridorWidth);
    }
  });

  it("出口の外（ローカル -Z）は建物の外（廊下の南），内側（+Z）は廊下", () => {
    for (const e of edges.filter((x) => x.kind === "exit")) {
      const block = blockOf(e.id);
      expect(sidePoint(e, -0.5).z - block.originZ).toBeGreaterThan(block.corridorWidth);
      expect(sidePoint(e, 0.5).z - block.originZ).toBeLessThan(block.corridorWidth);
    }
  });

  it("防火シャッターは各棟の廊下を横切り，閉・開の両方の状態がある", () => {
    const shutters = edges.filter((x) => x.kind === "fireShutter");
    expect(shutters).toHaveLength(2);
    expect(shutters.map((s) => s.closed).sort()).toEqual([false, true]);
    for (const s of shutters) {
      const block = blockOf(s.id);
      expect(s.length).toBeCloseTo(block.corridorWidth);
      expect(s.closed).toBe(block.shutterClosed);
    }
  });
});

describe("PREVIEW_START・PREVIEW_GROUND", () => {
  it("すべてのパーツは外の地面の範囲の中にある", () => {
    for (const p of parts) {
      expect(p.placement.x).toBeGreaterThanOrEqual(PREVIEW_GROUND.minX);
      expect(p.placement.x).toBeLessThanOrEqual(PREVIEW_GROUND.maxX);
      expect(p.placement.z).toBeGreaterThanOrEqual(PREVIEW_GROUND.minZ);
      expect(p.placement.z).toBeLessThanOrEqual(PREVIEW_GROUND.maxZ);
    }
  });

  it("開始位置は地面の中で，どの棟の床の面にも入らない（建物の外）", () => {
    expect(PREVIEW_START.x).toBeGreaterThan(PREVIEW_GROUND.minX);
    expect(PREVIEW_START.x).toBeLessThan(PREVIEW_GROUND.maxX);
    expect(PREVIEW_START.z).toBeGreaterThan(PREVIEW_GROUND.minZ);
    expect(PREVIEW_START.z).toBeLessThan(PREVIEW_GROUND.maxZ);
    for (const p of parts) {
      if (p.type !== "floor" && p.type !== "classroom") continue;
      const r = placeRect(
        { minX: -p.width / 2, maxX: p.width / 2, minZ: -p.depth / 2, maxZ: p.depth / 2 },
        p.placement,
      );
      const inside =
        PREVIEW_START.x >= r.minX &&
        PREVIEW_START.x <= r.maxX &&
        PREVIEW_START.z >= r.minZ &&
        PREVIEW_START.z <= r.maxZ;
      expect(inside, p.id).toBe(false);
    }
  });
});
