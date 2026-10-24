// 校舎のパーツの寸法・配置・当たり判定の範囲（schoolLayout.ts）のテスト．
// 基準は Issue #73 の引継ぎメモの「確定した重要な設計判断」（パーツの寸法は仕様書にまだ無いため）:
// - 大きさは引数で受け取る（既定はマス 4 m・天井 3 m）．下限を下回ると RangeError
//   （ドアの辺 2.32 m，出口 2.72 m，シャッター 1.28 m，天井 2.5 m）
// - 辺に置く物は辺の長さを受け取り，ドアや窓は実寸，残りの壁が伸び縮みする
// - 床の面は中心の床の上が原点（幅＝ローカル X，奥行き＝ローカル Z）．辺の物は辺の中心の床の上が原点で，
//   辺はローカル X に沿い，引き戸は +Z 側，出口の外は -Z 側．壁が交わる点に柱を置いて隙間を防ぐ

import { describe, expect, it } from "vitest";
import type { WallRect } from "../common/wallLayout";
import type { Obstacle, XZRect } from "../walk/collision";
import {
  assertCeilingHeight,
  CEILING_LIGHT,
  DEFAULT_CEILING_HEIGHT,
  DEFAULT_CELL_SIZE,
  DOOR,
  doorLeafLayout,
  doorOpening,
  type EdgeKind,
  EXIT,
  edgeClosableObstacle,
  edgeLayout,
  edgeLocalX,
  edgePlacementBetween,
  edgeStaticObstacles,
  edgeWallLength,
  exitOpening,
  exitOutsideRect,
  FIRE_SHUTTER,
  fireShutterCurtainObstacles,
  fireShutterLayout,
  floorSurfaceLayout,
  lightCount,
  MIN_CEILING_HEIGHT,
  MIN_FLOOR_SIZE,
  MIN_WINDOW_EDGE_LENGTH,
  minEdgeLength,
  POST_SIZE,
  placeObstacle,
  placePoint,
  placeRect,
  postObstacle,
  tileRepeat,
  WALL_THICKNESS,
  WINDOW,
  windowOpenings,
} from "./schoolLayout";

const EDGE_KINDS: readonly EdgeKind[] = ["wall", "windowWall", "door", "exit", "fireShutter"];
const H = DEFAULT_CEILING_HEIGHT;
const L = DEFAULT_CELL_SIZE;

const area = (r: WallRect) => (r.u1 - r.u0) * (r.v1 - r.v0);

function overlaps(a: WallRect, b: WallRect): boolean {
  const eps = 1e-9;
  return a.u0 < b.u1 - eps && b.u0 < a.u1 - eps && a.v0 < b.v1 - eps && b.v0 < a.v1 - eps;
}

describe("既定値", () => {
  it("マスの一辺は 4 m，天井の高さは 3 m，天井の下限は 2.5 m", () => {
    expect(DEFAULT_CELL_SIZE).toBe(4);
    expect(DEFAULT_CEILING_HEIGHT).toBe(3);
    expect(MIN_CEILING_HEIGHT).toBe(2.5);
  });

  it("柱は壁の厚みと同じ太さ（壁の端と面がそろう）", () => {
    expect(POST_SIZE).toBe(WALL_THICKNESS);
  });
});

describe("assertCeilingHeight", () => {
  it.each([2.5, 3, 10])("%d m は通る", (h) => {
    expect(() => assertCeilingHeight(h)).not.toThrow();
  });

  it.each([2.4999, 0, -3, Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY])(
    "%d m は RangeError",
    (h) => {
      expect(() => assertCeilingHeight(h)).toThrow(RangeError);
    },
  );
});

describe("tileRepeat", () => {
  it.each([
    [4, 1, 4],
    [4.4, 1, 4],
    [4.6, 1, 5],
    [0.2, 1, 1],
    [0, 1, 1],
  ])("extent %d・tileSize %d は %d 枚", (extent, tile, expected) => {
    expect(tileRepeat(extent, tile)).toBe(expected);
  });

  it("数でない extent でも 1 以上の整数になる", () => {
    const n = tileRepeat(Number.NaN, 1);
    expect(Number.isInteger(n)).toBe(true);
    expect(n).toBeGreaterThanOrEqual(1);
  });
});

describe("lightCount", () => {
  it.each([
    [8, 2, 4],
    [4, 3.5, 1],
    [1, 2, 1],
    [0, 2, 1],
  ])("extent %d・pitch %d は %d 灯", (extent, pitch, expected) => {
    expect(lightCount(extent, pitch)).toBe(expected);
  });

  it("数でない extent でも 1 以上の整数になる", () => {
    const n = lightCount(Number.NaN, 2);
    expect(Number.isInteger(n)).toBe(true);
    expect(n).toBeGreaterThanOrEqual(1);
  });
});

describe("floorSurfaceLayout", () => {
  it("原点は面の中心．幅がローカル X，奥行きがローカル Z", () => {
    const layout = floorSurfaceLayout("classroom", 8, 6, 3);
    expect(layout.rect).toEqual({ minX: -4, maxX: 4, minZ: -3, maxZ: 3 });
    expect(layout).toMatchObject({ kind: "classroom", width: 8, depth: 6, ceilingHeight: 3 });
  });

  it.each(["classroom", "corridor"] as const)(
    "%s の照明は面の中で天井に付き，重ならない",
    (kind) => {
      const layout = floorSurfaceLayout(kind, 8, 8, 3);
      expect(layout.lights.length).toBeGreaterThan(0);
      for (const light of layout.lights) {
        const [sx, sy, sz] = light.size;
        const [x, y, z] = light.position;
        expect(x - sx / 2).toBeGreaterThanOrEqual(layout.rect.minX);
        expect(x + sx / 2).toBeLessThanOrEqual(layout.rect.maxX);
        expect(z - sz / 2).toBeGreaterThanOrEqual(layout.rect.minZ);
        expect(z + sz / 2).toBeLessThanOrEqual(layout.rect.maxZ);
        expect(y + sy / 2).toBeCloseTo(3);
      }
      for (const [i, a] of layout.lights.entries()) {
        for (const b of layout.lights.slice(i + 1)) {
          const apart =
            Math.abs(a.position[0] - b.position[0]) >= CEILING_LIGHT.length ||
            Math.abs(a.position[2] - b.position[2]) >= CEILING_LIGHT.width;
          expect(apart).toBe(true);
        }
      }
    },
  );

  it("教室は廊下より照明を密に並べる", () => {
    const classroom = floorSurfaceLayout("classroom", 8, 8, 3);
    const corridor = floorSurfaceLayout("corridor", 8, 8, 3);
    expect(classroom.lights.length).toBeGreaterThan(corridor.lights.length);
  });

  it("器具より小さい面には照明を付けない", () => {
    expect(floorSurfaceLayout("corridor", 1, 4, 3).lights).toEqual([]);
  });

  it("幅・奥行きは下限 0.5 m ちょうどなら作れる", () => {
    expect(MIN_FLOOR_SIZE).toBe(0.5);
    expect(() => floorSurfaceLayout("corridor", 0.5, 0.5, 3)).not.toThrow();
  });

  it.each([
    ["幅が下限をわずかに下回る", 0.4999, 4, 3],
    ["奥行きが下限をわずかに下回る", 4, 0.4999, 3],
    ["幅が負", -4, 4, 3],
    ["幅が NaN", Number.NaN, 4, 3],
    ["奥行きが Infinity", 4, Number.POSITIVE_INFINITY, 3],
    ["天井が下限をわずかに下回る", 4, 4, 2.4999],
    ["天井が NaN", 4, 4, Number.NaN],
  ])("%s と RangeError", (_, w, d, h) => {
    expect(() => floorSurfaceLayout("classroom", w, d, h)).toThrow(RangeError);
  });
});

describe("minEdgeLength", () => {
  it.each([
    ["door", 2.32],
    ["exit", 2.72],
    ["fireShutter", 1.28],
  ] as const)("%s の辺の下限は %d m", (kind, expected) => {
    expect(minEdgeLength(kind)).toBeCloseTo(expected, 9);
  });

  it("どの種類も既定のマスの一辺（4 m）に収まる", () => {
    for (const kind of EDGE_KINDS) expect(minEdgeLength(kind)).toBeLessThanOrEqual(L);
  });
});

describe("edgeLayout の下限（境界値・異常値）", () => {
  it.each([
    ["door", 2.32],
    ["exit", 2.72],
    ["fireShutter", 1.28],
  ] as const)("%s は仕様の下限 %d m ちょうどで作れる", (kind, length) => {
    expect(() => edgeLayout(kind, length, H)).not.toThrow();
  });

  it.each(EDGE_KINDS)("%s は minEdgeLength ちょうどで作れ，わずかに下回ると RangeError", (kind) => {
    const min = minEdgeLength(kind);
    expect(() => edgeLayout(kind, min, H)).not.toThrow();
    expect(() => edgeLayout(kind, min - 0.001, H)).toThrow(RangeError);
  });

  it.each(EDGE_KINDS)("%s は長さが NaN・負・Infinity なら RangeError", (kind) => {
    for (const length of [Number.NaN, -L, 0, Number.POSITIVE_INFINITY]) {
      expect(() => edgeLayout(kind, length, H)).toThrow(RangeError);
    }
  });

  it.each(EDGE_KINDS)("%s は天井 2.5 m ちょうどで作れ，下回る・NaN なら RangeError", (kind) => {
    expect(() => edgeLayout(kind, L, 2.5)).not.toThrow();
    expect(() => edgeLayout(kind, L, 2.4999)).toThrow(RangeError);
    expect(() => edgeLayout(kind, L, Number.NaN)).toThrow(RangeError);
  });
});

describe("edgeLayout の壁の板と開口部", () => {
  it("壁の板は両端の柱の半分を除いた長さで，辺の中心に置く", () => {
    const layout = edgeLayout("wall", 4, H);
    expect(layout.wallLength).toBeCloseTo(4 - POST_SIZE);
    expect(edgeWallLength(4)).toBeCloseTo(4 - POST_SIZE);
    expect(edgeLocalX(4, 0)).toBeCloseTo(-2 + POST_SIZE / 2);
    expect(edgeLocalX(4, layout.wallLength)).toBeCloseTo(2 - POST_SIZE / 2);
  });

  it("無地の壁は開口部が無く，壁の板 1 枚が全面をふさぐ", () => {
    const layout = edgeLayout("wall", 4, H);
    expect(layout.openings).toEqual([]);
    expect(layout.wallRects).toHaveLength(1);
    expect(layout.shutter).toBeNull();
  });

  it.each(
    EDGE_KINDS.flatMap((kind) =>
      [minEdgeLength(kind), 3, 4, 8].map((length) => [kind, length] as const),
    ),
  )("%s（%d m）は壁の板と開口部で壁の全面を隙間なく，重ならずに埋める", (kind, length) => {
    const layout = edgeLayout(kind, length, H);
    const pieces = [...layout.wallRects, ...layout.openings];
    for (const r of pieces) {
      expect(r.u0).toBeGreaterThanOrEqual(-1e-9);
      expect(r.u1).toBeLessThanOrEqual(layout.wallLength + 1e-9);
      expect(r.v0).toBeGreaterThanOrEqual(0);
    }
    for (const [i, a] of pieces.entries()) {
      for (const b of pieces.slice(i + 1)) expect(overlaps(a, b)).toBe(false);
    }
    // シャッターは上を収納箱がふさぐため，幕の高さまでを見る
    const top = layout.shutter ? layout.shutter.boxBottom : H;
    const total = pieces.reduce((sum, r) => sum + area(r), 0);
    expect(total).toBeCloseTo(layout.wallLength * top, 6);
  });

  it("ドアの開口部は実寸（幅 1.0 m・高さ 2.0 m）で，辺が長くなっても大きさは変わらない", () => {
    for (const length of [minEdgeLength("door"), 3, 4, 8]) {
      const [opening] = edgeLayout("door", length, H).openings;
      expect((opening?.u1 ?? 0) - (opening?.u0 ?? 0)).toBeCloseTo(DOOR.width);
      expect(opening?.v0).toBe(0);
      expect(opening?.v1).toBeCloseTo(DOOR.height);
    }
  });

  it("出口の開口部は実寸（幅 2.4 m・高さ 2.2 m）で，壁の中央", () => {
    for (const length of [minEdgeLength("exit"), 4, 8]) {
      const layout = edgeLayout("exit", length, H);
      const [opening] = layout.openings;
      if (!opening) throw new Error("開口部がない");
      expect(opening.u1 - opening.u0).toBeCloseTo(EXIT.width);
      expect(opening.v1).toBeCloseTo(EXIT.height);
      expect(opening.u0).toBeCloseTo(layout.wallLength - opening.u1);
    }
    expect(exitOpening(4).u0).toBeCloseTo((4 - EXIT.width) / 2);
  });

  it("ドアの開口部の左右に最小の壁（0.1 m）が残り，+X の側に開いた扉が収まる壁がある", () => {
    for (const length of [minEdgeLength("door"), 2.5, 3, 4, 8]) {
      const layout = edgeLayout("door", length, H);
      const [opening] = layout.openings;
      if (!opening) throw new Error("開口部がない");
      expect(opening.u0).toBeGreaterThanOrEqual(DOOR.minPier - 1e-9);
      expect(layout.wallLength - opening.u1).toBeGreaterThanOrEqual(
        DOOR.width + DOOR.minPier - 1e-9,
      );
    }
  });

  it("ドアは十分に長い辺では壁の中央に置く", () => {
    const opening = doorOpening(8);
    expect((opening.u0 + opening.u1) / 2).toBeCloseTo(4);
  });

  it("窓は実寸（幅 1.6 m）で，辺の長さに応じて数が増え，窓と窓・端の壁は 0.2 m 以上", () => {
    let previous = 0;
    for (const length of [MIN_WINDOW_EDGE_LENGTH, 3, 4, 6, 8, 12]) {
      const layout = edgeLayout("windowWall", length, H);
      expect(layout.openings.length).toBeGreaterThanOrEqual(previous);
      previous = layout.openings.length;
      let cursor = 0;
      for (const w of layout.openings) {
        expect(w.u1 - w.u0).toBeCloseTo(WINDOW.width);
        expect(w.v0).toBeCloseTo(WINDOW.sill);
        expect(w.u0 - cursor).toBeGreaterThanOrEqual(WINDOW.minPier - 1e-9);
        cursor = w.u1;
      }
      expect(layout.wallLength - cursor).toBeGreaterThanOrEqual(WINDOW.minPier - 1e-9);
    }
    expect(edgeLayout("windowWall", 4, H).openings).toHaveLength(2);
  });

  it("窓が 1 つ入る長さちょうどで窓 1 つ，わずかに短いと無地の壁になる", () => {
    expect(edgeLayout("windowWall", MIN_WINDOW_EDGE_LENGTH, H).openings).toHaveLength(1);
    const short = edgeLayout("windowWall", MIN_WINDOW_EDGE_LENGTH - 0.001, H);
    expect(short.openings).toEqual([]);
    expect(short.wallRects).toHaveLength(1);
  });

  it("天井が低い時は窓の上端を下げて天井との間に 0.2 m 残す", () => {
    const [w] = edgeLayout("windowWall", 4, 2.5).openings;
    expect(w?.v1).toBeCloseTo(2.5 - WINDOW.minHeadroom);
    const [high] = edgeLayout("windowWall", 4, 3).openings;
    expect(high?.v1).toBeCloseTo(WINDOW.sill + WINDOW.height);
  });

  it("windowOpenings は窓が低くなりすぎる高さ・入らない長さなら空", () => {
    expect(windowOpenings(4, 1.5)).toEqual([]);
    expect(windowOpenings(1, 3)).toEqual([]);
    expect(windowOpenings(0, 3)).toEqual([]);
  });
});

describe("fireShutterLayout", () => {
  it("幕は壁の板の全幅で，床から収納箱の下まで", () => {
    const s = fireShutterLayout(4, 3);
    expect(s.boxBottom).toBeCloseTo(3 - FIRE_SHUTTER.boxHeight);
    expect(s.curtain).toEqual({ u0: 0, u1: edgeWallLength(4), v0: 0, v1: s.boxBottom });
  });

  it("くぐり戸は既定で中央にあり，告示の大きさ（幅 0.75 m・高さ 1.8 m 以上・下端 0.15 m 以下）を満たす", () => {
    const s = fireShutterLayout(4, 3);
    expect(s.wicketCenterX).toBeCloseTo(0);
    expect(s.wicket.u1 - s.wicket.u0).toBeGreaterThanOrEqual(0.75);
    expect(s.wicket.v1 - s.wicket.v0).toBeGreaterThanOrEqual(1.8);
    expect(s.wicket.v0).toBeLessThanOrEqual(0.15);
    expect(s.wicket.v1).toBeLessThanOrEqual(s.boxBottom);
  });

  it("天井 2.5 m（下限）でもくぐり戸が収納箱の下に収まる", () => {
    const s = fireShutterLayout(4, MIN_CEILING_HEIGHT);
    expect(s.wicket.v1).toBeLessThanOrEqual(s.boxBottom);
  });

  it("くぐり戸の位置はずらせ，ガイドレールにかからない範囲に切り詰める", () => {
    const shifted = fireShutterLayout(4, 3, 0.5);
    expect(shifted.wicketCenterX).toBeCloseTo(0.5);
    for (const offset of [100, -100, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY]) {
      const s = fireShutterLayout(4, 3, offset);
      const minU = FIRE_SHUTTER.railWidth + FIRE_SHUTTER.wicketMargin;
      expect(s.wicket.u0).toBeGreaterThanOrEqual(minU - 1e-9);
      expect(s.wicket.u1).toBeLessThanOrEqual(edgeWallLength(4) - minU + 1e-9);
    }
  });

  it("くぐり戸のずれが NaN でも位置が数でなくならない（RangeError にするか中央に置く）", () => {
    let layout: ReturnType<typeof fireShutterLayout> | null = null;
    try {
      layout = fireShutterLayout(4, 3, Number.NaN);
    } catch (e) {
      expect(e).toBeInstanceOf(RangeError);
      return;
    }
    expect(Number.isFinite(layout.wicketCenterX)).toBe(true);
    expect(Number.isFinite(layout.wicket.u0)).toBe(true);
  });

  it("ガイドレールは両端にある", () => {
    const s = fireShutterLayout(4, 3);
    expect(s.rails).toHaveLength(2);
    expect(s.rails[0]?.u0).toBe(0);
    expect(s.rails[1]?.u1).toBeCloseTo(edgeWallLength(4));
  });

  it("edgeLayout のシャッターは壁の板を持たず，幕が開口部になる", () => {
    const layout = edgeLayout("fireShutter", 4, 3, { wicketOffset: 0.3 });
    expect(layout.wallRects).toEqual([]);
    expect(layout.openings).toEqual([layout.shutter?.curtain]);
    expect(layout.shutter?.wicketCenterX).toBeCloseTo(0.3);
  });
});

describe("doorLeafLayout", () => {
  it("扉は +Z の側の壁の面の外にあり，閉じた時は開口部の中央にあって開口部をふさぐ", () => {
    for (const length of [minEdgeLength("door"), 3, 4]) {
      const layout = edgeLayout("door", length, H);
      const leaf = doorLeafLayout(layout);
      const [opening] = layout.openings;
      if (!opening) throw new Error("開口部がない");
      expect(leaf.z - DOOR.leafThickness / 2).toBeGreaterThan(WALL_THICKNESS / 2);
      expect(leaf.closedX).toBeCloseTo(edgeLocalX(length, (opening.u0 + opening.u1) / 2));
      expect(leaf.width).toBeGreaterThanOrEqual(DOOR.width);
      expect(leaf.height).toBeCloseTo(DOOR.height);
    }
  });

  it("扉は +X の向きへ開口部の幅だけ滑り，開いても壁の板の範囲に収まる", () => {
    for (const length of [minEdgeLength("door"), 2.5, 3, 4, 8]) {
      const layout = edgeLayout("door", length, H);
      const leaf = doorLeafLayout(layout);
      expect(leaf.slideDirection).toBe(1);
      expect(leaf.slideDistance).toBeCloseTo(DOOR.width);
      const openRight = leaf.closedX + leaf.slideDistance + leaf.width / 2;
      expect(openRight).toBeLessThanOrEqual(layout.wallLength / 2 + 1e-9);
    }
  });

  it.each(["wall", "windowWall", "exit", "fireShutter"] as const)(
    "%s の寸法を渡すとエラー",
    (kind) => {
      expect(() => doorLeafLayout(edgeLayout(kind, 4, H))).toThrow();
    },
  );
});

describe("exitOutsideRect", () => {
  it("出口の外のポーチは -Z の側で，開口部の幅", () => {
    const layout = edgeLayout("exit", 4, H);
    const rect = exitOutsideRect(layout);
    expect(rect.maxZ).toBeCloseTo(-WALL_THICKNESS / 2);
    expect(rect.maxZ - rect.minZ).toBeCloseTo(EXIT.apronDepth);
    expect(rect.maxX - rect.minX).toBeCloseTo(EXIT.width);
    expect((rect.minX + rect.maxX) / 2).toBeCloseTo(0);
  });

  it.each(["wall", "windowWall", "door", "fireShutter"] as const)(
    "%s の寸法を渡すとエラー",
    (kind) => {
      expect(() => exitOutsideRect(edgeLayout(kind, 4, H))).toThrow();
    },
  );
});

describe("当たり判定の範囲（ローカル座標）", () => {
  it("柱は辺の端点を中心にした POST_SIZE 四方で，床から天井まで", () => {
    expect(postObstacle(3, "p")).toEqual({
      id: "p",
      minX: -POST_SIZE / 2,
      maxX: POST_SIZE / 2,
      minZ: -POST_SIZE / 2,
      maxZ: POST_SIZE / 2,
      minY: 0,
      maxY: 3,
    });
  });

  it("壁の板は辺の線を中心に厚み WALL_THICKNESS で，両端は柱の面に接する（隙間も重なりもない）", () => {
    const layout = edgeLayout("wall", 4, H);
    const [wall] = edgeStaticObstacles(layout, "w");
    expect(wall).toMatchObject({ id: "w-wall-0", minY: 0 });
    expect(wall?.minZ).toBeCloseTo(-WALL_THICKNESS / 2);
    expect(wall?.maxZ).toBeCloseTo(WALL_THICKNESS / 2);
    expect(wall?.maxY).toBeCloseTo(H);
    // 柱は辺の端点（x = ±2）に置く
    const post = postObstacle(H, "p");
    expect(wall?.minX).toBeCloseTo(-2 + post.maxX);
    expect(wall?.maxX).toBeCloseTo(2 + post.minX);
  });

  it("ドアの閉じた時の範囲は開口部をふさぎ，動かない部分は開口部を空ける", () => {
    const layout = edgeLayout("door", 4, H);
    const closable = edgeClosableObstacle(layout, "d");
    const [opening] = layout.openings;
    if (!closable || !opening) throw new Error("ドアの範囲がない");
    expect(closable.id).toBe("d");
    expect(closable.minX).toBeCloseTo(edgeLocalX(4, opening.u0));
    expect(closable.maxX).toBeCloseTo(edgeLocalX(4, opening.u1));
    expect(closable.maxY).toBeCloseTo(DOOR.height);
    const center = (closable.minX + closable.maxX) / 2;
    for (const o of edgeStaticObstacles(layout, "d")) {
      const coversCenterAtFloor = o.minX < center && center < o.maxX && o.minY < 1;
      expect(coversCenterAtFloor).toBe(false);
    }
  });

  it("シャッターの閉じた時の範囲は幕，動かない部分はガイドレールだけ", () => {
    const layout = edgeLayout("fireShutter", 4, H);
    const closable = edgeClosableObstacle(layout, "s");
    expect(closable?.maxX).toBeCloseTo(edgeWallLength(4) / 2);
    expect(closable?.minX).toBeCloseTo(-edgeWallLength(4) / 2);
    const fixed = edgeStaticObstacles(layout, "s");
    expect(fixed.map((o) => o.id)).toEqual(["s-rail-0", "s-rail-1"]);
    for (const o of fixed) {
      expect(o.maxZ - o.minZ).toBeCloseTo(FIRE_SHUTTER.railDepth);
    }
  });

  it.each(["wall", "windowWall", "exit"] as const)("%s は閉じる範囲を持たない", (kind) => {
    expect(edgeClosableObstacle(edgeLayout(kind, 4, H), "x")).toBeNull();
  });

  it("出口の開口部は通れる（動かない部分が開口部をふさがない）", () => {
    const layout = edgeLayout("exit", 4, H);
    const fixed = edgeStaticObstacles(layout, "e");
    const blocksDoorway = fixed.some((o) => o.minX < 0 && 0 < o.maxX && o.minY < 1.5);
    expect(blocksDoorway).toBe(false);
  });

  it("窓付きの壁は窓の下（腰壁）が体をふさぐ", () => {
    const layout = edgeLayout("windowWall", 4, H);
    const [w] = layout.openings;
    if (!w) throw new Error("窓がない");
    const x = edgeLocalX(4, (w.u0 + w.u1) / 2);
    const below = edgeStaticObstacles(layout, "w").filter(
      (o) => o.minX < x && x < o.maxX && o.minY === 0,
    );
    expect(below).toHaveLength(1);
    expect(below[0]?.maxY).toBeCloseTo(WINDOW.sill);
  });

  it("閉じたシャッターの幕は，くぐり戸が開いていればくぐり戸の範囲だけ空く", () => {
    const layout = edgeLayout("fireShutter", 4, H);
    const closed = fireShutterCurtainObstacles(layout, "s", false);
    expect(closed).toHaveLength(1);
    const open = fireShutterCurtainObstacles(layout, "s", true);
    const wicketX = layout.shutter?.wicketCenterX ?? Number.NaN;
    const blocking = open.filter(
      (o) => o.minX < wicketX && wicketX < o.maxX && o.minY < 1 && o.maxY > 0.1,
    );
    expect(blocking).toEqual([]);
    expect(open.length).toBeGreaterThan(1);
  });

  it("シャッター以外では幕の範囲は空", () => {
    expect(fireShutterCurtainObstacles(edgeLayout("door", 4, H), "d", false)).toEqual([]);
  });
});

describe("edgePlacementBetween", () => {
  it.each([
    ["東へ", { x: 0, z: 0 }, { x: 4, z: 0 }, { x: 2, z: 1 }],
    ["北へ（-Z）", { x: 0, z: 0 }, { x: 0, z: -4 }, { x: 1, z: -2 }],
    ["西へ", { x: 4, z: 2 }, { x: 0, z: 2 }, { x: 2, z: 1 }],
    ["南へ（+Z）", { x: 0, z: 0 }, { x: 0, z: 4 }, { x: -1, z: 2 }],
  ])(
    "%s進む辺は，ローカル X が from → to の向き，ローカル +Z が進む向きの右手",
    (_, from, to, rightOfCenter) => {
      const { placement, length } = edgePlacementBetween(from, to);
      expect(length).toBeCloseTo(4);
      const a = placePoint({ x: -length / 2, z: 0 }, placement);
      const b = placePoint({ x: length / 2, z: 0 }, placement);
      expect(a.x).toBeCloseTo(from.x);
      expect(a.z).toBeCloseTo(from.z);
      expect(b.x).toBeCloseTo(to.x);
      expect(b.z).toBeCloseTo(to.z);
      const right = placePoint({ x: 0, z: 1 }, placement);
      expect(right.x).toBeCloseTo(rightOfCenter.x);
      expect(right.z).toBeCloseTo(rightOfCenter.z);
    },
  );
});

describe("placeRect・placeObstacle", () => {
  const rect: XZRect = { minX: -2, maxX: 2, minZ: -0.5, maxZ: 0.5 };

  it("回さなければ平行移動だけ", () => {
    expect(placeRect(rect, { x: 10, z: 5, rotationY: 0 })).toEqual({
      minX: 8,
      maxX: 12,
      minZ: 4.5,
      maxZ: 5.5,
    });
  });

  it("90° 回すと幅と奥行きが入れ替わり，大きさは同じ", () => {
    const r = placeRect(rect, { x: 0, z: 0, rotationY: Math.PI / 2 });
    expect(r.maxX - r.minX).toBeCloseTo(1);
    expect(r.maxZ - r.minZ).toBeCloseTo(4);
  });

  it("障害物は id と高さの範囲を保つ", () => {
    const o: Obstacle = { id: "o", ...rect, minY: 0.2, maxY: 1.4 };
    const placed = placeObstacle(o, { x: 1, z: 1, rotationY: Math.PI });
    expect(placed).toMatchObject({ id: "o", minY: 0.2, maxY: 1.4 });
    expect(placed.minX).toBeCloseTo(-1);
    expect(placed.maxX).toBeCloseTo(3);
  });
});
