import { describe, expect, it } from "vitest";
import { MAX_REQUEST_BYTES } from "./logProtocol";
import { DEFAULT_RECORD_BUFFER_OPTIONS, RecordBuffer, utf8ByteLength } from "./recordBuffer";

const encoder = new TextEncoder();

/** n 番目の行（改行を除いて 9 バイト．改行込みで 10 バイト） */
function line(n: number): string {
  return `{"n":${String(n).padStart(3, "0")}}`;
}

describe("utf8ByteLength", () => {
  it.each([
    ["", 0],
    ["abc", 3],
    ["é", 2],
    ["日本語", 9],
    ["😀", 4],
    ["a😀b", 6],
  ])("%s は %s バイト", (s, n) => {
    expect(utf8ByteLength(s)).toBe(n);
  });

  it.each([
    '{"label":"しゃがみ歩き","note":"手が震えた😀"}',
    "ÿࠀ￿",
    "\ud800", // 単独の上位サロゲート（TextEncoder は U+FFFD の 3 バイトにする）
    "\udc00x",
    "\ud800𐀀",
  ])("TextEncoder と同じバイト数（%s）", (s) => {
    expect(utf8ByteLength(s)).toBe(encoder.encode(s).length);
  });
});

describe("DEFAULT_RECORD_BUFFER_OPTIONS", () => {
  it("残す上限は 16 MB，1 回の送信は開発サーバーの本文の上限より小さい", () => {
    expect(DEFAULT_RECORD_BUFFER_OPTIONS.maxRetainedBytes).toBe(16 * 1024 * 1024);
    expect(DEFAULT_RECORD_BUFFER_OPTIONS.maxBatchBytes).toBeLessThan(MAX_REQUEST_BYTES);
  });
});

describe("RecordBuffer", () => {
  it("空なら takeBatch は null，toJsonl は空文字列", () => {
    const b = new RecordBuffer();
    expect(b.takeBatch()).toBeNull();
    expect(b.toJsonl()).toBe("");
    expect(b.stats()).toEqual({
      total: 0,
      sent: 0,
      pending: 0,
      dropped: 0,
      droppedUnsent: 0,
      retained: 0,
      retainedBytes: 0,
    });
  });

  it("まだ送っていない行を JSONL で取り出す（取り出すだけでは送信済みにしない）", () => {
    const b = new RecordBuffer();
    b.push(line(0));
    b.push(line(1));
    const batch = b.takeBatch();
    expect(batch).toEqual({ body: `${line(0)}\n${line(1)}\n`, lineCount: 2, endSeq: 2 });
    expect(b.takeBatch()).toEqual(batch);
    expect(b.stats().pending).toBe(2);
  });

  it("markSent で送信済みの位置を進め，続きだけを取り出す", () => {
    const b = new RecordBuffer();
    b.push(line(0));
    b.push(line(1));
    b.markSent(b.takeBatch()?.endSeq ?? -1);
    expect(b.takeBatch()).toBeNull();
    b.push(line(2));
    expect(b.takeBatch()).toEqual({ body: `${line(2)}\n`, lineCount: 1, endSeq: 3 });
    expect(b.stats()).toMatchObject({ total: 3, sent: 2, pending: 1 });
  });

  it("送信に失敗した（markSent しない）時は次も同じ位置から取る", () => {
    const b = new RecordBuffer();
    b.push(line(0));
    const first = b.takeBatch();
    b.push(line(1));
    const second = b.takeBatch();
    expect(second?.body.startsWith(first?.body ?? "x")).toBe(true);
    expect(second?.lineCount).toBe(2);
  });

  it("markSent は先へ進むだけ．入れた数を超えた値は入れた数で止める", () => {
    const b = new RecordBuffer();
    b.push(line(0));
    b.push(line(1));
    b.markSent(1);
    b.markSent(0);
    expect(b.stats()).toMatchObject({ sent: 1, pending: 1 });
    b.markSent(100);
    expect(b.stats()).toMatchObject({ sent: 2, pending: 0 });
    b.push(line(2));
    expect(b.takeBatch()?.body).toBe(`${line(2)}\n`);
  });

  it("1 回分は maxBatchBytes に収まるように区切る", () => {
    const b = new RecordBuffer({ maxRetainedBytes: 10_000, maxBatchBytes: 25 });
    for (let i = 0; i < 5; i++) b.push(line(i));
    const first = b.takeBatch();
    expect(first).toEqual({ body: `${line(0)}\n${line(1)}\n`, lineCount: 2, endSeq: 2 });
    b.markSent(first?.endSeq ?? -1);
    expect(b.takeBatch()?.endSeq).toBe(4);
  });

  it("引数の maxBytes でその回だけの上限を変えられる", () => {
    const b = new RecordBuffer({ maxRetainedBytes: 10_000, maxBatchBytes: 1000 });
    for (let i = 0; i < 5; i++) b.push(line(i));
    expect(b.takeBatch(undefined, 30)?.lineCount).toBe(3);
  });

  it("1 行が上限を超えていても少なくとも 1 行は返す", () => {
    const b = new RecordBuffer({ maxRetainedBytes: 10_000, maxBatchBytes: 5 });
    b.push(line(0));
    b.push(line(1));
    expect(b.takeBatch()).toEqual({ body: `${line(0)}\n`, lineCount: 1, endSeq: 1 });
  });

  it("fromSeq を渡すとその通し番号から取る（送信中の分の続き）", () => {
    const b = new RecordBuffer();
    for (let i = 0; i < 4; i++) b.push(line(i));
    expect(b.takeBatch(2)).toEqual({ body: `${line(2)}\n${line(3)}\n`, lineCount: 2, endSeq: 4 });
    expect(b.takeBatch(4)).toBeNull();
    expect(b.takeBatch(10)).toBeNull();
  });

  it("fromSeq が送信済みの位置より前なら，送信済みの位置から取る", () => {
    const b = new RecordBuffer();
    for (let i = 0; i < 4; i++) b.push(line(i));
    b.markSent(3);
    expect(b.takeBatch(0)).toEqual({ body: `${line(3)}\n`, lineCount: 1, endSeq: 4 });
  });

  it("toJsonl は送信済みの行も含めて残している行をすべて返す", () => {
    const b = new RecordBuffer();
    b.push(line(0));
    b.push(line(1));
    b.markSent(1);
    expect(b.toJsonl()).toBe(`${line(0)}\n${line(1)}\n`);
  });

  it("retainedBytes は UTF-8 のバイト数＋改行で数える", () => {
    const b = new RecordBuffer();
    b.push('{"a":"日本"}');
    expect(b.stats().retainedBytes).toBe(utf8ByteLength('{"a":"日本"}') + 1);
  });

  describe("上限を超えた時", () => {
    // 1 行 10 バイトで 3 行まで残る
    const options = { maxRetainedBytes: 30, maxBatchBytes: 1000 };

    it("古い行から捨て，まだ送っていない行を捨てた数も数える", () => {
      const b = new RecordBuffer(options);
      for (let i = 0; i < 5; i++) b.push(line(i));
      expect(b.stats()).toEqual({
        total: 5,
        sent: 0,
        pending: 3,
        dropped: 2,
        droppedUnsent: 2,
        retained: 3,
        retainedBytes: 30,
      });
      expect(b.toJsonl()).toBe(`${line(2)}\n${line(3)}\n${line(4)}\n`);
      expect(b.takeBatch()).toEqual({
        body: `${line(2)}\n${line(3)}\n${line(4)}\n`,
        lineCount: 3,
        endSeq: 5,
      });
    });

    it("送信済みの行を捨てても droppedUnsent には数えない", () => {
      const b = new RecordBuffer(options);
      for (let i = 0; i < 3; i++) b.push(line(i));
      b.markSent(3);
      b.push(line(3));
      b.push(line(4));
      expect(b.stats()).toMatchObject({ dropped: 2, droppedUnsent: 0, sent: 3, pending: 2 });
    });

    it("捨てた行は送信済みに数えない", () => {
      const b = new RecordBuffer(options);
      for (let i = 0; i < 5; i++) b.push(line(i));
      // 捨てる前に取り出した分（0〜4）の送信が後で成功した
      b.markSent(5);
      expect(b.stats()).toMatchObject({ sent: 3, pending: 0, dropped: 2, droppedUnsent: 2 });
    });

    it("1 行だけで上限を超えても，その 1 行は残す", () => {
      const b = new RecordBuffer({ maxRetainedBytes: 5, maxBatchBytes: 1000 });
      b.push(line(0));
      expect(b.stats()).toMatchObject({ retained: 1, dropped: 0 });
      b.push(line(1));
      expect(b.stats()).toMatchObject({ retained: 1, dropped: 1, droppedUnsent: 1 });
      expect(b.toJsonl()).toBe(`${line(1)}\n`);
    });

    it("たくさん捨てても（配列を詰めた後も）通し番号と中身がずれない", () => {
      const b = new RecordBuffer({ maxRetainedBytes: 100, maxBatchBytes: 1000 });
      let sent = 0;
      for (let i = 0; i < 5000; i++) {
        b.push(`{"n":${i}}`);
        if (i % 7 === 0) {
          const batch = b.takeBatch();
          if (batch !== null) {
            b.markSent(batch.endSeq);
            sent += batch.lineCount;
          }
        }
      }
      const s = b.stats();
      expect(s.total).toBe(5000);
      expect(s.dropped + s.retained).toBe(5000);
      expect(s.sent).toBe(sent);
      expect(s.sent + s.droppedUnsent + s.pending).toBe(5000);
      const lines = b.toJsonl().trimEnd().split("\n");
      expect(lines).toHaveLength(s.retained);
      expect(JSON.parse(lines[lines.length - 1]).n).toBe(4999);
      expect(JSON.parse(lines[0]).n).toBe(5000 - s.retained);
      const batch = b.takeBatch();
      const pendingLines = batch?.body.trimEnd().split("\n") ?? [];
      expect(pendingLines).toHaveLength(s.pending);
      expect(JSON.parse(pendingLines[pendingLines.length - 1]).n).toBe(4999);
    });
  });
});
