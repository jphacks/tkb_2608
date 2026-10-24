// 読み上げに合わせて段階を進める判定（Issue #110 の決定事項を基準にする）:
// 時間で進む段階は「最短の時間」と「読み上げの終わり（end/error）」の両方を満たしたら進む．
// 上限「見積もり（1 秒 7 文字．空白は数えず句読点は数える）＋4 秒」で必ず進む．読み上げを始められなかった時はすぐ終わった扱い．
// 測る手順の制限時間は読み上げの後から数える

import { describe, expect, it } from "vitest";
import {
  advanceCalibration,
  type CalibrationFrame,
  type CalibrationState,
  DEFAULT_CALIBRATION_CONFIG,
  skipCalibrationStep,
  startCalibration,
} from "./calibration";
import {
  advanceNarrationTrack,
  canAdvanceTimedPhase,
  DEFAULT_NARRATION_PACING_CONFIG,
  estimateNarrationSeconds,
  isNarrationSettled,
  markNarrationEnded,
  type NarrationTrack,
  pacedCalibrationDt,
  SILENT_NARRATION,
  startNarrationTrack,
} from "./narrationPacing";

const CONFIG = DEFAULT_CALIBRATION_CONFIG;

/** skip で phase の状態まで進める */
function stateAt(phase: CalibrationState["phase"]): CalibrationState {
  let s = startCalibration(null);
  for (let i = 0; i < 20 && s.phase !== phase; i++) s = skipCalibrationStep(s);
  if (s.phase !== phase) throw new Error(`${phase} に届かない`);
  return s;
}

describe("DEFAULT_NARRATION_PACING_CONFIG（決定事項）", () => {
  it("1 秒 7 文字，余裕 4 秒", () => {
    expect(DEFAULT_NARRATION_PACING_CONFIG.charsPerSecond).toBe(7);
    expect(DEFAULT_NARRATION_PACING_CONFIG.marginSeconds).toBe(4);
  });
});

describe("estimateNarrationSeconds", () => {
  it("1 秒 7 文字で見積もる", () => {
    expect(estimateNarrationSeconds("あいうえおかき")).toBeCloseTo(1);
    expect(estimateNarrationSeconds("あ".repeat(14))).toBeCloseTo(2);
  });

  it("空白（半角・全角・改行）は数えない", () => {
    expect(estimateNarrationSeconds("あい うえ　お\nかき")).toBeCloseTo(1);
  });

  it("句読点は数える", () => {
    expect(estimateNarrationSeconds("あいうえお，．")).toBeCloseTo(1);
    expect(estimateNarrationSeconds("あいうえお、。")).toBeCloseTo(1);
  });

  it("null・空の文字列は 0 秒", () => {
    expect(estimateNarrationSeconds(null)).toBe(0);
    expect(estimateNarrationSeconds("")).toBe(0);
    expect(estimateNarrationSeconds("   ")).toBe(0);
  });

  it("サロゲートペアの文字も 1 文字として数える", () => {
    expect(estimateNarrationSeconds("𠮷".repeat(7))).toBeCloseTo(1);
  });

  it("速さが不正（0・負・NaN）なら既定の 7 文字で見積もる", () => {
    for (const charsPerSecond of [0, -3, Number.NaN]) {
      expect(estimateNarrationSeconds("あ".repeat(14), { charsPerSecond, marginSeconds: 4 })).toBe(
        2,
      );
    }
  });
});

describe("startNarrationTrack", () => {
  it("上限は見積もり＋4 秒", () => {
    const t = startNarrationTrack(1, "あ".repeat(21), true);
    expect(t.capSeconds).toBeCloseTo(3 + 4);
    expect(t.ended).toBe(false);
    expect(t.elapsed).toBe(0);
    expect(t.id).toBe(1);
  });

  it("読み上げを始められなかった（spoken: false）時はすぐ終わった扱い", () => {
    const t = startNarrationTrack(1, "あいう", false);
    expect(t.ended).toBe(true);
    expect(isNarrationSettled(t)).toBe(true);
  });

  it("読み上げる文が無い（null）時はすぐ終わった扱い", () => {
    expect(isNarrationSettled(startNarrationTrack(1, null, true))).toBe(true);
  });

  it("余裕が不正（負・NaN）なら 0 として扱う", () => {
    for (const marginSeconds of [-1, Number.NaN]) {
      const t = startNarrationTrack(1, "あ".repeat(7), true, { charsPerSecond: 7, marginSeconds });
      expect(t.capSeconds).toBeCloseTo(1);
    }
  });
});

describe("SILENT_NARRATION", () => {
  it("済んだ状態", () => {
    expect(isNarrationSettled(SILENT_NARRATION)).toBe(true);
  });
});

describe("advanceNarrationTrack", () => {
  it("dt を足していく", () => {
    const t = startNarrationTrack(1, "あ".repeat(7), true);
    expect(advanceNarrationTrack(advanceNarrationTrack(t, 0.5), 0.25).elapsed).toBeCloseTo(0.75);
  });

  it.each([Number.NaN, -1, 0, Number.POSITIVE_INFINITY])("dt が %s の時は進めない", (dt) => {
    const t = startNarrationTrack(1, "あ".repeat(7), true);
    expect(advanceNarrationTrack(t, dt).elapsed).toBe(0);
  });
});

describe("markNarrationEnded", () => {
  const track = startNarrationTrack(3, "あ".repeat(70), true);

  it("今の読み上げの id なら終わった扱いにする", () => {
    const t = markNarrationEnded(track, 3);
    expect(t.ended).toBe(true);
    expect(isNarrationSettled(t)).toBe(true);
  });

  it("id が違う（前の読み上げの）知らせは無視する", () => {
    const t = markNarrationEnded(track, 2);
    expect(t.ended).toBe(false);
    expect(isNarrationSettled(t)).toBe(false);
  });

  it("元の状態を書き換えない", () => {
    const frozen = Object.freeze({ ...track });
    markNarrationEnded(frozen, 3);
    expect(frozen.ended).toBe(false);
  });
});

describe("isNarrationSettled", () => {
  it("end が来なくても上限（見積もり＋4 秒）で済んだとみなす", () => {
    // 21 文字 = 3 秒，上限 7 秒
    let t: NarrationTrack = startNarrationTrack(1, "あ".repeat(21), true);
    t = advanceNarrationTrack(t, 6.875);
    expect(isNarrationSettled(t)).toBe(false);
    t = advanceNarrationTrack(t, 0.125);
    expect(isNarrationSettled(t)).toBe(true);
  });

  it("上限の前でも end が来れば済む", () => {
    const t = markNarrationEnded(advanceNarrationTrack(startNarrationTrack(5, "あ", true), 0.1), 5);
    expect(isNarrationSettled(t)).toBe(true);
  });
});

describe("canAdvanceTimedPhase", () => {
  it.each([
    [2.9, 3, true, false],
    [3, 3, false, false],
    [3, 3, true, true],
    [10, 3, true, true],
    [0, 0, true, true],
  ])("経過 %s 秒・最短 %s 秒・読み上げ済み %s → %s", (elapsed, min, settled, expected) => {
    expect(canAdvanceTimedPhase(elapsed, min, settled)).toBe(expected);
  });

  it("経過が NaN なら進めない", () => {
    expect(canAdvanceTimedPhase(Number.NaN, 3, true)).toBe(false);
  });
});

describe("pacedCalibrationDt", () => {
  it("読み上げが済んでいれば dt をそのまま渡す（どの段階でも）", () => {
    for (const phase of ["align", "intro", "step", "outro"] as const) {
      expect(pacedCalibrationDt(stateAt(phase), 0.125, true, CONFIG)).toBe(0.125);
    }
  });

  it("dt が不正（NaN・負・Infinity）なら 0", () => {
    for (const dt of [Number.NaN, -1, Number.POSITIVE_INFINITY]) {
      expect(pacedCalibrationDt(stateAt("align"), dt, true, CONFIG)).toBe(0);
      expect(pacedCalibrationDt(stateAt("align"), dt, false, CONFIG)).toBe(0);
    }
  });

  it("測る手順は読み上げが済むまで制限時間を数えない（0）", () => {
    expect(pacedCalibrationDt(stateAt("step"), 0.125, false, CONFIG)).toBe(0);
  });

  it.each([
    ["align", CONFIG.alignSeconds],
    ["intro", CONFIG.introSeconds],
    ["outro", CONFIG.outroSeconds],
  ] as const)(
    "%s は読み上げ中でも最短（%s 秒）の手前までは進め，届く所で止める",
    (phase, limit) => {
      const s = stateAt(phase);
      expect(pacedCalibrationDt({ ...s, phaseElapsed: 0 }, 0.125, false, CONFIG)).toBe(0.125);
      expect(pacedCalibrationDt({ ...s, phaseElapsed: limit - 0.25 }, 0.125, false, CONFIG)).toBe(
        0.125,
      );
      expect(pacedCalibrationDt({ ...s, phaseElapsed: limit - 0.125 }, 0.125, false, CONFIG)).toBe(
        0,
      );
      expect(pacedCalibrationDt({ ...s, phaseElapsed: limit }, 0.125, false, CONFIG)).toBe(0);
    },
  );

  it("渡した dt で進めると，読み上げ中は intro から先へ進まず，済んだら進む", () => {
    const frame = (dt: number): CalibrationFrame => ({ dt, motion: [], orientation: [] });
    let s = stateAt("intro");
    for (let i = 0; i < 400; i++) {
      s = advanceCalibration(s, frame(pacedCalibrationDt(s, 0.125, false, CONFIG)), CONFIG);
    }
    expect(s.phase).toBe("intro");
    s = advanceCalibration(s, frame(pacedCalibrationDt(s, 0.125, true, CONFIG)), CONFIG);
    expect(s.phase).toBe("step");
  });
});
