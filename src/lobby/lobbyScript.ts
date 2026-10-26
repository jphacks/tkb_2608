// ロビーで表示・読み上げる指示の文面（DOM・three.js に依存しない純粋な関数）

import {
  type CalibrationConfig,
  type CalibrationState,
  type CalibrationStepId,
  currentStepId,
  DEFAULT_CALIBRATION_CONFIG,
  remainingAlignSeconds,
  remainingHoldSeconds,
  remainingPrepSeconds,
  remainingStepSeconds,
} from "./calibration";

export interface LobbyInstruction {
  /** 読み上げの区切り．変わった時だけ narration を読み上げる */
  readonly key: string;
  readonly title: string;
  readonly body: string;
  /** 読み上げる文（無ければ読み上げない） */
  readonly narration: string | null;
  /** 「手順 1 / 4」等．手順の最中でなければ null */
  readonly progressLabel: string | null;
  /** 制限時間の残り（秒，切り上げ）．手順の最中でない・準備の間・正面の計測の間は null */
  readonly remainingSeconds: number | null;
  /**
   * 準備のカウントダウンの数字（3・2・1）．指示板の真ん中に大きく出す．
   * 準備の間（数え始めてから）だけ値があり，それ以外は省略か null
   */
  readonly countdown?: number | null;
  /**
   * 正面を保つ残り（秒，切り上げ．1 以上）．補足に「そのまま あと N 秒」と出す．
   * 正面の計測の間だけ値があり，それ以外は省略か null
   */
  readonly holdSeconds?: number | null;
}

/** 測る手順の文面（体験者には「練習」として見せる．実際はその間の動きを区間として記録する） */
interface StepText {
  readonly title: string;
  /** 準備の間の文（合図を待つ） */
  readonly prepBody: string;
  /** 計測の間の文 */
  readonly body: string;
  /** 準備（3・2・1）の前に読み上げる文 */
  readonly narration: string;
}

const STEP_TEXT: Readonly<Record<CalibrationStepId, StepText>> = {
  faceFront: {
    title: "正面を向いてください",
    prepBody: "体の正面を向いて，合図のあと 3 秒ほど動かないでください",
    body: "正面を向いたまま止まってください",
    narration: "体の正面を向いてください．合図のあと，そのまま動かないでください",
  },
  standing: {
    title: "練習: まっすぐ立つ",
    prepBody: "合図のあと，背すじを伸ばして，静かに立っていましょう",
    body: "背すじを伸ばして，静かに立っていましょう",
    narration:
      "まずは，まっすぐ立つ練習です．合図のあと，背すじを伸ばして，静かに立っていてください",
  },
  crouching: {
    title: "練習: しゃがむ",
    prepBody:
      "煙の中では低い姿勢になります．合図でその場にしゃがみ，しゃがんだまま止まっていましょう",
    body: "その場にしゃがみ，しゃがんだまま止まっていましょう",
    narration:
      "次は，しゃがむ練習です．煙の中では低い姿勢になります．合図でその場にしゃがんで，そのまま止まっていてください",
  },
  crouchWalking: {
    title: "練習: しゃがんだまま歩く",
    prepBody: "合図で，しゃがんだまま，その場で足踏みを続けましょう",
    body: "しゃがんだまま，その場で足踏みを続けましょう",
    narration:
      "次は，しゃがんだまま歩く練習です．合図で，しゃがんだまま，その場で足踏みをしてください",
  },
  stepping: {
    title: "練習: 歩く",
    prepBody: "合図で立ち上がって，その場で足踏みを続けましょう",
    body: "立ち上がって，その場で足踏みを続けましょう",
    narration: "最後は，歩く練習です．合図で立ち上がって，その場で足踏みをしてください",
  },
};

/**
 * 見え方の調整をボタンで終える時（開始ボタンを手で押す設定．startGate.ts の startMode: "hand"）の表示の材料．
 * 時間で進める時（startMode: "auto"）は渡さない
 */
export interface AlignButtonPrompt {
  /** デバッグ用の注視での押下が有効か（本実装は input/ の PlayerInput.hands の手） */
  readonly gazeEnabled: boolean;
  /** 手が見つからない案内の何回目か（handPrompt.ts の handPromptIndex．出さない時は null） */
  readonly handPrompt: number | null;
}

const ALIGN_TEXT =
  "画面の中の丸が 1 つに重なって，くっきり見えるように，スマホの位置やゴーグルのレンズの幅を合わせてください";
const ALIGN_NARRATION =
  "画面の中の丸が一つに重なって，くっきり見えるように，スマホの位置やゴーグルのレンズの幅を合わせてください";

/** 見え方の調整をボタンで終える時の指示（残り秒数は出さない．制限時間は無い） */
function describeAlignByButton(prompt: AlignButtonPrompt): LobbyInstruction {
  const debug = prompt.gazeEnabled
    ? "（デバッグ: ボタンを 3 秒見つめる，または Enter キーでも進みます）"
    : "";
  if (prompt.handPrompt !== null) {
    const text = "手を目の前に出して，カメラに映るようにしてください";
    return {
      key: `align:handPrompt:${prompt.handPrompt}`,
      title: "手が見つかりません",
      body: `${text}．丸がくっきり見えたら，丸の下のボタンに人差し指の先を 1 秒当ててください（指先のピンクの丸がボタンに重なるように）${debug}`,
      narration: `手が見つかりません．${text}`,
      progressLabel: null,
      remainingSeconds: null,
    };
  }
  return {
    key: "align:button",
    title: "見え方を合わせてください",
    body: `${ALIGN_TEXT}．くっきり見えたら，丸の下のボタンに人差し指の先を 1 秒当ててください（指先のピンクの丸がボタンに重なるように）${debug}`,
    narration: `${ALIGN_NARRATION}．くっきり見えたら，ボタンに人差し指の先を当ててください`,
    progressLabel: null,
    remainingSeconds: null,
  };
}

/**
 * 今の状態の指示を作る．alignButton を渡すと，見え方の調整を時間ではなくボタンで終える時の文にする
 */
export function describeCalibration(
  state: CalibrationState,
  config: CalibrationConfig = DEFAULT_CALIBRATION_CONFIG,
  alignButton: AlignButtonPrompt | null = null,
): LobbyInstruction {
  const stepId = currentStepId(state);
  const remaining = remainingStepSeconds(state, config);
  const remainingSeconds = remaining === null ? null : Math.ceil(remaining);
  const progressLabel =
    stepId === null ? null : `手順 ${state.stepIndex + 1} / ${state.plan.length}`;

  switch (state.phase) {
    case "align": {
      if (alignButton !== null) return describeAlignByButton(alignButton);
      const left = remainingAlignSeconds(state, config);
      return {
        key: "align",
        title: "見え方を合わせてください",
        body: ALIGN_TEXT,
        narration: ALIGN_NARRATION,
        progressLabel: null,
        remainingSeconds: left === null ? null : Math.ceil(left),
      };
    }
    case "intro": {
      const text = state.reused
        ? "同じ訓練をもう一度始めます．前回の練習を使い，正面の向きだけ合わせ直します"
        : "訓練の前に，体の動かし方を練習しましょう．指示と合図に合わせて体を動かしてください";
      return {
        key: "intro",
        title: state.reused ? "同じ訓練をもう一度" : "動きの練習",
        body: text,
        narration: text,
        progressLabel,
        remainingSeconds,
      };
    }
    case "outro":
    case "finished":
      return {
        key: "outro",
        title: "練習はおしまいです",
        body: "続いて，今日の訓練について説明します",
        narration: "練習はおしまいです．続いて，今日の訓練について説明します",
        progressLabel,
        remainingSeconds,
      };
    case "step":
      break;
  }

  // 準備と計測で key を変えない（準備の前に読んだ指示を計測に入る時に読み直さない）
  const key = `step:${state.stepIndex}:${stepId ?? ""}`;
  if (stepId === null) {
    return { key, title: "", body: "", narration: null, progressLabel, remainingSeconds };
  }
  const text = STEP_TEXT[stepId];
  const prep = remainingPrepSeconds(state, config);
  // 準備の数字（3・2・1）は，読み上げが終わって数え始めてから出す（読み上げの間は prepElapsed が 0 のまま）
  const countdown = prep !== null && state.prepElapsed > 0 ? Math.max(1, Math.ceil(prep)) : null;
  // 正面は 3 秒保てばその時点で終わるため，制限時間の残りではなく保持の残りを出す（制限時間による打ち切りは裏で残す）
  const hold = remainingHoldSeconds(state, config);
  return {
    key,
    title: text.title,
    body: prep === null ? text.body : text.prepBody,
    narration: text.narration,
    progressLabel: prep === null ? progressLabel : `${progressLabel ?? ""}　準備`,
    remainingSeconds: hold === null ? remainingSeconds : null,
    countdown,
    holdSeconds: hold === null ? null : Math.max(1, Math.ceil(hold)),
  };
}

/**
 * 開始ボタンを待っている間の指示（キャリブレーションを始める前）．
 * autoStartRemaining は自動開始までの残り秒数（startMode が "auto" の時．"hand" なら null）．
 * gazeEnabled はデバッグ用の注視での開始が有効な時（本実装は input/ の PlayerInput.hands の手）．
 * handPrompt は手が見つからない案内の何回目か（handPrompt.ts の handPromptIndex．出さない時は null）．
 * 回ごとに key を変えて読み上げを繰り返す
 */
export function describeStartGate(
  reused: boolean,
  autoStartRemaining: number | null,
  gazeEnabled: boolean,
  handPrompt: number | null = null,
): LobbyInstruction {
  // 「もう一度」は結果画面から同じ訓練を繰り返す時．ゴーグルを外して結果を見た後なので付け直してもらう
  const lead = reused ? "同じ訓練をもう一度始めます．" : "";
  const goggles = reused ? "ゴーグルを付け直して" : "ゴーグルを付けて";
  const debug = gazeEnabled
    ? "（デバッグ: ボタンを 3 秒見つめる，または Enter キーでも始まります）"
    : "";
  if (autoStartRemaining !== null) {
    const seconds = Math.ceil(autoStartRemaining);
    return {
      key: "startGate:auto",
      title: `${seconds} 秒後に始まります`,
      body: `${lead}${goggles}，正面を向いて待ってください${debug}`,
      narration: `${lead}${goggles}待ってください．${seconds}秒後に始まります`,
      progressLabel: null,
      remainingSeconds: null,
    };
  }
  if (handPrompt !== null) {
    const text = "手を目の前に出して，カメラに映るようにしてください";
    return {
      key: `startGate:handPrompt:${handPrompt}`,
      title: "手が見つかりません",
      body: `${text}．映ったら，目の前のボタンに人差し指の先を 1 秒当ててください（指先のピンクの丸がボタンに重なるように）${debug}`,
      narration: `手が見つかりません．${text}`,
      progressLabel: null,
      remainingSeconds: null,
    };
  }
  const prefix = reused
    ? `${lead}${goggles}，正面を向いてください．`
    : "ゴーグルを着けて，正面を向いてください．";
  return {
    key: "startGate:hand",
    title: "準備ができたら開始ボタンへ",
    body: `${prefix}準備ができたら，目の前のボタンに人差し指の先を 1 秒当ててください（指先のピンクの丸がボタンに重なるように）${debug}`,
    narration: `${prefix}準備ができたら，目の前のボタンに人差し指の先を当ててください`,
    progressLabel: null,
    remainingSeconds: null,
  };
}
