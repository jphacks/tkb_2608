// キャリブレーションのうち正面（yawOffset）と手順の区間（segments）だけを入力に渡すための変換（暫定．Issue #58）
import type { CalibrationProfile } from "../core/types";

/**
 * 非推奨のしきい値（stepPeakThreshold・crouchThreshold）を範囲外の値（NaN）にした CalibrationProfile を返す．
 * input/ の paramsFromCalibration() は範囲外の項目を無視して既定のしきい値を使うため，誤った意味で読まれない．
 * 正面（yawOffset）と手順の区間（segments）はそのまま渡す（しきい値は input/ が segments から求める）．
 * input/ が segments から求める形に移り，非推奨の項目が消えたら外す（Issue #58）
 */
export function yawOnly(calibration: CalibrationProfile): CalibrationProfile {
  return { ...calibration, stepPeakThreshold: Number.NaN, crouchThreshold: Number.NaN };
}
