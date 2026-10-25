// stringifyMonitorNotice・parseMonitorNotice の最小限のテスト．
// 基準は docs/04_SPEC/SPEC_01「見守り」の段階 1「知らせ」
import { describe, expect, it } from "vitest";
import { type MonitorNotice, parseMonitorNotice, stringifyMonitorNotice } from "./monitorNotice";

describe("stringifyMonitorNotice・parseMonitorNotice", () => {
  it.each<MonitorNotice>([
    { type: "hello", studentId: 3141592653, v: 1, planFingerprint: "Xq3v9_aB0cD", mode: "learn" },
    { type: "phase", studentId: 1, phase: "drill" },
    { type: "door", studentId: 4294967295, cell: { floor: 0, x: 4, z: 7 }, open: true },
  ])("$type は JSON にして戻すと元に戻る", (notice) => {
    expect(parseMonitorNotice(stringifyMonitorNotice(notice))).toEqual(notice);
  });

  it("知らない項目は無視する", () => {
    const text = '{"type":"phase","studentId":1,"phase":"goal","name":"たろう"}';
    expect(parseMonitorNotice(text)).toEqual({ type: "phase", studentId: 1, phase: "goal" });
  });

  it.each([
    "{",
    '{"type":"track","studentId":1}',
    '{"type":"phase","studentId":0,"phase":"drill"}',
    '{"type":"phase","studentId":1,"phase":"other"}',
    '{"type":"hello","studentId":1,"v":2,"planFingerprint":"demo","mode":"learn"}',
    '{"type":"door","studentId":1,"cell":{"floor":0,"x":1},"open":true}',
  ])("%s は捨てる", (text) => {
    expect(parseMonitorNotice(text)).toBeNull();
  });
});

// ---- 以下は tester が足した境界値・エラーパス（仕様: SPEC_01「見守り」段階 1「知らせ」） ----

import { MONITOR_NOTICE_VERSION } from "./monitorNotice";

describe("仕様の例の JSON", () => {
  it("hello・phase・door の例を読める", () => {
    expect(
      parseMonitorNotice(
        '{ "type": "hello", "studentId": 3141592653, "v": 1, "planFingerprint": "Xq3v9_aB0cD", "mode": "learn" }',
      ),
    ).toEqual({
      type: "hello",
      studentId: 3141592653,
      v: 1,
      planFingerprint: "Xq3v9_aB0cD",
      mode: "learn",
    });
    expect(
      parseMonitorNotice('{ "type": "phase", "studentId": 3141592653, "phase": "drill" }'),
    ).toEqual({ type: "phase", studentId: 3141592653, phase: "drill" });
    expect(
      parseMonitorNotice(
        '{ "type": "door", "studentId": 3141592653, "cell": { "floor": 0, "x": 4, "z": 7 }, "open": true }',
      ),
    ).toEqual({
      type: "door",
      studentId: 3141592653,
      cell: { floor: 0, x: 4, z: 7 },
      open: true,
    });
  });

  it("形の版は 1", () => {
    expect(MONITOR_NOTICE_VERSION).toBe(1);
  });
});

describe("stringifyMonitorNotice", () => {
  it("JSON のテキストで，type・studentId と仕様の項目だけを持つ", () => {
    const hello = JSON.parse(
      stringifyMonitorNotice({
        type: "hello",
        studentId: 5,
        v: 1,
        planFingerprint: "demo",
        mode: "test",
      }),
    );
    expect(Object.keys(hello).sort()).toEqual(
      ["mode", "planFingerprint", "studentId", "type", "v"].sort(),
    );
    const door = JSON.parse(
      stringifyMonitorNotice({
        type: "door",
        studentId: 5,
        cell: { floor: 1, x: 2, z: 3 },
        open: false,
      }),
    );
    expect(door).toEqual({
      type: "door",
      studentId: 5,
      cell: { floor: 1, x: 2, z: 3 },
      open: false,
    });
  });

  it("型に無い項目が混ざっていても送らない（段階 1 の hello に name は入れない）", () => {
    const notice = {
      type: "hello",
      studentId: 5,
      v: 1,
      planFingerprint: "demo",
      mode: "learn",
      name: "たろう",
      secret: 1,
    } as unknown as MonitorNotice;
    const json = JSON.parse(stringifyMonitorNotice(notice));
    expect(json).not.toHaveProperty("name");
    expect(json).not.toHaveProperty("secret");
    const door = {
      type: "door",
      studentId: 5,
      cell: { floor: 0, x: 1, z: 2, extra: true },
      open: true,
      extra: 1,
    } as unknown as MonitorNotice;
    expect(JSON.parse(stringifyMonitorNotice(door))).toEqual({
      type: "door",
      studentId: 5,
      cell: { floor: 0, x: 1, z: 2 },
      open: true,
    });
  });

  it.each<MonitorNotice>([
    { type: "hello", studentId: 1, v: 1, planFingerprint: "demo", mode: "test" },
    { type: "phase", studentId: 2, phase: "lobby" },
    { type: "phase", studentId: 2, phase: "drill" },
    { type: "phase", studentId: 2, phase: "goal" },
    { type: "phase", studentId: 2, phase: "result" },
    { type: "door", studentId: 3, cell: { floor: 2, x: 0, z: 0 }, open: false },
  ])("%j は往復で元に戻る", (notice) => {
    expect(parseMonitorNotice(stringifyMonitorNotice(notice))).toEqual(notice);
  });
});

describe("parseMonitorNotice: 知らない項目は無視する（段階 2 で足しても壊れない）", () => {
  it("hello に段階 2 の name があっても読め，name は落とす", () => {
    expect(
      parseMonitorNotice(
        '{"type":"hello","studentId":1,"v":1,"planFingerprint":"demo","mode":"learn","name":"はなこ"}',
      ),
    ).toEqual({ type: "hello", studentId: 1, v: 1, planFingerprint: "demo", mode: "learn" });
  });

  it("door の cell の知らない項目も落とす", () => {
    expect(
      parseMonitorNotice(
        '{"type":"door","studentId":1,"cell":{"floor":0,"x":1,"z":2,"room":3},"open":false,"t":5}',
      ),
    ).toEqual({ type: "door", studentId: 1, cell: { floor: 0, x: 1, z: 2 }, open: false });
  });
});

describe("parseMonitorNotice: 捨てるもの（null を返し例外を投げない）", () => {
  it.each([
    ["空の文字列", ""],
    ["壊れた JSON", '{"type":"phase"'],
    ["null", "null"],
    ["配列", '[{"type":"phase","studentId":1,"phase":"drill"}]'],
    ["数", "1"],
    ["文字列", '"phase"'],
    ["true", "true"],
    ["type が無い", '{"studentId":1,"phase":"drill"}'],
    ["type が数", '{"type":1,"studentId":1,"phase":"drill"}'],
    // 仕様変更: track は段階 1 の知らせになった．項目（trackId・part・parts・data）が足りないので捨てる
    ["項目の足りない track（samples だけ）", '{"type":"track","studentId":1,"samples":[]}'],
    ["type の大文字違い", '{"type":"Phase","studentId":1,"phase":"drill"}'],
    ["studentId が無い", '{"type":"phase","phase":"drill"}'],
    ["studentId が文字", '{"type":"phase","studentId":"1","phase":"drill"}'],
    ["studentId が小数", '{"type":"phase","studentId":1.5,"phase":"drill"}'],
    ["studentId が負", '{"type":"phase","studentId":-1,"phase":"drill"}'],
    ["studentId が u32 を超える", '{"type":"phase","studentId":4294967296,"phase":"drill"}'],
    ["studentId が null", '{"type":"phase","studentId":null,"phase":"drill"}'],
    ["hello の v が無い", '{"type":"hello","studentId":1,"planFingerprint":"demo","mode":"learn"}'],
    [
      "hello の v が文字",
      '{"type":"hello","studentId":1,"v":"1","planFingerprint":"demo","mode":"learn"}',
    ],
    [
      "hello の v が 0",
      '{"type":"hello","studentId":1,"v":0,"planFingerprint":"demo","mode":"learn"}',
    ],
    ["hello の planFingerprint が無い", '{"type":"hello","studentId":1,"v":1,"mode":"learn"}'],
    [
      "hello の planFingerprint が数",
      '{"type":"hello","studentId":1,"v":1,"planFingerprint":1,"mode":"learn"}',
    ],
    [
      "hello の planFingerprint が null",
      '{"type":"hello","studentId":1,"v":1,"planFingerprint":null,"mode":"learn"}',
    ],
    ["hello の mode が無い", '{"type":"hello","studentId":1,"v":1,"planFingerprint":"demo"}'],
    [
      "hello の mode が知らない値",
      '{"type":"hello","studentId":1,"v":1,"planFingerprint":"demo","mode":"exam"}',
    ],
    ["phase が無い", '{"type":"phase","studentId":1}'],
    ["phase が数", '{"type":"phase","studentId":1,"phase":1}'],
    ["phase の大文字違い", '{"type":"phase","studentId":1,"phase":"DRILL"}'],
    ["door の cell が無い", '{"type":"door","studentId":1,"open":true}'],
    ["door の cell が null", '{"type":"door","studentId":1,"cell":null,"open":true}'],
    ["door の cell が配列", '{"type":"door","studentId":1,"cell":[0,1,2],"open":true}'],
    ["door の cell.floor が無い", '{"type":"door","studentId":1,"cell":{"x":1,"z":2},"open":true}'],
    [
      "door の cell.x が文字",
      '{"type":"door","studentId":1,"cell":{"floor":0,"x":"1","z":2},"open":true}',
    ],
    [
      "door の cell.z が負",
      '{"type":"door","studentId":1,"cell":{"floor":0,"x":1,"z":-1},"open":true}',
    ],
    [
      "door の cell.x が小数",
      '{"type":"door","studentId":1,"cell":{"floor":0,"x":1.5,"z":2},"open":true}',
    ],
    ["door の open が無い", '{"type":"door","studentId":1,"cell":{"floor":0,"x":1,"z":2}}'],
    [
      "door の open が文字",
      '{"type":"door","studentId":1,"cell":{"floor":0,"x":1,"z":2},"open":"true"}',
    ],
    ["door の open が数", '{"type":"door","studentId":1,"cell":{"floor":0,"x":1,"z":2},"open":1}'],
  ])("%s", (_, text) => {
    expect(() => parseMonitorNotice(text)).not.toThrow();
    expect(parseMonitorNotice(text)).toBeNull();
  });

  it("どんな文字列でも例外を投げない", () => {
    const samples = [
      "{}",
      "{{",
      "\u0000",
      "undefined",
      "NaN",
      '{"__proto__":{"type":"phase"}}',
      "x".repeat(5000),
    ];
    for (const text of samples) {
      expect(() => parseMonitorNotice(text)).not.toThrow();
      expect(parseMonitorNotice(text)).toBeNull();
    }
  });
});

// ---- lobby・track（SPEC_01「見守り」段階 1「知らせ」） ----

import { MONITOR_LOBBY_TEXT_MAX, MONITOR_TRACK_MAX_PARTS } from "./monitorNotice";

const LOBBY_NOTICE = {
  type: "lobby",
  studentId: 3141592653,
  title: "しゃがんでください",
  body: "その場でしゃがみ，しゃがんだまま止まってください",
  caption: "手順 3 / 5　残り 6 秒",
  startButton: false,
  alignMarker: false,
} as const;

const TRACK_NOTICE = {
  type: "track",
  studentId: 3141592653,
  trackId: 1,
  part: 0,
  parts: 3,
  data: "AQAAAA",
} as const;

/** 仕様の例をもとに一部を上書き・削除した JSON（値に undefined を渡すとその項目を消す） */
function lobbyJson(overrides: Record<string, unknown> = {}): string {
  return JSON.stringify({ ...LOBBY_NOTICE, ...overrides });
}
function trackJson(overrides: Record<string, unknown> = {}): string {
  return JSON.stringify({ ...TRACK_NOTICE, ...overrides });
}

describe("parseMonitorNotice: lobby", () => {
  it("仕様の例を読める", () => {
    expect(
      parseMonitorNotice(
        '{ "type": "lobby", "studentId": 3141592653, "title": "しゃがんでください", "body": "その場でしゃがみ，しゃがんだまま止まってください", "caption": "手順 3 / 5　残り 6 秒", "startButton": false, "alignMarker": false }',
      ),
    ).toEqual(LOBBY_NOTICE);
  });

  it.each<MonitorNotice>([
    LOBBY_NOTICE,
    { ...LOBBY_NOTICE, caption: "", startButton: true, alignMarker: true },
    { ...LOBBY_NOTICE, title: "", body: "", caption: "" },
  ])("往復で元に戻る（%j）", (notice) => {
    expect(parseMonitorNotice(stringifyMonitorNotice(notice))).toEqual(notice);
  });

  it("文は 1 つ 300 文字まで受け取る", () => {
    expect(MONITOR_LOBBY_TEXT_MAX).toBe(300);
    const max = "あ".repeat(300);
    expect(parseMonitorNotice(lobbyJson({ title: max, body: max, caption: max }))).toMatchObject({
      title: max,
      body: max,
      caption: max,
    });
  });

  it("3 つとも 300 文字（日本語）でも UTF-8 で中継の上限 4,096 バイトに収まる", () => {
    const max = "あ".repeat(300);
    const text = stringifyMonitorNotice({
      ...LOBBY_NOTICE,
      studentId: 4294967295,
      title: max,
      body: max,
      caption: max,
    });
    expect(new TextEncoder().encode(text).byteLength).toBeLessThan(4096);
  });

  it("知らない項目は落とす", () => {
    expect(parseMonitorNotice(lobbyJson({ ring: 0.5, hand: true }))).toEqual(LOBBY_NOTICE);
  });

  it("stringify は型に無い項目を送らない", () => {
    const notice = { ...LOBBY_NOTICE, ring: 0.5 } as unknown as MonitorNotice;
    expect(Object.keys(JSON.parse(stringifyMonitorNotice(notice))).sort()).toEqual(
      ["alignMarker", "body", "caption", "startButton", "studentId", "title", "type"].sort(),
    );
  });

  it.each<[string, Record<string, unknown>]>([
    ["title が無い", { title: undefined }],
    ["body が無い", { body: undefined }],
    ["caption が無い", { caption: undefined }],
    ["startButton が無い", { startButton: undefined }],
    ["alignMarker が無い", { alignMarker: undefined }],
    ["title が数", { title: 1 }],
    ["body が null", { body: null }],
    ["caption が配列", { caption: ["a"] }],
    ["startButton が文字", { startButton: "true" }],
    ["startButton が数", { startButton: 1 }],
    ["alignMarker が null", { alignMarker: null }],
    ["title が 301 文字", { title: "あ".repeat(301) }],
    ["body が 301 文字", { body: "a".repeat(301) }],
    ["caption が 301 文字", { caption: "a".repeat(301) }],
    ["studentId が 0", { studentId: 0 }],
  ])("%s なら捨てる", (_, overrides) => {
    expect(parseMonitorNotice(lobbyJson(overrides))).toBeNull();
  });
});

describe("parseMonitorNotice: track", () => {
  it("仕様の例を読める", () => {
    expect(
      parseMonitorNotice(
        '{ "type": "track", "studentId": 3141592653, "trackId": 1, "part": 0, "parts": 3, "data": "AQAAAA" }',
      ),
    ).toEqual(TRACK_NOTICE);
  });

  it.each<MonitorNotice>([
    TRACK_NOTICE,
    { ...TRACK_NOTICE, trackId: 0, part: 0, parts: 1, data: "" },
    { ...TRACK_NOTICE, part: 31, parts: 32, data: "-_Az09" },
  ])("往復で元に戻る（%j）", (notice) => {
    expect(parseMonitorNotice(stringifyMonitorNotice(notice))).toEqual(notice);
  });

  it("部分の数は 1〜32", () => {
    expect(MONITOR_TRACK_MAX_PARTS).toBe(32);
    expect(parseMonitorNotice(trackJson({ part: 0, parts: 1 }))).not.toBeNull();
    expect(parseMonitorNotice(trackJson({ part: 31, parts: 32 }))).not.toBeNull();
  });

  it("知らない項目は落とす", () => {
    expect(parseMonitorNotice(trackJson({ checksum: 1 }))).toEqual(TRACK_NOTICE);
  });

  it.each<[string, Record<string, unknown>]>([
    ["trackId が無い", { trackId: undefined }],
    ["part が無い", { part: undefined }],
    ["parts が無い", { parts: undefined }],
    ["data が無い", { data: undefined }],
    ["trackId が文字", { trackId: "1" }],
    ["trackId が負", { trackId: -1 }],
    ["trackId が小数", { trackId: 1.5 }],
    ["part が負", { part: -1 }],
    ["part が小数", { part: 0.5 }],
    ["parts が小数", { parts: 2.5 }],
    ["part が parts と同じ", { part: 3, parts: 3 }],
    ["part が parts より大きい", { part: 4, parts: 3 }],
    ["parts が 0", { part: 0, parts: 0 }],
    ["parts が 33", { part: 0, parts: 33 }],
    ["parts が負", { part: 0, parts: -1 }],
    ["data が数", { data: 1 }],
    ["data が null", { data: null }],
    ["data に = がある", { data: "AQAAAA==" }],
    ["data に + がある", { data: "AQ+A" }],
    ["data に / がある", { data: "AQ/A" }],
    ["data に空白がある", { data: "AQ AA" }],
    ["data に日本語がある", { data: "あ" }],
  ])("%s なら捨てる", (_, overrides) => {
    expect(() => parseMonitorNotice(trackJson(overrides))).not.toThrow();
    expect(parseMonitorNotice(trackJson(overrides))).toBeNull();
  });
});
