// VR の中の結果画面（debriefVrScene.ts）の板の配置・文字の大きさ・手のボタンの行き先の決まり（DOM・three.js に依存しない純粋な関数）．
// 板は目の高さの正面 2 m（ロビーの指示板と同じ距離）に置き，頭の向きに緩く追いつかせる．手のボタンは板の手前 0.5 m に 2 つ並べる
// （docs/04_SPEC/SPEC_01「結果画面（VR）」）

import type { SceneId } from "../core/scene";
import type { Vec3 } from "../core/types";

/** 板の大きさと置き場所（m）．pivot（目の位置．頭のヨー角に追従する）から見た位置 */
export const DEBRIEF_BOARD = {
  /** 板の幅（m） */
  width: 1.9,
  /** 板の高さ（m） */
  height: 1.0,
  /** 目からの距離（m．ロビーの指示板と同じ） */
  distance: 2,
  /** 板の中心の，目の高さからの高さ（m）．下の端が手のボタン（目の高さより少し下）に重ならないよう上げる */
  raise: 0.58,
} as const;

/** 板に貼る canvas の大きさ（px）．板の縦横比と同じにする（1 m あたり 800 px） */
export const DEBRIEF_CANVAS = { width: 1520, height: 800 } as const;

/** 文字の枠（canvas の px） */
export interface BoardBox {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

/** 文字の枠と大きさの範囲（px） */
export interface BoardTextSlot {
  readonly box: BoardBox;
  readonly maxFontPx: number;
  readonly minFontPx: number;
  /** 行の数の上限 */
  readonly maxLines: number;
}

const PAD = 32;
const MAP_WIDTH = 820;
const SIDE_X = PAD + MAP_WIDTH + 28;
const SIDE_WIDTH = DEBRIEF_CANVAS.width - SIDE_X - PAD;
const MAIN_TOP = 150;
const MAIN_BOTTOM = DEBRIEF_CANVAS.height - PAD;

/**
 * 板の中の配置（canvas の px）．左に地図，右に評価を並べる．
 * 文字の下限は左右 2 画面で読める大きさ（視角 1° 以上．debriefTextAngleDeg）にする
 */
export const DEBRIEF_BOARD_LAYOUT = {
  /** 見出し（校舎の名前と「避難の結果」．1 行） */
  title: {
    box: { x: PAD, y: 20, width: DEBRIEF_CANVAS.width - PAD * 2, height: 64 },
    maxFontPx: 56,
    minFontPx: 40,
    maxLines: 1,
  },
  /** 見出しの下の一言（緑の線が正解経路であること等．1 行） */
  reveal: {
    box: { x: PAD, y: 92, width: DEBRIEF_CANVAS.width - PAD * 2, height: 44 },
    maxFontPx: 34,
    minFontPx: 30,
    maxLines: 1,
  },
  /** 地図（凡例の 1 行を下に含む） */
  map: { x: PAD, y: MAIN_TOP, width: MAP_WIDTH, height: MAIN_BOTTOM - MAIN_TOP - 48 },
  /** 地図の下の凡例（主なものだけ．1 行） */
  legend: {
    box: { x: PAD, y: MAIN_BOTTOM - 40, width: MAP_WIDTH, height: 40 },
    maxFontPx: 30,
    minFontPx: 28,
    maxLines: 1,
  },
  /** 記録が無い時に地図と評価の代わりに出す文 */
  message: {
    box: { x: PAD, y: MAIN_TOP, width: DEBRIEF_CANVAS.width - PAD * 2, height: 200 },
    maxFontPx: 44,
    minFontPx: 34,
    maxLines: 3,
  },
  /** 右の評価の欄 */
  side: { x: SIDE_X, y: MAIN_TOP, width: SIDE_WIDTH, height: MAIN_BOTTOM - MAIN_TOP },
  /** 評価の欄の下に出す補足（手が見つからない時の案内等．2 行まで） */
  caption: {
    box: { x: SIDE_X, y: MAIN_BOTTOM - 84, width: SIDE_WIDTH, height: 84 },
    maxFontPx: 30,
    minFontPx: 28,
    maxLines: 2,
  },
} as const;

/** 評価の 1 項目の描き方．large は値を大きく出して補足も付ける，small は「項目名　値」の 1 行だけ */
export type StatRowSize = "large" | "small";

/** 評価の 1 項目の枠（canvas の px） */
export interface StatRowLayout {
  readonly size: StatRowSize;
  /** 項目名 */
  readonly label: BoardTextSlot;
  /** 値（small では項目名と同じ行の右寄せ） */
  readonly value: BoardTextSlot;
  /** 補足（small では null） */
  readonly note: BoardTextSlot | null;
}

/** 大きく出す項目の数（避難時間・煙の中の姿勢．Issue #146 で板に出すと決めたもの） */
export const DEBRIEF_LARGE_STATS = 2;

const LARGE_ROW_HEIGHT = 184;
const SMALL_ROW_HEIGHT = 52;
const ROW_GAP = 12;

/**
 * 評価の項目を右の欄に上から並べた枠．先頭の DEBRIEF_LARGE_STATS 個を大きく，残りを 1 行で出す．
 * 欄（補足の分を除く）に収まらない項目は省く（count が負・有限でない時は 0 個）
 */
export function statRowLayouts(count: number): StatRowLayout[] {
  const n = Number.isFinite(count) && count > 0 ? Math.floor(count) : 0;
  const { side, caption } = DEBRIEF_BOARD_LAYOUT;
  const bottom = caption.box.y - ROW_GAP;
  const rows: StatRowLayout[] = [];
  let y = side.y;
  for (let i = 0; i < n; i++) {
    const size: StatRowSize = i < DEBRIEF_LARGE_STATS ? "large" : "small";
    const height = size === "large" ? LARGE_ROW_HEIGHT : SMALL_ROW_HEIGHT;
    if (y + height > bottom) break;
    rows.push(statRow(size, side.x, y, side.width));
    y += height + ROW_GAP;
  }
  return rows;
}

function statRow(size: StatRowSize, x: number, y: number, width: number): StatRowLayout {
  if (size === "small") {
    const labelWidth = Math.round(width * 0.68);
    return {
      size,
      label: {
        box: { x, y, width: labelWidth, height: SMALL_ROW_HEIGHT },
        maxFontPx: 34,
        minFontPx: 30,
        maxLines: 1,
      },
      value: {
        box: { x: x + labelWidth, y, width: width - labelWidth, height: SMALL_ROW_HEIGHT },
        maxFontPx: 40,
        minFontPx: 34,
        maxLines: 1,
      },
      note: null,
    };
  }
  return {
    size,
    label: { box: { x, y, width, height: 40 }, maxFontPx: 34, minFontPx: 30, maxLines: 1 },
    value: { box: { x, y: y + 40, width, height: 68 }, maxFontPx: 60, minFontPx: 44, maxLines: 1 },
    note: {
      box: { x, y: y + 112, width, height: LARGE_ROW_HEIGHT - 112 },
      maxFontPx: 32,
      minFontPx: 28,
      maxLines: 2,
    },
  };
}

/**
 * 板の canvas の文字の大きさ fontPx（px）が，目から見てどれだけの角度（度）になるか．
 * 左右 2 画面で読めるかの目安に使う（ロビーの指示板の本文の下限 26 px は約 1.2°）
 */
export function debriefTextAngleDeg(fontPx: number): number {
  if (!Number.isFinite(fontPx) || fontPx <= 0) return 0;
  const meters = (fontPx / DEBRIEF_CANVAS.width) * DEBRIEF_BOARD.width;
  return (2 * Math.atan(meters / 2 / DEBRIEF_BOARD.distance) * 180) / Math.PI;
}

/** 結果画面の手のボタンで選べる操作．retry = 同じ訓練をもう一度，home = ホームへ */
export type DebriefAction = "retry" | "home";

/** 手のボタンの置き場所と文字 */
export interface DebriefButtonSpec {
  readonly action: DebriefAction;
  /** ボタンの中心（pivot の座標，m） */
  readonly position: Vec3;
}

/**
 * 手のボタンの左右のずれ（m）．2 つのボタンの判定の範囲（半径 0.12 m）と文字の板（幅 0.3 m）が重ならない間隔にする
 * （正面 0.5 m で左右に約 18°．背面カメラの画角の内側）
 */
export const DEBRIEF_BUTTON_SPREAD = 0.17;

/** 手のボタンの高さ（m．目の高さから）．板の下の端より下に出して，板の文字を隠さないため */
export const DEBRIEF_BUTTON_Y = -0.1;

/** 手のボタンの目からの距離（m．ロビーの開始ボタン・付け外しの案内のボタンと同じ） */
export const DEBRIEF_BUTTON_DISTANCE = 0.5;

/** 左に「同じ訓練をもう一度」，右に「ホームへ」（HTML の結果画面のボタンと同じ並び） */
export const DEBRIEF_BUTTONS: readonly DebriefButtonSpec[] = [
  {
    action: "retry",
    position: { x: -DEBRIEF_BUTTON_SPREAD, y: DEBRIEF_BUTTON_Y, z: -DEBRIEF_BUTTON_DISTANCE },
  },
  {
    action: "home",
    position: { x: DEBRIEF_BUTTON_SPREAD, y: DEBRIEF_BUTTON_Y, z: -DEBRIEF_BUTTON_DISTANCE },
  },
];

/**
 * 操作の行き先．「同じ訓練をもう一度」はロビー（ゴーグルを付けたままなので付ける案内は挟まない），
 * 「ホームへ」はホーム（app/ が外す案内を挟む．goggleSwitchBetween）
 */
export function debriefActionTarget(action: DebriefAction): SceneId {
  return action === "retry" ? "lobby" : "home";
}

/**
 * キーで選ぶ操作（PC・カメラが使えない時の逃げ道）．Enter / Space で「同じ訓練をもう一度」，Escape で「ホームへ」．
 * それ以外は null
 */
export function debriefActionForKey(key: string): DebriefAction | null {
  if (key === "Enter" || key === " ") return "retry";
  if (key === "Escape") return "home";
  return null;
}

/** 結果画面の手のボタンの決まりの値 */
export interface DebriefVrConfig {
  /** 手のボタンを押せるようにするまでの秒数（s）．避難の最後に上げていた手ですぐ押さないため，また結果を読み始める間を取る */
  readonly armSeconds: number;
  /** 手がこの秒数（s）続けて見つからなければ「手を出して」と案内する（付け外しの案内と同じ） */
  readonly handPromptSeconds: number;
}

export const DEFAULT_DEBRIEF_VR_CONFIG: DebriefVrConfig = {
  armSeconds: 3,
  handPromptSeconds: 10,
};

/** 手が続けて見つからない秒数を進める（dt は s）．手を 1 つでも認識したら 0 に戻す */
export function advanceDebriefNoHand(noHand: number, dt: number, anyHandTracked: boolean): number {
  if (anyHandTracked) return 0;
  if (!Number.isFinite(dt) || dt <= 0) return noHand;
  return noHand + dt;
}

/** 手が見つからない時の案内（付け外しの案内・ロビーの開始ボタンと同じ文） */
export const DEBRIEF_HAND_PROMPT = "手を目の前に出して，カメラに映るようにしてください";

/**
 * 評価の欄の下に出す補足．handsUsable は手のボタンを出しているか，handPrompt は手が見つからない時の案内を出すか，
 * allowTap は画面のタップでスマホの画面の結果に切り替えられるか（実機だけ）
 */
export function debriefVrCaption(
  handsUsable: boolean,
  handPrompt: boolean,
  allowTap: boolean,
): string {
  const tap = allowTap ? "ゴーグルを外して画面をタップすると，スマホの画面で選べます" : "";
  if (!handsUsable) {
    return tap !== "" ? tap : "Enter でもう一度，Esc でホームへ進みます";
  }
  if (handPrompt) return DEBRIEF_HAND_PROMPT;
  return tap !== ""
    ? `下のボタンに人差し指の先を当てて選びます（指先のピンクの丸をボタンに重ねる）．${tap}`
    : "下のボタンに人差し指の先を当てて選びます（指先のピンクの丸をボタンに重ねる）";
}

/** 地図の下に出す凡例（板では主なものだけを文字で出す．全部は HTML の結果画面にある） */
export const DEBRIEF_VR_LEGEND = "緑: 正解経路　青: 自分の経路　橙: 外れた所";

/** 板が頭の向きに追いつく速さ（1/秒．ロビーの指示板と同じ） */
export const DEBRIEF_FOLLOW_RATE = 1.2;

/** 角度を -π〜π に収める */
function wrapAngle(a: number): number {
  const r = (a + Math.PI) % (Math.PI * 2);
  return (r < 0 ? r + Math.PI * 2 : r) - Math.PI;
}

/**
 * 板のヨー角（rad）を頭のヨー角 target に緩く近づける（dt は s）．近い向きの側から回る．
 * 値が有限でない時は今の向きのまま
 */
export function followYaw(
  current: number,
  target: number,
  dt: number,
  rate: number = DEBRIEF_FOLLOW_RATE,
): number {
  if (!Number.isFinite(current)) return Number.isFinite(target) ? target : 0;
  if (!Number.isFinite(target) || !Number.isFinite(dt) || dt <= 0) return current;
  const k = Math.min(1, dt * Math.max(0, rate));
  return current + wrapAngle(target - current) * k;
}
