// 判定し直した結果を，手順のラベル（label）と印（mark）に照らして SPEC の指標にまとめる（DOM に依存しない純粋な関数）．
// 指標: 誤検出（歩かない区間で歩き始めた・姿勢を保つ区間で切り替わった）・見逃し・動き出しの遅れ
// （docs/04_SPEC/SPEC_01「判定の安定性」・experiment_山﨑/11「指標」）
import type { Posture } from "../../core/types";
import type { MarkRecord } from "../recorder/records";
import type { RejudgeResult } from "./rejudge";
import type { LabelSegment } from "./replayLog";

/** 手順のラベルごとの期待する判定 */
export interface LabelExpectation {
  /** この区間で歩く（足踏みする）か */
  readonly walk: boolean;
  /** 区間の間保つ姿勢．null は切り替わってよい（しゃがむ・立つの区間） */
  readonly posture: Posture | null;
  /** 姿勢の切り替わりの期待の回数（しゃがむ・立つを 10 回なら 20） */
  readonly postureChanges?: number;
}

/** 手順の記録ページのラベル（recorder/protocolSchedule.ts の DEFAULT_PROTOCOL_STEPS）ごとの期待 */
export const LABEL_EXPECTATIONS: Readonly<Record<string, LabelExpectation>> = {
  still: { walk: false, posture: "standing" },
  look_around: { walk: false, posture: "standing" },
  nod: { walk: false, posture: "standing" },
  step_in_place: { walk: true, posture: "standing" },
  squat_stand: { walk: false, posture: null, postureChanges: 20 },
  crouch_walk: { walk: true, posture: "crouching" },
  crouch_still: { walk: false, posture: "crouching" },
};

/**
 * 区間の始まりから姿勢の誤検出を数えない時間（ms）．しゃがんだまま〜の区間は始まりの合図でしゃがむことがあり，
 * しゃがみの遅れの目安（1 秒）の間に切り替わるのは正しい動き
 */
export const POSTURE_GRACE_MS = 1000;

/** 足踏みの動き出しの遅れの目安（ms．SPEC_01） */
export const WALK_LATENCY_TARGET_MS = 500;

export interface SegmentMetrics {
  readonly segment: LabelSegment;
  /** 期待（知らないラベルは null．指標の集計に入れない） */
  readonly expectation: LabelExpectation | null;
  /** 区間の中で数えた歩 */
  readonly steps: number;
  /** 区間の中で walking が false → true になった回数（区間の始まりで既に歩いていた分は数えない） */
  readonly walkOnsets: number;
  /** 区間の始まりから最初に walking が true になるまで（ms）．歩かなければ null */
  readonly walkLatencyMs: number | null;
  /** 区間の中の姿勢の切り替わりの回数（猶予を含む全部） */
  readonly postureChanges: number;
  /** 猶予の後に，期待の姿勢と違った時間（ms） */
  readonly wrongPostureMs: number;
}

export interface ReplayMetrics {
  readonly segments: readonly SegmentMetrics[];
  /** 歩かない区間で歩き始めた回数（誤検出） */
  readonly falseWalks: number;
  /** 姿勢を保つ区間で，猶予の後に姿勢が切り替わった回数（誤検出） */
  readonly falsePostureChanges: number;
  /** 歩く区間の数と，そのうち一度も歩かなかった数（見逃し） */
  readonly walkSegments: number;
  readonly walkMissed: number;
  /** 歩く区間の動き出しの遅れ（ms）．歩いた区間が無ければ null */
  readonly walkLatencyMeanMs: number | null;
  readonly walkLatencyMaxMs: number | null;
  /** 遅れが目安（WALK_LATENCY_TARGET_MS）を超えた区間の数 */
  readonly walkLatencyOver: number;
  /** しゃがむ・立つの区間の切り替わりの期待の回数と，判定した回数 */
  readonly postureChangesExpected: number;
  readonly postureChangesDetected: number;
  /** 記録の全体の歩・歩き始め・姿勢の切り替わりの数 */
  readonly totalSteps: number;
  readonly totalWalkOnsets: number;
  readonly totalPostureChanges: number;
  /** 印の種類ごとの数 */
  readonly marks: Readonly<Record<string, number>>;
}

function countIn(times: readonly number[], from: number, to: number): number {
  let n = 0;
  for (const t of times) if (t >= from && t <= to) n++;
  return n;
}

function segmentMetrics(result: RejudgeResult, seg: LabelSegment): SegmentMetrics {
  const expectation = LABEL_EXPECTATIONS[seg.label] ?? null;
  const tl = result.timeline;
  let walkOnsets = 0;
  let walkLatencyMs: number | null = null;
  let postureChanges = 0;
  let wrongPostureMs = 0;
  let prevWalking: boolean | null = null;
  let prevPosture: Posture | null = null;
  let prevT: number | null = null;
  for (let i = 0; i < tl.t.length; i++) {
    const t = tl.t[i];
    if (t < seg.startT) continue;
    if (t > seg.endT) break;
    const walking = tl.walking[i];
    const posture = tl.posture[i];
    if (walking && walkLatencyMs === null) walkLatencyMs = t - seg.startT;
    if (prevWalking === false && walking) walkOnsets++;
    if (prevPosture !== null && prevPosture !== posture) postureChanges++;
    if (
      expectation?.posture != null &&
      prevT !== null &&
      prevPosture !== null &&
      prevT >= seg.startT + POSTURE_GRACE_MS &&
      prevPosture !== expectation.posture
    ) {
      wrongPostureMs += t - prevT;
    }
    prevWalking = walking;
    prevPosture = posture;
    prevT = t;
  }
  return {
    segment: seg,
    expectation,
    steps: countIn(result.steps, seg.startT, seg.endT),
    walkOnsets,
    walkLatencyMs,
    postureChanges,
    wrongPostureMs,
  };
}

/** 姿勢を保つ区間で，猶予の後に切り替わった回数 */
function falsePostureIn(result: RejudgeResult, seg: LabelSegment): number {
  return result.postureChanges.filter(
    (c) => c.t >= seg.startT + POSTURE_GRACE_MS && c.t <= seg.endT,
  ).length;
}

/** 判定し直した結果を，区間と印に照らして指標にする */
export function computeMetrics(
  result: RejudgeResult,
  segments: readonly LabelSegment[],
  marks: readonly MarkRecord[] = [],
): ReplayMetrics {
  const per = segments.map((s) => segmentMetrics(result, s));
  let falseWalks = 0;
  let falsePostureChanges = 0;
  let walkSegments = 0;
  let walkMissed = 0;
  let postureChangesExpected = 0;
  let postureChangesDetected = 0;
  const latencies: number[] = [];
  for (const m of per) {
    const e = m.expectation;
    if (e === null) continue;
    if (e.walk) {
      walkSegments++;
      if (m.walkLatencyMs === null) walkMissed++;
      else latencies.push(m.walkLatencyMs);
    } else {
      falseWalks += m.walkOnsets;
    }
    if (e.posture !== null) falsePostureChanges += falsePostureIn(result, m.segment);
    if (e.postureChanges !== undefined) {
      postureChangesExpected += e.postureChanges;
      postureChangesDetected += m.postureChanges;
    }
  }
  const markCounts: Record<string, number> = {};
  for (const mk of marks) markCounts[mk.kind] = (markCounts[mk.kind] ?? 0) + 1;
  return {
    segments: per,
    falseWalks,
    falsePostureChanges,
    walkSegments,
    walkMissed,
    walkLatencyMeanMs:
      latencies.length === 0 ? null : latencies.reduce((a, b) => a + b, 0) / latencies.length,
    walkLatencyMaxMs: latencies.length === 0 ? null : Math.max(...latencies),
    walkLatencyOver: latencies.filter((l) => l > WALK_LATENCY_TARGET_MS).length,
    postureChangesExpected,
    postureChangesDetected,
    totalSteps: result.steps.length,
    totalWalkOnsets: result.walkingSpans.length,
    totalPostureChanges: result.postureChanges.length,
    marks: markCounts,
  };
}

/** 変える前と後を並べる表の 1 行 */
export interface MetricRow {
  readonly name: string;
  readonly before: number | null;
  readonly after: number | null;
  /** 小さいほど良いか（false は大きいほど良い．null は良し悪しを付けない） */
  readonly lowerIsBetter: boolean | null;
}

/** 変える前と後の指標を表の行にする（再生と調整のページ用） */
export function metricRows(before: ReplayMetrics, after: ReplayMetrics): MetricRow[] {
  const row = (
    name: string,
    pick: (m: ReplayMetrics) => number | null,
    lowerIsBetter: boolean | null,
  ): MetricRow => ({ name, before: pick(before), after: pick(after), lowerIsBetter });
  return [
    row("誤検出: 歩かない区間で歩き始めた（回）", (m) => m.falseWalks, true),
    row("誤検出: 姿勢を保つ区間で切り替わった（回）", (m) => m.falsePostureChanges, true),
    row("見逃し: 歩く区間で歩かなかった（区間）", (m) => m.walkMissed, true),
    row("歩く区間（区間）", (m) => m.walkSegments, null),
    row("動き出しの遅れ 平均（ms）", (m) => m.walkLatencyMeanMs, true),
    row("動き出しの遅れ 最大（ms）", (m) => m.walkLatencyMaxMs, true),
    row(`遅れが ${WALK_LATENCY_TARGET_MS} ms を超えた（区間）`, (m) => m.walkLatencyOver, true),
    row("しゃがむ・立つ: 期待の切り替わり（回）", (m) => m.postureChangesExpected, null),
    row("しゃがむ・立つ: 判定した切り替わり（回）", (m) => m.postureChangesDetected, null),
    row("全体: 歩（回）", (m) => m.totalSteps, null),
    row("全体: 歩き始め（回）", (m) => m.totalWalkOnsets, null),
    row("全体: 姿勢の切り替わり（回）", (m) => m.totalPostureChanges, null),
  ];
}

/** 後が前より良い（1）・悪い（-1）・同じか比べられない（0） */
export function compareMetricRow(r: MetricRow): -1 | 0 | 1 {
  if (r.lowerIsBetter === null || r.before === null || r.after === null) return 0;
  if (!Number.isFinite(r.before) || !Number.isFinite(r.after) || r.before === r.after) return 0;
  const better = r.lowerIsBetter ? r.after < r.before : r.after > r.before;
  return better ? 1 : -1;
}
