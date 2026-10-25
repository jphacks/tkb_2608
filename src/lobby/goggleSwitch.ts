// ゴーグルを付けて見る画面（ロビー・避難・結果）と外して見る画面（ホーム）の間の切り替えで出す案内の決まり
// （DOM・three.js に依存しない純粋な関数．docs/04_SPEC/SPEC_01「ゴーグルの付け外しの案内」）．
// 結果画面は VR の中で見る（Issue #146）ので，避難 → 結果・結果 → ロビーには案内を挟まない
// - 外す（takeOff）: 結果 → ホーム．VR の中の板と手で押すボタンで「押してからゴーグルを外して」と伝え，押したらホームへ
// - 付ける（putOn）: ホーム → ロビー（結果画面をスマホの画面に切り替えた後の結果 → ロビーも）．1 画面の HTML で「スマホをゴーグルにセットして」と伝えて読ませた後（read），
//   そのままロビーへ進む（ロビーの開始ボタンが装着の確認を兼ねる）．ロビーを飛ばして避難へ進む時（?app&demo）だけ，
//   左右 2 画面に切り替え，VR の中の手で押すボタンを押したら（confirm）進む（goggleOnNeedsConfirm）
// 手のボタンは時間では進まない（勝手に先へ進まないため．Issue #145）．ただし詰まらないよう，次の逃げ道を残す
// - カメラが使えない（手を認識できない）時は，以前の時間で進む方式にする
// - 手が handLostSeconds 続けて見つからない時は進む（手の認識が動いていない端末で止まらないため）
// - 外す案内は画面のタップでも進む（ゴーグルを外せば画面に触れるため）．どちらも Enter / Space でも進む（PC）

import type { SceneId } from "../core/scene";

/**
 * ゴーグルを付けて見る画面（左右 2 画面で描く）．結果画面は VR の中で見る（Issue #146．画面のタップでスマホの画面に
 * 切り替えた後は，goggleSwitchBetween の fromGoggles で外していると伝える）
 */
export const GOGGLE_SCENES: ReadonlySet<SceneId> = new Set<SceneId>([
  "lobby",
  "scenario",
  "debrief",
]);

/** 切り替えの案内の種類．takeOff = ゴーグルを外す，putOn = スマホをゴーグルにセットする */
export type GoggleSwitch = "takeOff" | "putOn";

/**
 * 画面の切り替えで出す案内．from は今の画面（まだ何も出していなければ null）．
 * 許可の画面（start）からは直接ロビーへ進まないため，start は案内の対象にしない．
 * fromGoggles は今の画面を左右 2 画面で見ているか（省くと GOGGLE_SCENES で決める．結果画面をスマホの画面に
 * 切り替えた後のように，同じ画面の中で変わる時に渡す）
 */
export function goggleSwitchBetween(
  from: SceneId | null,
  to: SceneId,
  fromGoggles: boolean = from !== null && GOGGLE_SCENES.has(from),
): GoggleSwitch | null {
  if (from === null || from === "start" || to === "start") return null;
  const toGoggles = GOGGLE_SCENES.has(to);
  if (fromGoggles && !toGoggles) return "takeOff";
  if (!fromGoggles && toGoggles) return "putOn";
  return null;
}

/**
 * 付ける案内の 1 画面の HTML（read）の後に，左右 2 画面の手のボタン（confirm）で装着を確かめるか．next は案内の後に進む画面．
 * ロビーは開始ボタンを手で押して始まり，それが装着の確認を兼ねるので出さない（「準備OK」と開始ボタンの二度押しを避ける）．
 * ロビーを飛ばす時（デモ用の起動で直接避難へ進む等）だけ出す
 */
export function goggleOnNeedsConfirm(next: SceneId): boolean {
  return next !== "lobby";
}

export interface GoggleSwitchConfig {
  /** 手が使えない時，外す案内を出しておく最短の秒数（s）．読み上げが早く終わっても，板を読む時間を取る */
  readonly takeOffMinSeconds: number;
  /** 手が使えない時，外す案内の読み上げの終わりが届かなくても，これを過ぎたら結果画面へ進む秒数（s） */
  readonly takeOffMaxSeconds: number;
  /**
   * 外す案内の手のボタンを押せるようにするまでの秒数（s）．避難の最後に上げていた手ですぐ押されないよう，
   * また板を読み始める間を取る
   */
  readonly takeOffArmSeconds: number;
  /**
   * 付ける案内の 1 画面の HTML（read）を出しておく秒数（s）．案内を読んでからゴーグルに入れる時間．
   * ロビーへ進む時は，これが過ぎたらロビーへ進む（その後のゴーグルに入れる時間はロビーの開始ボタンで取る）
   */
  readonly putOnSeconds: number;
  /** 付ける案内の左右 2 画面（confirm）で，手のボタンを押せるようにするまでの秒数（s）．ゴーグルに入れる間に押されないため */
  readonly putOnArmSeconds: number;
  /** 手が使えない時，付ける案内の左右 2 画面（confirm）を出しておく秒数（s）．ゴーグルを着けて前を向く時間 */
  readonly putOnConfirmSeconds: number;
  /** 手のボタンを待つ間，手がこの秒数（s）続けて見つからなければ「手を出して」と案内する */
  readonly handPromptSeconds: number;
  /** 手のボタンを待つ間，手がこの秒数（s）続けて見つからなければ進む（手の認識が動かない端末で止まらないため） */
  readonly handLostSeconds: number;
}

export const DEFAULT_GOGGLE_SWITCH_CONFIG: GoggleSwitchConfig = {
  takeOffMinSeconds: 5,
  takeOffMaxSeconds: 12,
  takeOffArmSeconds: 2,
  putOnSeconds: 6,
  putOnArmSeconds: 2,
  putOnConfirmSeconds: 6,
  handPromptSeconds: 10,
  handLostSeconds: 30,
};

/** 案内を出してからの秒数を進める（dt は s）．paused の間は数えない */
export function advanceGoggleSwitchElapsed(elapsed: number, dt: number, paused: boolean): number {
  if (paused || !Number.isFinite(dt) || dt <= 0) return elapsed;
  return elapsed + dt;
}

/** 手が続けて見つからない秒数を進める（dt は s）．手を 1 つでも認識したら 0 に戻す */
export function advanceNoHandSeconds(noHand: number, dt: number, anyHandTracked: boolean): number {
  if (anyHandTracked) return 0;
  if (!Number.isFinite(dt) || dt <= 0) return noHand;
  return noHand + dt;
}

/** 手が見つからないので「手を出して」と案内するか */
export function shouldPromptHand(
  noHand: number,
  config: GoggleSwitchConfig = DEFAULT_GOGGLE_SWITCH_CONFIG,
): boolean {
  return Number.isFinite(noHand) && noHand >= config.handPromptSeconds;
}

/** 手が長く見つからないので，手のボタンを待たずに進むか */
export function isHandLost(
  noHand: number,
  config: GoggleSwitchConfig = DEFAULT_GOGGLE_SWITCH_CONFIG,
): boolean {
  return Number.isFinite(noHand) && noHand >= config.handLostSeconds;
}

/** 手が使えない時に，外す案内を終えて結果画面へ進んでよいか（最短の秒数が過ぎ，読み上げが終わったか上限の秒数を過ぎた） */
export function isGoggleOffDone(
  elapsed: number,
  narrationEnded: boolean,
  config: GoggleSwitchConfig = DEFAULT_GOGGLE_SWITCH_CONFIG,
): boolean {
  if (!Number.isFinite(elapsed)) return false;
  if (elapsed < config.takeOffMinSeconds) return false;
  return narrationEnded || elapsed >= config.takeOffMaxSeconds;
}

/** 残りの秒数（切り上げ．0 以上）．total は出しておく秒数（s） */
export function remainingSeconds(elapsed: number, total: number): number {
  const e = Number.isFinite(elapsed) ? elapsed : 0;
  return Math.max(0, Math.ceil(total - e));
}

/** 付ける案内の 1 画面の HTML（read）の残りの秒数 */
export function goggleOnRemainingSeconds(
  elapsed: number,
  config: GoggleSwitchConfig = DEFAULT_GOGGLE_SWITCH_CONFIG,
): number {
  return remainingSeconds(elapsed, config.putOnSeconds);
}

/** 付ける案内の 1 画面の HTML（read）を終えて，左右 2 画面（confirm）またはロビーへ進んでよいか */
export function isGoggleOnReadDone(
  elapsed: number,
  config: GoggleSwitchConfig = DEFAULT_GOGGLE_SWITCH_CONFIG,
): boolean {
  return Number.isFinite(elapsed) && elapsed >= config.putOnSeconds;
}

/** 手が使えない時に，付ける案内の左右 2 画面（confirm）を終えて次の画面へ進んでよいか */
export function isGoggleOnConfirmTimeUp(
  elapsed: number,
  config: GoggleSwitchConfig = DEFAULT_GOGGLE_SWITCH_CONFIG,
): boolean {
  return Number.isFinite(elapsed) && elapsed >= config.putOnConfirmSeconds;
}

/** VR の中の板の内容（lobbyRoom.ts の PanelContent と同じ形） */
export interface GoggleGuidePanel {
  readonly title: string;
  readonly body: string;
  readonly caption: string;
}

/** 手が見つからない時に板の補足に出す案内（ロビーの開始ボタンの案内 handPrompt.ts と同じ趣旨） */
export const GOGGLE_HAND_PROMPT = "手を目の前に出して，カメラに映るようにしてください";

/** 外す案内の手のボタンの文字（結果画面へ進む時．今の流れでは結果画面は VR の中で見るので使わない） */
export const GOGGLE_OFF_BUTTON_LABEL = "結果を見る";

/** 結果画面からホームへ進む時の，外す案内の手のボタンの文字 */
export const GOGGLE_OFF_HOME_BUTTON_LABEL = "OK";

/** 外す案内の手のボタンの文字．next は案内の後に進む画面 */
export function goggleOffButtonLabel(next: SceneId): string {
  return next === "home" ? GOGGLE_OFF_HOME_BUTTON_LABEL : GOGGLE_OFF_BUTTON_LABEL;
}

/**
 * 外す案内でナレーション goggles-off（「スマホの画面で結果を見てください」）を流すか．
 * ホームへ進む時は文が合わないので流さない（その時は読み上げの終わりを待たない）
 */
export function goggleOffNarrates(next: SceneId): boolean {
  return next !== "home";
}

/**
 * VR の中の板に出す，ゴーグルを外す案内．handsUsable は手のボタンで進むか（false なら時間で進む），
 * handPrompt は手が見つからない時の案内を出すか，next は案内の後に進む画面（ホームなら「ホームに戻ります」の文）
 */
export function goggleOffPanel(
  handsUsable: boolean,
  handPrompt = false,
  next: SceneId = "debrief",
): GoggleGuidePanel {
  if (next === "home") {
    const title = "ホームに戻ります";
    if (!handsUsable) {
      return {
        title,
        body: "ゴーグルを外して，スマホの画面を見てください．ホームが表示されます",
        caption: "まもなくホームに切り替わります",
      };
    }
    return {
      title,
      body: "目の前のボタンに人差し指の先を当ててから，ゴーグルを外してスマホの画面を見てください",
      caption: handPrompt ? GOGGLE_HAND_PROMPT : "ゴーグルを外して画面をタップしても進みます",
    };
  }
  if (!handsUsable) {
    return {
      title: "訓練が終わりました",
      body: "ゴーグルを外して，スマホの画面を見てください．結果が表示されます",
      caption: "まもなく結果画面に切り替わります",
    };
  }
  return {
    title: "訓練が終わりました",
    body: "目の前のボタンに人差し指の先を当ててから，ゴーグルを外してスマホの画面を見てください",
    caption: handPrompt ? GOGGLE_HAND_PROMPT : "ゴーグルを外して画面をタップしても進みます",
  };
}

/** 付ける案内の見出し */
export const GOGGLE_ON_TITLE = "スマホをゴーグルにセットしてください";

/** 付ける案内の左右 2 画面（confirm．ロビーを飛ばす時だけ）の手のボタンの文字 */
export const GOGGLE_ON_BUTTON_LABEL = "準備OK";

/**
 * 付ける案内の 1 画面の HTML（read）の箇条書き．handsUsable は左右 2 画面になった後に手のボタンで進むか
 * （false なら時間で進む）．demo はデモ用の起動（?app&demo．ロビーを通らず避難が始まる．このときだけ「準備OK」の
 * ボタン（confirm）を出す）か．demo でない時に押すのはロビーの開始ボタン
 */
export function goggleOnGuideLines(handsUsable: boolean, demo = false): readonly string[] {
  const then = demo ? "非常ベルが鳴って避難訓練が始まります" : "訓練の準備が始まります";
  const button = demo ? "目の前のボタン" : "目の前の開始ボタン";
  const last = handsUsable
    ? `ゴーグルを着けたら，まっすぐ前を向いて，${button}に人差し指の先を当てると${then}`
    : `ゴーグルを着けたら，まっすぐ前を向いて待つと${then}`;
  return [
    "スマホは横向きのまま，画面をゴーグルの奥に向けて入れてください",
    "画面が左右 2 つに切り替わります．このあとは画面に触らずに進みます",
    demo ? `${last}．その向きが正面になります` : last,
  ];
}

/** 付ける案内の 1 画面の HTML（read）の残り秒数の表示 */
export function goggleOnCaption(remaining: number): string {
  return `${remaining} 秒後にゴーグルの画面に切り替わります（画面をタップするとすぐ切り替わります）`;
}

/**
 * 付ける案内の左右 2 画面（confirm）の板．handsUsable が false の時は残り秒数（remaining，s）を出す．
 * handPrompt は手が見つからない時の案内を出すか
 */
export function goggleOnConfirmPanel(
  handsUsable: boolean,
  remaining: number,
  demo = false,
  handPrompt = false,
): GoggleGuidePanel {
  const then = demo ? "避難訓練が始まります" : "訓練の準備に進みます";
  const title = "ゴーグルを着けて，まっすぐ前を向いてください";
  if (!handsUsable) {
    const left = Number.isFinite(remaining) ? Math.max(0, Math.ceil(remaining)) : 0;
    return { title, body: `そのまま待つと${then}`, caption: `あと ${left} 秒` };
  }
  return {
    title,
    body: `準備ができたら，目の前のボタンに人差し指の先を当ててください．${then}`,
    caption: handPrompt ? GOGGLE_HAND_PROMPT : "",
  };
}
