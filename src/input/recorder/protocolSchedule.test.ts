import { describe, expect, it } from "vitest";
import {
  buildSchedule,
  cueRecordFor,
  DEFAULT_PREP_SEC,
  DEFAULT_PROTOCOL_STEPS,
  labelRecordFor,
  locate,
  type ProtocolCue,
  type ProtocolStep,
  SQUAT_CYCLE_SEC,
  scheduleEvents,
  segmentCues,
  squatCues,
  takeDueEvents,
} from "./protocolSchedule";

function step(label: string, durationSec: number, repeat?: number): ProtocolStep {
  return { label, title: label, instruction: label, durationSec, repeat };
}

describe("DEFAULT_PROTOCOL_STEPS（experiment_山﨑/06 の手順の例）", () => {
  const schedule = buildSchedule(DEFAULT_PROTOCOL_STEPS);

  it("静止 → 見回し → 頷き → 足踏み × 3 → しゃがむ・立つ → しゃがみ歩き × 2 → しゃがんで静止の 10 区間", () => {
    expect(schedule.segments.map((s) => s.step.label)).toEqual([
      "still",
      "look_around",
      "nod",
      "step_in_place",
      "step_in_place",
      "step_in_place",
      "squat_stand",
      "crouch_walk",
      "crouch_walk",
      "crouch_still",
    ]);
  });

  it("各区間の長さ（秒）", () => {
    expect(schedule.segments.map((s) => (s.endMs - s.startMs) / 1000)).toEqual([
      30, 30, 15, 15, 15, 15, 40, 15, 15, 30,
    ]);
  });

  it("準備時間は 6 秒で，全体は約 5 分（4〜5 分）", () => {
    expect(DEFAULT_PREP_SEC).toBe(6);
    expect(schedule.prepMs).toBe(6000);
    expect(schedule.totalMs).toBeGreaterThanOrEqual(4 * 60 * 1000);
    expect(schedule.totalMs).toBeLessThanOrEqual(5 * 60 * 1000);
  });

  it("ラベルは英小文字とアンダースコア", () => {
    for (const s of DEFAULT_PROTOCOL_STEPS) expect(s.label).toMatch(/^[a-z_]+$/);
  });
});

describe("buildSchedule", () => {
  it("区間の前に準備時間を挟み，区間を隙間なくつなぐ", () => {
    const sch = buildSchedule([step("a", 10), step("b", 5)], 2);
    expect(sch.prepMs).toBe(2000);
    expect(
      sch.segments.map((s) => [
        s.index,
        s.prepStartMs,
        s.startMs,
        s.endMs,
        s.repeat,
        s.repeatCount,
      ]),
    ).toEqual([
      [0, 0, 2000, 12000, 1, 1],
      [1, 12000, 14000, 19000, 1, 1],
    ]);
    expect(sch.totalMs).toBe(19000);
  });

  it("repeat を回ごとの区間に展開し，間にも準備時間を入れる", () => {
    const sch = buildSchedule([step("w", 3, 3)], 1);
    expect(sch.segments.map((s) => [s.repeat, s.repeatCount, s.prepStartMs, s.startMs])).toEqual([
      [1, 3, 0, 1000],
      [2, 3, 4000, 5000],
      [3, 3, 8000, 9000],
    ]);
    expect(sch.totalMs).toBe(12000);
  });

  it("準備時間 0 なら区間が続けて並ぶ", () => {
    const sch = buildSchedule([step("a", 1), step("b", 1)], 0);
    expect(sch.segments.map((s) => [s.prepStartMs, s.startMs, s.endMs])).toEqual([
      [0, 0, 1000],
      [1000, 1000, 2000],
    ]);
  });

  it.each([-1, NaN, Infinity])("準備時間が不正（%s）なら 0", (prep) => {
    expect(buildSchedule([step("a", 1)], prep).prepMs).toBe(0);
  });

  it.each([0, -5, NaN, Infinity])("長さが不正（%s）な手順は飛ばす", (d) => {
    const sch = buildSchedule([step("a", 1), step("bad", d), step("c", 1)], 0);
    expect(sch.segments.map((s) => s.step.label)).toEqual(["a", "c"]);
    expect(sch.segments.map((s) => s.index)).toEqual([0, 1]);
  });

  it.each([0, -1, NaN, 0.5])("回数が不正（%s）な手順は飛ばす", (r) => {
    const sch = buildSchedule([step("a", 1), step("bad", 1, r), step("c", 1)], 0);
    expect(sch.segments.map((s) => s.step.label)).toEqual(["a", "c"]);
  });

  it("空なら区間なし・全体 0", () => {
    expect(buildSchedule([])).toEqual({ segments: [], prepMs: 6000, totalMs: 0 });
  });
});

describe("locate", () => {
  // a: 準備 0〜2000，動作 2000〜12000．b: 準備 12000〜14000，動作 14000〜19000
  const sch = buildSchedule([step("a", 10), step("b", 5)], 2);

  it.each([-1, NaN])("負・不正な時刻（%s）は before", (t) => {
    expect(locate(sch, t)).toEqual({ phase: "before" });
  });

  it("0 は最初の区間の prep", () => {
    expect(locate(sch, 0)).toMatchObject({ phase: "prep", remainingMs: 2000 });
  });

  it("startMs ちょうどは active", () => {
    const p = locate(sch, 2000);
    expect(p.phase).toBe("active");
    if (p.phase === "active") {
      expect(p.segment.step.label).toBe("a");
      expect(p.remainingMs).toBe(10000);
    }
  });

  it("endMs ちょうどは次の区間の prep", () => {
    const p = locate(sch, 12000);
    expect(p.phase).toBe("prep");
    if (p.phase === "prep") {
      expect(p.segment.step.label).toBe("b");
      expect(p.remainingMs).toBe(2000);
    }
  });

  it("最後の区間の endMs 以降は done", () => {
    expect(locate(sch, 18999).phase).toBe("active");
    expect(locate(sch, 19000)).toEqual({ phase: "done" });
    expect(locate(sch, 1e9)).toEqual({ phase: "done" });
  });

  it("区間が無ければ 0 で done", () => {
    expect(locate(buildSchedule([]), 0)).toEqual({ phase: "done" });
  });
});

describe("scheduleEvents", () => {
  const sch = buildSchedule([step("a", 10), step("b", 5)], 2);
  const events = scheduleEvents(sch);

  it("prep → start → end を区間ごとに並べ，最後に done", () => {
    expect(events.map((e) => [e.atMs, e.kind, e.segment?.step.label ?? null])).toEqual([
      [0, "prep", "a"],
      [2000, "start", "a"],
      [12000, "end", "a"],
      [12000, "prep", "b"],
      [14000, "start", "b"],
      [19000, "end", "b"],
      [19000, "done", null],
    ]);
  });

  it("時刻は昇順（同時刻は前の区間の end が先）", () => {
    for (let i = 1; i < events.length; i++) {
      expect(events[i].atMs).toBeGreaterThanOrEqual(events[i - 1].atMs);
    }
  });
});

describe("takeDueEvents", () => {
  const events = scheduleEvents(buildSchedule([step("a", 10), step("b", 5)], 2));

  it("まだ来ていなければ何も返さない", () => {
    expect(takeDueEvents(events, 1, 1999)).toEqual({ due: [], cursor: 1 });
  });

  it("ちょうどの時刻の節目を返す", () => {
    const r = takeDueEvents(events, 0, 0);
    expect(r.due.map((e) => e.kind)).toEqual(["prep"]);
    expect(r.cursor).toBe(1);
  });

  it("タイマーが遅れて複数の節目をまたいでも，飛ばさずに順に返す", () => {
    const r = takeDueEvents(events, 1, 14500);
    expect(r.due.map((e) => `${e.kind}:${e.segment?.step.label}`)).toEqual([
      "start:a",
      "end:a",
      "prep:b",
      "start:b",
    ]);
    expect(r.cursor).toBe(5);
  });

  it("続けて呼ぶと同じ節目を 2 回返さない", () => {
    const first = takeDueEvents(events, 0, 12000);
    const second = takeDueEvents(events, first.cursor, 12000);
    expect(second.due).toEqual([]);
    expect(takeDueEvents(events, first.cursor, 1e9).due.map((e) => e.kind)).toEqual([
      "start",
      "end",
      "done",
    ]);
  });

  it("最後まで進んだら何も返さない．cursor が負なら 0 から", () => {
    expect(takeDueEvents(events, events.length, 1e9)).toEqual({
      due: [],
      cursor: events.length,
    });
    expect(takeDueEvents(events, -3, 0).cursor).toBe(1);
  });
});

describe("labelRecordFor", () => {
  const sch = buildSchedule([step("a", 10), step("w", 5, 2)], 2);
  const events = scheduleEvents(sch);

  it("動作の始まり・終わりをラベルのレコードにする（plannedT は t0 + 相対時刻）", () => {
    const start = events.find((e) => e.kind === "start" && e.segment?.repeat === 2);
    expect(start).toBeDefined();
    if (start === undefined) return;
    expect(labelRecordFor(start, 5100.5, 1000)).toEqual({
      type: "label",
      t: 5100.5,
      plannedT: 1000 + start.atMs,
      label: "w",
      edge: "start",
      segment: 2,
      repeat: 2,
      repeatCount: 2,
    });
    const end = events.find((e) => e.kind === "end" && e.segment?.index === 0);
    expect(end && labelRecordFor(end, 0, 0)).toMatchObject({ edge: "end", label: "a" });
  });

  it("prep と done は null", () => {
    for (const e of events.filter((ev) => ev.kind === "prep" || ev.kind === "done")) {
      expect(labelRecordFor(e, 0, 0)).toBeNull();
    }
  });

  it("start と end はどの区間でもちょうど 1 つずつラベルになる", () => {
    const labels = events.map((e) => labelRecordFor(e, 0, 0)).filter((r) => r !== null);
    expect(labels).toHaveLength(sch.segments.length * 2);
  });
});

function cue(atSec: number, name = "crouch"): ProtocolCue {
  return { atSec, cue: name, say: name };
}

describe("squatCues", () => {
  it("1 回ごとに「しゃがむ」（回の始まりから 0.5 秒）と「立つ」（その半周期後）を出す", () => {
    expect(squatCues(2)).toEqual([
      { atSec: 0.5, cue: "crouch", say: "しゃがむ" },
      { atSec: 2.5, cue: "stand", say: "たつ" },
      { atSec: 4.5, cue: "crouch", say: "しゃがむ" },
      { atSec: 6.5, cue: "stand", say: "たつ" },
    ]);
  });

  it("周期を変えられる（既定は SQUAT_CYCLE_SEC = 4 秒）", () => {
    expect(SQUAT_CYCLE_SEC).toBe(4);
    expect(squatCues(1, 6).map((c) => c.atSec)).toEqual([0.5, 3.5]);
  });

  it.each([0, -1, Number.NaN])("回数 %s なら空", (n) => {
    expect(squatCues(n)).toEqual([]);
  });

  it("既定の手順の「しゃがむ・立つ」は 10 回分（20 個）の合図が 40 秒の区間に収まる", () => {
    const seg = buildSchedule(DEFAULT_PROTOCOL_STEPS).segments.find(
      (x) => x.step.label === "squat_stand",
    );
    expect(seg).toBeDefined();
    if (seg === undefined) return;
    const cues = segmentCues(seg);
    expect(cues).toHaveLength(20);
    expect(cues.filter((c) => c.cue === "crouch")).toHaveLength(10);
    expect(cues.filter((c) => c.cue === "stand")).toHaveLength(10);
  });

  it("既定の手順で合図があるのは「しゃがむ・立つ」だけ", () => {
    for (const seg of buildSchedule(DEFAULT_PROTOCOL_STEPS).segments) {
      expect(segmentCues(seg).length > 0, seg.step.label).toBe(seg.step.label === "squat_stand");
    }
  });
});

describe("segmentCues", () => {
  function segWith(cues: readonly ProtocolCue[], durationSec = 10) {
    return buildSchedule([{ ...step("a", durationSec), cues }], 0).segments[0];
  }

  it("区間の中（0 より大きく長さより小さい）の合図だけを，時刻の順に返す", () => {
    const seg = segWith([cue(5), cue(0), cue(10), cue(-1), cue(2), cue(Number.NaN), cue(9.99)]);
    expect(segmentCues(seg).map((c) => c.atSec)).toEqual([2, 5, 9.99]);
  });

  it("合図の無い手順は空", () => {
    expect(segmentCues(buildSchedule([step("a", 10)]).segments[0])).toEqual([]);
  });

  it("元の定義の並びを書き換えない", () => {
    const cues = [cue(5), cue(2)];
    segmentCues(segWith(cues));
    expect(cues.map((c) => c.atSec)).toEqual([5, 2]);
  });
});

describe("scheduleEvents（合図）", () => {
  const schedule = buildSchedule(
    [{ ...step("squat", 10, 2), cues: [cue(4, "stand"), cue(1), cue(12)] }, step("b", 5)],
    2,
  );
  const events = scheduleEvents(schedule);

  it("合図は回ごとに start と end の間に，時刻の順で入る（区間外の合図は捨てる）", () => {
    expect(events.map((e) => `${e.kind}@${e.atMs}`)).toEqual([
      "prep@0",
      "start@2000",
      "cue@3000",
      "cue@6000",
      "end@12000",
      "prep@12000",
      "start@14000",
      "cue@15000",
      "cue@18000",
      "end@24000",
      "prep@24000",
      "start@26000",
      "end@31000",
      "done@31000",
    ]);
  });

  it("合図の節目には合図と区間の中の番号が付く", () => {
    const cues = events.filter((e) => e.kind === "cue");
    expect(cues.map((e) => [e.cue?.cue, e.cueIndex, e.segment?.repeat])).toEqual([
      ["crouch", 0, 1],
      ["stand", 1, 1],
      ["crouch", 0, 2],
      ["stand", 1, 2],
    ]);
  });

  it("合図の時刻はミリ秒に丸める", () => {
    const ev = scheduleEvents(buildSchedule([{ ...step("a", 10), cues: [cue(1.2345)] }], 0));
    expect(ev.find((e) => e.kind === "cue")?.atMs).toBe(1235);
  });

  it("時刻は昇順のまま", () => {
    const at = events.map((e) => e.atMs);
    expect(at).toEqual([...at].sort((a, b) => a - b));
  });

  it("合図の節目はラベルにならない（labelRecordFor は null）", () => {
    for (const e of events.filter((x) => x.kind === "cue"))
      expect(labelRecordFor(e, 0, 0)).toBeNull();
  });
});

describe("cueRecordFor", () => {
  const schedule = buildSchedule(
    [step("a", 5), { ...step("squat", 10), cues: [cue(1), cue(3, "stand")] }],
    2,
  );
  const events = scheduleEvents(schedule);

  it("合図の節目を合図のレコードにする（plannedT は t0 + 相対時刻，区間のラベルと番号）", () => {
    const e = events.filter((x) => x.kind === "cue")[1];
    expect(cueRecordFor(e, 12345.6, 10000)).toEqual({
      type: "cue",
      t: 12345.6,
      plannedT: 10000 + 7000 + 2000 + 3000,
      cue: "stand",
      index: 1,
      label: "squat",
      segment: 1,
    });
  });

  it("合図以外（prep・start・end・done）は null", () => {
    for (const e of events.filter((x) => x.kind !== "cue"))
      expect(cueRecordFor(e, 0, 0)).toBeNull();
  });

  it("合図の数だけレコードになる", () => {
    expect(events.map((e) => cueRecordFor(e, 0, 0)).filter((r) => r !== null)).toHaveLength(2);
  });
});
