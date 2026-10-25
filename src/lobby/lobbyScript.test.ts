import { describe, expect, it } from "vitest";
import type { CalibrationProfile } from "../core/types";
import {
  advanceCalibration,
  type CalibrationState,
  currentStepId,
  DEFAULT_CALIBRATION_CONFIG,
  type OrientationSample,
  skipCalibrationStep,
  startCalibration,
} from "./calibration";
import { type AlignButtonPrompt, describeCalibration, describeStartGate } from "./lobbyScript";

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

/** 準備を終えて計測に入った状態にする */
function measure(s: CalibrationState): CalibrationState {
  const next = advanceCalibration(s, {
    dt: DEFAULT_CALIBRATION_CONFIG.prepSeconds,
    motion: [],
    orientation: [],
  });
  if (next.stepStage !== "measure") throw new Error("計測に入っていない");
  return next;
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

  it("準備の間は「手順 n / 5」を出し，制限時間の残りは出さない", () => {
    const steps = allStates(null).filter((s) => s.phase === "step");
    expect(steps.map((s) => currentStepId(s))).toEqual([
      "faceFront",
      "standing",
      "crouching",
      "crouchWalking",
      "stepping",
    ]);
    steps.forEach((s, i) => {
      expect(s.stepStage).toBe("prep");
      const d = describeCalibration(s);
      expect(d.progressLabel).toContain(`手順 ${i + 1} / 5`);
      expect(d.remainingSeconds).toBeNull();
      expect(d.holdSeconds ?? null).toBeNull();
      expect(d.title.length).toBeGreaterThan(0);
      expect(d.body.length).toBeGreaterThan(0);
      expect(d.narration).not.toBeNull();
    });
  });

  it("計測の間は「手順 n / 5」と計測の残り（10 秒）を出す．正面は残りを出さず保持の残り（3 秒）を出す", () => {
    const steps = allStates(null)
      .filter((s) => s.phase === "step")
      .map(measure);
    steps.forEach((s, i) => {
      const d = describeCalibration(s);
      expect(d.progressLabel).toBe(`手順 ${i + 1} / 5`);
      expect(d.countdown ?? null).toBeNull();
      if (currentStepId(s) === "faceFront") {
        expect(d.remainingSeconds).toBeNull();
        expect(d.holdSeconds).toBe(3);
      } else {
        expect(d.remainingSeconds).toBe(10);
        expect(d.holdSeconds ?? null).toBeNull();
      }
    });
  });

  it("残り秒数は切り上げ", () => {
    const s = allStates(null).find((x) => currentStepId(x) === "stepping");
    if (s === undefined) throw new Error("stepping が無い");
    const m = measure(s);
    expect(describeCalibration({ ...m, phaseElapsed: 0.3 }).remainingSeconds).toBe(10);
    expect(describeCalibration({ ...m, phaseElapsed: 9.5 }).remainingSeconds).toBe(1);
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
    const first = steps[0] as CalibrationState;
    expect(describeCalibration(first).progressLabel).toContain("手順 1 / 1");
    expect(describeCalibration(measure(first)).progressLabel).toBe("手順 1 / 1");
    const introReused = reused.find((s) => s.phase === "intro");
    const introFirst = allStates(null).find((s) => s.phase === "intro");
    if (introReused === undefined || introFirst === undefined) throw new Error("intro が無い");
    expect(describeCalibration(introReused).body).not.toBe(describeCalibration(introFirst).body);
  });

  it("しゃがみ歩きの案内は「しゃがんだまま」足踏みで，足踏みの手順とは別の案内（読み上げが切り替わる）", () => {
    const s = allStates(null).find((x) => currentStepId(x) === "crouchWalking");
    if (s === undefined) throw new Error("crouchWalking が無い");
    const d = describeCalibration(s);
    expect(d.body).toContain("しゃがんだまま");
    expect(describeCalibration(measure(s)).body).toContain("しゃがんだまま");
    expect(d.narration).not.toBeNull();
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

  it("手での開始（残り null）ではボタンに人差し指の先を当てるよう表示・読み上げで案内する", () => {
    const d = describeStartGate(false, null, false);
    expect(d.key).toBe("startGate:hand");
    expect(d.body).toContain("ボタンに人差し指の先を");
    expect(d.body).toContain("当て");
    expect(d.body).not.toContain("手のひら");
    expect(d.narration).toContain("人差し指の先");
    expect(d.narration).toContain("当て");
    expect(d.narration).not.toContain("手のひら");
    expect(d.narration).not.toContain("かざ");
  });

  it("「もう一度」の手での開始も人差し指の先を当てるよう案内する", () => {
    const d = describeStartGate(true, null, false);
    expect(d.body).toContain("人差し指の先");
    expect(d.body).not.toContain("手のひら");
    expect(d.narration).toContain("人差し指の先");
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

  it("手での開始の案内は人差し指の先を 1 秒当てることを伝える（手のひらとは言わない）", () => {
    const d = describeStartGate(false, null, false);
    expect(d.body).toContain("人差し指の先を 1 秒当て");
    expect(d.body).not.toContain("手のひら");
    expect(d.body).not.toContain("かざ");
  });

  it("手が見つからない案内でも，映ったら人差し指の先を当てるよう伝える", () => {
    const d = describeStartGate(false, null, false, 0);
    expect(d.body).toContain("人差し指の先を 1 秒当て");
    expect(d.body).not.toContain("手のひら");
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

/** 指定の手順の準備の状態 */
function prepOf(id: string, previous: CalibrationProfile | null = null): CalibrationState {
  const s = allStates(previous).find((x) => currentStepId(x) === id);
  if (s === undefined) throw new Error(`${id} が無い`);
  return s;
}

describe("describeCalibration（準備のカウントダウン）", () => {
  it("読み上げの間（数え始める前）は数字を出さない", () => {
    const s = prepOf("standing");
    expect(s.prepElapsed).toBe(0);
    expect(describeCalibration(s).countdown ?? null).toBeNull();
  });

  it.each([
    [0.01, 3],
    [0.99, 3],
    [1.0, 2],
    [1.5, 2],
    [2.0, 1],
    [2.99, 1],
  ])("数え始めて %d 秒なら %d", (elapsed, digit) => {
    const s = { ...prepOf("standing"), prepElapsed: elapsed };
    expect(describeCalibration(s).countdown).toBe(digit);
  });

  it("本文の末尾に数字を付けない（数字は countdown で渡す）", () => {
    for (const id of ["faceFront", "standing", "crouching", "crouchWalking", "stepping"]) {
      const s = { ...prepOf(id), prepElapsed: 0.5 };
      const d = describeCalibration(s);
      expect(d.countdown).toBe(3);
      expect(d.body).not.toMatch(/[0-9３２１]\s*$/);
      expect(d.title).not.toMatch(/[0-9]\s*$/);
    }
  });

  it("計測の間は数字を出さない", () => {
    expect(describeCalibration(measure(prepOf("stepping"))).countdown ?? null).toBeNull();
  });

  it("準備と計測で key を変えない（準備の前に読んだ指示を計測に入る時に読み直さない）", () => {
    for (const id of ["faceFront", "standing", "crouching", "crouchWalking", "stepping"]) {
      const s = prepOf(id);
      const k = describeCalibration(s).key;
      expect(describeCalibration({ ...s, prepElapsed: 1.5 }).key).toBe(k);
      expect(describeCalibration(measure(s)).key).toBe(k);
    }
  });
});

describe("describeCalibration（正面の保持の残り）", () => {
  const DT = 1 / 32;
  /** 正面の計測を seconds 秒，ヨー角 yawDeg（度）で進める */
  function holdFor(seconds: number, yawDeg: (t: number) => number): CalibrationState {
    let s = measure(prepOf("faceFront"));
    let t = 100;
    for (let i = 0; i < Math.round(seconds / DT); i++) {
      t += DT;
      const o: OrientationSample = {
        t,
        alpha: yawDeg((i + 1) * DT),
        beta: 90,
        gamma: 0,
        screenAngle: 0,
      };
      s = advanceCalibration(s, { dt: DT, motion: [], orientation: [o] });
    }
    if (currentStepId(s) !== "faceFront") throw new Error("正面が終わってしまった");
    return s;
  }

  it("保持の残りを切り上げて出す（1.5 秒保てば 2）", () => {
    const d = describeCalibration(holdFor(1.5, () => 0));
    expect(d.holdSeconds).toBe(2);
    expect(d.remainingSeconds).toBeNull();
  });

  it("ずれたら 3 に戻る", () => {
    const d = describeCalibration(holdFor(2 + DT, (t) => (t <= 2 ? 0 : 40)));
    expect(d.holdSeconds).toBe(3);
  });

  it("保持の残りは 1 以上（0 は出さない）", () => {
    const d = describeCalibration(holdFor(2.95, () => 0));
    expect(d.holdSeconds).toBeGreaterThanOrEqual(1);
  });

  it("制限時間の残り（8 秒）は計測の間ずっと出さない", () => {
    for (const sec of [0.5, 4, 7]) {
      const d = describeCalibration(holdFor(sec, (t) => 40 * Math.sin(t * 3)));
      expect(d.remainingSeconds).toBeNull();
      expect(d.holdSeconds).not.toBeNull();
    }
  });

  it("正面以外の手順・準備の間は holdSeconds を出さない", () => {
    expect(describeCalibration(prepOf("faceFront")).holdSeconds ?? null).toBeNull();
    expect(describeCalibration(measure(prepOf("standing"))).holdSeconds ?? null).toBeNull();
  });
});

describe("describeCalibration（体験者には「練習」として見せる）", () => {
  it("導入・終わりの文面は「練習」", () => {
    const intro = allStates(null).find((s) => s.phase === "intro");
    const outro = allStates(null).find((s) => s.phase === "outro");
    if (intro === undefined || outro === undefined) throw new Error("intro・outro が無い");
    const di = describeCalibration(intro);
    const doo = describeCalibration(outro);
    expect(`${di.title}${di.body}`).toContain("練習");
    expect(`${doo.title}${doo.body}`).toContain("練習");
  });

  it.each(["standing", "crouching", "crouchWalking", "stepping"])("%s の見出しは「練習」", (id) => {
    expect(describeCalibration(prepOf(id)).title).toContain("練習");
  });

  it("見え方の調整の後の文面に「キャリブレーション」「計測」を出さない", () => {
    for (const s of allStates(null).filter((x) => x.phase !== "align")) {
      const d = describeCalibration(s);
      const text = `${d.title}${d.body}${d.narration ?? ""}`;
      expect(text).not.toContain("キャリブレーション");
      expect(text).not.toContain("計測");
    }
  });
});

describe("describeCalibration（見え方の調整をボタンで終える．alignButton）", () => {
  const prompt = (patch: Partial<AlignButtonPrompt> = {}): AlignButtonPrompt => ({
    gazeEnabled: false,
    handPrompt: null,
    ...patch,
  });

  it("alignButton を渡すと残り秒数を出さず（制限時間なし），ボタンに人差し指の先を当てるよう案内する", () => {
    const s = startCalibration(null);
    const d = describeCalibration(s, DEFAULT_CALIBRATION_CONFIG, prompt());
    expect(d.remainingSeconds).toBeNull();
    expect(d.progressLabel).toBeNull();
    expect(d.body).toContain("ボタン");
    expect(d.body).toContain("人差し指の先を 1 秒当て");
    expect(d.body).not.toContain("手のひら");
    expect(d.narration).toContain("人差し指の先");
    expect(d.narration).toContain("当て");
    expect(d.narration).not.toContain("かざ");
    expect(d.key).not.toBe(describeCalibration(s).key);
    // 時間がたっても残り秒数は出ない
    expect(
      describeCalibration({ ...s, phaseElapsed: 30 }, DEFAULT_CALIBRATION_CONFIG, prompt())
        .remainingSeconds,
    ).toBeNull();
  });

  it("省略・null なら時間で進める案内（残り 15 秒）のまま", () => {
    const s = startCalibration(null);
    expect(describeCalibration(s).remainingSeconds).toBe(15);
    expect(describeCalibration(s, DEFAULT_CALIBRATION_CONFIG, null).remainingSeconds).toBe(15);
  });

  it("handPrompt があれば手を目の前に出すよう案内し，回ごとに key が変わる", () => {
    const s = startCalibration(null);
    const keys = [0, 1].map((i) => {
      const d = describeCalibration(s, DEFAULT_CALIBRATION_CONFIG, prompt({ handPrompt: i }));
      expect(d.body).toContain("手を目の前に出して");
      expect(d.narration).toContain("手を目の前に出して");
      expect(d.remainingSeconds).toBeNull();
      return d.key;
    });
    expect(new Set(keys).size).toBe(2);
    expect(keys).not.toContain(describeCalibration(s, DEFAULT_CALIBRATION_CONFIG, prompt()).key);
  });

  it("注視（debug）が有効なら Enter の案内を表示するが読み上げない", () => {
    const s = startCalibration(null);
    const on = describeCalibration(s, DEFAULT_CALIBRATION_CONFIG, prompt({ gazeEnabled: true }));
    expect(on.body).toContain("Enter");
    expect(on.narration).not.toContain("Enter");
    const off = describeCalibration(s, DEFAULT_CALIBRATION_CONFIG, prompt());
    expect(off.body).not.toContain("Enter");
  });

  it("見え方の調整の後（導入・手順・終わり）では alignButton を渡しても同じ案内", () => {
    for (const s of allStates(null).filter((x) => x.phase !== "align")) {
      expect(describeCalibration(s, DEFAULT_CALIBRATION_CONFIG, prompt())).toEqual(
        describeCalibration(s),
      );
    }
  });
});

describe("describeCalibration（見え方の調整の文は「丸」．Issue #174）", () => {
  const s = startCalibration(null);
  const cases: [string, AlignButtonPrompt | null][] = [
    ["時間で進む（auto）", null],
    ["ボタンで終える", { gazeEnabled: false, handPrompt: null }],
    ["ボタンで終える（debug の注視あり）", { gazeEnabled: true, handPrompt: null }],
    ["手が見つからない案内", { gazeEnabled: false, handPrompt: 0 }],
  ];

  it.each(cases)("%s: 表示・読み上げに「十字」が残っていない", (_label, prompt) => {
    const d = describeCalibration(s, DEFAULT_CALIBRATION_CONFIG, prompt);
    expect(d.title).not.toContain("十字");
    expect(d.body).not.toContain("十字");
    expect(d.narration ?? "").not.toContain("十字");
  });

  it.each(cases)("%s: 表示の文で印を「丸」と呼ぶ", (_label, prompt) => {
    const d = describeCalibration(s, DEFAULT_CALIBRATION_CONFIG, prompt);
    expect(d.body).toContain("丸");
  });

  it("時間で進む時は，表示・読み上げとも丸が 1 つに重なるよう案内する", () => {
    const d = describeCalibration(s);
    expect(d.body).toContain("丸が 1 つに重なって");
    expect(d.narration).toContain("丸が一つに重なって");
  });

  it("ボタンで終える時は，丸の下のボタンに人差し指の先を当てるよう表示し，読み上げも丸が重なるよう案内する", () => {
    const d = describeCalibration(s, DEFAULT_CALIBRATION_CONFIG, {
      gazeEnabled: false,
      handPrompt: null,
    });
    expect(d.body).toContain("丸が 1 つに重なって");
    expect(d.body).toContain("丸の下のボタン");
    expect(d.narration).toContain("丸が一つに重なって");
  });

  it("手が見つからない案内でも，丸の下のボタンを案内する", () => {
    const d = describeCalibration(s, DEFAULT_CALIBRATION_CONFIG, {
      gazeEnabled: false,
      handPrompt: 1,
    });
    expect(d.body).toContain("丸の下のボタン");
  });
});
