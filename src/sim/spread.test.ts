// 延焼の計算（computeSpread・isNearFire）のテスト．
// 基準は docs/04_SPEC/SPEC_02_校舎データの形式.md「通れる・燃え広がる」「型」（SpreadSettings）と
// SPEC_01「受け渡すデータ」（SpreadMap: 着かなければ Infinity），PLAN_04 の E4（防火シャッターで延焼が止まる）
import { describe, expect, it } from "vitest";
import type { CellRef, DrillSetup, SchoolPlan, SpreadSettings } from "../core/schoolPlan";
import { decodePlan, encodePlan } from "../share/planCodec";
import { DEMO_SCHOOL } from "../share/samples/demoSchool";
import { createFloorFromRows } from "../share/samples/floorFromRows";
import { computeSpread, isNearFire } from "./spread";

const at = (x: number, z: number, floor = 0): CellRef => ({ floor, x, z });

interface PlanOverrides extends Partial<Omit<DrillSetup, "spread">> {
  readonly spread?: Partial<SpreadSettings>;
}

/** 行の文字列から 1 フロアの校舎を作る（訓練条件は既定値を一部だけ上書き） */
function makePlan(rows: readonly string[], overrides: PlanOverrides = {}): SchoolPlan {
  const { spread, ...drill } = overrides;
  return {
    version: 1,
    name: "テスト校舎",
    cellSize: 1,
    floors: [createFloorFromRows(1, rows)],
    rooms: [{ name: "教室A" }, { name: "教室B" }],
    drill: {
      mode: "learn",
      fireOrigins: [at(0, 0)],
      start: at(0, 0),
      startYaw: 0,
      assembly: [],
      route: [],
      timeLimitSeconds: 150,
      ...drill,
      spread: { fireSecondsPerCell: 6, smokeSecondsPerCell: 2, extraFires: [], ...spread },
    },
  };
}

describe("computeSpread", () => {
  it("火元は 0 秒に燃え，上下左右に 1 マスごと fireSecondsPerCell 秒で広がる", () => {
    const spread = computeSpread(makePlan(["hhhhh"]));
    expect([0, 1, 2, 3, 4].map((x) => spread.fireAt(at(x, 0)))).toEqual([0, 6, 12, 18, 24]);
  });

  it("煙は smokeSecondsPerCell 秒で広がる（火より速い既定値）", () => {
    const spread = computeSpread(makePlan(["hhhhh"]));
    expect([0, 1, 2, 3, 4].map((x) => spread.smokeAt(at(x, 0)))).toEqual([0, 2, 4, 6, 8]);
  });

  it("着く時刻は火元からのマスの数（上下左右）× 秒数．斜めには 1 歩で移らない", () => {
    const spread = computeSpread(makePlan(["hhh", "hhh", "hhh"], { fireOrigins: [at(1, 1)] }));
    expect(spread.fireAt(at(1, 1))).toBe(0);
    expect(spread.fireAt(at(1, 0))).toBe(6);
    expect(spread.fireAt(at(0, 0))).toBe(12);
    expect(spread.fireAt(at(2, 2))).toBe(12);
  });

  it("斜めにしかつながらないマスには届かない", () => {
    const spread = computeSpread(makePlan(["h#", "#h"]));
    expect(spread.fireAt(at(1, 1))).toBe(Infinity);
    expect(spread.smokeAt(at(1, 1))).toBe(Infinity);
  });

  it("防火シャッターで火も煙も止まる（シャッターのマスにも，その先にも着かない）", () => {
    const spread = computeSpread(makePlan(["hhshh"]));
    expect(spread.fireAt(at(1, 0))).toBe(6);
    for (const x of [2, 3, 4]) {
      expect(spread.fireAt(at(x, 0))).toBe(Infinity);
      expect(spread.smokeAt(at(x, 0))).toBe(Infinity);
    }
  });

  it("出口までは広がるが，屋外（outdoor）へは広がらない", () => {
    const spread = computeSpread(makePlan(["hheoo"]));
    expect(spread.fireAt(at(2, 0))).toBe(12);
    expect(spread.smokeAt(at(2, 0))).toBe(4);
    for (const x of [3, 4]) {
      expect(spread.fireAt(at(x, 0))).toBe(Infinity);
      expect(spread.smokeAt(at(x, 0))).toBe(Infinity);
    }
  });

  it("屋外を回り込んで別の出口から広がることもない", () => {
    // 東の廊下は西の廊下と屋外を通じてしかつながらない
    const spread = computeSpread(makePlan(["he#eh", "ooooo"]));
    expect(spread.fireAt(at(1, 0))).toBe(6);
    expect(spread.fireAt(at(3, 0))).toBe(Infinity);
    expect(spread.smokeAt(at(4, 0))).toBe(Infinity);
  });

  it("壁のある辺（教室と廊下の間）は越えず，ドアを通って広がる", () => {
    // z=0: 教室 0 が 3 マス．z=1: 廊下．ドアは x=2 だけ
    const spread = computeSpread(makePlan(["000", "hhd", "hhh"], { fireOrigins: [at(0, 0)] }));
    // (0,0) → (1,0) → (2,0) → ドア (2,1) → 廊下 (1,1)・(2,2)
    expect(spread.fireAt(at(2, 1))).toBe(18);
    expect(spread.fireAt(at(1, 1))).toBe(24);
    expect(spread.fireAt(at(0, 1))).toBe(30); // 真下の (0,1) へは壁で直接移らない
  });

  it("別の教室との間は壁で広がらない", () => {
    const spread = computeSpread(makePlan(["0011"]));
    expect(spread.fireAt(at(1, 0))).toBe(6);
    expect(spread.fireAt(at(2, 0))).toBe(Infinity);
  });

  it("void・wall には広がらない", () => {
    const spread = computeSpread(makePlan(["h.h", "h#h"]));
    expect(spread.fireAt(at(1, 0))).toBe(Infinity);
    expect(spread.fireAt(at(1, 1))).toBe(Infinity);
    expect(spread.fireAt(at(2, 0))).toBe(Infinity);
  });

  it("extraFires は atSeconds にそのマスが燃え始め，そこからも広がる", () => {
    // シャッターの向こうは火元から届かないので，手で足した延焼箇所だけが元になる
    const spread = computeSpread(
      makePlan(["hshhh"], { spread: { extraFires: [{ cell: at(3, 0), atSeconds: 20 }] } }),
    );
    expect(spread.fireAt(at(3, 0))).toBe(20);
    expect(spread.fireAt(at(2, 0))).toBe(26);
    expect(spread.fireAt(at(4, 0))).toBe(26);
    expect(spread.smokeAt(at(3, 0))).toBe(20);
    expect(spread.smokeAt(at(4, 0))).toBe(22);
    expect(spread.fireAt(at(1, 0))).toBe(Infinity); // シャッター
  });

  it("extraFires より先に火元からの火が着くマスは，早いほうの時刻", () => {
    const spread = computeSpread(
      makePlan(["hhhh"], { spread: { extraFires: [{ cell: at(1, 0), atSeconds: 100 }] } }),
    );
    expect(spread.fireAt(at(1, 0))).toBe(6);
  });

  it("extraFires が火元より早い時は，そこから広がった時刻が火元側にも及ぶ", () => {
    const spread = computeSpread(
      makePlan(["hhhhh"], { spread: { extraFires: [{ cell: at(4, 0), atSeconds: 0 }] } }),
    );
    expect(spread.fireAt(at(3, 0))).toBe(6);
    expect(spread.fireAt(at(2, 0))).toBe(12);
    expect(spread.fireAt(at(1, 0))).toBe(6);
  });

  it("煙の発生源（extraSmokes）は atSeconds に煙が出始め，smokeSecondsPerCell で広がる．火は出ない", () => {
    // 火元 (0, 0) とはシャッターで隔てた側に発生源を置く
    const spread = computeSpread(
      makePlan(["hshhhh"], { spread: { extraSmokes: [{ cell: at(3, 0), atSeconds: 20 }] } }),
    );
    expect([2, 3, 4, 5].map((x) => spread.smokeAt(at(x, 0)))).toEqual([22, 20, 22, 24]);
    expect([2, 3, 4, 5].map((x) => spread.fireAt(at(x, 0)))).toEqual([
      Infinity,
      Infinity,
      Infinity,
      Infinity,
    ]);
    expect(spread.smokeAt(at(1, 0))).toBe(Infinity); // シャッター
    expect(spread.smokeAt(at(0, 0))).toBe(0); // 火元の側はいつもどおり
  });

  it("煙の発生源のマスは燃えない（火元からの火が着く時刻は発生源の有無で変わらない）", () => {
    const rows = ["hhhhhh"];
    const without = computeSpread(makePlan(rows));
    const withSource = computeSpread(
      makePlan(rows, { spread: { extraSmokes: [{ cell: at(4, 0), atSeconds: 0 }] } }),
    );
    expect(withSource.fireSeconds).toEqual(without.fireSeconds);
    expect(withSource.fireAt(at(4, 0))).toBe(24);
    expect(withSource.smokeAt(at(4, 0))).toBe(0);
  });

  it("煙の発生源からの煙は壁（別の教室との間）・void・wall で止まる", () => {
    const spread = computeSpread(
      makePlan(["hh.h", "#h00", "1h00"], {
        fireOrigins: [at(3, 0)],
        spread: { extraSmokes: [{ cell: at(1, 0), atSeconds: 5 }] },
      }),
    );
    expect(spread.smokeAt(at(0, 0))).toBe(7);
    expect(spread.smokeAt(at(1, 2))).toBe(9);
    expect(spread.smokeAt(at(2, 0))).toBe(Infinity); // void
    expect(spread.smokeAt(at(0, 1))).toBe(Infinity); // wall
    expect(spread.smokeAt(at(2, 1))).toBe(Infinity); // 廊下と教室 0 の間の壁
    expect(spread.smokeAt(at(0, 2))).toBe(Infinity); // 廊下と教室 1 の間の壁
  });

  it("煙の発生源より先に火元からの煙が着くマスは，早いほうの時刻", () => {
    const spread = computeSpread(
      makePlan(["hhhh"], { spread: { extraSmokes: [{ cell: at(3, 0), atSeconds: 100 }] } }),
    );
    expect(spread.smokeAt(at(3, 0))).toBe(6);
    expect(spread.smokeAt(at(2, 0))).toBe(4);
  });

  it("煙の発生源がマス目の外・無い階を指していても例外を投げず，無視する", () => {
    const rows = ["hhh"];
    const spread = computeSpread(
      makePlan(rows, {
        spread: {
          extraSmokes: [
            { cell: at(9, 9), atSeconds: 0 },
            { cell: at(0, 0, 3), atSeconds: 0 },
          ],
        },
      }),
    );
    expect(spread.smokeSeconds).toEqual(computeSpread(makePlan(rows)).smokeSeconds);
  });

  it("煙の発生源の項目が無い（古いデータ）・空の時は，今までどおり燃えているマスからだけ煙が広がる", () => {
    const rows = ["hhhhh"];
    const empty = computeSpread(makePlan(rows, { spread: { extraSmokes: [] } }));
    const plan = makePlan(rows);
    expect(plan.drill.spread).not.toHaveProperty("extraSmokes");
    expect(computeSpread(plan).smokeSeconds).toEqual(empty.smokeSeconds);
    expect(empty.smokeSeconds[0]).toEqual([0, 2, 4, 6, 8]);
  });

  it("煙の発生源を含む校舎を URL に埋め込んで読み直しても，同じ広がりになる", async () => {
    const plan: SchoolPlan = {
      ...DEMO_SCHOOL,
      drill: {
        ...DEMO_SCHOOL.drill,
        spread: { ...DEMO_SCHOOL.drill.spread, extraSmokes: [{ cell: at(8, 6), atSeconds: 10 }] },
      },
    };
    const decoded = await decodePlan(await encodePlan(plan));
    expect(decoded.ok).toBe(true);
    if (!decoded.ok) return;
    const before = computeSpread(plan);
    const after = computeSpread(decoded.plan);
    expect(after.fireSeconds).toEqual(before.fireSeconds);
    expect(after.smokeSeconds).toEqual(before.smokeSeconds);
    // シャッターより西の廊下は，発生源が無ければ煙が来ない（発生源の煙が届いている）
    expect(computeSpread(DEMO_SCHOOL).smokeAt(at(4, 6))).toBe(Infinity);
    expect(after.smokeAt(at(4, 6))).toBe(18);
    expect(after.fireAt(at(4, 6))).toBe(Infinity);
  });

  it("煙が火より遅い設定でも，燃えているマスには遅くとも同じ時刻に煙がある", () => {
    const plan = makePlan(["hhhhhh", "hhhhhh", "hhhhhh"], {
      fireOrigins: [at(0, 0)],
      spread: {
        fireSecondsPerCell: 2,
        smokeSecondsPerCell: 6,
        extraFires: [{ cell: at(5, 2), atSeconds: 3 }],
      },
    });
    const spread = computeSpread(plan);
    const floor = plan.floors[0];
    for (let z = 0; z < floor.depth; z++) {
      for (let x = 0; x < floor.width; x++) {
        expect(spread.smokeAt(at(x, z))).toBeLessThanOrEqual(spread.fireAt(at(x, z)));
      }
    }
    expect(spread.fireAt(at(3, 0))).toBe(6);
    expect(spread.smokeAt(at(3, 0))).toBeLessThanOrEqual(6);
  });

  it("既定値（煙のほうが速い）では，どのマスも煙が火より先か同時に着く", () => {
    const spread = computeSpread(DEMO_SCHOOL);
    const floor = DEMO_SCHOOL.floors[0];
    for (let i = 0; i < floor.cells.length; i++) {
      expect(spread.smokeSeconds[0][i]).toBeLessThanOrEqual(spread.fireSeconds[0][i]);
    }
  });

  it("fireSeconds・smokeSeconds は階ごとの配列で，添字は z * width + x．fireAt・smokeAt と一致する", () => {
    const plan = makePlan(["hhh", "hhh"]);
    const spread = computeSpread(plan);
    expect(spread.fireSeconds).toHaveLength(1);
    expect(spread.smokeSeconds).toHaveLength(1);
    expect(spread.fireSeconds[0]).toHaveLength(6);
    for (let z = 0; z < 2; z++) {
      for (let x = 0; x < 3; x++) {
        expect(spread.fireSeconds[0][z * 3 + x]).toBe(spread.fireAt(at(x, z)));
        expect(spread.smokeSeconds[0][z * 3 + x]).toBe(spread.smokeAt(at(x, z)));
      }
    }
    expect(spread.fireSeconds[0][1 * 3 + 2]).toBe(18); // (2, 1)
  });

  it("fireAt・smokeAt はマス目の外・無い階では Infinity", () => {
    const spread = computeSpread(makePlan(["hh"]));
    for (const cell of [at(-1, 0), at(2, 0), at(0, -1), at(0, 1), at(0, 0, 1), at(0, 0, -1)]) {
      expect(spread.fireAt(cell)).toBe(Infinity);
      expect(spread.smokeAt(cell)).toBe(Infinity);
    }
  });

  it("火元が無ければどこにも着かない", () => {
    const spread = computeSpread(makePlan(["hhh"], { fireOrigins: [] }));
    expect(spread.fireSeconds[0].every((t) => t === Infinity)).toBe(true);
    expect(spread.smokeSeconds[0].every((t) => t === Infinity)).toBe(true);
  });

  it("火元が複数あれば，近いほうから着く", () => {
    const spread = computeSpread(makePlan(["hhhhh"], { fireOrigins: [at(0, 0), at(4, 0)] }));
    expect([0, 1, 2, 3, 4].map((x) => spread.fireAt(at(x, 0)))).toEqual([0, 6, 12, 6, 0]);
  });

  it("マス目の外・無い階の火元は無視して例外を投げない", () => {
    expect(() =>
      computeSpread(makePlan(["hh"], { fireOrigins: [at(5, 5), at(0, 0, 3)] })),
    ).not.toThrow();
    const spread = computeSpread(makePlan(["hh"], { fireOrigins: [at(5, 5)] }));
    expect(spread.fireAt(at(0, 0))).toBe(Infinity);
  });

  it.each([0, -3, Number.NaN])("1 マスの秒数が %d の時は 0 秒とみなして終わる", (seconds) => {
    const spread = computeSpread(
      makePlan(["hhhsh"], {
        spread: { fireSecondsPerCell: seconds, smokeSecondsPerCell: seconds },
      }),
    );
    for (const x of [0, 1, 2]) {
      expect(spread.fireAt(at(x, 0))).toBe(0);
      expect(spread.smokeAt(at(x, 0))).toBe(0);
    }
    expect(spread.fireAt(at(4, 0))).toBe(Infinity); // シャッターの先
  });

  it("同じ校舎からは毎回同じ結果になる（決定的）", () => {
    const a = computeSpread(DEMO_SCHOOL);
    const b = computeSpread(DEMO_SCHOOL);
    expect(a.fireSeconds).toEqual(b.fireSeconds);
    expect(a.smokeSeconds).toEqual(b.smokeSeconds);
  });

  describe("デモの校舎", () => {
    const spread = computeSpread(DEMO_SCHOOL);
    const floor = DEMO_SCHOOL.floors[0];

    it("火元 (16, 2) は 0 秒", () => {
      expect(spread.fireAt(at(16, 2))).toBe(0);
    });

    it("x = 12 の防火シャッターより西（x ≤ 12）には火も煙も届かない", () => {
      for (let z = 0; z < floor.depth; z++) {
        for (let x = 0; x <= 12; x++) {
          expect(spread.fireAt(at(x, z))).toBe(Infinity);
          expect(spread.smokeAt(at(x, z))).toBe(Infinity);
        }
      }
    });

    it("理科室の前の廊下と東の昇降口には届き，校庭には届かない", () => {
      expect(spread.fireAt(at(14, 6))).toBeLessThan(Infinity);
      expect(spread.fireAt(at(16, 7))).toBeLessThan(Infinity);
      for (let z = 8; z < floor.depth; z++) {
        for (let x = 0; x < floor.width; x++) {
          expect(spread.fireAt(at(x, z))).toBe(Infinity);
          expect(spread.smokeAt(at(x, z))).toBe(Infinity);
        }
      }
    });

    it("理科室のドア (14, 5) には，火元から壁を回り込まずにマスの数どおりの時刻で着く", () => {
      // (16,2) → (14,5) は上下左右に 5 マス
      expect(spread.fireAt(at(14, 5))).toBe(30);
      expect(spread.smokeAt(at(14, 5))).toBe(10);
    });
  });
});

describe("isNearFire", () => {
  // 中央 (2, 2) が火元．火は 1 マス 6 秒
  const spread = computeSpread(
    makePlan(["hhhhh", "hhhhh", "hhhhh", "hhhhh", "hhhhh"], { fireOrigins: [at(2, 2)] }),
  );

  it("燃えているマスそのものと，上下左右・斜めの 1 マス以内は近い", () => {
    for (const [x, z] of [
      [2, 2],
      [1, 2],
      [3, 2],
      [2, 1],
      [2, 3],
      [1, 1],
      [3, 3],
      [1, 3],
      [3, 1],
    ]) {
      expect(isNearFire(spread, at(x, z), 0)).toBe(true);
    }
  });

  it("2 マス離れると近くない", () => {
    expect(isNearFire(spread, at(0, 2), 0)).toBe(false);
    expect(isNearFire(spread, at(4, 4), 0)).toBe(false);
  });

  it("まだ燃えていないマスの近くは近くない（燃え始めた時刻から近い）", () => {
    // (0, 2) の隣 (1, 2) は 6 秒に燃える
    expect(isNearFire(spread, at(0, 2), 5.9)).toBe(false);
    expect(isNearFire(spread, at(0, 2), 6)).toBe(true);
  });

  it("範囲を広げられる", () => {
    expect(isNearFire(spread, at(0, 0), 0, 2)).toBe(true);
    expect(isNearFire(spread, at(0, 0), 0, 1)).toBe(false);
  });

  it("壁は見ない（壁の向こうの燃えているマスにも近い）", () => {
    const walled = computeSpread(makePlan(["0h"], { fireOrigins: [at(0, 0)] }));
    expect(walled.fireAt(at(1, 0))).toBe(Infinity);
    expect(isNearFire(walled, at(1, 0), 0)).toBe(true);
  });

  it("マス目の外の位置でも例外を投げず，外の側は燃えていないとみなす", () => {
    expect(isNearFire(spread, at(-5, -5), 100)).toBe(false);
    expect(isNearFire(spread, at(-1, 2), 100)).toBe(true); // (0, 2) が燃えている
  });

  it("別の階の火は見ない", () => {
    expect(isNearFire(spread, at(2, 2, 1), 100)).toBe(false);
  });
});
