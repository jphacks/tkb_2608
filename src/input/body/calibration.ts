// 短いキャリブレーション（立って静止・足踏み・しゃがむ・しゃがみ歩き．各数秒）のセンサーのサンプルから，
// その人に合わせた判定のしきい値（InputParams の上書き）を求める（Issue #94・#58．項目は experiment_山﨑/12「CalibrationProfile の項目案」）．
// 純粋な関数: サンプルと区間（core の CalibrationSegment）を受け取り，上書きと測った値を返す．前処理は判定と同じ
// 関数（vertical・biquad）を使う．測れなかった項目・範囲外の値は上書きに入れない（既定値のまま）
import type { CalibrationSegment, CalibrationSegmentKind } from "../../core/types";
import { DEFAULT_INPUT_PARAMS, type InputParamKey, type InputParams } from "../params";
import type { MotionSample } from "../sensors/types";
import { biquadStepAt, createBiquad, resetBiquad } from "./biquad";
import { standWalkBoundary } from "./posture";
import { createVerticalState, gyroMagnitude, resetVertical, updateVertical } from "./vertical";

/** キャリブレーションで測った値（測れなかった値は null） */
export interface CalibrationMeasurements {
  /** 立って静止: 上下の加速度の RMS（m/s^2．帯域通過しない値．短い窓ごとの RMS の中央値） */
  readonly restNoiseAccel: number | null;
  /** 立って静止: 帯域通過後の上下の加速度の RMS（m/s^2） */
  readonly restNoiseBand: number | null;
  /** 立って静止: 角速度の大きさの中央値（deg/s） */
  readonly restGyroDps: number | null;
  /** 立って足踏み: 帯域通過後の山の大きさの中央値（m/s^2）と，使った山の数 */
  readonly stepPeakStanding: number | null;
  readonly stepCountStanding: number;
  /** 立って足踏み: 山の間隔の中央値（ms） */
  readonly stepIntervalMs: number | null;
  /** しゃがむ: 沈んだ深さ（m．正の値）と，動き始めから底までの時間（ms） */
  readonly crouchDepth: number | null;
  readonly crouchDurationMs: number | null;
  /** しゃがんで静止: 底の後の上下の加速度の RMS（m/s^2．短い窓ごとの RMS の中央値） */
  readonly crouchHoldNoiseAccel: number | null;
  /** しゃがみ歩き: 帯域通過後の山の大きさの中央値（m/s^2）と，使った山の数 */
  readonly stepPeakCrouching: number | null;
  readonly stepCountCrouching: number;
  /** しゃがみ歩きのしきい値を，立った足踏みの値から見積もったか（しゃがみ歩きの区間が無い・時間切れ・山が足りない時） */
  readonly crouchingEstimated: boolean;
}

/** キャリブレーションの結果 */
export interface CalibrationResult {
  /** しきい値の上書き（既定値に重ねる．測れなかった項目は入れない） */
  readonly overrides: Partial<Record<InputParamKey, number>>;
  readonly measurements: CalibrationMeasurements;
  /** 値を使わなかった理由など（dev ページと replay の表示用） */
  readonly notes: readonly string[];
}

// ---- 求め方の定数 ----

/** 静止・しゃがんで静止の RMS を求める短い窓（ms）．窓ごとの RMS の中央値にして，1 回の揺れに引っ張られないようにする */
const RMS_WINDOW_MS = 250;
/** 立って静止とみなせる RMS の上限（m/s^2）．これより大きければ静止していなかったとして捨てる（足踏みの RMS は 1.4 ほど） */
const REST_NOISE_MAX = 1.0;
/**
 * 静止の条件（zuptAccel）を静止時の揺れの何倍以上にするか．しゃがんだ後の揺れ（crouchHoldNoiseAccel）は測るだけで使わない
 * （20261025-021610_ylu8lb54 で，しゃがんだ後の揺れ 2.3 m/s^2 から zuptAccel を 1.0 にすると，しゃがむ・立つの検出率が 15 → 10% に下がった）
 */
const ZUPT_NOISE_FACTOR = 2;
/** 静止の条件（zuptAccel）の上限（m/s^2）．足踏みの RMS（1.4 ほど）を静止と取り違えない */
const ZUPT_ACCEL_MAX = 1.0;
/** 静止の条件（zuptGyroDps）を静止時の角速度の何倍以上にするか・上限（deg/s） */
const ZUPT_GYRO_FACTOR = 3;
const ZUPT_GYRO_MAX = 45;

/** 山とみなす帯域通過後の値の下限（m/s^2）と，静止時の揺れ（帯域通過後の RMS）の何倍以上にするか */
const PEAK_FLOOR_MIN = 0.4;
const PEAK_FLOOR_NOISE_FACTOR = 4;
/** 山から抜けたとみなす値（山に入る値に対する割合） */
const PEAK_EXIT_RATIO = 0.3;
/** 山の 90% 点のこの割合より小さい山は，足踏みの合間の小さな揺れとして捨てる */
const PEAK_KEEP_RATIO = 0.3;
/** 山の不応期（ms．判定の stepRefractoryMs と同じ考え） */
const PEAK_REFRACTORY_MS = 250;
/** 足踏みの山の大きさとして使うのに要る山の数 */
const MIN_STEP_PEAKS = 3;
/** 山の大きさの中央値として受け付ける範囲（m/s^2） */
const STEP_PEAK_MIN = 0.3;
const STEP_PEAK_MAX = 15;
/** 足踏みの間隔として数える範囲（ms．これを外れる間隔は見逃しか途中の揺れとして使わない） */
const STEP_INTERVAL_MIN_MS = 250;
const STEP_INTERVAL_MAX_MS = 1200;

/**
 * T_high を足踏みの山の中央値の何倍にするか．既定値（立ち 0.9）は，正解付きの記録の足踏みの山（1.0〜2.4 m/s^2）の
 * 中央値の 0.4〜0.9 倍にあたる．半分より少し上にして，見回し・頷きの山（多くは足踏みより小さい）を拾いにくくする
 */
const STEP_HIGH_RATIO = 0.6;
/**
 * 立っている時の T_high の上限（m/s^2）．下限は base の値（既定値より下げない）．
 * 0.8 倍まで下げると，20261025-021610_ylu8lb54 で頷きの歩き出しの誤検出が 2 → 3 回に増えた（足踏みの検出率は既定でも 100%）
 */
const STEP_HIGH_STANDING_MAX = 2.5;
/** しゃがんでいる時の T_high の上限（m/s^2．下限は base の値）．しゃがみ歩きの山は人により 1〜9 m/s^2 と幅が広い */
const STEP_HIGH_CROUCHING_MAX = 5;

/** しゃがむ動作の速度の最小（m/s）．これに届かない下向きの動きは体の揺れとして使わない */
const CROUCH_MIN_VELOCITY = 0.3;
/** しゃがむ動作として受け付ける深さ（m）と時間（ms）の範囲 */
const CROUCH_DEPTH_MIN = 0.1;
/** 最初のしゃがむ動作とみなす深さの下限（m）．これより浅い下向きの動きは，しゃがむ前のぐらつきとして飛ばす */
const CROUCH_DEPTH_FIRST_MIN = 0.15;
const CROUCH_DEPTH_MAX = 1.2;
const CROUCH_DURATION_MIN_MS = 200;
const CROUCH_DURATION_MAX_MS = 3000;
/** 底の後，しゃがんで静止の揺れを測り始めるまでの時間（ms．止まりきるまでの減速を含めない） */
const CROUCH_HOLD_SKIP_MS = 300;
/**
 * しゃがみの深さ（crouchDepthM）の下限（m．浅すぎると足踏みのずれでしゃがみと取り違える）．上限は base の値（深くしない）．
 * 深くすると確定が遅れる: 20261025-021610_ylu8lb54（測った深さ 0.76 m）で crouchDepthM を 0.4 / 0.6 / 0.76 にすると，
 * しゃがみ・立ち上がりの遅れの最大が 996 / 1179 / 1296 ms と SPEC の 1000 ms を超え，検出率は 15% のまま変わらなかった
 */
const CROUCH_DEPTH_PARAM_MIN = 0.25;
/** 積分の最長（postureMaxIntegrateMs）をしゃがむ時間の何倍以上にするか・上限（ms） */
const INTEGRATE_DURATION_FACTOR = 1.5;
const INTEGRATE_MAX_MS = 3000;

/** 前処理したサンプル（判定と同じ射影・帯域通過） */
interface Series {
  readonly t: Float64Array;
  /** 上下の加速度（m/s^2．上が正）．求められない時は NaN */
  readonly av: Float64Array;
  /** 帯域通過後の上下の加速度 */
  readonly bp: Float64Array;
  /** 角速度の大きさ（deg/s） */
  readonly gyro: Float64Array;
}

/** サンプルを判定と同じ手順で前処理する（重力の向きへの射影 → 帯域通過．間隔が飛んだら初期化） */
function preprocess(samples: readonly MotionSample[], params: InputParams): Series {
  const n = samples.length;
  const t = new Float64Array(n);
  const av = new Float64Array(n);
  const bp = new Float64Array(n);
  const gyro = new Float64Array(n);
  const vertical = createVerticalState();
  const highpass = createBiquad("highpass", params.stepBandLowHz);
  const lowpass = createBiquad("lowpass", params.stepBandHighHz);
  let dtEst = 0;
  let lastT = Number.NaN;
  let count = 0;
  for (const s of samples) {
    if (!Number.isFinite(s.t)) continue;
    if (!Number.isNaN(lastT)) {
      const gap = s.t - lastT;
      if (!(gap > 0)) continue;
      if (gap > params.maxSampleGapMs) {
        resetVertical(vertical);
        resetBiquad(highpass);
        resetBiquad(lowpass);
        dtEst = 0;
        lastT = Number.NaN;
      }
    }
    const first = Number.isNaN(lastT);
    const dtSec = first ? 0 : (s.t - lastT) / 1000;
    lastT = s.t;
    const a = updateVertical(vertical, s, dtSec, params.gravityCutoffHz);
    let b = Number.NaN;
    if (!first && Number.isFinite(a)) {
      dtEst = dtEst > 0 ? dtEst + (dtSec - dtEst) * 0.05 : dtSec;
      const fs = 1 / dtEst;
      b = biquadStepAt(
        lowpass,
        biquadStepAt(highpass, a, fs, params.stepBandLowHz),
        fs,
        params.stepBandHighHz,
      );
    }
    t[count] = s.t;
    av[count] = a;
    bp[count] = b;
    gyro[count] = gyroMagnitude(s);
    count++;
  }
  return {
    t: t.subarray(0, count),
    av: av.subarray(0, count),
    bp: bp.subarray(0, count),
    gyro: gyro.subarray(0, count),
  };
}

/** 区間 [startMs, endMs] に入るサンプルの添え字の範囲 [i0, i1)（時刻の順に並んでいる前提） */
function rangeOf(series: Series, startMs: number, endMs: number): [number, number] {
  const ts = series.t;
  let i0 = 0;
  while (i0 < ts.length && ts[i0] < startMs) i0++;
  let i1 = i0;
  while (i1 < ts.length && ts[i1] <= endMs) i1++;
  return [i0, i1];
}

function median(values: readonly number[]): number | null {
  if (values.length === 0) return null;
  const v = [...values].sort((a, b) => a - b);
  const mid = v.length >> 1;
  return v.length % 2 === 1 ? v[mid] : (v[mid - 1] + v[mid]) / 2;
}

function quantile(values: readonly number[], q: number): number | null {
  if (values.length === 0) return null;
  const v = [...values].sort((a, b) => a - b);
  return v[Math.min(v.length - 1, Math.max(0, Math.floor(q * v.length)))];
}

/** 短い窓ごとの RMS の中央値（値が足りない窓は使わない） */
function windowedRms(t: Float64Array, x: Float64Array, i0: number, i1: number): number | null {
  const rms: number[] = [];
  let sum = 0;
  let n = 0;
  let windowStart = Number.NaN;
  for (let i = i0; i < i1; i++) {
    if (!Number.isFinite(x[i])) continue;
    if (Number.isNaN(windowStart)) windowStart = t[i];
    if (t[i] - windowStart >= RMS_WINDOW_MS) {
      if (n >= 3) rms.push(Math.sqrt(sum / n));
      sum = 0;
      n = 0;
      windowStart = t[i];
    }
    sum += x[i] * x[i];
    n++;
  }
  if (n >= 3 && rms.length === 0) rms.push(Math.sqrt(sum / n));
  return median(rms);
}

/** 帯域通過後の山（シュミットトリガと不応期．判定の山の検出を簡単にしたもの） */
function findPeaks(
  series: Series,
  i0: number,
  i1: number,
  floor: number,
): { readonly t: number; readonly value: number }[] {
  const peaks: { t: number; value: number }[] = [];
  let inPeak = false;
  let peakValue = 0;
  let peakT = 0;
  for (let i = i0; i < i1; i++) {
    const b = series.bp[i];
    if (!Number.isFinite(b)) continue;
    if (!inPeak) {
      if (b > floor) {
        inPeak = true;
        peakValue = b;
        peakT = series.t[i];
      }
      continue;
    }
    if (b > peakValue) {
      peakValue = b;
      peakT = series.t[i];
    }
    if (b >= floor * PEAK_EXIT_RATIO) continue;
    inPeak = false;
    const last = peaks.at(-1);
    if (last !== undefined && peakT - last.t < PEAK_REFRACTORY_MS) {
      // 不応期の中の山は，大きい方を残す
      if (peakValue > last.value) {
        last.t = peakT;
        last.value = peakValue;
      }
    } else {
      peaks.push({ t: peakT, value: peakValue });
    }
  }
  // 足踏みの合間の小さな揺れ（大きな山の 3 割未満）を捨てる
  const top = quantile(
    peaks.map((p) => p.value),
    0.9,
  );
  return top === null ? [] : peaks.filter((p) => p.value >= top * PEAK_KEEP_RATIO);
}

/** 足踏みの山の大きさ（中央値）と間隔．山が足りない・範囲外なら peak は null */
function measureSteps(
  series: Series,
  segment: CalibrationSegment,
  floor: number,
): { peak: number | null; count: number; intervalMs: number | null; note: string | null } {
  const [i0, i1] = rangeOf(series, segment.startMs, segment.endMs);
  const peaks = findPeaks(series, i0, i1, floor);
  const intervals: number[] = [];
  for (let k = 1; k < peaks.length; k++) {
    const gap = peaks[k].t - peaks[k - 1].t;
    if (gap >= STEP_INTERVAL_MIN_MS && gap <= STEP_INTERVAL_MAX_MS) intervals.push(gap);
  }
  const intervalMs = median(intervals);
  if (peaks.length < MIN_STEP_PEAKS) {
    return {
      peak: null,
      count: peaks.length,
      intervalMs,
      note: `${segment.kind}: 山が ${peaks.length} 個しかない（${MIN_STEP_PEAKS} 個以上要る）`,
    };
  }
  const peak = median(peaks.map((p) => p.value));
  if (peak === null || peak < STEP_PEAK_MIN || peak > STEP_PEAK_MAX) {
    return {
      peak: null,
      count: peaks.length,
      intervalMs,
      note: `${segment.kind}: 山の大きさ ${peak?.toFixed(2)} m/s^2 が範囲外`,
    };
  }
  return { peak, count: peaks.length, intervalMs, note: null };
}

/**
 * しゃがむ動作の深さ（m）と時間（ms）．区間の中で，下向きの加速度が候補のしきい値を超えた所から速度 0 で積分を始め，
 * 下向きの速度が CROUCH_MIN_VELOCITY を超えた後に速度が 0 に戻った所（底）までに沈んだ量を 1 回の動作とする．
 * 深さ・時間が範囲に入る最初の動作を使う（しゃがむ前のぐらつきは浅いので飛ばす．区間は立って始まるため，最初の大きな
 * 下向きの動作がしゃがむ動作．最も深いものを選ぶと，立ち上がりの減速の途中から積分した，ずれの大きい動作を拾った）．
 * 範囲に入るものが無ければ，見つかった最も深い動作を返す（呼ぶ側が範囲外として捨てる）
 */
function measureCrouch(
  series: Series,
  i0: number,
  i1: number,
  candidateAccel: number,
): { depth: number; durationMs: number; bottomT: number } | null {
  let deepest: { depth: number; durationMs: number; bottomT: number } | null = null;
  let i = i0;
  while (i < i1) {
    if (!(series.av[i] < -candidateAccel)) {
      i++;
      continue;
    }
    // 積分は候補の 1 つ前のサンプルから，速度 0 で始める（posture.ts の候補と同じ）
    const startT = i > i0 ? series.t[i - 1] : series.t[i];
    let v = 0;
    let h = 0;
    let vMin = 0;
    let lastT = startT;
    let j = i;
    let bottom: { depth: number; durationMs: number; bottomT: number } | null = null;
    for (; j < i1; j++) {
      const a = series.av[j];
      const dtSec = (series.t[j] - lastT) / 1000;
      lastT = series.t[j];
      if (!Number.isFinite(a) || !(dtSec > 0)) continue;
      v += a * dtSec;
      h += v * dtSec;
      if (v < vMin) vMin = v;
      if (series.t[j] - startT > CROUCH_DURATION_MAX_MS) break;
      if (v >= 0) {
        if (vMin <= -CROUCH_MIN_VELOCITY) {
          bottom = { depth: -h, durationMs: series.t[j] - startT, bottomT: series.t[j] };
        }
        break;
      }
    }
    if (bottom !== null) {
      if (
        bottom.depth >= CROUCH_DEPTH_FIRST_MIN &&
        bottom.depth <= CROUCH_DEPTH_MAX &&
        bottom.durationMs >= CROUCH_DURATION_MIN_MS
      ) {
        return bottom;
      }
      if (deepest === null || bottom.depth > deepest.depth) deepest = bottom;
    }
    // 次の候補はこの動作の後から探す（底に届かなかった時は 1 つ後のサンプルから）
    i = bottom !== null ? j + 1 : i + 1;
  }
  return deepest;
}

function clamp(v: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, v));
}

/** 値を丸めて上書きに入れる（記録・表示で桁が長くならないように 3 桁） */
function setOverride(
  out: Partial<Record<InputParamKey, number>>,
  key: InputParamKey,
  value: number,
): void {
  if (Number.isFinite(value)) out[key] = Math.round(value * 1000) / 1000;
}

/**
 * 種類ごとに，使える区間（飛ばした区間・時間切れの区間・長さの無い区間は使わない．同じ種類は最初の 1 つ）．
 * 時間切れの区間は手順どおりに動けたか分からないので捨てて既定の判定に戻す（SPEC_01「キャリブレーションとの分担」）
 */
function usableSegment(
  segments: readonly CalibrationSegment[],
  kind: CalibrationSegmentKind,
  notes: string[],
): CalibrationSegment | null {
  const s = segments.find((x) => x.kind === kind);
  if (s === undefined) {
    notes.push(`${kind}: 区間が無い`);
    return null;
  }
  if (s.outcome === "skipped") {
    notes.push(`${kind}: 飛ばした区間は使わない`);
    return null;
  }
  if (s.outcome === "timeout") {
    notes.push(
      kind === "crouchWalking"
        ? "crouchWalking: 時間切れの区間は使わない（立った足踏みから見積もる）"
        : `${kind}: 時間切れの区間は使わない`,
    );
    return null;
  }
  if (!(Number.isFinite(s.startMs) && Number.isFinite(s.endMs) && s.endMs > s.startMs)) {
    notes.push(`${kind}: 区間の時刻が不正`);
    return null;
  }
  return s;
}

/**
 * キャリブレーションのサンプルと区間から，しきい値の上書きを求める（純粋な関数．例外は投げない）．
 * samples は時刻の順（区間より前のサンプルも渡すと，重力の向きと帯域通過が落ち着いてから区間に入る）．
 * base は前処理の設定（帯域・重力の遮断周波数）と，上書きの下限に使う（既定値より緩めない項目がある）．
 *
 * 求める値（測れなかった項目は上書きに入れない．base は上書きの基準で，判定を既定より悪くしない向きにだけ動かす）:
 * - standing（立って静止）→ 静止時の揺れ R（RMS）．zuptAccel = min(1.0, max(base, 2 × R))，
 *   zuptGyroDps = min(45, max(base, 3 × 静止時の角速度の中央値))．山の下限（max(0.4, 4 × 帯域通過後の RMS)）にも使う
 * - stepping（立って足踏み）→ 山の中央値 P．stepHighStanding = clamp(0.6 × P, base, 2.5)，
 *   stepLowStanding は base の比（T_low / T_high）のまま同じ倍率を掛ける．山の間隔は測るだけ
 * - crouching（しゃがむ）→ 深さ D．crouchDepthM = clamp(D, 0.25, base)（浅い人だけ浅くする）．しゃがむ時間 T から
 *   postureMaxIntegrateMs = min(3000, max(base, 1.5 × T))．しゃがんだ後の揺れは測るだけ
 * - crouchWalking（しゃがみ歩き）→ 山の中央値 Pc．stepHighCrouching = clamp(0.6 × Pc, base, 5)，T_low は同じ倍率．
 *   区間が無い・時間切れ・山が足りない時は，立った足踏みの T_high の base からの倍率を，しゃがみの T_high・T_low に掛けて見積もる
 * - P と Pc の両方が測れて，比（大きい方 / 小さい方）が posture.ts の STAND_WALK_MIN_RATIO 以上なら，
 *   standWalkPeakStanding = P，standWalkPeakCrouching = Pc（しゃがみ歩きから止まらずに立つ判定を有効にする．
 *   base.standWalkSteps が 0 なら入れない）
 */
export function calibrateParams(
  samples: readonly MotionSample[],
  segments: readonly CalibrationSegment[],
  base: InputParams = DEFAULT_INPUT_PARAMS,
): CalibrationResult {
  const notes: string[] = [];
  const overrides: Partial<Record<InputParamKey, number>> = {};
  const series = preprocess(samples, base);

  // ---- 立って静止 ----
  let restNoiseAccel: number | null = null;
  let restNoiseBand: number | null = null;
  let restGyroDps: number | null = null;
  const standing = usableSegment(segments, "standing", notes);
  if (standing !== null) {
    const [i0, i1] = rangeOf(series, standing.startMs, standing.endMs);
    const ra = windowedRms(series.t, series.av, i0, i1);
    const rb = windowedRms(series.t, series.bp, i0, i1);
    const gyros: number[] = [];
    for (let i = i0; i < i1; i++) if (Number.isFinite(series.gyro[i])) gyros.push(series.gyro[i]);
    if (ra === null) notes.push("standing: サンプルが足りない");
    else if (ra > REST_NOISE_MAX)
      notes.push(`standing: 揺れ ${ra.toFixed(2)} m/s^2 が大きすぎる（静止していない）`);
    else {
      restNoiseAccel = ra;
      restNoiseBand = rb;
      restGyroDps = median(gyros);
    }
  }

  // ---- 立って足踏み ----
  const peakFloor = Math.max(PEAK_FLOOR_MIN, PEAK_FLOOR_NOISE_FACTOR * (restNoiseBand ?? 0));
  let stepPeakStanding: number | null = null;
  let stepCountStanding = 0;
  let stepIntervalMs: number | null = null;
  const stepping = usableSegment(segments, "stepping", notes);
  if (stepping !== null) {
    const r = measureSteps(series, stepping, peakFloor);
    stepPeakStanding = r.peak;
    stepCountStanding = r.count;
    stepIntervalMs = r.intervalMs;
    if (r.note !== null) notes.push(r.note);
  }

  // ---- しゃがむ ----
  let crouchDepth: number | null = null;
  let crouchDurationMs: number | null = null;
  let crouchHoldNoiseAccel: number | null = null;
  const crouching = usableSegment(segments, "crouching", notes);
  if (crouching !== null) {
    const [i0, i1] = rangeOf(series, crouching.startMs, crouching.endMs);
    const candidate = Math.max(
      base.postureCandidateAccel,
      base.postureNoiseFactor * (restNoiseAccel ?? 0),
    );
    const c = measureCrouch(series, i0, i1, candidate);
    if (c === null) notes.push("crouching: しゃがむ動作が見つからない");
    else if (c.depth < CROUCH_DEPTH_MIN || c.depth > CROUCH_DEPTH_MAX)
      notes.push(`crouching: 深さ ${c.depth.toFixed(2)} m が範囲外`);
    else if (c.durationMs < CROUCH_DURATION_MIN_MS || c.durationMs > CROUCH_DURATION_MAX_MS)
      notes.push(`crouching: しゃがむ時間 ${c.durationMs.toFixed(0)} ms が範囲外`);
    else {
      crouchDepth = c.depth;
      crouchDurationMs = c.durationMs;
      const [h0, h1] = rangeOf(series, c.bottomT + CROUCH_HOLD_SKIP_MS, crouching.endMs);
      const hold = windowedRms(series.t, series.av, h0, h1);
      if (hold === null) notes.push("crouching: しゃがんだ後の静止が短く，揺れを測れない");
      else crouchHoldNoiseAccel = hold;
    }
  }

  // ---- しゃがみ歩き ----
  let stepPeakCrouching: number | null = null;
  let stepCountCrouching = 0;
  const crouchWalking = usableSegment(segments, "crouchWalking", notes);
  if (crouchWalking !== null) {
    const r = measureSteps(series, crouchWalking, peakFloor);
    stepPeakCrouching = r.peak;
    stepCountCrouching = r.count;
    if (r.note !== null) notes.push(r.note);
  }

  // ---- しきい値にする ----
  if (restNoiseAccel !== null) {
    setOverride(
      overrides,
      "zuptAccel",
      Math.min(ZUPT_ACCEL_MAX, Math.max(base.zuptAccel, ZUPT_NOISE_FACTOR * restNoiseAccel)),
    );
  }
  if (restGyroDps !== null) {
    setOverride(
      overrides,
      "zuptGyroDps",
      Math.min(ZUPT_GYRO_MAX, Math.max(base.zuptGyroDps, ZUPT_GYRO_FACTOR * restGyroDps)),
    );
  }
  let standingScale: number | null = null;
  if (stepPeakStanding !== null && base.stepHighStanding > 0) {
    const high = clamp(
      STEP_HIGH_RATIO * stepPeakStanding,
      base.stepHighStanding,
      Math.max(base.stepHighStanding, STEP_HIGH_STANDING_MAX),
    );
    standingScale = high / base.stepHighStanding;
    setOverride(overrides, "stepHighStanding", high);
    setOverride(overrides, "stepLowStanding", base.stepLowStanding * standingScale);
  }
  let crouchingEstimated = false;
  if (stepPeakCrouching !== null && base.stepHighCrouching > 0) {
    const high = clamp(
      STEP_HIGH_RATIO * stepPeakCrouching,
      base.stepHighCrouching,
      Math.max(base.stepHighCrouching, STEP_HIGH_CROUCHING_MAX),
    );
    setOverride(overrides, "stepHighCrouching", high);
    setOverride(
      overrides,
      "stepLowCrouching",
      base.stepLowCrouching * (high / base.stepHighCrouching),
    );
  } else if (standingScale !== null) {
    crouchingEstimated = true;
    setOverride(overrides, "stepHighCrouching", base.stepHighCrouching * standingScale);
    setOverride(overrides, "stepLowCrouching", base.stepLowCrouching * standingScale);
  }
  if (stepPeakStanding !== null && stepPeakCrouching !== null) {
    const boundary = standWalkBoundary({
      standWalkPeakStanding: stepPeakStanding,
      standWalkPeakCrouching: stepPeakCrouching,
      standWalkSteps: base.standWalkSteps,
    });
    if (Number.isNaN(boundary)) {
      notes.push(
        `standWalk: 立った足踏みとしゃがみ歩きの山の差が小さい（${stepPeakStanding.toFixed(2)}・${stepPeakCrouching.toFixed(2)} m/s^2）か歩数が 0 なので，しゃがみ歩きから立つ判定は使わない`,
      );
    } else {
      setOverride(overrides, "standWalkPeakStanding", stepPeakStanding);
      setOverride(overrides, "standWalkPeakCrouching", stepPeakCrouching);
    }
  }
  if (crouchDepth !== null) {
    setOverride(
      overrides,
      "crouchDepthM",
      clamp(crouchDepth, Math.min(CROUCH_DEPTH_PARAM_MIN, base.crouchDepthM), base.crouchDepthM),
    );
  }
  if (crouchDurationMs !== null) {
    setOverride(
      overrides,
      "postureMaxIntegrateMs",
      Math.min(
        INTEGRATE_MAX_MS,
        Math.max(base.postureMaxIntegrateMs, INTEGRATE_DURATION_FACTOR * crouchDurationMs),
      ),
    );
  }

  return {
    overrides,
    measurements: {
      restNoiseAccel,
      restNoiseBand,
      restGyroDps,
      stepPeakStanding,
      stepCountStanding,
      stepIntervalMs,
      crouchDepth,
      crouchDurationMs,
      crouchHoldNoiseAccel,
      stepPeakCrouching,
      stepCountCrouching,
      crouchingEstimated,
    },
    notes,
  };
}
