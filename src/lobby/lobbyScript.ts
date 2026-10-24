// ロビーで表示・読み上げる指示の文面（DOM・three.js に依存しない純粋な関数）

import {
  type CalibrationConfig,
  type CalibrationState,
  countSteps,
  currentStepId,
  DEFAULT_CALIBRATION_CONFIG,
  remainingAlignSeconds,
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
  /** 制限時間の残り（秒，切り上げ）．手順の最中でなければ null */
  readonly remainingSeconds: number | null;
}

/** 今の状態の指示を作る */
export function describeCalibration(
  state: CalibrationState,
  config: CalibrationConfig = DEFAULT_CALIBRATION_CONFIG,
): LobbyInstruction {
  const stepId = currentStepId(state);
  const remaining = remainingStepSeconds(state, config);
  const remainingSeconds = remaining === null ? null : Math.ceil(remaining);
  const progressLabel =
    stepId === null ? null : `手順 ${state.stepIndex + 1} / ${state.plan.length}`;

  switch (state.phase) {
    case "align": {
      const left = remainingAlignSeconds(state, config);
      return {
        key: "align",
        title: "見え方を合わせてください",
        body:
          "画面の中の十字が 1 つに重なって，くっきり見えるように，" +
          "スマホの位置やゴーグルのレンズの幅を合わせてください",
        narration:
          "画面の中の十字が一つに重なって，くっきり見えるように，スマホの位置やゴーグルのレンズの幅を合わせてください",
        progressLabel: null,
        remainingSeconds: left === null ? null : Math.ceil(left),
      };
    }
    case "intro": {
      const text = state.reused
        ? "同じ訓練をもう一度始めます．前回の調整を使い，正面の向きだけ合わせ直します"
        : "これから体の動きの調整をします．指示に合わせて体を動かしてください";
      return {
        key: "intro",
        title: state.reused ? "同じ訓練をもう一度" : "体験の準備",
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
        title: "準備ができました",
        body: "まもなく体験が始まります",
        narration: "準備ができました．まもなく体験が始まります",
        progressLabel,
        remainingSeconds,
      };
    case "step":
      break;
  }

  const key = `step:${state.stepIndex}:${stepId ?? ""}`;
  switch (stepId) {
    case "faceFront":
      return {
        key,
        title: "正面を向いてください",
        body: "体の正面を向いて，そのまま 3 秒ほど動かないでください",
        narration: "体の正面を向いて，そのまま動かないでください",
        progressLabel,
        remainingSeconds,
      };
    case "standing":
      return {
        key,
        title: "まっすぐ立ってください",
        body: "背すじを伸ばして，3 秒ほど静かに立っていてください",
        narration: "背すじを伸ばして，静かに立っていてください",
        progressLabel,
        remainingSeconds,
      };
    case "crouching":
      return {
        key,
        title: "しゃがんでください",
        body: "その場でしゃがみ，しゃがんだまま止まってください",
        narration: "その場でしゃがんで，そのまま止まってください",
        progressLabel,
        remainingSeconds,
      };
    case "crouchWalking": {
      const required = config.crouchWalking.requiredSteps;
      const counted = Math.min(countSteps(state, config), required);
      return {
        key,
        title: "しゃがんだまま足踏みをしてください",
        body: `しゃがんだまま，その場で足踏みを ${required} 歩ほどしてください（${counted} 歩）`,
        narration: "しゃがんだまま，その場で足踏みをしてください",
        progressLabel,
        remainingSeconds,
      };
    }
    case "stepping": {
      const counted = Math.min(countSteps(state, config), config.stepping.requiredSteps);
      return {
        key,
        title: "足踏みをしてください",
        body: `立ち上がって，その場で足踏みを ${config.stepping.requiredSteps} 歩ほどしてください（${counted} 歩）`,
        narration: "立ち上がって，その場で足踏みをしてください",
        progressLabel,
        remainingSeconds,
      };
    }
    case null:
      return {
        key,
        title: "",
        body: "",
        narration: null,
        progressLabel,
        remainingSeconds,
      };
  }
}

/**
 * 開始ボタンを待っている間の指示（キャリブレーションを始める前）．
 * autoStartRemaining は自動開始までの残り秒数（startMode が "auto" の時．"hand" なら null）．
 * gazeEnabled はデバッグ用の注視での開始が有効な時（本実装は input/ の PlayerInput.hands の手）
 */
export function describeStartGate(
  reused: boolean,
  autoStartRemaining: number | null,
  gazeEnabled: boolean,
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
  const prefix = reused
    ? `${lead}${goggles}，正面を向いてください．`
    : "ゴーグルを着けて，正面を向いてください．";
  return {
    key: "startGate:hand",
    title: "準備ができたら開始ボタンへ",
    body: `${prefix}準備ができたら，目の前のボタンに手をかざしてください${debug}`,
    narration: `${prefix}準備ができたら，目の前のボタンに手をかざしてください`,
    progressLabel: null,
    remainingSeconds: null,
  };
}
