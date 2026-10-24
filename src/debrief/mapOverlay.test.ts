// 結果画面の地図に重ねるもの（mapOverlay.ts）のテスト．
// 基準は docs/04_SPEC/SPEC_01「結果の評価」（正解経路・自分の経路・外れた区間・火に近づいた点・煙の中で立っていた区間を地図に重ねる），
// SPEC_02「座標」，src/core/drill.ts の型の約束（区間は両端の記録を含む），Issue #91 の決定（別の階・壊れた記録で線を分ける）
import { describe, expect, it } from "vitest";
import type { DrillEvaluation, DrillInterval, DrillSample, DrillTrack } from "../core/drill";
import type { CellRef, SchoolPlan } from "../core/schoolPlan";
import { DEMO_SCHOOL } from "../share/samples/demoSchool";
import { createFloorFromRows } from "../share/samples/floorFromRows";
import {
  buildMapOverlay,
  defaultDebriefFloor,
  intervalPolylines,
  roomLabels,
  routePolylines,
  trackPolylines,
} from "./mapOverlay";

const sample = (overrides: Partial<DrillSample> = {}): DrillSample => ({
  t: 0,
  floor: 0,
  x: 0.5,
  z: 0.5,
  posture: "standing",
  ...overrides,
});

/** x を 0.5, 1.5, 2.5, … と進む，floor の階の記録 */
const line = (count: number, floor = 0): DrillSample[] =>
  Array.from({ length: count }, (_, i) => sample({ t: i * 0.2, floor, x: i + 0.5, z: 0.5 }));

const interval = (fromIndex: number, toIndex: number): DrillInterval => ({
  fromIndex,
  toIndex,
  fromSeconds: fromIndex * 0.2,
  toSeconds: toIndex * 0.2,
});

const evaluation = (overrides: Partial<DrillEvaluation> = {}): DrillEvaluation => ({
  offRoute: [],
  nearFire: [],
  smokeSeconds: 0,
  smokeCrouchRatio: null,
  smokePostureGood: null,
  smokeStanding: [],
  evacuationSeconds: 30,
  timeLimitSeconds: 150,
  lateEscape: false,
  ...overrides,
});

const at = (floor: number, x: number, z: number): CellRef => ({ floor, x, z });

/** 2 階建ての小さな校舎（1 階: 教室 0・1 と廊下．2 階: 教室 2 と廊下．cellSize 2 m） */
const twoFloorPlan = (overrides: Partial<SchoolPlan["drill"]> = {}): SchoolPlan => ({
  version: 1,
  name: "テスト校舎",
  cellSize: 2,
  floors: [
    createFloorFromRows(1, ["00h11", "00h11", "hhhhe"]),
    createFloorFromRows(2, ["222hh", "hhhhh"]),
  ],
  rooms: [{ name: "1年1組" }, { name: "1年2組" }, { name: "2年1組" }, { name: "使われない教室" }],
  drill: {
    ...DEMO_SCHOOL.drill,
    start: at(1, 1, 0),
    fireOrigins: [at(0, 4, 0), at(1, 4, 1)],
    assembly: [at(0, 4, 2)],
    route: [at(1, 1, 0), at(1, 1, 1), at(1, 2, 1), at(0, 2, 2), at(0, 3, 2), at(0, 4, 2)],
    ...overrides,
  },
});

describe("defaultDebriefFloor", () => {
  it("開始地点の階", () => {
    expect(defaultDebriefFloor(twoFloorPlan())).toBe(1);
    expect(defaultDebriefFloor(DEMO_SCHOOL)).toBe(0);
  });

  it.each([2, -1, 0.5, Number.NaN])("開始地点の階が無い時は 0（%s）", (floor) => {
    expect(defaultDebriefFloor(twoFloorPlan({ start: at(floor, 0, 0) }))).toBe(0);
  });
});

describe("trackPolylines", () => {
  it("同じ階の記録を 1 本の折れ線にし，ワールド座標を cellSize で割って地図の座標にする", () => {
    const samples = [sample({ x: 1, z: 3 }), sample({ x: 3, z: 3 }), sample({ x: 5, z: 7 })];
    expect(trackPolylines(samples, 2, 0)).toEqual([
      [
        { u: 0.5, v: 1.5 },
        { u: 1.5, v: 1.5 },
        { u: 2.5, v: 3.5 },
      ],
    ]);
  });

  it("記録が空なら線は無い", () => {
    expect(trackPolylines([], 1, 0)).toEqual([]);
  });

  it("別の階の記録しか無ければ線は無い", () => {
    expect(trackPolylines(line(5, 1), 1, 0)).toEqual([]);
  });

  it("別の階に行って戻ってきた所で線を分ける（階をまたいで線を引かない）", () => {
    const samples = [
      ...line(3, 0),
      sample({ floor: 1, x: 3.5 }),
      sample({ floor: 1, x: 4.5 }),
      sample({ floor: 0, x: 5.5 }),
      sample({ floor: 0, x: 6.5 }),
    ];
    const lines = trackPolylines(samples, 1, 0);
    expect(lines).toHaveLength(2);
    expect(lines[0].map((p) => p.u)).toEqual([0.5, 1.5, 2.5]);
    expect(lines[1].map((p) => p.u)).toEqual([5.5, 6.5]);
    // 2 階の地図ではその間だけ
    expect(trackPolylines(samples, 1, 1)).toEqual([
      [
        { u: 3.5, v: 0.5 },
        { u: 4.5, v: 0.5 },
      ],
    ]);
  });

  it.each([
    ["x が NaN", { x: Number.NaN }],
    ["z が NaN", { z: Number.NaN }],
    ["x が Infinity", { x: Number.POSITIVE_INFINITY }],
  ])("座標が壊れた記録（%s）の所で線を分け，その記録は描かない", (_name, broken) => {
    const samples = [...line(2), sample({ ...broken }), sample({ x: 3.5 }), sample({ x: 4.5 })];
    const lines = trackPolylines(samples, 1, 0);
    expect(lines).toHaveLength(2);
    expect(lines[0]).toHaveLength(2);
    expect(lines[1]).toHaveLength(2);
    for (const p of lines.flat()) {
      expect(Number.isFinite(p.u) && Number.isFinite(p.v)).toBe(true);
    }
  });

  it("壊れた記録の間に挟まれた 1 つだけの記録は点（長さ 1 の線）になる", () => {
    const samples = [sample({ x: Number.NaN }), sample({ x: 1.5 }), sample({ x: Number.NaN })];
    expect(trackPolylines(samples, 1, 0)).toEqual([[{ u: 1.5, v: 0.5 }]]);
  });

  it("cellSize が正でない時は線を引かない", () => {
    expect(trackPolylines(line(3), 0, 0)).toEqual([]);
    expect(trackPolylines(line(3), -1, 0)).toEqual([]);
  });

  it("fromIndex〜toIndex（両端を含む）だけを線にする", () => {
    const lines = trackPolylines(line(10), 1, 0, 2, 4);
    expect(lines).toHaveLength(1);
    expect(lines[0].map((p) => p.u)).toEqual([2.5, 3.5, 4.5]);
  });

  it("fromIndex と toIndex が同じなら 1 点", () => {
    expect(trackPolylines(line(10), 1, 0, 3, 3)).toEqual([[{ u: 3.5, v: 0.5 }]]);
  });

  it("範囲外の添字は記録の範囲に切り詰める", () => {
    expect(trackPolylines(line(5), 1, 0, -3, 1)[0].map((p) => p.u)).toEqual([0.5, 1.5]);
    expect(trackPolylines(line(5), 1, 0, 3, 99)[0].map((p) => p.u)).toEqual([3.5, 4.5]);
    expect(trackPolylines(line(5), 1, 0, -10, 99)[0]).toHaveLength(5);
  });

  it("区間がまるごと記録の外なら線は無い", () => {
    expect(trackPolylines(line(5), 1, 0, 7, 9)).toEqual([]);
    expect(trackPolylines(line(5), 1, 0, -5, -1)).toEqual([]);
  });

  it("fromIndex が toIndex より大きい時は線を引かない", () => {
    expect(trackPolylines(line(10), 1, 0, 5, 2)).toEqual([]);
  });

  it("添字が NaN でも例外を投げず，線を引かない", () => {
    expect(trackPolylines(line(5), 1, 0, Number.NaN, 3)).toEqual([]);
    expect(trackPolylines(line(5), 1, 0, 0, Number.NaN)).toEqual([]);
  });
});

describe("intervalPolylines", () => {
  it("区間ごとに別の線にする", () => {
    const lines = intervalPolylines(line(10), [interval(1, 2), interval(6, 8)], 1, 0);
    expect(lines.map((l) => l.map((p) => p.u))).toEqual([
      [1.5, 2.5],
      [6.5, 7.5, 8.5],
    ]);
  });

  it("区間が無ければ線は無い", () => {
    expect(intervalPolylines(line(10), [], 1, 0)).toEqual([]);
  });

  it("区間の途中で別の階に行った所は分け，その階の地図には出さない", () => {
    const samples = [...line(3, 0), sample({ floor: 1, x: 3.5 }), ...line(2, 0)];
    const lines = intervalPolylines(samples, [interval(0, 5)], 1, 0);
    expect(lines).toHaveLength(2);
    expect(intervalPolylines(samples, [interval(0, 5)], 1, 1)).toEqual([[{ u: 3.5, v: 0.5 }]]);
  });

  it("範囲外・逆向きの区間があっても他の区間は描く", () => {
    const lines = intervalPolylines(
      line(5),
      [interval(4, 1), interval(8, 9), interval(3, 20)],
      1,
      0,
    );
    expect(lines.map((l) => l.map((p) => p.u))).toEqual([[3.5, 4.5]]);
  });
});

describe("routePolylines", () => {
  it("正解経路のマスの中心を結ぶ", () => {
    expect(routePolylines([at(0, 0, 0), at(0, 1, 0), at(0, 1, 1)], 0)).toEqual([
      [
        { u: 0.5, v: 0.5 },
        { u: 1.5, v: 0.5 },
        { u: 1.5, v: 1.5 },
      ],
    ]);
  });

  it("その階のマスだけを，続いている所ごとに分ける", () => {
    const route = [at(1, 1, 0), at(1, 2, 0), at(0, 2, 2), at(0, 3, 2), at(1, 4, 1)];
    expect(routePolylines(route, 0)).toEqual([
      [
        { u: 2.5, v: 2.5 },
        { u: 3.5, v: 2.5 },
      ],
    ]);
    expect(routePolylines(route, 1)).toEqual([
      [
        { u: 1.5, v: 0.5 },
        { u: 2.5, v: 0.5 },
      ],
      [{ u: 4.5, v: 1.5 }],
    ]);
  });

  it("経路が空・別の階だけなら線は無い", () => {
    expect(routePolylines([], 0)).toEqual([]);
    expect(routePolylines([at(1, 0, 0)], 0)).toEqual([]);
  });

  it("デモの校舎の正解経路は 1 本で，最初が開始地点・最後が集合場所の中心", () => {
    const lines = routePolylines(DEMO_SCHOOL.drill.route, 0);
    expect(lines).toHaveLength(1);
    expect(lines[0]).toHaveLength(DEMO_SCHOOL.drill.route.length);
    expect(lines[0][0]).toEqual({ u: 2.5, v: 2.5 });
    expect(lines[0][lines[0].length - 1]).toEqual({ u: 8.5, v: 10.5 });
  });
});

describe("roomLabels", () => {
  it("階にある教室ごとに，教室のマスの中心の平均の位置に名前を出す（教室の添字の順）", () => {
    expect(roomLabels(twoFloorPlan(), 0)).toEqual([
      { name: "1年1組", at: { u: 1, v: 1 } },
      { name: "1年2組", at: { u: 4, v: 1 } },
    ]);
    expect(roomLabels(twoFloorPlan(), 1)).toEqual([{ name: "2年1組", at: { u: 1.5, v: 0.5 } }]);
  });

  it("その階にマスの無い教室は出さない", () => {
    const names = [0, 1].flatMap((f) => roomLabels(twoFloorPlan(), f).map((l) => l.name));
    expect(names).not.toContain("使われない教室");
  });

  it("無い階は空", () => {
    expect(roomLabels(twoFloorPlan(), 2)).toEqual([]);
    expect(roomLabels(twoFloorPlan(), -1)).toEqual([]);
  });

  it("rooms に無い添字の教室のマスは出さない", () => {
    const plan: SchoolPlan = { ...twoFloorPlan(), rooms: [{ name: "1年1組" }] };
    expect(roomLabels(plan, 0)).toEqual([{ name: "1年1組", at: { u: 1, v: 1 } }]);
  });

  it("デモの校舎の 1 階には 3 つの教室の名前が出る", () => {
    expect(roomLabels(DEMO_SCHOOL, 0).map((l) => l.name)).toEqual(["1年1組", "1年2組", "理科室"]);
  });
});

describe("buildMapOverlay", () => {
  const plan = twoFloorPlan();
  // 2 階を 3 つ歩いて，1 階に降りて 3 つ歩く（cellSize 2 m．マスの中心のワールド座標）
  const samples: DrillSample[] = [
    sample({ t: 0, floor: 1, x: 3, z: 1 }),
    sample({ t: 0.2, floor: 1, x: 3, z: 3 }),
    sample({ t: 0.4, floor: 1, x: 5, z: 3, posture: "crouching" }),
    sample({ t: 0.6, floor: 0, x: 5, z: 5 }),
    sample({ t: 0.8, floor: 0, x: 7, z: 5 }),
    sample({ t: 1.0, floor: 0, x: 9, z: 5 }),
  ];
  const track: DrillTrack = { samples };
  const ev = evaluation({
    offRoute: [interval(1, 2)],
    smokeStanding: [interval(0, 1), interval(4, 5)],
    nearFire: [
      { index: 5, t: 1, floor: 0, x: 9, z: 5 },
      { index: 2, t: 0.4, floor: 1, x: 5, z: 3 },
      { index: 4, t: 0.8, floor: 0, x: Number.NaN, z: 5 },
    ],
  });

  it("その階の正解経路・自分の経路・外れた区間・煙の中で立っていた区間を組み立てる（1 階）", () => {
    const overlay = buildMapOverlay(plan, 0, track, ev);
    expect(overlay.correctRoute).toEqual(routePolylines(plan.drill.route, 0));
    expect(overlay.ownPath).toEqual([
      [
        { u: 2.5, v: 2.5 },
        { u: 3.5, v: 2.5 },
        { u: 4.5, v: 2.5 },
      ],
    ]);
    expect(overlay.offRoute).toEqual([]);
    expect(overlay.smokeStanding).toEqual([
      [
        { u: 3.5, v: 2.5 },
        { u: 4.5, v: 2.5 },
      ],
    ]);
  });

  it("火に近づいた点はその階のものだけ，座標が壊れたものは除く", () => {
    expect(buildMapOverlay(plan, 0, track, ev).nearFire).toEqual([{ u: 4.5, v: 2.5 }]);
    expect(buildMapOverlay(plan, 1, track, ev).nearFire).toEqual([{ u: 2.5, v: 1.5 }]);
  });

  it("2 階では 2 階の分だけ", () => {
    const overlay = buildMapOverlay(plan, 1, track, ev);
    expect(overlay.ownPath).toEqual([
      [
        { u: 1.5, v: 0.5 },
        { u: 1.5, v: 1.5 },
        { u: 2.5, v: 1.5 },
      ],
    ]);
    expect(overlay.offRoute).toEqual([
      [
        { u: 1.5, v: 1.5 },
        { u: 2.5, v: 1.5 },
      ],
    ]);
    expect(overlay.smokeStanding).toEqual([
      [
        { u: 1.5, v: 0.5 },
        { u: 1.5, v: 1.5 },
      ],
    ]);
  });

  it("開始地点はその階にある時だけマスの中心に出す", () => {
    expect(buildMapOverlay(plan, 1, track, ev).start).toEqual({ u: 1.5, v: 0.5 });
    expect(buildMapOverlay(plan, 0, track, ev).start).toBeNull();
  });

  it("集合場所・火元はその階のマスだけ（x・z で）", () => {
    const first = buildMapOverlay(plan, 0, track, ev);
    expect(first.assembly).toEqual([{ x: 4, z: 2 }]);
    expect(first.fireOrigins).toEqual([{ x: 4, z: 0 }]);
    const second = buildMapOverlay(plan, 1, track, ev);
    expect(second.assembly).toEqual([]);
    expect(second.fireOrigins).toEqual([{ x: 4, z: 1 }]);
  });

  it("教室の名前は roomLabels と同じ", () => {
    expect(buildMapOverlay(plan, 0, track, ev).roomLabels).toEqual(roomLabels(plan, 0));
  });

  it("記録が空でも組み立てられる（経路と印だけ）", () => {
    const overlay = buildMapOverlay(
      plan,
      0,
      { samples: [] },
      evaluation({ offRoute: [interval(0, 3)] }),
    );
    expect(overlay.ownPath).toEqual([]);
    expect(overlay.offRoute).toEqual([]);
    expect(overlay.correctRoute.length).toBeGreaterThan(0);
  });

  it("無い階の地図は空（例外を投げない）", () => {
    const overlay = buildMapOverlay(plan, 5, track, ev);
    expect(overlay.correctRoute).toEqual([]);
    expect(overlay.ownPath).toEqual([]);
    expect(overlay.nearFire).toEqual([]);
    expect(overlay.start).toBeNull();
    expect(overlay.roomLabels).toEqual([]);
  });
});
