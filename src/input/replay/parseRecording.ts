// フライトレコーダーの記録（JSONL）を読み，判定に流し直すためのサンプルと手順の区間に分ける（experiment_山﨑/10「記録の再生」・11）．
// DOM にも Node にも依存しない純粋な関数．壊れた行・知らない種類の行は数えて飛ばす（例外を投げない）
import type { Vec3 } from "../../core/types";
import type {
  CueRecord,
  LabelRecord,
  MarkRecord,
  MetaRecord,
  ProtocolRecord,
  VisibilityRecord,
} from "../recorder/records";
import type { MotionSample, RotationRate } from "../sensors/types";

/** 読んだ記録 */
export interface ParsedRecording {
  /** 最初の meta（無ければ null） */
  readonly meta: MetaRecord | null;
  /** devicemotion のサンプル（記録の順） */
  readonly motions: readonly MotionSample[];
  readonly labels: readonly LabelRecord[];
  readonly cues: readonly CueRecord[];
  /** 最初の protocol（手順記録ページの記録だけにある） */
  readonly protocol: ProtocolRecord | null;
  readonly marks: readonly MarkRecord[];
  readonly visibility: readonly VisibilityRecord[];
  /** 記録した時のしきい値（最初の params．無ければ null） */
  readonly params: Readonly<Record<string, number>> | null;
  /** 読めなかった行の数（JSON でない・形が合わない） */
  readonly badLines: number;
}

type Json = Record<string, unknown>;

function isObject(v: unknown): v is Json {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function isFiniteNumber(v: unknown): v is number {
  return typeof v === "number" && Number.isFinite(v);
}

function vec3Of(v: unknown): Vec3 | null {
  if (!Array.isArray(v) || v.length !== 3) return null;
  const [x, y, z] = v;
  return isFiniteNumber(x) && isFiniteNumber(y) && isFiniteNumber(z) ? { x, y, z } : null;
}

function rotOf(v: unknown): RotationRate | null {
  const r = vec3Of(v);
  return r === null ? null : { alpha: r.x, beta: r.y, gamma: r.z };
}

/** motion の行をサンプルにする．時刻が無い・値が 1 つも無ければ null */
export function motionSampleOf(o: Json): MotionSample | null {
  if (!isFiniteNumber(o.t)) return null;
  const acc = vec3Of(o.acc);
  const accG = vec3Of(o.accG);
  const rot = rotOf(o.rot);
  if (acc === null && accG === null && rot === null) return null;
  const interval = isFiniteNumber(o.interval) ? o.interval : null;
  return { t: o.t, acc, accG, rot, interval };
}

function labelOf(o: Json): LabelRecord | null {
  if (
    !isFiniteNumber(o.t) ||
    typeof o.label !== "string" ||
    (o.edge !== "start" && o.edge !== "end") ||
    !isFiniteNumber(o.segment)
  ) {
    return null;
  }
  return {
    type: "label",
    t: o.t,
    plannedT: isFiniteNumber(o.plannedT) ? o.plannedT : o.t,
    label: o.label,
    edge: o.edge,
    segment: o.segment,
    repeat: isFiniteNumber(o.repeat) ? o.repeat : 1,
    repeatCount: isFiniteNumber(o.repeatCount) ? o.repeatCount : 1,
  };
}

function cueOf(o: Json): CueRecord | null {
  if (!isFiniteNumber(o.t) || typeof o.cue !== "string" || !isFiniteNumber(o.segment)) return null;
  return {
    type: "cue",
    t: o.t,
    plannedT: isFiniteNumber(o.plannedT) ? o.plannedT : o.t,
    cue: o.cue,
    index: isFiniteNumber(o.index) ? o.index : 0,
    label: typeof o.label === "string" ? o.label : "",
    segment: o.segment,
  };
}

function protocolOf(o: Json): ProtocolRecord | null {
  if (!isFiniteNumber(o.t) || !isFiniteNumber(o.t0) || !Array.isArray(o.segments)) return null;
  const segments: { label: string; startMs: number; endMs: number }[] = [];
  for (const s of o.segments) {
    if (
      isObject(s) &&
      typeof s.label === "string" &&
      isFiniteNumber(s.startMs) &&
      isFiniteNumber(s.endMs)
    ) {
      segments.push({ label: s.label, startMs: s.startMs, endMs: s.endMs });
    }
  }
  return {
    type: "protocol",
    t: o.t,
    t0: o.t0,
    prepMs: isFiniteNumber(o.prepMs) ? o.prepMs : 0,
    segments,
  };
}

function paramsOf(o: Json): Record<string, number> | null {
  if (!isObject(o.params)) return null;
  const out: Record<string, number> = {};
  for (const [k, v] of Object.entries(o.params)) if (isFiniteNumber(v)) out[k] = v;
  return out;
}

/** JSONL の文字列を読む．空行は飛ばす */
export function parseRecording(text: string): ParsedRecording {
  let meta: MetaRecord | null = null;
  let protocol: ProtocolRecord | null = null;
  let params: Record<string, number> | null = null;
  const motions: MotionSample[] = [];
  const labels: LabelRecord[] = [];
  const cues: CueRecord[] = [];
  const marks: MarkRecord[] = [];
  const visibility: VisibilityRecord[] = [];
  let badLines = 0;

  for (const raw of text.split("\n")) {
    const line = raw.trim();
    if (line === "") continue;
    let o: unknown;
    try {
      o = JSON.parse(line);
    } catch {
      badLines++;
      continue;
    }
    if (!isObject(o)) {
      badLines++;
      continue;
    }
    switch (o.type) {
      case "motion": {
        const m = motionSampleOf(o);
        if (m === null) badLines++;
        else motions.push(m);
        break;
      }
      case "label": {
        const l = labelOf(o);
        if (l === null) badLines++;
        else labels.push(l);
        break;
      }
      case "cue": {
        const c = cueOf(o);
        if (c === null) badLines++;
        else cues.push(c);
        break;
      }
      case "protocol":
        if (protocol === null) protocol = protocolOf(o);
        break;
      case "meta":
        // 中身は表示にしか使わないため，形は確かめずに残す
        if (meta === null && isFiniteNumber(o.t)) meta = o as unknown as MetaRecord;
        break;
      case "params":
        if (params === null) params = paramsOf(o);
        break;
      case "mark":
        if (isFiniteNumber(o.t) && typeof o.kind === "string") {
          marks.push({
            type: "mark",
            t: o.t,
            kind: o.kind,
            ...(typeof o.note === "string" ? { note: o.note } : {}),
          });
        }
        break;
      case "visibility":
        if (isFiniteNumber(o.t) && (o.state === "visible" || o.state === "hidden")) {
          visibility.push({ type: "visibility", t: o.t, state: o.state });
        }
        break;
      default:
        // detect・state・orientation・screen は流し直しでは使わない
        break;
    }
  }
  return { meta, motions, labels, cues, protocol, marks, visibility, params, badLines };
}

/** 手順の 1 区間（記録の時刻．ms） */
export interface LabeledSegment {
  /** 手順全体の中の番号（0 始まり） */
  readonly index: number;
  readonly label: string;
  readonly repeat: number;
  readonly repeatCount: number;
  /** 動作の始まり・終わり（案内した時刻） */
  readonly startT: number;
  readonly endT: number;
  /** 終わりまで記録があるか（途中で中止した・記録が途切れた区間は false．集計の合否には使わない） */
  readonly complete: boolean;
  /** 区間の中の合図（時刻の順） */
  readonly cues: readonly CueRecord[];
}

/**
 * 記録から手順の区間を取り出す．label の start・end を基本にし，ラベルが無い区間は protocol の予定の時刻で補う．
 * 終わりのラベルが無い区間は，最後のサンプルの時刻（中止の印があればその時刻）で切り，complete を false にする
 */
export function segmentsOf(rec: ParsedRecording): LabeledSegment[] {
  const lastT = rec.motions.length > 0 ? rec.motions[rec.motions.length - 1].t : Number.NaN;
  const aborted = rec.marks.find((m) => m.kind === "protocol_aborted");
  const stopT = aborted !== undefined && !(aborted.t > lastT) ? aborted.t : lastT;

  const byIndex = new Map<
    number,
    { label: string; repeat: number; repeatCount: number; start?: number; end?: number }
  >();
  for (const l of rec.labels) {
    const s = byIndex.get(l.segment) ?? {
      label: l.label,
      repeat: l.repeat,
      repeatCount: l.repeatCount,
    };
    if (l.edge === "start" && s.start === undefined) s.start = l.t;
    if (l.edge === "end" && s.end === undefined) s.end = l.t;
    byIndex.set(l.segment, s);
  }
  // ラベルが 1 つも無い区間は，予定の時刻のうち記録の中に始まりがあるものだけを補う
  if (rec.protocol !== null) {
    const p = rec.protocol;
    p.segments.forEach((seg, index) => {
      if (byIndex.has(index)) return;
      const start = p.t0 + seg.startMs;
      if (!(start < stopT)) return;
      const end = p.t0 + seg.endMs;
      byIndex.set(index, {
        label: seg.label,
        repeat: 1,
        repeatCount: 1,
        start,
        ...(end <= stopT ? { end } : {}),
      });
    });
  }

  const out: LabeledSegment[] = [];
  for (const [index, s] of [...byIndex.entries()].sort((a, b) => a[0] - b[0])) {
    const start = s.start;
    if (start === undefined) continue;
    const end = s.end;
    const complete =
      end !== undefined && end <= lastT && (aborted === undefined || aborted.t >= end);
    const endT = end !== undefined && !(end > stopT) ? end : stopT;
    if (!(endT > start)) continue;
    const cues = rec.cues
      .filter((c) => c.segment === index && c.t >= start && c.t <= endT)
      .sort((a, b) => a.t - b.t);
    out.push({
      index,
      label: s.label,
      repeat: s.repeat,
      repeatCount: s.repeatCount,
      startT: start,
      endT,
      complete,
      cues,
    });
  }
  return out;
}

/** 正解（手順のラベル）付きの記録か */
export function hasProtocolLabels(rec: ParsedRecording): boolean {
  return rec.labels.length > 0 || rec.protocol !== null;
}

/** 正解付きで，終わりまで記録された区間が 1 つ以上ある（集計に使える）記録か */
export function hasCompleteSegments(rec: ParsedRecording): boolean {
  return hasProtocolLabels(rec) && segmentsOf(rec).some((s) => s.complete);
}
