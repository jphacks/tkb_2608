// 生徒の端末から見守りの中継へ，状態（1 秒に 20 回）と知らせ（hello・phase・door）を送る（SPEC_01「見守り」の段階 1）．
// 見守りは付け足しなので，つながらない・切れた・住所が未設定でも体験に影響させない（例外を外へ投げず，接続を待たない）

import type { DrillTrack } from "../core/drill";
import type { SceneId } from "../core/scene";
import type { CellRef, DrillMode } from "../core/schoolPlan";
import type { Posture } from "../core/types";
import { createStudentId, getRoomIdFromHash, parseStudentId } from "../share/monitorIds";
import {
  MONITOR_NOTICE_VERSION,
  type MonitorLobbyNotice,
  type MonitorNotice,
  type MonitorPhase,
  type MonitorTrackNotice,
  stringifyMonitorNotice,
} from "../share/monitorNotice";
import {
  MONITOR_STATE_BYTES,
  type MonitorState,
  nextMonitorSeq,
  writeMonitorState,
} from "../share/monitorState";
import { splitMonitorTrack } from "../share/monitorTrack";

/** 状態を送る間隔（ms）．1 秒に 20 回 */
export const MONITOR_STATE_INTERVAL_MS = 50;

/** つながらない・切れた時に，つなぎ直すまでの間（ms） */
export const MONITOR_RECONNECT_DELAY_MS = 5000;

/** 生徒の ID を置く sessionStorage のかぎ（タブごとに分かれ，再読み込みしても同じ ID になる） */
export const MONITOR_STUDENT_ID_KEY = "monitor:studentId";

/** WebSocket の readyState の OPEN */
const SOCKET_OPEN = 1;

/** 送る状態のうち，生徒の画面から取る値（studentId・seq は送る側が付ける） */
export interface MonitorSnapshot {
  /** 階（SchoolPlan.floors の添字） */
  readonly floor: number;
  readonly posture: Posture;
  /** 非常ベルからの秒数（s）．非常ベルの前は負の数 */
  readonly t: number;
  /** カメラのワールド座標の X（m） */
  readonly x: number;
  /** カメラのワールド座標の Z（m） */
  readonly z: number;
  /** カメラの水平の向き（rad．0 が -Z 向きで右回りに増える．SchoolPlan の startYaw と同じ） */
  readonly yaw: number;
  /** カメラの上下の向き（rad．上が正） */
  readonly pitch: number;
}

/** ロビーの板の内容（lobby の知らせの studentId 以外） */
export type MonitorLobbyView = Omit<MonitorLobbyNotice, "type" | "studentId">;

/** 状態を送る phase（避難の画面とロビー．ホームでは readState が null を返して送らない） */
export function isStatePhase(phase: MonitorPhase): boolean {
  return phase === "drill" || phase === "lobby";
}

/** 送る側が使う WebSocket の最小限（テストで差し替える） */
export interface MonitorSocketLike {
  readonly readyState: number;
  readonly bufferedAmount: number;
  onopen: ((event: unknown) => void) | null;
  onclose: ((event: unknown) => void) | null;
  onerror: ((event: unknown) => void) | null;
  send(data: string | ArrayBuffer): void;
  close(): void;
}

/** 接続先の URL から WebSocket を作る（失敗したら例外を投げてよい．送る側が受け止める） */
export type MonitorSocketFactory = (url: string) => MonitorSocketLike;

export interface MonitorSenderOptions {
  /** 中継の住所（`import.meta.env.VITE_MONITOR_RELAY_URL`）．`ws://`・`wss://` で始まらない・未設定なら何もしない */
  readonly relayUrl: unknown;
  /** URL のフラグメント（`location.hash`）．`room=` が無い・形に合わなければ何もしない */
  readonly hash: string;
  /** 生徒の ID（つなぐ時に 1 回だけ呼ぶ） */
  readonly getStudentId: () => number;
  /** 校舎の指紋（つなぐ時に 1 回だけ呼ぶ．失敗したらつながない） */
  readonly getPlanFingerprint: () => Promise<string>;
  /** hello で送る学習／テストのモード（hello のたびに呼ぶ） */
  readonly getMode: () => DrillMode;
  /** 今の状態（drill と lobby の間，送るたびに呼ぶ．毎回 new しなくてよいよう，同じオブジェクトを書き換えて返してよい）．null ならその回は送らない */
  readonly readState: () => MonitorSnapshot | null;
  /** WebSocket の作り方（既定はブラウザの WebSocket） */
  readonly createSocket?: MonitorSocketFactory;
  /** 受け止めた例外を知らせる（既定は開発時だけ console.warn） */
  readonly onError?: (error: unknown) => void;
}

/** 体験の側から呼ぶ窓口．どれも例外を投げず，接続を待たない */
export interface MonitorSender {
  /** 中継につなぎ始める（2 回目以降は何もしない）．ホームに入る時に呼ぶ */
  start(): void;
  /** 画面が移った時に呼ぶ．同じ phase が続く時は送らない */
  setPhase(phase: MonitorPhase): void;
  /** 避難の画面でドアを開け閉めした時に呼ぶ（つながっていない間は捨てる） */
  notifyDoor(cell: CellRef, open: boolean): void;
  /**
   * ロビーの指示の板の内容が変わった時に呼ぶ．つながっていない間も最新のものを覚えておき，
   * つなぎ直した時に phase の後に送り直す（phase が変わったら忘れる）
   */
  notifyLobby(view: MonitorLobbyView): void;
  /**
   * 避難が終わった時（phase を goal にした後）に，その回の記録を送る．
   * つなぎ直した時も，phase が goal・result の間は送り直す（lobby・drill に移ったら忘れる）
   */
  sendTrack(track: DrillTrack): void;
  /** 接続とタイマーを片付ける */
  dispose(): void;
}

/**
 * 中継の住所とフラグメントから，生徒の接続先の URL を作る．
 * 住所が `ws://`・`wss://` で始まる文字列でない（未設定・空を含む），または `room=` が無い・形に合わない時は null
 */
export function resolveMonitorRelayEndpoint(relayUrl: unknown, hash: string): string | null {
  if (typeof relayUrl !== "string" || !/^wss?:\/\/./.test(relayUrl)) return null;
  const roomId = getRoomIdFromHash(hash);
  if (roomId === null) return null;
  // 住所の末尾に `/` を付けない約束だが，付いていても二重にしない
  return `${relayUrl.replace(/\/+$/, "")}/rooms/${roomId}?role=student`;
}

/** 画面の ID を phase の知らせの値にする（start は送らない＝null．ホーム〜ロビーは lobby） */
export function monitorPhaseOfScene(id: SceneId): MonitorPhase | null {
  switch (id) {
    case "start":
      return null;
    case "home":
    case "lobby":
      return "lobby";
    case "scenario":
      return "drill";
    case "debrief":
      return "result";
  }
}

/**
 * カメラの向いている向き（ワールドの単位ベクトル．three.js の座標）から，送る水平の向き（rad）を求める．
 * 状態の yaw は SchoolPlan の startYaw と同じく 0 が -Z 向きで右回り（+X 側）に増える（three.js の「正で左へ回る」とは逆）
 */
export function monitorYawOfDirection(dirX: number, dirZ: number): number {
  return Math.atan2(dirX, -dirZ);
}

/** カメラの向いている向きの Y 成分（単位ベクトル）から，送る上下の向き（rad．上が正）を求める */
export function monitorPitchOfDirection(dirY: number): number {
  return Math.asin(Math.min(1, Math.max(-1, dirY)));
}

/** sessionStorage の最小限（テストで差し替える） */
export type StudentIdStorage = Pick<Storage, "getItem" | "setItem">;

/**
 * 生徒の ID を sessionStorage から読み，無い・読めない時は作って置く．
 * sessionStorage が使えない（プライベートモード等で例外を投げる）時も，作った ID を返す（その時は再読み込みで変わる）
 */
export function loadStudentId(getStorage: () => StudentIdStorage): number {
  let storage: StudentIdStorage | null = null;
  try {
    storage = getStorage();
    const saved = parseStudentId(storage.getItem(MONITOR_STUDENT_ID_KEY));
    if (saved !== null) return saved;
  } catch {
    // 読めない時は作り直す
  }
  const created = createStudentId();
  try {
    storage?.setItem(MONITOR_STUDENT_ID_KEY, String(created));
  } catch {
    // 置けなくても送ることはできる
  }
  return created;
}

/** 開発時だけ，受け止めた例外をログに出す */
function warnInDev(error: unknown): void {
  if (import.meta.env.DEV) console.warn("見守りの送信で例外を受け止めました", error);
}

/** 何もしない送る側（`room=` が無い・住所が未設定の時） */
const NOOP_SENDER: MonitorSender = {
  start() {},
  setPhase() {},
  notifyDoor() {},
  notifyLobby() {},
  sendTrack() {},
  dispose() {},
};

/**
 * 見守りの送る側を作る．`room=` が無い・中継の住所が未設定なら何もしない送る側を返す（WebSocket もタイマーも作らない）．
 * 状態は phase が drill・lobby の間だけ，描画のループとは別の setInterval で送り，`bufferedAmount` が 0 でない回は捨てる
 */
export function createMonitorSender(options: MonitorSenderOptions): MonitorSender {
  const endpoint = resolveMonitorRelayEndpoint(options.relayUrl, options.hash);
  if (endpoint === null) return NOOP_SENDER;
  const url: string = endpoint;

  const report = options.onError ?? warnInDev;
  // 送る側は handler の引数を読まないので，引数の型の違い（Event・CloseEvent）は問題にならない
  const createSocket: MonitorSocketFactory =
    options.createSocket ?? ((target) => new WebSocket(target) as MonitorSocketLike);

  // 毎回 new しないよう，状態を書く 20 バイトは 1 つだけ用意して使い回す
  const buffer = new ArrayBuffer(MONITOR_STATE_BYTES);
  const view = new DataView(buffer);
  // 書き込む前の値も毎回 new しないよう使い回す
  const state: { -readonly [K in keyof MonitorState]: MonitorState[K] } = {
    studentId: 0,
    seq: 0,
    floor: 0,
    posture: "standing",
    t: 0,
    x: 0,
    z: 0,
    yaw: 0,
    pitch: 0,
  };

  let started = false;
  let disposed = false;
  let studentId = 0;
  let planFingerprint: string | null = null;
  let socket: MonitorSocketLike | null = null;
  let phase: MonitorPhase = "lobby";
  let seq = 0;
  let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  let stateTimer: ReturnType<typeof setInterval> | null = null;
  /** 最新のロビーの板（つなぎ直した時に送り直す．phase が変わったら null） */
  let lobbyView: MonitorLobbyView | null = null;
  /** 最後に送った記録の知らせ（つなぎ直した時に送り直す．lobby・drill に移ったら空） */
  let trackNotices: readonly MonitorTrackNotice[] = [];
  let nextTrackId = 0;

  /** 体験の側へ例外を出さないよう，見守りの処理はすべてこれで包む */
  const guard = (task: () => void): void => {
    try {
      task();
    } catch (error) {
      try {
        report(error);
      } catch {
        // 報告の失敗も外へ出さない
      }
    }
  };

  const openSocket = (): MonitorSocketLike | null =>
    socket !== null && socket.readyState === SOCKET_OPEN ? socket : null;

  const sendNotice = (notice: MonitorNotice): void => {
    // 知らせは小さいので bufferedAmount を見ずに送る．つながっていない間は捨てる（段階 1 は送り直さない）
    openSocket()?.send(stringifyMonitorNotice(notice));
  };

  const sendState = (): void => {
    const ws = openSocket();
    // 回線が詰まっている時は溜めずに捨てる（遅れが積み上がらないように）
    if (ws === null || ws.bufferedAmount > 0) return;
    const snapshot = options.readState();
    if (snapshot === null) return;
    state.studentId = studentId;
    state.seq = seq;
    state.floor = snapshot.floor;
    state.posture = snapshot.posture;
    state.t = snapshot.t;
    state.x = snapshot.x;
    state.z = snapshot.z;
    state.yaw = snapshot.yaw;
    state.pitch = snapshot.pitch;
    // 値が有限でない等で書けない回は送らない
    if (!writeMonitorState(view, state)) return;
    ws.send(buffer);
    seq = nextMonitorSeq(seq);
  };

  const stopStateTimer = (): void => {
    if (stateTimer !== null) clearInterval(stateTimer);
    stateTimer = null;
  };

  const startStateTimer = (): void => {
    if (stateTimer !== null || disposed) return;
    stateTimer = setInterval(() => guard(sendState), MONITOR_STATE_INTERVAL_MS);
  };

  const scheduleReconnect = (): void => {
    if (reconnectTimer !== null || disposed) return;
    reconnectTimer = setTimeout(() => {
      reconnectTimer = null;
      guard(connect);
    }, MONITOR_RECONNECT_DELAY_MS);
  };

  /** 接続が切れた・つながらなかった時の片付け（error と close の両方から呼ばれても 1 回にする） */
  const handleDown = (target: MonitorSocketLike): void => {
    if (target !== socket) return;
    socket = null;
    target.onopen = null;
    target.onclose = null;
    target.onerror = null;
    try {
      target.close();
    } catch {
      // 閉じられなくてもよい
    }
    scheduleReconnect();
  };

  function connect(): void {
    if (disposed || socket !== null || planFingerprint === null) return;
    let ws: MonitorSocketLike;
    try {
      ws = createSocket(url);
    } catch (error) {
      report(error);
      scheduleReconnect();
      return;
    }
    socket = ws;
    ws.onopen = () =>
      guard(() => {
        if (ws !== socket || planFingerprint === null) return;
        sendNotice({
          type: "hello",
          studentId,
          v: MONITOR_NOTICE_VERSION,
          planFingerprint,
          mode: options.getMode(),
        });
        // つなぎ直した時も今の画面が見守り画面に戻るよう，hello の直後に今の phase を送る
        sendNotice({ type: "phase", studentId, phase });
        // ロビーの板と避難の記録は，見守り画面がその画面を描き直すのに要るので送り直す
        if (lobbyView !== null) sendNotice({ type: "lobby", studentId, ...lobbyView });
        for (const notice of trackNotices) sendNotice(notice);
      });
    ws.onclose = () => guard(() => handleDown(ws));
    ws.onerror = () => guard(() => handleDown(ws));
  }

  return {
    start() {
      if (started || disposed) return;
      started = true;
      guard(() => {
        studentId = options.getStudentId();
        // 最初の phase（lobby）は setPhase で変わらないため，ここで状態の送信を始める（送るのはつながってから）
        if (isStatePhase(phase)) startStateTimer();
        // 指紋（SHA-256）を待つ間も体験は進める．待つのは見守りの中だけ
        options
          .getPlanFingerprint()
          .then((fingerprint) => {
            planFingerprint = fingerprint;
            guard(connect);
          })
          .catch((error: unknown) => guard(() => report(error)));
      });
    },
    setPhase(next) {
      guard(() => {
        if (next === phase) return;
        phase = next;
        lobbyView = null;
        if (phase === "lobby" || phase === "drill") trackNotices = [];
        // 知らせの送信が例外を投げても状態の送信の開始・停止は必ず行うよう，タイマーを先に切り替える
        if (isStatePhase(phase)) startStateTimer();
        else stopStateTimer();
        sendNotice({ type: "phase", studentId, phase });
      });
    },
    notifyDoor(cell, open) {
      guard(() => sendNotice({ type: "door", studentId, cell, open }));
    },
    notifyLobby(view) {
      guard(() => {
        if (phase !== "lobby") return;
        lobbyView = { ...view };
        sendNotice({ type: "lobby", studentId, ...lobbyView });
      });
    },
    sendTrack(track) {
      guard(() => {
        nextTrackId += 1;
        trackNotices = splitMonitorTrack(studentId, nextTrackId, track);
        for (const notice of trackNotices) sendNotice(notice);
      });
    },
    dispose() {
      guard(() => {
        disposed = true;
        stopStateTimer();
        if (reconnectTimer !== null) clearTimeout(reconnectTimer);
        reconnectTimer = null;
        const ws = socket;
        socket = null;
        if (ws !== null) {
          ws.onopen = null;
          ws.onclose = null;
          ws.onerror = null;
          ws.close();
        }
      });
    },
  };
}
