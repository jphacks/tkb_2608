// 誤判定の場面の切り出しと，回帰テストの「期待する判定」との照合（experiment_山﨑/10「回帰テストへの切り出し」）
import { describe, expect, it } from "vitest";
import type { InputRecord, OrientationRecord } from "../recorder/records";
import { toJsonl } from "../recorder/records";
import { testParams } from "../testFixtures";
import {
  checkExpectations,
  clipRecords,
  rejudgeJsonl,
  summarizeWindow,
  type WindowExpectation,
} from "./regression";
import { rejudgeRecords } from "./rejudge";
import { parseRecordsJsonl } from "./replayLog";
import {
  clockRec,
  fakeResult,
  fakeSamples,
  labelRec,
  markRec,
  metaRec,
  motionRec,
  paramsRec,
  scenarioRecords,
  visibilityRec,
} from "./testRecords";

const P = testParams();

function orientationRec(t: number): OrientationRecord {
  return { type: "orientation", t, alpha: 0, beta: 0, gamma: 0, absolute: false };
}

describe("clipRecords", () => {
  const records: InputRecord[] = [
    metaRec({ t: 0 }),
    paramsRec(100, { stepHighStanding: 1 }),
    paramsRec(500, { stepHighStanding: 2 }),
    motionRec({ t: 900 }),
    motionRec({ t: 1000 }),
    labelRec({ t: 1100 }),
    markRec({ t: 1200 }),
    visibilityRec(1300),
    orientationRec(1350),
    clockRec({ t: 1400 }),
    { type: "state", t: 1450 } as unknown as InputRecord,
    motionRec({ t: 2000 }),
    motionRec({ t: 2100 }),
    paramsRec(3000, { stepHighStanding: 3 }),
  ];

  it("区間（両端を含む）の motion・visibility・label・mark と，文脈の meta・始まりまでで最後の params を残す", () => {
    expect(clipRecords(records, 1000, 2000)).toEqual([
      metaRec({ t: 0 }),
      paramsRec(500, { stepHighStanding: 2 }),
      motionRec({ t: 1000 }),
      labelRec({ t: 1100 }),
      markRec({ t: 1200 }),
      visibilityRec(1300),
      motionRec({ t: 2000 }),
    ]);
  });

  it("記録した時の判定の結果・時刻合わせは捨てる（今の判定で作り直す）", () => {
    const types = clipRecords(records, 0, 5000).map((r) => r.type);
    expect(types).not.toContain("state");
    expect(types).not.toContain("clock");
  });

  it("始まりちょうどの params も文脈として残す", () => {
    expect(clipRecords(records, 500, 600)).toEqual([
      metaRec({ t: 0 }),
      paramsRec(500, { stepHighStanding: 2 }),
    ]);
  });

  it("並びの順によらず時刻の順に切り出す", () => {
    const clipped = clipRecords([...records].reverse(), 900, 1000);
    expect(clipped.map((r) => r.t)).toEqual([0, 500, 900, 1000]);
  });

  it("始まりと終わりが同じ時刻なら，その時刻のものだけ", () => {
    expect(clipRecords([motionRec({ t: 1 }), motionRec({ t: 2 })], 2, 2)).toEqual([
      motionRec({ t: 2 }),
    ]);
  });

  it.each([
    [2000, 1000],
    [Number.NaN, 1000],
    [0, Number.NaN],
    [Number.NEGATIVE_INFINITY, 1000],
    [0, Number.POSITIVE_INFINITY],
  ])("区間が逆向き・数でない（%s〜%s）なら空", (from, to) => {
    expect(clipRecords(records, from, to)).toEqual([]);
  });

  it("記録が空なら空", () => {
    expect(clipRecords([], 0, 1000)).toEqual([]);
  });

  it("切り出して JSONL にした記録を読み直すと同じ判定になる", () => {
    const all = scenarioRecords();
    const clipped = clipRecords(all, 0, 6000);
    const text = toJsonl(clipped);
    const parsed = parseRecordsJsonl(text);
    expect(parsed.skipped).toBe(0);
    expect(rejudgeRecords(parsed.records, P)).toEqual(rejudgeRecords(clipped, P));
  });
});

describe("summarizeWindow", () => {
  const r = fakeResult(
    fakeSamples(0, 1000, 100, (t) => ({
      walking: t >= 200 && t < 500,
      posture: t >= 700 ? "crouching" : "standing",
    })),
    [250, 450, 900],
  );

  it("区間の歩・歩き始め・歩いた時間・姿勢の切り替わり・しゃがんだ時間をまとめる", () => {
    expect(summarizeWindow(r, 0, 1000)).toEqual({
      steps: 3,
      walkOnsets: 1,
      walkingMs: 300,
      postureChanges: 1,
      crouchingMs: 300,
      samples: 11,
      postures: ["standing", "crouching"],
    });
  });

  it("区間の両端を含む", () => {
    expect(summarizeWindow(r, 250, 450).steps).toBe(2);
    expect(summarizeWindow(r, 200, 200).samples).toBe(1);
  });

  it("区間の始まりで既に歩いていた分は歩き始めに数えない", () => {
    expect(summarizeWindow(r, 300, 1000).walkOnsets).toBe(0);
  });

  it.each([
    [2000, 3000],
    [500, 400],
    [Number.NaN, 1000],
    [0, Number.NaN],
  ])("区間にサンプルが無い・区間が数でない（%s〜%s）なら 0", (from, to) => {
    expect(summarizeWindow(r, from, to)).toMatchObject({
      samples: 0,
      steps: 0,
      walkingMs: 0,
      postures: [],
    });
  });
});

describe("checkExpectations", () => {
  const r = fakeResult(
    fakeSamples(0, 3000, 100, (t) => ({
      walking: t >= 1000 && t < 2000,
      posture: t >= 2500 ? "crouching" : "standing",
    })),
    [1100, 1600],
  );

  function exp(o: Partial<WindowExpectation> = {}): WindowExpectation {
    return { note: "場面", fromT: 0, toT: 3000, ...o };
  }

  it("期待どおりなら空", () => {
    expect(
      checkExpectations(r, [
        exp({ fromT: 0, toT: 900, walking: "never", steps: { max: 0 }, posture: "standing" }),
        exp({ fromT: 900, toT: 2000, walking: "some", steps: { min: 2, max: 2 } }),
        exp({ fromT: 0, toT: 3000, walkOnsets: { min: 1, max: 1 }, postureChanges: { max: 1 } }),
        exp({ fromT: 2500, toT: 3000, posture: "crouching" }),
      ]),
    ).toEqual([]);
  });

  it("期待が無ければ空", () => {
    expect(checkExpectations(r, [])).toEqual([]);
    expect(checkExpectations(r, [exp()])).toEqual([]);
  });

  it("数の範囲は両端を含む", () => {
    expect(checkExpectations(r, [exp({ steps: { min: 2, max: 2 } })])).toEqual([]);
  });

  it.each([
    ["歩の数が少ない", exp({ steps: { min: 3 } }), "歩の数"],
    ["歩の数が多い", exp({ steps: { max: 1 } }), "歩の数"],
    ["歩き始めが多い", exp({ walkOnsets: { max: 0 } }), "歩き始めの回数"],
    ["切り替わりが少ない", exp({ postureChanges: { min: 2 } }), "姿勢の切り替わりの回数"],
    ["歩かないはずが歩いた", exp({ walking: "never" }), "歩かないはず"],
    ["歩くはずが歩かない", exp({ fromT: 0, toT: 900, walking: "some" }), "歩くはず"],
    ["姿勢が変わった", exp({ posture: "standing" }), "standing のはず"],
  ])("外れ（%s）は区間と注記を付けて返す", (_, e, word) => {
    const failures = checkExpectations(r, [e]);
    expect(failures).toHaveLength(1);
    expect(failures[0]).toContain(e.note);
    expect(failures[0]).toContain(`${e.fromT}〜${e.toT}`);
    expect(failures[0]).toContain(word);
  });

  it("1 つの期待で複数外れたら，すべて返す", () => {
    expect(
      checkExpectations(r, [exp({ steps: { max: 0 }, walking: "never", posture: "crouching" })]),
    ).toHaveLength(3);
  });

  it("区間にサンプルが無い期待は切り出しの誤りとして外れにする", () => {
    const failures = checkExpectations(r, [exp({ note: "外", fromT: 5000, toT: 6000 })]);
    expect(failures).toHaveLength(1);
    expect(failures[0]).toContain("サンプルが無い");
  });

  it.each([
    [Number.NaN, 3000],
    [0, Number.NaN],
  ])("区間が数でない（%s〜%s）期待は，記録の全体を見ずに外れにする", (fromT, toT) => {
    expect(checkExpectations(r, [exp({ fromT, toT })])).toHaveLength(1);
  });
});

describe("rejudgeJsonl", () => {
  it("JSONL を読んで判定し直し，読めなかった行の数を返す", () => {
    const records = scenarioRecords();
    const text = `${toJsonl(records)}broken\n{"type":"nope","t":1}\n`;
    const { result, skipped } = rejudgeJsonl(text, P);
    expect(skipped).toBe(2);
    expect(result).toEqual(rejudgeRecords(records, P));
  });

  it("空の文字列なら空の結果", () => {
    const { result, skipped } = rejudgeJsonl("", P);
    expect(skipped).toBe(0);
    expect(result.timeline.t).toEqual([]);
  });

  it("合成の記録で期待（静止で歩かない・足踏みで歩く・しゃがんだら保つ）を満たす", () => {
    const { result } = rejudgeJsonl(toJsonl(scenarioRecords()), P);
    expect(
      checkExpectations(result, [
        { note: "静止", fromT: 0, toT: 2000, walking: "never", steps: { max: 0 } },
        { note: "足踏みの動き出し", fromT: 2000, toT: 2500, walking: "some" },
        { note: "しゃがみの確定", fromT: 9000, toT: 11000, posture: "crouching" },
      ]),
    ).toEqual([]);
  });
});
