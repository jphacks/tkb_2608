// 記録したセンサーの値を，今のコードの判定（body/）に流し直す（DOM に依存しない純粋な関数）．
// 再生と調整のページ（しきい値を変えた前後の比較）と回帰テストで使う（experiment_山﨑/10「記録の再生」）
import type { Posture } from "../../core/types";
import { createBodyState, readBody, resetBody, updateBody } from "../body/bodyTracker";
import { StepResult } from "../body/stepDetector";
import type { InputParams } from "../params";
import type { InputRecord } from "../recorder/records";
import { motionSampleOf, sortRecordsByTime } from "./replayLog";

/** 判定し直した途中の値（motion の 1 サンプルごと．配列はすべて同じ長さ） */
export interface RejudgeTimeline {
  /** 時刻（記録の performance.now() の ms） */
  readonly t: number[];
  /** 上下の加速度・帯域通過後・T_high・T_low（m/s^2．求められない値は NaN） */
  readonly av: number[];
  readonly bp: number[];
  readonly high: number[];
  readonly low: number[];
  /** 積分中の高さの変化（m） */
  readonly h: number[];
  /** 前進の速さ（m/s．walking でなければ 0） */
  readonly speed: number[];
  /** 角速度の大きさ（deg/s） */
  readonly gyro: number[];
  readonly walking: boolean[];
  readonly posture: Posture[];
  /** 山の検出の結果（StepResult） */
  readonly step: number[];
}

/** 時刻の区間（ms）．endT は状態が終わった最初のサンプルの時刻（最後まで続けば最後のサンプル） */
export interface TimeSpan {
  readonly startT: number;
  readonly endT: number;
}

export interface RejudgeResult {
  readonly timeline: RejudgeTimeline;
  /** 数えた歩の時刻（ms） */
  readonly steps: number[];
  /** 除外した山の時刻（ms） */
  readonly rejectedSteps: number[];
  /** walking が true だった区間 */
  readonly walkingSpans: TimeSpan[];
  /** しゃがんでいた区間 */
  readonly crouchSpans: TimeSpan[];
  /** 姿勢が切り替わった時刻と切り替わった後の姿勢 */
  readonly postureChanges: { readonly t: number; readonly posture: Posture }[];
}

function emptyTimeline(): RejudgeTimeline {
  return {
    t: [],
    av: [],
    bp: [],
    high: [],
    low: [],
    h: [],
    speed: [],
    gyro: [],
    walking: [],
    posture: [],
    step: [],
  };
}

/** 真偽の列から true の区間を作る */
function spansOf(t: readonly number[], on: (i: number) => boolean): TimeSpan[] {
  const out: TimeSpan[] = [];
  let start: number | null = null;
  for (let i = 0; i < t.length; i++) {
    if (on(i)) {
      if (start === null) start = t[i];
    } else if (start !== null) {
      out.push({ startT: start, endT: t[i] });
      start = null;
    }
  }
  if (start !== null) out.push({ startT: start, endT: t[t.length - 1] });
  return out;
}

/**
 * 記録の motion を時刻の順に判定へ流し，サンプルごとの途中の値と判定の結果をまとめる．
 * visibility（タブの切り替え）では本物の入力と同じく体の判定を初期化する（姿勢は保つ）．
 * 判定の状態は毎回新しく作るため，同じ記録・同じしきい値なら同じ結果になる
 */
export function rejudgeRecords(
  records: readonly InputRecord[],
  params: InputParams,
  initialPosture: Posture = "standing",
): RejudgeResult {
  const body = createBodyState(params, initialPosture);
  const tl = emptyTimeline();
  const steps: number[] = [];
  const rejectedSteps: number[] = [];
  const postureChanges: { t: number; posture: Posture }[] = [];
  let posture = initialPosture;
  for (const r of sortRecordsByTime(records)) {
    if (r.type === "visibility") {
      resetBody(body);
      continue;
    }
    if (r.type !== "motion") continue;
    updateBody(body, motionSampleOf(r), params);
    const out = readBody(body, r.t, params);
    tl.t.push(r.t);
    tl.av.push(body.av);
    tl.bp.push(body.bp);
    tl.high.push(body.thresholds.high);
    tl.low.push(body.thresholds.low);
    tl.h.push(body.posture.h);
    tl.speed.push(out.walkSpeed);
    tl.gyro.push(body.gyro);
    tl.walking.push(out.walking);
    tl.posture.push(out.posture);
    tl.step.push(body.lastStepResult);
    if (body.lastStepResult === StepResult.Step) steps.push(r.t);
    else if (body.lastStepResult !== StepResult.None) rejectedSteps.push(r.t);
    if (out.posture !== posture) {
      posture = out.posture;
      postureChanges.push({ t: r.t, posture });
    }
  }
  return {
    timeline: tl,
    steps,
    rejectedSteps,
    walkingSpans: spansOf(tl.t, (i) => tl.walking[i]),
    crouchSpans: spansOf(tl.t, (i) => tl.posture[i] === "crouching"),
    postureChanges,
  };
}
