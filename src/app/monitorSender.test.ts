// 見守りの送る側（SPEC_01「見守り」の段階 1「状態」「知らせ」「体験との約束」．Issue #127）．
// WebSocket は偽物を createSocket で渡し，時刻は vi.useFakeTimers() で進める

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { DrillTrack } from "../core/drill";
import type { SceneId } from "../core/scene";
import { parseMonitorNotice } from "../share/monitorNotice";
import { type MonitorState, readMonitorState } from "../share/monitorState";
import { joinMonitorTrack } from "../share/monitorTrack";
import {
  createMonitorSender,
  loadStudentId,
  MONITOR_RECONNECT_DELAY_MS,
  MONITOR_STATE_INTERVAL_MS,
  MONITOR_STUDENT_ID_KEY,
  type MonitorLobbyView,
  type MonitorSenderOptions,
  type MonitorSnapshot,
  type MonitorSocketLike,
  monitorPhaseOfScene,
  monitorPitchOfDirection,
  monitorYawOfDirection,
  resolveMonitorRelayEndpoint,
  type StudentIdStorage,
} from "./monitorSender";

const ROOM = "AbCdEfGh12345678";
const RELAY = "wss://relay.example.com";
const HASH = `#p=xyz&room=${ROOM}`;
const STUDENT_ID = 3141592653;
const FINGERPRINT = "Xq3v9_aB0cD";

/** 送られたもの（ArrayBuffer は使い回されるので，送った時点の写しも持つ） */
interface Sent {
  readonly data: string | ArrayBuffer;
  readonly copy: ArrayBuffer | null;
}

/** 偽の WebSocket（readyState: 0 = CONNECTING，1 = OPEN，3 = CLOSED） */
class FakeSocket implements MonitorSocketLike {
  readyState = 0;
  bufferedAmount = 0;
  onopen: ((event: unknown) => void) | null = null;
  onclose: ((event: unknown) => void) | null = null;
  onerror: ((event: unknown) => void) | null = null;
  readonly sent: Sent[] = [];
  closeCalls = 0;
  sendError: Error | null = null;

  constructor(readonly url: string) {}

  send(data: string | ArrayBuffer): void {
    if (this.sendError !== null) throw this.sendError;
    this.sent.push({ data, copy: typeof data === "string" ? null : data.slice(0) });
  }

  close(): void {
    this.closeCalls++;
    this.readyState = 3;
  }

  /** つながった */
  open(): void {
    this.readyState = 1;
    this.onopen?.({});
  }

  /** 切れた（close だけ） */
  drop(): void {
    this.readyState = 3;
    this.onclose?.({});
  }

  /** つながらなかった（ブラウザと同じく error の後に close） */
  fail(): void {
    this.readyState = 3;
    this.onerror?.({});
    this.onclose?.({});
  }

  /** 送ったテキストの知らせ（JSON を戻したもの） */
  notices(): Record<string, unknown>[] {
    return this.sent
      .filter((s): s is Sent & { data: string } => typeof s.data === "string")
      .map((s) => JSON.parse(s.data) as Record<string, unknown>);
  }

  /** 送ったバイナリの状態（送った時点の写しを読み戻したもの） */
  states(): MonitorState[] {
    return this.sent
      .filter((s) => s.copy !== null)
      .map((s) => {
        const state = readMonitorState(s.copy as ArrayBuffer, 256);
        if (state === null) throw new Error("読めない状態が送られた");
        return state;
      });
  }
}

function snapshot(overrides: Partial<MonitorSnapshot> = {}): MonitorSnapshot {
  return {
    floor: 1,
    posture: "crouching",
    t: 12.5,
    x: 3.25,
    z: -4.5,
    yaw: 0.5,
    pitch: -0.25,
    ...overrides,
  };
}

/** 送る側と偽物一式を作る（既定は住所・room= あり，指紋はすぐ解ける） */
function setup(overrides: Partial<MonitorSenderOptions> = {}) {
  const sockets: FakeSocket[] = [];
  const errors: unknown[] = [];
  let current: MonitorSnapshot | null = snapshot();
  const createSocket = vi.fn((url: string) => {
    const socket = new FakeSocket(url);
    sockets.push(socket);
    return socket;
  });
  const getPlanFingerprint = vi.fn(() => Promise.resolve(FINGERPRINT));
  const getStudentId = vi.fn(() => STUDENT_ID);
  const getMode = vi.fn((): "learn" | "test" => "learn");
  const readState = vi.fn(() => current);
  const sender = createMonitorSender({
    relayUrl: RELAY,
    hash: HASH,
    getStudentId,
    getPlanFingerprint,
    getMode,
    readState,
    createSocket,
    onError: (error) => errors.push(error),
    ...overrides,
  });
  return {
    sender,
    sockets,
    errors,
    createSocket,
    getPlanFingerprint,
    getStudentId,
    getMode,
    readState,
    setState(next: MonitorSnapshot | null) {
      current = next;
    },
    last(): FakeSocket {
      const socket = sockets.at(-1);
      if (socket === undefined) throw new Error("WebSocket が作られていない");
      return socket;
    },
  };
}

/** 指紋の Promise を解かせる */
async function flush(): Promise<void> {
  for (let i = 0; i < 10; i++) await Promise.resolve();
}

/** start して指紋を解き，最初の WebSocket をつなぐところまで進める */
async function connected(overrides: Partial<MonitorSenderOptions> = {}) {
  const env = setup(overrides);
  env.sender.start();
  await flush();
  env.last().open();
  return env;
}

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("resolveMonitorRelayEndpoint", () => {
  it("wss の住所と room= から生徒の接続先を作る", () => {
    expect(resolveMonitorRelayEndpoint(RELAY, HASH)).toBe(
      `wss://relay.example.com/rooms/${ROOM}?role=student`,
    );
  });

  it("ws の住所（ローカルの中継）も受け付ける", () => {
    expect(resolveMonitorRelayEndpoint("ws://127.0.0.1:8787", `#room=${ROOM}`)).toBe(
      `ws://127.0.0.1:8787/rooms/${ROOM}?role=student`,
    );
  });

  it("住所の末尾の / は二重にしない", () => {
    expect(resolveMonitorRelayEndpoint(`${RELAY}/`, HASH)).toBe(
      `wss://relay.example.com/rooms/${ROOM}?role=student`,
    );
  });

  it("フラグメントの先頭の # は無くてもよい．p= の前後どちらでも読む", () => {
    expect(resolveMonitorRelayEndpoint(RELAY, `room=${ROOM}&p=xyz`)).toBe(
      `wss://relay.example.com/rooms/${ROOM}?role=student`,
    );
  });

  it.each([
    ["未設定（undefined）", undefined],
    ["null", null],
    ["空の文字", ""],
    ["http://", "http://relay.example.com"],
    ["https://", "https://relay.example.com"],
    ["スキームだけ", "wss://"],
    ["文字でない", 42],
  ])("住所が %s なら null", (_label, relayUrl) => {
    expect(resolveMonitorRelayEndpoint(relayUrl, HASH)).toBeNull();
  });

  it.each([
    ["room= が無い", "#p=xyz"],
    ["フラグメントが空", ""],
    ["room= が空", "#p=xyz&room="],
    ["7 文字（短すぎる）", "#room=AbCdEfG"],
    ["65 文字（長すぎる）", `#room=${"a".repeat(65)}`],
    ["base64url でない文字", "#room=AbCd%2FEfGh1234"],
    ["base64url でない文字（.）", "#room=AbCd.EfGh1234"],
  ])("%s なら null", (_label, hash) => {
    expect(resolveMonitorRelayEndpoint(RELAY, hash)).toBeNull();
  });

  it.each([
    ["8 文字", "AbCdEfGh"],
    ["64 文字", "a".repeat(64)],
    ["- と _ を含む", "Ab-_Ab-_Ab-_"],
  ])("room= が %s なら受け付ける", (_label, room) => {
    expect(resolveMonitorRelayEndpoint(RELAY, `#room=${room}`)).toBe(
      `wss://relay.example.com/rooms/${room}?role=student`,
    );
  });
});

describe("createMonitorSender（何もしない時）", () => {
  it.each([
    ["住所が未設定", { relayUrl: undefined }],
    ["住所が空", { relayUrl: "" }],
    ["住所が http://", { relayUrl: "http://relay.example.com" }],
    ["room= が無い", { hash: "#p=xyz" }],
    ["room= が形に合わない", { hash: "#room=short" }],
  ])(
    "%s なら WebSocket もタイマーも作らず，何を呼んでも例外を出さない",
    async (_label, override) => {
      const env = setup(override);
      expect(() => {
        env.sender.start();
        env.sender.setPhase("drill");
        env.sender.notifyDoor({ floor: 0, x: 1, z: 2 }, true);
      }).not.toThrow();
      await flush();
      expect(vi.getTimerCount()).toBe(0);
      vi.advanceTimersByTime(60_000);
      expect(env.createSocket).not.toHaveBeenCalled();
      expect(env.getPlanFingerprint).not.toHaveBeenCalled();
      expect(env.readState).not.toHaveBeenCalled();
      expect(() => env.sender.dispose()).not.toThrow();
    },
  );
});

describe("createMonitorSender（つなぎ方）", () => {
  it("start するまではつながない", async () => {
    const env = setup();
    await flush();
    vi.advanceTimersByTime(60_000);
    expect(env.createSocket).not.toHaveBeenCalled();
  });

  it("start で生徒の ID を取り，指紋が解けてから生徒の接続先へつなぐ", async () => {
    let resolve: (value: string) => void = () => {};
    const env = setup({
      getPlanFingerprint: () =>
        new Promise<string>((r) => {
          resolve = r;
        }),
    });
    env.sender.start();
    expect(env.getStudentId).toHaveBeenCalledTimes(1);
    await flush();
    expect(env.createSocket).not.toHaveBeenCalled();
    resolve(FINGERPRINT);
    await flush();
    expect(env.createSocket).toHaveBeenCalledTimes(1);
    expect(env.createSocket).toHaveBeenCalledWith(
      `wss://relay.example.com/rooms/${ROOM}?role=student`,
    );
  });

  it("start は接続を待たない（戻り値は Promise でない）", () => {
    const env = setup();
    expect(env.sender.start()).toBeUndefined();
  });

  it("2 回 start しても WebSocket は 1 つ", async () => {
    const env = setup();
    env.sender.start();
    env.sender.start();
    await flush();
    expect(env.createSocket).toHaveBeenCalledTimes(1);
    expect(env.getPlanFingerprint).toHaveBeenCalledTimes(1);
  });

  it("つながったら最初に hello，その直後に今の phase を送る", async () => {
    const env = await connected();
    const notices = env.last().notices();
    expect(notices).toEqual([
      { type: "hello", studentId: STUDENT_ID, v: 1, planFingerprint: FINGERPRINT, mode: "learn" },
      { type: "phase", studentId: STUDENT_ID, phase: "lobby" },
    ]);
    // 段階 1 では name を入れない
    expect(notices[0]).not.toHaveProperty("name");
  });

  it("送る知らせは受け取る側（parseMonitorNotice）で読める", async () => {
    const env = await connected();
    env.sender.setPhase("drill");
    env.sender.notifyDoor({ floor: 0, x: 4, z: 7 }, true);
    for (const sent of env.last().sent) {
      if (typeof sent.data === "string") expect(parseMonitorNotice(sent.data)).not.toBeNull();
    }
  });

  it("hello の mode は getMode のもの（テストモード）", async () => {
    const env = await connected({ getMode: () => "test" });
    expect(env.last().notices()[0]).toMatchObject({ type: "hello", mode: "test" });
  });

  it("つながる前に drill に移っていたら，hello の直後の phase は drill", async () => {
    const env = setup();
    env.sender.start();
    env.sender.setPhase("drill");
    await flush();
    env.last().open();
    expect(env.last().notices()).toEqual([
      expect.objectContaining({ type: "hello" }),
      { type: "phase", studentId: STUDENT_ID, phase: "drill" },
    ]);
  });

  it("つながる前（CONNECTING）は何も送らない", async () => {
    const env = setup();
    env.sender.start();
    await flush();
    env.sender.setPhase("drill");
    vi.advanceTimersByTime(1000);
    expect(env.last().sent).toEqual([]);
  });
});

describe("createMonitorSender（状態）", () => {
  // 仕様変更（ロビーも見守り画面で描くため，lobby の間も状態を送る．SPEC_01「見守り」段階 1「状態」）
  it("lobby の間も 50 ms おきに状態を送る（start した時の phase は lobby）", async () => {
    const env = await connected();
    env.setState(snapshot({ t: -1, x: 0, z: 0, floor: 0, posture: "standing" }));
    vi.advanceTimersByTime(1000);
    const states = env.last().states();
    expect(states).toHaveLength(20);
    expect(states[0]).toMatchObject({ studentId: STUDENT_ID, seq: 0, t: -1 });
  });

  it("lobby の間も readState が null（ホームの間）の回は送らない", async () => {
    const env = await connected();
    env.setState(null);
    vi.advanceTimersByTime(500);
    expect(env.last().states()).toEqual([]);
    expect(env.readState).toHaveBeenCalled();
  });

  it("drill の間は 50 ms おき（1 秒に 20 回）に送る", async () => {
    expect(MONITOR_STATE_INTERVAL_MS).toBe(50);
    const env = await connected();
    env.sender.setPhase("drill");
    vi.advanceTimersByTime(49);
    expect(env.last().states()).toHaveLength(0);
    vi.advanceTimersByTime(1);
    expect(env.last().states()).toHaveLength(1);
    vi.advanceTimersByTime(950);
    expect(env.last().states()).toHaveLength(20);
  });

  it("seq は 0 から送るたびに 1 ずつ増え，studentId は hello と同じ", async () => {
    const env = await connected();
    env.sender.setPhase("drill");
    vi.advanceTimersByTime(1000);
    const states = env.last().states();
    expect(states.map((s) => s.seq)).toEqual(Array.from({ length: 20 }, (_, i) => i));
    expect(states.every((s) => s.studentId === STUDENT_ID)).toBe(true);
  });

  it("readState の値を 20 バイトに書いて送る", async () => {
    const env = await connected();
    env.sender.setPhase("drill");
    vi.advanceTimersByTime(50);
    const [state] = env.last().states();
    expect(state).toMatchObject({ floor: 1, posture: "crouching", t: 12.5, x: 3.25, z: -4.5 });
    expect(state.yaw).toBeCloseTo(0.5, 3);
    expect(state.pitch).toBeCloseTo(-0.25, 3);
  });

  it("送るのは 20 バイトのバイナリで，同じ ArrayBuffer を使い回す", async () => {
    const env = await connected();
    env.sender.setPhase("drill");
    vi.advanceTimersByTime(150);
    const buffers = env
      .last()
      .sent.filter((s) => typeof s.data !== "string")
      .map((s) => s.data);
    expect(buffers).toHaveLength(3);
    for (const b of buffers) {
      expect(b).toBeInstanceOf(ArrayBuffer);
      expect((b as ArrayBuffer).byteLength).toBe(20);
    }
    expect(buffers[1]).toBe(buffers[0]);
    expect(buffers[2]).toBe(buffers[0]);
  });

  it("seq は 65535 の次は 0", async () => {
    const env = await connected();
    env.sender.setPhase("drill");
    vi.advanceTimersByTime(50 * 65537);
    const seqs = env
      .last()
      .states()
      .map((s) => s.seq);
    expect(seqs.slice(-3)).toEqual([65534, 65535, 0]);
  });

  it("bufferedAmount が 0 でない回は送らず，seq も進めない", async () => {
    const env = await connected();
    env.sender.setPhase("drill");
    vi.advanceTimersByTime(100);
    env.last().bufferedAmount = 1;
    vi.advanceTimersByTime(500);
    expect(env.last().states()).toHaveLength(2);
    env.last().bufferedAmount = 0;
    vi.advanceTimersByTime(100);
    expect(
      env
        .last()
        .states()
        .map((s) => s.seq),
    ).toEqual([0, 1, 2, 3]);
  });

  it("readState が null の回は送らず，seq も進めない", async () => {
    const env = await connected();
    env.sender.setPhase("drill");
    env.setState(null);
    vi.advanceTimersByTime(200);
    expect(env.last().states()).toHaveLength(0);
    env.setState(snapshot());
    vi.advanceTimersByTime(50);
    expect(
      env
        .last()
        .states()
        .map((s) => s.seq),
    ).toEqual([0]);
  });

  it.each([
    ["x が NaN", { x: Number.NaN }],
    ["t が Infinity", { t: Number.POSITIVE_INFINITY }],
    ["yaw が NaN", { yaw: Number.NaN }],
    ["pitch が -Infinity", { pitch: Number.NEGATIVE_INFINITY }],
  ])("%s の回は送らず，seq も進めない", async (_label, bad) => {
    const env = await connected();
    env.sender.setPhase("drill");
    env.setState(snapshot(bad));
    vi.advanceTimersByTime(200);
    expect(env.last().states()).toHaveLength(0);
    env.setState(snapshot());
    vi.advanceTimersByTime(50);
    expect(
      env
        .last()
        .states()
        .map((s) => s.seq),
    ).toEqual([0]);
  });

  it("t が負（非常ベルの前）でも送る", async () => {
    const env = await connected();
    env.sender.setPhase("drill");
    env.setState(snapshot({ t: -30 }));
    vi.advanceTimersByTime(50);
    expect(env.last().states()[0].t).toBe(-30);
  });

  it.each(["goal", "result"] as const)("%s に移ったら状態を止める", async (phase) => {
    const env = await connected();
    env.sender.setPhase("drill");
    vi.advanceTimersByTime(100);
    env.sender.setPhase(phase);
    vi.advanceTimersByTime(1000);
    expect(env.last().states()).toHaveLength(2);
  });

  // 仕様変更（lobby の間も状態を送る）
  it("drill から lobby に移っても状態を送り続ける（タイマーは 1 つだけ）", async () => {
    const env = await connected();
    env.sender.setPhase("drill");
    vi.advanceTimersByTime(100);
    env.sender.setPhase("lobby");
    vi.advanceTimersByTime(1000);
    expect(env.last().states()).toHaveLength(22);
  });

  it("result から lobby（同じ訓練をもう一度）に戻ると状態をまた送る", async () => {
    const env = await connected();
    env.sender.setPhase("drill");
    env.sender.setPhase("goal");
    env.sender.setPhase("result");
    vi.advanceTimersByTime(500);
    expect(env.last().states()).toHaveLength(0);
    env.sender.setPhase("lobby");
    vi.advanceTimersByTime(1000);
    expect(env.last().states()).toHaveLength(20);
  });

  it("もう一度 drill に入ったら状態をまた送る（タイマーは 1 つだけ）", async () => {
    const env = await connected();
    env.sender.setPhase("drill");
    env.sender.setPhase("goal");
    env.sender.setPhase("result");
    env.sender.setPhase("lobby");
    env.sender.setPhase("drill");
    vi.advanceTimersByTime(1000);
    expect(env.last().states()).toHaveLength(20);
  });

  it("つながる前に drill に入っても，つながった後から状態を送る", async () => {
    const env = setup();
    env.sender.start();
    env.sender.setPhase("drill");
    vi.advanceTimersByTime(500);
    await flush();
    env.last().open();
    vi.advanceTimersByTime(100);
    expect(
      env
        .last()
        .states()
        .map((s) => s.seq),
    ).toEqual([0, 1]);
  });
});

describe("createMonitorSender（知らせ）", () => {
  it("phase が移るたびに phase を送る．同じ phase が続く時は送らない", async () => {
    const env = await connected();
    env.sender.setPhase("lobby");
    env.sender.setPhase("drill");
    env.sender.setPhase("drill");
    env.sender.setPhase("goal");
    env.sender.setPhase("result");
    env.sender.setPhase("result");
    env.sender.setPhase("lobby");
    const phases = env
      .last()
      .notices()
      .filter((n) => n.type === "phase")
      .map((n) => n.phase);
    // 最初の lobby は hello の直後のもの
    expect(phases).toEqual(["lobby", "drill", "goal", "result", "lobby"]);
  });

  it("door はマスと開け閉めを送る", async () => {
    const env = await connected();
    env.sender.notifyDoor({ floor: 0, x: 4, z: 7 }, true);
    env.sender.notifyDoor({ floor: 1, x: 2, z: 3 }, false);
    expect(env.last().notices().slice(2)).toEqual([
      { type: "door", studentId: STUDENT_ID, cell: { floor: 0, x: 4, z: 7 }, open: true },
      { type: "door", studentId: STUDENT_ID, cell: { floor: 1, x: 2, z: 3 }, open: false },
    ]);
  });

  it("知らせは bufferedAmount が 0 でなくても送る", async () => {
    const env = await connected();
    env.last().bufferedAmount = 100_000;
    env.sender.setPhase("drill");
    env.sender.notifyDoor({ floor: 0, x: 1, z: 1 }, true);
    expect(env.last().notices().slice(2)).toEqual([
      { type: "phase", studentId: STUDENT_ID, phase: "drill" },
      { type: "door", studentId: STUDENT_ID, cell: { floor: 0, x: 1, z: 1 }, open: true },
    ]);
    // 状態はこの間捨てる
    vi.advanceTimersByTime(500);
    expect(env.last().states()).toHaveLength(0);
  });

  it("つながっていない間の door は捨て，つながった後にも送り直さない", async () => {
    const env = setup();
    env.sender.start();
    env.sender.notifyDoor({ floor: 0, x: 1, z: 1 }, true);
    await flush();
    env.sender.notifyDoor({ floor: 0, x: 2, z: 2 }, true);
    env.last().open();
    expect(
      env
        .last()
        .notices()
        .map((n) => n.type),
    ).toEqual(["hello", "phase"]);
  });

  it("切れている間の door は捨て，つなぎ直した後は hello と今の phase だけ", async () => {
    const env = await connected();
    env.sender.setPhase("drill");
    env.last().drop();
    env.sender.notifyDoor({ floor: 0, x: 1, z: 1 }, true);
    vi.advanceTimersByTime(MONITOR_RECONNECT_DELAY_MS);
    env.last().open();
    expect(env.sockets).toHaveLength(2);
    expect(env.last().notices()).toEqual([
      expect.objectContaining({ type: "hello", studentId: STUDENT_ID }),
      { type: "phase", studentId: STUDENT_ID, phase: "drill" },
    ]);
  });
});

describe("createMonitorSender（つなぎ直し）", () => {
  it("つなぎ直すまでの間は 5 秒", () => {
    expect(MONITOR_RECONNECT_DELAY_MS).toBe(5000);
  });

  it("切れたら 5 秒後に 1 回つなぎ直し，hello → 今の phase を送る", async () => {
    const env = await connected();
    env.sender.setPhase("drill");
    const first = env.last();
    first.drop();
    vi.advanceTimersByTime(MONITOR_RECONNECT_DELAY_MS - 1);
    expect(env.sockets).toHaveLength(1);
    vi.advanceTimersByTime(1);
    expect(env.sockets).toHaveLength(2);
    expect(env.last().url).toBe(`wss://relay.example.com/rooms/${ROOM}?role=student`);
    env.last().open();
    expect(env.last().notices()).toEqual([
      { type: "hello", studentId: STUDENT_ID, v: 1, planFingerprint: FINGERPRINT, mode: "learn" },
      { type: "phase", studentId: STUDENT_ID, phase: "drill" },
    ]);
    // つなぎ直しでは生徒の ID と指紋を取り直さない
    expect(env.getStudentId).toHaveBeenCalledTimes(1);
    expect(env.getPlanFingerprint).toHaveBeenCalledTimes(1);
  });

  it("error と close の両方が来ても，つなぎ直すのは 1 回", async () => {
    const env = setup();
    env.sender.start();
    await flush();
    env.last().fail();
    vi.advanceTimersByTime(MONITOR_RECONNECT_DELAY_MS * 1.5);
    expect(env.sockets).toHaveLength(2);
  });

  it("つながらない間は 5 秒ごとにつなぎ直し続ける", async () => {
    const env = setup();
    env.sender.start();
    await flush();
    for (let i = 0; i < 3; i++) {
      env.last().fail();
      vi.advanceTimersByTime(MONITOR_RECONNECT_DELAY_MS);
    }
    expect(env.sockets).toHaveLength(4);
  });

  it("切れたソケットは閉じ，その後に古いソケットから来た出来事は無視する", async () => {
    const env = await connected();
    const first = env.last();
    const { onopen, onclose } = first;
    first.drop();
    expect(first.closeCalls).toBe(1);
    // 古いソケットのハンドラを後から呼ばれても，つなぎ直しは増えない
    onclose?.({});
    onopen?.({});
    vi.advanceTimersByTime(MONITOR_RECONNECT_DELAY_MS * 1.5);
    expect(env.sockets).toHaveLength(2);
    expect(first.notices().filter((n) => n.type === "hello")).toHaveLength(1);
  });

  it("切れている間は状態を送らず，つなぎ直した後に続きの seq で送る", async () => {
    const env = await connected();
    env.sender.setPhase("drill");
    vi.advanceTimersByTime(100);
    env.last().drop();
    vi.advanceTimersByTime(MONITOR_RECONNECT_DELAY_MS);
    expect(env.sockets[0].states()).toHaveLength(2);
    env.last().open();
    vi.advanceTimersByTime(100);
    const seqs = env
      .last()
      .states()
      .map((s) => s.seq);
    expect(seqs).toEqual([2, 3]);
  });

  it("WebSocket を作る時の例外は外へ出さず，5 秒後につなぎ直す", async () => {
    let calls = 0;
    const sockets: FakeSocket[] = [];
    const env = setup({
      createSocket: (url) => {
        calls++;
        if (calls === 1) throw new Error("SyntaxError");
        const s = new FakeSocket(url);
        sockets.push(s);
        return s;
      },
    });
    expect(() => env.sender.start()).not.toThrow();
    await flush();
    expect(calls).toBe(1);
    expect(env.errors).toHaveLength(1);
    vi.advanceTimersByTime(MONITOR_RECONNECT_DELAY_MS);
    expect(calls).toBe(2);
    sockets[0].open();
    expect(sockets[0].notices()[0]).toMatchObject({ type: "hello" });
  });

  it("WebSocket を作る時に例外が続いても外へ出さない", async () => {
    const env = setup({
      createSocket: () => {
        throw new Error("blocked");
      },
    });
    env.sender.start();
    await flush();
    expect(() => vi.advanceTimersByTime(MONITOR_RECONNECT_DELAY_MS * 3)).not.toThrow();
    expect(env.errors).toHaveLength(4);
  });
});

describe("createMonitorSender（dispose）", () => {
  it("ソケットを閉じ，状態もつなぎ直しも止める", async () => {
    const env = await connected();
    env.sender.setPhase("drill");
    vi.advanceTimersByTime(100);
    const socket = env.last();
    env.sender.dispose();
    expect(socket.closeCalls).toBe(1);
    socket.drop();
    vi.advanceTimersByTime(60_000);
    expect(socket.states()).toHaveLength(2);
    expect(env.sockets).toHaveLength(1);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("つなぎ直しを待っている間に dispose したら，つなぎ直さない", async () => {
    const env = await connected();
    env.last().drop();
    env.sender.dispose();
    vi.advanceTimersByTime(60_000);
    expect(env.sockets).toHaveLength(1);
  });

  it("指紋を待っている間に dispose したら，つながない", async () => {
    let resolve: (value: string) => void = () => {};
    const env = setup({
      getPlanFingerprint: () =>
        new Promise<string>((r) => {
          resolve = r;
        }),
    });
    env.sender.start();
    env.sender.dispose();
    resolve(FINGERPRINT);
    await flush();
    vi.advanceTimersByTime(60_000);
    expect(env.createSocket).not.toHaveBeenCalled();
  });

  it("dispose の後は何を呼んでも例外を出さず，何も送らない", async () => {
    const env = await connected();
    const socket = env.last();
    const before = socket.sent.length;
    env.sender.dispose();
    expect(() => {
      env.sender.dispose();
      env.sender.start();
      env.sender.setPhase("drill");
      env.sender.notifyDoor({ floor: 0, x: 0, z: 0 }, true);
    }).not.toThrow();
    vi.advanceTimersByTime(1000);
    expect(socket.sent).toHaveLength(before);
    expect(env.sockets).toHaveLength(1);
  });

  it("start の前に dispose したら，その後 start してもつながない", async () => {
    const env = setup();
    env.sender.dispose();
    env.sender.start();
    await flush();
    expect(env.createSocket).not.toHaveBeenCalled();
  });
});

describe("createMonitorSender（例外を外へ出さない）", () => {
  it("readState の例外は外へ出さず，次の回も続ける", async () => {
    let fail = true;
    const env = await connected({
      readState: () => {
        if (fail) throw new Error("camera");
        return snapshot();
      },
    });
    env.sender.setPhase("drill");
    expect(() => vi.advanceTimersByTime(100)).not.toThrow();
    expect(env.errors.length).toBeGreaterThan(0);
    fail = false;
    vi.advanceTimersByTime(50);
    expect(
      env
        .last()
        .states()
        .map((s) => s.seq),
    ).toEqual([0]);
  });

  it("send の例外は外へ出さない（状態・知らせ・hello）", async () => {
    const env = setup();
    env.sender.start();
    await flush();
    env.last().sendError = new Error("InvalidStateError");
    expect(() => env.last().open()).not.toThrow();
    expect(() => env.sender.setPhase("drill")).not.toThrow();
    expect(() => env.sender.notifyDoor({ floor: 0, x: 0, z: 0 }, true)).not.toThrow();
    expect(() => vi.advanceTimersByTime(200)).not.toThrow();
    expect(env.errors.length).toBeGreaterThan(0);
  });

  it("状態の send に失敗した回は seq を進めない", async () => {
    const env = await connected();
    env.sender.setPhase("drill");
    env.last().sendError = new Error("InvalidStateError");
    expect(() => vi.advanceTimersByTime(200)).not.toThrow();
    env.last().sendError = null;
    vi.advanceTimersByTime(50);
    expect(
      env
        .last()
        .states()
        .map((s) => s.seq),
    ).toEqual([0]);
  });

  it("drill の phase の知らせの send が失敗しても，drill の間は状態を送る", async () => {
    const env = await connected();
    env.last().sendError = new Error("InvalidStateError");
    env.sender.setPhase("drill");
    env.last().sendError = null;
    vi.advanceTimersByTime(100);
    expect(
      env
        .last()
        .states()
        .map((s) => s.seq),
    ).toEqual([0, 1]);
  });

  it("goal の phase の知らせの send が失敗しても，状態は止める", async () => {
    const env = await connected();
    env.sender.setPhase("drill");
    vi.advanceTimersByTime(100);
    env.last().sendError = new Error("InvalidStateError");
    env.sender.setPhase("goal");
    env.last().sendError = null;
    vi.advanceTimersByTime(500);
    expect(env.last().states()).toHaveLength(2);
  });

  it("close の例外は外へ出さない（切れた時・dispose）", async () => {
    const env = await connected();
    env.last().close = () => {
      throw new Error("close");
    };
    expect(() => env.last().drop()).not.toThrow();
    vi.advanceTimersByTime(MONITOR_RECONNECT_DELAY_MS);
    env.last().open();
    env.last().close = () => {
      throw new Error("close");
    };
    expect(() => env.sender.dispose()).not.toThrow();
  });

  it("getMode の例外は外へ出さない", async () => {
    const env = setup({
      getMode: () => {
        throw new Error("mode");
      },
    });
    env.sender.start();
    await flush();
    expect(() => env.last().open()).not.toThrow();
  });

  it("getStudentId の例外は外へ出さない", () => {
    const env = setup({
      getStudentId: () => {
        throw new Error("id");
      },
    });
    expect(() => env.sender.start()).not.toThrow();
  });

  it("onError 自体の例外も外へ出さない", async () => {
    const env = await connected({
      readState: () => {
        throw new Error("camera");
      },
      onError: () => {
        throw new Error("report");
      },
    });
    env.sender.setPhase("drill");
    expect(() => vi.advanceTimersByTime(200)).not.toThrow();
  });

  it("onError を渡さなくても例外を外へ出さない", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const env = setup({
      onError: undefined,
      readState: () => {
        throw new Error("camera");
      },
    });
    env.sender.start();
    await flush();
    env.last().open();
    env.sender.setPhase("drill");
    expect(() => vi.advanceTimersByTime(200)).not.toThrow();
  });
});

describe("createMonitorSender（指紋が失敗した時）", () => {
  it("指紋の Promise が失敗したらつながず，例外を外へ出さない", async () => {
    const env = setup({ getPlanFingerprint: () => Promise.reject(new Error("digest")) });
    expect(() => env.sender.start()).not.toThrow();
    await flush();
    vi.advanceTimersByTime(60_000);
    expect(env.createSocket).not.toHaveBeenCalled();
    expect(env.errors).toHaveLength(1);
  });

  it("指紋を求める関数がその場で例外を投げても，つながず外へ出さない", async () => {
    const env = setup({
      getPlanFingerprint: () => {
        throw new Error("sync");
      },
    });
    expect(() => env.sender.start()).not.toThrow();
    await flush();
    expect(env.createSocket).not.toHaveBeenCalled();
  });

  it("指紋が失敗しても，その後の setPhase・notifyDoor は例外を出さない", async () => {
    const env = setup({ getPlanFingerprint: () => Promise.reject(new Error("digest")) });
    env.sender.start();
    await flush();
    expect(() => {
      env.sender.setPhase("drill");
      env.sender.notifyDoor({ floor: 0, x: 0, z: 0 }, false);
      vi.advanceTimersByTime(1000);
      env.sender.dispose();
    }).not.toThrow();
  });
});

describe("loadStudentId", () => {
  function memoryStorage(initial: Record<string, string> = {}) {
    const map = new Map(Object.entries(initial));
    const storage: StudentIdStorage = {
      getItem: vi.fn((key: string) => map.get(key) ?? null),
      setItem: vi.fn((key: string, value: string) => {
        map.set(key, value);
      }),
    };
    return { storage, map };
  }

  const isStudentIdNumber = (id: number) => Number.isInteger(id) && id >= 1 && id <= 0xffffffff;

  it("かぎは monitor:studentId", () => {
    expect(MONITOR_STUDENT_ID_KEY).toBe("monitor:studentId");
  });

  it("置いてある ID をそのまま使う（再読み込みしても同じ）", () => {
    const { storage } = memoryStorage({ [MONITOR_STUDENT_ID_KEY]: "3141592653" });
    expect(loadStudentId(() => storage)).toBe(3141592653);
    expect(storage.setItem).not.toHaveBeenCalled();
  });

  it("無い時は作って置き，2 回目は同じ ID を返す", () => {
    const { storage, map } = memoryStorage();
    const first = loadStudentId(() => storage);
    expect(isStudentIdNumber(first)).toBe(true);
    expect(map.get(MONITOR_STUDENT_ID_KEY)).toBe(String(first));
    expect(loadStudentId(() => storage)).toBe(first);
  });

  it.each([
    ["0", "0"],
    ["範囲の外", "4294967296"],
    ["数でない", "abc"],
    ["負の数", "-1"],
    ["小数", "1.5"],
  ])("置いてある値が %s なら作り直して置く", (_label, saved) => {
    const { storage, map } = memoryStorage({ [MONITOR_STUDENT_ID_KEY]: saved });
    const id = loadStudentId(() => storage);
    expect(isStudentIdNumber(id)).toBe(true);
    expect(map.get(MONITOR_STUDENT_ID_KEY)).toBe(String(id));
  });

  it("sessionStorage を取れない時も，作った ID を返す", () => {
    const id = loadStudentId(() => {
      throw new Error("SecurityError");
    });
    expect(isStudentIdNumber(id)).toBe(true);
  });

  it("getItem が例外を投げても，作った ID を返す", () => {
    const storage: StudentIdStorage = {
      getItem: () => {
        throw new Error("SecurityError");
      },
      setItem: () => {},
    };
    expect(isStudentIdNumber(loadStudentId(() => storage))).toBe(true);
  });

  it("setItem が例外を投げても（容量切れ等），作った ID を返す", () => {
    const storage: StudentIdStorage = {
      getItem: () => null,
      setItem: () => {
        throw new Error("QuotaExceededError");
      },
    };
    expect(isStudentIdNumber(loadStudentId(() => storage))).toBe(true);
  });
});

describe("monitorPhaseOfScene", () => {
  it.each<[SceneId, string | null]>([
    ["start", null],
    ["home", "lobby"],
    ["lobby", "lobby"],
    ["scenario", "drill"],
    ["debrief", "result"],
  ])("%s → %s", (id, phase) => {
    expect(monitorPhaseOfScene(id)).toBe(phase);
  });
});

describe("monitorYawOfDirection", () => {
  // 0 が -Z 向きで右回りに増える（SPEC_01「状態」の yaw・DrillSetup.startYaw と同じ）．
  // -Z を向いて立つと右は +X なので，+X 向きが +π/2
  it.each([
    ["-Z 向き（正面）", 0, -1, 0],
    ["+X 向き（右）", 1, 0, Math.PI / 2],
    ["-X 向き（左）", -1, 0, -Math.PI / 2],
    ["右前（+X と -Z の間）", Math.SQRT1_2, -Math.SQRT1_2, Math.PI / 4],
    ["左前（-X と -Z の間）", -Math.SQRT1_2, -Math.SQRT1_2, -Math.PI / 4],
    ["右後ろ", Math.SQRT1_2, Math.SQRT1_2, (3 * Math.PI) / 4],
    ["左後ろ", -Math.SQRT1_2, Math.SQRT1_2, (-3 * Math.PI) / 4],
  ])("%s → %s", (_label, dx, dz, yaw) => {
    expect(monitorYawOfDirection(dx, dz)).toBeCloseTo(yaw, 10);
  });

  it("+Z 向き（後ろ）は ±π（送る時に −π 以上 π 未満へ直される）", () => {
    expect(Math.abs(monitorYawOfDirection(0, 1))).toBeCloseTo(Math.PI, 10);
  });

  it("エディタの開始地点の向き（startYaw）の約束と合う: yaw の向きは (sin, -cos)", () => {
    for (const yaw of [0, 0.3, Math.PI / 2, 2, -1, -Math.PI / 2, -2.5]) {
      expect(monitorYawOfDirection(Math.sin(yaw), -Math.cos(yaw))).toBeCloseTo(yaw, 10);
    }
  });

  it("下や上を向いて水平の成分が短くても，向きだけで決まる", () => {
    expect(monitorYawOfDirection(0.01, 0)).toBeCloseTo(Math.PI / 2, 10);
  });

  it("+Z 向き（後ろ）を送ると −π（-32768 単位）として届く", async () => {
    const env = await connected();
    env.setState(snapshot({ yaw: monitorYawOfDirection(0, 1) }));
    env.sender.setPhase("drill");
    vi.advanceTimersByTime(50);
    expect(env.last().states()[0].yaw).toBeCloseTo(-Math.PI, 10);
  });
});

describe("monitorPitchOfDirection", () => {
  it.each([
    ["水平", 0, 0],
    ["真上", 1, Math.PI / 2],
    ["真下", -1, -Math.PI / 2],
    ["斜め上 30°", 0.5, Math.PI / 6],
    ["斜め下 30°", -0.5, -Math.PI / 6],
  ])("%s → %s", (_label, dy, pitch) => {
    expect(monitorPitchOfDirection(dy)).toBeCloseTo(pitch, 10);
  });

  it.each([
    [1.0000001, Math.PI / 2],
    [-1.0000001, -Math.PI / 2],
  ])("丸めの誤差で ±1 を少し超えても NaN にせず ±π/2 にする（%s）", (dy, pitch) => {
    expect(monitorPitchOfDirection(dy)).toBeCloseTo(pitch, 10);
  });
});

// ---- ロビーと記録の知らせ（SPEC_01「見守り」段階 1「知らせ」の lobby・track と，つなぎ直した時の送り直し） ----

const LOBBY_VIEW: MonitorLobbyView = {
  title: "しゃがんでください",
  body: "その場でしゃがみ，しゃがんだまま止まってください",
  caption: "手順 3 / 5　残り 6 秒",
  startButton: false,
  alignMarker: false,
};

function lobbyView(overrides: Partial<MonitorLobbyView> = {}): {
  -readonly [K in keyof MonitorLobbyView]: MonitorLobbyView[K];
} {
  return { ...LOBBY_VIEW, ...overrides };
}

/** n 件の記録（0.2 秒ごと） */
function trackOf(n: number): DrillTrack {
  return {
    samples: Array.from({ length: n }, (_, i) => ({
      t: i * 0.2,
      floor: 0,
      x: i * 0.01,
      z: -i * 0.01,
      posture: i % 2 === 0 ? ("standing" as const) : ("crouching" as const),
    })),
  };
}

function noticesOfType(socket: FakeSocket, type: string): Record<string, unknown>[] {
  return socket.notices().filter((n) => n.type === type);
}

describe("createMonitorSender（lobby の知らせ）", () => {
  it("lobby の間に notifyLobby すると板の内容をそのまま送る", async () => {
    const env = await connected();
    env.sender.notifyLobby(lobbyView());
    expect(noticesOfType(env.last(), "lobby")).toEqual([
      { type: "lobby", studentId: STUDENT_ID, ...LOBBY_VIEW },
    ]);
    // 受け取る側で読める
    const text = env.last().sent.at(-1)?.data as string;
    expect(parseMonitorNotice(text)).toEqual({
      type: "lobby",
      studentId: STUDENT_ID,
      ...LOBBY_VIEW,
    });
  });

  it("変わるたびに送る（毎回届いたものを送る）", async () => {
    const env = await connected();
    env.sender.notifyLobby(lobbyView({ caption: "残り 6 秒" }));
    env.sender.notifyLobby(lobbyView({ caption: "残り 5 秒" }));
    env.sender.notifyLobby(lobbyView({ startButton: true, alignMarker: true }));
    expect(noticesOfType(env.last(), "lobby").map((n) => [n.caption, n.startButton])).toEqual([
      ["残り 6 秒", false],
      ["残り 5 秒", false],
      [LOBBY_VIEW.caption, true],
    ]);
  });

  it.each(["drill", "goal", "result"] as const)("phase が %s の間は送らない", async (phase) => {
    const env = await connected();
    env.sender.setPhase(phase);
    env.sender.notifyLobby(lobbyView());
    expect(noticesOfType(env.last(), "lobby")).toEqual([]);
  });

  it("phase が drill の間に notifyLobby したものは，つなぎ直しても送り直さない", async () => {
    const env = await connected();
    env.sender.setPhase("drill");
    env.sender.notifyLobby(lobbyView());
    env.last().drop();
    vi.advanceTimersByTime(MONITOR_RECONNECT_DELAY_MS);
    env.last().open();
    expect(
      env
        .last()
        .notices()
        .map((n) => n.type),
    ).toEqual(["hello", "phase"]);
  });

  it("渡したオブジェクトを後で書き換えても，覚えている板は変わらない", async () => {
    const env = await connected();
    const view = { ...lobbyView() };
    env.sender.notifyLobby(view);
    view.title = "書き換え";
    env.last().drop();
    vi.advanceTimersByTime(MONITOR_RECONNECT_DELAY_MS);
    env.last().open();
    expect(noticesOfType(env.last(), "lobby")[0]).toMatchObject({ title: LOBBY_VIEW.title });
  });

  it("send が例外を投げても外へ出さない", async () => {
    const env = await connected();
    env.last().sendError = new Error("send");
    expect(() => env.sender.notifyLobby(lobbyView())).not.toThrow();
    expect(env.errors.length).toBeGreaterThan(0);
  });

  it("何もしない送る側（room= が無い）でも例外を出さない", () => {
    const env = setup({ hash: "#p=xyz" });
    env.sender.start();
    expect(() => env.sender.notifyLobby(lobbyView())).not.toThrow();
    expect(() => env.sender.sendTrack(trackOf(3))).not.toThrow();
    expect(env.createSocket).not.toHaveBeenCalled();
  });
});

describe("createMonitorSender（track の知らせ）", () => {
  it("記録を分けた数だけ続けて送り，受け取る側でつなぐと元の記録になる", async () => {
    const env = await connected();
    env.sender.setPhase("drill");
    env.sender.setPhase("goal");
    const track = trackOf(751);
    env.sender.sendTrack(track);
    const tracks = noticesOfType(env.last(), "track");
    expect(tracks).toHaveLength(4);
    expect(tracks.map((n) => n.part)).toEqual([0, 1, 2, 3]);
    expect(new Set(tracks.map((n) => n.parts))).toEqual(new Set([4]));
    expect(new Set(tracks.map((n) => n.trackId)).size).toBe(1);
    expect(tracks.every((n) => n.studentId === STUDENT_ID)).toBe(true);
    const joined = joinMonitorTrack(
      tracks.map((n) => n.data as string),
      1,
    );
    expect(joined?.samples).toHaveLength(751);
    expect(joined?.samples[750]).toMatchObject({ t: Math.fround(150), x: 7.5, z: -7.5 });
  });

  it("track は goal の phase の後に送られる（app/ の呼ぶ順）", async () => {
    const env = await connected();
    env.sender.setPhase("drill");
    env.sender.setPhase("goal");
    env.sender.sendTrack(trackOf(3));
    const types = env
      .last()
      .notices()
      .map((n) => (n.type === "phase" ? `phase:${n.phase}` : n.type));
    expect(types).toEqual(["hello", "phase:lobby", "phase:drill", "phase:goal", "track"]);
  });

  it("記録ごとに trackId を変える", async () => {
    const env = await connected();
    env.sender.setPhase("drill");
    env.sender.setPhase("goal");
    env.sender.sendTrack(trackOf(3));
    env.sender.setPhase("result");
    env.sender.setPhase("lobby");
    env.sender.setPhase("drill");
    env.sender.setPhase("goal");
    env.sender.sendTrack(trackOf(3));
    const ids = noticesOfType(env.last(), "track").map((n) => n.trackId);
    expect(ids).toHaveLength(2);
    expect(ids[0]).not.toBe(ids[1]);
    for (const id of ids) {
      expect(Number.isInteger(id)).toBe(true);
      expect(id as number).toBeGreaterThanOrEqual(0);
    }
  });

  it("知らせは bufferedAmount が 0 でなくても送る", async () => {
    const env = await connected();
    env.sender.setPhase("drill");
    env.sender.setPhase("goal");
    env.last().bufferedAmount = 100_000;
    env.sender.sendTrack(trackOf(3));
    expect(noticesOfType(env.last(), "track")).toHaveLength(1);
  });

  it("バイト列にできない記録（NaN）は送らず，例外も出さない", async () => {
    const env = await connected();
    env.sender.setPhase("drill");
    env.sender.setPhase("goal");
    expect(() =>
      env.sender.sendTrack({
        samples: [{ t: Number.NaN, floor: 0, x: 0, z: 0, posture: "standing" }],
      }),
    ).not.toThrow();
    expect(noticesOfType(env.last(), "track")).toEqual([]);
  });

  it("つながっていない間に送った記録は，つながった時に goal の phase の後に送る", async () => {
    const env = setup();
    env.sender.start();
    env.sender.setPhase("drill");
    env.sender.setPhase("goal");
    env.sender.sendTrack(trackOf(3));
    await flush();
    env.last().open();
    expect(
      env
        .last()
        .notices()
        .map((n) => n.type),
    ).toEqual(["hello", "phase", "track"]);
    expect(env.last().notices()[1]).toMatchObject({ phase: "goal" });
  });
});

describe("createMonitorSender（つなぎ直した時の lobby・track の送り直し）", () => {
  /** 切ってつなぎ直し，新しいソケットを返す */
  function reconnect(env: Awaited<ReturnType<typeof connected>>): FakeSocket {
    env.last().drop();
    vi.advanceTimersByTime(MONITOR_RECONNECT_DELAY_MS);
    env.last().open();
    return env.last();
  }

  it("ロビーの間は hello → phase の後に，最新の lobby を 1 つだけ送り直す", async () => {
    const env = await connected();
    env.sender.notifyLobby(lobbyView({ caption: "残り 6 秒" }));
    env.sender.notifyLobby(lobbyView({ caption: "残り 5 秒" }));
    const socket = reconnect(env);
    expect(socket.notices()).toEqual([
      expect.objectContaining({ type: "hello" }),
      { type: "phase", studentId: STUDENT_ID, phase: "lobby" },
      { type: "lobby", studentId: STUDENT_ID, ...LOBBY_VIEW, caption: "残り 5 秒" },
    ]);
  });

  it("切れている間に notifyLobby した最新のものも，つなぎ直した時に送る", async () => {
    const env = await connected();
    env.sender.notifyLobby(lobbyView({ caption: "古い" }));
    env.last().drop();
    env.sender.notifyLobby(lobbyView({ caption: "新しい" }));
    vi.advanceTimersByTime(MONITOR_RECONNECT_DELAY_MS);
    env.last().open();
    expect(noticesOfType(env.last(), "lobby").map((n) => n.caption)).toEqual(["新しい"]);
  });

  it("最初につながる前に notifyLobby したものも，最初の接続で hello → phase の後に送る", async () => {
    const env = setup();
    env.sender.start();
    env.sender.notifyLobby(lobbyView());
    await flush();
    env.last().open();
    expect(
      env
        .last()
        .notices()
        .map((n) => n.type),
    ).toEqual(["hello", "phase", "lobby"]);
  });

  it("phase が変わったら lobby を忘れる（drill の間につなぎ直しても送らない）", async () => {
    const env = await connected();
    env.sender.notifyLobby(lobbyView());
    env.sender.setPhase("drill");
    const socket = reconnect(env);
    expect(socket.notices().map((n) => n.type)).toEqual(["hello", "phase"]);
  });

  it("lobby → drill → goal → result → lobby と戻っても，前の回の lobby は送らない", async () => {
    const env = await connected();
    env.sender.notifyLobby(lobbyView({ caption: "前の回" }));
    env.sender.setPhase("drill");
    env.sender.setPhase("goal");
    env.sender.setPhase("result");
    env.sender.setPhase("lobby");
    const socket = reconnect(env);
    expect(socket.notices().map((n) => n.type)).toEqual(["hello", "phase"]);
  });

  it.each(["goal", "result"] as const)(
    "%s の間は hello → phase の後に最後の記録の track を全部送り直す",
    async (phase) => {
      const env = await connected();
      env.sender.setPhase("drill");
      env.sender.setPhase("goal");
      env.sender.sendTrack(trackOf(751));
      const sentBefore = noticesOfType(env.last(), "track");
      if (phase === "result") env.sender.setPhase("result");
      const socket = reconnect(env);
      const notices = socket.notices();
      expect(notices.slice(0, 2)).toEqual([
        expect.objectContaining({ type: "hello" }),
        { type: "phase", studentId: STUDENT_ID, phase },
      ]);
      expect(notices.slice(2)).toEqual(sentBefore);
      expect(notices.slice(2)).toHaveLength(4);
    },
  );

  it("送り直す track は最後の記録のもの（前の記録は送らない）", async () => {
    const env = await connected();
    env.sender.setPhase("drill");
    env.sender.setPhase("goal");
    env.sender.sendTrack(trackOf(3));
    env.sender.sendTrack(trackOf(5));
    const lastId = noticesOfType(env.last(), "track").at(-1)?.trackId;
    const socket = reconnect(env);
    const tracks = noticesOfType(socket, "track");
    expect(tracks).toHaveLength(1);
    expect(tracks[0].trackId).toBe(lastId);
    expect(joinMonitorTrack([tracks[0].data as string], 1)?.samples).toHaveLength(5);
  });

  it.each(["lobby", "drill"] as const)(
    "%s に移ったら track を忘れる（つなぎ直しても送らない）",
    async (next) => {
      const env = await connected();
      env.sender.setPhase("drill");
      env.sender.setPhase("goal");
      env.sender.sendTrack(trackOf(3));
      env.sender.setPhase("result");
      env.sender.setPhase(next);
      const socket = reconnect(env);
      expect(noticesOfType(socket, "track")).toEqual([]);
    },
  );

  it("goal から result に移っても track は忘れない", async () => {
    const env = await connected();
    env.sender.setPhase("drill");
    env.sender.setPhase("goal");
    env.sender.sendTrack(trackOf(3));
    env.sender.setPhase("result");
    const socket = reconnect(env);
    expect(noticesOfType(socket, "track")).toHaveLength(1);
  });

  it("door は送り直さない（段階 2）", async () => {
    const env = await connected();
    env.sender.setPhase("drill");
    env.sender.notifyDoor({ floor: 0, x: 1, z: 1 }, true);
    env.sender.setPhase("goal");
    env.sender.sendTrack(trackOf(3));
    const socket = reconnect(env);
    expect(socket.notices().map((n) => n.type)).toEqual(["hello", "phase", "track"]);
  });
});

// ---- 音の合図（cue・speech・stopAudio）．仕様: SPEC_01「見守り」段階 1「知らせ」の表と「音」 ----

describe("createMonitorSender（音の合図）", () => {
  const NARRATION = {
    type: "narration",
    id: "fire-announcement",
    params: { roomName: "3年1組" },
  } as const;
  const SOUND = {
    type: "sound",
    id: "fire-crackle",
    action: "play",
    loop: true,
    anchorId: "fire-0",
  } as const;
  /** 制御文字の書き換え（\u0001 → 6 文字）で JSON が 4 KiB を超える params */
  const HUGE_PARAMS = Object.fromEntries(
    Array.from({ length: 8 }, (_, i) => [`k${i}`, "\u0001".repeat(100)]),
  );

  it("つながっている時は cue（narration・sound）をそのまま送る", async () => {
    const env = await connected();
    env.sender.notifyCue(NARRATION);
    env.sender.notifyCue(SOUND);
    env.sender.notifyCue({ type: "sound", id: "fire-crackle", action: "stop" });
    expect(noticesOfType(env.last(), "cue")).toEqual([
      { type: "cue", studentId: STUDENT_ID, cue: NARRATION },
      { type: "cue", studentId: STUDENT_ID, cue: SOUND },
      {
        type: "cue",
        studentId: STUDENT_ID,
        cue: { type: "sound", id: "fire-crackle", action: "stop" },
      },
    ]);
  });

  it("送った cue の JSON は見守り画面の parseMonitorNotice で読める", async () => {
    const env = await connected();
    env.sender.notifyCue(NARRATION);
    const text = env.last().sent.at(-1)?.data;
    expect(typeof text).toBe("string");
    expect(parseMonitorNotice(text as string)).toEqual({
      type: "cue",
      studentId: STUDENT_ID,
      cue: NARRATION,
    });
  });

  it("happening は送らない", async () => {
    const env = await connected();
    env.sender.notifyCue({ type: "happening", id: "smoke", params: { strength: 1 } });
    env.sender.notifyCue({ type: "happening", id: "shake" });
    expect(noticesOfType(env.last(), "cue")).toHaveLength(0);
  });

  it.each<[string, unknown]>([
    ["id が 65 文字", { type: "narration", id: "a".repeat(65) }],
    ["id が空", { type: "sound", id: "", action: "play" }],
    ["action が不正", { type: "sound", id: "bell", action: "pause" }],
    ["loop が真偽値でない", { type: "sound", id: "bell", action: "play", loop: "yes" }],
    [
      "anchorId が 65 文字",
      { type: "sound", id: "bell", action: "play", anchorId: "a".repeat(65) },
    ],
    [
      "params が 9 個",
      {
        type: "narration",
        id: "n",
        params: Object.fromEntries(Array.from({ length: 9 }, (_, i) => [`k${i}`, 1])),
      },
    ],
    ["params の値が NaN", { type: "narration", id: "n", params: { a: Number.NaN } }],
    [
      "params の値が Infinity",
      { type: "narration", id: "n", params: { a: Number.POSITIVE_INFINITY } },
    ],
    ["params の値がオブジェクト", { type: "narration", id: "n", params: { a: {} } }],
    [
      "params の文字の値が 101 文字",
      { type: "narration", id: "n", params: { a: "a".repeat(101) } },
    ],
    ["null", null],
  ])("形に合わない cue（%s）は送らず，例外も出さない", async (_label, cue) => {
    const env = await connected();
    expect(() => env.sender.notifyCue(cue as never)).not.toThrow();
    expect(noticesOfType(env.last(), "cue")).toHaveLength(0);
  });

  it("JSON にして 4 KiB を超える cue は送らない（その後の合図は送る）", async () => {
    const env = await connected();
    env.sender.notifyCue({ type: "narration", id: "n", params: HUGE_PARAMS });
    expect(noticesOfType(env.last(), "cue")).toHaveLength(0);
    env.sender.notifyCue(NARRATION);
    expect(noticesOfType(env.last(), "cue")).toHaveLength(1);
  });

  it("4 KiB に収まる上限ぎりぎりの cue（日本語）は送る", async () => {
    const env = await connected();
    const params = Object.fromEntries(
      Array.from({ length: 8 }, (_, i) => [`${"か".repeat(31)}${i}`, "あ".repeat(100)]),
    );
    env.sender.notifyCue({ type: "narration", id: "い".repeat(64), params });
    const sent = env.last().sent.at(-1)?.data as string;
    expect(new TextEncoder().encode(sent).length).toBeLessThanOrEqual(4096);
    expect(noticesOfType(env.last(), "cue")).toHaveLength(1);
  });

  it("つながっている時は speech を文と速さのまま送る", async () => {
    const env = await connected();
    env.sender.notifySpeech("体の正面を向いて，そのまま動かないでください", 1.05);
    env.sender.notifySpeech("a", 0.1);
    env.sender.notifySpeech("あ".repeat(500), 10);
    expect(noticesOfType(env.last(), "speech")).toEqual([
      {
        type: "speech",
        studentId: STUDENT_ID,
        text: "体の正面を向いて，そのまま動かないでください",
        rate: 1.05,
      },
      { type: "speech", studentId: STUDENT_ID, text: "a", rate: 0.1 },
      { type: "speech", studentId: STUDENT_ID, text: "あ".repeat(500), rate: 10 },
    ]);
  });

  it.each<[string, unknown, unknown]>([
    ["文が 501 文字", "あ".repeat(501), 1],
    ["文が空", "", 1],
    ["文が文字でない", 1, 1],
    ["速さが 0.09", "a", 0.09],
    ["速さが 10.01", "a", 10.01],
    ["速さが NaN", "a", Number.NaN],
    ["速さが Infinity", "a", Number.POSITIVE_INFINITY],
    ["速さが文字", "a", "1"],
  ])("形に合わない speech（%s）は送らず，例外も出さない", async (_label, text, rate) => {
    const env = await connected();
    expect(() => env.sender.notifySpeech(text as string, rate as number)).not.toThrow();
    expect(noticesOfType(env.last(), "speech")).toHaveLength(0);
  });

  it("つながっている時は stopAudio を送る（呼ぶたびに）", async () => {
    const env = await connected();
    env.sender.notifyAudioStop();
    env.sender.notifyAudioStop();
    expect(noticesOfType(env.last(), "stopAudio")).toEqual([
      { type: "stopAudio", studentId: STUDENT_ID },
      { type: "stopAudio", studentId: STUDENT_ID },
    ]);
  });

  it("start の前・指紋を待つ間・つながる前（CONNECTING）の合図は捨て，つながった後にも送り直さない", async () => {
    const env = setup();
    const callAll = () => {
      env.sender.notifyCue(NARRATION);
      env.sender.notifySpeech("a", 1);
      env.sender.notifyAudioStop();
    };
    callAll();
    env.sender.start();
    callAll();
    await flush();
    callAll();
    env.last().open();
    expect(
      env
        .last()
        .notices()
        .map((n) => n.type),
    ).toEqual(["hello", "phase"]);
  });

  it("切れている間の合図は捨て，つなぎ直した後は hello と今の phase だけ", async () => {
    const env = await connected();
    env.sender.setPhase("drill");
    env.sender.notifyCue(SOUND);
    env.last().drop();
    env.sender.notifyCue(NARRATION);
    env.sender.notifySpeech("a", 1);
    env.sender.notifyAudioStop();
    vi.advanceTimersByTime(MONITOR_RECONNECT_DELAY_MS);
    env.last().open();
    expect(env.sockets).toHaveLength(2);
    expect(env.last().notices()).toEqual([
      expect.objectContaining({ type: "hello", studentId: STUDENT_ID }),
      { type: "phase", studentId: STUDENT_ID, phase: "drill" },
    ]);
  });

  it("ロビーの間に送った speech も，つなぎ直した時に送り直さない", async () => {
    const env = await connected();
    env.sender.notifySpeech("しゃがんでください", 1);
    env.last().drop();
    vi.advanceTimersByTime(MONITOR_RECONNECT_DELAY_MS);
    env.last().open();
    expect(noticesOfType(env.last(), "speech")).toHaveLength(0);
  });

  it.each([
    ["住所が未設定", { relayUrl: undefined }],
    ["room= が無い", { hash: "#p=xyz" }],
  ])("何もしない送る側（%s）でも例外を出さず，何も作らない", async (_label, override) => {
    const env = setup(override);
    env.sender.start();
    await flush();
    expect(() => {
      env.sender.notifyCue(NARRATION);
      env.sender.notifyCue({ type: "happening", id: "smoke" });
      env.sender.notifySpeech("a", 1);
      env.sender.notifySpeech("", Number.NaN);
      env.sender.notifyAudioStop();
    }).not.toThrow();
    expect(env.createSocket).not.toHaveBeenCalled();
  });

  it("send が例外を投げても外へ出さない", async () => {
    const env = await connected();
    env.last().sendError = new Error("InvalidStateError");
    expect(() => {
      env.sender.notifyCue(NARRATION);
      env.sender.notifySpeech("a", 1);
      env.sender.notifyAudioStop();
    }).not.toThrow();
    expect(env.errors.length).toBeGreaterThan(0);
  });

  it("dispose の後は例外を出さず，何も送らない", async () => {
    const env = await connected();
    const socket = env.last();
    const before = socket.sent.length;
    env.sender.dispose();
    expect(() => {
      env.sender.notifyCue(NARRATION);
      env.sender.notifySpeech("a", 1);
      env.sender.notifyAudioStop();
    }).not.toThrow();
    expect(socket.sent).toHaveLength(before);
  });

  it("Cue の読み出しで例外が出ても（壊れたオブジェクト）外へ出さない", async () => {
    const env = await connected();
    const broken = {
      get type(): string {
        throw new Error("getter");
      },
    };
    expect(() => env.sender.notifyCue(broken as never)).not.toThrow();
    expect(noticesOfType(env.last(), "cue")).toHaveLength(0);
  });
});

describe("createMonitorSender（4 KiB の確かめ）", () => {
  it("JSON にして 4 KiB を超える lobby（制御文字の書き換え）は送らない", async () => {
    const env = await connected();
    const huge = "\u0001".repeat(300);
    env.sender.notifyLobby(lobbyView({ title: huge, body: huge, caption: huge }));
    expect(noticesOfType(env.last(), "lobby")).toHaveLength(0);
    env.sender.notifyLobby(lobbyView());
    expect(noticesOfType(env.last(), "lobby")).toHaveLength(1);
  });

  it("送った知らせはすべて UTF-8 で 4096 バイト以下", async () => {
    const env = await connected();
    env.sender.notifyLobby(
      lobbyView({ title: "あ".repeat(300), body: "い".repeat(300), caption: "う".repeat(300) }),
    );
    env.sender.notifySpeech("え".repeat(500), 1);
    for (const s of env.last().sent) {
      if (typeof s.data === "string") {
        expect(new TextEncoder().encode(s.data).length).toBeLessThanOrEqual(4096);
      }
    }
    expect(noticesOfType(env.last(), "lobby")).toHaveLength(1);
    expect(noticesOfType(env.last(), "speech")).toHaveLength(1);
  });
});
