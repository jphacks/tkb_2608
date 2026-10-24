// replay/ のテスト用の記録の作成関数（本番のコードからは import しない）．
// 既定値を持ち，一部だけ上書きできる形にする（.claude/rules/testing.md「書き方」）
import type { Posture } from "../../core/types";
import type {
  ClockRecord,
  InputRecord,
  LabelRecord,
  MarkRecord,
  MetaRecord,
  MotionRecord,
  ParamsRecord,
  VisibilityRecord,
} from "../recorder/records";
import type { MotionSample } from "../sensors/types";
import { crouchAccel, samplesOf } from "../testFixtures";
import type { RejudgeResult, TimeSpan } from "./rejudge";

export function motionRec(o: Partial<MotionRecord> = {}): MotionRecord {
  return {
    type: "motion",
    t: 0,
    acc: [0, 0, 0],
    accG: [0, 9.81, 0],
    rot: [0, 0, 0],
    interval: 16,
    ...o,
  };
}

/** MotionSample（testFixtures の合成の波形）を記録の形にする */
export function motionRecOf(s: MotionSample): MotionRecord {
  return {
    type: "motion",
    t: s.t,
    acc: s.acc === null ? null : [s.acc.x, s.acc.y, s.acc.z],
    accG: s.accG === null ? null : [s.accG.x, s.accG.y, s.accG.z],
    rot: s.rot === null ? null : [s.rot.alpha, s.rot.beta, s.rot.gamma],
    interval: s.interval,
  };
}

export function labelRec(o: Partial<LabelRecord> = {}): LabelRecord {
  return {
    type: "label",
    t: 0,
    plannedT: o.t ?? 0,
    label: "still",
    edge: "start",
    segment: 0,
    repeat: 1,
    repeatCount: 1,
    ...o,
  };
}

/** 区間の start と end の組 */
export function labelPair(
  label: string,
  segment: number,
  startT: number,
  endT: number,
): LabelRecord[] {
  return [
    labelRec({ label, segment, t: startT, edge: "start" }),
    labelRec({ label, segment, t: endT, edge: "end" }),
  ];
}

export function markRec(o: Partial<MarkRecord> = {}): MarkRecord {
  return { type: "mark", t: 0, kind: "other", ...o };
}

export function metaRec(o: Partial<MetaRecord> = {}): MetaRecord {
  return {
    type: "meta",
    t: 0,
    version: 1,
    sessionId: "test",
    page: "test",
    startedAt: "2026-10-24T00:00:00.000Z",
    timeOrigin: 0,
    userAgent: "test",
    screen: { width: 0, height: 0, dpr: 1 },
    ...o,
  };
}

export function paramsRec(t: number, params: Readonly<Record<string, number>>): ParamsRecord {
  return { type: "params", t, params };
}

export function visibilityRec(t: number, state: "visible" | "hidden" = "hidden"): VisibilityRecord {
  return { type: "visibility", t, state };
}

export function clockRec(o: Partial<ClockRecord> = {}): ClockRecord {
  return { type: "clock", t: 0, serverTime: 0, rtt: 10, ...o };
}

/** 足踏み（上下の揺れ．速度の平均は 0）の上下の加速度 */
export function stepping(freqHz: number, accAmp: number): (tSec: number) => number {
  const w = 2 * Math.PI * freqHz;
  return (t) => -accAmp * Math.cos(w * t);
}

export const DT = 16;

/** 静止の motion（startMs から durationMs） */
export function restRecords(startMs: number, durationMs: number): MotionRecord[] {
  return samplesOf(startMs, durationMs, DT, () => 0).map(motionRecOf);
}

/** 2 Hz・±3 m/s^2 の足踏みの motion */
export function steppingRecords(startMs: number, durationMs: number): MotionRecord[] {
  return samplesOf(startMs, durationMs, DT, stepping(2, 3)).map(motionRecOf);
}

/** depthM を durationMs でしゃがむ motion（負の depth で立つ） */
export function crouchRecords(startMs: number, durationMs: number, depthM = 0.4): MotionRecord[] {
  return samplesOf(startMs, durationMs, DT, crouchAccel(depthM, durationMs / 1000)).map(
    motionRecOf,
  );
}

/**
 * 静止 0〜2000 → 足踏み 2000〜5000 → 静止 5000〜8000 → しゃがむ 8000〜8700 → しゃがんで静止 8700〜11000．
 * ラベル付き（still・step_in_place・crouch_still）
 */
export function scenarioRecords(): InputRecord[] {
  return [
    ...labelPair("still", 0, 0, 2000),
    ...labelPair("step_in_place", 1, 2000, 5000),
    ...labelPair("crouch_still", 2, 8000, 11000),
    ...restRecords(0, 2000),
    ...steppingRecords(2000, 3000),
    ...restRecords(5000, 3000),
    ...crouchRecords(8000, 704),
    ...restRecords(8704, 2304),
  ];
}

/** 判定し直した結果を，サンプルの列から直接作る（metrics・regression の集計だけを確かめる） */
export interface FakeSample {
  readonly t: number;
  readonly walking?: boolean;
  readonly posture?: Posture;
}

function spans(t: readonly number[], on: (i: number) => boolean): TimeSpan[] {
  const out: TimeSpan[] = [];
  let start: number | null = null;
  for (let i = 0; i < t.length; i++) {
    if (on(i)) {
      if (start === null) start = t[i];
    } else if (start !== null) {
      out.push({ startT: start, endT: t[i] });
      start = null;
    }
  }
  if (start !== null) out.push({ startT: start, endT: t[t.length - 1] });
  return out;
}

export function fakeResult(samples: readonly FakeSample[], steps: number[] = []): RejudgeResult {
  const t = samples.map((s) => s.t);
  const walking = samples.map((s) => s.walking ?? false);
  const posture = samples.map((s) => s.posture ?? "standing");
  const zeros = samples.map(() => 0);
  const postureChanges: { t: number; posture: Posture }[] = [];
  let prev: Posture = "standing";
  for (let i = 0; i < t.length; i++) {
    if (posture[i] !== prev) postureChanges.push({ t: t[i], posture: posture[i] });
    prev = posture[i];
  }
  return {
    timeline: {
      t,
      av: zeros,
      bp: zeros,
      high: zeros,
      low: zeros,
      h: zeros,
      speed: zeros,
      gyro: zeros,
      walking,
      posture,
      step: zeros,
    },
    steps,
    rejectedSteps: [],
    walkingSpans: spans(t, (i) => walking[i]),
    crouchSpans: spans(t, (i) => posture[i] === "crouching"),
    postureChanges,
  };
}

/** startT から endT まで stepMs ごとのサンプル（f で walking・posture を決める） */
export function fakeSamples(
  startT: number,
  endT: number,
  stepMs: number,
  f: (t: number) => Omit<FakeSample, "t"> = () => ({}),
): FakeSample[] {
  const out: FakeSample[] = [];
  for (let t = startT; t <= endT; t += stepMs) out.push({ t, ...f(t) });
  return out;
}
