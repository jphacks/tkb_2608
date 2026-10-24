// フライトレコーダーの記録の形式と JSONL への整形（DOM に依存しない純粋な関数）．
// 1 行に 1 レコード．type で種類を区別する（experiment_山﨑/10「記録するもの」）．
// t はすべて performance.now() の基準（ms）．壁時計への換算は meta の timeOrigin を足す
import type { MotionSample, OrientationSample, ScreenSample } from "../sensors/types";

/** 記録の形式の版．項目の意味を変えたら上げる */
export const RECORD_FORMAT_VERSION = 1;

/** セッションの文脈（最初に 1 回．ページや端末の情報） */
export interface MetaRecord {
  readonly type: "meta";
  readonly t: number;
  readonly version: number;
  readonly sessionId: string;
  /** どの dev ページで記録したか（"sensors"・"protocol" 等） */
  readonly page: string;
  /** 記録を始めた壁時計の時刻（ISO 8601） */
  readonly startedAt: string;
  /** performance.timeOrigin（ms）．t + timeOrigin で壁時計の時刻になる */
  readonly timeOrigin: number;
  readonly userAgent: string;
  readonly screen: { readonly width: number; readonly height: number; readonly dpr: number };
  /** センサーの許可の結果など，ページが足す情報 */
  readonly extra?: Readonly<Record<string, unknown>>;
}

/** devicemotion．配列は [x, y, z]・[alpha, beta, gamma] の順．取れない項目は null */
export interface MotionRecord {
  readonly type: "motion";
  readonly t: number;
  readonly acc: readonly [number, number, number] | null;
  readonly accG: readonly [number, number, number] | null;
  readonly rot: readonly [number, number, number] | null;
  readonly interval: number | null;
}

export interface OrientationRecord {
  readonly type: "orientation";
  readonly t: number;
  readonly alpha: number | null;
  readonly beta: number | null;
  readonly gamma: number | null;
  readonly absolute: boolean;
}

export interface ScreenRecord {
  readonly type: "screen";
  readonly t: number;
  readonly angle: number;
  readonly orientationType: string | null;
}

/** 手順の区間の始まり・終わり（手順記録ページが案内した時刻に書く） */
export interface LabelRecord {
  readonly type: "label";
  /** 実際に案内した時刻 */
  readonly t: number;
  /** 予定の時刻（手順の開始時刻 + 区間の相対時刻） */
  readonly plannedT: number;
  readonly label: string;
  readonly edge: "start" | "end";
  /** 手順全体の中の区間の番号（0 始まり） */
  readonly segment: number;
  /** 同じ手順の何回目か（1 始まり）と全回数 */
  readonly repeat: number;
  readonly repeatCount: number;
}

/** 見ている人が付ける印（今は形だけ．PC の操作盤は後で作る） */
export interface MarkRecord {
  readonly type: "mark";
  readonly t: number;
  readonly kind: string;
  readonly note?: string;
}

/** タブが裏に回った・戻った（dt が飛ぶ区間を後で見分けるため．experiment_山﨑/09） */
export interface VisibilityRecord {
  readonly type: "visibility";
  readonly t: number;
  readonly state: "visible" | "hidden";
}

/** 手順記録ページの手順の全体（開始時に 1 回） */
export interface ProtocolRecord {
  readonly type: "protocol";
  readonly t: number;
  /** 手順の時刻 0（performance.now() の ms） */
  readonly t0: number;
  readonly prepMs: number;
  readonly segments: readonly {
    readonly label: string;
    readonly startMs: number;
    readonly endMs: number;
  }[];
}

export type InputRecord =
  | MetaRecord
  | MotionRecord
  | OrientationRecord
  | ScreenRecord
  | LabelRecord
  | MarkRecord
  | VisibilityRecord
  | ProtocolRecord;

/** 小数点以下 digits 桁に丸める（記録を小さくするため）．有限でなければ null */
export function roundTo(v: number, digits: number): number | null {
  if (!Number.isFinite(v)) return null;
  const p = 10 ** digits;
  const r = Math.round(v * p) / p;
  // -0 を 0 にする（JSON では同じだが，テストで比べやすくする）
  return r === 0 ? 0 : r;
}

/** 時刻は 0.001 ms，加速度は 0.0001 m/s^2，角度・角速度は 0.001 deg の桁で残す */
const T_DIGITS = 3;
const ACC_DIGITS = 4;
const ANGLE_DIGITS = 3;

function round3(
  a: number,
  b: number,
  c: number,
  digits: number,
): readonly [number, number, number] | null {
  const ra = roundTo(a, digits);
  const rb = roundTo(b, digits);
  const rc = roundTo(c, digits);
  return ra === null || rb === null || rc === null ? null : [ra, rb, rc];
}

function roundOrNull(v: number | null, digits: number): number | null {
  return v === null ? null : roundTo(v, digits);
}

function roundT(t: number): number {
  return roundTo(t, T_DIGITS) ?? 0;
}

export function motionRecord(s: MotionSample): MotionRecord {
  return {
    type: "motion",
    t: roundT(s.t),
    acc: s.acc === null ? null : round3(s.acc.x, s.acc.y, s.acc.z, ACC_DIGITS),
    accG: s.accG === null ? null : round3(s.accG.x, s.accG.y, s.accG.z, ACC_DIGITS),
    rot: s.rot === null ? null : round3(s.rot.alpha, s.rot.beta, s.rot.gamma, ANGLE_DIGITS),
    interval: roundOrNull(s.interval, T_DIGITS),
  };
}

export function orientationRecord(s: OrientationSample): OrientationRecord {
  return {
    type: "orientation",
    t: roundT(s.t),
    alpha: roundOrNull(s.alpha, ANGLE_DIGITS),
    beta: roundOrNull(s.beta, ANGLE_DIGITS),
    gamma: roundOrNull(s.gamma, ANGLE_DIGITS),
    absolute: s.absolute,
  };
}

export function screenRecord(s: ScreenSample): ScreenRecord {
  return { type: "screen", t: roundT(s.t), angle: s.angle, orientationType: s.orientationType };
}

/**
 * 1 レコードを JSONL の 1 行にする（末尾の改行は付けない）．
 * NaN・Infinity は JSON.stringify で null になる．循環参照等で整形できない時は null（例外を投げない）
 */
export function toRecordLine(record: InputRecord): string | null {
  try {
    const line = JSON.stringify(record);
    // 文字列中の改行は JSON.stringify がエスケープするため，1 行に収まる
    return typeof line === "string" ? line : null;
  } catch {
    return null;
  }
}

/** 行の並びを JSONL にする（各行の末尾に改行．空なら空文字列） */
export function joinJsonl(lines: readonly string[]): string {
  return lines.length === 0 ? "" : `${lines.join("\n")}\n`;
}

/** レコードの並びを JSONL にする．整形できないレコードは飛ばす */
export function toJsonl(records: readonly InputRecord[]): string {
  const lines: string[] = [];
  for (const r of records) {
    const line = toRecordLine(r);
    if (line !== null) lines.push(line);
  }
  return joinJsonl(lines);
}
