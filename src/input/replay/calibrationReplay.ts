// 正解付きの記録（protocol.html の記録）から，キャリブレーションの 4 区間にあたる部分を切り出してしきい値を求め，
// その値で記録の全体を判定し直す（Issue #94．キャリブレーションの長さが足りるかを確かめる）．純粋な関数．
// キャリブレーションに使った部分も評価の区間に含まれる（記録は 1 本なので，切り出した部分を評価から外していない）
import type { CalibrationSegment } from "../../core/types";
import { type CalibrationResult, calibrateParams } from "../body/calibration";
import { DEFAULT_INPUT_PARAMS, type InputParams, mergeParams } from "../params";
import { type ComparisonCell, formatTable, type NamedRecording } from "./compareParams";
import { DEFAULT_EVALUATE_OPTIONS, type EvaluateOptions, evaluateRecording } from "./evaluate";
import { hasCompleteSegments, type ParsedRecording, segmentsOf } from "./parseRecording";

/** キャリブレーションの区間の長さ（ms） */
export interface CalibrationLengths {
  /** 立って静止 */
  readonly standingMs: number;
  /** 立って足踏み */
  readonly steppingMs: number;
  /** しゃがむ（しゃがむ動作を含む） */
  readonly crouchingMs: number;
  /** しゃがみ歩き */
  readonly crouchWalkingMs: number;
}

/** 既定の長さ（合計 15 秒．lobby/ の手順の案） */
export const DEFAULT_CALIBRATION_LENGTHS: CalibrationLengths = {
  standingMs: 3000,
  steppingMs: 5000,
  crouchingMs: 3000,
  crouchWalkingMs: 4000,
};

/** 長さを指定する時の短い名前（--calib-ms・URL パラメータと同じ） */
const LENGTH_KEYS: Readonly<Record<string, keyof CalibrationLengths>> = {
  stand: "standingMs",
  step: "steppingMs",
  crouch: "crouchingMs",
  crouchWalk: "crouchWalkingMs",
};

/** 長さを倍にする */
export function scaleCalibrationLengths(
  lengths: CalibrationLengths,
  scale: number,
): CalibrationLengths {
  return {
    standingMs: Math.round(lengths.standingMs * scale),
    steppingMs: Math.round(lengths.steppingMs * scale),
    crouchingMs: Math.round(lengths.crouchingMs * scale),
    crouchWalkingMs: Math.round(lengths.crouchWalkingMs * scale),
  };
}

/**
 * "stand=3000,step=5000,crouch=3000,crouchWalk=4000" の形の文字列から長さを読む（省いた区間は base のまま）．
 * 知らない名前・正の数でない値は errors に入れる
 */
export function parseCalibrationLengths(
  spec: string,
  base: CalibrationLengths = DEFAULT_CALIBRATION_LENGTHS,
): { readonly lengths: CalibrationLengths; readonly errors: readonly string[] } {
  const out: Record<keyof CalibrationLengths, number> = { ...base };
  const errors: string[] = [];
  for (const part of spec.split(",")) {
    const item = part.trim();
    if (item === "") continue;
    const eq = item.indexOf("=");
    const name = eq >= 0 ? item.slice(0, eq).trim() : item;
    const value = eq >= 0 ? Number(item.slice(eq + 1)) : Number.NaN;
    const key = Object.hasOwn(LENGTH_KEYS, name) ? LENGTH_KEYS[name] : undefined;
    if (key === undefined) errors.push(`知らない区間: ${name}（stand・step・crouch・crouchWalk）`);
    else if (!(Number.isFinite(value) && value > 0)) errors.push(`正の数でない長さ: ${item}`);
    else out[key] = value;
  }
  return { lengths: out, errors };
}

/** 長さの短い表示（秒） */
export function describeCalibrationLengths(l: CalibrationLengths): string {
  const s = (ms: number) => `${(ms / 1000).toFixed(1).replace(/\.0$/, "")}`;
  return `静止 ${s(l.standingMs)}・足踏み ${s(l.steppingMs)}・しゃがむ ${s(l.crouchingMs)}・しゃがみ歩き ${s(l.crouchWalkingMs)} 秒`;
}

/**
 * 記録から，キャリブレーションの 4 区間にあたる部分を切り出す（記録の時刻．ms）．
 * - standing: still の始めから
 * - stepping: step_in_place（1 回目）の始めから
 * - crouching: squat_stand の 1 回目の crouch の合図から（合図が無ければ squat_stand の始めから）．
 *   合図は 2 秒ごとで，2 秒後に stand の合図が来るため，3 秒の窓は立ち上がりの始まりも含む（深さは底までで測る）
 * - crouchWalking: crouch_walk（1 回目）の始めから
 * いずれも元の区間の終わりで切る．元の区間が無い種類は入れない（notes に書く）
 */
export function calibrationSegmentsFromRecording(
  rec: ParsedRecording,
  lengths: CalibrationLengths = DEFAULT_CALIBRATION_LENGTHS,
): { readonly segments: readonly CalibrationSegment[]; readonly notes: readonly string[] } {
  const segs = segmentsOf(rec);
  const segments: CalibrationSegment[] = [];
  const notes: string[] = [];
  const add = (
    kind: CalibrationSegment["kind"],
    label: string,
    lengthMs: number,
    startOf: (s: (typeof segs)[number]) => number,
  ) => {
    const s = segs.find((x) => x.label === label);
    if (s === undefined) {
      notes.push(`${kind}: 記録に ${label} が無い`);
      return;
    }
    const startMs = startOf(s);
    const endMs = Math.min(s.endT, startMs + lengthMs);
    if (!(endMs > startMs)) {
      notes.push(`${kind}: ${label} に長さが無い`);
      return;
    }
    if (endMs < startMs + lengthMs) notes.push(`${kind}: ${label} の終わりで切った`);
    segments.push({ kind, startMs, endMs, outcome: "completed" });
  };
  add("standing", "still", lengths.standingMs, (s) => s.startT);
  add("stepping", "step_in_place", lengths.steppingMs, (s) => s.startT);
  add(
    "crouching",
    "squat_stand",
    lengths.crouchingMs,
    (s) => s.cues.find((c) => c.cue === "crouch")?.t ?? s.startT,
  );
  add("crouchWalking", "crouch_walk", lengths.crouchWalkingMs, (s) => s.startT);
  return { segments, notes };
}

/** 比べるキャリブレーションの 1 組 */
export interface CalibrationConfig {
  readonly name: string;
  readonly lengths: CalibrationLengths;
}

/** 1 本の記録 × 1 組のキャリブレーションの結果 */
export interface CalibrationRun {
  readonly recording: string;
  readonly config: CalibrationConfig;
  readonly segments: readonly CalibrationSegment[];
  readonly windowNotes: readonly string[];
  readonly result: CalibrationResult;
  readonly params: InputParams;
}

/** 記録からキャリブレーションの値を求め，既定値に重ねたしきい値を返す */
export function calibrateRecording(
  name: string,
  rec: ParsedRecording,
  config: CalibrationConfig,
  base: InputParams = DEFAULT_INPUT_PARAMS,
): CalibrationRun {
  const { segments, notes } = calibrationSegmentsFromRecording(rec, config.lengths);
  const result = calibrateParams(rec.motions, segments, base);
  return {
    recording: name,
    config,
    segments,
    windowNotes: notes,
    result,
    params: mergeParams(base, result.overrides),
  };
}

/**
 * 正解付きの記録ごとに，キャリブレーションの組ごとのしきい値で全体を判定し直す．
 * 記録ごとにしきい値が違うため，compareParamSets（全記録に同じ組を流す）とは別に作る
 */
export function compareCalibrations(
  recordings: readonly NamedRecording[],
  configs: readonly CalibrationConfig[],
  options: EvaluateOptions = DEFAULT_EVALUATE_OPTIONS,
): { readonly cells: readonly ComparisonCell[]; readonly runs: readonly CalibrationRun[] } {
  const cells: ComparisonCell[] = [];
  const runs: CalibrationRun[] = [];
  for (const r of recordings) {
    if (!hasCompleteSegments(r.recording)) continue;
    for (const config of configs) {
      const run = calibrateRecording(r.name, r.recording, config);
      runs.push(run);
      cells.push({
        recording: r.name,
        paramSet: config.name,
        labeled: true,
        evaluation: evaluateRecording(r.recording, run.params, options),
      });
    }
  }
  return { cells, runs };
}

function num(v: number | null, digits: number): string {
  return v === null || !Number.isFinite(v) ? "-" : v.toFixed(digits);
}

/** 1 本の記録のキャリブレーションの値の表（組を列に）．切り出した区間・測った値・上書き・使わなかった理由 */
export function formatCalibrationTable(runs: readonly CalibrationRun[]): string {
  if (runs.length === 0) return "";
  const t0 = runs[0].segments.length > 0 ? Math.min(...runs[0].segments.map((s) => s.startMs)) : 0;
  const win = (run: CalibrationRun, kind: CalibrationSegment["kind"]) => {
    const s = run.segments.find((x) => x.kind === kind);
    return s === undefined
      ? "-"
      : `${((s.startMs - t0) / 1000).toFixed(1)}+${((s.endMs - s.startMs) / 1000).toFixed(1)}`;
  };
  const m = (f: (r: CalibrationRun) => string) => runs.map(f);
  const rows: string[][] = [
    ["項目", ...runs.map((r) => r.config.name)],
    ["区間（立って静止の始まりからの秒+長さ）: 静止", ...m((r) => win(r, "standing"))],
    ["  足踏み", ...m((r) => win(r, "stepping"))],
    ["  しゃがむ", ...m((r) => win(r, "crouching"))],
    ["  しゃがみ歩き", ...m((r) => win(r, "crouchWalking"))],
    ["静止の揺れ（m/s^2．RMS）", ...m((r) => num(r.result.measurements.restNoiseAccel, 2))],
    ["  帯域通過後（m/s^2）", ...m((r) => num(r.result.measurements.restNoiseBand, 2))],
    ["  角速度（deg/s）", ...m((r) => num(r.result.measurements.restGyroDps, 1))],
    [
      "足踏みの山（m/s^2．中央値・山の数）",
      ...m(
        (r) =>
          `${num(r.result.measurements.stepPeakStanding, 2)}（${r.result.measurements.stepCountStanding}）`,
      ),
    ],
    ["  間隔（ms）", ...m((r) => num(r.result.measurements.stepIntervalMs, 0))],
    ["しゃがむ深さ（m）", ...m((r) => num(r.result.measurements.crouchDepth, 2))],
    ["  時間（ms）", ...m((r) => num(r.result.measurements.crouchDurationMs, 0))],
    [
      "  しゃがんだ後の揺れ（m/s^2）",
      ...m((r) => num(r.result.measurements.crouchHoldNoiseAccel, 2)),
    ],
    [
      "しゃがみ歩きの山（m/s^2．中央値・山の数）",
      ...m(
        (r) =>
          `${num(r.result.measurements.stepPeakCrouching, 2)}（${r.result.measurements.stepCountCrouching}）${r.result.measurements.crouchingEstimated ? " 見積もり" : ""}`,
      ),
    ],
  ];
  const keys = [...new Set(runs.flatMap((r) => Object.keys(r.result.overrides)))].sort();
  for (const key of keys) {
    rows.push([
      `→ ${key}（既定 ${DEFAULT_INPUT_PARAMS[key as keyof InputParams]}）`,
      ...m((r) => {
        const v = r.result.overrides[key as keyof InputParams];
        return v === undefined ? "-" : String(v);
      }),
    ]);
  }
  const notes = runs.flatMap((r) =>
    [...r.windowNotes, ...r.result.notes].map((n) => `  ${r.config.name}: ${n}`),
  );
  return `-- ${runs[0].recording} のキャリブレーション（キャリブレーションに使った部分も評価に含む）\n${formatTable(rows)}${notes.length > 0 ? `\n${notes.join("\n")}` : ""}`;
}
