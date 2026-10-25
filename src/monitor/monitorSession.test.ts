// 見守り画面の受け取りの状態（MonitorSession）のテスト．
// 基準は docs/04_SPEC/SPEC_01_画面遷移とモジュール構成.md「見守り」の段階 1
// （「状態」の通し番号の比べ方，「見守り画面」の画面の状態の表と切り替えの規則・描き方，「切れた時」の 1 秒の途切れ）
import { describe, expect, it } from "vitest";
import type { DrillTrack } from "../core/drill";
import type { MonitorLobbyNotice, MonitorNotice, MonitorPhase } from "../share/monitorNotice";
import type { MonitorState } from "../share/monitorState";
import { splitMonitorTrack } from "../share/monitorTrack";
import { MONITOR_STALL_MS, MonitorSession } from "./monitorSession";
import { MONITOR_BUFFER_LIMIT, MONITOR_RENDER_DELAY_MS } from "./stateBuffer";

const LOCAL = "Xq3v9_aB0cD";
const STUDENT = 3141592653;
const OTHER = 42;

const hello = (studentId = STUDENT, planFingerprint = LOCAL): MonitorNotice => ({
  type: "hello",
  studentId,
  v: 1,
  planFingerprint,
  mode: "learn",
});

const phase = (value: MonitorPhase, studentId = STUDENT): MonitorNotice => ({
  type: "phase",
  studentId,
  phase: value,
});

const door = (open: boolean, studentId = STUDENT): MonitorNotice => ({
  type: "door",
  studentId,
  cell: { floor: 0, x: 4, z: 7 },
  open,
});

function state(overrides: Partial<MonitorState> = {}): MonitorState {
  return {
    studentId: STUDENT,
    seq: 0,
    floor: 0,
    posture: "standing",
    t: 1,
    x: 0,
    z: 0,
    yaw: 0,
    pitch: 0,
    ...overrides,
  };
}

/** hello と phase drill を受け取って体験中にしたもの */
function liveSession(now = 0): MonitorSession {
  const session = new MonitorSession(LOCAL);
  session.receiveNotice(hello(), now);
  session.receiveNotice(phase("drill"), now);
  return session;
}

describe("MonitorSession: 接続待ち", () => {
  it("開いた直後は接続待ちで，描く姿勢が無い", () => {
    const session = new MonitorSession(LOCAL);
    expect(session.screen).toBe("waiting");
    expect(session.currentStudentId).toBeNull();
    const frame = session.frame(0);
    expect(frame).toMatchObject({ screen: "waiting", mismatch: false, stalled: false, pose: null });
  });

  it("hello の前に届いた状態と知らせは捨てる", () => {
    const session = new MonitorSession(LOCAL);
    expect(session.receiveState(state({ seq: 1 }), 0)).toBeNull();
    expect(session.receiveNotice(phase("drill"), 0)).toBeNull();
    expect(session.receiveNotice(door(true), 0)).toBeNull();
    expect(session.screen).toBe("waiting");
    expect(session.bufferedCount).toBe(0);
  });

  it("hello の後に状態が届いたら（phase を取りこぼしても）体験中にしてドアを戻す", () => {
    const session = new MonitorSession(LOCAL);
    session.receiveNotice(hello(), 0);
    const effect = session.receiveState(state({ seq: 500 }), 10);
    expect(effect).toEqual({ kind: "resetDoors" });
    expect(session.screen).toBe("live");
    expect(session.bufferedCount).toBe(1);
  });
});

describe("MonitorSession: 映す生徒", () => {
  it("最後に hello が届いた生徒を映す", () => {
    const session = new MonitorSession(LOCAL);
    session.receiveNotice(hello(STUDENT), 0);
    expect(session.currentStudentId).toBe(STUDENT);
    session.receiveNotice(hello(OTHER), 0);
    expect(session.currentStudentId).toBe(OTHER);
  });

  it("ほかの生徒の状態・phase・door は無視する", () => {
    const session = liveSession();
    expect(session.receiveState(state({ studentId: OTHER, seq: 1 }), 10)).toBeNull();
    expect(session.receiveNotice(phase("goal", OTHER), 10)).toBeNull();
    expect(session.receiveNotice(door(true, OTHER), 10)).toBeNull();
    expect(session.screen).toBe("live");
    expect(session.bufferedCount).toBe(0);
  });

  it("別の生徒の hello で切り替え，前の人のためた状態を捨ててドアを戻す", () => {
    const session = liveSession();
    session.receiveState(state({ seq: 1 }), 10);
    const effect = session.receiveNotice(hello(OTHER), 20);
    expect(effect).toEqual({ kind: "resetDoors" });
    expect(session.bufferedCount).toBe(0);
    expect(session.screen).toBe("waiting");
    // 前の生徒の状態はもう映さない
    expect(session.receiveState(state({ seq: 2 }), 30)).toBeNull();
    expect(session.bufferedCount).toBe(0);
  });

  it("終わりの後に別の生徒がつながっても，その人の状態で体験中になる", () => {
    const session = liveSession();
    session.receiveNotice(phase("goal"), 100);
    session.receiveNotice(hello(OTHER), 200);
    session.receiveState(state({ studentId: OTHER, seq: 9 }), 210);
    expect(session.screen).toBe("live");
  });
});

describe("MonitorSession: phase による画面の状態", () => {
  it("lobby で準備中．ためた状態を捨てる", () => {
    const session = liveSession();
    session.receiveState(state({ seq: 1 }), 10);
    session.receiveNotice(phase("lobby"), 20);
    expect(session.screen).toBe("preparing");
    expect(session.bufferedCount).toBe(0);
    expect(session.frame(30).pose).toBeNull();
  });

  it("drill で体験中．ためた状態を捨て，ドアを最初の状態に戻す", () => {
    const session = new MonitorSession(LOCAL);
    session.receiveNotice(hello(), 0);
    session.receiveNotice(phase("lobby"), 0);
    expect(session.receiveNotice(phase("drill"), 10)).toEqual({ kind: "resetDoors" });
    expect(session.screen).toBe("live");
  });

  it.each<MonitorPhase>(["goal", "result"])("%s で終わり", (value) => {
    const session = liveSession();
    session.receiveNotice(phase(value), 100);
    expect(session.screen).toBe("ended");
    expect(session.frame(200).screen).toBe("ended");
  });

  it("「同じ訓練をもう一度」: result → lobby → drill で開き直さずに次の体験を映す", () => {
    const session = liveSession();
    session.receiveState(state({ seq: 1, x: 1 }), 10);
    session.receiveNotice(phase("goal"), 100);
    session.receiveNotice(phase("result"), 200);
    session.receiveNotice(phase("lobby"), 300);
    expect(session.screen).toBe("preparing");
    expect(session.receiveNotice(phase("drill"), 400)).toEqual({ kind: "resetDoors" });
    expect(session.screen).toBe("live");
    expect(session.bufferedCount).toBe(0);
    // 次の回は通し番号が戻っていても映る（drill で数え直す）
    session.receiveState(state({ seq: 0, x: 5 }), 410);
    expect(session.bufferedCount).toBe(1);
  });

  it("終わりから体験中に戻すのは drill だけ（lobby なら準備中）", () => {
    const session = liveSession();
    session.receiveNotice(phase("goal"), 100);
    session.receiveNotice(phase("drill"), 200);
    expect(session.screen).toBe("live");

    const other = liveSession();
    other.receiveNotice(phase("result"), 100);
    other.receiveNotice(phase("lobby"), 200);
    expect(other.screen).toBe("preparing");
  });

  it("door の知らせは描く側への開け閉めとして返す", () => {
    const session = liveSession();
    expect(session.receiveNotice(door(true), 10)).toEqual({
      kind: "door",
      cell: { floor: 0, x: 4, z: 7 },
      open: true,
    });
    expect(session.receiveNotice(door(false), 20)).toMatchObject({ kind: "door", open: false });
  });
});

describe("MonitorSession: 準備中に届いた状態", () => {
  // 仕様変更: ロビーの間も状態が届くので，準備中は状態では体験中に移さず，ロビーの向きとしてためる
  // （SPEC_01「見守り画面」の表の「体験中」）
  it("準備中に入る前の最後の通し番号より新しい状態は，準備中のままロビーの向きとしてためる", () => {
    const session = liveSession();
    session.receiveState(state({ seq: 100 }), 10);
    session.receiveNotice(phase("lobby"), 20);
    expect(session.receiveState(state({ seq: 101, t: -1, yaw: 0.5 }), 30)).toBeNull();
    expect(session.screen).toBe("preparing");
    expect(session.bufferedCount).toBe(1);
    expect(session.frame(1000).pose?.yaw).toBeCloseTo(0.5, 12);
  });

  it("準備中に入る前の最後の通し番号以前（遅れて届いた）の状態では準備中のまま", () => {
    const session = liveSession();
    session.receiveState(state({ seq: 100 }), 10);
    session.receiveNotice(phase("lobby"), 20);
    expect(session.receiveState(state({ seq: 100 }), 30)).toBeNull();
    expect(session.receiveState(state({ seq: 99 }), 30)).toBeNull();
    expect(session.screen).toBe("preparing");
    expect(session.bufferedCount).toBe(0);
  });
});

describe("MonitorSession: 通し番号", () => {
  /** lastSeq の後に seq を受け取れるか（体験中で） */
  function accepts(lastSeq: number, seq: number): boolean {
    const session = liveSession();
    session.receiveState(state({ seq: lastSeq }), 10);
    const before = session.bufferedCount;
    session.receiveState(state({ seq }), 20);
    return session.bufferedCount === before + 1;
  }

  it.each<[number, number, boolean]>([
    [0, 1, true],
    [0, 32767, true],
    [0, 32768, false],
    [0, 65535, false],
    [0, 0, false],
    [65535, 0, true],
    [65535, 32766, true],
    [65535, 32767, false],
    [65530, 5, true],
    [5, 65530, false],
    [32768, 0, false],
    [32769, 0, true],
    [32767, 0, false],
  ])("直前が %d の時 %d を受け取るか: %s", (lastSeq, seq, expected) => {
    expect(accepts(lastSeq, seq)).toBe(expected);
  });

  it("捨てた古い状態は直前の番号を変えない", () => {
    const session = liveSession();
    session.receiveState(state({ seq: 10 }), 10);
    session.receiveState(state({ seq: 5 }), 20);
    session.receiveState(state({ seq: 11 }), 30);
    expect(session.bufferedCount).toBe(2);
  });

  it("hello の後の最初の状態は差を見ずに受け取る（生徒が読み込み直して番号が戻っても映す）", () => {
    const session = liveSession();
    session.receiveState(state({ seq: 1000 }), 10);
    session.receiveNotice(hello(), 20);
    session.receiveNotice(phase("drill"), 20);
    // 1000 から見ると 40000 は古い側だが，hello の後の最初なので受け取る
    session.receiveState(state({ seq: 40000 }), 30);
    expect(session.bufferedCount).toBeGreaterThanOrEqual(1);
    session.receiveState(state({ seq: 40001 }), 40);
    session.receiveState(state({ seq: 39999 }), 50);
    const frame = session.frame(1000);
    expect(frame.pose).not.toBeNull();
  });

  it("同じ生徒の hello の後も，最初の状態は番号が戻っていても受け取る（体験中のまま）", () => {
    const session = liveSession();
    session.receiveState(state({ seq: 1000, x: 1 }), 10);
    session.receiveNotice(hello(), 20);
    session.receiveState(state({ seq: 0, x: 2 }), 30);
    expect(session.screen).toBe("live");
    const pose = session.frame(30 + MONITOR_RENDER_DELAY_MS + 1).pose;
    expect(pose?.x).toBe(2);
    // 続きは hello の後の最初の状態からの差で比べる
    session.receiveState(state({ seq: 65000, x: 9 }), 40);
    expect(session.frame(40 + MONITOR_RENDER_DELAY_MS + 1).pose?.x).toBe(2);
    session.receiveState(state({ seq: 1, x: 3 }), 50);
    expect(session.frame(50 + MONITOR_RENDER_DELAY_MS + 1).pose?.x).toBe(3);
  });
});

describe("MonitorSession: 描く姿勢", () => {
  it("今 − 100 ms の時刻の姿勢を前後の状態から補間する", () => {
    const session = liveSession();
    session.receiveState(state({ seq: 1, x: 0 }), 1000);
    session.receiveState(state({ seq: 2, x: 1 }), 1050);
    session.receiveState(state({ seq: 3, x: 2 }), 1100);
    expect(session.frame(1125).pose?.x).toBeCloseTo(0.5, 12);
    expect(session.frame(1175).pose?.x).toBeCloseTo(1.5, 12);
  });

  it("新しい状態が届かない時は最後の状態のまま止める", () => {
    const session = liveSession();
    session.receiveState(state({ seq: 1, x: 0 }), 1000);
    session.receiveState(state({ seq: 2, x: 1 }), 1050);
    expect(session.frame(1500).pose?.x).toBe(1);
  });

  it("体験中で状態がまだ無ければ pose は null（開始地点から描く）", () => {
    const session = liveSession();
    expect(session.frame(10).pose).toBeNull();
  });

  it("ためる数は 64 を超えない（描画が止まっていても溜まり続けない）", () => {
    const session = liveSession();
    for (let i = 1; i <= MONITOR_BUFFER_LIMIT + 50; i++) {
      session.receiveState(state({ seq: i, x: i }), i);
    }
    expect(session.bufferedCount).toBe(MONITOR_BUFFER_LIMIT);
    // 残るのは新しい方
    expect(session.frame(100_000).pose?.x).toBe(MONITOR_BUFFER_LIMIT + 50);
  });
});

describe("MonitorSession: 途切れ", () => {
  it("体験中に最後の状態から 1 秒たつと途切れ（999 ms ではまだ）", () => {
    const session = liveSession(0);
    session.receiveState(state({ seq: 1 }), 500);
    expect(session.frame(500 + MONITOR_STALL_MS - 1).stalled).toBe(false);
    expect(session.frame(500 + MONITOR_STALL_MS).stalled).toBe(true);
    expect(MONITOR_STALL_MS).toBe(1000);
  });

  it("drill に入ってから状態が 1 秒届かなくても途切れ", () => {
    const session = liveSession(2000);
    expect(session.frame(2999).stalled).toBe(false);
    expect(session.frame(3000).stalled).toBe(true);
  });

  it("途切れの間は最後の姿勢のまま止め，状態がまた届いたら自動で戻る", () => {
    const session = liveSession(0);
    session.receiveState(state({ seq: 1, x: 1 }), 100);
    const frame = session.frame(2000);
    expect(frame.stalled).toBe(true);
    expect(frame.pose?.x).toBe(1);
    session.receiveState(state({ seq: 2, x: 2 }), 2100);
    expect(session.frame(2150).stalled).toBe(false);
  });

  it.each<[string, (s: MonitorSession) => void]>([
    ["接続待ち", () => {}],
    ["準備中", (s) => s.receiveNotice(phase("lobby"), 0)],
    ["終わり", (s) => s.receiveNotice(phase("goal"), 0)],
  ])("%s の間は途切れにしない", (_, setup) => {
    const session = new MonitorSession(LOCAL);
    session.receiveNotice(hello(), 0);
    setup(session);
    expect(session.frame(10_000).stalled).toBe(false);
  });
});

describe("MonitorSession: 終わり", () => {
  it("終わりにした時の 今 − 100 ms の姿勢で止める", () => {
    const session = liveSession();
    session.receiveState(state({ seq: 1, x: 0 }), 1000);
    session.receiveState(state({ seq: 2, x: 1 }), 1100);
    // 1150 に goal → 描く時刻は 1050 → x は 0.5
    session.receiveNotice(phase("goal"), 1150);
    expect(session.frame(1150).pose?.x).toBeCloseTo(0.5, 12);
    expect(session.frame(5000).pose?.x).toBeCloseTo(0.5, 12);
  });

  it("終わりの後に遅れて届いた状態は無視し，画面は止めたまま", () => {
    const session = liveSession();
    session.receiveState(state({ seq: 1, x: 0 }), 1000);
    session.receiveState(state({ seq: 2, x: 1 }), 1100);
    session.receiveNotice(phase("goal"), 1150);
    const before = session.frame(1200).pose?.x;
    expect(session.receiveState(state({ seq: 3, x: 9 }), 1200)).toBeNull();
    expect(session.screen).toBe("ended");
    expect(session.frame(2000).pose?.x).toBe(before);
  });

  it("goal の後の result でも止めた姿勢を変えない", () => {
    const session = liveSession();
    session.receiveState(state({ seq: 1, x: 0 }), 1000);
    session.receiveState(state({ seq: 2, x: 1 }), 1100);
    session.receiveNotice(phase("goal"), 1150);
    session.receiveNotice(phase("result"), 3000);
    expect(session.frame(3000).pose?.x).toBeCloseTo(0.5, 12);
  });
});

describe("MonitorSession: 違う校舎", () => {
  it("hello の planFingerprint が手元と違えば mismatch．状態も door も描く側へ渡さない", () => {
    const session = new MonitorSession(LOCAL);
    session.receiveNotice(hello(STUDENT, "demo"), 0);
    session.receiveNotice(phase("drill"), 0);
    expect(session.receiveState(state({ seq: 1 }), 10)).toBeNull();
    expect(session.bufferedCount).toBe(0);
    expect(session.receiveNotice(door(true), 10)).toBeNull();
    expect(session.frame(20).mismatch).toBe(true);
  });

  it("同じ校舎の hello に変われば mismatch が消える", () => {
    const session = new MonitorSession(LOCAL);
    session.receiveNotice(hello(STUDENT, "demo"), 0);
    session.receiveNotice(hello(OTHER, LOCAL), 0);
    expect(session.frame(0).mismatch).toBe(false);
  });

  it("デモの校舎同士（demo）は一致する", () => {
    const session = new MonitorSession("demo");
    session.receiveNotice(hello(STUDENT, "demo"), 0);
    expect(session.frame(0).mismatch).toBe(false);
  });
});

// ---- ロビーの板と記録（SPEC_01「見守り」段階 1「知らせ」の lobby・track と「見守り画面」の準備中・終わり） ----

const lobby = (
  overrides: Partial<Omit<MonitorLobbyNotice, "type">> = {},
  studentId = STUDENT,
): MonitorNotice => ({
  type: "lobby",
  studentId,
  title: "しゃがんでください",
  body: "その場でしゃがみ，しゃがんだまま止まってください",
  caption: "手順 3 / 5　残り 6 秒",
  startButton: false,
  alignMarker: false,
  ...overrides,
});

function drillTrack(n: number, floor = 0): DrillTrack {
  return {
    samples: Array.from({ length: n }, (_, i) => ({
      t: i * 0.2,
      floor,
      x: i * 0.01,
      z: 0,
      posture: "standing" as const,
    })),
  };
}

/** 記録を track の知らせに分ける（studentId を差し替えられる） */
function trackNotices(trackId: number, track: DrillTrack, studentId = STUDENT): MonitorNotice[] {
  const notices = splitMonitorTrack(studentId, trackId, track);
  if (notices.length === 0) throw new Error("記録を分けられない");
  return notices;
}

/** hello → lobby の準備中 */
function preparingSession(floorCount?: number): MonitorSession {
  const session = new MonitorSession(LOCAL, floorCount);
  session.receiveNotice(hello(), 0);
  session.receiveNotice(phase("lobby"), 0);
  return session;
}

/** hello → drill → goal の終わり */
function endedSession(floorCount?: number): MonitorSession {
  const session = new MonitorSession(LOCAL, floorCount);
  session.receiveNotice(hello(), 0);
  session.receiveNotice(phase("drill"), 0);
  session.receiveNotice(phase("goal"), 100);
  return session;
}

function receiveAll(session: MonitorSession, notices: readonly MonitorNotice[], now = 200): void {
  for (const n of notices) session.receiveNotice(n, now);
}

describe("MonitorSession: 準備中のロビーの板", () => {
  it("lobby が届くまでは板が無い（frame.lobby は null）", () => {
    const session = preparingSession();
    expect(session.frame(10).lobby ?? null).toBeNull();
  });

  it("準備中に届いた lobby を frame.lobby で返し，最新のもので置き換える", () => {
    const session = preparingSession();
    expect(session.receiveNotice(lobby({ caption: "残り 6 秒" }), 10)).toBeNull();
    expect(session.frame(20).lobby).toMatchObject({ caption: "残り 6 秒" });
    session.receiveNotice(lobby({ caption: "残り 5 秒", startButton: true }), 30);
    expect(session.frame(40).lobby).toMatchObject({ caption: "残り 5 秒", startButton: true });
    expect(session.screen).toBe("preparing");
  });

  it("lobby の知らせでは画面の状態を変えない", () => {
    const session = preparingSession();
    session.receiveNotice(lobby(), 10);
    expect(session.screen).toBe("preparing");
  });

  it.each([
    ["接続待ち（hello の後，phase の前）", (s: MonitorSession) => s.receiveNotice(hello(), 0)],
    [
      "体験中",
      (s: MonitorSession) => {
        s.receiveNotice(hello(), 0);
        s.receiveNotice(phase("drill"), 0);
      },
    ],
    [
      "終わり",
      (s: MonitorSession) => {
        s.receiveNotice(hello(), 0);
        s.receiveNotice(phase("drill"), 0);
        s.receiveNotice(phase("goal"), 0);
      },
    ],
  ])("%s に届いた lobby は使わず，後で準備中に入っても出さない", (_label, setup) => {
    const session = new MonitorSession(LOCAL);
    setup(session);
    session.receiveNotice(lobby(), 10);
    expect(session.frame(20).lobby ?? null).toBeNull();
    session.receiveNotice(phase("lobby"), 30);
    expect(session.frame(40).lobby ?? null).toBeNull();
  });

  it("ほかの生徒の lobby は無視する", () => {
    const session = preparingSession();
    session.receiveNotice(lobby({}, OTHER), 10);
    expect(session.frame(20).lobby ?? null).toBeNull();
  });

  it("phase の drill で板を消す（体験中の frame.lobby は null）", () => {
    const session = preparingSession();
    session.receiveNotice(lobby(), 10);
    session.receiveNotice(phase("drill"), 20);
    expect(session.frame(30).lobby ?? null).toBeNull();
    // drill の後に lobby に戻っても前の板は出さない
    session.receiveNotice(phase("lobby"), 40);
    expect(session.frame(50).lobby ?? null).toBeNull();
  });

  it("phase の lobby がもう一度来たら（準備中に入り直す）板を消す", () => {
    const session = preparingSession();
    session.receiveNotice(lobby(), 10);
    session.receiveNotice(phase("lobby"), 20);
    expect(session.frame(30).lobby ?? null).toBeNull();
  });

  it("違う生徒の hello で板を消す", () => {
    const session = preparingSession();
    session.receiveNotice(lobby(), 10);
    session.receiveNotice(hello(OTHER), 20);
    session.receiveNotice(phase("lobby", OTHER), 30);
    expect(session.frame(40).lobby ?? null).toBeNull();
  });

  it("同じ生徒の hello（つなぎ直し）では板を残す", () => {
    const session = preparingSession();
    session.receiveNotice(lobby(), 10);
    session.receiveNotice(hello(), 20);
    session.receiveNotice(phase("lobby"), 30);
    // 生徒の端末は phase の後に最新の lobby を送り直す
    session.receiveNotice(lobby({ caption: "送り直し" }), 30);
    expect(session.frame(40).lobby).toMatchObject({ caption: "送り直し" });
  });

  it("違う校舎（mismatch）の間は lobby を捨てる", () => {
    const session = new MonitorSession(LOCAL);
    session.receiveNotice(hello(STUDENT, "demo"), 0);
    session.receiveNotice(phase("lobby"), 0);
    session.receiveNotice(lobby(), 10);
    const frame = session.frame(20);
    expect(frame.mismatch).toBe(true);
    expect(frame.lobby ?? null).toBeNull();
  });
});

describe("MonitorSession: 準備中に届いた状態（ロビーの向き）", () => {
  it("準備中に届いた状態は体験中に移さず，ロビーの向きとして補間して描く", () => {
    const session = preparingSession();
    expect(session.receiveState(state({ seq: 1, yaw: 0, pitch: 0, t: -1 }), 1000)).toBeNull();
    expect(session.receiveState(state({ seq: 2, yaw: 0.2, pitch: 0.1, t: -1 }), 1100)).toBeNull();
    expect(session.screen).toBe("preparing");
    const pose = session.frame(1150).pose;
    expect(pose?.yaw).toBeCloseTo(0.1, 12);
    expect(pose?.pitch).toBeCloseTo(0.05, 12);
  });

  it("準備中は状態が 1 秒届かなくても途切れにしない", () => {
    const session = preparingSession();
    session.receiveState(state({ seq: 1 }), 0);
    expect(session.frame(5000).stalled).toBe(false);
  });

  it("準備中にためた状態は phase の drill で捨てる", () => {
    const session = preparingSession();
    session.receiveState(state({ seq: 1, yaw: 1 }), 0);
    session.receiveNotice(phase("drill"), 10);
    expect(session.bufferedCount).toBe(0);
    expect(session.frame(500).pose).toBeNull();
  });

  it("接続待ちに届いた状態だけは体験中に移す（準備中とは違う）", () => {
    const session = new MonitorSession(LOCAL);
    session.receiveNotice(hello(), 0);
    expect(session.receiveState(state({ seq: 1 }), 10)).toEqual({ kind: "resetDoors" });
    expect(session.screen).toBe("live");
  });

  it("違う校舎（mismatch）の準備中は状態をためない", () => {
    const session = new MonitorSession(LOCAL);
    session.receiveNotice(hello(STUDENT, "demo"), 0);
    session.receiveNotice(phase("lobby"), 0);
    session.receiveState(state({ seq: 1 }), 10);
    expect(session.bufferedCount).toBe(0);
  });
});

describe("MonitorSession: 終わりの記録", () => {
  it("記録が届くまでは frame.track が null", () => {
    const session = endedSession();
    expect(session.frame(200).track ?? null).toBeNull();
  });

  it("1 つに収まる記録がそろうと frame.track で返す", () => {
    const session = endedSession(1);
    receiveAll(session, trackNotices(1, drillTrack(3)));
    const track = session.frame(300).track;
    expect(track?.samples).toHaveLength(3);
    expect(track?.samples[2]).toMatchObject({ floor: 0, x: 0.02, posture: "standing" });
    expect(session.screen).toBe("ended");
  });

  it("751 件（4 つ）の記録は全部の部分がそろってからつなぐ", () => {
    const session = endedSession(1);
    const notices = trackNotices(7, drillTrack(751));
    expect(notices).toHaveLength(4);
    receiveAll(session, notices.slice(0, 3));
    expect(session.frame(300).track ?? null).toBeNull();
    session.receiveNotice(notices[3], 300);
    expect(session.frame(400).track?.samples).toHaveLength(751);
  });

  it("部分が逆の順に届いてもつなげる", () => {
    const session = endedSession(1);
    receiveAll(session, [...trackNotices(7, drillTrack(751))].reverse());
    expect(session.frame(400).track?.samples).toHaveLength(751);
  });

  it("つなぎ終えた記録と同じ trackId の送り直しは無視する（記録は変わらない）", () => {
    const session = endedSession(1);
    receiveAll(session, trackNotices(1, drillTrack(3)));
    // 同じ番号で中身の違うものが来ても無視する
    receiveAll(session, trackNotices(1, drillTrack(5)));
    expect(session.frame(400).track?.samples).toHaveLength(3);
  });

  it("別の trackId が来たら集め直す（集め途中の古い部分は使わない）", () => {
    const session = endedSession(1);
    const first = trackNotices(1, drillTrack(751));
    receiveAll(session, first.slice(0, 2));
    const second = trackNotices(2, drillTrack(5));
    receiveAll(session, second);
    expect(session.frame(400).track?.samples).toHaveLength(5);
    // 古い番号の残りが後から届いても，そろわないので記録は変わらない
    receiveAll(session, first.slice(2));
    expect(session.frame(500).track?.samples).toHaveLength(5);
  });

  it("つなぎ終えた後に別の trackId の記録がそろえば，それに替える", () => {
    const session = endedSession(1);
    receiveAll(session, trackNotices(1, drillTrack(3)));
    receiveAll(session, trackNotices(2, drillTrack(6)));
    expect(session.frame(400).track?.samples).toHaveLength(6);
  });

  it("階が校舎の階の数以上の記録は捨てる", () => {
    const session = endedSession(2);
    receiveAll(session, trackNotices(1, drillTrack(3, 2)));
    expect(session.frame(400).track ?? null).toBeNull();
    // 階の数の中なら受け取る
    receiveAll(session, trackNotices(2, drillTrack(3, 1)));
    expect(session.frame(500).track?.samples).toHaveLength(3);
  });

  it("読めない部分（バイト列が壊れている）がある記録は捨てる", () => {
    const session = endedSession(1);
    session.receiveNotice(
      { type: "track", studentId: STUDENT, trackId: 1, part: 0, parts: 1, data: "AAAA" },
      200,
    );
    expect(session.frame(300).track ?? null).toBeNull();
  });

  it("ほかの生徒の track は無視する", () => {
    const session = endedSession(1);
    receiveAll(session, trackNotices(1, drillTrack(3), OTHER));
    expect(session.frame(300).track ?? null).toBeNull();
  });

  it("違う校舎（mismatch）の間は track を捨てる", () => {
    const session = new MonitorSession(LOCAL, 1);
    session.receiveNotice(hello(STUDENT, "demo"), 0);
    session.receiveNotice(phase("drill"), 0);
    session.receiveNotice(phase("goal"), 0);
    receiveAll(session, trackNotices(1, drillTrack(3)));
    expect(session.frame(300).track ?? null).toBeNull();
  });

  it.each<MonitorPhase>(["lobby", "drill"])("phase の %s で記録を消す", (next) => {
    const session = endedSession(1);
    receiveAll(session, trackNotices(1, drillTrack(3)));
    session.receiveNotice(phase(next), 300);
    session.receiveNotice(phase("goal"), 400);
    expect(session.frame(500).track ?? null).toBeNull();
  });

  it("phase の lobby・drill で消した後は，同じ trackId の記録も新しく受け取る", () => {
    const session = endedSession(1);
    receiveAll(session, trackNotices(1, drillTrack(3)));
    session.receiveNotice(phase("lobby"), 300);
    session.receiveNotice(phase("drill"), 400);
    session.receiveNotice(phase("goal"), 500);
    receiveAll(session, trackNotices(1, drillTrack(4)), 600);
    expect(session.frame(700).track?.samples).toHaveLength(4);
  });

  it("goal から result に移っても記録は残す", () => {
    const session = endedSession(1);
    receiveAll(session, trackNotices(1, drillTrack(3)));
    session.receiveNotice(phase("result"), 300);
    expect(session.frame(400).track?.samples).toHaveLength(3);
  });

  it("違う生徒の hello で記録を消す", () => {
    const session = endedSession(1);
    receiveAll(session, trackNotices(1, drillTrack(3)));
    session.receiveNotice(hello(OTHER), 300);
    session.receiveNotice(phase("goal", OTHER), 400);
    expect(session.frame(500).track ?? null).toBeNull();
  });

  it("同じ生徒の hello（つなぎ直し）では記録を残す", () => {
    const session = endedSession(1);
    receiveAll(session, trackNotices(1, drillTrack(3)));
    session.receiveNotice(hello(), 300);
    session.receiveNotice(phase("goal"), 300);
    // 送り直しの同じ trackId は無視されるが，記録はそのまま
    receiveAll(session, trackNotices(1, drillTrack(3)), 300);
    expect(session.frame(400).track?.samples).toHaveLength(3);
  });

  it("体験中・準備中の frame.track は null（終わりの間だけ返す）", () => {
    const session = new MonitorSession(LOCAL, 1);
    session.receiveNotice(hello(), 0);
    session.receiveNotice(phase("drill"), 0);
    receiveAll(session, trackNotices(1, drillTrack(3)));
    expect(session.frame(300).track ?? null).toBeNull();
  });

  it("階の数を渡さなくても（既定），記録を受け取れる", () => {
    const session = endedSession();
    receiveAll(session, trackNotices(1, drillTrack(3, 3)));
    expect(session.frame(300).track?.samples).toHaveLength(3);
  });
});

// ---- 音の知らせ（SPEC_01「見守り」段階 1「音」の「鳴らす条件」「止める時」） ----

describe("MonitorSession: 音の知らせ", () => {
  const cueNotice = (studentId = STUDENT): MonitorNotice => ({
    type: "cue",
    studentId,
    cue: { type: "sound", id: "fire-bell", action: "play", loop: true },
  });
  const speechNotice = (studentId = STUDENT): MonitorNotice => ({
    type: "speech",
    studentId,
    text: "しゃがんでください",
    rate: 1.05,
  });
  const stopNotice = (studentId = STUDENT): MonitorNotice => ({ type: "stopAudio", studentId });

  /** hello だけ受け取った（準備中の前・接続待ちから hello 済み）もの */
  const helloSession = (fingerprint = LOCAL): MonitorSession => {
    const session = new MonitorSession(LOCAL);
    session.receiveNotice(hello(STUDENT, fingerprint), 0);
    return session;
  };

  it("映す生徒の cue・speech・stopAudio を鳴らす側への効果として返す", () => {
    const session = liveSession();
    expect(session.receiveNotice(cueNotice(), 10)).toEqual({
      kind: "cue",
      cue: { type: "sound", id: "fire-bell", action: "play", loop: true },
    });
    expect(session.receiveNotice(speechNotice(), 10)).toEqual({
      kind: "speech",
      text: "しゃがんでください",
      rate: 1.05,
    });
    expect(session.receiveNotice(stopNotice(), 10)).toEqual({ kind: "stopAudio" });
  });

  it("narration の params もそのまま渡す", () => {
    const session = liveSession();
    expect(
      session.receiveNotice(
        {
          type: "cue",
          studentId: STUDENT,
          cue: { type: "narration", id: "fire-announcement", params: { roomName: "3年1組" } },
        },
        0,
      ),
    ).toEqual({
      kind: "cue",
      cue: { type: "narration", id: "fire-announcement", params: { roomName: "3年1組" } },
    });
  });

  it.each<[string, (s: MonitorSession) => void]>([
    ["hello の直後（phase の前）", () => {}],
    ["準備中", (s) => s.receiveNotice(phase("lobby"), 0)],
    ["体験中", (s) => s.receiveNotice(phase("drill"), 0)],
    ["終わり（goal）", (s) => s.receiveNotice(phase("goal"), 0)],
    ["結果（result）", (s) => s.receiveNotice(phase("result"), 0)],
  ])("画面の状態では絞らない: %s でも鳴らす", (_label, prepare) => {
    const session = helloSession();
    prepare(session);
    expect(session.receiveNotice(cueNotice(), 0)).toMatchObject({ kind: "cue" });
    expect(session.receiveNotice(speechNotice(), 0)).toMatchObject({ kind: "speech" });
    expect(session.receiveNotice(stopNotice(), 0)).toEqual({ kind: "stopAudio" });
  });

  it("避難の画面に入る途中の cue（phase drill より前に届く）も鳴らし，その後の drill でも画面は普通に変わる", () => {
    const session = helloSession();
    session.receiveNotice(phase("lobby"), 0);
    expect(session.receiveNotice(cueNotice(), 0)).toMatchObject({ kind: "cue" });
    expect(session.screen).toBe("preparing");
    session.receiveNotice(phase("drill"), 0);
    expect(session.screen).toBe("live");
  });

  it.each<[string, () => MonitorNotice]>([
    ["cue", () => cueNotice()],
    ["speech", () => speechNotice()],
    ["stopAudio", () => stopNotice()],
  ])("%s では画面の状態・板・ためた状態を変えない", (_label, make) => {
    const session = helloSession();
    session.receiveNotice(phase("lobby"), 0);
    const lobby: MonitorLobbyNotice = {
      type: "lobby",
      studentId: STUDENT,
      title: "t",
      body: "b",
      caption: "",
      startButton: false,
      alignMarker: false,
    };
    session.receiveNotice(lobby, 0);
    session.receiveState(state({ seq: 1 }), 0);
    const before = { screen: session.screen, buffered: session.bufferedCount };
    session.receiveNotice(make(), 0);
    expect(session.screen).toBe(before.screen);
    expect(session.bufferedCount).toBe(before.buffered);
    expect(session.frame(0).lobby).toMatchObject({ title: "t", body: "b" });

    const live = liveSession();
    live.receiveNotice(make(), 0);
    expect(live.screen).toBe("live");
    const ended = liveSession();
    ended.receiveNotice(phase("goal"), 0);
    ended.receiveNotice(make(), 0);
    expect(ended.screen).toBe("ended");
  });

  it("hello の前に届いた音の知らせは捨て，接続待ちのまま", () => {
    const session = new MonitorSession(LOCAL);
    expect(session.receiveNotice(cueNotice(), 0)).toBeNull();
    expect(session.receiveNotice(speechNotice(), 0)).toBeNull();
    expect(session.receiveNotice(stopNotice(), 0)).toBeNull();
    expect(session.screen).toBe("waiting");
  });

  it("ほかの生徒の音の知らせは捨てる", () => {
    const session = liveSession();
    expect(session.receiveNotice(cueNotice(OTHER), 0)).toBeNull();
    expect(session.receiveNotice(speechNotice(OTHER), 0)).toBeNull();
    expect(session.receiveNotice(stopNotice(OTHER), 0)).toBeNull();
  });

  it("映す生徒が替わったら，前の生徒の音の知らせは捨て，新しい生徒のものを返す", () => {
    const session = liveSession();
    session.receiveNotice(hello(OTHER), 0);
    expect(session.receiveNotice(cueNotice(STUDENT), 0)).toBeNull();
    expect(session.receiveNotice(cueNotice(OTHER), 0)).toMatchObject({ kind: "cue" });
  });

  it("違う校舎（mismatch）の間は音の知らせを捨てる", () => {
    const session = helloSession("OTHERPLAN00");
    session.receiveNotice(phase("drill"), 0);
    expect(session.receiveNotice(cueNotice(), 0)).toBeNull();
    expect(session.receiveNotice(speechNotice(), 0)).toBeNull();
    expect(session.receiveNotice(stopNotice(), 0)).toBeNull();
  });

  it("同じ校舎の hello に変われば，また鳴らす", () => {
    const session = helloSession("OTHERPLAN00");
    session.receiveNotice(hello(), 0);
    expect(session.receiveNotice(cueNotice(), 0)).toMatchObject({ kind: "cue" });
  });

  it("phase の知らせは音を止める効果を返さない", () => {
    const session = helloSession();
    session.takeAudioStop();
    for (const value of ["lobby", "drill", "goal", "result"] as const) {
      const effect = session.receiveNotice(phase(value), 0);
      expect(effect?.kind).not.toBe("stopAudio");
      expect(session.takeAudioStop()).toBe(false);
    }
  });
});

describe("MonitorSession.takeAudioStop", () => {
  it("開いた直後（hello の前）は false", () => {
    expect(new MonitorSession(LOCAL).takeAudioStop()).toBe(false);
  });

  it("初めての hello の後に 1 回だけ true", () => {
    const session = new MonitorSession(LOCAL);
    session.receiveNotice(hello(), 0);
    expect(session.takeAudioStop()).toBe(true);
    expect(session.takeAudioStop()).toBe(false);
  });

  it("別の生徒の hello の後に 1 回だけ true", () => {
    const session = liveSession();
    session.takeAudioStop();
    session.receiveNotice(hello(OTHER), 0);
    expect(session.takeAudioStop()).toBe(true);
    expect(session.takeAudioStop()).toBe(false);
  });

  it("同じ生徒の同じ校舎の hello（つなぎ直し）では false", () => {
    const session = liveSession();
    session.takeAudioStop();
    session.receiveNotice(hello(), 0);
    expect(session.takeAudioStop()).toBe(false);
  });

  it("同じ生徒でも違う校舎（mismatch）の hello の後は 1 回だけ true", () => {
    const session = liveSession();
    session.takeAudioStop();
    session.receiveNotice(hello(STUDENT, "OTHERPLAN00"), 0);
    expect(session.takeAudioStop()).toBe(true);
    expect(session.takeAudioStop()).toBe(false);
  });

  it("hello が続けて 2 回あっても，取り出すまで true は 1 回分", () => {
    const session = new MonitorSession(LOCAL);
    session.receiveNotice(hello(), 0);
    session.receiveNotice(hello(OTHER), 0);
    expect(session.takeAudioStop()).toBe(true);
    expect(session.takeAudioStop()).toBe(false);
  });

  it("ほかの生徒の知らせ・状態・音の知らせでは true にならない", () => {
    const session = liveSession();
    session.takeAudioStop();
    session.receiveNotice(phase("lobby", OTHER), 0);
    session.receiveNotice(door(true, OTHER), 0);
    session.receiveState(state({ studentId: OTHER, seq: 3 }), 0);
    session.receiveState(state({ seq: 3 }), 0);
    session.receiveNotice({ type: "stopAudio", studentId: STUDENT }, 0);
    session.receiveNotice({ type: "speech", studentId: STUDENT, text: "a", rate: 1 }, 0);
    expect(session.takeAudioStop()).toBe(false);
  });

  it("途切れ（1 秒届かない）では true にならない", () => {
    const session = liveSession();
    session.takeAudioStop();
    session.receiveState(state({ seq: 1 }), 0);
    session.frame(5000);
    expect(session.takeAudioStop()).toBe(false);
  });
});
