// ゴーグルの付け外しの案内の決まり（Issue #101・#145）．どの切り替えで案内を挟むか・手が使えない時の時間・
// 手が見つからない時の逃げ道・案内の文を確かめる

import { describe, expect, it } from "vitest";
import type { SceneId } from "../core/scene";
import {
  advanceGoggleSwitchElapsed,
  advanceNoHandSeconds,
  DEFAULT_GOGGLE_SWITCH_CONFIG,
  GOGGLE_HAND_PROMPT,
  GOGGLE_OFF_BUTTON_LABEL,
  GOGGLE_OFF_HOME_BUTTON_LABEL,
  goggleOffButtonLabel,
  goggleOffNarrates,
  goggleOffPanel,
  goggleOnCaption,
  goggleOnConfirmPanel,
  goggleOnGuideLines,
  goggleOnNeedsConfirm,
  goggleOnRemainingSeconds,
  goggleSwitchBetween,
  isGoggleOffDone,
  isGoggleOnConfirmTimeUp,
  isGoggleOnReadDone,
  isHandLost,
  remainingSeconds,
  shouldPromptHand,
} from "./goggleSwitch";

describe("goggleSwitchBetween", () => {
  it.each<[SceneId | null, SceneId, ReturnType<typeof goggleSwitchBetween>]>([
    // 結果画面は VR の中で見る（Issue #146）ので，避難 → 結果・結果 → ロビーには挟まず，結果 → ホームで外す
    ["scenario", "debrief", null],
    ["debrief", "lobby", null],
    ["debrief", "home", "takeOff"],
    ["lobby", "home", "takeOff"],
    ["home", "lobby", "putOn"],
    ["home", "scenario", "putOn"],
    ["lobby", "scenario", null],
    ["start", "home", null],
    ["start", "lobby", null],
    ["home", "start", null],
    [null, "home", null],
  ])("%s → %s は %s", (from, to, expected) => {
    expect(goggleSwitchBetween(from, to)).toBe(expected);
  });
});

describe("goggleOnNeedsConfirm", () => {
  it("ロビーへ進む時は「準備OK」を出さない（ロビーの開始ボタンが装着の確認を兼ねる）", () => {
    expect(goggleOnNeedsConfirm("lobby")).toBe(false);
  });

  it.each<SceneId>(["scenario", "home", "debrief"])(
    "ロビーを飛ばして %s へ進む時は「準備OK」を出す",
    (next) => {
      expect(goggleOnNeedsConfirm(next)).toBe(true);
    },
  );
});

describe("advanceGoggleSwitchElapsed", () => {
  it("dt を足す", () => {
    expect(advanceGoggleSwitchElapsed(1, 0.5, false)).toBe(1.5);
  });

  it("止めている間は数えない", () => {
    expect(advanceGoggleSwitchElapsed(1, 0.5, true)).toBe(1);
  });

  it.each([Number.NaN, -1, 0, Number.POSITIVE_INFINITY])("dt が %s なら数えない", (dt) => {
    expect(advanceGoggleSwitchElapsed(1, dt, false)).toBe(1);
  });
});

describe("advanceNoHandSeconds", () => {
  it("手が見つからない間は足す", () => {
    expect(advanceNoHandSeconds(2, 0.5, false)).toBe(2.5);
  });

  it("手を認識したら 0 に戻す", () => {
    expect(advanceNoHandSeconds(20, 0.5, true)).toBe(0);
  });

  it.each([Number.NaN, -1, 0])("dt が %s なら数えない", (dt) => {
    expect(advanceNoHandSeconds(2, dt, false)).toBe(2);
  });
});

describe("shouldPromptHand・isHandLost", () => {
  const { handPromptSeconds, handLostSeconds } = DEFAULT_GOGGLE_SWITCH_CONFIG;

  it("手が見つからない秒数が案内の秒数に届いたら案内する（境界）", () => {
    expect(shouldPromptHand(handPromptSeconds - 0.01)).toBe(false);
    expect(shouldPromptHand(handPromptSeconds)).toBe(true);
  });

  it("案内より長く見つからなければ進む（境界）", () => {
    expect(handLostSeconds).toBeGreaterThan(handPromptSeconds);
    expect(isHandLost(handLostSeconds - 0.01)).toBe(false);
    expect(isHandLost(handLostSeconds)).toBe(true);
  });

  it("NaN では案内も進みもしない", () => {
    expect(shouldPromptHand(Number.NaN)).toBe(false);
    expect(isHandLost(Number.NaN)).toBe(false);
  });
});

describe("isGoggleOffDone（手が使えない時の外す案内）", () => {
  const { takeOffMinSeconds, takeOffMaxSeconds } = DEFAULT_GOGGLE_SWITCH_CONFIG;

  it("最短の秒数の前は，読み上げが終わっていても進まない", () => {
    expect(isGoggleOffDone(takeOffMinSeconds - 0.01, true)).toBe(false);
  });

  it("最短の秒数を過ぎて読み上げが終わったら進む", () => {
    expect(isGoggleOffDone(takeOffMinSeconds, true)).toBe(true);
  });

  it("読み上げの終わりが届かなくても上限の秒数で進む", () => {
    expect(isGoggleOffDone(takeOffMaxSeconds - 0.01, false)).toBe(false);
    expect(isGoggleOffDone(takeOffMaxSeconds, false)).toBe(true);
  });

  it("NaN では進まない", () => {
    expect(isGoggleOffDone(Number.NaN, true)).toBe(false);
  });
});

describe("付ける案内の秒数", () => {
  const { putOnSeconds, putOnConfirmSeconds } = DEFAULT_GOGGLE_SWITCH_CONFIG;

  it("read は putOnSeconds で終わる（境界）", () => {
    expect(isGoggleOnReadDone(putOnSeconds - 0.01)).toBe(false);
    expect(isGoggleOnReadDone(putOnSeconds)).toBe(true);
    expect(isGoggleOnReadDone(Number.NaN)).toBe(false);
  });

  it("手が使えない時の confirm は putOnConfirmSeconds で終わる（境界）", () => {
    expect(isGoggleOnConfirmTimeUp(putOnConfirmSeconds - 0.01)).toBe(false);
    expect(isGoggleOnConfirmTimeUp(putOnConfirmSeconds)).toBe(true);
    expect(isGoggleOnConfirmTimeUp(Number.NaN)).toBe(false);
  });

  it("残りの秒数は切り上げ，0 より小さくならない", () => {
    expect(goggleOnRemainingSeconds(0)).toBe(putOnSeconds);
    expect(goggleOnRemainingSeconds(0.1)).toBe(putOnSeconds);
    expect(goggleOnRemainingSeconds(putOnSeconds + 5)).toBe(0);
    expect(remainingSeconds(Number.NaN, 3)).toBe(3);
  });

  it("残りの秒数の表示に秒数とタップで進めることを出す", () => {
    expect(goggleOnCaption(4)).toContain("4 秒後");
    expect(goggleOnCaption(4)).toContain("タップ");
  });
});

describe("goggleSwitchBetween の fromGoggles", () => {
  it.each<[SceneId, SceneId, boolean, ReturnType<typeof goggleSwitchBetween>]>([
    // 結果画面をスマホの画面（HTML）に切り替えた後は，ゴーグルを外している
    ["debrief", "lobby", false, "putOn"],
    ["debrief", "home", false, null],
    // 左右 2 画面のまま
    ["debrief", "lobby", true, null],
    ["debrief", "home", true, "takeOff"],
  ])("%s → %s（ゴーグル %s）は %s", (from, to, fromGoggles, expected) => {
    expect(goggleSwitchBetween(from, to, fromGoggles)).toBe(expected);
  });

  it("start からは渡しても挟まない", () => {
    expect(goggleSwitchBetween("start", "lobby", false)).toBeNull();
    expect(goggleSwitchBetween(null, "lobby", false)).toBeNull();
  });
});

describe("goggleOffButtonLabel・goggleOffNarrates", () => {
  it("ホームへ進む時は結果画面の文を使わず，ナレーションも流さない", () => {
    expect(goggleOffButtonLabel("home")).toBe(GOGGLE_OFF_HOME_BUTTON_LABEL);
    expect(goggleOffNarrates("home")).toBe(false);
  });

  it("結果画面へ進む時は「結果を見る」とナレーション", () => {
    expect(goggleOffButtonLabel("debrief")).toBe(GOGGLE_OFF_BUTTON_LABEL);
    expect(goggleOffNarrates("debrief")).toBe(true);
  });
});

describe("goggleOffPanel", () => {
  it("ホームへ進む時はホームに戻ると伝える", () => {
    const panel = goggleOffPanel(true, false, "home");
    expect(panel.title).toContain("ホーム");
    expect(panel.body).toContain("ボタン");
    expect(panel.caption).toContain("タップ");
    expect(goggleOffPanel(true, true, "home").caption).toBe(GOGGLE_HAND_PROMPT);
    const noHands = goggleOffPanel(false, false, "home");
    expect(noHands.body).not.toContain("ボタン");
    expect(noHands.caption).toContain("ホーム");
    expect(`${panel.title}${panel.body}`).not.toContain("結果");
  });

  it("手が使える時はボタンをかざすよう案内し，タップでも進めると添える", () => {
    const panel = goggleOffPanel(true);
    expect(panel.body).toContain("ボタン");
    expect(panel.caption).toContain("タップ");
  });

  it("手が見つからない時は手を出すよう案内する", () => {
    expect(goggleOffPanel(true, true).caption).toBe(GOGGLE_HAND_PROMPT);
  });

  it("手が使えない時はボタンに触れず，まもなく切り替わると出す", () => {
    const panel = goggleOffPanel(false);
    expect(panel.body).not.toContain("ボタン");
    expect(panel.caption).toContain("まもなく");
  });
});

describe("goggleOnGuideLines", () => {
  it("手が使える時はボタンに手のひらをかざすと伝える", () => {
    const lines = goggleOnGuideLines(true);
    expect(lines).toHaveLength(3);
    expect(lines[2]).toContain("ボタンに手のひらをかざす");
  });

  it("ロビーへ進む時（デモでない）は，押すのがロビーの開始ボタンだと伝える", () => {
    expect(goggleOnGuideLines(true)[2]).toContain("開始ボタン");
    expect(goggleOnGuideLines(true)[2]).toContain("訓練の準備が始まります");
  });

  it("手が使えない時は待つと進むと伝える", () => {
    expect(goggleOnGuideLines(false)[2]).toContain("待つと");
    expect(goggleOnGuideLines(false)[2]).not.toContain("ボタン");
  });

  it("デモ用の起動では避難訓練が始まることと，その向きが正面になることを伝える", () => {
    const last = goggleOnGuideLines(true, true)[2];
    expect(last).toContain("避難訓練が始まります");
    expect(last).not.toContain("開始ボタン");
    expect(last).toContain("正面");
  });
});

describe("goggleOnConfirmPanel", () => {
  it("手が使える時はボタンをかざすよう案内し，残り秒数は出さない", () => {
    const panel = goggleOnConfirmPanel(true, 3);
    expect(panel.body).toContain("ボタン");
    expect(panel.caption).toBe("");
  });

  it("手が見つからない時は手を出すよう案内する", () => {
    expect(goggleOnConfirmPanel(true, 3, false, true).caption).toBe(GOGGLE_HAND_PROMPT);
  });

  it("手が使えない時は残り秒数を出す（切り上げ・負の数と NaN は 0）", () => {
    expect(goggleOnConfirmPanel(false, 2.2).caption).toBe("あと 3 秒");
    expect(goggleOnConfirmPanel(false, -1).caption).toBe("あと 0 秒");
    expect(goggleOnConfirmPanel(false, Number.NaN).caption).toBe("あと 0 秒");
  });

  it("デモ用の起動では避難訓練が始まると伝える", () => {
    expect(goggleOnConfirmPanel(true, 0, true).body).toContain("避難訓練が始まります");
  });
});
