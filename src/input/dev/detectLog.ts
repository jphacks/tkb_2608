// dev ページ共通: 判定の途中の値（detect）と結果の変化（state）をフライトレコーダーのレコードにする．
// devicemotion のサンプルを tracker に渡した後に onMotion を呼ぶ．変化は前回の値と比べて見つける（判定の側に手を入れない）
import { StepResult } from "../body/stepDetector";
import type { DeviceTracker } from "../deviceTracker";
import { INPUT_PARAM_KEYS, type InputParams } from "../params";
import { detectRecord, type InputRecord, roundTo, type StateRecord } from "../recorder/records";

const REJECT_REASON: Record<number, string> = {
  [StepResult.RejectedGyro]: "gyro",
  [StepResult.RejectedRefractory]: "refractory",
  [StepResult.RejectedSuppressed]: "posture-motion",
};

export class DetectLogger {
  private loco = "stopped";
  private posture = "standing";
  private walking = false;
  private outcomeT = Number.NEGATIVE_INFINITY;
  private resetCount = 0;

  constructor(
    private readonly record: (r: InputRecord) => void,
    /** 結果が変わった時（音の合図・表示用） */
    private readonly onState?: (r: StateRecord) => void,
  ) {}

  private emit(tracker: DeviceTracker, t: number, event: string, value?: number, detail?: string) {
    const body = tracker.body;
    const out = tracker.read(t);
    const r: StateRecord = {
      type: "state",
      t: roundTo(t, 3) ?? 0,
      event,
      posture: body.posture.posture,
      loco: body.locomotion.mode,
      walking: out.walking,
      walkSpeed: roundTo(out.walkSpeed, 3),
      ...(value === undefined ? {} : { value: roundTo(value, 4) }),
      ...(detail === undefined ? {} : { detail }),
    };
    this.record(r);
    this.onState?.(r);
  }

  onMotion(t: number, tracker: DeviceTracker): void {
    const b = tracker.body;
    this.record(
      detectRecord({
        t,
        av: b.av,
        bp: b.bp,
        high: b.thresholds.high,
        low: b.thresholds.low,
        gyro: b.gyro,
        loco: b.locomotion.mode,
        speed: b.locomotion.speed,
        phase: b.posture.phase,
        v: b.posture.v,
        h: b.posture.h,
        step: b.lastStepResult,
      }),
    );

    if (b.resetCount !== this.resetCount) {
      this.resetCount = b.resetCount;
      this.emit(tracker, t, "reset");
    }
    if (b.lastStepResult === StepResult.Step) {
      this.emit(tracker, t, "step", b.step.lastStepPeak);
    } else if (b.lastStepResult !== StepResult.None) {
      this.emit(tracker, t, "step-rejected", b.step.peakValue, REJECT_REASON[b.lastStepResult]);
    }
    if (b.posture.lastOutcomeT !== this.outcomeT) {
      this.outcomeT = b.posture.lastOutcomeT;
      this.emit(tracker, t, "posture-motion", b.posture.lastDeltaH, b.posture.lastOutcome);
    }
    if (b.posture.posture !== this.posture) {
      this.posture = b.posture.posture;
      this.emit(tracker, t, "posture", b.posture.lastDeltaH, b.posture.lastOutcome);
    }
    const walking = tracker.read(t).walking;
    if (b.locomotion.mode !== this.loco || walking !== this.walking) {
      this.loco = b.locomotion.mode;
      this.walking = walking;
      this.emit(tracker, t, "locomotion");
    }
  }
}

/** しきい値の全体を params レコードにする */
export function paramsRecord(t: number, params: InputParams): InputRecord {
  const out: Record<string, number> = {};
  for (const key of INPUT_PARAM_KEYS) out[key] = params[key];
  return { type: "params", t: roundTo(t, 3) ?? 0, params: out };
}
