// フライトレコーダーの記録（JSONL）を読み，判定に流し直せる形にする（DOM に依存しない純粋な関数）．
// 再生のモック入力・再生と調整のページ・回帰テストで共通に使う（experiment_山﨑/10「記録の再生」）

import { isLogFileName } from "../dev/logFileName";
import type {
  InputRecord,
  LabelRecord,
  MarkRecord,
  MetaRecord,
  MotionRecord,
  OrientationRecord,
  ScreenRecord,
} from "../recorder/records";
import type { MotionSample, OrientationSample, ScreenSample } from "../sensors/types";

/** 記録を読んだ結果．読めない行は数だけ残す */
export interface ParsedLog {
  readonly records: readonly InputRecord[];
  /** JSON でない・type や t が無い等で飛ばした行の数 */
  readonly skipped: number;
}

const KNOWN_TYPES = new Set<string>([
  "meta",
  "detect",
  "state",
  "params",
  "motion",
  "orientation",
  "screen",
  "label",
  "mark",
  "clock",
  "visibility",
  "protocol",
  "hand",
]);

function isVec3(v: unknown): boolean {
  return (
    v === null ||
    (Array.isArray(v) &&
      v.length === 3 &&
      v.every((x) => typeof x === "number" && Number.isFinite(x)))
  );
}

/** 1 行が記録のレコードとして使えるか（判定に流す motion は配列の形まで確かめる） */
function asInputRecord(value: unknown): InputRecord | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return null;
  const r = value as Record<string, unknown>;
  if (typeof r.type !== "string" || !KNOWN_TYPES.has(r.type)) return null;
  if (typeof r.t !== "number" || !Number.isFinite(r.t)) return null;
  if (r.type === "motion" && !(isVec3(r.acc) && isVec3(r.accG) && isVec3(r.rot))) return null;
  return value as InputRecord;
}

/**
 * JSONL の文字列を記録のレコードの並びにする．空行は飛ばし，壊れた行は数えて飛ばす（例外を投げない）．
 * 開発サーバーへの送り直しで同じ行が重なることがあるため（重複は許し，欠けは作らない送り方），
 * まったく同じ行は 1 つにする（時刻を 0.001 ms まで残すため，別の出来事が同じ行になることはまず無い）
 */
export function parseRecordsJsonl(text: string): ParsedLog {
  const records: InputRecord[] = [];
  let skipped = 0;
  const seen = new Set<string>();
  for (const raw of text.split("\n")) {
    const line = raw.replace(/\r$/, "");
    if (line.trim() === "") continue;
    if (seen.has(line)) continue;
    seen.add(line);
    let value: unknown;
    try {
      value = JSON.parse(line);
    } catch {
      skipped++;
      continue;
    }
    const r = asInputRecord(value);
    if (r === null) skipped++;
    else records.push(r);
  }
  return { records, skipped };
}

/** 時刻の順に並べ直す（同じ時刻は元の順を保つ）．送り直しで順が前後した記録のため */
export function sortRecordsByTime(records: readonly InputRecord[]): InputRecord[] {
  return records
    .map((r, i) => ({ r, i }))
    .sort((a, b) => a.r.t - b.r.t || a.i - b.i)
    .map((x) => x.r);
}

export function motionSampleOf(r: MotionRecord): MotionSample {
  return {
    t: r.t,
    acc: r.acc === null ? null : { x: r.acc[0], y: r.acc[1], z: r.acc[2] },
    accG: r.accG === null ? null : { x: r.accG[0], y: r.accG[1], z: r.accG[2] },
    rot: r.rot === null ? null : { alpha: r.rot[0], beta: r.rot[1], gamma: r.rot[2] },
    interval: r.interval,
  };
}

export function orientationSampleOf(r: OrientationRecord): OrientationSample {
  return { t: r.t, alpha: r.alpha, beta: r.beta, gamma: r.gamma, absolute: r.absolute };
}

export function screenSampleOf(r: ScreenRecord): ScreenSample {
  return { t: r.t, angle: r.angle, orientationType: r.orientationType };
}

/** 手順の 1 区間（label の start と end の組） */
export interface LabelSegment {
  readonly label: string;
  readonly segment: number;
  readonly repeat: number;
  readonly startT: number;
  /** end が無い（記録が途中で切れた）時は記録の最後の時刻 */
  readonly endT: number;
}

/** label レコードの start・end を区間の番号で組にする．start が無い end は捨てる */
export function labelSegments(records: readonly InputRecord[]): LabelSegment[] {
  const open = new Map<number, LabelRecord>();
  const out: LabelSegment[] = [];
  let lastT = Number.NEGATIVE_INFINITY;
  for (const r of records) {
    if (r.t > lastT) lastT = r.t;
    if (r.type !== "label") continue;
    if (r.edge === "start") open.set(r.segment, r);
    else {
      const s = open.get(r.segment);
      if (s === undefined) continue;
      open.delete(r.segment);
      out.push({
        label: s.label,
        segment: s.segment,
        repeat: s.repeat,
        startT: s.t,
        endT: Math.max(s.t, r.t),
      });
    }
  }
  for (const s of open.values()) {
    out.push({
      label: s.label,
      segment: s.segment,
      repeat: s.repeat,
      startT: s.t,
      endT: Math.max(s.t, lastT),
    });
  }
  return out.sort((a, b) => a.startT - b.startT);
}

export function marksOf(records: readonly InputRecord[]): MarkRecord[] {
  return records.filter((r): r is MarkRecord => r.type === "mark");
}

export function metaOf(records: readonly InputRecord[]): MetaRecord | null {
  return records.find((r): r is MetaRecord => r.type === "meta") ?? null;
}

/** 記録した時のしきい値（最初の params レコード）．無ければ null */
export function recordedParamsOf(
  records: readonly InputRecord[],
): Readonly<Record<string, number>> | null {
  for (const r of records) if (r.type === "params") return r.params;
  return null;
}

/** motion の時刻の範囲（motion が無ければ null） */
export function motionTimeRange(
  records: readonly InputRecord[],
): { readonly startT: number; readonly endT: number } | null {
  let startT = Number.POSITIVE_INFINITY;
  let endT = Number.NEGATIVE_INFINITY;
  for (const r of records) {
    if (r.type !== "motion") continue;
    if (r.t < startT) startT = r.t;
    if (r.t > endT) endT = r.t;
  }
  return startT <= endT ? { startT, endT } : null;
}

/** 再生で入力に流す出来事（センサーのサンプルと，判定を初期化するタブの切り替え） */
export type ReplayEvent =
  | { readonly kind: "motion"; readonly t: number; readonly sample: MotionSample }
  | { readonly kind: "orientation"; readonly t: number; readonly sample: OrientationSample }
  | { readonly kind: "screen"; readonly t: number; readonly sample: ScreenSample }
  | { readonly kind: "visibility"; readonly t: number };

/** 記録から，入力に流す出来事を時刻の順に取り出す（判定の結果・印等は含めない） */
export function replayEventsOf(records: readonly InputRecord[]): ReplayEvent[] {
  const out: ReplayEvent[] = [];
  for (const r of sortRecordsByTime(records)) {
    if (r.type === "motion") out.push({ kind: "motion", t: r.t, sample: motionSampleOf(r) });
    else if (r.type === "orientation")
      out.push({ kind: "orientation", t: r.t, sample: orientationSampleOf(r) });
    else if (r.type === "screen") out.push({ kind: "screen", t: r.t, sample: screenSampleOf(r) });
    else if (r.type === "visibility") out.push({ kind: "visibility", t: r.t });
  }
  return out;
}

/**
 * fromIndex から，時刻が untilT 以下の出来事の終わり（次に流す番号）を返す．
 * 再生のモック入力が描画のたびに「今の時刻までの分」を流すために使う．untilT が NaN なら進めない
 */
export function replayIndexUntil(
  events: readonly ReplayEvent[],
  fromIndex: number,
  untilT: number,
): number {
  let i = Math.max(0, Math.min(events.length, Math.floor(fromIndex) || 0));
  if (Number.isNaN(untilT)) return i;
  while (i < events.length && events[i].t <= untilT) i++;
  return i;
}

/** ?input=replay の時の再生の指定（URL パラメータ） */
export interface ReplaySearch {
  /** logs/input/ の記録のファイル名（?log=）．null なら最も新しい記録 */
  readonly log: string | null;
  /** 記録の最初の motion から何秒の所から流すか（?from=．0 以上） */
  readonly fromSec: number;
  /** 最後まで流したら最初に戻るか（?loop=0 で止める．既定は戻る） */
  readonly loop: boolean;
}

/**
 * ?log=・?from=・?loop= を読む．ファイル名の書式に合わない log は null（ほかのファイルを読ませない），
 * 数でない・負の from は 0 にする
 */
export function parseReplaySearch(search: string): ReplaySearch {
  const q = new URLSearchParams(search);
  const log = q.get("log")?.trim() ?? null;
  const from = Number(q.get("from") ?? "0");
  const loop = q.get("loop");
  return {
    log: isLogFileName(log) ? log : null,
    fromSec: Number.isFinite(from) && from > 0 ? from : 0,
    loop: !(loop === "0" || loop === "false"),
  };
}
