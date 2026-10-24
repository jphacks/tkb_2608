// 正解付きの記録の集計（evaluate.ts）を小さな合成の記録で確かめる．目安は SPEC_01「判定の安定性」
import { describe, expect, it } from "vitest";
import type { CueRecord, InputRecord } from "../recorder/records";
import { testParams } from "../testFixtures";
import {
  DEFAULT_EVALUATE_OPTIONS,
  evaluateRecording,
  evaluateSegment,
  oracleStepsIn,
  overallStats,
  SEGMENT_KIND_BY_LABEL,
  type SegmentMetrics,
  SPEC_STABILITY_TARGETS,
  summarizeSegments,
} from "./evaluate";
import { parseRecording, segmentsOf } from "./parseRecording";
import { replayBody } from "./replayBody";
import { crouchRecords, labelPair, labelRec, restRecords, steppingRecords } from "./testRecords";

const P = testParams();

function cueRec(t: number, cue: string, index: number, segment: number): CueRecord {
  return { type: "cue", t, plannedT: t, cue, index, label: "squat_stand", segment };
}

function parse(records: readonly InputRecord[]) {
  return parseRecording(records.map((r) => JSON.stringify(r)).join("\n"));
}

/**
 * 静止 0〜3000（still）→ 足踏み 3000〜6000（step_in_place）→ 静止 → しゃがむ・立つ 8000〜14000（合図 8000・11000）
 * → しゃがんで静止 14000〜16000（crouch_still．立ち上がりの後なので立った姿勢で始まる）
 */
function scenario(): InputRecord[] {
  return [
    ...labelPair("still", 0, 0, 3000),
    ...labelPair("step_in_place", 1, 3000, 6000),
    ...labelPair("squat_stand", 2, 8000, 14000),
    cueRec(8000, "crouch", 0, 2),
    cueRec(11000, "stand", 1, 2),
    ...restRecords(0, 3000),
    ...steppingRecords(3000, 3000),
    ...restRecords(6000, 2200),
    ...crouchRecords(8200, 704, 0.4),
    ...restRecords(8904, 2296),
    ...crouchRecords(11200, 704, -0.4),
    ...restRecords(11904, 4096),
  ];
}

describe("SPEC_STABILITY_TARGETS", () => {
  it("SPEC_01「判定の安定性」の目安と同じ（誤検出 0 回・10 回のうち 9 回・足踏み 0.5 秒・しゃがみ 1 秒）", () => {
    expect(SPEC_STABILITY_TARGETS).toEqual({
      maxFalseWalks: 0,
      minStepDetectionRate: 0.9,
      maxStepOnsetMs: 500,
      minPostureDetectionRate: 0.9,
      maxPostureLatencyMs: 1000,
      maxCrouchFalseStands: 0,
    });
  });

  it("手順のラベルはすべて区間の種類に対応する", () => {
    expect(Object.keys(SEGMENT_KIND_BY_LABEL).sort()).toEqual(
      [
        "crouch_still",
        "crouch_walk",
        "look_around",
        "nod",
        "squat_stand",
        "step_in_place",
        "still",
      ].sort(),
    );
  });
});

describe("evaluateRecording（合成の記録）", () => {
  const ev = evaluateRecording(parse(scenario()), P);
  const byLabel = (label: string) => ev.segments.find((s) => s.label === label) as SegmentMetrics;

  it("区間を切り出し，種類を付ける", () => {
    expect(ev.segments.map((s) => [s.label, s.kind, s.complete])).toEqual([
      ["still", "standing-still", true],
      ["step_in_place", "step", true],
      ["squat_stand", "squat", true],
    ]);
  });

  it("静止の区間: 歩き出し 0 回・姿勢の誤検出 0 回で目安を満たす", () => {
    const s = byLabel("still");
    expect(s.walkStarts).toBe(0);
    expect(s.toCrouching).toBe(0);
    expect(s.checks.every((c) => c.pass === true)).toBe(true);
  });

  it("足踏みの区間: 検出率 90% 以上・動き出し 500 ms 以内・止める合図の後に止まる", () => {
    const s = byLabel("step_in_place");
    expect(s.oracleSteps).toBeGreaterThanOrEqual(5);
    expect(s.stepDetectionRate).toBeGreaterThanOrEqual(0.9);
    expect(s.onsetFromMotionMs).not.toBeNull();
    expect(s.onsetFromMotionMs as number).toBeLessThanOrEqual(500);
    expect(s.dropouts).toBe(0);
    expect(s.stopDelayMs).not.toBeNull();
    expect(s.checks.map((c) => c.pass)).toEqual([true, true]);
  });

  it("しゃがむ・立つの区間: 合図ごとに切り替えを見つけ，動作の始まりから 1 秒以内", () => {
    const s = byLabel("squat_stand");
    expect(s.cueOutcomes.map((o) => o.cue)).toEqual(["crouch", "stand"]);
    for (const o of s.cueOutcomes) {
      expect(o.changeT).not.toBeNull();
      expect(o.latencyFromMotionMs).not.toBeNull();
      expect(o.latencyFromMotionMs as number).toBeLessThanOrEqual(1000);
      expect(o.latencyFromCueMs as number).toBeGreaterThanOrEqual(o.latencyFromMotionMs as number);
    }
    expect(s.postureDetectionRate).toBe(1);
    expect(s.postureWrongChanges).toBe(0);
  });

  it("全体の集計: 判定できる目安をすべて満たし，しゃがみ歩き等の無い指標は null（判定しない）", () => {
    expect(ev.summary.falseWalks).toBe(0);
    expect(ev.summary.postureDetectionRate).toBe(1);
    expect(ev.summary.crouchFalseStands).toBeNull();
    expect(ev.summary.crouchWalkDetectionRate).toBeNull();
    expect(ev.summary.checks.filter((c) => c.pass === false)).toEqual([]);
    expect(ev.summary.pass).toBe(true);
  });

  it("全体の数（overall）", () => {
    expect(ev.overall.samples).toBe(ev.timeline.t.length);
    expect(ev.overall.walkStarts).toBe(1);
    expect(ev.overall.postureChanges).toBe(2);
    expect(ev.overall.durationSec).toBeCloseTo(16, 0);
  });
});

describe("合否の判定", () => {
  it("静止の区間で歩くと，その区間と全体の目安に届かない", () => {
    // 「still」とラベルを付けた区間で足踏みをする
    const rec = parse([
      ...labelPair("still", 0, 1000, 4000),
      ...restRecords(0, 1000),
      ...steppingRecords(1000, 3000),
      ...restRecords(4000, 2000),
    ]);
    const ev = evaluateRecording(rec, P);
    expect(ev.segments[0].walkStarts).toBeGreaterThanOrEqual(1);
    expect(ev.segments[0].checks[0].pass).toBe(false);
    expect(ev.summary.falseWalks).toBeGreaterThanOrEqual(1);
    expect(ev.summary.pass).toBe(false);
  });

  it("合図に合う切り替えが無ければ見逃し（changeT null）として検出率を下げる", () => {
    const rec = parse([
      ...labelPair("squat_stand", 0, 1000, 6000),
      cueRec(2000, "crouch", 0, 0),
      cueRec(4000, "stand", 1, 0),
      ...restRecords(0, 7000),
    ]);
    const ev = evaluateRecording(rec, P);
    expect(ev.segments[0].cueOutcomes.map((o) => o.changeT)).toEqual([null, null]);
    expect(ev.segments[0].postureDetectionRate).toBe(0);
    expect(ev.summary.postureDetectionRate).toBe(0);
    expect(ev.summary.postureLatencyMaxMs).toBeNull();
    expect(ev.summary.pass).toBe(false);
  });

  it("合図の無いしゃがむ・立つの区間は，向きごとの切り替えの数を期待する回数と比べる", () => {
    const rec = parse([
      ...labelPair("squat_stand", 0, 1000, 5000),
      ...restRecords(0, 1200),
      ...crouchRecords(1200, 704),
      ...restRecords(1904, 1296),
      ...crouchRecords(3200, 704, -0.4),
      ...restRecords(3904, 2096),
    ]);
    const ev = evaluateRecording(rec, P, { ...DEFAULT_EVALUATE_OPTIONS, squatRepsWithoutCues: 2 });
    expect(ev.segments[0].cueOutcomes).toEqual([]);
    expect(ev.segments[0].postureDetectionRate).toBe(0.5);
  });

  it("しゃがんで静止の区間が立った姿勢で始まったら，立った 1 回と数える", () => {
    const rec = parse([...labelPair("crouch_still", 0, 1000, 3000), ...restRecords(0, 4000)]);
    const ev = evaluateRecording(rec, P);
    expect(ev.segments[0].postureAtStart).toBe("standing");
    expect(ev.summary.crouchFalseStands).toBe(1);
    expect(ev.summary.pass).toBe(false);
  });
});

describe("途中で終わった区間", () => {
  it("途中で終わった区間（終わりのラベルが無い）は区間の表には出すが，全体の合否に使わない", () => {
    const rec = parse([
      ...labelPair("still", 0, 0, 2000),
      // 再読み込みで途切れた静止の区間で歩いている（集計に入れば誤検出になる）
      labelRec({ label: "look_around", segment: 1, t: 2000, edge: "start" }),
      ...restRecords(0, 2000),
      ...steppingRecords(2000, 3000),
    ]);
    const ev = evaluateRecording(rec, P);
    expect(ev.segments.map((s) => [s.label, s.complete])).toEqual([
      ["still", true],
      ["look_around", false],
    ]);
    expect(ev.segments[1].walkStarts).toBeGreaterThanOrEqual(1);
    expect(ev.summary.falseWalks).toBe(0);
    expect(ev.summary.pass).toBe(true);
  });

  it("完了した区間が無ければ全体の値はすべて null で，合否も null", () => {
    const rec = parse([labelRec({ label: "still", segment: 0, t: 0 }), ...restRecords(0, 2000)]);
    const ev = evaluateRecording(rec, P);
    expect(ev.segments).toHaveLength(1);
    expect(ev.summary.checks.every((c) => c.pass === null)).toBe(true);
    expect(ev.summary.pass).toBeNull();
  });
});

describe("ラベルの無い記録", () => {
  it("区間は空，全体の値は null で，overall だけを出す", () => {
    const ev = evaluateRecording(
      parse([...restRecords(0, 1000), ...steppingRecords(1000, 3000)]),
      P,
    );
    expect(ev.segments).toEqual([]);
    expect(ev.summary.pass).toBeNull();
    expect(ev.overall.steps).toBeGreaterThan(0);
    expect(ev.overall.walkStarts).toBe(1);
  });
});

describe("summarizeSegments", () => {
  it("区間が無ければ値はすべて null", () => {
    const s = summarizeSegments([]);
    expect(s.falseWalks).toBeNull();
    expect(s.stepDetectionRate).toBeNull();
    expect(s.postureDetectionRate).toBeNull();
    expect(s.pass).toBeNull();
  });
});

describe("oracleStepsIn", () => {
  it("帯域通過後の値のシュミットトリガで本当の歩の目安を数える（区間の外は数えない）", () => {
    const tl = replayBody(
      parse([...restRecords(0, 1000), ...steppingRecords(1000, 3000)]).motions,
      P,
    );
    const all = oracleStepsIn(tl, 1000, 4000, 0.6, 0.15, 250);
    expect(all.length).toBeGreaterThanOrEqual(5);
    expect(all.length).toBeLessThanOrEqual(7);
    expect(all.every((t) => t >= 1000 && t < 4000)).toBe(true);
    expect(oracleStepsIn(tl, 0, 1000, 0.6, 0.15, 250)).toEqual([]);
  });
});

describe("evaluateSegment", () => {
  it("知らないラベルの区間は種類 null で，目安と照らさない", () => {
    const rec = parse([...labelPair("unknown", 0, 0, 1000), ...restRecords(0, 2000)]);
    const tl = replayBody(rec.motions, P);
    const m = evaluateSegment(tl, segmentsOf(rec)[0]);
    expect(m.kind).toBeNull();
    expect(m.checks).toEqual([]);
  });

  it("overallStats は空の時系列でも 0 を返す", () => {
    const o = overallStats(replayBody([], P));
    expect(o).toMatchObject({ durationSec: 0, samples: 0, steps: 0, walkingSec: 0 });
  });
});
