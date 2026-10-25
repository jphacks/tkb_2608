// 見守り画面と中継の WebSocket（受け取るだけ）．切れた・つながらない時は数秒おきに自動でつなぎ直す（SPEC_01「見守り」の「切れた時」）．
// 受け取ったものの解釈はしない（テキストとバイナリをそのまま渡す）
import type { RelayStatus } from "./monitorDisplay";

/** つなぎ直すまでの間（ms） */
export const RELAY_RETRY_MS = 3000;

/** 受け取った時に呼ぶもの */
export interface RelayConnectionHandlers {
  /** テキストのフレーム（知らせ） */
  readonly onText: (text: string) => void;
  /** バイナリのフレーム（状態） */
  readonly onBinary: (data: ArrayBuffer) => void;
  /** 接続の様子が変わった時 */
  readonly onStatus: (status: RelayStatus) => void;
}

/** 中継とのつながり．dispose まで，切れるたびにつなぎ直す */
export class RelayConnection {
  private socket: WebSocket | null = null;
  private retryTimer: ReturnType<typeof setTimeout> | null = null;
  private disposed = false;
  private statusValue: RelayStatus = "connecting";

  constructor(
    private readonly url: string,
    private readonly handlers: RelayConnectionHandlers,
  ) {
    this.connect();
  }

  /** 今の接続の様子 */
  get status(): RelayStatus {
    return this.statusValue;
  }

  /** つなぎ直しをやめて接続を閉じる */
  dispose(): void {
    this.disposed = true;
    if (this.retryTimer !== null) clearTimeout(this.retryTimer);
    this.retryTimer = null;
    const socket = this.socket;
    this.socket = null;
    socket?.close();
  }

  private setStatus(status: RelayStatus): void {
    if (status === this.statusValue) return;
    this.statusValue = status;
    this.handlers.onStatus(status);
  }

  private connect(): void {
    if (this.disposed) return;
    let socket: WebSocket;
    try {
      socket = new WebSocket(this.url);
    } catch {
      // URL の形が WebSocket に受け付けられない等．開き直さずにつなぎ直しを続ける
      this.scheduleRetry();
      return;
    }
    socket.binaryType = "arraybuffer";
    this.socket = socket;
    socket.addEventListener("open", () => {
      if (this.socket === socket) this.setStatus("open");
    });
    socket.addEventListener("message", (event: MessageEvent<unknown>) => {
      if (this.socket !== socket) return;
      const { data } = event;
      if (typeof data === "string") this.handlers.onText(data);
      else if (data instanceof ArrayBuffer) this.handlers.onBinary(data);
    });
    // error の後には必ず close が来るので，つなぎ直しは close でだけ行う
    socket.addEventListener("close", () => {
      if (this.socket !== socket) return;
      this.socket = null;
      this.scheduleRetry();
    });
  }

  private scheduleRetry(): void {
    if (this.disposed) return;
    this.setStatus("retrying");
    if (this.retryTimer !== null) return;
    this.retryTimer = setTimeout(() => {
      this.retryTimer = null;
      this.connect();
    }, RELAY_RETRY_MS);
  }
}
