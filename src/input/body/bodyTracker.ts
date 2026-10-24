// 体の動きの判定（姿勢 × 移動の 2 軸．experiment_山﨑/02・04・05）．devicemotion の 1 サンプルごとに O(1) で進める．
// 重力の向きへの射影 → 帯域通過 → 山の検出 → 足踏みの状態機械と速さ，と，同じ上下の加速度からしゃがみ・立ち上がり．
// 純粋な関数: 書き換える版（updateBody）を基本にし，テスト用に新しく返す版（stepBody）を置く（experiment_山﨑/08）．
// フェイルセーフ（experiment_山﨑/09）: dt が 0 以下のサンプルは捨てる，間隔が飛んだらフィルタを初期化する，
// 値が壊れたら姿勢以外を初期化する，最後のサンプルから時間がたったら walking を false にする
import type { Posture } from "../../core/types";
import type { InputParams } from "../params";
import type { MotionSample } from "../sensors/types";
import { type Biquad, biquadStepAt, createBiquad, resetBiquad } from "./biquad";
import {
  createLocomotionState,
  isWalking,
  type LocomotionState,
  onLocomotionStep,
  resetLocomotion,
  updateLocomotion,
} from "./locomotion";
import {
  createPostureState,
  onPostureStep,
  type PostureState,
  resetPostureMotion,
  shouldSuppressSteps,
  updatePosture,
} from "./posture";
import {
  createStepDetectorState,
  effectiveThresholdsInto,
  resetStepDetector,
  type StepDetectorState,
  StepResult,
  type StepThresholds,
  updateStepDetector,
  updateStepNoise,
} from "./stepDetector";
import {
  createVerticalState,
  gyroMagnitude,
  resetVertical,
  updateVertical,
  type VerticalState,
} from "./vertical";

export interface BodyState {
  vertical: VerticalState;
  /** 帯域通過（高域通過 → 低域通過） */
  highpass: Biquad;
  lowpass: Biquad;
  /** サンプルの間隔の見積もり（秒．指数移動平均）．フィルタの係数に使う */
  dtEstSec: number;
  step: StepDetectorState;
  /** 今の姿勢での実際のしきい値 */
  thresholds: StepThresholds;
  locomotion: LocomotionState;
  posture: PostureState;
  /** 最後に使ったサンプルの時刻（ms）．まだ無ければ NaN */
  lastT: number;
  // ---- 途中の値（dev ページと記録用．最後のサンプルの値） ----
  /** 上下の加速度（m/s^2．上が正） */
  av: number;
  /** 帯域通過後の上下の加速度 */
  bp: number;
  /** 角速度の大きさ（deg/s） */
  gyro: number;
  /** 最後のサンプルの山の検出の結果 */
  lastStepResult: StepResult;
  /** 使ったサンプル・捨てたサンプル・初期化した回数 */
  sampleCount: number;
  droppedCount: number;
  resetCount: number;
}

/** 静止時のノイズ（足踏みのしきい値用）の見積もりの時定数（秒） */
const STEP_NOISE_TAU_SEC = 3;

export function createBodyState(params: InputParams, posture: Posture = "standing"): BodyState {
  return {
    vertical: createVerticalState(),
    highpass: createBiquad("highpass", params.stepBandLowHz),
    lowpass: createBiquad("lowpass", params.stepBandHighHz),
    dtEstSec: 0,
    step: createStepDetectorState(),
    thresholds: { high: params.stepHighStanding, low: params.stepLowStanding },
    locomotion: createLocomotionState(),
    posture: createPostureState(posture),
    lastT: Number.NaN,
    av: Number.NaN,
    bp: Number.NaN,
    gyro: Number.NaN,
    lastStepResult: StepResult.None,
    sampleCount: 0,
    droppedCount: 0,
    resetCount: 0,
  };
}

/** 新しく返す版のための複製 */
export function cloneBodyState(s: BodyState): BodyState {
  return {
    ...s,
    vertical: { ...s.vertical },
    highpass: { ...s.highpass },
    lowpass: { ...s.lowpass },
    step: { ...s.step },
    thresholds: { ...s.thresholds },
    locomotion: { ...s.locomotion },
    posture: { ...s.posture },
  };
}

/** フィルタ・歩き・動作の途中を初期化する．姿勢は保つ（experiment_山﨑/09「姿勢は保つ」） */
export function resetBody(s: BodyState): void {
  resetVertical(s.vertical);
  resetBiquad(s.highpass);
  resetBiquad(s.lowpass);
  s.dtEstSec = 0;
  resetStepDetector(s.step);
  resetLocomotion(s.locomotion);
  resetPostureMotion(s.posture);
  s.lastT = Number.NaN;
  s.av = Number.NaN;
  s.bp = Number.NaN;
  s.lastStepResult = StepResult.None;
  s.resetCount++;
}

function postureThresholds(s: BodyState, params: InputParams): void {
  const crouching = s.posture.posture === "crouching";
  effectiveThresholdsInto(
    s.thresholds,
    s.step,
    crouching ? params.stepHighCrouching : params.stepHighStanding,
    crouching ? params.stepLowCrouching : params.stepLowStanding,
    params.stepNoiseFactor,
  );
}

/**
 * devicemotion の 1 サンプル分進める（状態を書き換える．例外は投げない）．
 * - 時刻が前より進んでいないサンプルは捨てる
 * - 間隔が maxSampleGapMs を超えたら（タブが裏に回った等）初期化してから，このサンプルを最初のサンプルにする
 */
export function updateBody(s: BodyState, sample: MotionSample, params: InputParams): void {
  const t = sample.t;
  if (!Number.isFinite(t)) {
    s.droppedCount++;
    return;
  }
  if (!Number.isNaN(s.lastT)) {
    const gapMs = t - s.lastT;
    if (!(gapMs > 0)) {
      s.droppedCount++;
      return;
    }
    if (gapMs > params.maxSampleGapMs) resetBody(s);
  }
  const first = Number.isNaN(s.lastT);
  const dtSec = first ? 0 : (t - s.lastT) / 1000;
  s.lastT = t;
  s.sampleCount++;

  // 防御: 重力の見積もりが壊れていたら（非有限）取り直す
  const v = s.vertical;
  if (!Number.isFinite(v.gx) || !Number.isFinite(v.gy) || !Number.isFinite(v.gz)) {
    resetVertical(v);
  }
  const av = updateVertical(v, sample, dtSec, params.gravityCutoffHz);
  const gyro = gyroMagnitude(sample);
  s.av = av;
  s.gyro = gyro;
  s.lastStepResult = StepResult.None;
  if (first || !Number.isFinite(av)) {
    s.bp = Number.NaN;
    return;
  }

  s.dtEstSec = s.dtEstSec > 0 ? s.dtEstSec + (dtSec - s.dtEstSec) * 0.05 : dtSec;
  const fs = 1 / s.dtEstSec;
  const bp = biquadStepAt(
    s.lowpass,
    biquadStepAt(s.highpass, av, fs, params.stepBandLowHz),
    fs,
    params.stepBandHighHz,
  );
  s.bp = bp;

  // しゃがみ・立ち上がり（歩いている間も止めない）
  updatePosture(s.posture, t, dtSec, av, gyro, params);

  // 足踏みの山（姿勢ごとのしきい値）
  postureThresholds(s, params);
  const result = updateStepDetector(
    s.step,
    t,
    bp,
    gyro,
    s.thresholds,
    params,
    shouldSuppressSteps(s.posture, t, params),
    s.locomotion.mode !== "stopped",
  );
  s.lastStepResult = result;
  if (result === StepResult.Step) {
    onLocomotionStep(s.locomotion, s.step.lastStepT, params);
    // 案 A の逃げ道は「立っている時の」しきい値（ノイズで底上げした値）と比べる
    const standingHigh = Math.max(
      params.stepHighStanding,
      params.stepNoiseFactor * Math.sqrt(Math.max(0, s.step.noiseVar)),
    );
    onPostureStep(s.posture, t, s.step.lastStepPeak, standingHigh, params);
  }
  updateLocomotion(s.locomotion, t, dtSec, params);
  if (s.locomotion.mode === "stopped") {
    updateStepNoise(s.step, bp, s.thresholds.high, dtSec, STEP_NOISE_TAU_SEC);
  }

  // 値が壊れていたら（NaN が混じった等）姿勢以外を初期化する
  if (
    !Number.isFinite(s.highpass.y1) ||
    !Number.isFinite(s.lowpass.y1) ||
    !Number.isFinite(s.locomotion.speed) ||
    !Number.isFinite(s.posture.h) ||
    !Number.isFinite(s.step.noiseVar)
  ) {
    s.step.noiseVar = 0;
    s.posture.noiseVar = 0;
    resetBody(s);
  }
}

/** テスト用: 新しく返す版 */
export function stepBody(s: BodyState, sample: MotionSample, params: InputParams): BodyState {
  const next = cloneBodyState(s);
  updateBody(next, sample, params);
  return next;
}

/** 外に出す体の状態 */
export interface BodyOutput {
  readonly posture: Posture;
  readonly walking: boolean;
  readonly walkSpeed: number;
}

/**
 * 今の時刻 now（ms）の体の状態を読む（状態は書き換えない）．
 * 最後のサンプルから sensorTimeoutMs たっていれば，walking を false にする（迷ったら止まる）
 */
export function readBody(s: BodyState, now: number, params: InputParams): BodyOutput {
  const stale = Number.isNaN(s.lastT) || !(now - s.lastT <= params.sensorTimeoutMs);
  const walking = !stale && isWalking(s.locomotion);
  const speed = s.locomotion.speed;
  return {
    posture: s.posture.posture,
    walking,
    walkSpeed: walking && Number.isFinite(speed) ? Math.max(0, speed) : 0,
  };
}
