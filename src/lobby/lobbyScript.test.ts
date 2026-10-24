import { describe, expect, it } from "vitest";
import type { CalibrationProfile } from "../core/types";
import {
  type CalibrationState,
  currentStepId,
  skipCalibrationStep,
  startCalibration,
} from "./calibration";
import { describeCalibration, describeStartGate } from "./lobbyScript";

const PREVIOUS: CalibrationProfile = {
  createdAt: 1,
  yawOffset: 0.1,
  standingBaseline: 9.7,
  crouchThreshold: 2,
  stepPeakThreshold: 2,
};

/** skip で全段階を順に並べる */
function allStates(previous: CalibrationProfile | null): CalibrationState[] {
  const states: CalibrationState[] = [];
  let s = startCalibration(previous);
  for (let i = 0; i < 20; i++) {
    states.push(s);
    if (s.phase === "finished") break;
    s = skipCalibrationStep(s);
  }
  return states;
}

describe("describeCalibration", () => {
  it("align では見え方の調整を案内し，残り秒数（15 秒，切り上げ）を出す", () => {
    const s = startCalibration(null);
    const d = describeCalibration(s);
    expect(d.key).toBe("align");
    expect(d.title.length).toBeGreaterThan(0);
    expect(d.narration).not.toBeNull();
    expect(d.progressLabel).toBeNull();
    expect(d.remainingSeconds).toBe(15);
    expect(describeCalibration({ ...s, phaseElapsed: 4.2 }).remainingSeconds).toBe(11);
  });

  it("手順ごとに「手順 n / 5」と制限時間の残りを出す", () => {
    const steps = allStates(null).filter((s) => s.phase === "step");
    expect(steps.map((s) => currentStepId(s))).toEqual([
      "faceFront",
      "standing",
      "crouching",
      "crouchWalking",
      "stepping",
    ]);
    const expected = [8, 8, 10, 12, 12];
    steps.forEach((s, i) => {
      const d = describeCalibration(s);
      expect(d.progressLabel).toBe(`手順 ${i + 1} / 5`);
      expect(d.remainingSeconds).toBe(expected[i]);
      expect(d.title.length).toBeGreaterThan(0);
      expect(d.body.length).toBeGreaterThan(0);
      expect(d.narration).not.toBeNull();
    });
  });

  it("残り秒数は切り上げ", () => {
    const s = allStates(null).find((x) => currentStepId(x) === "stepping");
    if (s === undefined) throw new Error("stepping が無い");
    expect(describeCalibration({ ...s, phaseElapsed: 0.3 }).remainingSeconds).toBe(12);
    expect(describeCalibration({ ...s, phaseElapsed: 11.5 }).remainingSeconds).toBe(1);
  });

  it("段階・手順ごとに key が異なり，同じ段階の中では変わらない（読み上げは区切りが変わった時だけ）", () => {
    const keys = allStates(null).map((s) => describeCalibration(s).key);
    // outro と finished は同じ案内
    const withoutFinished = keys.slice(0, -1);
    expect(new Set(withoutFinished).size).toBe(withoutFinished.length);
    const s = allStates(null).find((x) => currentStepId(x) === "standing");
    if (s === undefined) throw new Error("standing が無い");
    expect(describeCalibration({ ...s, phaseElapsed: 2 }).key).toBe(describeCalibration(s).key);
  });

  it("「もう一度」では手順は 1 / 1 で，導入の文が初回と異なる", () => {
    const reused = allStates(PREVIOUS);
    const steps = reused.filter((s) => s.phase === "step");
    expect(steps.length).toBe(1);
    expect(describeCalibration(steps[0] as CalibrationState).progressLabel).toBe("手順 1 / 1");
    const introReused = reused.find((s) => s.phase === "intro");
    const introFirst = allStates(null).find((s) => s.phase === "intro");
    if (introReused === undefined || introFirst === undefined) throw new Error("intro が無い");
    expect(describeCalibration(introReused).body).not.toBe(describeCalibration(introFirst).body);
  });

  it("足踏みの案内に必要な歩数（6）を出す", () => {
    const s = allStates(null).find((x) => currentStepId(x) === "stepping");
    if (s === undefined) throw new Error("stepping が無い");
    expect(describeCalibration(s).body).toContain("6");
  });

  it("しゃがみ歩きの案内は「しゃがんだまま足踏み」で，必要な歩数（4）と数えた歩数を出す", () => {
    const s = allStates(null).find((x) => currentStepId(x) === "crouchWalking");
    if (s === undefined) throw new Error("crouchWalking が無い");
    const d = describeCalibration(s);
    expect(d.title).toBe("しゃがんだまま足踏みをしてください");
    expect(d.body).toBe("しゃがんだまま，その場で足踏みを 4 歩ほどしてください（0 歩）");
    expect(d.narration).not.toBeNull();
    // 足踏みの手順とは別の案内（読み上げが切り替わる）
    const stepping = allStates(null).find((x) => currentStepId(x) === "stepping");
    if (stepping === undefined) throw new Error("stepping が無い");
    expect(describeCalibration(stepping).key).not.toBe(d.key);
    expect(describeCalibration(stepping).title).not.toBe(d.title);
  });

  it("outro では手順の番号・残り秒数を出さない", () => {
    const outro = allStates(null).find((s) => s.phase === "outro");
    if (outro === undefined) throw new Error("outro が無い");
    const d = describeCalibration(outro);
    expect(d.progressLabel).toBeNull();
    expect(d.remainingSeconds).toBeNull();
  });
});

describe("describeStartGate", () => {
  it("自動開始ではカウントダウン（切り上げ）を表示する", () => {
    const d = describeStartGate(false, 14.2, false);
    expect(d.key).toBe("startGate:auto");
    expect(d.title).toContain("15");
    expect(d.narration).not.toBeNull();
  });

  it("手での開始（残り null）ではボタンに手をかざすよう案内する", () => {
    const d = describeStartGate(false, null, false);
    expect(d.key).toBe("startGate:hand");
    expect(d.body).toContain("手");
  });

  it("注視（debug）が無効なら注視・Enter の案内を出さない", () => {
    for (const remaining of [10, null]) {
      const d = describeStartGate(false, remaining, false);
      expect(d.body).not.toContain("Enter");
      expect(d.body).not.toContain("見つめ");
    }
  });

  it("注視（debug）が有効なら注視・Enter の案内を出す", () => {
    for (const remaining of [10, null]) {
      const d = describeStartGate(false, remaining, true);
      expect(d.body).toContain("Enter");
    }
  });

  it("debug の案内は読み上げない", () => {
    expect(describeStartGate(false, 10, true).narration).not.toContain("Enter");
    expect(describeStartGate(false, null, true).narration).not.toContain("Enter");
  });

  it("「もう一度」では文面が変わる", () => {
    expect(describeStartGate(true, 10, false).body).not.toBe(
      describeStartGate(false, 10, false).body,
    );
    expect(describeStartGate(true, null, false).body).not.toBe(
      describeStartGate(false, null, false).body,
    );
  });

  it("手順の番号・残り秒数の欄は使わない", () => {
    const d = describeStartGate(false, 5, false);
    expect(d.progressLabel).toBeNull();
    expect(d.remainingSeconds).toBeNull();
  });
});

describe("describeStartGate（手が見つからない案内．Issue #110）", () => {
  it("handPrompt を省く・null なら元の手の案内", () => {
    expect(describeStartGate(false, null, false).key).toBe("startGate:hand");
    expect(describeStartGate(false, null, false, null).key).toBe("startGate:hand");
  });

  it("手での開始の案内は手のひらを 1 秒かざすことを伝える", () => {
    const d = describeStartGate(false, null, false);
    expect(d.body).toContain("手のひら");
    expect(d.body).toContain("1 秒");
  });

  it("handPrompt があれば「手を目の前に出して，カメラに映るように」と案内し，読み上げる", () => {
    const d = describeStartGate(false, null, false, 0);
    expect(d.body).toContain("手を目の前に出して，カメラに映るようにしてください");
    expect(d.narration).toContain("手を目の前に出して，カメラに映るようにしてください");
    expect(d.key).not.toBe("startGate:hand");
    expect(d.progressLabel).toBeNull();
    expect(d.remainingSeconds).toBeNull();
  });

  it("回ごとに key が変わる（15 秒ごとに読み上げ直す）", () => {
    const keys = [0, 1, 2].map((i) => describeStartGate(false, null, false, i).key);
    expect(new Set(keys).size).toBe(3);
    // 同じ回の中では変わらない
    expect(describeStartGate(false, null, false, 1).key).toBe(keys[1]);
  });

  it("「もう一度」でも手が見つからない案内を出す", () => {
    expect(describeStartGate(true, null, false, 0).body).toContain("手を目の前に出して");
  });

  it("debug の案内は表示するが読み上げない", () => {
    const d = describeStartGate(false, null, true, 0);
    expect(d.body).toContain("Enter");
    expect(d.narration).not.toContain("Enter");
  });
});

describe("describeCalibration（outro．Issue #110）", () => {
  it("終わりの文は訓練の説明に続くことを伝える", () => {
    const outro = allStates(null).find((s) => s.phase === "outro");
    if (outro === undefined) throw new Error("outro が無い");
    const d = describeCalibration(outro);
    expect(d.body).toBe("続いて，今日の訓練について説明します");
    expect(d.narration).toContain("続いて，今日の訓練について説明します");
  });
});
