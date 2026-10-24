// キャリブレーションのうち正面（yawOffset）だけを入力に効かせるための変換（暫定．Issue #58）
import type { CalibrationProfile } from "../core/types";

/**
 * しきい値（stepPeakThreshold・crouchThreshold）を範囲外の値（NaN）にした CalibrationProfile を返す．
 * input/ の paramsFromCalibration() は範囲外の項目を無視して既定のしきい値を使うため，正面だけが効く．
 * lobby/ と input/ でしきい値の意味（単位・測り方）がそろうまでの暫定（Issue #58）
 */
export function yawOnly(calibration: CalibrationProfile): CalibrationProfile {
  return { ...calibration, stepPeakThreshold: Number.NaN, crouchThreshold: Number.NaN };
}
