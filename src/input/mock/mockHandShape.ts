// モック入力（マウス）の右手の 21 点の決め打ちの形（開いた手・握った手）．純粋な関数．
// 番号は MediaPipe の HandLandmarker と同じ．手の甲を自分に向け，指を上に立てた右手（親指が左）を頭の座標系で表す
import type { Vec3 } from "../../core/types";

type Point = readonly [number, number, number];

/** 開いた右手の 21 点（頭の座標系の位置．m．x が右，y が上，-z が奥） */
const OPEN_RIGHT: readonly Point[] = [
  [0, -0.07, 0],
  [-0.025, -0.055, 0],
  [-0.045, -0.035, -0.005],
  [-0.06, -0.015, -0.01],
  [-0.07, 0.005, -0.015],
  [-0.022, 0.02, 0],
  [-0.026, 0.055, 0],
  [-0.028, 0.078, 0],
  [-0.03, 0.098, 0],
  [-0.002, 0.023, 0],
  [-0.002, 0.062, 0],
  [-0.002, 0.088, 0],
  [-0.002, 0.11, 0],
  [0.017, 0.019, 0],
  [0.02, 0.053, 0],
  [0.022, 0.077, 0],
  [0.024, 0.096, 0],
  [0.033, 0.012, 0],
  [0.04, 0.037, 0],
  [0.045, 0.053, 0],
  [0.049, 0.068, 0],
];

/** 握った右手の 21 点（指を奥へ折りたたみ，親指を人差し指・中指の前に回す．m） */
const FIST_RIGHT: readonly Point[] = [
  [0, -0.07, 0],
  [-0.025, -0.055, -0.005],
  [-0.04, -0.035, -0.02],
  [-0.03, -0.015, -0.04],
  [-0.012, -0.005, -0.045],
  [-0.022, 0.02, 0],
  [-0.024, 0.035, -0.025],
  [-0.024, 0.015, -0.04],
  [-0.022, 0, -0.03],
  [-0.002, 0.023, 0],
  [-0.002, 0.038, -0.027],
  [-0.002, 0.016, -0.043],
  [-0.002, 0, -0.032],
  [0.017, 0.019, 0],
  [0.019, 0.033, -0.025],
  [0.019, 0.013, -0.039],
  [0.018, -0.002, -0.029],
  [0.033, 0.012, 0],
  [0.036, 0.024, -0.02],
  [0.036, 0.008, -0.032],
  [0.034, -0.004, -0.025],
];

/** 手のひらの中心に使う点（input/hand の palmCenter と同じ: 手首と 4 本の指の付け根） */
const PALM_IDS: readonly number[] = [0, 5, 9, 13, 17];

/** 手のひらの中心からのずれにした形（手のひらの中心が HandState.position に重なるようにする） */
function relativeToPalm(points: readonly Point[]): readonly Point[] {
  const c = [0, 1, 2].map(
    (k) => PALM_IDS.reduce((sum, i) => sum + points[i][k], 0) / PALM_IDS.length,
  );
  return points.map(([x, y, z]) => [x - c[0], y - c[1], z - c[2]] as const);
}

/** 開いた右手の形（21 点．手のひらの中心からのずれ．m） */
export const MOCK_OPEN_HAND: readonly Point[] = relativeToPalm(OPEN_RIGHT);
/** 握った右手の形（21 点．手のひらの中心からのずれ．m） */
export const MOCK_FIST_HAND: readonly Point[] = relativeToPalm(FIST_RIGHT);

/**
 * 手のひらの中心 palm（頭の座標系．m）に，握り具合 grip（0〜1．範囲外は収め，有限でなければ 0）で
 * 開いた手と握った手を混ぜた 21 点を置く．palm が有限でない時は null
 */
export function mockHandLandmarks(palm: Vec3, grip: number): Vec3[] | null {
  if (!Number.isFinite(palm.x) || !Number.isFinite(palm.y) || !Number.isFinite(palm.z)) return null;
  const g = Number.isFinite(grip) ? Math.max(0, Math.min(1, grip)) : 0;
  return MOCK_OPEN_HAND.map((o, i) => {
    const c = MOCK_FIST_HAND[i];
    return {
      x: palm.x + o[0] + (c[0] - o[0]) * g,
      y: palm.y + o[1] + (c[1] - o[1]) * g,
      z: palm.z + o[2] + (c[2] - o[2]) * g,
    };
  });
}
