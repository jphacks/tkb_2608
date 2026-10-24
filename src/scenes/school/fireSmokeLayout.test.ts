// 火と煙の見た目（F4）の濃さの計算（fireSmokeLayout.ts）のテスト．
// 基準は SPEC_01「VR 避難の規則」（煙が着いたマスでは天井近くほど濃く，しゃがむと視界が晴れる．燃えているマス＝火が着く時刻 ≤ 今），
// SPEC_01「受け渡すデータ」の SpreadMap（秒．非常ベル 0．着かなければ Infinity），
// SPEC_02「座標」（マスの中心 ((x + 0.5) * cellSize, (z + 0.5) * cellSize)，level 階の床 y = (level - 1) * 3.5，天井 3 m）・
// 「通れる・燃え広がる」（防火シャッターで止まる），PLAN_04 F4 と Issue #96 の振る舞いの約束
import { describe, expect, it } from "vitest";
import type { CellRef, SchoolPlan } from "../../core/schoolPlan";
import { DEMO_SCHOOL } from "../../share/samples/demoSchool";
import { createFloorFromRows } from "../../share/samples/floorFromRows";
import { computeSpread, type SpreadMap } from "../../sim/spread";
import {
  burningCountAt,
  CELL_ATLAS_BORDER,
  CELL_CHANNEL,
  cellTexel,
  cellTexelCoord,
  chooseParticleSpawn,
  createCellAtlas,
  createFireParticleSeeds,
  eyeSmokeDensity,
  FIRE_GLOW_SPREAD,
  FIRE_PARTICLES,
  type FireSmokeCell,
  fireIntensity,
  floorBaseY,
  HIDDEN_IGNITION_SECONDS,
  hash01,
  listFireSmokeCells,
  type ParticleSpawn,
  particleCycle,
  particleCycleStart,
  SMOKE_CEILING_HEIGHT,
  smokeAtHeight,
  smokeDensity,
  smokeFogDensity,
  smokeLayerBottom,
  smokeLayerHeight,
  smokeLayerSpacing,
  sortByIgnition,
  writeCellTexels,
} from "./fireSmokeLayout";

/** 立った目・しゃがんだ目の高さ（m．床から．SPEC_01・Issue #96） */
const STANDING_EYE = 1.6;
const CROUCHING_EYE = 0.9;

const at = (x: number, z: number, floor = 0): CellRef => ({ floor, x, z });

/** 行の文字列から校舎を作る（階ごとの行．訓練条件は既定値を一部だけ上書き） */
function makePlan(
  floorsRows: readonly (readonly string[])[],
  overrides: { cellSize?: number; fireOrigins?: readonly CellRef[]; levels?: number[] } = {},
): SchoolPlan {
  return {
    version: 1,
    name: "テスト校舎",
    cellSize: overrides.cellSize ?? 1,
    floors: floorsRows.map((rows, i) => createFloorFromRows(overrides.levels?.[i] ?? i + 1, rows)),
    rooms: [{ name: "教室A" }],
    drill: {
      mode: "learn",
      fireOrigins: overrides.fireOrigins ?? [],
      start: at(0, 0),
      startYaw: 0,
      assembly: [],
      route: [],
      timeLimitSeconds: 150,
      spread: { fireSecondsPerCell: 6, smokeSecondsPerCell: 2, extraFires: [] },
    },
  };
}

/** 着く時刻の表を直接与える SpreadMap の一部（各階の添字は z * width + x） */
function tables(
  fireSeconds: readonly (readonly number[])[],
  smokeSeconds: readonly (readonly number[])[] = fireSeconds,
): Pick<SpreadMap, "fireSeconds" | "smokeSeconds"> {
  return { fireSeconds, smokeSeconds };
}

/** 全マスが同じ時刻の表 */
function uniform(plan: SchoolPlan, seconds: number): number[][] {
  return plan.floors.map((f) => new Array<number>(f.cells.length).fill(seconds));
}

/** マスの中心の目の位置（ワールド座標） */
function eyeAt(plan: SchoolPlan, x: number, z: number, height: number, level = 1) {
  return {
    x: (x + 0.5) * plan.cellSize,
    y: (level - 1) * 3.5 + height,
    z: (z + 0.5) * plan.cellSize,
  };
}

function fireCell(seconds: number, overrides: Partial<FireSmokeCell> = {}): FireSmokeCell {
  return { floor: 0, x: 0, z: 0, centerX: 0.5, centerZ: 0.5, baseY: 0, seconds, ...overrides };
}

function newSpawn(): ParticleSpawn {
  return { active: true, x: Number.NaN, y: Number.NaN, z: Number.NaN, ignition: 0, boost: 0 };
}

describe("fireIntensity", () => {
  it("火が着く時刻ちょうどから燃えている（0 より大きい．0.35 で始まる）", () => {
    expect(fireIntensity(10, 10)).toBeCloseTo(0.35, 10);
  });

  it("火が着く直前は 0", () => {
    expect(fireIntensity(10, 9.999)).toBe(0);
  });

  it("着いた直後は 0.35 より少し大きい", () => {
    const k = fireIntensity(10, 10.01);
    expect(k).toBeGreaterThan(0.35);
    expect(k).toBeLessThan(0.36);
  });

  it("着いてから 4 秒で 1，それより後も 1", () => {
    expect(fireIntensity(10, 14)).toBeCloseTo(1, 10);
    expect(fireIntensity(10, 1000)).toBe(1);
  });

  it("途中（2 秒）は 0.35 と 1 の中ほど（smoothstep）", () => {
    expect(fireIntensity(0, 2)).toBeCloseTo(0.35 + 0.65 * 0.5, 10);
  });

  it("時間とともに減らない", () => {
    let prev = 0;
    for (let t = -1; t <= 6; t += 0.25) {
      const k = fireIntensity(0, t);
      expect(k).toBeGreaterThanOrEqual(prev);
      prev = k;
    }
  });

  it.each([
    ["着かない（Infinity）", Infinity, 100],
    ["着く時刻が NaN", Number.NaN, 100],
    ["今の時刻が NaN", 0, Number.NaN],
    ["負の時刻でまだ着いていない", 0, -1],
    ["今の時刻が -Infinity", 0, -Infinity],
  ])("%s は 0", (_label, fire, now) => {
    expect(fireIntensity(fire, now)).toBe(0);
  });

  it("着く時刻が -Infinity（最初から燃えている）は燃え切った扱いで 1", () => {
    expect(fireIntensity(-Infinity, 0)).toBe(1);
  });

  it("着く時刻が負（非常ベルより前）でも，今が後なら燃えている", () => {
    expect(fireIntensity(-10, 0)).toBe(1);
  });
});

describe("smokeDensity", () => {
  it("煙が着いた時刻ちょうどは 0", () => {
    expect(smokeDensity(5, 5)).toBe(0);
  });

  it("着いた直後は 0 より大きい", () => {
    expect(smokeDensity(5, 5.5)).toBeGreaterThan(0);
  });

  it("着いてから 20 秒で 1，それより後も 1", () => {
    expect(smokeDensity(5, 25)).toBeCloseTo(1, 10);
    expect(smokeDensity(5, 500)).toBe(1);
  });

  it("10 秒でちょうど半分（smoothstep）", () => {
    expect(smokeDensity(0, 10)).toBeCloseTo(0.5, 10);
  });

  it("時間とともに減らず，0〜1 に収まる", () => {
    let prev = 0;
    for (let t = -2; t <= 30; t += 0.5) {
      const d = smokeDensity(0, t);
      expect(d).toBeGreaterThanOrEqual(prev);
      expect(d).toBeGreaterThanOrEqual(0);
      expect(d).toBeLessThanOrEqual(1);
      prev = d;
    }
  });

  it.each([
    ["着かない（Infinity）", Infinity, 100],
    ["着く時刻が NaN", Number.NaN, 100],
    ["今の時刻が NaN", 0, Number.NaN],
    ["まだ着いていない", 10, 9],
    ["負の時刻でまだ着いていない", 0, -5],
  ])("%s は 0", (_label, smoke, now) => {
    expect(smokeDensity(smoke, now)).toBe(0);
  });

  it("着く時刻が -Infinity は 1", () => {
    expect(smokeDensity(-Infinity, 0)).toBe(1);
  });
});

describe("smokeLayerBottom", () => {
  it.each([
    [0, 3],
    [1, 1.2],
    [0.5, 2.1],
    [2, 1.2],
    [-1, 3],
    [Number.NaN, 3],
  ])("濃さ %d の時は床から %d m", (density, bottom) => {
    expect(smokeLayerBottom(density)).toBeCloseTo(bottom, 10);
  });

  it("下の端は立った目（1.6 m）より下・しゃがんだ目（0.9 m）より上まで下りる", () => {
    expect(smokeLayerBottom(1)).toBeLessThan(STANDING_EYE);
    expect(smokeLayerBottom(1)).toBeGreaterThan(CROUCHING_EYE);
  });
});

describe("smokeAtHeight", () => {
  it("濃さ 0 はどの高さでも 0", () => {
    for (const h of [-1, 0, 0.9, 1.6, 3, 10]) expect(smokeAtHeight(0, h)).toBe(0);
  });

  it.each([
    ["濃さが NaN", Number.NaN, 2],
    ["高さが NaN", 1, Number.NaN],
  ])("%s は 0", (_label, d, h) => {
    expect(smokeAtHeight(d, h)).toBe(0);
  });

  it("天井（3 m）では濃さそのもの，天井より上も同じ", () => {
    expect(smokeAtHeight(1, 3)).toBeCloseTo(1, 10);
    expect(smokeAtHeight(0.6, 3)).toBeCloseTo(0.6, 10);
    expect(smokeAtHeight(1, 3.4)).toBeCloseTo(1, 10);
  });

  it("下の端では 濃さ × 0.5", () => {
    expect(smokeAtHeight(1, 1.2)).toBeCloseTo(0.5, 10);
    expect(smokeAtHeight(0.5, 2.1)).toBeCloseTo(0.25, 10);
  });

  it("下の端の 0.3 m 下より下は薄い煙（濃さ × 0.12）だけ", () => {
    expect(smokeAtHeight(1, 0.9)).toBeCloseTo(0.12, 10);
    expect(smokeAtHeight(1, 0.5)).toBeCloseTo(0.12, 10);
    expect(smokeAtHeight(1, 0)).toBeCloseTo(0.12, 10);
    expect(smokeAtHeight(0.5, 1.5)).toBeCloseTo(0.06, 10);
  });

  it("ぼかしの中ほど（下の端の 0.15 m 下）は薄い煙と下の端の中間", () => {
    expect(smokeAtHeight(1, 1.05)).toBeCloseTo((0.12 + 0.5) / 2, 10);
  });

  it("下の端〜天井は直線的に上がる（最も濃い煙で 2.1 m は 0.75）", () => {
    expect(smokeAtHeight(1, 2.1)).toBeCloseTo(0.75, 10);
  });

  it("最も濃い煙で立った目（1.6 m）は約 0.61，しゃがんだ目（0.9 m）は 0.12", () => {
    expect(smokeAtHeight(1, STANDING_EYE)).toBeCloseTo(0.5 + 0.5 * (0.4 / 1.8), 10);
    expect(smokeAtHeight(1, STANDING_EYE)).toBeCloseTo(0.61, 2);
    expect(smokeAtHeight(1, CROUCHING_EYE)).toBeCloseTo(0.12, 10);
  });

  it.each([0.1, 0.3, 0.5, 0.8, 1])("濃さ %d で，下の端とぼかしの境目で値が途切れない", (d) => {
    const bottom = smokeLayerBottom(d);
    const eps = 1e-7;
    expect(smokeAtHeight(d, bottom - eps)).toBeCloseTo(smokeAtHeight(d, bottom), 5);
    expect(smokeAtHeight(d, bottom - 0.3 - eps)).toBeCloseTo(smokeAtHeight(d, bottom - 0.3), 5);
    expect(smokeAtHeight(d, bottom - 0.3 + eps)).toBeCloseTo(smokeAtHeight(d, bottom - 0.3), 5);
    expect(smokeAtHeight(d, 3 - eps)).toBeCloseTo(smokeAtHeight(d, 3), 5);
  });

  it.each([0.05, 0.3, 0.7, 1])("濃さ %d で，天井に近いほど濃い（高さで減らない）", (d) => {
    let prev = -1;
    for (let h = 0; h <= 3.2; h += 0.01) {
      const s = smokeAtHeight(d, h);
      expect(s).toBeGreaterThanOrEqual(prev - 1e-12);
      expect(s).toBeLessThanOrEqual(d + 1e-12);
      prev = s;
    }
    expect(smokeAtHeight(d, 3)).toBeGreaterThan(smokeAtHeight(d, 0));
  });

  it("濃さが 1 より大きい時は 1 として扱う", () => {
    expect(smokeAtHeight(5, 1.6)).toBeCloseTo(smokeAtHeight(1, 1.6), 10);
  });
});

describe("smokeLayerHeight / smokeLayerSpacing", () => {
  it("4 枚の層は 2.90・2.38・1.87・1.35 m（天井の側から）", () => {
    const heights = [0, 1, 2, 3].map((i) => smokeLayerHeight(i));
    expect(heights[0]).toBeCloseTo(2.9, 10);
    expect(heights[1]).toBeCloseTo(2.38, 2);
    expect(heights[2]).toBeCloseTo(1.87, 2);
    expect(heights[3]).toBeCloseTo(1.35, 10);
  });

  it("層は天井（3 m）より下・最も濃い煙の下の端（1.2 m）より上にあり，上から順に低くなる", () => {
    const heights = [0, 1, 2, 3].map((i) => smokeLayerHeight(i));
    for (const h of heights) {
      expect(h).toBeLessThan(SMOKE_CEILING_HEIGHT);
      expect(h).toBeGreaterThan(smokeLayerBottom(1));
    }
    for (let i = 1; i < heights.length; i++) expect(heights[i]).toBeLessThan(heights[i - 1]);
  });

  it("層は立った目より上・しゃがんだ目より上にある（しゃがむと層を下から見上げる）", () => {
    expect(smokeLayerHeight(3)).toBeGreaterThan(CROUCHING_EYE);
    expect(smokeLayerHeight(3)).toBeLessThan(STANDING_EYE);
  });

  it("層の間の高さは隣り合う層の差と同じ", () => {
    expect(smokeLayerSpacing()).toBeCloseTo(smokeLayerHeight(0) - smokeLayerHeight(1), 10);
    expect(smokeLayerSpacing()).toBeCloseTo((2.9 - 1.35) / 3, 10);
  });

  it("層が 1 枚なら天井の少し下（2.9 m）", () => {
    expect(smokeLayerHeight(0, 1)).toBeCloseTo(2.9, 10);
    expect(smokeLayerSpacing(1)).toBeGreaterThan(0);
  });
});

describe("floorBaseY", () => {
  it.each([
    [1, 0],
    [2, 3.5],
    [3, 7],
  ])("%d 階の床は y = %d m", (level, y) => {
    expect(floorBaseY(level)).toBeCloseTo(y, 10);
  });
});

describe("listFireSmokeCells", () => {
  it("着く時刻が有限のマスだけを，マスの中心と床の高さ付きで並べる", () => {
    const plan = makePlan([["hhh", "hhh"]], { cellSize: 2, levels: [2] });
    const fire = [[0, Infinity, Number.NaN, 4, Infinity, Infinity]];
    const smoke = [[0, 2, Infinity, 3, Number.NaN, 10]];
    const cells = listFireSmokeCells(plan, tables(fire, smoke));
    expect(cells.fire).toEqual([
      { floor: 0, x: 0, z: 0, centerX: 1, centerZ: 1, baseY: 3.5, seconds: 0 },
      { floor: 0, x: 0, z: 1, centerX: 1, centerZ: 3, baseY: 3.5, seconds: 4 },
    ]);
    expect(cells.smoke.map((c) => [c.x, c.z, c.seconds])).toEqual([
      [0, 0, 0],
      [1, 0, 2],
      [0, 1, 3],
      [2, 1, 10],
    ]);
    expect(cells.smoke[3].centerX).toBe(5);
    expect(cells.smoke[3].centerZ).toBe(3);
  });

  it("どこにも着かない校舎は空", () => {
    const plan = makePlan([["hh"]]);
    const cells = listFireSmokeCells(plan, tables(uniform(plan, Infinity)));
    expect(cells.fire).toEqual([]);
    expect(cells.smoke).toEqual([]);
  });

  it("複数の階は階ごとの添字と床の高さを持つ", () => {
    const plan = makePlan([["h"], ["h"]]);
    const cells = listFireSmokeCells(plan, tables([[1], [2]]));
    expect(cells.fire.map((c) => [c.floor, c.baseY, c.seconds])).toEqual([
      [0, 0, 1],
      [1, 3.5, 2],
    ]);
  });
});

describe("eyeSmokeDensity", () => {
  const corridor = makePlan([["hhh", "hhh", "hhh"]]);
  const full = tables(uniform(corridor, 0));

  it("最も濃い煙の中で立つと約 0.61，しゃがむと 0.12（しゃがむと晴れる F4）", () => {
    const standing = eyeSmokeDensity(corridor, full, 100, eyeAt(corridor, 1, 1, STANDING_EYE));
    const crouching = eyeSmokeDensity(corridor, full, 100, eyeAt(corridor, 1, 1, CROUCHING_EYE));
    expect(standing).toBeCloseTo(0.61, 2);
    expect(crouching).toBeCloseTo(0.12, 10);
    expect(crouching).toBeLessThan(standing);
  });

  it("煙が着いていない（Infinity）マスでは 0", () => {
    const none = tables(uniform(corridor, Infinity));
    expect(eyeSmokeDensity(corridor, none, 100, eyeAt(corridor, 1, 1, STANDING_EYE))).toBe(0);
  });

  it("煙が着いた時刻ちょうどは 0，着く前も 0", () => {
    const later = tables(uniform(corridor, 10));
    expect(eyeSmokeDensity(corridor, later, 10, eyeAt(corridor, 1, 1, STANDING_EYE))).toBe(0);
    expect(eyeSmokeDensity(corridor, later, 5, eyeAt(corridor, 1, 1, STANDING_EYE))).toBe(0);
  });

  it("マスの中心ではそのマスの濃さだけを使う", () => {
    // 中央のマスだけ煙がある
    const t = uniform(corridor, Infinity);
    t[0][4] = 0;
    const center = eyeSmokeDensity(corridor, tables(t), 100, eyeAt(corridor, 1, 1, 3));
    expect(center).toBeCloseTo(1, 10);
  });

  it("2 つのマスの境目では両方の濃さの平均（マスの境目で急に変わらない）", () => {
    const t = uniform(corridor, Infinity);
    t[0][4] = 0; // (1, 1) だけ煙
    // (1, 1) と (2, 1) の境目．天井の高さで見る（濃さそのもの）
    const d = eyeSmokeDensity(corridor, tables(t), 100, { x: 2, y: 3, z: 1.5 });
    expect(d).toBeCloseTo(0.5, 10);
  });

  it("位置を少しずつ動かしても大きく跳ばない", () => {
    const t = uniform(corridor, Infinity);
    t[0][4] = 0;
    let prev = eyeSmokeDensity(corridor, tables(t), 100, { x: 1.5, y: 3, z: 1.5 });
    for (let x = 1.5; x <= 2.5; x += 0.01) {
      const d = eyeSmokeDensity(corridor, tables(t), 100, { x, y: 3, z: 1.5 });
      expect(Math.abs(d - prev)).toBeLessThan(0.05);
      prev = d;
    }
  });

  it("柱（wall）のマスは重み付けから除く（柱の隣でも煙が薄まらない）", () => {
    const plan = makePlan([["h#"]]);
    // 柱のマスは着かない（Infinity）
    const d = eyeSmokeDensity(plan, tables([[0, Infinity]]), 100, { x: 1, y: 3, z: 0.5 });
    expect(d).toBeCloseTo(1, 10);
  });

  it("void のマスは重み付けから除く", () => {
    const plan = makePlan([["h."]]);
    const d = eyeSmokeDensity(plan, tables([[0, Infinity]]), 100, { x: 1, y: 3, z: 0.5 });
    expect(d).toBeCloseTo(1, 10);
  });

  it("柱に囲まれた位置（周りの 4 マスがすべて柱）では 0", () => {
    const plan = makePlan([["##", "##"]]);
    const d = eyeSmokeDensity(plan, tables(uniform(plan, 0)), 100, { x: 1, y: 1.6, z: 1 });
    expect(d).toBe(0);
  });

  it("マス目の外は 0", () => {
    expect(eyeSmokeDensity(corridor, full, 100, { x: -5, y: 1.6, z: 1.5 })).toBe(0);
    expect(eyeSmokeDensity(corridor, full, 100, { x: 1.5, y: 1.6, z: 10 })).toBe(0);
  });

  it("目のある階が無い（床より下・最も上の階の 3.5 m より上）は 0", () => {
    expect(eyeSmokeDensity(corridor, full, 100, { x: 1.5, y: -0.1, z: 1.5 })).toBe(0);
    expect(eyeSmokeDensity(corridor, full, 100, { x: 1.5, y: 3.5, z: 1.5 })).toBe(0);
    expect(eyeSmokeDensity(corridor, full, 100, { x: 1.5, y: 10, z: 1.5 })).toBe(0);
  });

  it.each([
    ["時刻が NaN", Number.NaN, { x: 1.5, y: 1.6, z: 1.5 }],
    ["x が NaN", 100, { x: Number.NaN, y: 1.6, z: 1.5 }],
    ["y が NaN", 100, { x: 1.5, y: Number.NaN, z: 1.5 }],
    ["z が Infinity", 100, { x: 1.5, y: 1.6, z: Infinity }],
  ])("%s の時は 0", (_label, now, eye) => {
    expect(eyeSmokeDensity(corridor, full, now, eye)).toBe(0);
  });

  it("2 階では目の y から階を決め，その階の煙だけを見る", () => {
    const plan = makePlan([["hhh"], ["hhh"]]);
    const t = tables([
      [0, 0, 0],
      [Infinity, Infinity, Infinity],
    ]);
    // 1 階は煙，2 階は煙なし
    expect(eyeSmokeDensity(plan, t, 100, eyeAt(plan, 1, 0, STANDING_EYE, 1))).toBeGreaterThan(0);
    expect(eyeSmokeDensity(plan, t, 100, eyeAt(plan, 1, 0, STANDING_EYE, 2))).toBe(0);
    // 逆にすると 2 階だけ煙
    const t2 = tables([
      [Infinity, Infinity, Infinity],
      [0, 0, 0],
    ]);
    expect(eyeSmokeDensity(plan, t2, 100, eyeAt(plan, 1, 0, STANDING_EYE, 1))).toBe(0);
    expect(eyeSmokeDensity(plan, t2, 100, eyeAt(plan, 1, 0, STANDING_EYE, 2))).toBeCloseTo(
      eyeSmokeDensity(corridor, full, 100, eyeAt(corridor, 1, 1, STANDING_EYE)),
      10,
    );
  });

  it("2 階で立つより，しゃがむ方が小さい（目の高さは階の床から測る）", () => {
    const plan = makePlan([["hhh"], ["hhh"]]);
    const t = tables(uniform(plan, 0));
    const standing = eyeSmokeDensity(plan, t, 100, eyeAt(plan, 1, 0, STANDING_EYE, 2));
    const crouching = eyeSmokeDensity(plan, t, 100, eyeAt(plan, 1, 0, CROUCHING_EYE, 2));
    expect(standing).toBeCloseTo(0.61, 2);
    expect(crouching).toBeCloseTo(0.12, 10);
  });

  it("マスの大きさが 2 m でも，マスの中心はそのマスの濃さ", () => {
    const plan = makePlan([["hh"]], { cellSize: 2 });
    const t = tables([[0, Infinity]]);
    expect(eyeSmokeDensity(plan, t, 100, eyeAt(plan, 0, 0, 3))).toBeCloseTo(1, 10);
    expect(eyeSmokeDensity(plan, t, 100, eyeAt(plan, 1, 0, 3))).toBe(0);
  });

  it("デモの校舎では防火シャッター（x = 12）より西に煙が来ない", () => {
    const spread = computeSpread(DEMO_SCHOOL);
    for (const now of [30, 150, 1000]) {
      for (let x = 0.1; x < 12; x += 0.25) {
        for (let z = 0.1; z < 8; z += 0.25) {
          for (const h of [CROUCHING_EYE, STANDING_EYE, 2.9]) {
            expect(eyeSmokeDensity(DEMO_SCHOOL, spread, now, { x, y: h, z })).toBe(0);
          }
        }
      }
    }
  });

  it("デモの校舎の理科室（火元）では十分後に立つと濃く，しゃがむと薄い", () => {
    const spread = computeSpread(DEMO_SCHOOL);
    const standing = eyeSmokeDensity(DEMO_SCHOOL, spread, 1000, { x: 15.5, y: 1.6, z: 2.5 });
    const crouching = eyeSmokeDensity(DEMO_SCHOOL, spread, 1000, { x: 15.5, y: 0.9, z: 2.5 });
    expect(standing).toBeCloseTo(0.61, 2);
    expect(crouching).toBeCloseTo(0.12, 10);
  });

  it("非常ベル（0 秒）には火元でもまだ煙は濃くない", () => {
    const spread = computeSpread(DEMO_SCHOOL);
    expect(eyeSmokeDensity(DEMO_SCHOOL, spread, 0, { x: 16.5, y: 1.6, z: 2.5 })).toBe(0);
  });
});

describe("smokeFogDensity", () => {
  it.each([
    [0, 0],
    [1, 0.8],
    [0.5, 0.4],
    [2, 0.8],
    [-1, 0],
    [Number.NaN, 0],
  ])("目の位置の煙 %d のフォグは %d（1/m）", (eye, fog) => {
    expect(smokeFogDensity(eye)).toBeCloseTo(fog, 10);
  });

  it("しゃがむとフォグが薄くなる（最も濃い煙で立つと 0.8 × 0.61，しゃがむと 0.8 × 0.12）", () => {
    const standing = smokeFogDensity(smokeAtHeight(1, STANDING_EYE));
    const crouching = smokeFogDensity(smokeAtHeight(1, CROUCHING_EYE));
    expect(standing).toBeCloseTo(0.8 * smokeAtHeight(1, STANDING_EYE), 10);
    expect(crouching).toBeCloseTo(0.8 * 0.12, 10);
    expect(crouching).toBeLessThan(standing);
  });
});

describe("createCellAtlas / cellTexel / cellTexelCoord", () => {
  it("1 つの階は幅 + 2・奥行き + 2 で，z = 0 の行は 1（周りに 1 テクセルの縁）", () => {
    const plan = makePlan([["hhh", "hhh"]]);
    expect(createCellAtlas(plan)).toEqual({ width: 5, height: 4, floorRows: [1] });
    expect(CELL_ATLAS_BORDER).toBe(1);
  });

  it("複数の階は縦に積み，幅は最も広い階に合わせる", () => {
    const plan = makePlan([
      ["hhh", "hhh"],
      ["hhhhh", "hhhhh", "hhhhh", "hhhhh"],
    ]);
    expect(createCellAtlas(plan)).toEqual({ width: 7, height: 10, floorRows: [1, 5] });
  });

  it("階が無くても 1 × 1 以上", () => {
    const atlas = createCellAtlas({ floors: [] });
    expect(atlas.width).toBeGreaterThanOrEqual(1);
    expect(atlas.height).toBeGreaterThanOrEqual(1);
    expect(atlas.floorRows).toEqual([]);
  });

  it("各階の全てのマスのテクセルは重ならず，縁に掛からない", () => {
    const plan = makePlan([
      ["hhh", "hhh"],
      ["hhhhh", "hhhhh", "hhhhh"],
    ]);
    const atlas = createCellAtlas(plan);
    const seen = new Set<number>();
    plan.floors.forEach((floor, f) => {
      for (let z = 0; z < floor.depth; z++) {
        for (let x = 0; x < floor.width; x++) {
          const t = cellTexel(atlas, f, x, z);
          expect(seen.has(t)).toBe(false);
          seen.add(t);
          const col = t % atlas.width;
          const row = Math.floor(t / atlas.width);
          expect(col).toBe(x + 1);
          expect(row).toBe(atlas.floorRows[f] + z);
          // 上下左右のテクセルのうち，マス目の外に当たるものは他のどの階のマスでもない（縁）
          expect(col).toBeGreaterThanOrEqual(1);
          expect(col).toBeLessThanOrEqual(atlas.width - 2);
        }
      }
    });
    // 階と階の間に，どの階のマスでもない行が 2 行ある（各階の下の縁と次の階の上の縁）
    const rowsUsed = new Set([...seen].map((t) => Math.floor(t / atlas.width)));
    expect(rowsUsed.has(0)).toBe(false);
    expect(rowsUsed.has(3)).toBe(false);
    expect(rowsUsed.has(4)).toBe(false);
    expect(rowsUsed.has(atlas.height - 1)).toBe(false);
  });

  it("マスの中心のワールド座標は，そのマスのテクセルの中心（+0.5）に写る", () => {
    const plan = makePlan([["hhh", "hhh"], ["hhhh"]], { cellSize: 2 });
    const atlas = createCellAtlas(plan);
    for (const [f, x, z] of [
      [0, 0, 0],
      [0, 2, 1],
      [1, 3, 0],
    ] as const) {
      const { u, v } = cellTexelCoord(atlas, 2, f, (x + 0.5) * 2, (z + 0.5) * 2);
      expect(u - Math.floor(u)).toBeCloseTo(0.5, 10);
      expect(v - Math.floor(v)).toBeCloseTo(0.5, 10);
      expect(Math.floor(v) * atlas.width + Math.floor(u)).toBe(cellTexel(atlas, f, x, z));
    }
  });
});

describe("writeCellTexels", () => {
  /** 校舎・表・時刻からテクセルを書いて，マスの値を引く関数を返す */
  function write(
    plan: SchoolPlan,
    spread: Pick<SpreadMap, "fireSeconds" | "smokeSeconds">,
    now: number,
    prefill = 0,
  ) {
    const cells = listFireSmokeCells(plan, spread);
    const atlas = createCellAtlas(plan);
    const out = new Uint8Array(atlas.width * atlas.height * 4).fill(prefill);
    const counts = writeCellTexels(plan, cells, atlas, now, out);
    const get = (x: number, z: number, channel: number, floor = 0) =>
      out[cellTexel(atlas, floor, x, z) * 4 + channel];
    return { counts, out, atlas, get };
  }

  it("煙の濃さを R に 0〜255 で書く（着いた時刻ちょうどは 0，20 秒後に 255）", () => {
    const plan = makePlan([["hhh"]]);
    const smoke = [[0, 10, Infinity]];
    const { get, counts } = write(plan, tables(uniform(plan, Infinity), smoke), 30);
    expect(get(0, 0, CELL_CHANNEL.smoke)).toBe(255);
    expect(get(1, 0, CELL_CHANNEL.smoke)).toBe(Math.round(smokeDensity(10, 30) * 255));
    expect(get(2, 0, CELL_CHANNEL.smoke)).toBe(0);
    expect(counts.smokyCells).toBe(2);
    expect(counts.burningCells).toBe(0);
    const atArrival = write(plan, tables(uniform(plan, Infinity), smoke), 10);
    expect(atArrival.get(1, 0, CELL_CHANNEL.smoke)).toBe(0);
  });

  it.each([
    ["柱（wall）", "#"],
    ["何もないマス（void）", "."],
    ["屋外（outdoor）", "o"],
  ])("%s のマスは煙が着いていても R は 0（煙の層を出さない）", (_label, ch) => {
    const plan = makePlan([[`h${ch}`]]);
    const { get, counts } = write(plan, tables(uniform(plan, Infinity), [[0, 0]]), 100);
    expect(get(0, 0, CELL_CHANNEL.smoke)).toBe(255);
    expect(get(1, 0, CELL_CHANNEL.smoke)).toBe(0);
    // 煙の層を出さないマスも数には入る
    expect(counts.smokyCells).toBe(2);
  });

  it.each([
    ["教室", "0"],
    ["廊下", "h"],
    ["ドア", "d"],
    ["昇降口", "e"],
  ])("%s のマスには煙の層を出す", (_label, ch) => {
    const plan = makePlan([[ch]]);
    const { get } = write(plan, tables([[Infinity]], [[0]]), 100);
    expect(get(0, 0, CELL_CHANNEL.smoke)).toBe(255);
  });

  it("燃えているマス（火が着く時刻 ≤ 今）の G は炎の強さ，着く前は 0", () => {
    const plan = makePlan([["hhhhh"]]);
    const fire = [[0, 10, 10.5, Infinity, Infinity]];
    const { get, counts } = write(plan, tables(fire, uniform(plan, Infinity)), 10);
    expect(get(0, 0, CELL_CHANNEL.fire)).toBe(255);
    expect(get(1, 0, CELL_CHANNEL.fire)).toBe(Math.round(0.35 * 255));
    expect(get(2, 0, CELL_CHANNEL.fire)).toBe(0);
    expect(get(3, 0, CELL_CHANNEL.fire)).toBe(0);
    expect(counts.burningCells).toBe(2);
  });

  it("床の照り返し（B）は燃えているマスで強さ，周り 1 マス（斜めを含む）で 0.5 倍，2 マス先は 0", () => {
    const plan = makePlan([["hhhhh", "hhhhh", "hhhhh", "hhhhh", "hhhhh"]]);
    const fire = uniform(plan, Infinity);
    fire[0][2 * 5 + 2] = 0; // 中央 (2, 2)
    const { get } = write(plan, tables(fire, uniform(plan, Infinity)), 100);
    expect(FIRE_GLOW_SPREAD).toBe(0.5);
    expect(get(2, 2, CELL_CHANNEL.glow)).toBe(255);
    for (const [x, z] of [
      [1, 1],
      [2, 1],
      [3, 1],
      [1, 2],
      [3, 2],
      [1, 3],
      [2, 3],
      [3, 3],
    ]) {
      expect(get(x, z, CELL_CHANNEL.glow)).toBe(Math.round(0.5 * 255));
      expect(get(x, z, CELL_CHANNEL.fire)).toBe(0);
    }
    for (const [x, z] of [
      [0, 0],
      [4, 2],
      [2, 4],
      [0, 2],
    ]) {
      expect(get(x, z, CELL_CHANNEL.glow)).toBe(0);
    }
  });

  it("照り返しが重なるマスは大きい方（燃えているマスは自分の強さのまま）", () => {
    const plan = makePlan([["hhh"]]);
    const fire = [[0, 0, Infinity]];
    const { get } = write(plan, tables(fire, uniform(plan, Infinity)), 100);
    expect(get(0, 0, CELL_CHANNEL.glow)).toBe(255);
    expect(get(1, 0, CELL_CHANNEL.glow)).toBe(255);
    expect(get(2, 0, CELL_CHANNEL.glow)).toBe(Math.round(0.5 * 255));
  });

  it("書く前に全体を 0 にし，縁は 0 のまま（端のマスの照り返しが縁にはみ出さない）", () => {
    const plan = makePlan([["hh", "hh"], ["hh"]]);
    const fire = [
      [0, 0, 0, 0],
      [0, 0],
    ];
    const { out, atlas } = write(plan, tables(fire, fire), 100, 200);
    const inside = new Set<number>();
    plan.floors.forEach((floor, f) => {
      for (let z = 0; z < floor.depth; z++) {
        for (let x = 0; x < floor.width; x++) inside.add(cellTexel(atlas, f, x, z));
      }
    });
    for (let t = 0; t < atlas.width * atlas.height; t++) {
      if (inside.has(t)) continue;
      for (let c = 0; c < 4; c++) expect(out[t * 4 + c]).toBe(0);
    }
    // マス目の中の A は使わない
    for (const t of inside) expect(out[t * 4 + 3]).toBe(0);
  });

  it("複数の階は階ごとのテクセルに書く（隣の階に混ざらない）", () => {
    const plan = makePlan([["hh"], ["hh"]]);
    const fire = [
      [0, Infinity],
      [Infinity, Infinity],
    ];
    const { get } = write(plan, tables(fire, uniform(plan, Infinity)), 100);
    expect(get(0, 0, CELL_CHANNEL.fire, 0)).toBe(255);
    expect(get(0, 0, CELL_CHANNEL.fire, 1)).toBe(0);
    expect(get(0, 0, CELL_CHANNEL.glow, 1)).toBe(0);
    expect(get(1, 0, CELL_CHANNEL.glow, 1)).toBe(0);
  });

  it("時刻が NaN の時は何も書かない", () => {
    const plan = makePlan([["hh"]]);
    const { out, counts } = write(plan, tables(uniform(plan, 0)), Number.NaN, 7);
    expect(out.every((b) => b === 0)).toBe(true);
    expect(counts).toEqual({ burningCells: 0, smokyCells: 0 });
  });

  it("デモの校舎では十分後でも防火シャッター（x = 12）より西のマスに煙・炎・照り返しが無い", () => {
    const spread = computeSpread(DEMO_SCHOOL);
    const { get, counts } = write(DEMO_SCHOOL, spread, 1000);
    const floor = DEMO_SCHOOL.floors[0];
    for (let z = 0; z < floor.depth; z++) {
      for (let x = 0; x < 12; x++) {
        expect(get(x, z, CELL_CHANNEL.smoke)).toBe(0);
        expect(get(x, z, CELL_CHANNEL.fire)).toBe(0);
        expect(get(x, z, CELL_CHANNEL.glow)).toBe(0);
      }
    }
    // 東側（理科室の火元）には煙と炎がある
    expect(get(16, 2, CELL_CHANNEL.smoke)).toBe(255);
    expect(get(16, 2, CELL_CHANNEL.fire)).toBe(255);
    expect(counts.burningCells).toBeGreaterThan(0);
  });

  it("燃えているマスの数は，火が着く時刻 ≤ 今のマスの数と同じ", () => {
    const spread = computeSpread(DEMO_SCHOOL);
    for (const now of [0, 5.9, 6, 30, 100]) {
      const expected = spread.fireSeconds[0].filter((t) => t <= now).length;
      expect(write(DEMO_SCHOOL, spread, now).counts.burningCells).toBe(expected);
      const smoky = spread.smokeSeconds[0].filter((t) => t < now).length;
      expect(write(DEMO_SCHOOL, spread, now).counts.smokyCells).toBe(smoky);
    }
  });
});

describe("createFireParticleSeeds", () => {
  it("既定で FIRE_PARTICLES.count（600）個", () => {
    expect(FIRE_PARTICLES.count).toBe(600);
    expect(createFireParticleSeeds()).toHaveLength(600);
    expect(createFireParticleSeeds(5)).toHaveLength(5);
  });

  it("同じ種なら同じ値，違う種なら違う値（決定的）", () => {
    expect(createFireParticleSeeds(20, 1)).toEqual(createFireParticleSeeds(20, 1));
    expect(createFireParticleSeeds(20, 1)).not.toEqual(createFireParticleSeeds(20, 2));
  });

  it("各値は範囲の中（phase・size・sway は 0〜1，寿命は 1.2 s の ±20%）", () => {
    for (const s of createFireParticleSeeds()) {
      for (const v of [s.phase, s.size, s.sway]) {
        expect(v).toBeGreaterThanOrEqual(0);
        expect(v).toBeLessThan(1);
      }
      expect(s.lifeSeconds).toBeGreaterThanOrEqual(1.2 * 0.8);
      expect(s.lifeSeconds).toBeLessThanOrEqual(1.2 * 1.2);
    }
  });
});

describe("particleCycle / particleCycleStart", () => {
  const seed = { phase: 0.25, lifeSeconds: 1, size: 0.5, sway: 0.5 };

  it("cycle 回目の始まりは今の時刻以前で，次の始まりは今より後", () => {
    for (const now of [-3.3, 0, 0.74, 0.75, 1.9, 100.1]) {
      const c = particleCycle(seed, now);
      expect(Number.isInteger(c)).toBe(true);
      expect(particleCycleStart(seed, c)).toBeLessThanOrEqual(now + 1e-9);
      expect(particleCycleStart(seed, c + 1)).toBeGreaterThan(now);
    }
  });

  it("寿命ごとに 1 つ増える", () => {
    expect(particleCycle(seed, 0)).toBe(0);
    expect(particleCycle(seed, 0.75)).toBe(1);
    expect(particleCycle(seed, 1.75)).toBe(2);
  });

  it("時刻が NaN の時は NaN", () => {
    expect(particleCycle(seed, Number.NaN)).toBeNaN();
  });
});

describe("sortByIgnition / burningCountAt", () => {
  const cells = [fireCell(10), fireCell(0), fireCell(5), fireCell(-Infinity), fireCell(5)];
  const sorted = sortByIgnition(cells);

  it("火が着く時刻の早い順に並べ，元の配列は変えない", () => {
    expect(sorted.map((c) => c.seconds)).toEqual([-Infinity, 0, 5, 5, 10]);
    expect(cells.map((c) => c.seconds)).toEqual([10, 0, 5, -Infinity, 5]);
  });

  it.each([
    [-100, 1],
    [-0.001, 1],
    [0, 2],
    [4.999, 2],
    [5, 4],
    [9.999, 4],
    [10, 5],
    [Infinity, 5],
    [-Infinity, 1],
  ])("時刻 %d に燃えているマス（着く時刻 ≤ 今）は %d", (now, count) => {
    expect(burningCountAt(sorted, now)).toBe(count);
  });

  it("時刻が NaN・マスが無い時は 0", () => {
    expect(burningCountAt(sorted, Number.NaN)).toBe(0);
    expect(burningCountAt([], 100)).toBe(0);
  });

  it("多数のマスでも線形に数えた結果と同じ", () => {
    const many = sortByIgnition(
      Array.from({ length: 257 }, (_, i) => fireCell(Math.floor(hash01(i, 0, 9) * 50))),
    );
    for (let now = -1; now <= 51; now += 0.5) {
      expect(burningCountAt(many, now)).toBe(many.filter((c) => c.seconds <= now).length);
    }
  });
});

describe("hash01", () => {
  it("同じ入力なら同じ値（状態を持たない）", () => {
    expect(hash01(3, 7, 101)).toBe(hash01(3, 7, 101));
  });

  it("0 以上 1 未満で，塩ごとに (a, b) が違えば概ね違う値になり，偏りが大きくない", () => {
    for (const salt of [0, 1, 101, 202]) {
      const values = new Set<number>();
      let sum = 0;
      let n = 0;
      for (let a = 0; a < 40; a++) {
        for (let b = -5; b < 20; b++) {
          const v = hash01(a, b, salt);
          expect(v).toBeGreaterThanOrEqual(0);
          expect(v).toBeLessThan(1);
          values.add(v);
          sum += v;
          n++;
        }
      }
      expect(values.size).toBeGreaterThan(n * 0.99);
      expect(sum / n).toBeGreaterThan(0.45);
      expect(sum / n).toBeLessThan(0.55);
    }
  });

  it("同じ (a, b) でも塩が違えば違う値（粒の x・z・候補の選び方が同じにならない）", () => {
    for (let a = 0; a < 20; a++) {
      for (let b = 0; b < 20; b++) {
        const vs = [0, 1, 101, 202].map((salt) => hash01(a, b, salt));
        expect(new Set(vs).size).toBe(4);
      }
    }
  });
});

describe("chooseParticleSpawn", () => {
  const seed = { phase: 0, lifeSeconds: 1, size: 0.5, sway: 0.5 };

  /** 時刻 0 に燃えている n マス（x 方向に並べる） */
  function burning(n: number, cellSize = 1, baseY = 0): FireSmokeCell[] {
    return sortByIgnition(
      Array.from({ length: n }, (_, i) =>
        fireCell(0, {
          x: i,
          centerX: (i + 0.5) * cellSize,
          centerZ: 0.5 * cellSize,
          baseY,
        }),
      ),
    );
  }

  it("燃えているマスが 0 なら出さない（ignition は隠す時刻，boost は 1）", () => {
    const out = newSpawn();
    chooseParticleSpawn([], 0, 5, seed, 1, null, out);
    expect(out.active).toBe(false);
    expect(out.ignition).toBe(HIDDEN_IGNITION_SECONDS);
    expect(out.boost).toBe(1);
  });

  it("粒が生まれた時刻にまだ火が着いていなければ出さない", () => {
    const sorted = sortByIgnition([fireCell(10)]);
    const out = newSpawn();
    // cycle 5 の始まりは 5 秒（火は 10 秒）
    chooseParticleSpawn(sorted, 0, 5, seed, 1, null, out);
    expect(out.active).toBe(false);
    chooseParticleSpawn(sorted, 0, 10, seed, 1, null, out);
    expect(out.active).toBe(true);
  });

  it.each([Number.NaN, Infinity, -Infinity])("cycle が %d の時は出さない", (cycle) => {
    const out = newSpawn();
    chooseParticleSpawn(burning(3), 0, cycle, seed, 1, null, out);
    expect(out.active).toBe(false);
    expect(out.ignition).toBe(HIDDEN_IGNITION_SECONDS);
  });

  it("1 マスあたり 20 粒まで（燃えているマスが 2 つなら 40 番目からは出さない）", () => {
    const sorted = burning(2);
    const out = newSpawn();
    chooseParticleSpawn(sorted, 39, 3, seed, 1, null, out);
    expect(out.active).toBe(true);
    chooseParticleSpawn(sorted, 40, 3, seed, 1, null, out);
    expect(out.active).toBe(false);
    chooseParticleSpawn(sorted, 599, 3, seed, 1, null, out);
    expect(out.active).toBe(false);
  });

  it("燃えているマスが多くても総数（600）を超えない", () => {
    const sorted = burning(100);
    const out = newSpawn();
    chooseParticleSpawn(sorted, 599, 3, seed, 1, null, out);
    expect(out.active).toBe(true);
    chooseParticleSpawn(sorted, 600, 3, seed, 1, null, out);
    expect(out.active).toBe(false);
  });

  it("出す粒は燃えているマスの中心から 1.25 マスの範囲（±0.625 マス）にあり，y はその階の床", () => {
    for (const cellSize of [1, 2]) {
      const sorted = burning(5, cellSize, 3.5);
      const out = newSpawn();
      for (let i = 0; i < 100; i++) {
        for (let cycle = 0; cycle < 5; cycle++) {
          chooseParticleSpawn(sorted, i, cycle, seed, cellSize, null, out);
          expect(out.active).toBe(true);
          expect(out.y).toBe(3.5);
          const near = sorted.some(
            (c) =>
              Math.abs(out.x - c.centerX) <= 0.625 * cellSize &&
              Math.abs(out.z - c.centerZ) <= 0.625 * cellSize,
          );
          expect(near).toBe(true);
          expect(out.ignition).toBe(0);
        }
      }
    }
  });

  it("燃えている全てのマスに粒が割り当てられる", () => {
    // マスの中心を 10 m ずつ離し，粒の位置からどのマスか分かるようにする
    const sorted = sortByIgnition(
      Array.from({ length: 5 }, (_, i) => fireCell(0, { x: i, centerX: i * 10 + 0.5 })),
    );
    const out = newSpawn();
    const used = new Set<number>();
    for (let i = 0; i < 100; i++) {
      chooseParticleSpawn(sorted, i, 1, seed, 1, null, out);
      used.add(Math.round((out.x - 0.5) / 10));
    }
    expect([...used].sort()).toEqual([0, 1, 2, 3, 4]);
  });

  it("同じ粒・同じ cycle なら同じ位置（決定的）", () => {
    const sorted = burning(7);
    const a = newSpawn();
    const b = newSpawn();
    chooseParticleSpawn(sorted, 42, 9, seed, 1, null, a);
    chooseParticleSpawn(sorted, 42, 9, seed, 1, null, b);
    expect(a).toEqual(b);
  });

  it("目の位置を渡すと，目から遠いマスより近いマスに多く出す", () => {
    const sorted = burning(10);
    const eye = { x: 0.5, y: 1.6, z: 0.5 };
    const out = newSpawn();
    let nearWithEye = 0;
    let nearWithout = 0;
    for (let i = 0; i < 200; i++) {
      chooseParticleSpawn(sorted, i, 4, seed, 1, eye, out);
      if (out.x < 5) nearWithEye++;
      chooseParticleSpawn(sorted, i, 4, seed, 1, null, out);
      if (out.x < 5) nearWithout++;
    }
    expect(nearWithEye).toBeGreaterThan(nearWithout);
  });

  it("粒が少ないマス（1 マスあたり 20 粒未満）では大きくし，倍率は 2 まで", () => {
    const out = newSpawn();
    // 600 / 30 = 20 粒／マス → 1
    chooseParticleSpawn(burning(30), 0, 3, seed, 1, null, out);
    expect(out.boost).toBe(1);
    // 少ないマス（1 マス）では大きくしない
    chooseParticleSpawn(burning(1), 0, 3, seed, 1, null, out);
    expect(out.boost).toBe(1);
    // 600 / 60 = 10 粒／マス → 1 より大きく 2 以下
    chooseParticleSpawn(burning(60), 0, 3, seed, 1, null, out);
    expect(out.boost).toBeGreaterThan(1);
    expect(out.boost).toBeLessThanOrEqual(2);
    // 600 / 600 = 1 粒／マス → 上限の 2
    chooseParticleSpawn(burning(600), 0, 3, seed, 1, null, out);
    expect(out.boost).toBe(2);
  });

  it("火が着く時刻が -Infinity のマスでも ignition は有限", () => {
    const sorted = sortByIgnition([fireCell(-Infinity)]);
    const out = newSpawn();
    chooseParticleSpawn(sorted, 0, 0, seed, 1, null, out);
    expect(out.active).toBe(true);
    expect(Number.isFinite(out.ignition)).toBe(true);
    expect(out.ignition).toBeLessThanOrEqual(0);
  });
});
