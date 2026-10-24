// 認識した手を左右に振り分ける純粋な関数．
// MediaPipe の左右は自撮り（左右反転した画像）を前提にしているため，背面カメラ（反転しない）では逆になる
import type { Handedness } from "../../core/types";
import { palmCenter } from "./handShape";
import type { HandObservation } from "./types";

function opposite(side: Handedness): Handedness {
  return side === "left" ? "right" : "left";
}

/**
 * 認識した手（最大 2 つ）を左右に振り分ける．mirrored は画像が左右反転しているか（背面カメラは false）．
 * 2 つが同じ側になった時は，画像の上の位置で決める（背面カメラは体験者と同じ向きを見るため，画像の右にある方が右手）
 */
export function assignHands(
  hands: readonly HandObservation[],
  mirrored: boolean,
): Partial<Record<Handedness, HandObservation>> {
  const valid = hands.filter((h) => h.landmarks.length >= 21).slice(0, 2);
  const sideOf = (h: HandObservation): Handedness => (mirrored ? h.label : opposite(h.label));
  if (valid.length === 0) return {};
  if (valid.length === 1) return { [sideOf(valid[0])]: valid[0] };
  const [a, b] = valid;
  if (sideOf(a) !== sideOf(b)) return { [sideOf(a)]: a, [sideOf(b)]: b };
  const ax = palmCenter(a.landmarks).x;
  const bx = palmCenter(b.landmarks).x;
  // 反転した画像では体験者の右手が画像の左に写る
  const aIsRight = mirrored ? ax < bx : ax > bx;
  return aIsRight ? { right: a, left: b } : { left: a, right: b };
}
