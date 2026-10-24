// 正解（手順のラベル）付きの記録を判定に流し直した結果から，区間ごとの指標を集計し，SPEC_01「判定の安定性」の目安と照らす
// （experiment_山﨑/11「指標」）．純粋な関数．時刻は記録の時刻（ms）
import type { Posture } from "../../core/types";
import { StepResult } from "../body/stepDetector";
import type { InputParams } from "../params";
import { type LabeledSegment, type ParsedRecording, segmentsOf } from "./parseRecording";
import { postureAt, type ReplayTimeline, replayBody, walkingAt } from "./replayBody";

/** SPEC_01「判定の安定性」の目安（数値は目安．実機の記録で見直す） */
export interface StabilityTargets {
  /** 立って静止・見回し・頷きの間の歩きの誤検出（回．この値以下） */
  readonly maxFalseWalks: number;
  /** 足踏みの検出率（この値以上．10 回のうち 9 回） */
  readonly minStepDetectionRate: number;
  /** 足踏みの動き出しの遅れ（ms．この値以下） */
  readonly maxStepOnsetMs: number;
  /** しゃがむ・立つの検出率（この値以上） */
  readonly minPostureDetectionRate: number;
  /** しゃがみ・立ち上がりの遅れ（ms．この値以下） */
  readonly maxPostureLatencyMs: number;
  /** しゃがんで静止・しゃがみ歩きの間に立ったと判定した回数（この値以下） */
  readonly maxCrouchFalseStands: number;
}

export const SPEC_STABILITY_TARGETS: StabilityTargets = {
  maxFalseWalks: 0,
  minStepDetectionRate: 0.9,
  maxStepOnsetMs: 500,
  minPostureDetectionRate: 0.9,
  maxPostureLatencyMs: 1000,
  maxCrouchFalseStands: 0,
};

/**
 * 集計の設定．足踏みの「本当の歩数」は記録に無いため，足踏みの区間の中で帯域通過後の値が
 * oracleHigh を超えて oracleLow を下回った山（不応期つき．頭の回転では除外しない）を本当の歩とみなす（目安）
 */
export interface EvaluateOptions {
  readonly targets: StabilityTargets;
  /** 本当の歩とみなす山のしきい値（立っている時．m/s^2） */
  readonly oracleHighStanding: number;
  readonly oracleLowStanding: number;
  /** しゃがみ歩きの時（m/s^2） */
  readonly oracleHighCrouching: number;
  readonly oracleLowCrouching: number;
  /** 本当の歩の不応期（ms） */
  readonly oracleRefractoryMs: number;
  /** しゃがむ・立つの動作の始まりとみなす上下の加速度の大きさ（m/s^2．帯域通過しない値） */
  readonly postureMotionAccel: number;
  /** 区間の終わりから止まるまでを探す長さ（ms） */
  readonly stopSearchMs: number;
  /** 最後の合図の後に，姿勢の切り替えを待つ長さ（ms） */
  readonly lastCueWindowMs: number;
  /** 合図の無い記録で，しゃがむ・立つの区間に期待する回数（各向き） */
  readonly squatRepsWithoutCues: number;
}

export const DEFAULT_EVALUATE_OPTIONS: EvaluateOptions = {
  targets: SPEC_STABILITY_TARGETS,
  oracleHighStanding: 0.6,
  oracleLowStanding: 0.15,
  oracleHighCrouching: 0.4,
  oracleLowCrouching: 0.1,
  oracleRefractoryMs: 250,
  postureMotionAccel: 0.5,
  stopSearchMs: 5000,
  lastCueWindowMs: 2000,
  squatRepsWithoutCues: 10,
};

/** 区間の種類（ラベルから決める） */
export type SegmentKind = "standing-still" | "step" | "squat" | "crouch-walk" | "crouch-still";

/** 手順のラベル → 区間の種類（protocolSchedule.ts の DEFAULT_PROTOCOL_STEPS） */
export const SEGMENT_KIND_BY_LABEL: Readonly<Record<string, SegmentKind>> = {
  still: "standing-still",
  look_around: "standing-still",
  nod: "standing-still",
  step_in_place: "step",
  squat_stand: "squat",
  crouch_walk: "crouch-walk",
  crouch_still: "crouch-still",
};

/** 1 つの目安との照合 */
export interface StabilityCheck {
  /** 指標の名前（表示用） */
  readonly name: string;
  readonly value: number | null;
  /** 目安（"<=" はこの値以下，">=" はこの値以上で合格） */
  readonly op: "<=" | ">=";
  readonly target: number;
  /** 値が無い時は null（判定できない） */
  readonly pass: boolean | null;
}

function check(
  name: string,
  value: number | null,
  op: "<=" | ">=",
  target: number,
): StabilityCheck {
  const pass = value === null ? null : op === "<=" ? value <= target : value >= target;
  return { name, value, op, target, pass };
}

/** 1 回の合図（しゃがむ・立つ）の結果 */
export interface CueOutcome {
  readonly cue: string;
  readonly t: number;
  /** 合図の向きに姿勢が変わった時刻（無ければ null＝見逃し） */
  readonly changeT: number | null;
  /** 合図からの遅れ（ms．人の反応の時間を含む） */
  readonly latencyFromCueMs: number | null;
  /** 動作の始まり（上下の加速度が postureMotionAccel を超えた時刻）からの遅れ（ms） */
  readonly latencyFromMotionMs: number | null;
}

/** 1 区間の指標 */
export interface SegmentMetrics {
  readonly index: number;
  readonly label: string;
  readonly kind: SegmentKind | null;
  readonly repeat: number;
  readonly startT: number;
  readonly endT: number;
  readonly complete: boolean;
  /** 区間の中で walking が false → true になった回数（始まりで既に歩いていたら 1 回と数える） */
  readonly walkStarts: number;
  /** 区間の中で数えた歩 */
  readonly stepsDetected: number;
  /** 区間の中で walking が true だった時間の割合（0〜1） */
  readonly walkingFraction: number;
  /** 区間の始まりの姿勢と，区間の中で立った・しゃがんだと判定した回数 */
  readonly postureAtStart: Posture;
  readonly toStanding: number;
  readonly toCrouching: number;
  // ---- 足踏み・しゃがみ歩き ----
  /** 本当の歩の目安（EvaluateOptions の山の数）．足踏み・しゃがみ歩き以外は null */
  readonly oracleSteps: number | null;
  /** 数えた歩 ÷ 本当の歩の目安 */
  readonly stepDetectionRate: number | null;
  /** 区間の始まり（合図）から walking が true になるまで（ms） */
  readonly onsetFromCueMs: number | null;
  /** 足踏みの始まり（最初の本当の歩の山が oracleHigh を超えた時刻）から walking が true になるまで（ms） */
  readonly onsetFromMotionMs: number | null;
  /** 歩き出した後，区間の中で walking が途切れた回数 */
  readonly dropouts: number | null;
  /** 区間の終わり（止める合図）から walking が false になるまで（ms） */
  readonly stopDelayMs: number | null;
  // ---- しゃがむ・立つ ----
  /** 合図ごとの結果（合図の無い記録では空） */
  readonly cueOutcomes: readonly CueOutcome[];
  /** しゃがむ・立つの検出率（合図に合った切り替え ÷ 合図の数．合図が無ければ切り替えの数 ÷ 期待する回数） */
  readonly postureDetectionRate: number | null;
  /** 合図に合わない姿勢の切り替えの回数 */
  readonly postureWrongChanges: number | null;
  /** 照らした目安 */
  readonly checks: readonly StabilityCheck[];
}

/** 記録全体の集計（完了した区間だけ） */
export interface StabilitySummary {
  /** 立って静止・見回し・頷きの間の歩きの誤検出の合計（回） */
  readonly falseWalks: number | null;
  /** 足踏みの検出率（数えた歩の合計 ÷ 本当の歩の目安の合計） */
  readonly stepDetectionRate: number | null;
  /** 足踏みの動き出しの遅れの最大（ms．足踏みの始まりから） */
  readonly stepOnsetMaxMs: number | null;
  /** 足踏みの動き出しの遅れの最大（ms．合図から．人の反応の時間を含む） */
  readonly stepOnsetFromCueMaxMs: number | null;
  /** 足踏みの途中で途切れた回数の合計 */
  readonly stepDropouts: number | null;
  /** しゃがむ・立つの検出率 */
  readonly postureDetectionRate: number | null;
  /** しゃがみ・立ち上がりの遅れの最大（ms．動作の始まりから．無ければ合図から） */
  readonly postureLatencyMaxMs: number | null;
  /** しゃがんで静止・しゃがみ歩きの間に立ったと判定した回数（区間の始まりで既に立った姿勢なら 1 回と数える） */
  readonly crouchFalseStands: number | null;
  /** しゃがみ歩きの検出率 */
  readonly crouchWalkDetectionRate: number | null;
  readonly checks: readonly StabilityCheck[];
  /** すべての目安を満たしたか（判定できる目安が 1 つも無ければ null） */
  readonly pass: boolean | null;
}

/** ラベルの無い記録でも出せる全体の数 */
export interface OverallStats {
  /** 記録の長さ（秒） */
  readonly durationSec: number;
  readonly samples: number;
  readonly steps: number;
  readonly walkStarts: number;
  /** walking が true だった時間（秒） */
  readonly walkingSec: number;
  readonly postureChanges: number;
  /** 頭の回転で数えなかった山 */
  readonly rejectedGyro: number;
  readonly resets: number;
}

export interface RecordingEvaluation {
  readonly segments: readonly SegmentMetrics[];
  readonly summary: StabilitySummary;
  readonly overall: OverallStats;
  readonly timeline: ReplayTimeline;
}

/** 区間 [from, to) の中の添え字の範囲 */
function indexRange(tl: ReplayTimeline, from: number, to: number): [number, number] {
  const ts = tl.t;
  let lo = 0;
  let hi = ts.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (ts[mid] < from) lo = mid + 1;
    else hi = mid;
  }
  const start = lo;
  hi = ts.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (ts[mid] < to) lo = mid + 1;
    else hi = mid;
  }
  return [start, lo];
}

/** walking が true だった時間の割合（サンプルの間隔で重みを付ける） */
function walkingFractionIn(tl: ReplayTimeline, from: number, to: number): number {
  const [a, b] = indexRange(tl, from, to);
  if (!(to > from) || b <= a) return 0;
  let walkMs = 0;
  for (let i = a; i < b; i++) {
    const next = i + 1 < tl.t.length ? Math.min(tl.t[i + 1], to) : to;
    if (tl.walking[i] === 1) walkMs += Math.max(0, next - tl.t[i]);
  }
  return Math.min(1, walkMs / (to - from));
}

/** 本当の歩の目安: 帯域通過後の値のシュミットトリガ（頭の回転では除外しない）．山の始まり（oracleHigh を超えた時刻）を返す */
export function oracleStepsIn(
  tl: ReplayTimeline,
  from: number,
  to: number,
  high: number,
  low: number,
  refractoryMs: number,
): number[] {
  const [a, b] = indexRange(tl, from, to);
  const out: number[] = [];
  let inPeak = false;
  let riseT = 0;
  let peakT = 0;
  let peak = 0;
  let lastPeakT = Number.NEGATIVE_INFINITY;
  for (let i = a; i < b; i++) {
    const v = tl.bp[i];
    if (!Number.isFinite(v)) continue;
    if (!inPeak) {
      if (v > high) {
        inPeak = true;
        riseT = tl.t[i];
        peakT = tl.t[i];
        peak = v;
      }
      continue;
    }
    if (v > peak) {
      peak = v;
      peakT = tl.t[i];
    }
    if (v < low) {
      inPeak = false;
      if (peakT - lastPeakT >= refractoryMs) {
        out.push(riseT);
        lastPeakT = peakT;
      }
    }
  }
  return out;
}

function countIn<T extends { readonly t: number }>(xs: readonly T[], from: number, to: number) {
  let n = 0;
  for (const x of xs) if (x.t >= from && x.t < to) n++;
  return n;
}

function firstWalkingT(tl: ReplayTimeline, from: number, to: number): number | null {
  if (walkingAt(tl, from)) return from;
  const [a, b] = indexRange(tl, from, to);
  for (let i = a; i < b; i++) if (tl.walking[i] === 1) return tl.t[i];
  return null;
}

function firstStopT(tl: ReplayTimeline, from: number, to: number): number | null {
  if (!walkingAt(tl, from)) return from;
  const [a, b] = indexRange(tl, from, to);
  for (let i = a; i < b; i++) if (tl.walking[i] === 0) return tl.t[i];
  return null;
}

/** 区間 [from, to) の中で walking が false → true になった回数（始まりで歩いていたら 1 回） */
function walkStartsIn(tl: ReplayTimeline, from: number, to: number): number {
  let n = walkingAt(tl, from) ? 1 : 0;
  for (const c of tl.walkChanges) if (c.walking && c.t > from && c.t < to) n++;
  return n;
}

function firstAbove(tl: ReplayTimeline, from: number, to: number, accel: number): number | null {
  const [a, b] = indexRange(tl, from, to);
  for (let i = a; i < b; i++) if (Math.abs(tl.av[i]) >= accel) return tl.t[i];
  return null;
}

/** しゃがむ・立つの合図ごとに，合図の向きへの姿勢の切り替えを探す */
function cueOutcomesOf(
  tl: ReplayTimeline,
  seg: LabeledSegment,
  options: EvaluateOptions,
): { outcomes: CueOutcome[]; matched: Set<number> } {
  const outcomes: CueOutcome[] = [];
  const matched = new Set<number>();
  const cues = seg.cues.filter((c) => c.cue === "crouch" || c.cue === "stand");
  cues.forEach((c, i) => {
    const windowEnd =
      i + 1 < cues.length ? cues[i + 1].t : Math.max(seg.endT, c.t + options.lastCueWindowMs);
    const target: Posture = c.cue === "crouch" ? "crouching" : "standing";
    let changeT: number | null = null;
    tl.postureChanges.forEach((p, k) => {
      if (changeT === null && p.t >= c.t && p.t < windowEnd && p.posture === target) {
        changeT = p.t;
        matched.add(k);
      }
    });
    const motionT = firstAbove(tl, c.t, windowEnd, options.postureMotionAccel);
    const ct: number | null = changeT;
    outcomes.push({
      cue: c.cue,
      t: c.t,
      changeT: ct,
      latencyFromCueMs: ct === null ? null : ct - c.t,
      latencyFromMotionMs: ct === null || motionT === null || motionT > ct ? null : ct - motionT,
    });
  });
  return { outcomes, matched };
}

function maxOf(xs: readonly (number | null)[]): number | null {
  let m: number | null = null;
  for (const x of xs) if (x !== null && Number.isFinite(x) && (m === null || x > m)) m = x;
  return m;
}

function sumOf(xs: readonly (number | null)[]): number | null {
  let s: number | null = null;
  for (const x of xs) if (x !== null) s = (s ?? 0) + x;
  return s;
}

/** 1 区間の指標を求める */
export function evaluateSegment(
  tl: ReplayTimeline,
  seg: LabeledSegment,
  options: EvaluateOptions = DEFAULT_EVALUATE_OPTIONS,
  nextSegmentStartT: number = Number.POSITIVE_INFINITY,
): SegmentMetrics {
  const kind = SEGMENT_KIND_BY_LABEL[seg.label] ?? null;
  const { startT, endT } = seg;
  const targets = options.targets;
  const postureChangesIn = tl.postureChanges.filter((p) => p.t >= startT && p.t < endT);
  const base = {
    index: seg.index,
    label: seg.label,
    kind,
    repeat: seg.repeat,
    startT,
    endT,
    complete: seg.complete,
    walkStarts: walkStartsIn(tl, startT, endT),
    stepsDetected: countIn(tl.steps, startT, endT),
    walkingFraction: walkingFractionIn(tl, startT, endT),
    postureAtStart: postureAt(tl, startT),
    toStanding: postureChangesIn.filter((p) => p.posture === "standing").length,
    toCrouching: postureChangesIn.filter((p) => p.posture === "crouching").length,
  };
  let oracleSteps: number | null = null;
  let stepDetectionRate: number | null = null;
  let onsetFromCueMs: number | null = null;
  let onsetFromMotionMs: number | null = null;
  let dropouts: number | null = null;
  let stopDelayMs: number | null = null;
  let cueOutcomes: CueOutcome[] = [];
  let postureDetectionRate: number | null = null;
  let postureWrongChanges: number | null = null;
  const checks: StabilityCheck[] = [];

  if (kind === "step" || kind === "crouch-walk") {
    const crouch = kind === "crouch-walk";
    const oracle = oracleStepsIn(
      tl,
      startT,
      endT,
      crouch ? options.oracleHighCrouching : options.oracleHighStanding,
      crouch ? options.oracleLowCrouching : options.oracleLowStanding,
      options.oracleRefractoryMs,
    );
    oracleSteps = oracle.length;
    stepDetectionRate = oracle.length > 0 ? base.stepsDetected / oracle.length : null;
    const onsetT = firstWalkingT(tl, startT, endT);
    onsetFromCueMs = onsetT === null ? null : onsetT - startT;
    onsetFromMotionMs =
      onsetT === null || oracle.length === 0 ? null : Math.max(0, onsetT - oracle[0]);
    if (onsetT !== null) {
      let n = 0;
      for (const c of tl.walkChanges) if (!c.walking && c.t > onsetT && c.t < endT) n++;
      dropouts = n;
    }
    const stopT = firstStopT(tl, endT, Math.min(nextSegmentStartT, endT + options.stopSearchMs));
    stopDelayMs = stopT === null ? null : stopT - endT;
    if (kind === "step") {
      checks.push(
        check("足踏みの検出率", stepDetectionRate, ">=", targets.minStepDetectionRate),
        check("足踏みの動き出し（ms）", onsetFromMotionMs, "<=", targets.maxStepOnsetMs),
      );
    } else {
      checks.push(
        check("しゃがみ歩きの検出率", stepDetectionRate, ">=", targets.minStepDetectionRate),
        check(
          "しゃがみ歩きの間に立った（回）",
          base.toStanding + (base.postureAtStart === "standing" ? 1 : 0),
          "<=",
          targets.maxCrouchFalseStands,
        ),
      );
    }
  } else if (kind === "squat") {
    if (seg.cues.length > 0) {
      const r = cueOutcomesOf(tl, seg, options);
      cueOutcomes = r.outcomes;
      const hits = r.outcomes.filter((o) => o.changeT !== null).length;
      postureDetectionRate = r.outcomes.length > 0 ? hits / r.outcomes.length : null;
      postureWrongChanges = tl.postureChanges.filter(
        (p, k) => p.t >= startT && p.t < endT && !r.matched.has(k),
      ).length;
    } else {
      // 合図の無い記録: 向きごとの切り替えの数を，期待する回数と比べる（遅れは測れない）
      const reps = options.squatRepsWithoutCues;
      postureDetectionRate =
        reps > 0 ? Math.min(1, Math.min(base.toCrouching, base.toStanding) / reps) : null;
    }
    checks.push(
      check("しゃがむ・立つの検出率", postureDetectionRate, ">=", targets.minPostureDetectionRate),
      check(
        "しゃがみ・立ち上がりの遅れ（ms）",
        maxOf(cueOutcomes.map((o) => o.latencyFromMotionMs ?? o.latencyFromCueMs)),
        "<=",
        targets.maxPostureLatencyMs,
      ),
    );
  } else if (kind === "crouch-still") {
    checks.push(
      check(
        "しゃがんで静止の間に立った（回）",
        base.toStanding + (base.postureAtStart === "standing" ? 1 : 0),
        "<=",
        targets.maxCrouchFalseStands,
      ),
      check("しゃがんで静止の間の歩きの誤検出（回）", base.walkStarts, "<=", targets.maxFalseWalks),
    );
  } else if (kind === "standing-still") {
    checks.push(
      check(`${seg.label} の歩きの誤検出（回）`, base.walkStarts, "<=", targets.maxFalseWalks),
      check(`${seg.label} の姿勢の誤検出（回）`, base.toCrouching, "<=", 0),
    );
  }

  return {
    ...base,
    oracleSteps,
    stepDetectionRate,
    onsetFromCueMs,
    onsetFromMotionMs,
    dropouts,
    stopDelayMs,
    cueOutcomes,
    postureDetectionRate,
    postureWrongChanges,
    checks,
  };
}

/** 完了した区間の指標から全体を集計する */
export function summarizeSegments(
  segments: readonly SegmentMetrics[],
  targets: StabilityTargets = SPEC_STABILITY_TARGETS,
): StabilitySummary {
  const done = segments.filter((s) => s.complete);
  const of = (k: SegmentKind) => done.filter((s) => s.kind === k);
  const still = of("standing-still");
  const step = of("step");
  const squat = of("squat");
  const crouchWalk = of("crouch-walk");
  const crouchStill = of("crouch-still");

  const rate = (xs: readonly SegmentMetrics[]) => {
    const oracle = sumOf(xs.map((s) => s.oracleSteps));
    const detected = sumOf(xs.map((s) => (s.oracleSteps === null ? null : s.stepsDetected)));
    return oracle === null || detected === null || oracle === 0 ? null : detected / oracle;
  };
  const falseWalks = still.length > 0 ? still.reduce((a, s) => a + s.walkStarts, 0) : null;
  const stepDetectionRate = rate(step);
  const stepOnsetMaxMs = maxOf(step.map((s) => s.onsetFromMotionMs));
  const stepOnsetFromCueMaxMs = maxOf(step.map((s) => s.onsetFromCueMs));
  const stepDropouts = sumOf(step.map((s) => s.dropouts));
  const outcomes = squat.flatMap((s) => s.cueOutcomes);
  const postureDetectionRate =
    outcomes.length > 0
      ? outcomes.filter((o) => o.changeT !== null).length / outcomes.length
      : squat.length > 0
        ? Math.min(...squat.map((s) => s.postureDetectionRate ?? 0))
        : null;
  const postureLatencyMaxMs = maxOf(
    outcomes.map((o) => o.latencyFromMotionMs ?? o.latencyFromCueMs),
  );
  const crouchSegs = [...crouchWalk, ...crouchStill];
  const crouchFalseStands =
    crouchSegs.length > 0
      ? crouchSegs.reduce((a, s) => a + s.toStanding + (s.postureAtStart === "standing" ? 1 : 0), 0)
      : null;
  const crouchWalkDetectionRate = rate(crouchWalk);

  const checks = [
    check("歩きの誤検出（静止・見回し・頷き．回）", falseWalks, "<=", targets.maxFalseWalks),
    check("足踏みの検出率", stepDetectionRate, ">=", targets.minStepDetectionRate),
    check("足踏みの動き出し（ms）", stepOnsetMaxMs, "<=", targets.maxStepOnsetMs),
    check("しゃがむ・立つの検出率", postureDetectionRate, ">=", targets.minPostureDetectionRate),
    check(
      "しゃがみ・立ち上がりの遅れ（ms）",
      postureLatencyMaxMs,
      "<=",
      targets.maxPostureLatencyMs,
    ),
    check("しゃがんでいる間に立った（回）", crouchFalseStands, "<=", targets.maxCrouchFalseStands),
    check("しゃがみ歩きの検出率", crouchWalkDetectionRate, ">=", targets.minStepDetectionRate),
  ];
  const judged = checks.filter((c) => c.pass !== null);
  return {
    falseWalks,
    stepDetectionRate,
    stepOnsetMaxMs,
    stepOnsetFromCueMaxMs,
    stepDropouts,
    postureDetectionRate,
    postureLatencyMaxMs,
    crouchFalseStands,
    crouchWalkDetectionRate,
    checks,
    pass: judged.length === 0 ? null : judged.every((c) => c.pass === true),
  };
}

/** 記録全体の数（ラベルの無い記録用） */
export function overallStats(tl: ReplayTimeline): OverallStats {
  const n = tl.t.length;
  const durationSec = n > 1 ? (tl.t[n - 1] - tl.t[0]) / 1000 : 0;
  const walkingSec = n > 1 ? walkingFractionIn(tl, tl.t[0], tl.t[n - 1]) * durationSec : 0;
  return {
    durationSec,
    samples: n,
    steps: tl.steps.length,
    walkStarts: tl.walkChanges.filter((c) => c.walking).length,
    walkingSec,
    postureChanges: tl.postureChanges.length,
    rejectedGyro: tl.rejected.filter((r) => r.reason === StepResult.RejectedGyro).length,
    resets: tl.resets.length,
  };
}

/**
 * 記録を params で判定に流し直し，区間ごとの指標と全体の集計を返す．
 * ラベルの無い記録では segments が空で，summary の値は null（overall だけが意味を持つ）
 */
export function evaluateRecording(
  rec: ParsedRecording,
  params: InputParams,
  options: EvaluateOptions = DEFAULT_EVALUATE_OPTIONS,
): RecordingEvaluation {
  const timeline = replayBody(rec.motions, params);
  const segs = segmentsOf(rec);
  const segments = segs.map((seg, i) =>
    evaluateSegment(
      timeline,
      seg,
      options,
      i + 1 < segs.length ? segs[i + 1].startT : Number.POSITIVE_INFINITY,
    ),
  );
  return {
    segments,
    summary: summarizeSegments(segments, options.targets),
    overall: overallStats(timeline),
    timeline,
  };
}
