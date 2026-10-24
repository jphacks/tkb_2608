// 避難の仮の画面の時間の進め方（DOM・three.js に依存しない純粋な関数）．
// 決まった秒数たったら結果画面へ進む．縦向きの案内が出ている間は数えない

/** 避難の仮の画面を出しておく秒数（s） */
export const SCENARIO_PLACEHOLDER_SECONDS = 5;

export interface PlaceholderTimer {
  /** 数えた秒数（止めている間は増えない） */
  readonly elapsed: number;
}

export const INITIAL_PLACEHOLDER_TIMER: PlaceholderTimer = { elapsed: 0 };

/** 1 フレーム進める（dt は s）．paused の間は数えない */
export function advancePlaceholderTimer(
  timer: PlaceholderTimer,
  dt: number,
  paused: boolean,
): PlaceholderTimer {
  if (paused || !Number.isFinite(dt) || dt <= 0) return timer;
  return { elapsed: timer.elapsed + dt };
}

/** 残りの秒数（切り上げ．0 以上） */
export function placeholderRemainingSeconds(
  timer: PlaceholderTimer,
  seconds: number = SCENARIO_PLACEHOLDER_SECONDS,
): number {
  return Math.max(0, Math.ceil(seconds - timer.elapsed));
}

/** 結果画面へ進んでよいか */
export function isPlaceholderDone(
  timer: PlaceholderTimer,
  seconds: number = SCENARIO_PLACEHOLDER_SECONDS,
): boolean {
  return timer.elapsed >= seconds;
}
