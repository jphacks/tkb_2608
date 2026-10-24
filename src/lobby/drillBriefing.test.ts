// 訓練の説明（Issue #110 の決定事項を基準にする）:
// キャリブレーションの後に「今日の訓練」8 秒 →「避難の注意」7 秒．学校名・開始の教室名・モード（学習: 床の矢印に沿って／
// テスト: 経路は出ない）を Session.plan から作る．plan が null なら一般の文．開始地点が教室でない・範囲外・名前が空なら
// 教室の文を省く．「同じ訓練をもう一度」の時は「避難の注意」だけ．最短の時間と読み上げの終わりの両方で進む

import { describe, expect, it } from "vitest";
import type { CellKind, CellRef, DrillMode, SchoolPlan } from "../core/schoolPlan";
import {
  advanceBriefing,
  BRIEFING_CAUTION_LINES,
  type BriefingState,
  briefingTotalSeconds,
  currentBriefingPage,
  DEFAULT_BRIEFING_CONFIG,
  describeBriefing,
  describeBriefingOverview,
  isBriefingFinished,
  remainingBriefingSeconds,
  restartBriefingPage,
  skipBriefingPage,
  startBriefing,
  startRoomName,
} from "./drillBriefing";

/**
 * 3 × 2 マスの小さな校舎．上の列（z = 0）は x = 0,1 が教室 0（「3年1組」），x = 2 が教室 1，下の列（z = 1）は廊下
 */
function plan(
  patch: { name?: string; mode?: DrillMode; start?: CellRef; roomNames?: readonly string[] } = {},
): SchoolPlan {
  const cells: CellKind[] = ["classroom", "classroom", "classroom", "corridor", "corridor", "exit"];
  const roomOf = [0, 0, 1, -1, -1, -1];
  const names = patch.roomNames ?? ["3年1組", "理科室"];
  return {
    version: 1,
    name: patch.name ?? "テスト小学校",
    cellSize: 1,
    floors: [{ level: 1, width: 3, depth: 2, cells, roomOf }],
    rooms: names.map((name) => ({ name })),
    drill: {
      mode: patch.mode ?? "learn",
      fireOrigins: [{ floor: 0, x: 2, z: 0 }],
      start: patch.start ?? { floor: 0, x: 0, z: 0 },
      startYaw: 0,
      assembly: [{ floor: 0, x: 2, z: 1 }],
      route: [],
      spread: { fireSecondsPerCell: 6, smokeSecondsPerCell: 2, extraFires: [] },
      timeLimitSeconds: 150,
    },
  };
}

function run(state: BriefingState, seconds: number, settled = true, dt = 0.125): BriefingState {
  let s = state;
  const n = Math.round(seconds / dt);
  for (let i = 0; i < n; i++) s = advanceBriefing(s, dt, DEFAULT_BRIEFING_CONFIG, settled);
  return s;
}

describe("DEFAULT_BRIEFING_CONFIG（決定事項）", () => {
  it("今日の訓練 8 秒，避難の注意 7 秒", () => {
    expect(DEFAULT_BRIEFING_CONFIG.overviewSeconds).toBe(8);
    expect(DEFAULT_BRIEFING_CONFIG.cautionSeconds).toBe(7);
  });
});

describe("startBriefing", () => {
  it("初回は「今日の訓練」→「避難の注意」", () => {
    const s = startBriefing(false);
    expect(s.pages).toEqual(["overview", "caution"]);
    expect(currentBriefingPage(s)).toBe("overview");
    expect(isBriefingFinished(s)).toBe(false);
  });

  it("「同じ訓練をもう一度」は「避難の注意」だけ", () => {
    const s = startBriefing(true);
    expect(s.pages).toEqual(["caution"]);
    expect(currentBriefingPage(s)).toBe("caution");
  });
});

describe("briefingTotalSeconds", () => {
  it("初回は 15 秒，もう一度は 7 秒", () => {
    expect(briefingTotalSeconds(startBriefing(false))).toBe(15);
    expect(briefingTotalSeconds(startBriefing(true))).toBe(7);
  });
});

describe("advanceBriefing", () => {
  it("読み上げが済んでいれば 8 秒で注意へ，さらに 7 秒で終わる", () => {
    let s = run(startBriefing(false), 7.875);
    expect(currentBriefingPage(s)).toBe("overview");
    s = run(s, 0.125);
    expect(currentBriefingPage(s)).toBe("caution");
    expect(s.pageElapsed).toBe(0);
    s = run(s, 6.875);
    expect(currentBriefingPage(s)).toBe("caution");
    s = run(s, 0.125);
    expect(isBriefingFinished(s)).toBe(true);
  });

  it("最短の時間が過ぎても読み上げが済むまで進まない", () => {
    let s = run(startBriefing(false), 20, false);
    expect(currentBriefingPage(s)).toBe("overview");
    // 読み上げを待つ間も経過は数える
    expect(s.pageElapsed).toBeCloseTo(20);
    s = advanceBriefing(s, 0.125, DEFAULT_BRIEFING_CONFIG, true);
    expect(currentBriefingPage(s)).toBe("caution");
  });

  it("読み上げが済んでいても最短の時間の前には進まない", () => {
    expect(currentBriefingPage(run(startBriefing(false), 4))).toBe("overview");
  });

  it("narrationSettled を省くと済んだ扱い", () => {
    let s = startBriefing(true);
    for (let i = 0; i < 56; i++) s = advanceBriefing(s, 0.125);
    expect(isBriefingFinished(s)).toBe(true);
  });

  it.each([Number.NaN, -1, 0, Number.POSITIVE_INFINITY])("dt が %s の時は進めない", (dt) => {
    const s = advanceBriefing(startBriefing(false), dt);
    expect(s.pageElapsed).toBe(0);
    expect(currentBriefingPage(s)).toBe("overview");
  });

  it("終わった後は変えない", () => {
    const done = run(startBriefing(true), 7);
    expect(isBriefingFinished(done)).toBe(true);
    expect(advanceBriefing(done, 1)).toBe(done);
  });
});

describe("skipBriefingPage", () => {
  it("今のページを飛ばす", () => {
    const s = skipBriefingPage(run(startBriefing(false), 3));
    expect(currentBriefingPage(s)).toBe("caution");
    expect(s.pageElapsed).toBe(0);
    expect(isBriefingFinished(skipBriefingPage(s))).toBe(true);
  });

  it("終わった後は変えない", () => {
    const done = skipBriefingPage(startBriefing(true));
    expect(skipBriefingPage(done)).toBe(done);
  });
});

describe("restartBriefingPage", () => {
  it("今のページの経過を 0 に戻す（ページは変えない）", () => {
    const s = run(skipBriefingPage(startBriefing(false)), 5);
    const r = restartBriefingPage(s);
    expect(currentBriefingPage(r)).toBe("caution");
    expect(r.pageElapsed).toBe(0);
  });

  it("終わった後は変えない", () => {
    const done = skipBriefingPage(startBriefing(true));
    expect(restartBriefingPage(done)).toBe(done);
  });
});

describe("remainingBriefingSeconds", () => {
  it("今のページの残り（0 以上）．終わった後は null", () => {
    expect(remainingBriefingSeconds(startBriefing(false))).toBe(8);
    expect(remainingBriefingSeconds(run(startBriefing(false), 3))).toBeCloseTo(5);
    expect(remainingBriefingSeconds(run(startBriefing(false), 20, false))).toBe(0);
    expect(remainingBriefingSeconds(skipBriefingPage(startBriefing(true)))).toBeNull();
  });
});

describe("startRoomName", () => {
  it("開始地点の教室の名前", () => {
    expect(startRoomName(plan())).toBe("3年1組");
    expect(startRoomName(plan({ start: { floor: 0, x: 2, z: 0 } }))).toBe("理科室");
  });

  it("名前の前後の空白は除く", () => {
    expect(startRoomName(plan({ roomNames: ["　3年1組 ", "理科室"] }))).toBe("3年1組");
  });

  it.each<[string, CellRef]>([
    ["教室でないマス（廊下）", { floor: 0, x: 0, z: 1 }],
    ["x が範囲外（負）", { floor: 0, x: -1, z: 0 }],
    ["x が範囲外（幅以上）", { floor: 0, x: 3, z: 0 }],
    ["z が範囲外", { floor: 0, x: 0, z: 2 }],
    ["階が無い", { floor: 1, x: 0, z: 0 }],
    ["階が負", { floor: -1, x: 0, z: 0 }],
    ["x が整数でない", { floor: 0, x: 0.5, z: 0 }],
    ["x が NaN", { floor: 0, x: Number.NaN, z: 0 }],
  ])("%s の時は null", (_label, start) => {
    expect(startRoomName(plan({ start }))).toBeNull();
  });

  it("名前が空・空白だけなら null", () => {
    expect(startRoomName(plan({ roomNames: ["", "理科室"] }))).toBeNull();
    expect(startRoomName(plan({ roomNames: ["  ", "理科室"] }))).toBeNull();
  });

  it("教室の添字が rooms の範囲外なら null", () => {
    expect(startRoomName(plan({ roomNames: [] }))).toBeNull();
  });
});

describe("describeBriefingOverview", () => {
  it("学習モードは学校名・教室・床の矢印に沿って逃げることを伝える", () => {
    const text = describeBriefingOverview(plan());
    expect(text).toContain("テスト小学校");
    expect(text).toContain("3年1組");
    expect(text).toContain("床の矢印");
  });

  it("テストモードは経路が出ないことを伝え，矢印に触れない", () => {
    const text = describeBriefingOverview(plan({ mode: "test" }));
    expect(text).toContain("経路は出ません");
    expect(text).not.toContain("矢印");
  });

  it("plan が null なら学校名・教室・モードに触れない一般の文", () => {
    const text = describeBriefingOverview(null);
    expect(text.length).toBeGreaterThan(0);
    expect(text).toContain("避難訓練");
    expect(text).not.toContain("矢印");
    expect(text).not.toContain("経路は出ません");
    expect(text).not.toContain("あなたは");
  });

  it("開始地点が教室でなければ教室の文を省く", () => {
    const text = describeBriefingOverview(plan({ start: { floor: 0, x: 0, z: 1 } }));
    expect(text).not.toContain("あなたは");
    expect(text).toContain("テスト小学校");
    expect(text).toContain("床の矢印");
  });

  it("開始地点が範囲外なら教室の文を省く", () => {
    const text = describeBriefingOverview(plan({ start: { floor: 0, x: 99, z: 0 } }));
    expect(text).not.toContain("あなたは");
  });

  it("学校名が空なら学校名を省く（「の」だけが残らない）", () => {
    const text = describeBriefingOverview(plan({ name: "  " }));
    expect(text.startsWith("今日は火災の避難訓練です")).toBe(true);
    expect(text).toContain("3年1組");
  });
});

describe("describeBriefing", () => {
  it("今日の訓練のページ（見出し・本文・読み上げ・番号・残り秒数）", () => {
    const d = describeBriefing(startBriefing(false), plan());
    expect(d.title).toBe("今日の訓練");
    expect(d.body).toBe(describeBriefingOverview(plan()));
    expect(d.narration).toBe(d.body);
    expect(d.progressLabel).toBe("説明 1 / 2");
    expect(d.remainingSeconds).toBe(8);
  });

  it("避難の注意のページ（低い姿勢・ハンカチ・火に近づかない）", () => {
    const d = describeBriefing(skipBriefingPage(startBriefing(false)), plan());
    expect(d.title).toBe("避難の注意");
    expect(d.body).toBe(BRIEFING_CAUTION_LINES.join("\n"));
    expect(d.body).toContain("低い姿勢");
    expect(d.body).toContain("ハンカチ");
    expect(d.body).toContain("火に近づかない");
    expect(d.narration).not.toBeNull();
    expect(d.progressLabel).toBe("説明 2 / 2");
    expect(d.remainingSeconds).toBe(7);
  });

  it("「もう一度」は避難の注意だけで，番号を出さない", () => {
    const d = describeBriefing(startBriefing(true), plan());
    expect(d.title).toBe("避難の注意");
    expect(d.progressLabel).toBeNull();
  });

  it("残り秒数は切り上げ", () => {
    expect(describeBriefing(run(startBriefing(false), 0.125), plan()).remainingSeconds).toBe(8);
    expect(describeBriefing(run(startBriefing(false), 7.5), plan()).remainingSeconds).toBe(1);
  });

  it("最短を過ぎて読み上げを待つ間は残り秒数を出さない", () => {
    const waiting = run(startBriefing(false), 10, false);
    expect(currentBriefingPage(waiting)).toBe("overview");
    expect(describeBriefing(waiting, plan()).remainingSeconds).toBeNull();
  });

  it("ページごとに key が異なり，同じページの中では変わらない", () => {
    const first = startBriefing(false);
    const second = skipBriefingPage(first);
    const k1 = describeBriefing(first, plan()).key;
    expect(describeBriefing(run(first, 3), plan()).key).toBe(k1);
    expect(describeBriefing(second, plan()).key).not.toBe(k1);
    expect(describeBriefing(skipBriefingPage(second), plan()).key).not.toBe(
      describeBriefing(second, plan()).key,
    );
  });

  it("plan が null でも今日の訓練のページを作れる", () => {
    const d = describeBriefing(startBriefing(false), null);
    expect(d.body).toBe(describeBriefingOverview(null));
  });

  it("終わった後は読み上げなし・番号なし", () => {
    const d = describeBriefing(skipBriefingPage(startBriefing(true)), plan());
    expect(d.narration).toBeNull();
    expect(d.progressLabel).toBeNull();
    expect(d.remainingSeconds).toBeNull();
  });
});
