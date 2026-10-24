// 認識の結果を Worker から転送する形（21 点 × 3 値 × 手の数の Float32Array 1 つ）と，MediaPipe の結果からの変換．
// 純粋な関数（experiment_山﨑/08「Worker から届く手の結果は Float32Array 1 つにまとめて転送する」）
import type { Handedness } from "../../core/types";
import { HAND_LANDMARK_COUNT, type HandObservation, type Landmark } from "./types";

/** 転送する形．points は手ごとに 21 点 × (x, y, z) を並べたもの */
export interface PackedHands {
  readonly labels: readonly Handedness[];
  readonly scores: readonly number[];
  readonly points: Float32Array;
}

/** 手の結果を 1 つの Float32Array にまとめる */
export function packHands(hands: readonly HandObservation[]): PackedHands {
  const valid = hands.filter((h) => h.landmarks.length >= HAND_LANDMARK_COUNT);
  const points = new Float32Array(valid.length * HAND_LANDMARK_COUNT * 3);
  valid.forEach((h, i) => {
    for (let j = 0; j < HAND_LANDMARK_COUNT; j++) {
      const p = h.landmarks[j];
      const k = (i * HAND_LANDMARK_COUNT + j) * 3;
      points[k] = p.x;
      points[k + 1] = p.y;
      points[k + 2] = p.z;
    }
  });
  return { labels: valid.map((h) => h.label), scores: valid.map((h) => h.score), points };
}

/** packHands の逆．数が合わない分は捨てる */
export function unpackHands(packed: PackedHands): HandObservation[] {
  const count = Math.min(
    packed.labels.length,
    packed.scores.length,
    Math.floor(packed.points.length / (HAND_LANDMARK_COUNT * 3)),
  );
  const out: HandObservation[] = [];
  for (let i = 0; i < count; i++) {
    const landmarks: Landmark[] = [];
    for (let j = 0; j < HAND_LANDMARK_COUNT; j++) {
      const k = (i * HAND_LANDMARK_COUNT + j) * 3;
      landmarks.push({ x: packed.points[k], y: packed.points[k + 1], z: packed.points[k + 2] });
    }
    out.push({ label: packed.labels[i], score: packed.scores[i], landmarks });
  }
  return out;
}

/** MediaPipe の HandLandmarkerResult のうち使う項目（ライブラリの型に依存しないため） */
export interface LandmarkerResultLike {
  readonly landmarks: readonly (readonly { x: number; y: number; z: number }[])[];
  readonly handedness?: readonly (readonly { categoryName: string; score: number }[])[];
}

/** MediaPipe の結果を HandObservation の並びにする．左右が読めない手は "right" とみなす（handedness.ts で位置から直す） */
export function observationsFromResult(result: LandmarkerResultLike): HandObservation[] {
  const out: HandObservation[] = [];
  result.landmarks.forEach((lms, i) => {
    if (lms.length < HAND_LANDMARK_COUNT) return;
    const category = result.handedness?.[i]?.[0];
    const name = category?.categoryName.toLowerCase();
    out.push({
      label: name === "left" ? "left" : "right",
      score: typeof category?.score === "number" ? category.score : 0,
      landmarks: lms.slice(0, HAND_LANDMARK_COUNT).map((p) => ({ x: p.x, y: p.y, z: p.z })),
    });
  });
  return out;
}
