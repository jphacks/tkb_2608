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

// ---- 音の知らせ（cue・speech・stopAudio）．仕様: SPEC_01「見守り」段階 1「知らせ」の表と「音」 ----

import {
  fitsMonitorNotice,
  isMonitorSpeechRate,
  isMonitorSpeechText,
  MONITOR_NOTICE_MAX_BYTES,
  readMonitorAudioCue,
} from "./monitorNotice";

/** 知らせの JSON のテキストを作る（既定は studentId: 1） */
const noticeText = (body: Record<string, unknown>): string =>
  JSON.stringify({ studentId: 1, ...body });

/** id を n 文字にした sound の cue */
const soundCue = (overrides: Record<string, unknown> = {}): Record<string, unknown> => ({
  type: "sound",
  id: "fire-bell",
  action: "play",
  ...overrides,
});

/** n 個の params（かぎ k0, k1, ...） */
const manyParams = (n: number): Record<string, string> =>
  Object.fromEntries(Array.from({ length: n }, (_, i) => [`k${i}`, "v"]));

describe("parseMonitorNotice: 音の知らせの仕様の例", () => {
  it("cue・speech・stopAudio の例を読める", () => {
    expect(
      parseMonitorNotice(
        '{ "type": "cue", "studentId": 3141592653, "cue": { "type": "narration", "id": "fire-announcement", "params": { "roomName": "3年1組" } } }',
      ),
    ).toEqual({
      type: "cue",
      studentId: 3141592653,
      cue: { type: "narration", id: "fire-announcement", params: { roomName: "3年1組" } },
    });
    expect(
      parseMonitorNotice(
        '{ "type": "speech", "studentId": 3141592653, "text": "体の正面を向いて，そのまま動かないでください", "rate": 1.05 }',
      ),
    ).toEqual({
      type: "speech",
      studentId: 3141592653,
      text: "体の正面を向いて，そのまま動かないでください",
      rate: 1.05,
    });
    expect(parseMonitorNotice('{ "type": "stopAudio", "studentId": 3141592653 }')).toEqual({
      type: "stopAudio",
      studentId: 3141592653,
    });
  });
});

describe("stringifyMonitorNotice・parseMonitorNotice: 音の知らせの往復", () => {
  it.each<MonitorNotice>([
    { type: "cue", studentId: 1, cue: { type: "narration", id: "evac-start" } },
    {
      type: "cue",
      studentId: 4294967295,
      cue: {
        type: "narration",
        id: "fire",
        params: { roomName: "3年1組", floor: 2, urgent: true },
      },
    },
    { type: "cue", studentId: 7, cue: { type: "sound", id: "bell", action: "play" } },
    {
      type: "cue",
      studentId: 7,
      cue: { type: "sound", id: "fire-crackle", action: "play", loop: true, anchorId: "fire-0" },
    },
    { type: "cue", studentId: 7, cue: { type: "sound", id: "bell", action: "stop", loop: false } },
    { type: "speech", studentId: 9, text: "しゃがんでください", rate: 1 },
    { type: "speech", studentId: 9, text: "a", rate: 0.1 },
    { type: "speech", studentId: 9, text: "a", rate: 10 },
    { type: "stopAudio", studentId: 3141592653 },
  ])("$type は JSON にして戻すと元に戻る", (notice) => {
    expect(parseMonitorNotice(stringifyMonitorNotice(notice))).toEqual(notice);
  });

  it("stringify は型に無い項目を送らない（cue の中・speech・stopAudio とも）", () => {
    const cue = {
      type: "cue",
      studentId: 1,
      cue: { type: "sound", id: "bell", action: "play", extra: "x" },
      extra: 1,
    } as unknown as MonitorNotice;
    expect(JSON.parse(stringifyMonitorNotice(cue))).toEqual({
      type: "cue",
      studentId: 1,
      cue: { type: "sound", id: "bell", action: "play" },
    });
    const speech = {
      type: "speech",
      studentId: 1,
      text: "a",
      rate: 1,
      voice: "x",
    } as MonitorNotice;
    expect(JSON.parse(stringifyMonitorNotice(speech))).toEqual({
      type: "speech",
      studentId: 1,
      text: "a",
      rate: 1,
    });
    const stop = { type: "stopAudio", studentId: 1, reason: "x" } as MonitorNotice;
    expect(JSON.parse(stringifyMonitorNotice(stop))).toEqual({ type: "stopAudio", studentId: 1 });
  });
});

describe("parseMonitorNotice: cue", () => {
  it("知らない項目は落とす（知らせ・cue の両方）", () => {
    expect(
      parseMonitorNotice(
        noticeText({ type: "cue", extra: 1, cue: { ...soundCue({ loop: true }), volume: 0.5 } }),
      ),
    ).toEqual({
      type: "cue",
      studentId: 1,
      cue: { type: "sound", id: "fire-bell", action: "play", loop: true },
    });
    expect(
      parseMonitorNotice(
        noticeText({ type: "cue", cue: { type: "narration", id: "n", action: "play" } }),
      ),
    ).toEqual({ type: "cue", studentId: 1, cue: { type: "narration", id: "n" } });
  });

  it("id・anchorId は 64 文字まで受け取る", () => {
    const id = "a".repeat(64);
    expect(
      parseMonitorNotice(noticeText({ type: "cue", cue: soundCue({ id, anchorId: id }) })),
    ).toEqual({
      type: "cue",
      studentId: 1,
      cue: { type: "sound", id, action: "play", anchorId: id },
    });
    expect(parseMonitorNotice(noticeText({ type: "cue", cue: { type: "narration", id } }))).toEqual(
      { type: "cue", studentId: 1, cue: { type: "narration", id } },
    );
  });

  it("params は 8 個・かぎ 32 文字・文字の値 100 文字まで受け取る", () => {
    const params = { ...manyParams(7), ["k".repeat(32)]: "あ".repeat(100) };
    expect(
      parseMonitorNotice(noticeText({ type: "cue", cue: { type: "narration", id: "n", params } })),
    ).toEqual({ type: "cue", studentId: 1, cue: { type: "narration", id: "n", params } });
  });

  it("params の値は文字・有限の数・真偽値を受け取る（空の文字も可）", () => {
    const params = { a: "", b: 0, c: -1.5, d: false, e: true };
    expect(
      parseMonitorNotice(noticeText({ type: "cue", cue: { type: "narration", id: "n", params } })),
    ).toEqual({ type: "cue", studentId: 1, cue: { type: "narration", id: "n", params } });
  });

  it("params が空のオブジェクトでも受け取る", () => {
    expect(
      parseMonitorNotice(
        noticeText({ type: "cue", cue: { type: "narration", id: "n", params: {} } }),
      ),
    ).toEqual({ type: "cue", studentId: 1, cue: { type: "narration", id: "n", params: {} } });
  });

  it("日本語で上限まで使っても UTF-8 で 4 KiB に収まる", () => {
    const params = Object.fromEntries(
      Array.from({ length: 8 }, (_, i) => [`${"か".repeat(31)}${i}`, "あ".repeat(100)]),
    );
    const notice: MonitorNotice = {
      type: "cue",
      studentId: 4294967295,
      cue: { type: "narration", id: "い".repeat(64), params },
    };
    const text = stringifyMonitorNotice(notice);
    expect(new TextEncoder().encode(text).length).toBeLessThanOrEqual(4096);
    expect(fitsMonitorNotice(text)).toBe(true);
    expect(parseMonitorNotice(text)).toEqual(notice);
  });

  it.each<[string, unknown]>([
    ["happening", { type: "happening", id: "smoke" }],
    ["happening（params 付き）", { type: "happening", id: "shake", params: { strength: 1 } }],
    ["知らない type", { type: "video", id: "x" }],
    ["type が無い", { id: "x" }],
    ["cue が無い", undefined],
    ["cue が null", null],
    ["cue が文字", "narration"],
    ["cue が配列", [{ type: "narration", id: "x" }]],
    ["narration の id が無い", { type: "narration" }],
    ["narration の id が空", { type: "narration", id: "" }],
    ["narration の id が 65 文字", { type: "narration", id: "a".repeat(65) }],
    ["narration の id が数", { type: "narration", id: 1 }],
    ["sound の id が 65 文字", soundCue({ id: "a".repeat(65) })],
    ["sound の id が空", soundCue({ id: "" })],
    ["sound の action が無い", soundCue({ action: undefined })],
    ["sound の action が不正", soundCue({ action: "pause" })],
    ["sound の action が真偽値", soundCue({ action: true })],
    ["loop が文字", soundCue({ loop: "true" })],
    ["loop が数", soundCue({ loop: 1 })],
    ["loop が null", soundCue({ loop: null })],
    ["anchorId が 65 文字", soundCue({ anchorId: "a".repeat(65) })],
    ["anchorId が空", soundCue({ anchorId: "" })],
    ["anchorId が数", soundCue({ anchorId: 3 })],
    ["params が 9 個", { type: "narration", id: "n", params: manyParams(9) }],
    ["params のかぎが 33 文字", { type: "narration", id: "n", params: { ["k".repeat(33)]: "v" } }],
    ["params のかぎが空", { type: "narration", id: "n", params: { "": "v" } }],
    [
      "params の文字の値が 101 文字",
      { type: "narration", id: "n", params: { a: "あ".repeat(101) } },
    ],
    ["params の値がオブジェクト", { type: "narration", id: "n", params: { a: { b: 1 } } }],
    ["params の値が配列", { type: "narration", id: "n", params: { a: [1] } }],
    ["params の値が null", { type: "narration", id: "n", params: { a: null } }],
    ["params が配列", { type: "narration", id: "n", params: ["a"] }],
    ["params が文字", { type: "narration", id: "n", params: "a" }],
    ["params が null", { type: "narration", id: "n", params: null }],
  ])("%s は捨てる", (_label, cue) => {
    expect(parseMonitorNotice(noticeText({ type: "cue", cue }))).toBeNull();
  });

  it("studentId が無い・範囲外の cue は捨てる", () => {
    const cue = { type: "narration", id: "n" };
    expect(parseMonitorNotice(JSON.stringify({ type: "cue", cue }))).toBeNull();
    expect(parseMonitorNotice(noticeText({ type: "cue", studentId: 0, cue }))).toBeNull();
  });
});

describe("readMonitorAudioCue", () => {
  it("narration・sound はそのままの形で返す", () => {
    expect(readMonitorAudioCue({ type: "narration", id: "n", params: { a: 1 } })).toEqual({
      type: "narration",
      id: "n",
      params: { a: 1 },
    });
    expect(readMonitorAudioCue(soundCue({ loop: true, anchorId: "fire-0" }))).toEqual({
      type: "sound",
      id: "fire-bell",
      action: "play",
      loop: true,
      anchorId: "fire-0",
    });
  });

  it("任意の項目が無ければ足さない", () => {
    const narration = readMonitorAudioCue({ type: "narration", id: "n" });
    expect(narration).toEqual({ type: "narration", id: "n" });
    expect(narration !== null && "params" in narration).toBe(false);
    const sound = readMonitorAudioCue(soundCue());
    expect(sound !== null && "loop" in sound).toBe(false);
    expect(sound !== null && "anchorId" in sound).toBe(false);
  });

  it("仕様の項目だけを並べ直す（知らない項目を落とす）", () => {
    expect(readMonitorAudioCue({ ...soundCue(), volume: 1 })).toEqual({
      type: "sound",
      id: "fire-bell",
      action: "play",
    });
  });

  it.each<[string, unknown]>([
    ["happening", { type: "happening", id: "smoke" }],
    ["params の数が NaN", { type: "narration", id: "n", params: { a: Number.NaN } }],
    [
      "params の数が Infinity",
      { type: "narration", id: "n", params: { a: Number.POSITIVE_INFINITY } },
    ],
    [
      "params の数が -Infinity",
      { type: "narration", id: "n", params: { a: Number.NEGATIVE_INFINITY } },
    ],
    ["params の値が undefined", { type: "narration", id: "n", params: { a: undefined } }],
    ["null", null],
    ["undefined", undefined],
    ["数", 1],
  ])("%s は null", (_label, value) => {
    expect(readMonitorAudioCue(value)).toBeNull();
  });
});

describe("parseMonitorNotice: speech", () => {
  it("文は 1〜500 文字を受け取る", () => {
    for (const text of ["a", "あ".repeat(500)]) {
      expect(parseMonitorNotice(noticeText({ type: "speech", text, rate: 1 }))).toEqual({
        type: "speech",
        studentId: 1,
        text,
        rate: 1,
      });
    }
  });

  it("500 文字の日本語でも UTF-8 で 4 KiB に収まる", () => {
    const text = stringifyMonitorNotice({
      type: "speech",
      studentId: 4294967295,
      text: "あ".repeat(500),
      rate: 1.05,
    });
    expect(fitsMonitorNotice(text)).toBe(true);
  });

  it("知らない項目は落とす", () => {
    expect(
      parseMonitorNotice(noticeText({ type: "speech", text: "a", rate: 1, voice: "x" })),
    ).toEqual({
      type: "speech",
      studentId: 1,
      text: "a",
      rate: 1,
    });
  });

  it.each<[string, Record<string, unknown>]>([
    ["文が 501 文字", { text: "あ".repeat(501), rate: 1 }],
    ["文が空", { text: "", rate: 1 }],
    ["文が無い", { rate: 1 }],
    ["文が数", { text: 1, rate: 1 }],
    ["文が null", { text: null, rate: 1 }],
    ["速さが 0.09", { text: "a", rate: 0.09 }],
    ["速さが 10.01", { text: "a", rate: 10.01 }],
    ["速さが 0", { text: "a", rate: 0 }],
    ["速さが負", { text: "a", rate: -1 }],
    ["速さが無い", { text: "a" }],
    ["速さが文字", { text: "a", rate: "1" }],
    ["速さが null", { text: "a", rate: null }],
  ])("%s は捨てる", (_label, body) => {
    expect(parseMonitorNotice(noticeText({ type: "speech", ...body }))).toBeNull();
  });

  it("速さが 1e999（読むと Infinity）は捨てる", () => {
    expect(
      parseMonitorNotice('{"type":"speech","studentId":1,"text":"a","rate":1e999}'),
    ).toBeNull();
  });

  it("studentId が無い speech は捨てる", () => {
    expect(parseMonitorNotice('{"type":"speech","text":"a","rate":1}')).toBeNull();
  });
});

describe("parseMonitorNotice: stopAudio", () => {
  it("知らない項目は落とす", () => {
    expect(parseMonitorNotice(noticeText({ type: "stopAudio", reason: "x" }))).toEqual({
      type: "stopAudio",
      studentId: 1,
    });
  });

  it.each([
    '{"type":"stopAudio"}',
    '{"type":"stopAudio","studentId":0}',
    '{"type":"stopAudio","studentId":"1"}',
    '{"type":"stopAudio","studentId":4294967296}',
  ])("%s は捨てる", (text) => {
    expect(parseMonitorNotice(text)).toBeNull();
  });
});

describe("isMonitorSpeechText", () => {
  it.each<[unknown, boolean]>([
    ["a", true],
    ["あ".repeat(500), true],
    ["あ".repeat(501), false],
    ["", false],
    [1, false],
    [null, false],
    [undefined, false],
  ])("%s → %s", (value, expected) => {
    expect(isMonitorSpeechText(value)).toBe(expected);
  });
});

describe("isMonitorSpeechRate", () => {
  it.each<[unknown, boolean]>([
    [0.1, true],
    [1, true],
    [1.05, true],
    [10, true],
    [0.09, false],
    [10.01, false],
    [0, false],
    [-1, false],
    [Number.NaN, false],
    [Number.POSITIVE_INFINITY, false],
    [Number.NEGATIVE_INFINITY, false],
    ["1", false],
    [null, false],
    [undefined, false],
  ])("%s → %s", (value, expected) => {
    expect(isMonitorSpeechRate(value)).toBe(expected);
  });
});

describe("fitsMonitorNotice", () => {
  it("上限は 4096 バイト", () => {
    expect(MONITOR_NOTICE_MAX_BYTES).toBe(4096);
  });

  it.each<[string, string, boolean]>([
    ["ASCII 4096 バイト", "a".repeat(4096), true],
    ["ASCII 4097 バイト", "a".repeat(4097), false],
    ["日本語 1365 文字（4095 バイト）", "あ".repeat(1365), true],
    ["日本語 1365 文字 + 1 バイト（4096 バイト）", `${"あ".repeat(1365)}a`, true],
    ["日本語 1365 文字 + 2 バイト（4097 バイト）", `${"あ".repeat(1365)}ab`, false],
    ["日本語 1366 文字（4098 バイト）", "あ".repeat(1366), false],
    ["絵文字 1024 個（4096 バイト）", "😀".repeat(1024), true],
    ["絵文字 1025 個（4100 バイト）", "😀".repeat(1025), false],
    ["空", "", true],
  ])("%s → %s", (_label, text, expected) => {
    expect(fitsMonitorNotice(text)).toBe(expected);
  });
});
