// ロビーで測った区間（CalibrationProfile.segments）から，?app の足踏み・しゃがみの判定のしきい値を求めてつなぐ部品．
// ロビーの間の motion のサンプルをため（上限つき），input/ の calibrateParams() に渡す（計算は input/ が行う）．
// 「同じ訓練をもう一度」で区間が前回のままなら，前回求めた値を保つ（その時はもう区間のサンプルが無いため）

import type { CalibrationSegment } from "../core/types";
import { type CalibrationResult, calibrateParams } from "../input/body/calibration";
import { DEFAULT_INPUT_PARAMS, type InputParamKey, type InputParams } from "../input/params";
import type { MotionSample } from "../input/sensors/types";

/**
 * ためるサンプルの時間の幅（ms）．最初の区間（立つ）の始まりから Session.calibration を書くまで
 * （練習 4 つ × 約 20 秒 ＋ 終わり）を覆い，縦向きの案内で 1 度やり直しても足りる長さにする
 */
export const LOBBY_SAMPLE_WINDOW_MS = 180_000;
/** ためるサンプルの数の上限（200 Hz で 180 秒分．端末のサンプルの頻度が高くても増え続けないため） */
export const LOBBY_SAMPLE_MAX_COUNT = 36_000;

/** 時刻の幅と数に上限があるサンプルのため場（センサーのイベントごとに push する） */
export interface MotionSampleBuffer {
  push(sample: MotionSample): void;
  /** ためたサンプル（古い順） */
  snapshot(): readonly MotionSample[];
  clear(): void;
}

/** 古いサンプルを捨てた分がこれを超えたら配列を詰める（毎回 shift しないため） */
const COMPACT_THRESHOLD = 4096;

export function createMotionSampleBuffer(
  windowMs: number = LOBBY_SAMPLE_WINDOW_MS,
  maxCount: number = LOBBY_SAMPLE_MAX_COUNT,
): MotionSampleBuffer {
  let samples: MotionSample[] = [];
  let head = 0;
  return {
    push(sample) {
      if (!Number.isFinite(sample.t)) return;
      samples.push(sample);
      const oldest = sample.t - windowMs;
      while (head < samples.length && (samples[head]?.t ?? oldest) < oldest) head++;
      if (samples.length - head > maxCount) head = samples.length - maxCount;
      if (head > COMPACT_THRESHOLD) {
        samples = samples.slice(head);
        head = 0;
      }
    },
    snapshot() {
      return samples.slice(head);
    },
    clear() {
      samples = [];
      head = 0;
    },
  };
}

/** 判定に反映した値（次に区間が同じなら使い回す） */
export interface AppliedLobbyParams {
  readonly segments: readonly CalibrationSegment[];
  readonly result: CalibrationResult;
}

/** 区間の並びが同じか（種類・時刻・結果） */
export function sameSegments(
  a: readonly CalibrationSegment[],
  b: readonly CalibrationSegment[],
): boolean {
  if (a.length !== b.length) return false;
  return a.every((s, i) => {
    const o = b[i];
    return (
      o !== undefined &&
      s.kind === o.kind &&
      s.startMs === o.startMs &&
      s.endMs === o.endMs &&
      s.outcome === o.outcome
    );
  });
}

/**
 * ロビーの区間から判定の値を求める．区間が前回反映したものと同じなら前回の結果をそのまま返す
 * （「同じ訓練をもう一度」．区間のサンプルはもう無いため，求め直すと既定値に戻ってしまう）．
 * base は上書きの基準（?app はしきい値の URL パラメータを使わないため既定値）
 */
export function resolveLobbyParams(
  samples: readonly MotionSample[],
  segments: readonly CalibrationSegment[],
  previous: AppliedLobbyParams | null,
  base: InputParams = DEFAULT_INPUT_PARAMS,
): AppliedLobbyParams {
  if (previous !== null && sameSegments(previous.segments, segments)) return previous;
  return { segments, result: calibrateParams(samples, segments, base) };
}

/**
 * DeviceTracker.setParams に渡す上書き．setParams は前の上書きに重ねるため，前回は上書きしたが
 * 今回は求められなかった項目は base の値に戻す
 */
export function replacingOverrides(
  previous: Partial<Record<InputParamKey, number>> | null,
  next: Partial<Record<InputParamKey, number>>,
  base: InputParams = DEFAULT_INPUT_PARAMS,
): Partial<Record<InputParamKey, number>> {
  const out: Partial<Record<InputParamKey, number>> = {};
  if (previous !== null) {
    for (const key of Object.keys(previous) as InputParamKey[]) {
      if (!(key in next)) out[key] = base[key];
    }
  }
  return { ...out, ...next };
}

function n(v: number | undefined): string {
  return v === undefined || !Number.isFinite(v) ? "-" : v.toFixed(2);
}

/**
 * ?debug の表示用の文字列．上書きした項目と値，使った区間，値を使わなかった理由（notes）を出す
 */
export function describeLobbyParams(applied: AppliedLobbyParams | null): string {
  if (applied === null) return "calibration: まだ（ロビーの練習の後に反映）";
  const { overrides, measurements: m, notes } = applied.result;
  const keys = Object.keys(overrides) as InputParamKey[];
  const lines = [
    `calibration: segments ${applied.segments.map((s) => `${s.kind}(${s.outcome})`).join(" ") || "-"}`,
    `overrides: ${keys.length === 0 ? "なし（既定値のまま）" : keys.map((k) => `${k}=${n(overrides[k])}`).join(" ")}`,
    `measured: rest ${n(m.restNoiseAccel ?? undefined)} step ${n(m.stepPeakStanding ?? undefined)}(${m.stepCountStanding}) depth ${n(m.crouchDepth ?? undefined)}m crouchStep ${n(m.stepPeakCrouching ?? undefined)}(${m.stepCountCrouching})${m.crouchingEstimated ? " 見積" : ""}`,
  ];
  for (const note of notes) lines.push(`note: ${note}`);
  return lines.join("\n");
}
