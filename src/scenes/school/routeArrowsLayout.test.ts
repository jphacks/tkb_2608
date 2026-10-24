// 学習モードの床の矢印の配置（routeArrowsLayout.ts）のテスト．
// 基準は SPEC_01「③ 避難」（学習モードでは床に正解経路の矢印を出す F6．テストモードでは出さない F7），
// SPEC_02「座標」（マス (x, z) の中心は ((x + 0.5) * cellSize, (z + 0.5) * cellSize)，level 階の床は y = (level - 1) * 3.5），
// TECH_01 の向きの約束（0 で -Z を向き，正で左（-X の側）へ回る）と Issue #95 の振る舞いの約束
import { describe, expect, it } from "vitest";
import type { CellRef, SchoolPlan } from "../../core/schoolPlan";
import { DEMO_SCHOOL } from "../../share/samples/demoSchool";
import { createFloorFromRows } from "../../share/samples/floorFromRows";
import {
  FLOOR_HEIGHT,
  layoutRouteArrows,
  ROUTE_ARROW_LIFT,
  ROUTE_ARROW_SIZE,
  routeArrowDimensions,
  shouldShowRouteArrows,
  yawBetween,
} from "./routeArrowsLayout";

const at = (x: number, z: number, floor = 0): CellRef => ({ floor, x, z });

const NORTH = 0; // -Z
const SOUTH = Math.PI; // +Z
const EAST = -Math.PI / 2; // +X（-Z を向いて右）
const WEST = Math.PI / 2; // -X（-Z を向いて左）

/** 5 × 5 の廊下だけの階を floors 階ぶん持つ校舎 */
function makePlan(
  overrides: { cellSize?: number; floors?: number; levels?: readonly number[] } = {},
): Pick<SchoolPlan, "cellSize" | "floors"> {
  const { cellSize = 1, floors = 1, levels } = overrides;
  const rows = ["hhhhh", "hhhhh", "hhhhh", "hhhhh", "hhhhh"];
  return {
    cellSize,
    floors: Array.from({ length: floors }, (_, i) =>
      createFloorFromRows(levels?.[i] ?? i + 1, rows),
    ),
  };
}

/** three.js の rotation.y = yaw のとき -Z が向く先 (dx, dz) */
function forward(yaw: number): { x: number; z: number } {
  return { x: -Math.sin(yaw), z: -Math.cos(yaw) };
}

describe("shouldShowRouteArrows", () => {
  it("学習モードでは出す", () => {
    expect(shouldShowRouteArrows("learn")).toBe(true);
  });
  it("テストモードでは出さない（F7）", () => {
    expect(shouldShowRouteArrows("test")).toBe(false);
  });
});

describe("yawBetween", () => {
  it.each([
    ["北（-Z）", at(2, 2), at(2, 1), NORTH],
    ["南（+Z）", at(2, 2), at(2, 3), SOUTH],
    ["東（+X）", at(2, 2), at(3, 2), EAST],
    ["西（-X）", at(2, 2), at(1, 2), WEST],
  ])("%s へ進む向き", (_label, from, to, expected) => {
    expect(yawBetween(from, to)).toBeCloseTo(expected, 12);
  });

  it("北は -0 ではなく 0，南は -π ではなく π にそろう", () => {
    expect(Object.is(yawBetween(at(2, 2), at(2, 1)), 0)).toBe(true);
    expect(yawBetween(at(2, 2), at(2, 3))).toBe(Math.PI);
  });

  it("正の向きは -Z から左（-X の側）へ回る（three.js の rotation.y と同じ）", () => {
    for (const [from, to] of [
      [at(2, 2), at(2, 1)],
      [at(2, 2), at(2, 3)],
      [at(2, 2), at(3, 2)],
      [at(2, 2), at(1, 2)],
    ] as const) {
      const f = forward(yawBetween(from, to));
      expect(f.x).toBeCloseTo(to.x - from.x, 12);
      expect(f.z).toBeCloseTo(to.z - from.z, 12);
    }
  });
});

describe("routeArrowDimensions", () => {
  it("1 m のマスで長さ 0.6 m・幅 0.45 m", () => {
    const d = routeArrowDimensions(1);
    expect(d.length).toBeCloseTo(0.6, 12);
    expect(d.width).toBeCloseTo(0.45, 12);
  });

  it.each([
    [0.5, 0.3],
    [0.4, 0.3], // 0.24 → 下限
    [0.1, 0.3],
    [1.5, 0.9],
    [2, 1.2],
    [3, 1.2], // 1.8 → 上限
    [100, 1.2],
  ])("一辺 %d m のマスで長さ %d m（0.3〜1.2 m に収まる）", (cellSize, length) => {
    const d = routeArrowDimensions(cellSize);
    expect(d.length).toBeCloseTo(length, 12);
    expect(d.width).toBeCloseTo(length * ROUTE_ARROW_SIZE.widthRatio, 12);
  });

  it.each([[Number.NaN], [0], [-1], [Number.POSITIVE_INFINITY], [Number.NEGATIVE_INFINITY]])(
    "異常な一辺（%d）は下限の 0.3 m",
    (cellSize) => {
      const d = routeArrowDimensions(cellSize);
      expect(d.length).toBe(ROUTE_ARROW_SIZE.minLength);
      expect(d.width).toBeCloseTo(0.3 * 0.75, 12);
      expect(Number.isFinite(d.width)).toBe(true);
    },
  );
});

describe("定数", () => {
  it("階の高さは 3.5 m（SPEC_02「座標」）", () => {
    expect(FLOOR_HEIGHT).toBe(3.5);
  });
  it("床から少しだけ浮かせる（0 より大きく 5 cm 未満）", () => {
    expect(ROUTE_ARROW_LIFT).toBeGreaterThan(0);
    expect(ROUTE_ARROW_LIFT).toBeLessThan(0.05);
  });
});

describe("layoutRouteArrows（デモの校舎）", () => {
  const route = DEMO_SCHOOL.drill.route;
  const placements = layoutRouteArrows(DEMO_SCHOOL, route);

  it("経路の各マスに 1 つずつ（19 個）", () => {
    expect(route).toHaveLength(19);
    expect(placements).toHaveLength(19);
    expect(placements.map((p) => p.routeIndex)).toEqual(route.map((_, i) => i));
  });

  it("各矢印はマスの中心・1 階の床の少し上に置く", () => {
    placements.forEach((p, i) => {
      const cell = route[i];
      expect(p.x).toBeCloseTo((cell.x + 0.5) * DEMO_SCHOOL.cellSize, 12);
      expect(p.z).toBeCloseTo((cell.z + 0.5) * DEMO_SCHOOL.cellSize, 12);
      expect(p.y).toBeCloseTo(ROUTE_ARROW_LIFT, 12);
    });
  });

  it("最初は start・最後は goal・曲がり角 5 つは turn・残りは straight", () => {
    const turns = [2, 4, 6, 8, 12];
    placements.forEach((p, i) => {
      const expected =
        i === 0 ? "start" : i === 18 ? "goal" : turns.includes(i) ? "turn" : "straight";
      expect(p.kind, `routeIndex ${i}`).toBe(expected);
    });
  });

  it("各矢印は次のマスへ進む向き，最後（集合場所）は入ってきた向き", () => {
    const expected = [
      SOUTH, // (2,2) → (2,3) start
      SOUTH, // (2,3) → (2,4)
      EAST, // (2,4) → (3,4) turn
      EAST, // (3,4) → (4,4)
      SOUTH, // (4,4) → (4,5) turn
      SOUTH, // (4,5) ドア → (4,6)
      WEST, // (4,6) → (3,6) turn
      WEST, // (3,6) → (2,6)
      SOUTH, // (2,6) → (2,7) turn
      SOUTH, // (2,7) 昇降口
      SOUTH,
      SOUTH, // (2,9) → (2,10)
      EAST, // (2,10) → (3,10) turn
      EAST,
      EAST,
      EAST,
      EAST,
      EAST, // (7,10) → (8,10)
      EAST, // (8,10) goal．入ってきた向き
    ];
    expect(placements.map((p) => p.yaw)).toHaveLength(expected.length);
    placements.forEach((p, i) => {
      expect(p.yaw, `routeIndex ${i}`).toBeCloseTo(expected[i], 12);
    });
  });
});

describe("layoutRouteArrows（形・座標）", () => {
  it("cellSize が 2 m ならマスの中心も 2 倍", () => {
    const placements = layoutRouteArrows(makePlan({ cellSize: 2 }), [at(1, 3), at(2, 3)]);
    expect(placements.map((p) => [p.x, p.z])).toEqual([
      [3, 7],
      [5, 7],
    ]);
  });

  it("2 階のマスは y = 3.5 + 浮かせ，3 階は y = 7 + 浮かせ", () => {
    const plan = makePlan({ floors: 3 });
    const second = layoutRouteArrows(plan, [at(0, 0, 1), at(1, 0, 1)]);
    second.forEach((p) => {
      expect(p.y).toBeCloseTo(3.5 + ROUTE_ARROW_LIFT, 12);
    });
    const third = layoutRouteArrows(plan, [at(0, 0, 2), at(1, 0, 2)]);
    third.forEach((p) => {
      expect(p.y).toBeCloseTo(7 + ROUTE_ARROW_LIFT, 12);
    });
  });

  it("高さは floors の添字ではなく level から決まる", () => {
    // floors[0] が 2 階
    const plan = makePlan({ floors: 1, levels: [2] });
    const placements = layoutRouteArrows(plan, [at(0, 0), at(1, 0)]);
    placements.forEach((p) => {
      expect(p.y).toBeCloseTo(3.5 + ROUTE_ARROW_LIFT, 12);
    });
  });

  it("2 マスの経路は start と goal で，どちらも進む向き", () => {
    const placements = layoutRouteArrows(makePlan(), [at(2, 2), at(2, 1)]);
    expect(placements.map((p) => p.kind)).toEqual(["start", "goal"]);
    placements.forEach((p) => {
      expect(p.yaw).toBeCloseTo(NORTH, 12);
    });
  });

  it("曲がり角は曲がった後の向きの turn", () => {
    // 北へ進んで西へ曲がる
    const placements = layoutRouteArrows(makePlan(), [at(2, 3), at(2, 2), at(1, 2), at(0, 2)]);
    expect(placements.map((p) => p.kind)).toEqual(["start", "turn", "straight", "goal"]);
    expect(placements[1].yaw).toBeCloseTo(WEST, 12);
  });

  it("引き返す（180° 曲がる）マスも turn", () => {
    const placements = layoutRouteArrows(makePlan(), [at(1, 1), at(2, 1), at(1, 1), at(0, 1)]);
    expect(placements.map((p) => p.kind)).toEqual(["start", "turn", "straight", "goal"]);
    expect(placements[1].yaw).toBeCloseTo(WEST, 12);
  });

  it("経路のマスの配列を書き換えない", () => {
    const route = [at(0, 0), at(1, 0), at(2, 0)];
    const copy = JSON.parse(JSON.stringify(route));
    layoutRouteArrows(makePlan(), route);
    expect(route).toEqual(copy);
  });
});

describe("layoutRouteArrows（異常な経路）", () => {
  const plan = makePlan({ floors: 2 });

  it("空の経路は矢印なし", () => {
    expect(layoutRouteArrows(plan, [])).toEqual([]);
  });

  it("1 マスだけの経路は向きが決まらないので描かない", () => {
    expect(layoutRouteArrows(plan, [at(2, 2)])).toEqual([]);
  });

  it("同じマスがすべてなら 1 マスと同じく描かない", () => {
    expect(layoutRouteArrows(plan, [at(2, 2), at(2, 2), at(2, 2)])).toEqual([]);
  });

  it("同じマスの連続は 1 つにまとめる（最初の添字を使う）", () => {
    const placements = layoutRouteArrows(plan, [at(0, 0), at(1, 0), at(1, 0), at(2, 0)]);
    expect(placements.map((p) => p.routeIndex)).toEqual([0, 1, 3]);
    expect(placements.map((p) => p.kind)).toEqual(["start", "straight", "goal"]);
    placements.forEach((p) => {
      expect(p.yaw).toBeCloseTo(EAST, 12);
    });
  });

  it("最後のマスが重なっていても goal が付く", () => {
    const placements = layoutRouteArrows(plan, [at(0, 0), at(1, 0), at(1, 0)]);
    // 重なった最後のマス（添字 2）は飛ばされ，添字 1 が最後の矢印になる
    expect(placements).toHaveLength(2);
    expect(placements[1].kind).toBe("goal");
  });

  it.each([
    ["存在しない階", at(1, 0, 5)],
    ["負の階", at(1, 0, -1)],
    ["マス目の外（x が幅以上）", at(5, 0)],
    ["マス目の外（負の z）", at(1, -1)],
    ["整数でない x", at(1.5, 0)],
    ["NaN の z", at(1, Number.NaN)],
  ])("%s のマスは飛ばし，前後はそこで切れる", (_label, bad) => {
    const route = [at(0, 0), at(1, 1), at(2, 1), bad, at(3, 1), at(4, 1), at(4, 2)];
    const placements = layoutRouteArrows(plan, route);
    // 1 つ目の部分 (0,0) は (1,1) と隣り合わないので，[ (0,0) ] と [ (1,1),(2,1) ] と [ (3,1),(4,1),(4,2) ]
    expect(placements.map((p) => p.routeIndex)).toEqual([1, 2, 4, 5, 6]);
    expect(placements.map((p) => p.kind)).toEqual([
      "straight",
      "straight", // 切れる直前のマスは入ってきた向き
      "straight", // 区切り直後のマス
      "turn",
      "goal",
    ]);
    expect(placements[1].yaw).toBeCloseTo(EAST, 12);
    expect(placements[3].yaw).toBeCloseTo(SOUTH, 12);
    expect(placements[4].yaw).toBeCloseTo(SOUTH, 12);
  });

  it("例外を投げない（異常なマスだけの経路は矢印なし）", () => {
    const route = [at(-1, 0), at(9, 9), at(0, 0, 7), at(Number.NaN, 0)];
    expect(() => layoutRouteArrows(plan, route)).not.toThrow();
    expect(layoutRouteArrows(plan, route)).toEqual([]);
  });

  it("最初のマスが描けない時は start が付かない", () => {
    const placements = layoutRouteArrows(plan, [at(-1, 0), at(0, 0), at(1, 0), at(2, 0)]);
    expect(placements.map((p) => p.kind)).toEqual(["straight", "straight", "goal"]);
  });

  it("最後のマスが描けない時は goal が付かない", () => {
    const placements = layoutRouteArrows(plan, [at(0, 0), at(1, 0), at(2, 0), at(9, 0)]);
    expect(placements.map((p) => p.kind)).toEqual(["start", "straight", "straight"]);
    expect(placements[2].yaw).toBeCloseTo(EAST, 12);
  });

  it("隣り合わないマスへの飛びで区切り，部分ごとに描く", () => {
    // (0,0)→(1,0)→(2,0) の後に (2,3) へ飛び，(2,3)→(2,4)
    const placements = layoutRouteArrows(plan, [at(0, 0), at(1, 0), at(2, 0), at(2, 3), at(2, 4)]);
    expect(placements.map((p) => p.routeIndex)).toEqual([0, 1, 2, 3, 4]);
    expect(placements.map((p) => p.kind)).toEqual([
      "start",
      "straight",
      "straight",
      "straight",
      "goal",
    ]);
    // 切れる直前は入ってきた向き（東），飛びの先へは向かない
    expect(placements[2].yaw).toBeCloseTo(EAST, 12);
    expect(placements[3].yaw).toBeCloseTo(SOUTH, 12);
  });

  it("斜めのマスへの飛びも区切る", () => {
    const placements = layoutRouteArrows(plan, [at(0, 0), at(1, 0), at(2, 1), at(3, 1)]);
    expect(placements.map((p) => p.yaw)).toEqual([EAST, EAST, EAST, EAST].map((v) => v));
    expect(placements.map((p) => p.kind)).toEqual(["start", "straight", "straight", "goal"]);
  });

  it("区切り直後のマスは曲がり角でも straight", () => {
    // 飛びの後の部分 (3,3)→(3,2)→(2,2)．(3,2) は曲がり角なので turn，(3,3) は区切り直後で straight
    const placements = layoutRouteArrows(plan, [at(0, 0), at(1, 0), at(3, 3), at(3, 2), at(2, 2)]);
    expect(placements.map((p) => p.kind)).toEqual([
      "start",
      "straight",
      "straight",
      "turn",
      "goal",
    ]);
    expect(placements[2].yaw).toBeCloseTo(NORTH, 12);
    expect(placements[3].yaw).toBeCloseTo(WEST, 12);
  });

  it("別の階への飛びで区切り，各階の高さで描く", () => {
    const placements = layoutRouteArrows(plan, [at(0, 0), at(1, 0), at(1, 0, 1), at(2, 0, 1)]);
    expect(placements.map((p) => p.kind)).toEqual(["start", "straight", "straight", "goal"]);
    expect(placements[1].yaw).toBeCloseTo(EAST, 12);
    expect(placements.map((p) => p.y)).toEqual([
      ROUTE_ARROW_LIFT,
      ROUTE_ARROW_LIFT,
      3.5 + ROUTE_ARROW_LIFT,
      3.5 + ROUTE_ARROW_LIFT,
    ]);
  });

  it("飛びに挟まれた 1 マスは向きが決まらないので描かない", () => {
    const placements = layoutRouteArrows(plan, [at(0, 0), at(1, 0), at(3, 3), at(0, 4), at(1, 4)]);
    expect(placements.map((p) => p.routeIndex)).toEqual([0, 1, 3, 4]);
    expect(placements.map((p) => p.kind)).toEqual(["start", "straight", "straight", "goal"]);
  });

  it("描けないマスに挟まれた 1 マスも描かない", () => {
    const placements = layoutRouteArrows(plan, [
      at(0, 0),
      at(1, 0),
      at(-1, 0),
      at(2, 0),
      at(9, 0),
      at(3, 0),
      at(4, 0),
    ]);
    expect(placements.map((p) => p.routeIndex)).toEqual([0, 1, 5, 6]);
  });

  it("最初のマスが孤立して描けない時は start が付かない", () => {
    const placements = layoutRouteArrows(plan, [at(0, 0), at(2, 2), at(3, 2)]);
    expect(placements.map((p) => p.routeIndex)).toEqual([1, 2]);
    expect(placements.map((p) => p.kind)).toEqual(["straight", "goal"]);
  });

  it("最後のマスが孤立して描けない時は goal が付かない", () => {
    const placements = layoutRouteArrows(plan, [at(0, 0), at(1, 0), at(4, 4)]);
    expect(placements.map((p) => p.kind)).toEqual(["start", "straight"]);
  });
});
