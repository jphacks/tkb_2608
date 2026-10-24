// 記録（JSONL）の読み込みと，再生に流す出来事・区間・URL パラメータの取り出し（experiment_山﨑/10「記録の再生」・ENV_04 ?input=replay）
import { describe, expect, it } from "vitest";
import type { InputRecord, OrientationRecord, ScreenRecord } from "../recorder/records";
import { toJsonl } from "../recorder/records";
import {
  labelSegments,
  marksOf,
  metaOf,
  motionSampleOf,
  motionTimeRange,
  orientationSampleOf,
  parseRecordsJsonl,
  parseReplaySearch,
  type ReplayEvent,
  recordedParamsOf,
  replayEventsOf,
  replayIndexUntil,
  screenSampleOf,
  sortRecordsByTime,
} from "./replayLog";
import {
  labelPair,
  labelRec,
  markRec,
  metaRec,
  motionRec,
  paramsRec,
  visibilityRec,
} from "./testRecords";

function orientationRec(o: Partial<OrientationRecord> = {}): OrientationRecord {
  return { type: "orientation", t: 0, alpha: 10, beta: 20, gamma: 30, absolute: false, ...o };
}

function screenRec(o: Partial<ScreenRecord> = {}): ScreenRecord {
  return { type: "screen", t: 0, angle: 90, orientationType: "landscape-primary", ...o };
}

describe("parseRecordsJsonl", () => {
  it("toJsonl で書いた記録をそのまま読み戻す", () => {
    const records: InputRecord[] = [
      metaRec(),
      motionRec({ t: 1 }),
      labelRec({ t: 2 }),
      markRec({ t: 3 }),
    ];
    expect(parseRecordsJsonl(toJsonl(records))).toEqual({ records, skipped: 0 });
  });

  it("手の認識の記録（hand）を読む．t が無い hand は飛ばす", () => {
    const hand = {
      type: "hand",
      t: 10,
      doneAt: 30,
      inferMs: 15,
      width: 320,
      height: 240,
      hands: [{ label: "left", score: 0.9, pts: Array.from({ length: 63 }, () => 0.5) }],
    };
    const noT = { ...hand, t: undefined };
    const text = `${JSON.stringify(hand)}\n${JSON.stringify(noT)}\n${JSON.stringify(motionRec({ t: 11 }))}`;
    const parsed = parseRecordsJsonl(text);
    expect(parsed.skipped).toBe(1);
    expect(parsed.records).toEqual([hand, motionRec({ t: 11 })]);
  });

  it("空の文字列は空（例外を投げない）", () => {
    expect(parseRecordsJsonl("")).toEqual({ records: [], skipped: 0 });
  });

  it("空行・空白だけの行は数えずに飛ばし，CRLF も読める", () => {
    const text = `\n   \n${JSON.stringify(motionRec({ t: 1 }))}\r\n\r\n`;
    expect(parseRecordsJsonl(text)).toEqual({ records: [motionRec({ t: 1 })], skipped: 0 });
  });

  it.each([
    ["JSON でない", "not json"],
    ["途中で切れた行", '{"type":"motion","t":1'],
    ["配列", "[1,2,3]"],
    ["数", "42"],
    ["null", "null"],
    ["文字列", '"motion"'],
    ["type が無い", '{"t":1}'],
    ["知らない type", '{"type":"unknown","t":1}'],
    ["t が無い", '{"type":"mark","kind":"other"}'],
    ["t が null（NaN の書き出し）", '{"type":"mark","t":null,"kind":"other"}'],
    ["t が文字列", '{"type":"mark","t":"1","kind":"other"}'],
    ["motion の acc が 2 要素", '{"type":"motion","t":1,"acc":[0,0],"accG":null,"rot":null}'],
    ["motion の acc に null", '{"type":"motion","t":1,"acc":[0,null,0],"accG":null,"rot":null}'],
    ["motion の rot が文字列", '{"type":"motion","t":1,"acc":null,"accG":null,"rot":"x"}'],
    ["motion の accG が無い", '{"type":"motion","t":1,"acc":null,"rot":null}'],
  ])("壊れた行（%s）は数えて飛ばし，前後の行は読む", (_, bad) => {
    const good1 = JSON.stringify(motionRec({ t: 1 }));
    const good2 = JSON.stringify(motionRec({ t: 2 }));
    const parsed = parseRecordsJsonl(`${good1}\n${bad}\n${good2}\n`);
    expect(parsed.skipped).toBe(1);
    expect(parsed.records.map((r) => r.t)).toEqual([1, 2]);
  });

  it("motion の acc・accG・rot が null（取れない項目）は読む", () => {
    const r = motionRec({ t: 1, acc: null, accG: null, rot: null, interval: null });
    expect(parseRecordsJsonl(JSON.stringify(r)).records).toEqual([r]);
  });

  it("送り直しで重なったまったく同じ行は 1 つにする", () => {
    const line = JSON.stringify(motionRec({ t: 1 }));
    const parsed = parseRecordsJsonl(`${line}\n${line}\n${line}\n`);
    expect(parsed).toEqual({ records: [motionRec({ t: 1 })], skipped: 0 });
  });

  it("同じ時刻でも中身が違う行は両方残す", () => {
    const a = motionRec({ t: 1, acc: [1, 0, 0] });
    const b = motionRec({ t: 1, acc: [2, 0, 0] });
    expect(parseRecordsJsonl(toJsonl([a, b])).records).toEqual([a, b]);
  });
});

describe("sortRecordsByTime", () => {
  it("時刻の順に並べ，同じ時刻は元の順を保つ（元の配列は変えない）", () => {
    const a = markRec({ t: 2, kind: "a" });
    const b = markRec({ t: 1, kind: "b" });
    const c = markRec({ t: 2, kind: "c" });
    const d = markRec({ t: 0, kind: "d" });
    const input = [a, b, c, d];
    expect(sortRecordsByTime(input)).toEqual([d, b, a, c]);
    expect(input).toEqual([a, b, c, d]);
  });

  it("空なら空", () => {
    expect(sortRecordsByTime([])).toEqual([]);
  });
});

describe("motionSampleOf・orientationSampleOf・screenSampleOf", () => {
  it("motion の配列を x・y・z と alpha・beta・gamma にする", () => {
    expect(
      motionSampleOf(motionRec({ t: 5, acc: [1, 2, 3], accG: [4, 5, 6], rot: [7, 8, 9] })),
    ).toEqual({
      t: 5,
      acc: { x: 1, y: 2, z: 3 },
      accG: { x: 4, y: 5, z: 6 },
      rot: { alpha: 7, beta: 8, gamma: 9 },
      interval: 16,
    });
  });

  it("取れない項目（null）は null のまま", () => {
    expect(
      motionSampleOf(motionRec({ acc: null, accG: null, rot: null, interval: null })),
    ).toMatchObject({ acc: null, accG: null, rot: null, interval: null });
  });

  it("orientation・screen の値をそのまま移す", () => {
    expect(orientationSampleOf(orientationRec({ t: 3, alpha: null }))).toEqual({
      t: 3,
      alpha: null,
      beta: 20,
      gamma: 30,
      absolute: false,
    });
    expect(screenSampleOf(screenRec({ t: 4, orientationType: null }))).toEqual({
      t: 4,
      angle: 90,
      orientationType: null,
    });
  });
});

describe("labelSegments", () => {
  it("start と end を区間の番号で組にし，始まりの順に並べる", () => {
    const records = [
      ...labelPair("step_in_place", 1, 5000, 9000),
      ...labelPair("still", 0, 1000, 4000),
    ];
    expect(labelSegments(records)).toEqual([
      { label: "still", segment: 0, repeat: 1, startT: 1000, endT: 4000 },
      { label: "step_in_place", segment: 1, repeat: 1, startT: 5000, endT: 9000 },
    ]);
  });

  it("end が無い区間は記録の最後の時刻まで", () => {
    const records = [labelRec({ label: "still", t: 1000 }), motionRec({ t: 7000 })];
    expect(labelSegments(records)).toEqual([
      { label: "still", segment: 0, repeat: 1, startT: 1000, endT: 7000 },
    ]);
  });

  it("start が無い end は捨てる", () => {
    expect(labelSegments([labelRec({ t: 1000, edge: "end", segment: 3 })])).toEqual([]);
  });

  it("end が start より前でも区間は逆向きにならない", () => {
    const records = [labelRec({ t: 2000, edge: "start" }), labelRec({ t: 1000, edge: "end" })];
    const [s] = labelSegments(records);
    expect(s.endT).toBeGreaterThanOrEqual(s.startT);
  });

  it("ラベルが無ければ空", () => {
    expect(labelSegments([motionRec()])).toEqual([]);
    expect(labelSegments([])).toEqual([]);
  });
});

describe("marksOf・metaOf・recordedParamsOf", () => {
  it("印だけを取り出す", () => {
    const m1 = markRec({ t: 1, kind: "false-walk" });
    const m2 = markRec({ t: 2, kind: "other" });
    expect(marksOf([motionRec(), m1, labelRec(), m2])).toEqual([m1, m2]);
    expect(marksOf([])).toEqual([]);
  });

  it("meta は最初の 1 つ．無ければ null", () => {
    const meta = metaRec({ sessionId: "a" });
    expect(metaOf([motionRec(), meta, metaRec({ sessionId: "b" })])).toBe(meta);
    expect(metaOf([motionRec()])).toBeNull();
  });

  it("記録した時のしきい値は最初の params．無ければ null", () => {
    expect(
      recordedParamsOf([
        motionRec(),
        paramsRec(1, { stepHighStanding: 1.2 }),
        paramsRec(2, { stepHighStanding: 9 }),
      ]),
    ).toEqual({ stepHighStanding: 1.2 });
    expect(recordedParamsOf([motionRec()])).toBeNull();
  });
});

describe("motionTimeRange", () => {
  it("motion の最初と最後の時刻（並びの順によらない）", () => {
    expect(
      motionTimeRange([
        motionRec({ t: 300 }),
        markRec({ t: 0 }),
        motionRec({ t: 100 }),
        markRec({ t: 999 }),
        motionRec({ t: 200 }),
      ]),
    ).toEqual({ startT: 100, endT: 300 });
  });

  it("motion が 1 つなら始まりと終わりが同じ", () => {
    expect(motionTimeRange([motionRec({ t: 5 })])).toEqual({ startT: 5, endT: 5 });
  });

  it("motion が無ければ null", () => {
    expect(motionTimeRange([markRec(), labelRec()])).toBeNull();
    expect(motionTimeRange([])).toBeNull();
  });
});

describe("replayEventsOf", () => {
  it("センサーの値とタブの切り替えだけを時刻の順に取り出す（判定の結果・印・ラベルは含めない）", () => {
    const events = replayEventsOf([
      motionRec({ t: 30 }),
      screenRec({ t: 20 }),
      markRec({ t: 5 }),
      labelRec({ t: 6 }),
      metaRec({ t: 0 }),
      paramsRec(1, {}),
      orientationRec({ t: 10 }),
      visibilityRec(25),
    ]);
    expect(events.map((e) => [e.kind, e.t])).toEqual([
      ["orientation", 10],
      ["screen", 20],
      ["visibility", 25],
      ["motion", 30],
    ]);
  });

  it("記録が空なら空", () => {
    expect(replayEventsOf([])).toEqual([]);
  });
});

describe("replayIndexUntil", () => {
  const events: ReplayEvent[] = [0, 10, 20, 30].map((t) => ({ kind: "visibility", t }));

  it.each([
    [0, 15, 2],
    [0, 20, 3],
    [0, -1, 0],
    [2, 25, 3],
    [0, 30, 4],
    [0, Number.POSITIVE_INFINITY, 4],
    [1, Number.NEGATIVE_INFINITY, 1],
  ])("%i から時刻 %s まで → %i（時刻ちょうどを含む）", (from, until, expected) => {
    expect(replayIndexUntil(events, from, until)).toBe(expected);
  });

  it("時刻が NaN なら進めない", () => {
    expect(replayIndexUntil(events, 1, Number.NaN)).toBe(1);
  });

  it.each([
    [-5, 0],
    [Number.NaN, 0],
    [1.7, 1],
    [99, 4],
  ])("始まりの番号が範囲外・小数（%s）でも配列の範囲に収める", (from, start) => {
    expect(replayIndexUntil(events, from, Number.NEGATIVE_INFINITY)).toBe(start);
  });

  it("出来事が無ければ 0", () => {
    expect(replayIndexUntil([], 0, 100)).toBe(0);
  });
});

describe("parseReplaySearch", () => {
  it("指定が無ければ最も新しい記録を最初から流し，最後まで流したら戻る", () => {
    expect(parseReplaySearch("")).toEqual({ log: null, fromSec: 0, loop: true });
  });

  it("?log=・?from=・?loop=0 を読む（ENV_04 の例）", () => {
    expect(
      parseReplaySearch(
        "?scene=train&input=replay&log=20261024-143537_o0qich1i.jsonl&from=30&loop=0",
      ),
    ).toEqual({ log: "20261024-143537_o0qich1i.jsonl", fromSec: 30, loop: false });
  });

  it.each([
    "../20261024-143537_abc.jsonl",
    "..%2F20261024-143537_abc.jsonl",
    "logs/input/20261024-143537_abc.jsonl",
    "20261024-143537_abc.jsonl%2F..%2F..%2Fpackage.json",
    "%2Fetc%2Fpasswd",
    "package.json",
    "20261024-143537_abc.txt",
    "20261024-143537_a.b.jsonl",
    "2026-10-24_abc.jsonl",
    `20261024-143537_${"a".repeat(65)}.jsonl`,
    "",
  ])("記録のファイル名の書式に合わない log（%s）は null（ほかのファイルを読ませない）", (log) => {
    expect(parseReplaySearch(`?log=${log}`).log).toBeNull();
  });

  it.each([
    ["30", 30],
    ["1.5", 1.5],
    ["0", 0],
    ["-1", 0],
    ["abc", 0],
    ["", 0],
    ["Infinity", 0],
    ["NaN", 0],
  ])("from=%s → %s 秒（数でない・負は 0）", (from, sec) => {
    expect(parseReplaySearch(`?from=${from}`).fromSec).toBe(sec);
  });

  it.each([
    ["?loop=0", false],
    ["?loop=false", false],
    ["?loop=1", true],
    ["?loop=", true],
    ["?loop=true", true],
    ["", true],
  ])("%s → loop %s", (search, loop) => {
    expect(parseReplaySearch(search).loop).toBe(loop);
  });
});
