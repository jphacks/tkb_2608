// 避難の画面（app/drillScene.ts）で使う，時刻の数え方の小さな純粋な関数（DOM・three.js に依存しない）．
// 記録（DrillTrack）を足す間隔と，火に近づいた時の警告音を鳴らす間隔を決める（SPEC_01「毎フレームの処理」「VR 避難の規則」）

/** DrillTrack に記録を足す間隔（s．SPEC_01「結果の評価」の 0.2 秒ごと） */
export const TRACK_SAMPLE_INTERVAL_SECONDS = 0.2;

/**
 * 火の 1 マス以内にいる間に警告音を鳴らし直す間隔（s）．仕様に無く仮に決めた値．
 * 警告音（near-fire-warning）は 1 回だけ鳴る音のため，入った時に鳴らし，いる間はこの間隔で鳴らし直す
 */
export const NEAR_FIRE_WARNING_REPEAT_SECONDS = 2;

/** 記録を足すかの判定の結果 */
export interface TrackTick {
  /** このフレームで記録を足すか */
  readonly record: boolean;
  /** 次に記録を足す時刻（非常ベルからの秒数．s） */
  readonly nextAt: number;
}

/**
 * 今の時刻 t（非常ベルからの秒数．s）で記録を足すかを決める．nextAt は次に足す予定の時刻（最初は 0）．
 * フレームが大きく遅れて 1 間隔以上過ぎた時は，まとめて足さずに今から 1 間隔後を次の予定にする．
 * t・nextAt が有限でない時は足さない
 */
export function tickTrack(
  nextAt: number,
  t: number,
  interval: number = TRACK_SAMPLE_INTERVAL_SECONDS,
): TrackTick {
  if (!Number.isFinite(t) || !Number.isFinite(nextAt) || t < nextAt) {
    return { record: false, nextAt };
  }
  const next = nextAt + interval;
  return { record: true, nextAt: t >= next ? t + interval : next };
}

/** 警告音の鳴らし直しの状態 */
export interface WarningTimer {
  /** 前のフレームで火の 1 マス以内にいたか */
  readonly near: boolean;
  /** 最後に鳴らしてからの秒数（s） */
  readonly sinceLast: number;
}

export const INITIAL_WARNING_TIMER: WarningTimer = { near: false, sinceLast: 0 };

/**
 * 1 フレーム進め，警告音を鳴らすかを返す．火の 1 マス以内に入ったフレームで鳴らし，
 * いる間は repeat 秒ごとに鳴らし直す．離れたら止める（dt は s．負・NaN は 0 として扱う）
 */
export function tickNearFireWarning(
  timer: WarningTimer,
  nearFire: boolean,
  dt: number,
  repeat: number = NEAR_FIRE_WARNING_REPEAT_SECONDS,
): { readonly timer: WarningTimer; readonly play: boolean } {
  if (!nearFire) return { timer: INITIAL_WARNING_TIMER, play: false };
  if (!timer.near) return { timer: { near: true, sinceLast: 0 }, play: true };
  const sinceLast = timer.sinceLast + (Number.isFinite(dt) && dt > 0 ? dt : 0);
  if (sinceLast >= repeat) return { timer: { near: true, sinceLast: 0 }, play: true };
  return { timer: { near: true, sinceLast }, play: false };
}
