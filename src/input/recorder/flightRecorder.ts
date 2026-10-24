// フライトレコーダーの殻．記録をバッファにため，2 秒ごとに開発サーバーへ JSONL で送る（experiment_山﨑/10）．
// 開発時だけ読み込む（dev ページ，または import.meta.env.DEV の時の動的 import から使う．src/main.ts から静的に import しない）
import {
  classifySendStatus,
  createSessionId,
  INPUT_LOG_ENDPOINT,
  isValidSessionId,
  type SendOutcome,
} from "./logProtocol";
import {
  DEFAULT_RECORD_BUFFER_OPTIONS,
  RecordBuffer,
  type RecordBufferOptions,
  type RecordBufferStats,
} from "./recordBuffer";
import { type InputRecord, RECORD_FORMAT_VERSION, toRecordLine } from "./records";

export interface FlightRecorderOptions {
  /** どの dev ページで記録したか（meta に書く） */
  readonly page: string;
  readonly endpoint?: string;
  /** 送信の間隔（ms） */
  readonly intervalMs?: number;
  readonly buffer?: RecordBufferOptions;
  /** meta に足す情報（センサーの許可の結果等） */
  readonly extra?: Readonly<Record<string, unknown>>;
}

export interface FlightRecorderStatus extends RecordBufferStats {
  readonly sessionId: string;
  /** 最後の送信の結果（まだ送っていなければ null） */
  readonly lastOutcome: SendOutcome | null;
  /** 最後の送信の HTTP の状態（通信の失敗は null） */
  readonly lastStatus: number | null;
  /** 最後に成功した時刻（performance.now() の ms） */
  readonly lastOkAt: number | null;
  /** 受け取られずに送信済みとした行の数（ダウンロードには残る） */
  readonly rejected: number;
  readonly sending: boolean;
}

/** keepalive の fetch の本文の上限（ブラウザの制限は 64 KiB） */
const KEEPALIVE_MAX_BYTES = 60 * 1024;

export class FlightRecorder {
  readonly sessionId: string;
  private readonly endpoint: string;
  private readonly intervalMs: number;
  private readonly buffer: RecordBuffer;
  private timer: ReturnType<typeof setInterval> | null = null;
  private sending = false;
  /** 送信中の分の終わりの通し番号（送信中でなければ null） */
  private inFlightEndSeq: number | null = null;
  /** 送信中に flushOnExit が成功した分の終わり．送信中の分が成功したら続けて送信済みにする */
  private deferredAckSeq: number | null = null;
  /** flushOnExit で送っている分の終わり（visibilitychange と pagehide が続けて来た時に同じ行を送らないため） */
  private exitEndSeq = 0;
  private lastOutcome: SendOutcome | null = null;
  private lastStatus: number | null = null;
  private lastOkAt: number | null = null;
  private rejected = 0;
  private readonly listeners = new Set<(status: FlightRecorderStatus) => void>();
  private readonly onPageHide = () => {
    void this.flushOnExit();
  };

  constructor(options: FlightRecorderOptions) {
    this.sessionId = createSessionId();
    this.endpoint = options.endpoint ?? INPUT_LOG_ENDPOINT;
    this.intervalMs = options.intervalMs ?? 2000;
    this.buffer = new RecordBuffer(options.buffer ?? DEFAULT_RECORD_BUFFER_OPTIONS);
    this.record({
      type: "meta",
      t: performance.now(),
      version: RECORD_FORMAT_VERSION,
      sessionId: this.sessionId,
      page: options.page,
      startedAt: new Date().toISOString(),
      timeOrigin: performance.timeOrigin,
      userAgent: navigator.userAgent,
      screen: {
        width: screen.width,
        height: screen.height,
        dpr: window.devicePixelRatio,
      },
      extra: options.extra,
    });
  }

  /** 1 レコードを記録する（バッファに入れるだけ．送信は定期的に行う） */
  record(record: InputRecord): void {
    const line = toRecordLine(record);
    if (line !== null) this.buffer.push(line);
  }

  /** 定期的な送信を始める．ページを閉じる時にも残りを送る */
  start(): void {
    if (this.timer !== null) return;
    this.timer = setInterval(() => void this.flush(), this.intervalMs);
    window.addEventListener("pagehide", this.onPageHide);
  }

  stop(): void {
    if (this.timer !== null) clearInterval(this.timer);
    this.timer = null;
    window.removeEventListener("pagehide", this.onPageHide);
  }

  /** たまっている行を送る．送信中なら何もしない（定期的な送信は同時に 1 つだけ） */
  async flush(): Promise<void> {
    if (this.sending || !isValidSessionId(this.sessionId)) return;
    this.sending = true;
    try {
      // たまっている分が 1 回の上限を超える時は続けて送る（失敗したらそこで止め，次回に回す）
      for (;;) {
        const batch = this.buffer.takeBatch();
        if (batch === null) break;
        this.inFlightEndSeq = batch.endSeq;
        const status = await this.post(batch.body, false);
        const outcome = classifySendStatus(status);
        this.lastOutcome = outcome;
        this.lastStatus = status;
        if (outcome === "retry") {
          // 続きを flushOnExit が送れていても，抜けた分ごと次回送り直す（重複は許し，欠けは作らない）
          this.deferredAckSeq = null;
          break;
        }
        if (outcome === "reject") this.rejected += batch.lineCount;
        else this.lastOkAt = performance.now();
        this.buffer.markSent(batch.endSeq);
        if (this.deferredAckSeq !== null) {
          this.buffer.markSent(this.deferredAckSeq);
          this.deferredAckSeq = null;
        }
      }
    } finally {
      this.sending = false;
      this.inFlightEndSeq = null;
      this.notify();
    }
  }

  /**
   * ページを離れる時（pagehide・裏に回る時）に残りを送る．
   * keepalive の fetch でページが消えた後も送られるようにする．定期的な送信の途中でも，
   * その続きから送る（送信中だからと飛ばすと，最後の 2 秒分が欠ける）．
   * keepalive の本文の上限（64 KiB）のため，送れるのは 60 KiB まで（2 秒分は約 30 KiB）
   */
  async flushOnExit(): Promise<void> {
    if (!isValidSessionId(this.sessionId)) return;
    const wasSending = this.sending;
    const fromSeq = Math.max(this.inFlightEndSeq ?? 0, this.exitEndSeq);
    const batch = this.buffer.takeBatch(fromSeq, KEEPALIVE_MAX_BYTES);
    if (batch === null) return;
    this.exitEndSeq = batch.endSeq;
    // 定期的な送信が動いていなければ，終わるまで止めておく（同じ行を 2 回送らないため）
    if (!wasSending) this.sending = true;
    let status: number | null;
    try {
      status = await this.post(batch.body, true);
    } finally {
      if (!wasSending) this.sending = false;
    }
    if (classifySendStatus(status) === "retry") {
      // 送れなかった分は，次の flushOnExit・定期的な送信でもう一度送る
      this.exitEndSeq = 0;
      return;
    }
    if (!wasSending) this.buffer.markSent(batch.endSeq);
    // 送信中の分がまだ終わっていなければ，成功した時に続けて送信済みにする
    else if (this.sending) this.deferredAckSeq = batch.endSeq;
    // 送信中の分が先に終わっていた．成功していれば続きなので送信済みにし，失敗していれば送り直す
    else if (this.lastOutcome !== "retry") this.buffer.markSent(batch.endSeq);
    this.notify();
  }

  private async post(body: string, keepalive: boolean): Promise<number | null> {
    try {
      const url = `${this.endpoint}?session=${encodeURIComponent(this.sessionId)}`;
      const res = await fetch(url, {
        method: "POST",
        // text/plain にして CORS のプリフライトを起こさない（同じオリジンだが念のため）
        headers: { "Content-Type": "text/plain;charset=UTF-8" },
        body,
        keepalive,
      });
      return res.status;
    } catch {
      return null;
    }
  }

  /** 残している記録の全体（JSONL）．送信済みの分も上限までは含む */
  toJsonl(): string {
    return this.buffer.toJsonl();
  }

  status(): FlightRecorderStatus {
    return {
      ...this.buffer.stats(),
      sessionId: this.sessionId,
      lastOutcome: this.lastOutcome,
      lastStatus: this.lastStatus,
      lastOkAt: this.lastOkAt,
      rejected: this.rejected,
      sending: this.sending,
    };
  }

  /** 送信のたびに状態を受け取る．戻り値の関数でやめる */
  onStatus(listener: (status: FlightRecorderStatus) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private notify(): void {
    const s = this.status();
    for (const l of this.listeners) l(s);
  }
}
