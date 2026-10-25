// 読み上げに合わせてロビーの段階を進める判定（DOM・three.js に依存しない純粋な関数）．
// 時間で進む段階（見え方の調整・導入・終わり・訓練の説明）は，最短の時間（設定の秒数）が過ぎ，
// かつ読み上げが終わったら進む．読み上げが使えない・end が来ない時に詰まらないよう，
// 文字数から見積もった時間に余裕を足した上限で必ず進む．
// 測る手順（正面・立つ・しゃがむ・しゃがみ歩き・足踏み）は，読み上げが終わってから準備（3・2・1）を数え始め，
// その後に計測と制限時間を始める（指示を聞き終わる前に始まらないため．読み上げと準備の間のセンサーの値は捨てる）

import type { CalibrationConfig, CalibrationState } from "./calibration";

export interface NarrationPacingConfig {
  /**
   * 読み上げの速さの見積もり（1 秒あたりの文字数．日本語でおよそ 6〜8．rate 1.05 の時に測った値．
   * narrator.ts の rate 1.0 では 5% ほど遅くなるが，上限には marginSeconds の余裕があるため変えない）
   */
  readonly charsPerSecond: number;
  /** 上限の時間に足す余裕（s） */
  readonly marginSeconds: number;
}

export const DEFAULT_NARRATION_PACING_CONFIG: NarrationPacingConfig = {
  charsPerSecond: 7,
  marginSeconds: 4,
};

/** 読み上げにかかる秒数の見積もり（s）．空白は数えない（句読点は間が空くため数える） */
export function estimateNarrationSeconds(
  text: string | null,
  config: NarrationPacingConfig = DEFAULT_NARRATION_PACING_CONFIG,
): number {
  if (text === null) return 0;
  const cps =
    Number.isFinite(config.charsPerSecond) && config.charsPerSecond > 0
      ? config.charsPerSecond
      : DEFAULT_NARRATION_PACING_CONFIG.charsPerSecond;
  let count = 0;
  for (const ch of text) if (ch.trim() !== "") count++;
  return count / cps;
}

/** 今の読み上げの進み具合 */
export interface NarrationTrack {
  /** 読み上げの番号（end の知らせが今の読み上げのものかを見分ける） */
  readonly id: number;
  /** 読み上げを始めてからの秒数（止めている間は数えない） */
  readonly elapsed: number;
  /** 読み上げが終わった（end・error が来た，または読み上げなかった） */
  readonly ended: boolean;
  /** これを過ぎたら終わったとみなす秒数（s） */
  readonly capSeconds: number;
}

/** 読み上げの無い（終わった）状態 */
export const SILENT_NARRATION: NarrationTrack = { id: 0, elapsed: 0, ended: true, capSeconds: 0 };

/**
 * 読み上げを始めた時の状態．text が null・spoken が false（読み上げを始められなかった）の時は終わった扱い
 */
export function startNarrationTrack(
  id: number,
  text: string | null,
  spoken: boolean,
  config: NarrationPacingConfig = DEFAULT_NARRATION_PACING_CONFIG,
): NarrationTrack {
  const margin =
    Number.isFinite(config.marginSeconds) && config.marginSeconds >= 0 ? config.marginSeconds : 0;
  return {
    id,
    elapsed: 0,
    ended: text === null || !spoken,
    capSeconds: estimateNarrationSeconds(text, config) + margin,
  };
}

/** 時間を進める（dt は s） */
export function advanceNarrationTrack(track: NarrationTrack, dt: number): NarrationTrack {
  const step = Number.isFinite(dt) && dt > 0 ? dt : 0;
  return step === 0 ? track : { ...track, elapsed: track.elapsed + step };
}

/** 読み上げの end・error を受け取った．id が今の読み上げでなければ（前の読み上げの知らせなら）変えない */
export function markNarrationEnded(track: NarrationTrack, id: number): NarrationTrack {
  return track.id !== id || track.ended ? track : { ...track, ended: true };
}

/** 読み上げが済んだとみなせるか（終わった，または上限の時間を過ぎた） */
export function isNarrationSettled(track: NarrationTrack): boolean {
  return track.ended || track.elapsed >= track.capSeconds;
}

/** 時間で進む段階を次へ進めてよいか（最短の時間が過ぎ，読み上げが済んだ） */
export function canAdvanceTimedPhase(
  elapsed: number,
  minSeconds: number,
  narrationSettled: boolean,
): boolean {
  return elapsed >= minSeconds && narrationSettled;
}

/**
 * キャリブレーションを進める時に渡す dt（s）．読み上げが済んでいなければ，
 * 時間で進む段階（align・intro・outro）は最短の時間の手前で止め，測る手順（step）は準備も制限時間も数えない（0）．
 * calibration.ts の状態機械は変えず，渡す時間だけで読み上げを待つ
 */
export function pacedCalibrationDt(
  state: CalibrationState,
  dt: number,
  narrationSettled: boolean,
  config: CalibrationConfig,
): number {
  const step = Number.isFinite(dt) && dt > 0 ? dt : 0;
  if (narrationSettled) return step;
  if (state.phase === "step") return 0;
  const limit =
    state.phase === "align"
      ? config.alignSeconds
      : state.phase === "intro"
        ? config.introSeconds
        : state.phase === "outro"
          ? config.outroSeconds
          : null;
  if (limit === null) return step;
  // 進めると最短の時間に届く（次の段階へ移る）時だけ止める
  return state.phaseElapsed + step < limit ? step : 0;
}
