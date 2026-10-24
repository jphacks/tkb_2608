// 足踏みの山の検出（experiment_山﨑/04 ③④）．帯域通過後の上下の加速度に，シュミットトリガ（T_high で山に入り，
// T_low を下回ったら 1 歩）と不応期をかけ，山の前後に頭の速い回転があればその山は数えない．
// 1 サンプルあたり O(1)．山の間の最大値と，頭が速く回った最後の時刻だけを持つ

/** 1 サンプルの結果 */
export const StepResult = {
  /** 何も無い */
  None: 0,
  /** 1 歩を数えた */
  Step: 1,
  /** 山はあったが，頭の回転が速かったので数えなかった */
  RejectedGyro: 2,
  /** 山はあったが，不応期の中だったので数えなかった */
  RejectedRefractory: 3,
  /** 山はあったが，外から止められていた（しゃがむ動作の途中等） */
  RejectedSuppressed: 4,
} as const;
export type StepResult = (typeof StepResult)[keyof typeof StepResult];

export interface StepDetectorState {
  /** T_high を超えて，まだ T_low を下回っていない */
  inPeak: boolean;
  /** 今の山の最大値と，その時刻（ms） */
  peakValue: number;
  peakT: number;
  /** 最後に数えた歩の山の時刻（ms）と大きさ */
  lastStepT: number;
  lastStepPeak: number;
  /** 数えた歩の山の大きさの平均（m/s^2．指数移動平均．歩き出す時に 0 から） */
  stepPeakMean: number;
  /** 頭の回転が除外のしきい値を超えた最後の時刻（ms） */
  lastGyroHighT: number;
  /** 頭の回転が緩めたしきい値（歩いている間用）を超えた最後の時刻（ms） */
  lastGyroRelaxedT: number;
  /** 静止時のノイズの 2 乗の平均（指数移動平均） */
  noiseVar: number;
  /** 角速度の大きさの平均（deg/s．指数移動平均．GYRO_MEAN_TAU_SEC）と，最後に平均を進めた時刻（ms） */
  gyroMean: number;
  gyroMeanT: number;
  /** 今の山に入った時の gyroMean（deg/s） */
  peakGyroMean: number;
  /** 止まっている時に来た，T_high に届かない弱い山の時刻（ms．弱い山が 2 つ続いたら歩き出す） */
  lastWeakPeakT: number;
  /** 数えた歩・数えなかった山の数（dev ページと記録用） */
  stepCount: number;
  rejectedCount: number;
}

export function createStepDetectorState(): StepDetectorState {
  return {
    inPeak: false,
    peakValue: 0,
    peakT: 0,
    lastStepT: Number.NEGATIVE_INFINITY,
    lastStepPeak: 0,
    stepPeakMean: 0,
    lastGyroHighT: Number.NEGATIVE_INFINITY,
    lastGyroRelaxedT: Number.NEGATIVE_INFINITY,
    noiseVar: 0,
    gyroMean: 0,
    gyroMeanT: Number.NaN,
    peakGyroMean: 0,
    lastWeakPeakT: Number.NEGATIVE_INFINITY,
    stepCount: 0,
    rejectedCount: 0,
  };
}

/** 山の途中の状態だけを捨てる（数えた歩の数・ノイズの見積もりは残す） */
export function resetStepDetector(s: StepDetectorState): void {
  s.inPeak = false;
  s.peakValue = 0;
  s.peakT = 0;
  s.lastStepT = Number.NEGATIVE_INFINITY;
  s.lastGyroHighT = Number.NEGATIVE_INFINITY;
  s.lastGyroRelaxedT = Number.NEGATIVE_INFINITY;
  s.gyroMean = 0;
  s.gyroMeanT = Number.NaN;
  s.peakGyroMean = 0;
  s.lastWeakPeakT = Number.NEGATIVE_INFINITY;
}

export interface StepThresholds {
  /** 上のしきい値（m/s^2） */
  high: number;
  /** 下のしきい値（m/s^2） */
  low: number;
}

/**
 * 姿勢ごとの基準のしきい値を，静止時のノイズで底上げして out に書く．
 * T_high = max(基準, noiseFactor × ノイズの RMS)．T_low は T_high と同じ比で上げる
 */
export function effectiveThresholdsInto(
  out: StepThresholds,
  s: StepDetectorState,
  baseHigh: number,
  baseLow: number,
  noiseFactor: number,
): StepThresholds {
  const noiseHigh = noiseFactor * Math.sqrt(Math.max(0, s.noiseVar));
  const high = Math.max(baseHigh, noiseHigh);
  out.high = high;
  out.low = baseHigh > 0 ? baseLow * (high / baseHigh) : baseLow;
  return out;
}

/**
 * 静止時のノイズの見積もりを進める（止まっている間だけ呼ぶ）．
 * 山の途中と T_high を超える値は入れない（足踏みの始まりでしきい値が上がりすぎないように）
 */
export function updateStepNoise(
  s: StepDetectorState,
  bp: number,
  high: number,
  dtSec: number,
  tauSec: number,
): void {
  if (s.inPeak || !Number.isFinite(bp) || Math.abs(bp) >= high || !(dtSec > 0)) return;
  const k = 1 - Math.exp(-dtSec / tauSec);
  s.noiseVar += (bp * bp - s.noiseVar) * k;
}

export interface StepDetectorParams {
  readonly stepRefractoryMs: number;
  readonly stepGyroRejectDps: number;
  readonly stepGyroRelaxWalking: number;
  readonly stepGyroWindowMs: number;
  readonly stepGyroMeanRejectDps: number;
  readonly stepWeakRatio: number;
  readonly stepMinIntervalMs: number;
  readonly stepTentativeTimeoutMs: number;
}

/**
 * 頭の回転の平均（stepGyroMeanRejectDps と比べる値）の時定数（秒）．直前の約 1〜2 秒の平均．
 * 足踏みの振動による頭の揺れは 1 歩ごとの短い山（50〜100 deg/s）なので，平均にするとならされる
 */
const GYRO_MEAN_TAU_SEC = 1.0;

/**
 * 1 サンプル分進める．t は時刻（ms），bp は帯域通過後の上下の加速度，gyro は角速度の大きさ（deg/s．無ければ NaN）．
 * suppress が true の間に終わった山は数えない（しゃがむ動作の途中の山）．
 * 頭の回転は「山の前 stepGyroWindowMs から山が終わった今まで」を見る（山の後ろは，判定を遅らせないため見ない）．
 * relaxed が true（仮に歩く・歩くの間）なら，除外のしきい値を stepGyroRejectDps × stepGyroRelaxWalking にする．
 * 2 つのしきい値を超えた最後の時刻を別々に持つため，山の途中で状態が変わっても O(1) で判定できる．
 * 止まっている時（relaxed でない）は，山に入った時の頭の回転の平均（約 1 秒）が stepGyroMeanRejectDps 以上の山も数えない
 * （見回し・頷きを続けている間の山．0 以下で無効）．
 * 止まっている時は T_high × stepWeakRatio を超えた弱い山も見て，間隔（stepMinIntervalMs〜stepTentativeTimeoutMs）の
 * 合う弱い山が 2 つ続いたら 2 つ目を 1 歩とする（1 つ目は何も返さない）
 */
export function updateStepDetector(
  s: StepDetectorState,
  t: number,
  bp: number,
  gyro: number,
  th: Readonly<StepThresholds>,
  params: StepDetectorParams,
  suppress = false,
  relaxed = false,
): StepResult {
  if (Number.isFinite(gyro)) {
    const dtSec = Number.isNaN(s.gyroMeanT) ? 0 : (t - s.gyroMeanT) / 1000;
    if (Number.isNaN(s.gyroMeanT)) s.gyroMean = gyro;
    else if (dtSec > 0)
      s.gyroMean += (gyro - s.gyroMean) * (1 - Math.exp(-dtSec / GYRO_MEAN_TAU_SEC));
    s.gyroMeanT = t;
    if (gyro >= params.stepGyroRejectDps) s.lastGyroHighT = t;
    if (gyro >= params.stepGyroRejectDps * Math.max(1, params.stepGyroRelaxWalking)) {
      s.lastGyroRelaxedT = t;
    }
  }
  if (!Number.isFinite(bp)) return StepResult.None;

  if (!s.inPeak) {
    // 止まっている時は，T_high の stepWeakRatio 倍から山とみなす（弱い山．下で 2 つ続いた時だけ数える）
    const weakRatio =
      relaxed || !(params.stepWeakRatio > 0 && params.stepWeakRatio < 1) ? 1 : params.stepWeakRatio;
    if (bp > th.high * weakRatio) {
      s.inPeak = true;
      s.peakValue = bp;
      s.peakT = t;
      s.peakGyroMean = s.gyroMean;
    }
    return StepResult.None;
  }

  if (bp > s.peakValue) {
    s.peakValue = bp;
    s.peakT = t;
  }
  if (bp >= th.low) return StepResult.None;

  // 山が終わった（T_low を下回った）
  s.inPeak = false;
  let result: StepResult;
  if (suppress) result = StepResult.RejectedSuppressed;
  else if ((relaxed ? s.lastGyroRelaxedT : s.lastGyroHighT) >= s.peakT - params.stepGyroWindowMs)
    result = StepResult.RejectedGyro;
  else if (
    !relaxed &&
    params.stepGyroMeanRejectDps > 0 &&
    s.peakGyroMean >= params.stepGyroMeanRejectDps
  )
    result = StepResult.RejectedGyro;
  else if (s.peakT - s.lastStepT < params.stepRefractoryMs) result = StepResult.RejectedRefractory;
  else if (s.peakValue <= th.high) {
    // 弱い山（止まっている時だけ）．間隔の合う（仮に歩くから歩くになるのと同じ間隔）弱い山が 2 つ続いたら，
    // 2 つ目を 1 歩として数える．足踏みの始めの数歩は弱い人がいる（20261024-183931_t9tonjf6 の 1 回目の足踏み:
    // 始めの 3 歩の山が 0.60〜0.77 m/s^2 で，T_high 0.9 を超えるまで動き出しが 1600 ms 遅れた）．
    // 頷き・見回しの 1 回の山は周期が合わないか，頭の回転の除外に掛かる
    const gap = s.peakT - s.lastWeakPeakT;
    if (gap >= params.stepMinIntervalMs && gap <= params.stepTentativeTimeoutMs)
      result = StepResult.Step;
    else {
      s.lastWeakPeakT = s.peakT;
      return StepResult.None;
    }
  } else result = StepResult.Step;

  if (result === StepResult.Step) {
    s.lastStepT = s.peakT;
    s.lastStepPeak = s.peakValue;
    s.stepPeakMean = relaxed ? s.stepPeakMean + (s.peakValue - s.stepPeakMean) * 0.3 : s.peakValue;
    s.stepCount++;
  } else {
    s.rejectedCount++;
  }
  return result;
}
