// 空間を単独で開いた時（?scene=school 等）の非常ベルからの時刻の決め方（DOM に依存しない純粋な関数）．
// ?t=<秒> で始める時刻をずらし，?speed=<倍率> で進む速さを変える（確認用．体験の流れ（app/）は自分の時刻を渡す）

/** 非常ベルの時刻の進め方 */
export interface AlarmClockOptions {
  /** 空間を作った時の時刻（非常ベルからの秒数，s．0 以上） */
  readonly startSeconds: number;
  /** 進む速さ（倍．0 より大きい．1 で実際の時間と同じ） */
  readonly speed: number;
}

/** 指定なし・不正な値の時の進め方（開いた時を 0 秒とし，実際の時間と同じ速さで進む） */
export const DEFAULT_ALARM_CLOCK: AlarmClockOptions = { startSeconds: 0, speed: 1 };

/** 文字列を有限の数にする．空・数でない値は null */
function parseFiniteNumber(value: string | null): number | null {
  if (value === null || value.trim() === "") return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

/**
 * クエリ文字列（"?t=60&speed=5" 等）から時刻の進め方を取り出す．
 * t は 0 以上の有限の数，speed は 0 より大きい有限の数だけを受け付け，それ以外（無い・負・NaN 等）は既定値にする
 */
export function parseAlarmClock(search: string): AlarmClockOptions {
  const params = new URLSearchParams(search);
  const t = parseFiniteNumber(params.get("t"));
  const speed = parseFiniteNumber(params.get("speed"));
  return {
    startSeconds: t !== null && t >= 0 ? t : DEFAULT_ALARM_CLOCK.startSeconds,
    speed: speed !== null && speed > 0 ? speed : DEFAULT_ALARM_CLOCK.speed,
  };
}

/**
 * 1 フレーム分進めた時刻（s）を返す．dt はフレームの経過時間（s）．
 * dt が負・NaN（時計の巻き戻り等）の時は進めない
 */
export function advanceAlarmSeconds(seconds: number, dt: number, speed: number): number {
  return Number.isFinite(dt) && dt > 0 ? seconds + dt * speed : seconds;
}
