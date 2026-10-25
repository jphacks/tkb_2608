// テスト用の共通の材料（本番のコードからは import しない）．
// しきい値は DEFAULT_INPUT_PARAMS（実機の記録で調整中の仮の値）に依存させず，テストの中で明示する
import type { InputParams } from "./params";
import type { MotionSample, RotationRate } from "./sensors/types";

/** テストで使うしきい値（全項目を明示する．既定値が変わってもテストの前提は変わらない） */
export const TEST_PARAMS: InputParams = {
  headPredictionMs: 30,
  headPredictionMinDps: 5,
  headPredictionMaxAgeMs: 100,

  gravityCutoffHz: 0.3,
  stepBandLowHz: 1.0,
  stepBandHighHz: 3.0,

  stepHighStanding: 1.0,
  stepLowStanding: 0.3,
  stepHighCrouching: 0.6,
  stepLowCrouching: 0.2,
  stepNoiseFactor: 3,
  stepRefractoryMs: 250,
  stepGyroRejectDps: 100,
  stepGyroRelaxWalking: 1.5,
  stepGyroWindowMs: 200,
  // 以下の新しい項目は既定では無効にする（既存のテストの前提を変えない．使うテストで明示して有効にする）
  stepGyroMeanRejectDps: 0,
  stepWeakRatio: 1,
  stepWalkPeakRatio: 0,
  headRotCompensation: 0,
  headLeverXM: 0,
  headLeverYM: 0,
  headLeverZM: -0.16,

  stepMinIntervalMs: 300,
  stepTentativeTimeoutMs: 1000,
  stepStopPeriodFactor: 1.5,
  stepStopMaxMs: 1000,
  strideM: 0.5,
  maxWalkSpeed: 1.4,
  tentativeWalkSpeed: 0.4,
  speedSpringOmega: 8,
  speedMaxAccel: 2,
  speedMaxDecel: 4,

  postureCandidateAccel: 0.8,
  postureNoiseFactor: 4,
  postureCandidateMs: 100,
  postureRestBeforeMs: 150,
  postureMaxIntegrateMs: 1500,
  zuptAccel: 0.35,
  zuptGyroDps: 25,
  zuptMaxVelocity: 0.25,
  zuptMs: 150,
  crouchDepthM: 0.4,
  postureConfirmRatio: 0.5,
  postureStepSuppressM: 0.08,
  postureStepSuppressAfterMs: 500,
  standEscapeSteps: 4,
  postureSlowGyroDps: 0,
  standWalkPeakStanding: 0,
  standWalkPeakCrouching: 0,
  standWalkSteps: 4,

  sensorTimeoutMs: 300,
  maxSampleGapMs: 200,
};

export function testParams(overrides: Partial<InputParams> = {}): InputParams {
  return { ...TEST_PARAMS, ...overrides };
}

export const G = 9.81;

/** 上下の加速度 av（上が正）の列を，端末の y 軸が上の静止した姿勢の MotionSample にする */
export function verticalSample(
  t: number,
  av: number,
  gyroDps = 0,
  options: { withAcc?: boolean } = {},
): MotionSample {
  const rot: RotationRate = { alpha: 0, beta: gyroDps, gamma: 0 };
  return {
    t,
    acc: options.withAcc === false ? null : { x: 0, y: av, z: 0 },
    accG: { x: 0, y: G + av, z: 0 },
    rot,
    interval: 16,
  };
}

/** 一定の周期 dtMs で，関数 f(tSec) の上下の加速度のサンプルを作る */
export function samplesOf(
  startMs: number,
  durationMs: number,
  dtMs: number,
  f: (tSec: number) => number,
  gyro: (tSec: number) => number = () => 0,
): MotionSample[] {
  const out: MotionSample[] = [];
  const n = Math.round(durationMs / dtMs);
  for (let i = 0; i < n; i++) {
    const t = startMs + i * dtMs;
    const sec = (t - startMs) / 1000;
    out.push(verticalSample(t, f(sec), gyro(sec)));
  }
  return out;
}

/**
 * 深さ depthM を durationSec でしゃがむ（立つなら負の depth で上へ）上下の加速度．
 * 1 周期の正弦の加速度（下へ加速 → 減速して止まる）．変位は -depth（滑らかに 0 → -depth）
 */
export function crouchAccel(depthM: number, durationSec: number): (tSec: number) => number {
  const w = (2 * Math.PI) / durationSec;
  const a = (2 * Math.PI * depthM) / (durationSec * durationSec);
  return (t) => (t < 0 || t > durationSec ? 0 : -a * Math.sin(w * t));
}
