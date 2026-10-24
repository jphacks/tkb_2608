// 判定し直した結果を，手順のラベルと印に照らして SPEC の指標にまとめる（SPEC_01「判定の安定性」・experiment_山﨑/11「指標」）．
// 判定そのものではなく集計を確かめるため，判定し直した結果は fakeResult で直接作る
import { describe, expect, it } from "vitest";
import { DEFAULT_PROTOCOL_STEPS } from "../recorder/protocolSchedule";
import { testParams } from "../testFixtures";
import {
  compareMetricRow,
  computeMetrics,
  LABEL_EXPECTATIONS,
  type MetricRow,
  metricRows,
  POSTURE_GRACE_MS,
  WALK_LATENCY_TARGET_MS,
} from "./metrics";
import { rejudgeRecords } from "./rejudge";
import { type LabelSegment, labelSegments } from "./replayLog";
import { fakeResult, fakeSamples, markRec, scenarioRecords } from "./testRecords";

function seg(o: Partial<LabelSegment> = {}): LabelSegment {
  return { label: "still", segment: 0, repeat: 1, startT: 0, endT: 1000, ...o };
}

describe("LABEL_EXPECTATIONS", () => {
  it("手順の記録ページのラベルすべてに期待がある", () => {
    for (const step of DEFAULT_PROTOCOL_STEPS) {
      expect(LABEL_EXPECTATIONS[step.label], step.label).toBeDefined();
    }
  });

  it.each([
    ["still", false, "standing"],
    ["look_around", false, "standing"],
    ["nod", false, "standing"],
    ["step_in_place", true, "standing"],
    ["squat_stand", false, null],
    ["crouch_walk", true, "crouching"],
    ["crouch_still", false, "crouching"],
  ])("%s: 歩く %s・保つ姿勢 %s（experiment_山﨑/11 の手順）", (label, walk, posture) => {
    expect(LABEL_EXPECTATIONS[label]).toMatchObject({ walk, posture });
  });

  it("しゃがむ・立つを 10 回の区間は切り替わり 20 回を期待する", () => {
    expect(LABEL_EXPECTATIONS.squat_stand.postureChanges).toBe(20);
  });

  it("目安: 足踏みの動き出しは 0.5 秒・姿勢の猶予は 1 秒", () => {
    expect(WALK_LATENCY_TARGET_MS).toBe(500);
    expect(POSTURE_GRACE_MS).toBe(1000);
  });
});

describe("computeMetrics", () => {
  it("区間が無ければ数は 0・遅れは null", () => {
    const m = computeMetrics(fakeResult(fakeSamples(0, 1000, 100)), []);
    expect(m).toMatchObject({
      segments: [],
      falseWalks: 0,
      falsePostureChanges: 0,
      walkSegments: 0,
      walkMissed: 0,
      walkLatencyMeanMs: null,
      walkLatencyMaxMs: null,
      walkLatencyOver: 0,
      postureChangesExpected: 0,
      postureChangesDetected: 0,
      marks: {},
    });
  });

  it("判定の結果が空でも例外を投げない", () => {
    const m = computeMetrics(fakeResult([]), [seg(), seg({ label: "step_in_place" })]);
    expect(m.falseWalks).toBe(0);
    expect(m.walkMissed).toBe(1);
  });

  it("歩かない区間で歩き始めた回数を誤検出として数える", () => {
    const walkingAt = (t: number) => (t >= 300 && t < 500) || (t >= 700 && t < 800);
    const r = fakeResult(fakeSamples(0, 1000, 100, (t) => ({ walking: walkingAt(t) })));
    const m = computeMetrics(r, [seg({ label: "still", startT: 0, endT: 1000 })]);
    expect(m.falseWalks).toBe(2);
    expect(m.segments[0].walkOnsets).toBe(2);
  });

  it("区間の始まりで既に歩いていた分は歩き始めに数えない", () => {
    const r = fakeResult(fakeSamples(0, 1000, 100, (t) => ({ walking: t < 300 })));
    const m = computeMetrics(r, [seg({ label: "still", startT: 0, endT: 1000 })]);
    expect(m.falseWalks).toBe(0);
  });

  it("区間の外で歩き始めても数えない（区間の両端は含む）", () => {
    const r = fakeResult(
      fakeSamples(0, 2000, 100, (t) => ({ walking: (t >= 1500 && t < 1700) || t === 1000 })),
    );
    // 900 → 1000 で歩き始める（区間の終わりちょうど）は数え，1500 は区間の外
    const m = computeMetrics(r, [seg({ startT: 0, endT: 1000 })]);
    expect(m.falseWalks).toBe(1);
  });

  it("歩く区間: 始まりから最初に歩くまでを遅れとし，平均・最大・目安を超えた数を出す", () => {
    const r = fakeResult(
      fakeSamples(0, 4000, 100, (t) => ({
        walking: (t >= 300 && t < 1000) || (t >= 2600 && t < 3000),
      })),
    );
    const m = computeMetrics(r, [
      seg({ label: "step_in_place", startT: 0, endT: 1000 }),
      seg({ label: "step_in_place", segment: 1, startT: 2000, endT: 3000 }),
    ]);
    expect(m.walkSegments).toBe(2);
    expect(m.walkMissed).toBe(0);
    expect(m.segments.map((s) => s.walkLatencyMs)).toEqual([300, 600]);
    expect(m.walkLatencyMeanMs).toBe(450);
    expect(m.walkLatencyMaxMs).toBe(600);
    expect(m.walkLatencyOver).toBe(1);
  });

  it("遅れがちょうど 500 ms は目安を超えない", () => {
    const r = fakeResult(fakeSamples(0, 1000, 100, (t) => ({ walking: t >= 500 })));
    const m = computeMetrics(r, [seg({ label: "step_in_place" })]);
    expect(m.walkLatencyMaxMs).toBe(500);
    expect(m.walkLatencyOver).toBe(0);
  });

  it("歩く区間で一度も歩かなければ見逃し（遅れは null）", () => {
    const r = fakeResult(fakeSamples(0, 1000, 100));
    const m = computeMetrics(r, [seg({ label: "step_in_place" })]);
    expect(m.walkMissed).toBe(1);
    expect(m.segments[0].walkLatencyMs).toBeNull();
    expect(m.walkLatencyMeanMs).toBeNull();
  });

  it("姿勢を保つ区間: 始まりから 1 秒の間の切り替わりは誤検出に数えない", () => {
    // crouch_still の合図でしゃがむ（999 ms）は正しい動き
    const r = fakeResult(
      fakeSamples(0, 5000, 1, (t) => ({ posture: t >= 999 ? "crouching" : "standing" })),
    );
    const m = computeMetrics(r, [seg({ label: "crouch_still", startT: 0, endT: 5000 })]);
    expect(m.falsePostureChanges).toBe(0);
    expect(m.segments[0].postureChanges).toBe(1);
  });

  it("姿勢を保つ区間: 猶予のちょうど後（1000 ms）の切り替わりは誤検出に数える", () => {
    const r = fakeResult(
      fakeSamples(0, 5000, 100, (t) => ({ posture: t >= 1000 ? "crouching" : "standing" })),
    );
    const m = computeMetrics(r, [seg({ label: "still", startT: 0, endT: 5000 })]);
    expect(m.falsePostureChanges).toBe(1);
  });

  it("しゃがんだまま 30 秒の区間で立ち上がると誤検出とし，違う姿勢だった時間を出す", () => {
    const r = fakeResult(
      fakeSamples(0, 5000, 100, (t) => ({
        posture: t >= 2000 && t < 3000 ? "standing" : "crouching",
      })),
    );
    const m = computeMetrics(r, [seg({ label: "crouch_still", startT: 0, endT: 5000 })]);
    expect(m.falsePostureChanges).toBe(2);
    expect(m.segments[0].wrongPostureMs).toBe(1000);
  });

  it("区間の後の姿勢の切り替わりは数えない", () => {
    const r = fakeResult(
      fakeSamples(0, 5000, 100, (t) => ({ posture: t >= 3000 ? "crouching" : "standing" })),
    );
    const m = computeMetrics(r, [seg({ label: "still", startT: 0, endT: 2900 })]);
    expect(m.falsePostureChanges).toBe(0);
  });

  it("しゃがむ・立つの区間は姿勢の誤検出に数えず，切り替わりの期待と判定の回数を出す", () => {
    const r = fakeResult(
      fakeSamples(0, 10000, 100, (t) => ({
        posture: Math.floor(t / 1000) % 2 === 1 ? "crouching" : "standing",
      })),
    );
    const m = computeMetrics(r, [seg({ label: "squat_stand", startT: 0, endT: 10000 })]);
    expect(m.falsePostureChanges).toBe(0);
    expect(m.postureChangesExpected).toBe(20);
    expect(m.postureChangesDetected).toBe(10);
  });

  it("知らないラベルの区間は期待が null で，指標に入れない", () => {
    const r = fakeResult(fakeSamples(0, 1000, 100, (t) => ({ walking: t >= 500 })));
    const m = computeMetrics(r, [seg({ label: "unknown_label" })]);
    expect(m.segments[0].expectation).toBeNull();
    expect(m.falseWalks).toBe(0);
    expect(m.walkSegments).toBe(0);
  });

  it("区間の中の歩を数え，全体の歩・歩き始め・姿勢の切り替わりも出す", () => {
    const r = fakeResult(
      fakeSamples(0, 3000, 100, (t) => ({
        walking: t >= 500 && t < 1500,
        posture: t >= 2500 ? "crouching" : "standing",
      })),
      [600, 1000, 1400, 2000],
    );
    const m = computeMetrics(r, [seg({ label: "step_in_place", startT: 0, endT: 1000 })]);
    expect(m.segments[0].steps).toBe(2);
    expect(m.totalSteps).toBe(4);
    expect(m.totalWalkOnsets).toBe(1);
    expect(m.totalPostureChanges).toBe(1);
  });

  it("印を種類ごとに数える", () => {
    const m = computeMetrics(
      fakeResult([]),
      [],
      [
        markRec({ kind: "false-walk" }),
        markRec({ kind: "false-walk" }),
        markRec({ kind: "other" }),
      ],
    );
    expect(m.marks).toEqual({ "false-walk": 2, other: 1 });
  });

  it("合成の記録（静止・足踏み・しゃがむ）では誤検出・見逃しが無く，遅れは目安以内", () => {
    const records = scenarioRecords();
    const m = computeMetrics(rejudgeRecords(records, testParams()), labelSegments(records));
    expect(m.falseWalks).toBe(0);
    expect(m.falsePostureChanges).toBe(0);
    expect(m.walkSegments).toBe(1);
    expect(m.walkMissed).toBe(0);
    expect(m.walkLatencyOver).toBe(0);
  });
});

describe("metricRows", () => {
  it("前と後の指標を同じ順の行にする", () => {
    const before = computeMetrics(
      fakeResult(fakeSamples(0, 1000, 100, (t) => ({ walking: t >= 300 && t < 500 }))),
      [seg()],
    );
    const after = computeMetrics(fakeResult(fakeSamples(0, 1000, 100)), [seg()]);
    const rows = metricRows(before, after);
    expect(rows).toHaveLength(12);
    expect(rows[0]).toMatchObject({ before: 1, after: 0, lowerIsBetter: true });
    expect(rows.find((r) => r.name.includes("動き出しの遅れ 平均"))).toMatchObject({
      before: null,
      after: null,
    });
    expect(new Set(rows.map((r) => r.name)).size).toBe(rows.length);
  });
});

describe("compareMetricRow", () => {
  function row(o: Partial<MetricRow> = {}): MetricRow {
    return { name: "x", before: 2, after: 1, lowerIsBetter: true, ...o };
  }

  it.each([
    [row(), 1],
    [row({ before: 1, after: 2 }), -1],
    [row({ lowerIsBetter: false }), -1],
    [row({ lowerIsBetter: false, before: 1, after: 2 }), 1],
    [row({ before: 1, after: 1 }), 0],
    [row({ lowerIsBetter: null }), 0],
    [row({ before: null }), 0],
    [row({ after: null }), 0],
    [row({ before: Number.NaN }), 0],
    [row({ after: Number.POSITIVE_INFINITY }), 0],
  ])("%o → %i", (r, expected) => {
    expect(compareMetricRow(r)).toBe(expected);
  });
});
