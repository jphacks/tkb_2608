// ナレーションの進め方（Issue #120 の決定事項: signal は 1 つのナレーションにつき必ず 1 回．
// 校内放送はチャイム → 読み上げ → チャイムの後．読み上げが使えなくても見積もりの時間で流す）のテスト
import { describe, expect, it } from "vitest";
import { narrationEndedSignal } from "./audioIds";
import { chimeWaitSeconds } from "./chime";
import {
  IDLE_NARRATION,
  isNarrating,
  type NarrationAction,
  type NarrationEvent,
  type NarrationItem,
  type NarrationState,
  reduceNarration,
} from "./narrationFlow";
import {
  estimateSpeechSeconds,
  SPEECH_PITCH,
  SPEECH_RATE,
  speechTimeoutSeconds,
} from "./narrationText";

// ---- テスト用のデータ ----

const INTRO_TEXT = "授業中です．周りを見てみましょう";
const ANNOUNCE_TEXT = "3年1組で火事です．先生の指示に従って避難してください";

function item(over: Partial<NarrationItem> = {}): NarrationItem {
  return { token: 1, id: "classroom-intro", text: INTRO_TEXT, style: "narration", ...over };
}

function announcement(over: Partial<NarrationItem> = {}): NarrationItem {
  return item({ id: "fire-announcement", text: ANNOUNCE_TEXT, style: "announcement", ...over });
}

/** 出来事を順に流し，最後の状態とすべての指示を返す */
function run(events: readonly NarrationEvent[], state: NarrationState = IDLE_NARRATION) {
  let s = state;
  const actions: NarrationAction[] = [];
  for (const event of events) {
    const step = reduceNarration(s, event);
    s = step.state;
    actions.push(...step.actions);
  }
  return { state: s, actions };
}

const signals = (actions: readonly NarrationAction[]): string[] =>
  actions.flatMap((a) => (a.type === "signal" ? [a.name] : []));

const types = (actions: readonly NarrationAction[]): string[] => actions.map((a) => a.type);

// ---- 普通のナレーション ----

describe("reduceNarration（普通のナレーション）", () => {
  it("何も読んでいなければすぐ読み始め，見積もり＋4 秒の上限を頼む", () => {
    const step = reduceNarration(IDLE_NARRATION, { type: "request", item: item() });
    expect(step.actions).toEqual([
      {
        type: "speak",
        token: 1,
        text: INTRO_TEXT,
        rate: SPEECH_RATE.narration,
        pitch: SPEECH_PITCH.narration,
      },
      {
        type: "wait",
        token: 1,
        event: "speechTimeout",
        seconds: speechTimeoutSeconds(INTRO_TEXT, SPEECH_RATE.narration),
      },
    ]);
    expect(step.state.current?.phase).toBe("speaking");
    expect(isNarrating(step.state)).toBe(true);
  });

  it("上限の秒数は見積もり＋4 秒", () => {
    const step = reduceNarration(IDLE_NARRATION, { type: "request", item: item() });
    const wait = step.actions.find((a) => a.type === "wait");
    expect(wait?.type === "wait" && wait.seconds).toBeCloseTo(
      estimateSpeechSeconds(INTRO_TEXT, SPEECH_RATE.narration) + 4,
    );
  });

  it("end（speechEnded）で終わりの signal を流して何も読んでいない状態に戻る", () => {
    const r = run([
      { type: "request", item: item() },
      { type: "speechEnded", token: 1 },
    ]);
    expect(signals(r.actions)).toEqual(["narration-ended:classroom-intro"]);
    expect(r.state).toEqual(IDLE_NARRATION);
    expect(isNarrating(r.state)).toBe(false);
  });

  it("end が届かなくても上限の時間で signal を流す", () => {
    const r = run([
      { type: "request", item: item() },
      { type: "speechTimeout", token: 1 },
    ]);
    expect(signals(r.actions)).toEqual(["narration-ended:classroom-intro"]);
    expect(r.state).toEqual(IDLE_NARRATION);
  });

  it("end の後に上限の時間が来ても signal は 1 回だけ", () => {
    const r = run([
      { type: "request", item: item() },
      { type: "speechEnded", token: 1 },
      { type: "speechTimeout", token: 1 },
      { type: "speechEnded", token: 1 },
    ]);
    expect(signals(r.actions)).toHaveLength(1);
  });

  it("読み上げを始められない時は見積もりの秒数だけ待ってから signal を流す", () => {
    const first = run([
      { type: "request", item: item() },
      { type: "speechUnavailable", token: 1 },
    ]);
    expect(signals(first.actions)).toEqual([]);
    expect(first.actions.at(-1)).toEqual({
      type: "wait",
      token: 1,
      event: "speechTimeout",
      seconds: estimateSpeechSeconds(INTRO_TEXT, SPEECH_RATE.narration),
    });
    const done = run([{ type: "speechTimeout", token: 1 }], first.state);
    expect(signals(done.actions)).toEqual(["narration-ended:classroom-intro"]);
  });

  it("文面の無い ID は読まずにすぐ signal を流す", () => {
    const step = reduceNarration(IDLE_NARRATION, {
      type: "request",
      item: item({ id: "unknown", text: null }),
    });
    expect(step.actions).toEqual([{ type: "signal", name: "narration-ended:unknown" }]);
    expect(step.state).toEqual(IDLE_NARRATION);
  });

  it("空の文面でも読み始め，signal は 1 回", () => {
    const r = run([
      { type: "request", item: item({ text: "" }) },
      { type: "speechEnded", token: 1 },
    ]);
    expect(types(r.actions)).toEqual(["speak", "wait", "signal"]);
  });

  it("途中に来たナレーションは前を止め，前の分の signal を流してから新しい方を読む", () => {
    const r = run([
      { type: "request", item: item({ token: 1 }) },
      { type: "request", item: item({ token: 2, id: "evacuate-start", text: "次" }) },
    ]);
    const second = r.actions.slice(2);
    expect(types(second)).toEqual(["cancelSpeech", "signal", "speak", "wait"]);
    expect(signals(second)).toEqual(["narration-ended:classroom-intro"]);
    expect(r.state.current?.token).toBe(2);
  });

  it("止めた前のナレーションの知らせ（古い通し番号）は捨てる", () => {
    const r = run([
      { type: "request", item: item({ token: 1 }) },
      { type: "request", item: item({ token: 2, id: "evacuate-start", text: "次" }) },
      { type: "speechEnded", token: 1 },
      { type: "speechTimeout", token: 1 },
      { type: "speechUnavailable", token: 1 },
    ]);
    expect(signals(r.actions)).toEqual(["narration-ended:classroom-intro"]);
    expect(r.state.current?.token).toBe(2);
    const done = run([{ type: "speechEnded", token: 2 }], r.state);
    expect(signals(done.actions)).toEqual(["narration-ended:evacuate-start"]);
  });
});

// ---- 校内放送 ----

describe("reduceNarration（校内放送）", () => {
  it("前のチャイムを鳴らし，チャイムの長さだけ待つ（まだ読まない）", () => {
    const step = reduceNarration(IDLE_NARRATION, { type: "request", item: announcement() });
    expect(step.actions).toEqual([
      { type: "chime", kind: "start" },
      { type: "wait", token: 1, event: "preChimeDone", seconds: chimeWaitSeconds("start") },
    ]);
    expect(step.state.current?.phase).toBe("preChime");
    expect(isNarrating(step.state)).toBe(true);
  });

  it("チャイム → 読み上げ（ゆっくり） → 後のチャイム → signal の順", () => {
    const r = run([
      { type: "request", item: announcement() },
      { type: "preChimeDone", token: 1 },
      { type: "speechEnded", token: 1 },
      { type: "postChimeDone", token: 1 },
    ]);
    expect(r.actions).toEqual([
      { type: "chime", kind: "start" },
      { type: "wait", token: 1, event: "preChimeDone", seconds: chimeWaitSeconds("start") },
      {
        type: "speak",
        token: 1,
        text: ANNOUNCE_TEXT,
        rate: SPEECH_RATE.announcement,
        pitch: SPEECH_PITCH.announcement,
      },
      {
        type: "wait",
        token: 1,
        event: "speechTimeout",
        seconds: speechTimeoutSeconds(ANNOUNCE_TEXT, SPEECH_RATE.announcement),
      },
      { type: "chime", kind: "end" },
      { type: "wait", token: 1, event: "postChimeDone", seconds: chimeWaitSeconds("end") },
      { type: "signal", name: "narration-ended:fire-announcement" },
    ]);
    expect(r.state).toEqual(IDLE_NARRATION);
  });

  it("signal は後のチャイムが終わるまで流さない", () => {
    const r = run([
      { type: "request", item: announcement() },
      { type: "preChimeDone", token: 1 },
      { type: "speechEnded", token: 1 },
    ]);
    expect(signals(r.actions)).toEqual([]);
    expect(r.state.current?.phase).toBe("postChime");
    expect(isNarrating(r.state)).toBe(true);
  });

  it("前のチャイムの間に読み上げの知らせが来ても無視する", () => {
    const r = run([
      { type: "request", item: announcement() },
      { type: "speechEnded", token: 1 },
      { type: "speechTimeout", token: 1 },
      { type: "postChimeDone", token: 1 },
    ]);
    expect(types(r.actions)).toEqual(["chime", "wait"]);
    expect(r.state.current?.phase).toBe("preChime");
  });

  it("end が届かなくても上限の時間で後のチャイムへ進む", () => {
    const r = run([
      { type: "request", item: announcement() },
      { type: "preChimeDone", token: 1 },
      { type: "speechTimeout", token: 1 },
      { type: "postChimeDone", token: 1 },
    ]);
    expect(signals(r.actions)).toEqual(["narration-ended:fire-announcement"]);
  });

  it("読み上げを始められない時も，見積もりの秒数を待ち，後のチャイムの後に signal を流す", () => {
    const r = run([
      { type: "request", item: announcement() },
      { type: "preChimeDone", token: 1 },
      { type: "speechUnavailable", token: 1 },
    ]);
    expect(r.actions.at(-1)).toEqual({
      type: "wait",
      token: 1,
      event: "speechTimeout",
      seconds: estimateSpeechSeconds(ANNOUNCE_TEXT, SPEECH_RATE.announcement),
    });
    const done = run(
      [
        { type: "speechTimeout", token: 1 },
        { type: "postChimeDone", token: 1 },
      ],
      r.state,
    );
    expect(types(done.actions)).toEqual(["chime", "wait", "signal"]);
  });

  it("文面の無い校内放送はチャイムを鳴らさずすぐ signal を流す", () => {
    const step = reduceNarration(IDLE_NARRATION, {
      type: "request",
      item: announcement({ text: null }),
    });
    expect(step.actions).toEqual([{ type: "signal", name: "narration-ended:fire-announcement" }]);
  });

  it("放送の途中に来たナレーションは放送の終わりまで待たせる（放送を切らない）", () => {
    const r = run([
      { type: "request", item: announcement({ token: 1 }) },
      { type: "preChimeDone", token: 1 },
      { type: "request", item: item({ token: 2, id: "evacuate-start", text: "次" }) },
    ]);
    const after = r.actions.slice(4);
    expect(after).toEqual([]);
    expect(r.state.current?.token).toBe(1);
    expect(r.state.queued?.token).toBe(2);
  });

  it("放送が終わると，放送の signal を流してから待たせていた分を読む", () => {
    const r = run([
      { type: "request", item: announcement({ token: 1 }) },
      { type: "request", item: item({ token: 2, id: "evacuate-start", text: "次" }) },
      { type: "preChimeDone", token: 1 },
      { type: "speechEnded", token: 1 },
      { type: "postChimeDone", token: 1 },
    ]);
    const tail = r.actions.slice(-3);
    expect(tail[0]).toEqual({ type: "signal", name: "narration-ended:fire-announcement" });
    expect(tail[1]).toMatchObject({ type: "speak", token: 2, text: "次" });
    expect(r.state.current?.token).toBe(2);
    expect(r.state.queued).toBeNull();
    const done = run([{ type: "speechEnded", token: 2 }], r.state);
    expect(signals(done.actions)).toEqual(["narration-ended:evacuate-start"]);
  });

  it("前のチャイムの間に来たものも待たせる", () => {
    const r = run([
      { type: "request", item: announcement({ token: 1 }) },
      { type: "request", item: item({ token: 2 }) },
    ]);
    expect(r.state.current?.phase).toBe("preChime");
    expect(r.state.queued?.token).toBe(2);
    expect(signals(r.actions)).toEqual([]);
  });

  it("待たせられるのは 1 件だけで，2 件目が来たら先に待っていた分は読まずに signal を流す", () => {
    const r = run([
      { type: "request", item: announcement({ token: 1 }) },
      { type: "request", item: item({ token: 2, id: "classroom-intro" }) },
      { type: "request", item: item({ token: 3, id: "evacuate-start", text: "次" }) },
    ]);
    expect(signals(r.actions)).toEqual(["narration-ended:classroom-intro"]);
    expect(r.state.queued?.token).toBe(3);
    expect(r.actions.filter((a) => a.type === "speak")).toEqual([]);
  });

  it("待たせていた分の文面が無ければ，放送の後にすぐ signal を流す", () => {
    const r = run([
      { type: "request", item: announcement({ token: 1 }) },
      { type: "request", item: item({ token: 2, id: "unknown", text: null }) },
      { type: "preChimeDone", token: 1 },
      { type: "speechEnded", token: 1 },
      { type: "postChimeDone", token: 1 },
    ]);
    expect(signals(r.actions)).toEqual([
      "narration-ended:fire-announcement",
      "narration-ended:unknown",
    ]);
    expect(r.state).toEqual(IDLE_NARRATION);
  });

  it("待たせていた分が校内放送なら，前のチャイムから始める", () => {
    const r = run([
      { type: "request", item: announcement({ token: 1 }) },
      { type: "request", item: announcement({ token: 2 }) },
      { type: "preChimeDone", token: 1 },
      { type: "speechEnded", token: 1 },
      { type: "postChimeDone", token: 1 },
    ]);
    expect(r.actions.slice(-3)).toEqual([
      { type: "signal", name: "narration-ended:fire-announcement" },
      { type: "chime", kind: "start" },
      { type: "wait", token: 2, event: "preChimeDone", seconds: chimeWaitSeconds("start") },
    ]);
  });

  it("普通のナレーションの途中に来た校内放送は，前を止めて放送を始める", () => {
    const r = run([
      { type: "request", item: item({ token: 1 }) },
      { type: "request", item: announcement({ token: 2 }) },
    ]);
    expect(types(r.actions.slice(2))).toEqual(["cancelSpeech", "signal", "chime", "wait"]);
    expect(r.state.current).toMatchObject({ token: 2, phase: "preChime" });
  });
});

// ---- 止める ----

describe("reduceNarration（stop）", () => {
  it("読んでいる時は読み上げを止め，signal は流さない", () => {
    const r = run([{ type: "request", item: item() }, { type: "stop" }]);
    expect(r.actions.at(-1)).toEqual({ type: "cancelSpeech" });
    expect(signals(r.actions)).toEqual([]);
    expect(r.state).toEqual(IDLE_NARRATION);
  });

  it("待たせていた分も捨てる（signal は流さない）", () => {
    const r = run([
      { type: "request", item: announcement({ token: 1 }) },
      { type: "request", item: item({ token: 2 }) },
      { type: "stop" },
    ]);
    expect(signals(r.actions)).toEqual([]);
    expect(r.state).toEqual(IDLE_NARRATION);
  });

  it("何も読んでいない時は何もしない", () => {
    const step = reduceNarration(IDLE_NARRATION, { type: "stop" });
    expect(step.actions).toEqual([]);
    expect(step.state).toEqual(IDLE_NARRATION);
  });

  it("止めた後に古い知らせが来ても何もしない", () => {
    const r = run([
      { type: "request", item: announcement({ token: 1 }) },
      { type: "stop" },
      { type: "preChimeDone", token: 1 },
      { type: "speechEnded", token: 1 },
      { type: "speechTimeout", token: 1 },
      { type: "postChimeDone", token: 1 },
      { type: "speechUnavailable", token: 1 },
    ]);
    expect(types(r.actions)).toEqual(["chime", "wait", "cancelSpeech"]);
    expect(r.state).toEqual(IDLE_NARRATION);
  });

  it("止めた後の request はまた読む", () => {
    const r = run([
      { type: "request", item: item({ token: 1 }) },
      { type: "stop" },
      { type: "request", item: item({ token: 2 }) },
      { type: "speechEnded", token: 2 },
    ]);
    expect(signals(r.actions)).toEqual(["narration-ended:classroom-intro"]);
  });
});

describe("reduceNarration（何も読んでいない時の知らせ）", () => {
  it.each([
    "preChimeDone",
    "speechTimeout",
    "postChimeDone",
    "speechEnded",
    "speechUnavailable",
  ] as const)("%s は何もしない", (type) => {
    const step = reduceNarration(IDLE_NARRATION, { type, token: 1 });
    expect(step.actions).toEqual([]);
    expect(step.state).toEqual(IDLE_NARRATION);
  });
});

// ---- signal は 1 つのナレーションにつき必ず 1 回 ----

/**
 * 殻の代わりに指示を実行する（wait は待ち行列に積み，時刻の順に戻す．読み上げは endAfter 秒で end を返すか，
 * 返さない（null）か，始められない（"unavailable"））
 */
function simulate(
  requests: readonly { at: number; item: NarrationItem }[],
  speech: number | null | "unavailable",
) {
  let state = IDLE_NARRATION;
  const queue: { at: number; seq: number; event: NarrationEvent }[] = [];
  const out: string[] = [];
  let seq = 0;
  let now = 0;
  const push = (at: number, event: NarrationEvent) => queue.push({ at, seq: seq++, event });
  const dispatch = (event: NarrationEvent) => {
    const step = reduceNarration(state, event);
    state = step.state;
    for (const a of step.actions) {
      if (a.type === "signal") out.push(a.name);
      if (a.type === "wait") push(now + a.seconds, { type: a.event, token: a.token });
      if (a.type === "speak") {
        if (speech === "unavailable") dispatch({ type: "speechUnavailable", token: a.token });
        else if (speech !== null) push(now + speech, { type: "speechEnded", token: a.token });
      }
    }
  };
  for (const r of requests) push(r.at, { type: "request", item: r.item });
  for (let guard = 0; queue.length > 0 && guard < 1000; guard++) {
    queue.sort((a, b) => a.at - b.at || a.seq - b.seq);
    const next = queue.shift();
    if (next === undefined) break;
    now = next.at;
    dispatch(next.event);
  }
  return { signals: out, state };
}

describe("reduceNarration（signal の回数）", () => {
  const scenarios: [string, { at: number; item: NarrationItem }[]][] = [
    ["1 件", [{ at: 0, item: item({ token: 1 }) }]],
    ["放送 1 件", [{ at: 0, item: announcement({ token: 1 }) }]],
    [
      "放送の途中に 2 件",
      [
        { at: 0, item: announcement({ token: 1 }) },
        { at: 1, item: item({ token: 2, id: "a" }) },
        { at: 2, item: item({ token: 3, id: "b" }) },
      ],
    ],
    [
      "普通のナレーションが続けて 3 件",
      [
        { at: 0, item: item({ token: 1, id: "a" }) },
        { at: 0.5, item: item({ token: 2, id: "b" }) },
        { at: 1, item: announcement({ token: 3 }) },
      ],
    ],
    [
      "文面の無いものが混ざる",
      [
        { at: 0, item: item({ token: 1, id: "x", text: null }) },
        { at: 0, item: announcement({ token: 2 }) },
        { at: 0.1, item: item({ token: 3, id: "y", text: null }) },
      ],
    ],
  ];

  for (const speech of [1, null, "unavailable"] as const) {
    it.each(scenarios)(`%s（読み上げ: ${String(speech)}）でも件数と同じ回数だけ流す`, (_, reqs) => {
      const r = simulate(reqs, speech);
      expect(r.signals.length).toBe(reqs.length);
      expect(r.signals.sort()).toEqual(reqs.map((q) => narrationEndedSignal(q.item.id)).sort());
      expect(r.state).toEqual(IDLE_NARRATION);
    });
  }
});
