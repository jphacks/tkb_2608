// センサーのサンプルから PlayerInput を作る（頭の向き＋体の動き）．DOM に触れない（購読は inputSource.ts の殻が行う）．
// センサーのイベントごとに状態を O(1) で進め，描画のループは read(now) で最新の状態を読むだけにする（experiment_山﨑/02）．
// 例外は外に投げない．壊れたら初期化し，read は直前の値か IDLE_PLAYER_INPUT を返す（experiment_山﨑/09）
import {
  type CalibrationProfile,
  IDLE_PLAYER_INPUT,
  type PlayerInput,
  type Posture,
  UNTRACKED_HAND,
} from "../core/types";
import {
  type BodyState,
  createBodyState,
  readBody,
  resetBody,
  updateBody,
} from "./body/bodyTracker";
import {
  createHeadState,
  type HeadState,
  readHead,
  recenterHead,
  updateHeadOrientation,
  updateHeadRotation,
  updateHeadScreenAngle,
} from "./head/headTracker";
import {
  DEFAULT_INPUT_PARAMS,
  type InputParams,
  mergeParams,
  paramsFromCalibration,
} from "./params";
import type { MotionSample, OrientationSample, ScreenSample } from "./sensors/types";

const HANDS: PlayerInput["hands"] = { left: UNTRACKED_HAND, right: UNTRACKED_HAND };

export interface DeviceTrackerOptions {
  /** lobby/ のキャリブレーションの結果．null なら既定値と仮の正面（最初の向き）で判定する */
  readonly calibration?: CalibrationProfile | null;
  /** しきい値の上書き（キャリブレーションを反映した後に重ねる） */
  readonly params?: Partial<InputParams> | null;
}

export class DeviceTracker {
  private calibration: CalibrationProfile | null;
  private overrides: Partial<InputParams>;
  private paramsValue: InputParams;
  readonly head: HeadState;
  readonly body: BodyState;
  private last: PlayerInput = IDLE_PLAYER_INPUT;
  /** devicemotion の 1 回の処理時間（ms）の合計・最大・回数（experiment_山﨑/08「計測」） */
  readonly timing = { totalMs: 0, maxMs: 0, count: 0 };

  constructor(options: DeviceTrackerOptions = {}) {
    this.calibration = options.calibration ?? null;
    this.overrides = { ...(options.params ?? {}) };
    this.paramsValue = this.buildParams();
    this.head = createHeadState();
    this.body = createBodyState(this.paramsValue);
  }

  get params(): InputParams {
    return this.paramsValue;
  }

  private buildParams(): InputParams {
    return mergeParams(
      paramsFromCalibration(DEFAULT_INPUT_PARAMS, this.calibration),
      this.overrides,
    );
  }

  /** しきい値の一部を変える（dev ページのスライダー用）．状態は保つ */
  setParams(overrides: Partial<InputParams>): void {
    this.overrides = { ...this.overrides, ...overrides };
    this.paramsValue = this.buildParams();
  }

  /** キャリブレーションを差し替える（lobby/ の後）．正面は CalibrationProfile.yawOffset に戻す */
  setCalibration(calibration: CalibrationProfile | null): void {
    this.calibration = calibration;
    this.paramsValue = this.buildParams();
    this.head.yawZeroOverrides = false;
  }

  onMotion(sample: MotionSample): void {
    const start = performance.now();
    try {
      updateHeadRotation(this.head, sample);
      updateBody(this.body, sample, this.paramsValue);
    } catch {
      this.safeReset();
    }
    const ms = performance.now() - start;
    this.timing.totalMs += ms;
    this.timing.count++;
    if (ms > this.timing.maxMs) this.timing.maxMs = ms;
  }

  onOrientation(sample: OrientationSample): void {
    try {
      updateHeadOrientation(this.head, sample);
    } catch {
      // 向きのサンプルは捨てるだけ（直前の向きを保つ）
    }
  }

  onScreen(sample: ScreenSample): void {
    updateHeadScreenAngle(this.head, sample.angle);
  }

  /** 今の向きを正面にする */
  recenter(): void {
    recenterHead(this.head);
  }

  /**
   * 体の判定を初期化する（タブが裏に回った・戻った時等）．姿勢と頭の向きは保つ．
   * 角速度は古いものを使わないよう捨てる
   */
  reset(): void {
    this.safeReset();
  }

  /**
   * 体の判定を初期化し，姿勢を posture に戻す（キャリブレーションの後等）．頭の向きは保つ．
   * resetBody が動作の途中・長い積分（slowV・slowH）・逃げ道や立った足踏みの数も 0 に戻すので，
   * 戻した姿勢から同じ動作で二重に切り替えることはない
   */
  resetPosture(posture: Posture = "standing"): void {
    this.safeReset();
    this.body.posture.posture = posture;
  }

  private safeReset(): void {
    try {
      resetBody(this.body);
      this.head.rateT = Number.NEGATIVE_INFINITY;
    } catch {
      // 初期化で失敗することは無いはずだが，外に投げない
    }
  }

  /** 今の PlayerInput を作る（描画の直前に呼ぶ．例外は投げない） */
  read(now: number): PlayerInput {
    try {
      const yaw = this.calibration?.yawOffset;
      const head = readHead(
        this.head,
        now,
        this.paramsValue,
        Number.isFinite(yaw) ? (yaw as number) : null,
      );
      const body = readBody(this.body, now, this.paramsValue);
      const input: PlayerInput = {
        time: now,
        head,
        posture: body.posture,
        walking: body.walking,
        walkSpeed: body.walkSpeed,
        hands: HANDS,
      };
      this.last = input;
      return input;
    } catch {
      // 直前の値を返す．ただし歩きは止める（迷ったら止まる）
      return { ...this.last, time: now, walking: false, walkSpeed: 0 };
    }
  }
}
