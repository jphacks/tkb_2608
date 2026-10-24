// 記録した devicemotion のサンプルを体の判定（body/bodyTracker）に流し直し，判定の時系列を作る（experiment_山﨑/10「記録の再生」）．
// しきい値（params）を差し替えて同じ記録に流せば，しきい値ごとの判定を比べられる．純粋な関数（入力のサンプルは書き換えない）
import type { Posture } from "../../core/types";
import { createBodyState, readBody, updateBody } from "../body/bodyTracker";
import { StepResult } from "../body/stepDetector";
import type { InputParams } from "../params";
import type { MotionSample } from "../sensors/types";

/** 判定の時系列（サンプルごとの値と，変化した時刻の一覧）．時刻は記録の時刻（ms） */
export interface ReplayTimeline {
  /** 判定に使ったサンプルの時刻（捨てたサンプルは含まない） */
  readonly t: Float64Array;
  /** 上下の加速度（m/s^2．上が正）・帯域通過後の値・角速度の大きさ（deg/s）．求められない時は NaN */
  readonly av: Float64Array;
  readonly bp: Float64Array;
  readonly gyro: Float64Array;
  /** そのサンプルの後の walking（1: true） */
  readonly walking: Uint8Array;
  /** そのサンプルの後の姿勢（1: しゃがむ） */
  readonly crouching: Uint8Array;
  /** 数えた歩（t: 数えた時刻，peakT: 山の時刻，peak: 山の大きさ m/s^2） */
  readonly steps: readonly { readonly t: number; readonly peakT: number; readonly peak: number }[];
  /** 数えなかった山（reason: StepResult の値） */
  readonly rejected: readonly { readonly t: number; readonly reason: StepResult }[];
  /** walking が変わった時刻と，変わった後の値 */
  readonly walkChanges: readonly { readonly t: number; readonly walking: boolean }[];
  /** 姿勢が変わった時刻と，変わった後の姿勢・判定の結果（"crouch"・"stand"・"stand-escape"） */
  readonly postureChanges: readonly {
    readonly t: number;
    readonly posture: Posture;
    readonly outcome: string;
  }[];
  /** フィルタ等を初期化した時刻（サンプルの間隔が飛んだ等） */
  readonly resets: readonly number[];
  /** 捨てたサンプルの数 */
  readonly dropped: number;
}

/**
 * サンプルの並びを判定に流し直す．initialPosture は記録の始まりの姿勢（手順の記録は立って始める）
 */
export function replayBody(
  samples: readonly MotionSample[],
  params: InputParams,
  initialPosture: Posture = "standing",
): ReplayTimeline {
  const n = samples.length;
  const t = new Float64Array(n);
  const av = new Float64Array(n);
  const bp = new Float64Array(n);
  const gyro = new Float64Array(n);
  const walking = new Uint8Array(n);
  const crouching = new Uint8Array(n);
  const steps: { t: number; peakT: number; peak: number }[] = [];
  const rejected: { t: number; reason: StepResult }[] = [];
  const walkChanges: { t: number; walking: boolean }[] = [];
  const postureChanges: { t: number; posture: Posture; outcome: string }[] = [];
  const resets: number[] = [];

  const s = createBodyState(params, initialPosture);
  let count = 0;
  let wasWalking = false;
  let posture: Posture = initialPosture;
  let resetCount = 0;
  for (const sample of samples) {
    const before = s.sampleCount;
    updateBody(s, sample, params);
    if (s.sampleCount === before) continue; // 捨てたサンプル
    const now = s.lastT;
    if (s.resetCount !== resetCount) {
      resetCount = s.resetCount;
      resets.push(now);
    }
    const out = readBody(s, now, params);
    t[count] = now;
    av[count] = s.av;
    bp[count] = s.bp;
    gyro[count] = s.gyro;
    walking[count] = out.walking ? 1 : 0;
    crouching[count] = out.posture === "crouching" ? 1 : 0;
    count++;

    if (s.lastStepResult === StepResult.Step) {
      steps.push({ t: now, peakT: s.step.lastStepT, peak: s.step.lastStepPeak });
    } else if (s.lastStepResult !== StepResult.None) {
      rejected.push({ t: now, reason: s.lastStepResult });
    }
    if (out.walking !== wasWalking) {
      wasWalking = out.walking;
      walkChanges.push({ t: now, walking: out.walking });
    }
    if (out.posture !== posture) {
      posture = out.posture;
      postureChanges.push({ t: now, posture, outcome: s.posture.lastOutcome });
    }
  }
  return {
    t: t.subarray(0, count),
    av: av.subarray(0, count),
    bp: bp.subarray(0, count),
    gyro: gyro.subarray(0, count),
    walking: walking.subarray(0, count),
    crouching: crouching.subarray(0, count),
    steps,
    rejected,
    walkChanges,
    postureChanges,
    resets,
    dropped: s.droppedCount,
  };
}

/** 時刻 time の直前（time 以下の最後）のサンプルの添え字．無ければ -1（二分探索） */
export function sampleIndexAt(timeline: ReplayTimeline, time: number): number {
  const ts = timeline.t;
  let lo = 0;
  let hi = ts.length - 1;
  let found = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (ts[mid] <= time) {
      found = mid;
      lo = mid + 1;
    } else {
      hi = mid - 1;
    }
  }
  return found;
}

/** 時刻 time の walking（その時刻より前にサンプルが無ければ false） */
export function walkingAt(timeline: ReplayTimeline, time: number): boolean {
  const i = sampleIndexAt(timeline, time);
  return i >= 0 && timeline.walking[i] === 1;
}

/** 時刻 time の姿勢（その時刻より前にサンプルが無ければ fallback） */
export function postureAt(
  timeline: ReplayTimeline,
  time: number,
  fallback: Posture = "standing",
): Posture {
  const i = sampleIndexAt(timeline, time);
  if (i < 0) return fallback;
  return timeline.crouching[i] === 1 ? "crouching" : "standing";
}
