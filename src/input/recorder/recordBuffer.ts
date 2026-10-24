// フライトレコーダーのメモリ上のバッファ（DOM・通信に依存しない）．
// 記録した行をセッションの間ためておき，送信済みの位置（通し番号）だけを進める．
// - 送信に失敗しても行は残り，次の送信で同じ位置からもう一度送る
// - 送信済みの行も上限までは残し，dev ページからセッション全体を .jsonl でダウンロードできるようにする
// - 上限（バイト数）を超えたら古い行から捨てる．まだ送っていない行を捨てた数も数える

/** 文字列を UTF-8 にした時のバイト数 */
export function utf8ByteLength(s: string): number {
  let bytes = 0;
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    if (c < 0x80) bytes += 1;
    else if (c < 0x800) bytes += 2;
    else if (c >= 0xd800 && c <= 0xdbff && i + 1 < s.length) {
      // サロゲートペアは 2 文字で 4 バイト
      const next = s.charCodeAt(i + 1);
      if (next >= 0xdc00 && next <= 0xdfff) {
        bytes += 4;
        i++;
      } else bytes += 3;
    } else bytes += 3;
  }
  return bytes;
}

export interface RecordBufferOptions {
  /** 残しておく行の合計の上限（バイト．改行を含む） */
  readonly maxRetainedBytes: number;
  /** 1 回の送信の本文の上限（バイト）．1 行がこれを超える時でもその 1 行は送る */
  readonly maxBatchBytes: number;
}

/**
 * 既定の上限．1 分で約 1〜2 MB（experiment_山﨑/10）のため，16 MB で 8 分以上を残せる．
 * 1 回の送信は開発サーバーの本文の上限（logProtocol の MAX_REQUEST_BYTES）より小さくする
 */
export const DEFAULT_RECORD_BUFFER_OPTIONS: RecordBufferOptions = {
  maxRetainedBytes: 16 * 1024 * 1024,
  maxBatchBytes: 512 * 1024,
};

/** 送信する 1 回分 */
export interface RecordBatch {
  /** JSONL の本文（各行の末尾に改行） */
  readonly body: string;
  readonly lineCount: number;
  /** この送信が成功したら markSent に渡す通し番号（最後の行の次） */
  readonly endSeq: number;
}

export interface RecordBufferStats {
  /** これまでに入れた行の数 */
  readonly total: number;
  /** 送信済みとした行の数（失敗したまま捨てた行は含まない） */
  readonly sent: number;
  /** まだ送っていない行の数 */
  readonly pending: number;
  /** 上限を超えて捨てた行の数（送信済みも含む） */
  readonly dropped: number;
  /** 捨てた行のうち，送っていなかった行の数（開発サーバーにもダウンロードにも残らない） */
  readonly droppedUnsent: number;
  /** 今残している行の数とバイト数 */
  readonly retained: number;
  readonly retainedBytes: number;
}

export class RecordBuffer {
  private readonly options: RecordBufferOptions;
  /** 残している行．lines[i] の通し番号は firstSeq + (i - head) */
  private lines: string[] = [];
  private sizes: number[] = [];
  /** lines の先頭の捨てた分（配列の先頭を毎回消すと O(n) になるため，まとめて詰める） */
  private head = 0;
  private firstSeq = 0;
  private nextSeq = 0;
  /** ここより前の通し番号は送信済み（または捨てた） */
  private sentSeq = 0;
  private sentCount = 0;
  private retainedBytes = 0;
  private droppedCount = 0;
  private droppedUnsentCount = 0;

  constructor(options: RecordBufferOptions = DEFAULT_RECORD_BUFFER_OPTIONS) {
    this.options = options;
  }

  /** 1 行を足す（line は改行を含まない JSON）．上限を超えたら古い行から捨てる */
  push(line: string): void {
    const size = utf8ByteLength(line) + 1;
    this.lines.push(line);
    this.sizes.push(size);
    this.nextSeq++;
    this.retainedBytes += size;
    // 最後の 1 行は上限を超えていても残す（空にしない）
    while (this.retainedBytes > this.options.maxRetainedBytes && this.retainedCount() > 1) {
      this.dropOldest();
    }
  }

  private retainedCount(): number {
    return this.lines.length - this.head;
  }

  private dropOldest(): void {
    this.retainedBytes -= this.sizes[this.head];
    this.droppedCount++;
    if (this.firstSeq >= this.sentSeq) {
      this.droppedUnsentCount++;
      this.sentSeq = this.firstSeq + 1;
    }
    this.head++;
    this.firstSeq++;
    // 捨てた分が半分を超えたら配列を詰める（償却で O(1)）
    if (this.head > 1024 && this.head * 2 > this.lines.length) {
      this.lines = this.lines.slice(this.head);
      this.sizes = this.sizes.slice(this.head);
      this.head = 0;
    }
  }

  /**
   * まだ送っていない行から 1 回分を取り出す（取り出すだけで，送信済みにはしない）．無ければ null．
   * fromSeq: 送信中の分の続きから取る時の開始の通し番号（既定は送信済みの位置）
   * maxBytes: この回だけの本文の上限（既定は maxBatchBytes）
   */
  takeBatch(fromSeq?: number, maxBytes: number = this.options.maxBatchBytes): RecordBatch | null {
    const startSeq = Math.max(this.sentSeq, this.firstSeq, fromSeq ?? 0);
    if (startSeq >= this.nextSeq) return null;
    const startIndex = this.head + (startSeq - this.firstSeq);
    let endIndex = startIndex;
    let bytes = 0;
    while (endIndex < this.lines.length) {
      const size = this.sizes[endIndex];
      if (endIndex > startIndex && bytes + size > maxBytes) break;
      bytes += size;
      endIndex++;
    }
    const batchLines = this.lines.slice(startIndex, endIndex);
    return {
      body: `${batchLines.join("\n")}\n`,
      lineCount: batchLines.length,
      endSeq: startSeq + batchLines.length,
    };
  }

  /** takeBatch の送信が成功した（または送らないと決めた）．endSeq までを送信済みにする */
  markSent(endSeq: number): void {
    const end = Math.min(endSeq, this.nextSeq);
    if (end <= this.sentSeq) return;
    // 捨てた行の分は送信済みに数えない
    this.sentCount += end - Math.max(this.sentSeq, this.firstSeq);
    this.sentSeq = end;
  }

  /** 残している行をすべて JSONL にする（ダウンロード用） */
  toJsonl(): string {
    if (this.retainedCount() === 0) return "";
    return `${this.lines.slice(this.head).join("\n")}\n`;
  }

  stats(): RecordBufferStats {
    return {
      total: this.nextSeq,
      sent: this.sentCount,
      pending: this.nextSeq - Math.max(this.sentSeq, this.firstSeq),
      dropped: this.droppedCount,
      droppedUnsent: this.droppedUnsentCount,
      retained: this.retainedCount(),
      retainedBytes: this.retainedBytes,
    };
  }
}
