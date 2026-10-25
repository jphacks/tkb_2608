// 見守り画面の受け取りの状態（映す生徒・画面の状態・通し番号・ためた状態・ドア・ロビーの板・記録）を持ち，知らせと状態で切り替える
// （SPEC_01「見守り」の「見守り画面」）．時刻は呼ぶ側が渡す（performance.now() の ms）．WebSocket・DOM・three.js には触れない（node でテストできるように）
import type { DrillTrack } from "../core/drill";
import type { CellRef } from "../core/schoolPlan";
import type { MonitorLobbyNotice, MonitorNotice, MonitorTrackNotice } from "../share/monitorNotice";
import { isNewerMonitorSeq, type MonitorState } from "../share/monitorState";
import { joinMonitorTrack } from "../share/monitorTrack";
import {
  createMonitorPose,
  MONITOR_BUFFER_LIMIT,
  MONITOR_RENDER_DELAY_MS,
  type MonitorPose,
  type ReceivedMonitorState,
  sampleMonitorStates,
  staleMonitorStateCount,
} from "./stateBuffer";

/** 体験中に状態がこの時間（ms）届かなければ「電波が途切れています」と出す */
export const MONITOR_STALL_MS = 1000;

/** 記録の階の数の既定（コンストラクタで校舎の階の数を渡さない時．u8 に入る数） */
const DEFAULT_FLOOR_COUNT = 256;

/**
 * 画面の状態．
 * - waiting: 接続待ち（まだ hello が届いていない．違う生徒の hello の後，phase が来るまでも）
 * - preparing: 準備中（phase が lobby．ロビーの板が届いていればロビーを描く）
 * - live: 体験中（phase が drill．または接続待ちの時に状態が届いた）
 * - ended: 終わり（phase が goal・result．記録が届いていれば結果画面を出す）
 */
export type MonitorScreen = "waiting" | "preparing" | "live" | "ended";

/** 受け取りの結果，描く側（ドアを持つ校舎の 3D）に行ってほしいこと */
export type MonitorEffect =
  | { readonly kind: "resetDoors" }
  | { readonly kind: "door"; readonly cell: CellRef; readonly open: boolean };

const RESET_DOORS: MonitorEffect = Object.freeze({ kind: "resetDoors" });

/** 1 フレーム分の描き方（MonitorSession.frame の結果．返す値は次の frame で書き換わる） */
export interface MonitorFrame {
  screen: MonitorScreen;
  /** 映す生徒の hello の校舎の指紋が手元の校舎と違う（描かずに案内を出す） */
  mismatch: boolean;
  /** 体験中に状態が MONITOR_STALL_MS 以上届いていない（最後の画面のまま止める） */
  stalled: boolean;
  /** 描く姿勢（体験中・終わり・準備中のロビー）．まだ状態が無ければ null（開始地点・ロビーの正面から描く） */
  pose: MonitorPose | null;
  /** 準備中に届いた最新のロビーの板．届いていなければ null（「体験者は準備中です」と出す．省略も null と同じ） */
  lobby?: MonitorLobbyNotice | null;
  /** 終わりの間に届いた記録．つなぎ終えていなければ null（省略も null と同じ） */
  track?: DrillTrack | null;
}

/** 集めている記録の部分 */
interface TrackParts {
  readonly trackId: number;
  readonly parts: (string | undefined)[];
}

/** 見守り画面の受け取りの状態．映すのは最後に hello が届いた生徒 1 人だけ */
export class MonitorSession {
  private screenState: MonitorScreen = "waiting";
  private studentId: number | null = null;
  private mismatch = false;
  /** 直前に受け取った状態の通し番号．null の間は次の状態を差を見ずに受け取る（hello の後） */
  private lastSeq: number | null = null;
  private readonly buffer: ReceivedMonitorState[] = [];
  /** 体験中に最後に何か（drill に入った・状態が届いた）があった時刻（ms）．途切れの判定に使う */
  private lastLiveActivityAt = 0;
  /** 終わりにした時の描く時刻（ms）．終わりの間はこの時刻の姿勢のまま止める */
  private endedRenderTime = 0;
  private lobbyView: MonitorLobbyNotice | null = null;
  private trackParts: TrackParts | null = null;
  private track: DrillTrack | null = null;
  /** つなぎ終えた記録の番号（同じ記録の送り直しを無視するため） */
  private completedTrackId: number | null = null;
  private readonly pose = createMonitorPose();
  private readonly out: MonitorFrame = {
    screen: "waiting",
    mismatch: false,
    stalled: false,
    pose: null,
    lobby: null,
    track: null,
  };

  /**
   * @param localFingerprint 見守り画面で開いた校舎の指紋（createPlanFingerprintFromHash の結果）
   * @param floorCount 校舎の階の数（届いた記録の階を確かめる）
   */
  constructor(
    private readonly localFingerprint: string,
    private readonly floorCount: number = DEFAULT_FLOOR_COUNT,
  ) {}

  /** 今の画面の状態 */
  get screen(): MonitorScreen {
    return this.screenState;
  }

  /** 映している生徒の ID（まだ hello が届いていなければ null） */
  get currentStudentId(): number | null {
    return this.studentId;
  }

  /** ためている状態の数（確認用） */
  get bufferedCount(): number {
    return this.buffer.length;
  }

  /**
   * 知らせを受け取る．映す生徒以外の知らせは捨てる．
   * 描く側に行ってほしいこと（ドアを戻す・開け閉めする）があれば返す
   */
  receiveNotice(notice: MonitorNotice, now: number): MonitorEffect | null {
    if (notice.type === "hello") return this.receiveHello(notice.studentId, notice.planFingerprint);
    if (notice.studentId !== this.studentId) return null;
    switch (notice.type) {
      case "door":
        if (this.mismatch) return null;
        return { kind: "door", cell: notice.cell, open: notice.open };
      case "lobby":
        // ロビーの板は準備中の間だけ使う（phase の lobby の後に届く）
        if (!this.mismatch && this.screenState === "preparing") this.lobbyView = notice;
        return null;
      case "track":
        if (!this.mismatch) this.receiveTrack(notice);
        return null;
      case "phase":
        break;
    }
    switch (notice.phase) {
      case "lobby":
        this.screenState = "preparing";
        this.buffer.length = 0;
        this.lobbyView = null;
        this.clearTrack();
        return null;
      case "drill":
        // 体験中のまま drill が来るのは，生徒の端末が中継につなぎ直した時（hello・phase を送り直す）．
        // 同じ回の続きなので，ためた状態とドアを残す
        if (this.screenState === "live") return null;
        return this.enterLive(now, true);
      case "goal":
      case "result":
        if (this.screenState !== "ended") {
          this.endedRenderTime = now - MONITOR_RENDER_DELAY_MS;
          this.screenState = "ended";
        }
        return null;
    }
  }

  /**
   * 状態を受け取る（readMonitorState で読めたもの）．映す生徒以外・通し番号が古いもの・終わりの間に届いたものは捨てる．
   * 準備中はロビーの目線としてためる．接続待ちに届いたら体験中にする（phase を取りこぼしても映すため）
   */
  receiveState(state: MonitorState, now: number): MonitorEffect | null {
    if (this.studentId === null || state.studentId !== this.studentId) return null;
    if (this.lastSeq !== null && !isNewerMonitorSeq(state.seq, this.lastSeq)) return null;
    this.lastSeq = state.seq;
    if (this.mismatch || this.screenState === "ended") return null;

    let effect: MonitorEffect | null = null;
    // 準備中（ロビー）にも状態が届くため，体験中に移すのは接続待ちの時だけにする
    if (this.screenState === "waiting") effect = this.enterLive(now, false);
    this.buffer.push({ state, receivedAt: now });
    if (this.buffer.length > MONITOR_BUFFER_LIMIT) {
      this.buffer.splice(0, this.buffer.length - MONITOR_BUFFER_LIMIT);
    }
    if (this.screenState === "live") this.lastLiveActivityAt = now;
    return effect;
  }

  /** 今（now．ms）の描き方を求める．返す値は使い回すので，次の frame までに使い終える */
  frame(now: number): MonitorFrame {
    const out = this.out;
    const screen = this.screenState;
    out.screen = screen;
    out.mismatch = this.mismatch;
    out.stalled = screen === "live" && now - this.lastLiveActivityAt >= MONITOR_STALL_MS;
    out.pose = null;
    out.lobby = screen === "preparing" ? this.lobbyView : null;
    out.track = screen === "ended" ? this.track : null;
    if (screen !== "waiting") {
      const renderTime = screen === "ended" ? this.endedRenderTime : now - MONITOR_RENDER_DELAY_MS;
      if (screen !== "ended") {
        const stale = staleMonitorStateCount(this.buffer, renderTime);
        if (stale > 0) this.buffer.splice(0, stale);
      }
      if (sampleMonitorStates(this.buffer, renderTime, this.pose)) out.pose = this.pose;
    }
    return out;
  }

  private receiveHello(studentId: number, planFingerprint: string): MonitorEffect | null {
    const changed = studentId !== this.studentId;
    this.studentId = studentId;
    this.mismatch = planFingerprint !== this.localFingerprint;
    // hello の後の最初の状態は差を見ずに受け取る（生徒の端末が読み込み直すと通し番号が 0 から始まるため）
    this.lastSeq = null;
    if (!changed) return null;
    // 別の人に切り替わった．前の人の画面・ドア・板・記録を残さない（続く phase で画面が決まる）
    this.screenState = "waiting";
    this.buffer.length = 0;
    this.lobbyView = null;
    this.clearTrack();
    return RESET_DOORS;
  }

  /** 記録の部分を集め，そろったらつなぐ．同じ番号の送り直しは無視し，別の番号が来たら集め直す */
  private receiveTrack(notice: MonitorTrackNotice): void {
    if (notice.trackId === this.completedTrackId) return;
    let collecting = this.trackParts;
    if (
      collecting === null ||
      collecting.trackId !== notice.trackId ||
      collecting.parts.length !== notice.parts
    ) {
      collecting = { trackId: notice.trackId, parts: new Array<string | undefined>(notice.parts) };
      this.trackParts = collecting;
    }
    collecting.parts[notice.part] = notice.data;
    for (let i = 0; i < collecting.parts.length; i++) {
      if (collecting.parts[i] === undefined) return;
    }
    const track = joinMonitorTrack(collecting.parts, this.floorCount);
    this.trackParts = null;
    if (track === null) return;
    this.track = track;
    this.completedTrackId = notice.trackId;
  }

  private clearTrack(): void {
    this.trackParts = null;
    this.track = null;
    this.completedTrackId = null;
  }

  /**
   * 体験中に入る．ためた状態と記録を捨て，ドアを最初の状態に戻す．
   * resetSeq が true（phase の drill で入った）なら，次の状態は通し番号の差を見ずに受け取る
   */
  private enterLive(now: number, resetSeq: boolean): MonitorEffect {
    this.screenState = "live";
    this.buffer.length = 0;
    this.lobbyView = null;
    this.clearTrack();
    this.lastLiveActivityAt = now;
    if (resetSeq) this.lastSeq = null;
    return RESET_DOORS;
  }
}
