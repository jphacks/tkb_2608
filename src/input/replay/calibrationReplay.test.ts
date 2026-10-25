// 記録からキャリブレーションの区間を切り出す関数（calibrationReplay.ts）を，作成関数で作った小さな記録で確かめる（Issue #94）
import { describe, expect, it } from "vitest";
import type { CueRecord, InputRecord } from "../recorder/records";
import {
  type CalibrationLengths,
  calibrationSegmentsFromRecording,
  compareCalibrations,
  DEFAULT_CALIBRATION_LENGTHS,
  parseCalibrationLengths,
  scaleCalibrationLengths,
} from "./calibrationReplay";
import { parseRecording } from "./parseRecording";
import { crouchRecords, labelPair, restRecords, steppingRecords } from "./testRecords";

const jsonl = (records: readonly InputRecord[]) =>
  `${records.map((r) => JSON.stringify(r)).join("\n")}\n`;

function cueRec(o: Partial<CueRecord> = {}): CueRecord {
  return {
    type: "cue",
    t: 0,
    plannedT: o.t ?? 0,
    cue: "crouch",
    index: 0,
    label: "squat_stand",
    segment: 2,
    ...o,
  };
}

/** protocol の区間の並び（still → step_in_place → squat_stand → crouch_walk）．ms */
const LAYOUT = {
  still: [0, 10000],
  step: [10000, 20000],
  squat: [20000, 30000],
  crouchWalk: [30000, 40000],
} as const;

function protocolRecording(
  o: { omit?: readonly string[]; crouchCueT?: number | null; shortStill?: number } = {},
) {
  const omit = new Set(o.omit ?? []);
  const records: InputRecord[] = [];
  let seg = 0;
  const add = (label: string, [s, e]: readonly [number, number]) => {
    if (!omit.has(label)) records.push(...labelPair(label, seg, s, e));
    seg++;
  };
  add("still", [LAYOUT.still[0], o.shortStill ?? LAYOUT.still[1]]);
  add("step_in_place", LAYOUT.step);
  add("squat_stand", LAYOUT.squat);
  add("crouch_walk", LAYOUT.crouchWalk);
  if (o.crouchCueT !== null && !omit.has("squat_stand")) {
    records.push(cueRec({ t: o.crouchCueT ?? 22000, segment: 2 }));
  }
  records.push(...restRecords(0, 41000));
  return parseRecording(jsonl(records));
}

describe("parseCalibrationLengths", () => {
  it("名前=ms を読み，省いた区間は base のまま", () => {
    expect(parseCalibrationLengths("stand=1000,crouchWalk=8000")).toEqual({
      lengths: { ...DEFAULT_CALIBRATION_LENGTHS, standingMs: 1000, crouchWalkingMs: 8000 },
      errors: [],
    });
  });

  it("4 つすべて・空白・空の項目を受け付ける", () => {
    const r = parseCalibrationLengths(" stand = 1 , step=2,, crouch=3 ,crouchWalk=4,");
    expect(r.errors).toEqual([]);
    expect(r.lengths).toEqual({
      standingMs: 1,
      steppingMs: 2,
      crouchingMs: 3,
      crouchWalkingMs: 4,
    });
  });

  it("空の文字列なら base のまま", () => {
    const base: CalibrationLengths = {
      standingMs: 1,
      steppingMs: 2,
      crouchingMs: 3,
      crouchWalkingMs: 4,
    };
    expect(parseCalibrationLengths("", base)).toEqual({ lengths: base, errors: [] });
  });

  it.each([
    ["知らない名前", "walk=1000"],
    ["継承した名前（toString）", "toString=1000"],
    ["値が無い", "stand"],
    ["値が空", "stand="],
    ["0", "stand=0"],
    ["負", "stand=-5"],
    ["数でない", "stand=abc"],
    ["NaN", "stand=NaN"],
    ["Infinity", "stand=Infinity"],
  ])("%s（%s）は errors に入れ，その区間は base のまま", (_name, spec) => {
    const r = parseCalibrationLengths(spec);
    expect(r.errors).toHaveLength(1);
    expect(r.lengths).toEqual(DEFAULT_CALIBRATION_LENGTHS);
  });

  it("誤りがあっても正しい項目は使う", () => {
    const r = parseCalibrationLengths("stand=0,step=7000");
    expect(r.errors).toHaveLength(1);
    expect(r.lengths.steppingMs).toBe(7000);
    expect(r.lengths.standingMs).toBe(DEFAULT_CALIBRATION_LENGTHS.standingMs);
  });
});

describe("scaleCalibrationLengths", () => {
  it("すべての区間を倍にして ms に丸める", () => {
    expect(scaleCalibrationLengths(DEFAULT_CALIBRATION_LENGTHS, 0.5)).toEqual({
      standingMs: 1500,
      steppingMs: 2500,
      crouchingMs: 1500,
      crouchWalkingMs: 2000,
    });
    expect(
      scaleCalibrationLengths(
        { standingMs: 1, steppingMs: 3, crouchingMs: 5, crouchWalkingMs: 7 },
        0.5,
      ),
    ).toEqual({ standingMs: 1, steppingMs: 2, crouchingMs: 3, crouchWalkingMs: 4 });
  });
});

describe("calibrationSegmentsFromRecording", () => {
  it("still・step_in_place・crouch の合図・crouch_walk の始めから既定の長さで 4 区間を切り出す", () => {
    const { segments, notes } = calibrationSegmentsFromRecording(protocolRecording());
    expect(notes).toEqual([]);
    expect(segments).toEqual([
      { kind: "standing", startMs: 0, endMs: 3000, outcome: "completed" },
      { kind: "stepping", startMs: 10000, endMs: 15000, outcome: "completed" },
      { kind: "crouching", startMs: 22000, endMs: 25000, outcome: "completed" },
      { kind: "crouchWalking", startMs: 30000, endMs: 34000, outcome: "completed" },
    ]);
  });

  it("長さを指定できる", () => {
    const { segments } = calibrationSegmentsFromRecording(protocolRecording(), {
      standingMs: 1000,
      steppingMs: 2000,
      crouchingMs: 1500,
      crouchWalkingMs: 8000,
    });
    expect(segments.map((s) => s.endMs - s.startMs)).toEqual([1000, 2000, 1500, 8000]);
  });

  it("crouch の合図が無ければ squat_stand の始めから", () => {
    const { segments } = calibrationSegmentsFromRecording(protocolRecording({ crouchCueT: null }));
    expect(segments.find((s) => s.kind === "crouching")?.startMs).toBe(20000);
  });

  it("元の区間の終わりで切り，notes に書く", () => {
    const { segments, notes } = calibrationSegmentsFromRecording(
      protocolRecording({ shortStill: 2000 }),
    );
    expect(segments.find((s) => s.kind === "standing")).toEqual({
      kind: "standing",
      startMs: 0,
      endMs: 2000,
      outcome: "completed",
    });
    expect(notes.some((n) => n.startsWith("standing"))).toBe(true);
  });

  it.each([
    ["still", "standing"],
    ["step_in_place", "stepping"],
    ["squat_stand", "crouching"],
    ["crouch_walk", "crouchWalking"],
  ])("記録に %s が無ければ %s は入れず notes に書く", (label, kind) => {
    const { segments, notes } = calibrationSegmentsFromRecording(
      protocolRecording({ omit: [label] }),
    );
    expect(segments.map((s) => s.kind)).not.toContain(kind);
    expect(segments).toHaveLength(3);
    expect(notes.some((n) => n.startsWith(kind))).toBe(true);
  });

  it("正解の無い記録からは何も切り出さない", () => {
    const { segments, notes } = calibrationSegmentsFromRecording(
      parseRecording(jsonl(restRecords(0, 2000))),
    );
    expect(segments).toEqual([]);
    expect(notes).toHaveLength(4);
  });
});

describe("compareCalibrations", () => {
  // 静止 → 足踏み → しゃがむ → しゃがんで静止（squat_stand の crouch の合図 → しゃがむ）
  const records: InputRecord[] = [
    ...labelPair("still", 0, 0, 4000),
    ...labelPair("step_in_place", 1, 4000, 10000),
    ...labelPair("squat_stand", 2, 10000, 14000),
    cueRec({ t: 10500, segment: 2 }),
    ...restRecords(0, 4000),
    ...steppingRecords(4000, 6000),
    ...restRecords(10000, 1000),
    ...crouchRecords(11000, 704),
    ...restRecords(11704, 2304),
  ];
  const recording = parseRecording(jsonl(records));

  it("正解付きの記録 × 組ごとに 1 列を作り，求めた値を既定値に重ねたしきい値で判定する", () => {
    const { cells, runs } = compareCalibrations(
      [
        { name: "r", recording },
        { name: "unlabeled", recording: parseRecording(jsonl(restRecords(0, 1000))) },
      ],
      [
        { name: "calib", lengths: DEFAULT_CALIBRATION_LENGTHS },
        { name: "calib×0.5", lengths: scaleCalibrationLengths(DEFAULT_CALIBRATION_LENGTHS, 0.5) },
      ],
    );
    expect(cells.map((c) => [c.recording, c.paramSet])).toEqual([
      ["r", "calib"],
      ["r", "calib×0.5"],
    ]);
    expect(runs).toHaveLength(2);
    const run = runs[0];
    // 足踏みの区間から立った足踏みの T_high を求め，しきい値に入っている
    expect(run.result.overrides.stepHighStanding).toBeDefined();
    expect(run.params.stepHighStanding).toBe(run.result.overrides.stepHighStanding);
    // しゃがみ歩きの区間が無いので notes に書かれる
    expect(run.windowNotes.some((n) => n.startsWith("crouchWalking"))).toBe(true);
  });

  it("組が無ければ何も作らない", () => {
    expect(compareCalibrations([{ name: "r", recording }], [])).toEqual({ cells: [], runs: [] });
  });
});
