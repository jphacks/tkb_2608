// 開発サーバーが覚える端末の情報と，操作盤の印の組み立て（experiment_山﨑/10「印の付け方」・ENV_04「操作盤（PC）」）
import { describe, expect, it } from "vitest";
import { MAX_MARK_NOTE_LENGTH } from "../recorder/logProtocol";
import {
  buildMarkRecord,
  createSessionInfo,
  MAX_MARK_TIME_SKEW_MS,
  recentSessions,
  type SessionInfo,
  updateSessionInfo,
} from "./sessionInfo";

const NOW = 1_700_000_000_000;

function info(o: Partial<SessionInfo> = {}): SessionInfo {
  return { ...createSessionInfo("abc123", "20261024-143537_abc123.jsonl", NOW), ...o };
}

function lines(...values: unknown[]): string {
  return `${values.map((v) => (typeof v === "string" ? v : JSON.stringify(v))).join("\n")}\n`;
}

describe("createSessionInfo", () => {
  it("セッション・ファイル・受け取った時刻だけを持ち，ほかは null", () => {
    expect(createSessionInfo("s", "f.jsonl", 5)).toEqual({
      sessionId: "s",
      file: "f.jsonl",
      page: null,
      timeOrigin: null,
      clock: null,
      lastState: null,
      lastSeen: 5,
    });
  });
});

describe("updateSessionInfo", () => {
  it("meta からページと timeOrigin を拾う", () => {
    const next = updateSessionInfo(
      info(),
      lines({ type: "meta", t: 0, page: "goggles", timeOrigin: 123 }),
      NOW + 1,
    );
    expect(next).toMatchObject({ page: "goggles", timeOrigin: 123, lastSeen: NOW + 1 });
  });

  it("meta の timeOrigin が数でなければ前の値を保つ", () => {
    const next = updateSessionInfo(
      info({ timeOrigin: 5 }),
      lines({ type: "meta", t: 0, timeOrigin: "x" }),
      NOW,
    );
    expect(next.timeOrigin).toBe(5);
  });

  it("clock は往復の最も速いものを残す", () => {
    const a = updateSessionInfo(
      info(),
      lines(
        { type: "clock", t: 10, serverTime: 100, rtt: 30 },
        { type: "clock", t: 20, serverTime: 200, rtt: 10 },
        { type: "clock", t: 30, serverTime: 300, rtt: 20 },
      ),
      NOW,
    );
    expect(a.clock).toEqual({ t: 20, serverTime: 200, rtt: 10 });
    const b = updateSessionInfo(a, lines({ type: "clock", t: 40, serverTime: 400, rtt: 50 }), NOW);
    expect(b.clock).toEqual({ t: 20, serverTime: 200, rtt: 10 });
  });

  it.each([
    { type: "clock", t: 1, serverTime: 2, rtt: -1 },
    { type: "clock", t: 1, serverTime: 2 },
    { type: "clock", t: null, serverTime: 2, rtt: 1 },
    { type: "clock", t: 1, serverTime: "2", rtt: 1 },
  ])("壊れた clock（%o）は使わない", (rec) => {
    expect(updateSessionInfo(info(), lines(rec), NOW).clock).toBeNull();
  });

  it("最後の state を残す（時刻が古い state は無視する）", () => {
    const next = updateSessionInfo(
      info(),
      lines(
        {
          type: "state",
          t: 200,
          event: "walk",
          posture: "standing",
          loco: "walking",
          walking: true,
        },
        { type: "state", t: 100, event: "old", posture: "crouching", loco: "idle", walking: false },
      ),
      NOW,
    );
    expect(next.lastState).toEqual({
      t: 200,
      event: "walk",
      posture: "standing",
      loco: "walking",
      walking: true,
    });
  });

  it("state の walking は true の時だけ true", () => {
    const next = updateSessionInfo(info(), lines({ type: "state", t: 1, walking: "yes" }), NOW);
    expect(next.lastState?.walking).toBe(false);
  });

  it("読めない行・空行・オブジェクトでない行は飛ばす（例外を投げない）", () => {
    const next = updateSessionInfo(
      info(),
      lines("not json", "[1]", "null", "", { type: "meta", t: 0, page: "p", timeOrigin: 1 }),
      NOW,
    );
    expect(next.page).toBe("p");
  });

  it("元の情報は書き換えない", () => {
    const prev = info();
    updateSessionInfo(prev, lines({ type: "meta", t: 0, page: "p", timeOrigin: 1 }), NOW + 5);
    expect(prev.page).toBeNull();
    expect(prev.lastSeen).toBe(NOW);
  });
});

describe("recentSessions", () => {
  it("最近（上限ちょうどを含む）送ってきたものを新しい順に並べる", () => {
    const a = info({ sessionId: "a", lastSeen: 100 });
    const b = info({ sessionId: "b", lastSeen: 300 });
    const c = info({ sessionId: "c", lastSeen: 0 });
    expect(recentSessions([a, b, c], 1000, 900).map((s) => s.sessionId)).toEqual(["b", "a"]);
  });

  it("無ければ空", () => {
    expect(recentSessions([], NOW, 1000)).toEqual([]);
  });
});

describe("buildMarkRecord", () => {
  /** 時刻合わせ済み: 端末の t = 開発サーバーの時刻 − (NOW − 1000) */
  const synced = info({ clock: { t: 1000, serverTime: NOW, rtt: 5 } });
  const sessions = new Map<string, SessionInfo>([[synced.sessionId, synced]]);

  function body(o: Record<string, unknown> = {}): Record<string, unknown> {
    return { session: synced.sessionId, kind: "false-walk", ...o };
  }

  it("押した時刻を端末の時刻に換算した印にする（sync）", () => {
    const r = buildMarkRecord(body({ serverTime: NOW + 500 }), sessions, NOW + 600);
    expect(r).toEqual({
      ok: true,
      sessionId: "abc123",
      record: { type: "mark", t: 1500, kind: "false-walk", source: "panel", clock: "sync" },
    });
  });

  it("押した時刻が無ければ受け取った時刻を使う", () => {
    const r = buildMarkRecord(body(), sessions, NOW + 200);
    expect(r.ok && r.record.t).toBe(1200);
  });

  it.each([
    ["NaN", Number.NaN],
    ["文字列", "123"],
    ["null", null],
    ["上限より前", NOW + 1000 - MAX_MARK_TIME_SKEW_MS - 1],
    ["上限より後", NOW + 1000 + MAX_MARK_TIME_SKEW_MS + 1],
  ])("押した時刻が使えない（%s）なら受け取った時刻を使う", (_, serverTime) => {
    const r = buildMarkRecord(body({ serverTime }), sessions, NOW + 1000);
    expect(r.ok && r.record.t).toBe(2000);
  });

  it("押した時刻のずれが上限ちょうどなら使う", () => {
    const r = buildMarkRecord(
      body({ serverTime: NOW + 1000 - MAX_MARK_TIME_SKEW_MS }),
      sessions,
      NOW + 1000,
    );
    expect(r.ok && r.record.t).toBe(2000 - MAX_MARK_TIME_SKEW_MS);
  });

  it("時刻合わせの前は端末の壁時計で換算し，clock を wall にする", () => {
    const wall = info({ timeOrigin: NOW - 3000 });
    const r = buildMarkRecord(body(), new Map([[wall.sessionId, wall]]), NOW);
    expect(r).toMatchObject({ ok: true, record: { t: 3000, clock: "wall" } });
  });

  it("時刻を 0.001 ms に丸める", () => {
    const s = info({ clock: { t: 1000.12345, serverTime: 1000, rtt: 1 } });
    const r = buildMarkRecord(body(), new Map([[s.sessionId, s]]), 1000);
    expect(r.ok && r.record.t).toBe(1000.123);
  });

  it("説明を添え，上限の長さで切る．空の説明は書かない", () => {
    const long = "あ".repeat(MAX_MARK_NOTE_LENGTH + 50);
    const r1 = buildMarkRecord(body({ note: long }), sessions, NOW);
    expect(r1.ok && r1.record.note).toBe("あ".repeat(MAX_MARK_NOTE_LENGTH));
    const r2 = buildMarkRecord(body({ note: "" }), sessions, NOW);
    expect(r2.ok && "note" in r2.record).toBe(false);
  });

  it.each([
    ["null", null],
    ["配列", [1]],
    ["文字列", "x"],
    ["数", 1],
  ])("本文が JSON のオブジェクトでない（%s）なら断る", (_, b) => {
    expect(buildMarkRecord(b, sessions, NOW).ok).toBe(false);
  });

  it.each([
    ["無い", undefined],
    ["空", ""],
    ["パスの外へ出る", "../abc123"],
    ["区切り", "a/b"],
    ["ドット", "a.b"],
    ["長すぎる", "a".repeat(65)],
    ["数", 123],
  ])("セッションの書式が不正（%s）なら断る", (_, session) => {
    expect(buildMarkRecord(body({ session }), sessions, NOW)).toEqual({
      ok: false,
      reason: "invalid session",
    });
  });

  it("書式は正しいが知らないセッションなら断る", () => {
    expect(buildMarkRecord(body({ session: "unknown1" }), sessions, NOW)).toEqual({
      ok: false,
      reason: "unknown session",
    });
  });

  it.each([
    ["無い", undefined],
    ["空", ""],
    ["大文字", "False-Walk"],
    ["区切り", "a/b"],
    ["改行", "a\nb"],
    ["長すぎる", "a".repeat(33)],
    ["数", 1],
  ])("種類が不正（%s）なら断る", (_, kind) => {
    expect(buildMarkRecord(body({ kind }), sessions, NOW)).toEqual({
      ok: false,
      reason: "invalid kind",
    });
  });

  it("説明が文字列でなければ断る", () => {
    expect(buildMarkRecord(body({ note: 1 }), sessions, NOW)).toEqual({
      ok: false,
      reason: "invalid note",
    });
  });

  it("時刻合わせも timeOrigin も無い端末には書かない", () => {
    const bare = info();
    expect(buildMarkRecord(body(), new Map([[bare.sessionId, bare]]), NOW)).toEqual({
      ok: false,
      reason: "no clock for session",
    });
  });
});
