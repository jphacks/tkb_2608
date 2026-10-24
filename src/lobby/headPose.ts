// 頭の向き（PlayerInput.head）を，端末の向きか PC 確認用のドラッグから作る（DOM に依存しない純粋な関数）．
// 仮実装．input/（担当D）の PlayerInput.head ができたら置き換える

import type { SceneId } from "../core/scene";
import type { CalibrationProfile, Quat } from "../core/types";
import type { OrientationSample } from "./calibration";
import { deviceOrientationToQuat, multiplyQuat } from "./orientation";

/** 頭の向きの入力源．device = 端末の向き（deviceorientation），drag = PC 確認用のドラッグ */
export type HeadSource = "device" | "drag";

/** 使える端末の向きのサンプルが届いていれば端末の向き，無ければ（PC・センサーが許可されていない等）ドラッグ */
export function selectHeadSource(latest: OrientationSample | null): HeadSource {
  if (latest === null) return "drag";
  const values = [latest.alpha, latest.beta, latest.gamma, latest.screenAngle];
  return values.every(Number.isFinite) ? "device" : "drag";
}

/** 端末の向きのサンプル（度）を頭の向きのクォータニオンにする（正面リセット前の生の向き） */
export function headFromOrientation(sample: OrientationSample): Quat {
  return deviceOrientationToQuat(sample.alpha, sample.beta, sample.gamma, sample.screenAngle);
}

/**
 * 正面リセット（yawOffset の差し引き）をするか．キャリブレーションの値がある時だけ行う．
 * ロビーでは差し引かない（ロビーは生の向きで正面を測り直すため．もう一度の時も前回の値で測る値をずらさない）
 */
export function shouldApplyYawOffset(
  scene: SceneId | null,
  calibration: CalibrationProfile | null,
): boolean {
  return calibration !== null && scene !== "lobby";
}

/**
 * 頭の向きから yawOffset（rad．正で左）を差し引き，体験者の正面が -Z になるようにする．
 * 世界の Y 軸回りに -yawOffset 回す（頭の傾きは変えず，ヨー角だけが yawOffset だけ減る）
 */
export function removeYawOffset(head: Quat, yawOffset: number): Quat {
  if (!Number.isFinite(yawOffset) || yawOffset === 0) return head;
  const half = -yawOffset / 2;
  const turn: Quat = { x: 0, y: Math.sin(half), z: 0, w: Math.cos(half) };
  return multiplyQuat(turn, head);
}

export interface HeadPoseInput {
  /** 最後に届いた端末の向き（無ければ null） */
  readonly latest: OrientationSample | null;
  /** PC 確認用のドラッグの向き */
  readonly drag: Quat;
  /** 今の画面 */
  readonly scene: SceneId | null;
  readonly calibration: CalibrationProfile | null;
}

/** PlayerInput.head に入れる頭の向きを決める */
export function resolveHeadPose(input: HeadPoseInput): Quat {
  const raw =
    selectHeadSource(input.latest) === "device" && input.latest !== null
      ? headFromOrientation(input.latest)
      : input.drag;
  if (!shouldApplyYawOffset(input.scene, input.calibration) || input.calibration === null) {
    return raw;
  }
  return removeYawOffset(raw, input.calibration.yawOffset);
}
