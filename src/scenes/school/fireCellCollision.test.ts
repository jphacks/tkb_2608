// 燃えているマスの当たり判定（fireCellCollision.ts）のテスト．基準は SPEC_01「VR 避難の規則」の「火のマスには入れない」
// （燃えているマスへは壁と同じく進めない）と SPEC_02「通れる・燃え広がる」（人は移る先がその時刻に燃えていなければ移れる．
// 火は void・wall・shutter・outdoor へ広がらない），Issue #121（閉じ込められて動けなくなることもない）

import { describe, expect, it } from "vitest";
import type { CellRef, SchoolPlan } from "../../core/schoolPlan";
import { createFloorFromRows } from "../../share/samples/floorFromRows";
import { computeSpread } from "../../sim/spread";
import { DEFAULT_BODY, moveWithCollision, type XZRect } from "../walk/collision";
import { activeObstacles, type WalkWorld } from "../walk/locomotion";
import {
  createFireCellBlockers,
  fireCellBlocks,
  fireCellObstacle,
  listFireCells,
} from "./fireCellCollision";

const at = (x: number, z: number, floor = 0): CellRef => ({ floor, x, z });

/** 小さな校舎（教室 0 の (0,0) が火元．# は柱，o は屋外）．cellSize 等を上書きできる */
function makePlan(
  overrides: { rows?: readonly string[]; cellSize?: number; fireOrigins?: CellRef[] } = {},
): SchoolPlan {
  const rows = overrides.rows ?? ["000#o", "000#o", "hhhho"];
  return {
    version: 1,
    name: "テスト校舎",
    cellSize: overrides.cellSize ?? 1,
    floors: [createFloorFromRows(1, rows)],
    rooms: [{ name: "教室A" }],
    drill: {
      mode: "learn",
      fireOrigins: overrides.fireOrigins ?? [at(0, 0)],
      start: at(2, 1),
      startYaw: 0,
      assembly: [at(4, 0)],
      route: [],
      timeLimitSeconds: 150,
      spread: { fireSecondsPerCell: 6, smokeSecondsPerCell: 2, extraFires: [] },
    },
  };
}

describe("fireCellObstacle", () => {
  it("マス (x, z) の範囲を床から height までふさぐ（cellSize 1）", () => {
    expect(fireCellObstacle(1, 3, 2, 3, "f")).toEqual({
      id: "f",
      minX: 3,
      maxX: 4,
      minZ: 2,
      maxZ: 3,
      minY: 0,
      maxY: 3,
    });
  });

  it("cellSize を掛けたワールド座標になる", () => {
    const o = fireCellObstacle(2, 1, 0, 2.5, "g");
    expect([o.minX, o.maxX, o.minZ, o.maxZ, o.minY, o.maxY]).toEqual([2, 4, 0, 2, 0, 2.5]);
  });
});

describe("listFireCells", () => {
  it("火が着く時刻が有限のマスだけを，その時刻と一緒に並べる", () => {
    const plan = makePlan();
    const spread = computeSpread(plan);
    const cells = listFireCells(plan, spread, 0);
    expect(cells.length).toBeGreaterThan(0);
    for (const c of cells) {
      expect(c.floor).toBe(0);
      expect(Number.isFinite(c.fireAt)).toBe(true);
      expect(c.fireAt).toBe(spread.fireAt(at(c.x, c.z)));
    }
    // 漏れが無い（有限のマスはすべて入っている）
    const floor = plan.floors[0];
    let finite = 0;
    for (let z = 0; z < floor.depth; z++) {
      for (let x = 0; x < floor.width; x++) {
        if (Number.isFinite(spread.fireAt(at(x, z)))) finite++;
      }
    }
    expect(cells).toHaveLength(finite);
  });

  it("火元のマスは 0 秒で入る", () => {
    const plan = makePlan();
    const cells = listFireCells(plan, computeSpread(plan), 0);
    expect(cells).toContainEqual({ floor: 0, x: 0, z: 0, fireAt: 0 });
  });

  it("燃えないマス（wall・outdoor）は入らない", () => {
    const plan = makePlan();
    const cells = listFireCells(plan, computeSpread(plan), 0);
    const keys = new Set(cells.map((c) => `${c.x},${c.z}`));
    // # の柱
    expect(keys.has("3,0")).toBe(false);
    expect(keys.has("3,1")).toBe(false);
    // 屋外
    for (const z of [0, 1, 2]) expect(keys.has(`4,${z}`)).toBe(false);
  });

  it("z の順，同じ z では x の順に並ぶ", () => {
    const plan = makePlan();
    const cells = listFireCells(plan, computeSpread(plan), 0);
    for (let i = 1; i < cells.length; i++) {
      const a = cells[i - 1];
      const b = cells[i];
      if (!a || !b) continue;
      expect(a.z < b.z || (a.z === b.z && a.x < b.x)).toBe(true);
    }
  });

  it("火元が無ければ空", () => {
    const plan = makePlan({ fireOrigins: [] });
    expect(listFireCells(plan, computeSpread(plan), 0)).toEqual([]);
  });

  it.each([
    ["無い階", 1],
    ["負の階", -1],
  ])("%s は空", (_, floorIndex) => {
    const plan = makePlan();
    expect(listFireCells(plan, computeSpread(plan), floorIndex)).toEqual([]);
  });
});

describe("fireCellBlocks", () => {
  it.each([
    ["火が着く前", 10, 9.99, false, false],
    ["火が着いた時刻ちょうど", 10, 10, false, true],
    ["火が着いた後", 10, 100, false, true],
    ["火が着いた後でも体が重なっていれば通れる", 10, 100, true, false],
    ["火が着く前で体が重なっている", 10, 0, true, false],
    ["燃えないマス（Infinity）はずっと通れる", Number.POSITIVE_INFINITY, 1e9, false, false],
    ["時刻が Infinity なら燃えうるマスはふさぐ", 0, Number.POSITIVE_INFINITY, false, true],
    ["時刻が NaN なら通れる", 0, Number.NaN, false, false],
    ["非常ベルの前（負の時刻）は火元でも通れる", 0, -1, false, false],
  ])("%s", (_, fireAt, now, overlaps, blocks) => {
    expect(fireCellBlocks(fireAt, now, overlaps)).toBe(blocks);
  });
});

/** マス目全体を床にした WalkWorld（燃えているマスの当たり判定だけを足す） */
function worldWith(doors: WalkWorld["doors"], floor: XZRect): WalkWorld {
  return {
    floors: [floor],
    obstacles: [],
    doors,
    areas: [],
    eyeHeights: { standing: 1.6, crouching: 0.9 },
    seats: [],
  };
}

const HEAD = 1.6 + DEFAULT_BODY.headClearance;

function walk(w: WalkWorld, from: { x: number; z: number }, to: { x: number; z: number }) {
  return moveWithCollision(
    from.x,
    from.z,
    to.x - from.x,
    to.z - from.z,
    HEAD,
    activeObstacles(w),
    w.floors,
    DEFAULT_BODY,
  );
}

function reached(end: { x: number; z: number }, to: { x: number; z: number }): boolean {
  return Math.hypot(end.x - to.x, end.z - to.z) < 0.05;
}

describe("createFireCellBlockers", () => {
  function setup(cellSize = 1) {
    const plan = makePlan({ cellSize });
    const spread = computeSpread(plan);
    const blockers = createFireCellBlockers(plan, spread, 0, 3);
    const floor = plan.floors[0];
    const w = worldWith(blockers.doors, {
      minX: 0,
      maxX: floor.width * cellSize,
      minZ: 0,
      maxZ: floor.depth * cellSize,
    });
    return { plan, spread, blockers, w };
  }

  it("燃えうるマスごとに 1 つずつ，マスの範囲・天井の高さの障害物を作る（id は重ならない）", () => {
    const { plan, spread, blockers } = setup(2);
    const cells = listFireCells(plan, spread, 0);
    expect(blockers.doors).toHaveLength(cells.length);
    expect(new Set(blockers.doors.map((d) => d.id)).size).toBe(cells.length);
    cells.forEach((c, i) => {
      const o = blockers.doors[i]?.obstacle;
      expect(o).toMatchObject({
        minX: c.x * 2,
        maxX: (c.x + 1) * 2,
        minZ: c.z * 2,
        maxZ: (c.z + 1) * 2,
        minY: 0,
        maxY: 3,
      });
    });
  });

  it("update する前（時刻なし）はすべて通れる", () => {
    const { blockers } = setup();
    for (const d of blockers.doors) expect(d.isOpen()).toBe(true);
  });

  it("火が着く前は通れ，火が着いた後（fireAt ≤ 今）はふさぐ", () => {
    const { plan, spread, blockers } = setup();
    const cells = listFireCells(plan, spread, 0);
    // 体は離れた所（屋外のマス (4, 2)）
    const body = { x: 4.5, z: 2.5 };
    for (const [i, c] of cells.entries()) {
      const door = blockers.doors[i];
      if (!door) throw new Error("ドアが無い");
      blockers.update(c.fireAt - 0.01, body);
      expect(door.isOpen(), `(${c.x}, ${c.z}) の直前`).toBe(true);
      blockers.update(c.fireAt, body);
      expect(door.isOpen(), `(${c.x}, ${c.z}) の時刻ちょうど`).toBe(false);
      blockers.update(c.fireAt + 100, body);
      expect(door.isOpen(), `(${c.x}, ${c.z}) の後`).toBe(false);
    }
  });

  it("時刻が NaN なら燃えていない扱いで通れる", () => {
    const { blockers } = setup();
    blockers.update(1000, null);
    expect(blockers.doors.some((d) => !d.isOpen())).toBe(true);
    blockers.update(Number.NaN, null);
    for (const d of blockers.doors) expect(d.isOpen()).toBe(true);
  });

  it("体の位置が null でも燃えているマスはふさぐ", () => {
    const { blockers } = setup();
    blockers.update(1000, null);
    for (const d of blockers.doors) expect(d.isOpen()).toBe(false);
  });

  it("体がそのマスに重なっている間はそのマスを通れるままにし，離れるとふさぐ", () => {
    const { blockers } = setup();
    const origin = blockers.doors.find((d) => d.id === "fire-cell-0-0-0");
    if (!origin) throw new Error("火元のマスが無い");
    // マスの中心
    blockers.update(1000, { x: 0.5, z: 0.5 });
    expect(origin.isOpen()).toBe(true);
    // 体の半径分だけ外（マスの端から 0.1 m．半径 0.18 m で重なる）
    blockers.update(1000, { x: 1.1, z: 0.5 });
    expect(origin.isOpen()).toBe(true);
    // 離れた（端から半径より遠い）
    blockers.update(1000, { x: 1.0 + DEFAULT_BODY.radius + 0.01, z: 0.5 });
    expect(origin.isOpen()).toBe(false);
  });

  it("燃えているマスへは歩いて入れない（燃える前は入れる）", () => {
    const { blockers, w } = setup();
    // 教室の中（壁の無い所）で，東の (2,1) から西の (0,1) へ．途中の (1,1) が燃えると止まる
    const from = { x: 2.5, z: 1.5 };
    const to = { x: 0.5, z: 1.5 };
    const spread = computeSpread(makePlan());
    const fireAtTarget = spread.fireAt(at(1, 1));
    // (2,1) はまだ燃えていない
    expect(spread.fireAt(at(2, 1))).toBeGreaterThan(fireAtTarget);
    expect(Number.isFinite(fireAtTarget)).toBe(true);
    blockers.update(-1, from);
    expect(reached(walk(w, from, to), to)).toBe(true);
    blockers.update(fireAtTarget, from);
    const end = walk(w, from, to);
    expect(reached(end, to)).toBe(false);
    // (1,1) の手前（x ≥ 2 + 半径）で止まる
    expect(end.x).toBeGreaterThanOrEqual(2 + DEFAULT_BODY.radius - 1e-6);
  });

  it("燃えているマスの中にいても，外（燃えていないマス）へ歩いて出られる（閉じ込められない）", () => {
    const { blockers, w } = setup();
    // 教室の (1,0) に立っている間に (1,0) に火が着く．東の (2,0) はまだ燃えていない
    const spread = computeSpread(makePlan());
    const here = { x: 1.5, z: 0.5 };
    const t = spread.fireAt(at(1, 0));
    expect(Number.isFinite(t)).toBe(true);
    expect(spread.fireAt(at(2, 0))).toBeGreaterThan(t);
    blockers.update(t, here);
    const to = { x: 2.5, z: 0.5 };
    expect(reached(walk(w, here, to), to)).toBe(true);
  });
});
