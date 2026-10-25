// 認識した手の左右の振り分け（MediaPipe の左右の札は使わず，前回それぞれの側にいた位置と画像の左右で決める．
// rintoHasegawa/VRtest の HandTracker._assign に倣う）
import { describe, expect, it } from "vitest";
import type { Handedness } from "../../core/types";
import {
  assignHands,
  dropDuplicateHand,
  HAND_ANCHOR_MAX_JUMP,
  HAND_ANCHOR_MEMORY_MS,
  HAND_DUPLICATE_RATIO,
  type HandAnchors,
  rememberHandAnchors,
} from "./handedness";
import { palmCenter } from "./handShape";
import { observation } from "./testHands";
import type { HandObservation } from "./types";

/**
 * 手のひらの中心（手首と 4 本の指の付け根の平均）が画像の上の (x, y) に来る手．
 * size は手首から中指の付け根の長さ（画像の高さを 1 とした値）
 */
function handAt(
  x: number,
  y = 0.5,
  o: { label?: Handedness; score?: number; size?: number } = {},
): HandObservation {
  // undefined の項目を渡すと既定値を消してしまうので，指定した項目だけを渡す
  const base = observation(o);
  const c = palmCenter(base.landmarks);
  return {
    ...base,
    landmarks: base.landmarks.map((p) => ({ ...p, x: p.x - c.x + x, y: p.y - c.y + y })),
  };
}

function anchor(x: number, t: number, y = 0.5) {
  return { x, y, t };
}

describe("定数", () => {
  it("仕様の値: 覚えておく 500 ms・跳び 0.25・重複の割合 0.5", () => {
    expect(HAND_ANCHOR_MEMORY_MS).toBe(500);
    expect(HAND_ANCHOR_MAX_JUMP).toBe(0.25);
    expect(HAND_DUPLICATE_RATIO).toBe(0.5);
  });
});

describe("assignHands（覚えている位置が無い時）", () => {
  it("手が無ければ空", () => {
    expect(assignHands([], false)).toEqual({});
  });

  it.each([
    [0.7, false, "right"],
    [0.3, false, "left"],
    [0.7, true, "left"],
    [0.3, true, "right"],
  ] as const)(
    "1 本の手が画像の x = %s にある時，左右反転 %s の画像では %s の手",
    (x, mirrored, side) => {
      const h = handAt(x);
      expect(assignHands([h], mirrored)).toEqual({ [side]: h });
    },
  );

  it("画像のちょうど中央（x = 0.5）の手は，反転しない画像では左手，反転した画像では右手（x > 0.5 が右）", () => {
    const h = handAt(0.5);
    expect(assignHands([h], false)).toEqual({ left: h });
    expect(assignHands([h], true)).toEqual({ right: h });
  });

  it.each(["left", "right"] as const)("MediaPipe の札（%s）には依らない", (label) => {
    const r = handAt(0.8, 0.5, { label });
    const l = handAt(0.2, 0.5, { label });
    expect(assignHands([r], false)).toEqual({ right: r });
    expect(assignHands([l], false)).toEqual({ left: l });
    expect(assignHands([l, r], false)).toEqual({ left: l, right: r });
  });

  it("2 本の手は画像の x の大きい方を右手にする（並びの順に依らない）", () => {
    const onRight = handAt(0.75);
    const onLeft = handAt(0.25);
    expect(assignHands([onLeft, onRight], false)).toEqual({ right: onRight, left: onLeft });
    expect(assignHands([onRight, onLeft], false)).toEqual({ right: onRight, left: onLeft });
  });

  it("2 本の手がどちらも画像の同じ側にあっても x の大きい方を右手にする", () => {
    const a = handAt(0.62);
    const b = handAt(0.9);
    expect(assignHands([a, b], false)).toEqual({ left: a, right: b });
  });

  it("左右反転した画像では x の小さい方を右手にする", () => {
    const onRight = handAt(0.75);
    const onLeft = handAt(0.25);
    expect(assignHands([onLeft, onRight], true)).toEqual({ right: onLeft, left: onRight });
  });

  it("点が 21 個より少ない手は数えない", () => {
    const ok = handAt(0.8);
    const broken = { ...handAt(0.2), landmarks: handAt(0.2).landmarks.slice(0, 20) };
    expect(assignHands([broken, ok], false)).toEqual({ right: ok });
    expect(assignHands([broken], false)).toEqual({});
  });

  it("3 つ以上あっても（21 点に足りない手を除いた）最初の 2 つだけを使う", () => {
    const a = handAt(0.2);
    const b = handAt(0.8);
    const c = handAt(0.5);
    expect(assignHands([a, b, c], false)).toEqual({ left: a, right: b });
    const broken = { ...c, landmarks: c.landmarks.slice(0, 5) };
    expect(assignHands([broken, a, b, c], false)).toEqual({ left: a, right: b });
  });

  it("時刻を省くと覚えている位置を使わない（画像の左右で決める）", () => {
    const h = handAt(0.7);
    expect(assignHands([h], false, { left: anchor(0.7, 0) })).toEqual({ right: h });
  });
});

describe("dropDuplicateHand", () => {
  it("手が 2 つでなければそのまま返す", () => {
    const one = [handAt(0.5)];
    const three = [handAt(0.5), handAt(0.51), handAt(0.52)];
    expect(dropDuplicateHand([])).toEqual([]);
    expect(dropDuplicateHand(one)).toBe(one);
    expect(dropDuplicateHand(three)).toBe(three);
  });

  it("手のひらの中心の距離が手の大きさ × 0.5 より近い 2 つは，score の高い方の 1 つにする", () => {
    // 手の大きさ 0.2 → しきい値 0.1
    const a = handAt(0.5, 0.5, { score: 0.6, size: 0.2 });
    const b = handAt(0.59, 0.5, { score: 0.9, size: 0.2 });
    expect(dropDuplicateHand([a, b])).toEqual([b]);
    expect(dropDuplicateHand([b, a])).toEqual([b]);
  });

  it("score が同じなら先の方を残す", () => {
    const a = handAt(0.5, 0.5, { score: 0.8 });
    const b = handAt(0.55, 0.5, { score: 0.8 });
    expect(dropDuplicateHand([a, b])).toEqual([a]);
    expect(dropDuplicateHand([b, a])).toEqual([b]);
  });

  it("手の大きさ × 0.5 以上離れていれば 2 つとも残す", () => {
    const a = handAt(0.5, 0.5, { size: 0.2 });
    const b = handAt(0.61, 0.5, { size: 0.2 });
    expect(dropDuplicateHand([a, b])).toEqual([a, b]);
  });

  it("手の大きさは 2 つのうち大きい方を使う", () => {
    // 大きさ 0.1 と 0.3 → しきい値 0.15．距離 0.12 は同じ手
    const small = handAt(0.5, 0.5, { size: 0.1, score: 0.9 });
    const big = handAt(0.62, 0.5, { size: 0.3, score: 0.5 });
    expect(dropDuplicateHand([small, big])).toEqual([small]);
    expect(dropDuplicateHand([big, small])).toEqual([small]);
  });

  it("距離は縦の向きでも測る", () => {
    const a = handAt(0.5, 0.5, { score: 0.5 });
    const b = handAt(0.5, 0.56, { score: 0.7 });
    expect(dropDuplicateHand([a, b])).toEqual([b]);
  });
});

describe("assignHands（同じ手を 2 つに認識した時）", () => {
  it("1 本として扱い，score の高い方を画像の左右の側に振り分ける", () => {
    const a = handAt(0.7, 0.5, { score: 0.6 });
    const b = handAt(0.75, 0.5, { score: 0.95 });
    expect(assignHands([a, b], false)).toEqual({ right: b });
  });

  it("1 本として扱うので，覚えている位置の近い側に振り分ける", () => {
    const a = handAt(0.7, 0.5, { score: 0.6 });
    const b = handAt(0.72, 0.5, { score: 0.95 });
    expect(assignHands([a, b], false, { left: anchor(0.7, 0) }, 100)).toEqual({ left: b });
  });
});

describe("assignHands（1 本の手と覚えている位置）", () => {
  it("覚えている側の近く（0.25 未満）に現れた手はその側にする（画像の左右に依らない）", () => {
    const h = handAt(0.35);
    expect(assignHands([h], false, { right: anchor(0.3, 0) }, 100)).toEqual({ right: h });
    const h2 = handAt(0.7);
    expect(assignHands([h2], false, { left: anchor(0.65, 0) }, 100)).toEqual({ left: h2 });
  });

  it("両側を覚えていれば近い方の側にする", () => {
    const anchors: HandAnchors = { left: anchor(0.2, 0), right: anchor(0.4, 0) };
    const nearRight = handAt(0.35);
    const nearLeft = handAt(0.25);
    expect(assignHands([nearRight], false, anchors, 100)).toEqual({ right: nearRight });
    expect(assignHands([nearLeft], false, anchors, 100)).toEqual({ left: nearLeft });
  });

  it("距離は縦の向きも含めて測る", () => {
    // 右の位置は x が近いが縦に離れている
    const anchors: HandAnchors = { left: anchor(0.4, 0, 0.5), right: anchor(0.5, 0, 0.8) };
    const h = handAt(0.5, 0.5);
    expect(assignHands([h], false, anchors, 100)).toEqual({ left: h });
  });

  it.each([
    [0.24, "right"],
    [0.26, "left"],
  ] as const)(
    "覚えている位置から %s 離れた手は %s（0.25 以上なら画像の左右で決める）",
    (jump, side) => {
      const h = handAt(0.2 + jump);
      expect(assignHands([h], false, { right: anchor(0.2, 0) }, 100)).toEqual({ [side]: h });
    },
  );

  it.each([
    [500, "right"],
    [501, "left"],
  ] as const)("覚えた時刻から %s ms 後の手は %s（500 ms を過ぎた位置は使わない）", (dt, side) => {
    const h = handAt(0.3);
    expect(assignHands([h], false, { right: anchor(0.3, 1000) }, 1000 + dt)).toEqual({
      [side]: h,
    });
  });

  it("古くなった側は使わず，覚えている側だけで決める", () => {
    const anchors: HandAnchors = { left: anchor(0.35, 0), right: anchor(0.3, 900) };
    const h = handAt(0.34);
    // 左の方が近いが古い（1000 ms 前）ので，右にする
    expect(assignHands([h], false, anchors, 1000)).toEqual({ right: h });
  });

  it("左右反転した画像でも覚えている位置を先に使い，無ければ反転した左右で決める", () => {
    const h = handAt(0.3);
    expect(assignHands([h], true, { left: anchor(0.3, 0) }, 100)).toEqual({ left: h });
    expect(assignHands([h], true, { left: anchor(0.9, 0) }, 100)).toEqual({ right: h });
  });
});

describe("assignHands（2 本の手と覚えている位置）", () => {
  it("両側を覚えていて，入れ替えた方が距離の合計が小さい時は入れ替える", () => {
    // 腕を交差して，左手が画像の右に来ている
    const anchors: HandAnchors = { left: anchor(0.6, 0), right: anchor(0.4, 0) };
    const a = handAt(0.62);
    const b = handAt(0.38);
    expect(assignHands([a, b], false, anchors, 100)).toEqual({ left: a, right: b });
  });

  it("入れ替えない方が近ければ画像の x の順のまま", () => {
    const anchors: HandAnchors = { left: anchor(0.3, 0), right: anchor(0.7, 0) };
    const a = handAt(0.32);
    const b = handAt(0.68);
    expect(assignHands([a, b], false, anchors, 100)).toEqual({ left: a, right: b });
  });

  it("片側しか覚えていなければ画像の x の順で決める", () => {
    const anchors: HandAnchors = { left: anchor(0.7, 0) };
    const a = handAt(0.3);
    const b = handAt(0.7);
    expect(assignHands([a, b], false, anchors, 100)).toEqual({ left: a, right: b });
  });

  it("片側が古く（500 ms を過ぎて）なっていれば画像の x の順で決める", () => {
    const anchors: HandAnchors = { left: anchor(0.6, 0), right: anchor(0.4, 900) };
    const a = handAt(0.62);
    const b = handAt(0.38);
    expect(assignHands([a, b], false, anchors, 1000)).toEqual({ left: b, right: a });
  });

  it("左右反転した画像でも，入れ替えた方が近ければ入れ替える", () => {
    // 反転した画像では x の小さい方が右手．覚えている位置は逆
    const anchors: HandAnchors = { left: anchor(0.3, 0), right: anchor(0.7, 0) };
    const a = handAt(0.32);
    const b = handAt(0.68);
    expect(assignHands([a, b], true, {}, 100)).toEqual({ right: a, left: b });
    expect(assignHands([a, b], true, anchors, 100)).toEqual({ left: a, right: b });
  });
});

describe("rememberHandAnchors", () => {
  it("振り分けた側の位置（手のひらの中心）と時刻を覚える", () => {
    const h = handAt(0.3, 0.4);
    const next = rememberHandAnchors({}, { right: h }, 100);
    expect(next.right?.x).toBeCloseTo(0.3, 12);
    expect(next.right?.y).toBeCloseTo(0.4, 12);
    expect(next.right?.t).toBe(100);
    expect(next.left).toBeUndefined();
  });

  it("見えなかった側は前の値を残し，見えた側だけ更新する", () => {
    const prev: HandAnchors = { left: anchor(0.2, 0), right: anchor(0.8, 0) };
    const h = handAt(0.75);
    const next = rememberHandAnchors(prev, { right: h }, 200);
    expect(next.left).toEqual(prev.left);
    expect(next.right?.x).toBeCloseTo(0.75, 12);
    expect(next.right?.t).toBe(200);
  });

  it("前の値は書き換えない", () => {
    const prev: HandAnchors = { left: anchor(0.2, 0) };
    const copy = structuredClone(prev);
    rememberHandAnchors(prev, { left: handAt(0.4), right: handAt(0.8) }, 50);
    expect(prev).toEqual(copy);
  });

  it("何も振り分けなかった回は前の値のまま", () => {
    const prev: HandAnchors = { left: anchor(0.2, 0), right: anchor(0.8, 10) };
    expect(rememberHandAnchors(prev, {}, 300)).toEqual(prev);
  });
});

describe("assignHands と rememberHandAnchors を続けて使う", () => {
  it("1 本の手が画像の中央を横切っても同じ側のまま", () => {
    let anchors: HandAnchors = {};
    const sides: string[] = [];
    let t = 0;
    for (let x = 0.3; x <= 0.71; x += 0.05) {
      const a = assignHands([handAt(x)], false, anchors, t);
      sides.push(...Object.keys(a));
      anchors = rememberHandAnchors(anchors, a, t);
      t += 66;
    }
    expect(new Set(sides)).toEqual(new Set(["left"]));
  });

  it("両手を交差しても左右を保つ", () => {
    let anchors: HandAnchors = {};
    let t = 0;
    let last: ReturnType<typeof assignHands> = {};
    // 左手は 0.3 → 0.7，右手は 0.7 → 0.3 と動く（手 L・R は毎回並びが変わらない）
    for (let i = 0; i <= 8; i++) {
      const L = handAt(0.3 + i * 0.05, 0.5, { score: 0.8 });
      const R = handAt(0.7 - i * 0.05, 0.3, { score: 0.8 });
      // 真ん中で重なる回は 1 本しか見えないことがあるので，並びの順は入れ替えておく
      last = assignHands(i % 2 === 0 ? [L, R] : [R, L], false, anchors, t);
      anchors = rememberHandAnchors(anchors, last, t);
      t += 66;
    }
    // 最後は左手が画像の右（0.7）にいる
    expect(palmCenter(last.left?.landmarks ?? []).x).toBeCloseTo(0.7, 9);
    expect(palmCenter(last.right?.landmarks ?? []).x).toBeCloseTo(0.3, 9);
  });

  it("見失って 500 ms を過ぎてから現れた手は画像の左右で決め直す", () => {
    let anchors: HandAnchors = {};
    const first = assignHands([handAt(0.3)], false, anchors, 0);
    anchors = rememberHandAnchors(anchors, first, 0);
    expect(Object.keys(first)).toEqual(["left"]);
    // 600 ms 後に画像の右に近い所（覚えた位置から 0.25 未満）に現れた手
    const later = assignHands([handAt(0.52)], false, anchors, 600);
    expect(Object.keys(later)).toEqual(["right"]);
  });
});
