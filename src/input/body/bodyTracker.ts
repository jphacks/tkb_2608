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
  resetSlowCrouch,
  resetStandWalk,
  shouldSuppressSteps,
  updatePosture,
  updateStandWalk,
} from "./posture";
import {
  createRotationCompState,
  type DeviceVec,
  type RotationCompState,
  resetRotationComp,
  updateRotationComp,
} from "./rotationCompensation";
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
  /** 頭の回転による加速度の見積もり（params.headRotCompensation が 1 の時だけ使う） */
  rotComp: RotationCompState;
  /** 最後のサンプルで見積もった回転による加速度（m/s^2．端末の座標．使わない時は 0） */
  rotAcc: DeviceVec;
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

/** 回転の中心からスマホまでの位置の作業用（サンプルごとに new しない） */
const lever: DeviceVec = { x: 0, y: 0, z: 0 };

/** 歩いている間に T_high を下げる下限（姿勢ごとの T_high に対する割合） */
const WALK_MIN_HIGH_RATIO = 0.5;
/** 静止時のノイズ（足踏みのしきい値用）の見積もりの時定数（秒） */
const STEP_NOISE_TAU_SEC = 3;

export function createBodyState(params: InputParams, posture: Posture = "standing"): BodyState {
  return {
    vertical: createVerticalState(),
    rotComp: createRotationCompState(),
    rotAcc: { x: 0, y: 0, z: 0 },
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
    rotComp: { ...s.rotComp },
    rotAcc: { ...s.rotAcc },
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
  resetRotationComp(s.rotComp);
  s.rotAcc.x = 0;
  s.rotAcc.y = 0;
  s.rotAcc.z = 0;
  resetBiquad(s.highpass);
  resetBiquad(s.lowpass);
  s.dtEstSec = 0;
  resetStepDetector(s.step);
  resetLocomotion(s.locomotion);
  resetPostureMotion(s.posture);
  resetSlowCrouch(s.posture);
  resetStandWalk(s.posture);
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
 * 歩いている間は，T_high を直近の歩の山の平均の stepWalkPeakRatio 倍まで下げる（T_high の WALK_MIN_HIGH_RATIO 倍が下限）．
 * 1 人の足踏みの山の大きさはほぼそろっているため，歩き出した後は，その人の山の半分ほどの山も歩とみなせる．
 * 足踏みの弱い人が，歩いている途中の弱い 1 歩（0.65〜0.84 m/s^2）で途切れた（20261024-183237_curfcrp9）．
 * 歩き出し（止まっている時）は下げない（見回し・頷きの誤検出を増やさない）
 */
function walkingThresholds(s: BodyState, params: InputParams): void {
  if (s.locomotion.mode !== "walking" || !(params.stepWalkPeakRatio > 0)) return;
  const th = s.thresholds;
  const high = Math.max(
    th.high * WALK_MIN_HIGH_RATIO,
    Math.min(th.high, params.stepWalkPeakRatio * s.step.stepPeakMean),
  );
  if (!(high > 0) || !(th.high > 0)) return;
  th.low *= high / th.high;
  th.high = high;
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
  let correction: DeviceVec | null = null;
  if (params.headRotCompensation >= 0.5) {
    lever.x = params.headLeverXM;
    lever.y = params.headLeverYM;
    lever.z = params.headLeverZM;
    if (updateRotationComp(s.rotComp, sample.rot, dtSec, lever, s.rotAcc)) correction = s.rotAcc;
  } else if (s.rotComp.ready) {
    // 途中で OFF にした時，次に ON にした時の角加速度が古い角速度との差にならないようにする
    resetRotationComp(s.rotComp);
    s.rotAcc.x = 0;
    s.rotAcc.y = 0;
    s.rotAcc.z = 0;
  }
  const av = updateVertical(v, sample, dtSec, params.gravityCutoffHz, correction);
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

  // ゆっくりしたしゃがみ（漏れ付きの長い積分）は，歩いている間は使わない．足踏みの上下の揺れは上下で釣り合わず，
  // 長い積分が -0.1 m ほどずれたまま，強い 1 歩で基準を超えた（20261024-143537_o0qich1i．正解の無い記録）
  if (s.locomotion.mode !== "stopped") resetSlowCrouch(s.posture, false);
  // しゃがみ・立ち上がり（歩いている間も止めない）
  updatePosture(s.posture, t, dtSec, av, gyro, params);

  // 足踏みの山（姿勢ごとのしきい値）
  postureThresholds(s, params);
  walkingThresholds(s, params);
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
  // しゃがみ歩きから止まらずに立つ（人ごとの山の大きさが分かっている時だけ．頭の回転は足踏みの判定と同じしきい値で見る）
  updateStandWalk(
    s.posture,
    t,
    bp,
    s.step.lastStepT,
    s.locomotion.mode !== "stopped",
    s.locomotion.mode !== "stopped" ? s.step.lastGyroRelaxedT : s.step.lastGyroHighT,
    params,
  );
  updateLocomotion(s.locomotion, t, dtSec, params);
  // 静止時のノイズは，止まっていて頭も回っていない時の，基準のしきい値未満の値だけで見積もる．
  // 以前は「今のしきい値」未満の値をすべて入れていたため，頷き（帯域通過後 2〜4 m/s^2）の間にノイズが育ち，
  // T_high が 4 m/s^2 を超えたまま次の足踏み（山 1〜1.5 m/s^2）を数えなかった
  // （20261024-175827_3uehweky: 頷きの直後の step_in_place で 30 歩中 2 歩）
  if (s.locomotion.mode === "stopped" && (!Number.isFinite(gyro) || gyro < params.zuptGyroDps)) {
    const baseHigh =
      s.posture.posture === "crouching" ? params.stepHighCrouching : params.stepHighStanding;
    updateStepNoise(s.step, bp, baseHigh, dtSec, STEP_NOISE_TAU_SEC);
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
