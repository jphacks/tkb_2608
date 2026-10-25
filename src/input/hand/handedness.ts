// 認識した手を左右に振り分ける純粋な関数．
// MediaPipe の左右の札（label）は 1 本の手でも認識の回ごとに揺れるため使わず，前回それぞれの側にいた手の
// 画像の上の位置と，画像の左右で決める（rintoHasegawa/VRtest の HandTracker._assign に倣う）
import type { Handedness } from "../../core/types";
import { palmCenter } from "./handShape";
import type { HandObservation } from "./types";

/** 片側の手が最後にいた画像の上の位置（手のひらの中心．0〜1）と，その映像の時刻（ms） */
export interface HandAnchor {
  readonly x: number;
  readonly y: number;
  readonly t: number;
}

/** 左右それぞれの最後の位置（まだ無い側は省く） */
export type HandAnchors = Partial<Record<Handedness, HandAnchor>>;

/** 見失ってから最後の位置を覚えておく時間（ms）．これを過ぎた側は画像の左右で決め直す */
export const HAND_ANCHOR_MEMORY_MS = 500;
/** 最後の位置からこれ以上（画像の大きさを 1 とした距離）離れて現れた 1 本の手は，画像の左右で決める */
export const HAND_ANCHOR_MAX_JUMP = 0.25;
/**
 * 2 つの手のひらの中心がこの割合 × 手の大きさ（手首から中指の付け根．大きい方）より近ければ，同じ手を 2 つに
 * 認識したとみなす（MediaPipe は 1 本の手を少しずれた 2 本として返すことがある）
 */
export const HAND_DUPLICATE_RATIO = 0.5;

function anchorOf(h: HandObservation): { x: number; y: number } {
  const c = palmCenter(h.landmarks);
  return { x: c.x, y: c.y };
}

function distance(a: { x: number; y: number }, b: { x: number; y: number }): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

/**
 * 同じ手を 2 つに認識した時は 1 つにする（score の高い方．同じなら先の方）．
 * 距離は画像の上の 0〜1 の座標で測る（手の大きさとの比で見るため，縦横比は考えない）
 */
export function dropDuplicateHand(hands: readonly HandObservation[]): readonly HandObservation[] {
  if (hands.length !== 2) return hands;
  const [a, b] = hands;
  const size = Math.max(
    distance(a.landmarks[0], a.landmarks[9]),
    distance(b.landmarks[0], b.landmarks[9]),
  );
  if (!(distance(anchorOf(a), anchorOf(b)) < size * HAND_DUPLICATE_RATIO)) return hands;
  return [b.score > a.score ? b : a];
}

/** t の時点でまだ覚えている位置か */
function remembered(anchor: HandAnchor | undefined, t: number): anchor is HandAnchor {
  return anchor !== undefined && Number.isFinite(t) && t - anchor.t <= HAND_ANCHOR_MEMORY_MS;
}

/** 画像の上の位置 x の手がどちらの手か（背面カメラは体験者と同じ向きを見るため，画像の右にある方が右手） */
function sideByImage(x: number, mirrored: boolean): Handedness {
  // 反転した画像では体験者の右手が画像の左に写る
  return x > 0.5 !== mirrored ? "right" : "left";
}

/**
 * 認識した手（最大 2 つ）を左右に振り分ける．mirrored は画像が左右反転しているか（背面カメラは false）．
 * anchors は前回までの各側の位置（rememberHandAnchors で更新する），t は今回の映像の時刻（ms）．
 * 同じ手を 2 つに認識した時は 1 つとして扱う（dropDuplicateHand）．
 * - 2 つ: 画像の上の左右の順で振り分け，両側の位置を覚えていれば入れ替えた方が近い時だけ入れ替える
 * - 1 つ: 覚えている位置のうち近い方の側（HAND_ANCHOR_MAX_JUMP 以内）．無ければ画像の左右で決める
 */
export function assignHands(
  hands: readonly HandObservation[],
  mirrored: boolean,
  anchors: HandAnchors = {},
  t = Number.NaN,
): Partial<Record<Handedness, HandObservation>> {
  const valid = dropDuplicateHand(hands.filter((h) => h.landmarks.length >= 21).slice(0, 2));
  if (valid.length === 0) return {};
  const left = anchors.left;
  const right = anchors.right;
  if (valid.length === 1) {
    const h = valid[0];
    const p = anchorOf(h);
    let side: Handedness | null = null;
    let best = HAND_ANCHOR_MAX_JUMP;
    for (const s of ["left", "right"] as const) {
      const a = anchors[s];
      if (!remembered(a, t)) continue;
      const d = distance(p, a);
      if (d < best) {
        best = d;
        side = s;
      }
    }
    return { [side ?? sideByImage(p.x, mirrored)]: h };
  }
  const [a, b] = valid;
  const pa = anchorOf(a);
  const pb = anchorOf(b);
  // 反転した画像では体験者の右手が画像の左に写る
  const aIsRight = mirrored ? pa.x < pb.x : pa.x > pb.x;
  const byImage = aIsRight ? { right: a, left: b } : { left: a, right: b };
  if (!remembered(left, t) || !remembered(right, t)) return byImage;
  const [pl, pr] = aIsRight ? [pb, pa] : [pa, pb];
  const keep = distance(pl, left) + distance(pr, right);
  const swap = distance(pr, left) + distance(pl, right);
  return swap < keep ? { left: byImage.right, right: byImage.left } : byImage;
}

/** 振り分けた結果で各側の最後の位置を更新する（見えなかった側は前の位置を残し，古さは assignHands が見る） */
export function rememberHandAnchors(
  prev: HandAnchors,
  assigned: Partial<Record<Handedness, HandObservation>>,
  t: number,
): HandAnchors {
  const next: { -readonly [K in Handedness]?: HandAnchor } = { ...prev };
  for (const s of ["left", "right"] as const) {
    const h = assigned[s];
    if (h === undefined) continue;
    const p = anchorOf(h);
    if (Number.isFinite(p.x) && Number.isFinite(p.y) && Number.isFinite(t)) next[s] = { ...p, t };
  }
  return next;
}
