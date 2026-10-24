// 記録（JSONL）の読み込みと手順の区間の取り出し（parseRecording.ts）を小さな合成の記録で確かめる
import { describe, expect, it } from "vitest";
import type { CueRecord, InputRecord, ProtocolRecord } from "../recorder/records";
import {
  hasCompleteSegments,
  hasProtocolLabels,
  motionSampleOf,
  parseRecording,
  segmentsOf,
} from "./parseRecording";
import {
  labelPair,
  labelRec,
  markRec,
  metaRec,
  motionRec,
  paramsRec,
  restRecords,
  visibilityRec,
} from "./testRecords";

function jsonl(records: readonly unknown[]): string {
  return records.map((r) => JSON.stringify(r)).join("\n");
}

function cueRec(o: Partial<CueRecord> = {}): CueRecord {
  return {
    type: "cue",
    t: 0,
    plannedT: o.t ?? 0,
    cue: "crouch",
    index: 0,
    label: "squat_stand",
    segment: 0,
    ...o,
  };
}

function protocolRec(o: Partial<ProtocolRecord> = {}): ProtocolRecord {
  return { type: "protocol", t: 0, t0: 0, prepMs: 0, segments: [], ...o };
}

const parse = (records: readonly InputRecord[]) => parseRecording(jsonl(records));

describe("parseRecording", () => {
  it("motion の配列を MotionSample にする（rot は alpha・beta・gamma の順）", () => {
    const r = parse([
      motionRec({ t: 10, acc: [1, 2, 3], accG: [4, 5, 6], rot: [7, 8, 9], interval: 16 }),
    ]);
    expect(r.motions).toEqual([
      {
        t: 10,
        acc: { x: 1, y: 2, z: 3 },
        accG: { x: 4, y: 5, z: 6 },
        rot: { alpha: 7, beta: 8, gamma: 9 },
        interval: 16,
      },
    ]);
    expect(r.badLines).toBe(0);
  });

  it("種類ごとに分け，meta・protocol・params は最初の 1 つだけを使う", () => {
    const r = parse([
      metaRec({ t: 1, sessionId: "a" }),
      metaRec({ t: 2, sessionId: "b" }),
      protocolRec({ t: 3, t0: 100 }),
      protocolRec({ t: 4, t0: 200 }),
      paramsRec(5, { stepHighStanding: 1.5 }),
      paramsRec(6, { stepHighStanding: 9 }),
      labelRec({ t: 7 }),
      cueRec({ t: 8 }),
      markRec({ t: 9, kind: "walk_false", note: "x" }),
      visibilityRec(10),
    ]);
    expect(r.meta?.sessionId).toBe("a");
    expect(r.protocol?.t0).toBe(100);
    expect(r.params).toEqual({ stepHighStanding: 1.5 });
    expect(r.labels).toHaveLength(1);
    expect(r.cues).toEqual([cueRec({ t: 8 })]);
    expect(r.marks).toEqual([{ type: "mark", t: 9, kind: "walk_false", note: "x" }]);
    expect(r.visibility).toEqual([{ type: "visibility", t: 10, state: "hidden" }]);
    expect(r.badLines).toBe(0);
  });

  it("params の有限でない値は落とす", () => {
    const r = parseRecording('{"type":"params","t":0,"params":{"a":1,"b":"2","c":null}}');
    expect(r.params).toEqual({ a: 1 });
  });

  it("壊れた行（JSON でない・オブジェクトでない・形が合わない motion・label・cue）を数えて飛ばす", () => {
    const text = [
      "not json",
      "[1,2,3]",
      "42",
      JSON.stringify({ type: "motion", acc: [0, 0, 0] }),
      JSON.stringify({ type: "motion", t: 1, acc: null, accG: [1, 2], rot: "x" }),
      JSON.stringify({ type: "label", t: 1, label: "still", edge: "middle", segment: 0 }),
      JSON.stringify({ type: "cue", t: 1, cue: "crouch" }),
      JSON.stringify(motionRec({ t: 5 })),
    ].join("\n");
    const r = parseRecording(text);
    expect(r.badLines).toBe(7);
    expect(r.motions.map((m) => m.t)).toEqual([5]);
  });

  it("空行と知らない種類の行（detect・state 等）は数えずに飛ばす", () => {
    const text = `\n\n${JSON.stringify({ type: "detect", t: 1 })}\n  \n${JSON.stringify({ type: "unknown" })}\n`;
    const r = parseRecording(text);
    expect(r.badLines).toBe(0);
    expect(r.motions).toEqual([]);
  });

  it("label・cue の省略できる項目は既定値で補う（plannedT は t，repeat は 1，index は 0）", () => {
    const r = parseRecording(
      [
        JSON.stringify({ type: "label", t: 5, label: "still", edge: "start", segment: 0 }),
        JSON.stringify({ type: "cue", t: 6, cue: "stand", segment: 2 }),
      ].join("\n"),
    );
    expect(r.labels[0]).toMatchObject({ plannedT: 5, repeat: 1, repeatCount: 1 });
    expect(r.cues[0]).toEqual({
      type: "cue",
      t: 6,
      plannedT: 6,
      cue: "stand",
      index: 0,
      label: "",
      segment: 2,
    });
  });

  it("空の文字列は空の記録", () => {
    const r = parseRecording("");
    expect(r).toMatchObject({ meta: null, protocol: null, params: null, badLines: 0 });
    expect(r.motions).toEqual([]);
  });
});

describe("motionSampleOf", () => {
  it.each([
    ["時刻が無い", { acc: [0, 0, 0] }],
    ["時刻が NaN（文字列）", { t: "1", acc: [0, 0, 0] }],
    ["値が 1 つも無い", { t: 1 }],
    ["成分が有限でない", { t: 1, acc: [0, null, 0] }],
  ])("%s なら null", (_, o) => {
    expect(motionSampleOf(o as Record<string, unknown>)).toBeNull();
  });

  it("一部の値だけでもサンプルにする（無い値は null，interval が無ければ null）", () => {
    expect(motionSampleOf({ t: 1, rot: [1, 2, 3] })).toEqual({
      t: 1,
      acc: null,
      accG: null,
      rot: { alpha: 1, beta: 2, gamma: 3 },
      interval: null,
    });
  });
});

describe("segmentsOf", () => {
  it("label の start・end から区間を作り，終わりまで記録があれば complete", () => {
    const rec = parse([
      ...labelPair("still", 0, 0, 1000),
      ...labelPair("nod", 1, 1000, 2000),
      ...restRecords(0, 2500),
    ]);
    const segs = segmentsOf(rec);
    expect(segs.map((s) => [s.index, s.label, s.startT, s.endT, s.complete])).toEqual([
      [0, "still", 0, 1000, true],
      [1, "nod", 1000, 2000, true],
    ]);
  });

  it("終わりのラベルが無い区間は最後のサンプルで切り，complete を false にする（途中で再読み込みされた等）", () => {
    const rec = parse([
      ...labelPair("still", 0, 0, 1000),
      labelRec({ label: "nod", segment: 1, t: 1000 }),
      ...restRecords(0, 1500),
    ]);
    const segs = segmentsOf(rec);
    expect(segs[1]).toMatchObject({ label: "nod", startT: 1000, complete: false });
    expect(segs[1].endT).toBe(rec.motions[rec.motions.length - 1].t);
  });

  it("終わりのラベルが最後のサンプルより後なら complete ではない", () => {
    const rec = parse([...labelPair("still", 0, 0, 3000), ...restRecords(0, 1000)]);
    expect(segmentsOf(rec)[0].complete).toBe(false);
  });

  it("中止の印（protocol_aborted）があれば，その時刻で切り，それより後に終わる区間は complete でない", () => {
    const rec = parse([
      ...labelPair("still", 0, 0, 1000),
      ...labelPair("nod", 1, 1000, 2000),
      markRec({ t: 1500, kind: "protocol_aborted" }),
      ...restRecords(0, 3000),
    ]);
    const segs = segmentsOf(rec);
    expect(segs[0].complete).toBe(true);
    expect(segs[1]).toMatchObject({ endT: 1500, complete: false });
  });

  it("ラベルの無い区間は protocol の予定の時刻で補い，記録の後に始まる区間は捨てる", () => {
    const rec = parse([
      protocolRec({
        t0: 1000,
        segments: [
          { label: "still", startMs: 0, endMs: 1000 },
          { label: "nod", startMs: 1000, endMs: 5000 },
          { label: "crouch_still", startMs: 6000, endMs: 7000 },
        ],
      }),
      ...restRecords(0, 4000),
    ]);
    const segs = segmentsOf(rec);
    expect(segs.map((s) => [s.label, s.startT, s.endT, s.complete])).toEqual([
      ["still", 1000, 2000, true],
      ["nod", 2000, rec.motions[rec.motions.length - 1].t, false],
    ]);
  });

  it("ラベルのある区間は protocol より label を優先する", () => {
    const rec = parse([
      protocolRec({ t0: 0, segments: [{ label: "still", startMs: 0, endMs: 1000 }] }),
      ...labelPair("still", 0, 100, 1100),
      ...restRecords(0, 2000),
    ]);
    expect(segmentsOf(rec).map((s) => [s.startT, s.endT])).toEqual([[100, 1100]]);
  });

  it("区間の合図は，その区間の番号で区間の中の時刻のものだけを時刻の順に持つ", () => {
    const rec = parse([
      ...labelPair("squat_stand", 3, 1000, 5000),
      cueRec({ t: 3000, segment: 3, cue: "stand", index: 1 }),
      cueRec({ t: 1500, segment: 3, cue: "crouch", index: 0 }),
      cueRec({ t: 2000, segment: 4 }),
      cueRec({ t: 6000, segment: 3 }),
      ...restRecords(0, 6000),
    ]);
    expect(segmentsOf(rec)[0].cues.map((c) => [c.t, c.cue])).toEqual([
      [1500, "crouch"],
      [3000, "stand"],
    ]);
  });

  it("start が無い・長さが 0 の区間は捨てる", () => {
    const rec = parse([
      labelRec({ label: "still", segment: 0, t: 1000, edge: "end" }),
      ...labelPair("nod", 1, 1000, 1000),
      ...restRecords(0, 2000),
    ]);
    expect(segmentsOf(rec)).toEqual([]);
  });

  it("記録が無ければ区間も無い", () => {
    expect(segmentsOf(parseRecording(""))).toEqual([]);
  });
});

describe("hasProtocolLabels・hasCompleteSegments", () => {
  it("ラベルも protocol も無い記録は正解付きでない", () => {
    const rec = parse(restRecords(0, 1000));
    expect(hasProtocolLabels(rec)).toBe(false);
    expect(hasCompleteSegments(rec)).toBe(false);
  });

  it("終わりまで記録された区間が無ければ集計に使えない", () => {
    const rec = parse([labelRec({ label: "still", segment: 0, t: 0 }), ...restRecords(0, 1000)]);
    expect(hasProtocolLabels(rec)).toBe(true);
    expect(hasCompleteSegments(rec)).toBe(false);
  });

  it("完了した区間が 1 つでもあれば集計に使える", () => {
    const rec = parse([...labelPair("still", 0, 0, 500), ...restRecords(0, 1000)]);
    expect(hasCompleteSegments(rec)).toBe(true);
  });
});
