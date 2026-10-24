// 手順記録の手順の定義と，スケジュールの計算・ラベル付け（DOM に依存しない純粋な関数）．
// 各区間の前に準備の時間を置き，「準備 → 動作 → 準備 → 動作 …」と進める．
// 時刻はすべて手順の開始（時刻 0）からの相対の ms
import type { LabelRecord } from "./records";

/** 手順の 1 種類 */
export interface ProtocolStep {
  /** 記録のラベル（英小文字とアンダースコア） */
  readonly label: string;
  /** 画面に出す名前 */
  readonly title: string;
  /** 画面と音声で伝える指示 */
  readonly instruction: string;
  /** 1 回の長さ（秒） */
  readonly durationSec: number;
  /** 繰り返す回数（省略時 1）．回ごとに別の区間になり，間に準備の時間が入る．切り捨てて 1 未満・NaN なら手順ごと飛ばす */
  readonly repeat?: number;
}

/** 既定の手順（1 人約 4〜5 分．experiment_山﨑/06「実験の手順」） */
export const DEFAULT_PROTOCOL_STEPS: readonly ProtocolStep[] = [
  { label: "still", title: "静止", instruction: "立ったまま動かずにいてください", durationSec: 30 },
  {
    label: "look_around",
    title: "見回し",
    instruction: "立ったまま，ゆっくり周りを見回してください",
    durationSec: 30,
  },
  { label: "nod", title: "頷き", instruction: "立ったまま，頷いてください", durationSec: 15 },
  {
    label: "step_in_place",
    title: "足踏み",
    instruction: "その場で足踏みをしてください",
    durationSec: 15,
    repeat: 3,
  },
  {
    // しゃがむ・立つ × 10 回を 1 つの区間にする（1 回 4 秒の目安）
    label: "squat_stand",
    title: "しゃがむ・立つ",
    instruction: "しゃがんで立つ，を 10 回くり返してください",
    durationSec: 40,
  },
  {
    label: "crouch_walk",
    title: "しゃがみ歩き",
    instruction: "しゃがんだまま，その場で足踏みをしてください",
    durationSec: 15,
    repeat: 2,
  },
  {
    label: "crouch_still",
    title: "しゃがんで静止",
    instruction: "しゃがんだまま動かずにいてください",
    durationSec: 30,
  },
];

/** 区間の前の準備の時間の既定値（秒）．指示の音声と，3・2・1 の合図が入る長さにする */
export const DEFAULT_PREP_SEC = 6;

/** スケジュールの 1 区間（手順の 1 回分） */
export interface ProtocolSegment {
  /** 全体の中の番号（0 始まり） */
  readonly index: number;
  readonly step: ProtocolStep;
  /** 同じ手順の何回目か（1 始まり）と全回数 */
  readonly repeat: number;
  readonly repeatCount: number;
  /** 準備の始まり・動作の始まり・動作の終わり */
  readonly prepStartMs: number;
  readonly startMs: number;
  readonly endMs: number;
}

export interface ProtocolSchedule {
  readonly segments: readonly ProtocolSegment[];
  readonly prepMs: number;
  /** 最後の区間が終わる時刻 */
  readonly totalMs: number;
}

function positiveOr(v: number | undefined, fallback: number): number {
  return v !== undefined && Number.isFinite(v) && v > 0 ? v : fallback;
}

/** 手順の並びからスケジュールを作る．長さ・回数が不正な手順は飛ばす */
export function buildSchedule(
  steps: readonly ProtocolStep[],
  prepSec: number = DEFAULT_PREP_SEC,
): ProtocolSchedule {
  const prepMs = Number.isFinite(prepSec) && prepSec >= 0 ? Math.round(prepSec * 1000) : 0;
  const segments: ProtocolSegment[] = [];
  let cursor = 0;
  for (const step of steps) {
    const durationMs = Math.round(positiveOr(step.durationSec, 0) * 1000);
    // repeat は省略した時だけ 1 回．指定した値は切り捨てて 1 以上の有限数でなければ手順ごと飛ばす
    const repeatCount = step.repeat === undefined ? 1 : Math.floor(step.repeat);
    if (!Number.isFinite(repeatCount)) continue;
    if (durationMs <= 0 || repeatCount <= 0) continue;
    for (let r = 1; r <= repeatCount; r++) {
      const prepStartMs = cursor;
      const startMs = prepStartMs + prepMs;
      const endMs = startMs + durationMs;
      segments.push({
        index: segments.length,
        step,
        repeat: r,
        repeatCount,
        prepStartMs,
        startMs,
        endMs,
      });
      cursor = endMs;
    }
  }
  return { segments, prepMs, totalMs: cursor };
}

/** ある時刻の位置．before は開始前（負の時刻），done は全部終わった後 */
export type ProtocolPosition =
  | { readonly phase: "before" }
  | {
      readonly phase: "prep" | "active";
      readonly segment: ProtocolSegment;
      /** 今の段階（準備・動作）の残り（ms） */
      readonly remainingMs: number;
    }
  | { readonly phase: "done" };

/** 時刻 elapsedMs が，どの区間のどの段階か */
export function locate(schedule: ProtocolSchedule, elapsedMs: number): ProtocolPosition {
  if (!Number.isFinite(elapsedMs) || elapsedMs < 0) return { phase: "before" };
  // 区間は数十個なので線形に探す
  for (const segment of schedule.segments) {
    if (elapsedMs < segment.startMs) {
      return { phase: "prep", segment, remainingMs: segment.startMs - elapsedMs };
    }
    if (elapsedMs < segment.endMs) {
      return { phase: "active", segment, remainingMs: segment.endMs - elapsedMs };
    }
  }
  return { phase: "done" };
}

/** スケジュールの節目 */
export type ProtocolEventKind = "prep" | "start" | "end" | "done";

export interface ProtocolEvent {
  readonly atMs: number;
  readonly kind: ProtocolEventKind;
  /** done の時は null */
  readonly segment: ProtocolSegment | null;
}

/** 節目を時刻の順に並べる．同じ時刻なら「前の区間の end → 次の区間の prep」の順 */
export function scheduleEvents(schedule: ProtocolSchedule): readonly ProtocolEvent[] {
  const events: ProtocolEvent[] = [];
  for (const segment of schedule.segments) {
    events.push({ atMs: segment.prepStartMs, kind: "prep", segment });
    events.push({ atMs: segment.startMs, kind: "start", segment });
    events.push({ atMs: segment.endMs, kind: "end", segment });
  }
  events.push({ atMs: schedule.totalMs, kind: "done", segment: null });
  return events;
}

/**
 * 前回までに処理した位置 cursor（events の添え字）から，elapsedMs までに来た節目を取り出す．
 * タイマーが遅れて複数の節目をまたいでも，飛ばさずに順に返す
 */
export function takeDueEvents(
  events: readonly ProtocolEvent[],
  cursor: number,
  elapsedMs: number,
): { readonly due: readonly ProtocolEvent[]; readonly cursor: number } {
  let next = Math.max(0, Math.floor(cursor));
  const due: ProtocolEvent[] = [];
  while (next < events.length && events[next].atMs <= elapsedMs) {
    due.push(events[next]);
    next++;
  }
  return { due, cursor: next };
}

/**
 * 節目からラベルのレコードを作る．動作の始まり・終わりだけがラベルになる（準備・done は null）．
 * t は実際に案内した時刻，t0 は手順の時刻 0（いずれも performance.now() の ms）
 */
export function labelRecordFor(event: ProtocolEvent, t: number, t0: number): LabelRecord | null {
  if (event.segment === null || (event.kind !== "start" && event.kind !== "end")) return null;
  return {
    type: "label",
    t,
    plannedT: t0 + event.atMs,
    label: event.segment.step.label,
    edge: event.kind,
    segment: event.segment.index,
    repeat: event.segment.repeat,
    repeatCount: event.segment.repeatCount,
  };
}
