// 開発サーバーが覚えておく，記録を送ってきている端末（セッション）の情報と，操作盤の印の組み立て．
// DOM にも Node にも依存しない純粋な関数（inputLogPlugin.ts が使う）
import { serverTimeToDeviceT } from "../recorder/clockSync";
import { isValidSessionId, MARK_KIND_PATTERN, MAX_MARK_NOTE_LENGTH } from "../recorder/logProtocol";
import type { ClockRecord, MarkRecord } from "../recorder/records";

/** 端末の判定の状態（操作盤に出す．最後の state レコードの一部） */
export interface SessionStateSummary {
  readonly t: number;
  readonly event: string;
  readonly posture: string;
  readonly loco: string;
  readonly walking: boolean;
}

export interface SessionInfo {
  readonly sessionId: string;
  /** logs/input/ の中のファイル名 */
  readonly file: string;
  /** 記録した dev ページ（meta の page） */
  readonly page: string | null;
  /** 端末の performance.timeOrigin（meta） */
  readonly timeOrigin: number | null;
  /** 端末の時刻合わせの結果（往復の最も速いもの） */
  readonly clock: Pick<ClockRecord, "t" | "serverTime" | "rtt"> | null;
  readonly lastState: SessionStateSummary | null;
  /** 最後に記録を受け取った開発サーバーの時刻（Date.now() の ms） */
  readonly lastSeen: number;
}

export function createSessionInfo(sessionId: string, file: string, now: number): SessionInfo {
  return {
    sessionId,
    file,
    page: null,
    timeOrigin: null,
    clock: null,
    lastState: null,
    lastSeen: now,
  };
}

function asRecord(v: unknown): Record<string, unknown> | null {
  return typeof v === "object" && v !== null && !Array.isArray(v)
    ? (v as Record<string, unknown>)
    : null;
}

function finite(v: unknown): number | null {
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

/**
 * 受け取った JSONL（検査済み）から，meta・clock・最後の state を拾って情報を更新する．
 * 読めない行は飛ばす（例外を投げない）
 */
export function updateSessionInfo(prev: SessionInfo, jsonl: string, now: number): SessionInfo {
  let { page, timeOrigin, clock, lastState } = prev;
  for (const line of jsonl.split("\n")) {
    if (line.trim() === "") continue;
    let r: Record<string, unknown> | null;
    try {
      r = asRecord(JSON.parse(line));
    } catch {
      continue;
    }
    if (r === null) continue;
    if (r.type === "meta") {
      if (typeof r.page === "string") page = r.page;
      timeOrigin = finite(r.timeOrigin) ?? timeOrigin;
    } else if (r.type === "clock") {
      const t = finite(r.t);
      const serverTime = finite(r.serverTime);
      const rtt = finite(r.rtt);
      if (t !== null && serverTime !== null && rtt !== null && rtt >= 0) {
        if (clock === null || rtt <= clock.rtt) clock = { t, serverTime, rtt };
      }
    } else if (r.type === "state") {
      const t = finite(r.t);
      if (t !== null && (lastState === null || t >= lastState.t)) {
        lastState = {
          t,
          event: String(r.event ?? ""),
          posture: String(r.posture ?? ""),
          loco: String(r.loco ?? ""),
          walking: r.walking === true,
        };
      }
    }
  }
  return { ...prev, page, timeOrigin, clock, lastState, lastSeen: now };
}

/** 最近（maxAgeMs 以内に）記録を送ってきたセッションを，新しい順に並べる */
export function recentSessions(
  infos: Iterable<SessionInfo>,
  now: number,
  maxAgeMs: number,
): SessionInfo[] {
  return [...infos]
    .filter((s) => now - s.lastSeen <= maxAgeMs)
    .sort((a, b) => b.lastSeen - a.lastSeen);
}

/** 押した時刻として受け付ける，開発サーバーの今の時刻からのずれの上限（ms）．超えたら受け取った時刻にする */
export const MAX_MARK_TIME_SKEW_MS = 60_000;

export type MarkRequestResult =
  | { readonly ok: true; readonly sessionId: string; readonly record: MarkRecord }
  | { readonly ok: false; readonly reason: string };

/**
 * 操作盤から届いた印の本文（JSON: { session, kind, note?, serverTime? }）を検査し，端末の時刻の基準の印にする．
 * serverTime（押した時の開発サーバーの時刻．操作盤が時刻合わせして求める）が無い・now から離れすぎていれば now を使う
 */
export function buildMarkRecord(
  body: unknown,
  sessions: ReadonlyMap<string, SessionInfo>,
  now: number,
): MarkRequestResult {
  const b = asRecord(body);
  if (b === null) return { ok: false, reason: "body is not a JSON object" };
  const sessionId = b.session;
  if (!isValidSessionId(sessionId)) return { ok: false, reason: "invalid session" };
  const info = sessions.get(sessionId);
  if (info === undefined) return { ok: false, reason: "unknown session" };
  const kind = b.kind;
  if (typeof kind !== "string" || !MARK_KIND_PATTERN.test(kind)) {
    return { ok: false, reason: "invalid kind" };
  }
  if (b.note !== undefined && typeof b.note !== "string") {
    return { ok: false, reason: "invalid note" };
  }
  const note = typeof b.note === "string" ? b.note.slice(0, MAX_MARK_NOTE_LENGTH) : undefined;
  const pressed = finite(b.serverTime);
  const serverTime =
    pressed !== null && Math.abs(pressed - now) <= MAX_MARK_TIME_SKEW_MS ? pressed : now;
  const converted = serverTimeToDeviceT(serverTime, info);
  if (converted === null) return { ok: false, reason: "no clock for session" };
  return {
    ok: true,
    sessionId,
    record: {
      type: "mark",
      t: Math.round(converted.t * 1000) / 1000,
      kind,
      ...(note === undefined || note === "" ? {} : { note }),
      source: "panel",
      clock: converted.clock,
    },
  };
}
