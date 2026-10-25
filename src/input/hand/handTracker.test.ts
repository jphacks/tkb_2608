// 片手の追跡（experiment_山﨑/07「認識の有無の安定化」「手の形」・SPEC_01「HandState」「手の位置のぶれ・途切れ」）
import { describe, expect, it } from "vitest";
import type { HandParams } from "./handParams";
import { palmCenter } from "./handShape";
import {
  cameraModelOf,
  createHandTrack,
  type HandTrack,
  handPositions,
  lostTimeoutMs,
  observeHand,
  readHandTrack,
  resetHandTrack,
  toHandState,
} from "./handTracker";
import { imageToHead } from "./projection";
import {
  FIST,
  handLandmarks,
  IMG_H,
  IMG_W,
  OPEN,
  observation,
  POINT,
  seededRandom,
  TEST_HAND_PARAMS,
  testHandParams,
} from "./testHands";
import type { HandObservation } from "./types";

const P = TEST_HAND_PARAMS;
/** 認識の間隔（15 回/秒） */
const DT = 1000 / 15;
/** 握り具合が 0.4〜0.6 の間になる手（人差し指・中指だけ曲げる．生の値 0.5） */
const HALF: readonly [number, number, number, number] = [1, 1, 0, 0];

function see(track: HandTrack, obs: HandObservation | null, t: number, p: HandParams = P): void {
  observeHand(track, obs, t, IMG_W, IMG_H, p);
}

/** t0 から DT ごとに n 回認識する．最後の時刻を返す */
function seeMany(track: HandTrack, obs: HandObservation | null, t0: number, n: number): number {
  let t = t0;
  for (let i = 0; i < n; i++) {
    t = t0 + i * DT;
    see(track, obs, t);
  }
  return t;
}

/** 認識して tracked になった手．最後に認識した時刻も返す */
function trackedHand(
  obs: HandObservation = observation(),
  t0 = 0,
): { track: HandTrack; t: number } {
  const track = createHandTrack();
  const t = seeMany(track, obs, t0, 3);
  return { track, t };
}

describe("createHandTrack", () => {
  it("まだ認識していない手は tracked でなく，読むと原点・grip 0・ageMs は Infinity", () => {
    const track = createHandTrack();
    const r = readHandTrack(track, 1000, P);
    expect(r).toMatchObject({
      tracked: false,
      position: { x: 0, y: 0, z: 0 },
      indexTip: { x: 0, y: 0, z: 0 },
      grip: 0,
      pinch: 0,
      pinching: false,
      pointing: false,
    });
    expect(r.ageMs).toBe(Number.POSITIVE_INFINITY);
  });
});

describe("observeHand（表示し始める）", () => {
  it("1 回の認識では tracked にせず，2 回続けたら tracked にする", () => {
    const track = createHandTrack();
    see(track, observation(), 0);
    expect(track.tracked).toBe(false);
    expect(readHandTrack(track, 10, P).tracked).toBe(false);
    see(track, observation(), DT);
    expect(track.tracked).toBe(true);
    expect(readHandTrack(track, DT + 10, P).tracked).toBe(true);
  });

  it("1 回だけの誤認識（間に見えない回を挟む）では tracked にならない", () => {
    const track = createHandTrack();
    see(track, observation(), 0);
    see(track, null, DT);
    see(track, observation(), 2 * DT);
    see(track, null, 3 * DT);
    expect(track.tracked).toBe(false);
  });

  it("trackAppearCount の回数に従う（3 回）", () => {
    const p = testHandParams({ trackAppearCount: 3 });
    const track = createHandTrack();
    see(track, observation(), 0, p);
    see(track, observation(), DT, p);
    expect(track.tracked).toBe(false);
    see(track, observation(), 2 * DT, p);
    expect(track.tracked).toBe(true);
  });

  it("間が大きく空いた 2 回の認識（結果が届かない間をはさむ）は「続けて」とみなさない", () => {
    const track = createHandTrack();
    see(track, observation(), 0);
    // カメラが止まる等で，この間 observeHand が呼ばれない
    see(track, observation(), 5000);
    expect(track.tracked).toBe(false);
  });

  it("tracked の手の結果が長く届かなかった後は，1 回の認識だけでは tracked に戻さない", () => {
    const { track, t } = trackedHand();
    // 結果が届かない間に読む側では見失いになっている
    expect(readHandTrack(track, t + 5000, P).tracked).toBe(false);
    see(track, observation(), t + 5000);
    expect(readHandTrack(track, t + 5000, P).tracked).toBe(false);
    see(track, observation(), t + 5000 + DT);
    expect(readHandTrack(track, t + 5000 + DT, P).tracked).toBe(true);
  });

  it("点が足りない・値がおかしい手は見えなかった回として扱う", () => {
    const track = createHandTrack();
    const broken = { ...observation(), landmarks: handLandmarks().slice(0, 10) };
    const nan = {
      ...observation(),
      landmarks: handLandmarks().map((p) => ({ ...p, x: Number.NaN })),
    };
    see(track, broken, 0);
    see(track, nan, DT);
    see(track, observation(), 2 * DT);
    expect(track.tracked).toBe(false);
    expect(track.seenStreak).toBe(1);
  });

  it("時刻が NaN の結果は無視する", () => {
    const { track } = trackedHand();
    const before = { ...track };
    see(track, null, Number.NaN);
    see(track, observation({ cx: 0.9 }), Number.NaN);
    expect(track).toEqual(before);
  });

  it("時刻が戻った結果が来ても位置は壊れず（有限のまま），tracked を保つ", () => {
    const { track, t } = trackedHand();
    see(track, observation({ cx: 0.8 }), t - 30);
    const r = readHandTrack(track, t + 10, P);
    expect(r.tracked).toBe(true);
    expect(Number.isFinite(r.position.x)).toBe(true);
    expect(Number.isFinite(r.position.y)).toBe(true);
    expect(Number.isFinite(r.position.z)).toBe(true);
  });
});

describe("observeHand（見失う・戻る）", () => {
  it("開いた手を見失っても 0.3 秒までは tracked のまま，それを超えたら外す", () => {
    const { track, t } = trackedHand(observation({ curls: OPEN }));
    see(track, null, t + 100);
    see(track, null, t + 300);
    expect(track.tracked).toBe(true);
    expect(readHandTrack(track, t + 300, P).tracked).toBe(true);
    see(track, null, t + 301);
    expect(track.tracked).toBe(false);
    expect(readHandTrack(track, t + 301, P).tracked).toBe(false);
  });

  it("見失っている間（0.3 秒以内）も最後の位置を出し続ける", () => {
    const { track, t } = trackedHand();
    const last = readHandTrack(track, t, P).position;
    see(track, null, t + DT);
    see(track, null, t + 2 * DT);
    const r = readHandTrack(track, t + 2 * DT, P);
    expect(r.tracked).toBe(true);
    expect(r.position.x).toBeCloseTo(last.x, 6);
    expect(r.position.y).toBeCloseTo(last.y, 6);
    expect(r.position.z).toBeCloseTo(last.z, 6);
  });

  it("握ったまま一瞬見失っても，約 0.8 秒は tracked と握ったままを保つ（0.5 で区切っても握っている）", () => {
    const { track, t } = trackedHand(observation({ curls: FIST }));
    expect(readHandTrack(track, t, P).grip).toBeGreaterThanOrEqual(0.6);
    for (const dt of [100, 300, 500, 700, 800]) {
      see(track, null, t + dt);
      const r = readHandTrack(track, t + dt, P);
      expect(r.tracked).toBe(true);
      expect(r.grip).toBeGreaterThanOrEqual(0.6);
      expect(toHandState(r).grip).toBeGreaterThan(0.5);
    }
    see(track, null, t + 801);
    const r = readHandTrack(track, t + 801, P);
    expect(r.tracked).toBe(false);
    expect(r.grip).toBeLessThanOrEqual(0.4);
  });

  it("握ったまま保つ時間は gripHoldMs に従い，trackLostMs より短くはならない", () => {
    const { track } = trackedHand(observation({ curls: FIST }));
    expect(lostTimeoutMs(track, P)).toBe(800);
    expect(lostTimeoutMs(track, testHandParams({ gripHoldMs: 100 }))).toBe(300);
    const open = trackedHand(observation({ curls: OPEN })).track;
    expect(lostTimeoutMs(open, P)).toBe(300);
  });

  it("見失って外れた手が戻ると，2 回の認識（約 0.13 秒）で tracked に戻る（1 秒以内に戻る）", () => {
    const { track, t } = trackedHand();
    see(track, null, t + DT);
    see(track, null, t + 400);
    expect(track.tracked).toBe(false);
    const back = t + 450;
    see(track, observation(), back);
    expect(track.tracked).toBe(false);
    see(track, observation(), back + DT);
    expect(track.tracked).toBe(true);
    // 見失い始めてから戻るまで 1 秒以内
    expect(back + DT - t).toBeLessThan(1000);
  });

  it("0.3 秒より短い見失いでは tracked が途切れない", () => {
    const { track, t } = trackedHand();
    see(track, null, t + DT);
    see(track, null, t + 2 * DT);
    see(track, observation(), t + 3 * DT);
    expect(track.tracked).toBe(true);
    expect(readHandTrack(track, t + 3 * DT, P).tracked).toBe(true);
  });

  it("見失った後に別の所で戻った時は，古い位置から滑らず新しい位置から始める", () => {
    const { track, t } = trackedHand(observation({ cx: 0.25 }));
    see(track, null, t + 400);
    expect(track.tracked).toBe(false);
    const newObs = observation({ cx: 0.75 });
    see(track, newObs, t + 500);
    see(track, newObs, t + 500 + DT);
    const expected = handPositions(newObs, cameraModelOf(P, IMG_W, IMG_H), P);
    const r = readHandTrack(track, t + 500 + DT, P);
    expect(r.tracked).toBe(true);
    expect(r.position.x).toBeCloseTo(expected?.palm.x ?? Number.NaN, 6);
    expect(r.position.y).toBeCloseTo(expected?.palm.y ?? Number.NaN, 6);
  });

  it("見失って外れると，握る・つまむ・指を差すの状態も戻る", () => {
    const { track, t } = trackedHand(observation({ curls: POINT, pinch: true }));
    see(track, null, t + 1000);
    const r = readHandTrack(track, t + 1000, P);
    expect(r).toMatchObject({ tracked: false, pinching: false, pointing: false, pinch: 0 });
    expect(r.grip).toBeLessThanOrEqual(0.4);
  });
});

describe("observeHand（手の形）", () => {
  it("握り具合のヒステリシス: 握った後に 0.4〜0.6 の手になっても握ったまま，開くと開いた", () => {
    const track = createHandTrack();
    let t = seeMany(track, observation({ curls: FIST }), 0, 2);
    expect(readHandTrack(track, t, P).grip).toBeGreaterThanOrEqual(0.6);
    t = seeMany(track, observation({ curls: HALF }), t + DT, 3);
    expect(track.gripRaw).toBeGreaterThan(0.4);
    expect(track.gripRaw).toBeLessThan(0.6);
    expect(track.gripped).toBe(true);
    expect(readHandTrack(track, t, P).grip).toBeGreaterThanOrEqual(0.6);
    t = seeMany(track, observation({ curls: OPEN }), t + DT, 1);
    expect(track.gripped).toBe(false);
    expect(readHandTrack(track, t, P).grip).toBeLessThanOrEqual(0.4);
  });

  it("開いた後に 0.4〜0.6 の手になっても開いたまま", () => {
    const track = createHandTrack();
    let t = seeMany(track, observation({ curls: OPEN }), 0, 2);
    t = seeMany(track, observation({ curls: HALF }), t + DT, 3);
    expect(track.gripped).toBe(false);
    expect(readHandTrack(track, t, P).grip).toBeLessThanOrEqual(0.4);
  });

  it("指を差す形は 2 回続けたら確定する", () => {
    const track = createHandTrack();
    see(track, observation({ curls: POINT }), 0);
    expect(track.pointing.value).toBe(false);
    see(track, observation({ curls: POINT }), DT);
    expect(readHandTrack(track, DT, P).pointing).toBe(true);
    see(track, observation({ curls: OPEN }), 2 * DT);
    expect(readHandTrack(track, 2 * DT, P).pointing).toBe(true);
    see(track, observation({ curls: OPEN }), 3 * DT);
    expect(readHandTrack(track, 3 * DT, P).pointing).toBe(false);
  });

  it("つまむと pinching になり，つまむ具合が大きい", () => {
    const { track, t } = trackedHand(observation({ pinch: true }));
    const r = readHandTrack(track, t, P);
    expect(r.pinching).toBe(true);
    expect(r.pinch).toBeGreaterThan(0.5);
    const open = trackedHand(observation({ pinch: false }));
    const ro = readHandTrack(open.track, open.t, P);
    expect(ro.pinching).toBe(false);
    expect(ro.pinch).toBe(0);
  });
});

describe("readHandTrack", () => {
  it("画像の中央の手は，目の前（-z）の手を伸ばした距離にある", () => {
    const obs = observation({ cx: 0.5 });
    const { track, t } = trackedHand(obs);
    const r = readHandTrack(track, t, P);
    expect(r.position.z).toBeLessThan(-0.3);
    expect(r.position.z).toBeGreaterThan(-0.8);
    // 手のひらの中心は中指の付け根より手首側（画像の下＝頭の座標系の下）
    expect(r.position.y).toBeLessThan(0);
    // 人差し指の先は手のひらより上
    expect(r.indexTip.y).toBeGreaterThan(r.position.y);
  });

  it("画像の右にある手は +x，左にある手は -x", () => {
    const right = trackedHand(observation({ cx: 0.8 }));
    const left = trackedHand(observation({ cx: 0.2 }));
    expect(readHandTrack(right.track, right.t, P).position.x).toBeGreaterThan(0);
    expect(readHandTrack(left.track, left.t, P).position.x).toBeLessThan(0);
  });

  it("動かしている手は次の結果までの間を外挿で進め，80 ms を超えたら止める", () => {
    const track = createHandTrack();
    let t = 0;
    for (let i = 0; i < 10; i++) {
      t = i * DT;
      see(track, observation({ cx: 0.3 + i * 0.02 }), t);
    }
    const at0 = readHandTrack(track, t, P).position.x;
    const at40 = readHandTrack(track, t + 40, P).position.x;
    const at80 = readHandTrack(track, t + 80, P).position.x;
    const at200 = readHandTrack(track, t + 200, P).position.x;
    expect(at40).toBeGreaterThan(at0);
    expect(at80).toBeGreaterThan(at40);
    expect(at200).toBeCloseTo(at80, 9);
  });

  it("認識が止まった（結果が来ない）時は，読む側でも見失いとみなす（開いた手 0.3 秒＋0.5 秒）", () => {
    const { track, t } = trackedHand(observation({ curls: OPEN }));
    expect(readHandTrack(track, t + 800, P).tracked).toBe(true);
    expect(readHandTrack(track, t + 801, P).tracked).toBe(false);
  });

  it("認識が止まった時，握った手は 0.8 秒＋0.5 秒まで握ったまま", () => {
    const { track, t } = trackedHand(observation({ curls: FIST }));
    const r = readHandTrack(track, t + 1300, P);
    expect(r.tracked).toBe(true);
    expect(r.grip).toBeGreaterThanOrEqual(0.6);
    const r2 = readHandTrack(track, t + 1301, P);
    expect(r2.tracked).toBe(false);
    expect(r2.grip).toBeLessThanOrEqual(0.4);
  });

  it("ageMs は最後に認識した映像からの時間", () => {
    const { track, t } = trackedHand();
    expect(readHandTrack(track, t + 50, P).ageMs).toBeCloseTo(50, 9);
  });

  it("読んでも状態は変わらない", () => {
    const { track, t } = trackedHand();
    const before = JSON.stringify(track);
    readHandTrack(track, t + 5000, P);
    expect(JSON.stringify(track)).toBe(before);
  });

  it("止めた手（21 点がぶれる）の位置の震えは，1 回ごとの位置の震えより小さい", () => {
    const rnd = seededRandom(7);
    const cam = cameraModelOf(P, IMG_W, IMG_H);
    const track = createHandTrack();
    const raw: number[] = [];
    const out: number[] = [];
    for (let i = 0; i < 60; i++) {
      const t = i * DT;
      // 画像の上で ±1 px 程度のぶれ
      const dx = (rnd() - 0.5) * (2 / IMG_W);
      const dy = (rnd() - 0.5) * (2 / IMG_H);
      const base = observation();
      const obs = {
        ...base,
        landmarks: base.landmarks.map((p) => ({ ...p, x: p.x + dx, y: p.y + dy })),
      };
      see(track, obs, t);
      if (i >= 15) {
        raw.push(handPositions(obs, cam, P)?.palm.x ?? Number.NaN);
        out.push(readHandTrack(track, t, P).position.x);
      }
    }
    const std = (v: number[]) => {
      const m = v.reduce((a, b) => a + b, 0) / v.length;
      return Math.sqrt(v.reduce((a, b) => a + (b - m) ** 2, 0) / v.length);
    };
    expect(std(out)).toBeLessThan(std(raw) * 0.5);
  });
});

describe("resetHandTrack", () => {
  it("tracked と形の状態を戻し，位置（フィルタ）は残す", () => {
    const { track } = trackedHand(observation({ curls: FIST, pinch: true }));
    const palm = track.palm;
    resetHandTrack(track);
    expect(track).toMatchObject({
      tracked: false,
      seenStreak: 0,
      gripped: false,
      gripRaw: 0,
      pinching: false,
      pointing: { value: false, streak: 0 },
    });
    expect(track.palm).toBe(palm);
  });
});

describe("toHandState", () => {
  it("HandState の項目（tracked・position・grip・indexTip・landmarks）だけを載せる", () => {
    const { track, t } = trackedHand(observation({ curls: FIST }));
    const r = readHandTrack(track, t, P);
    const s = toHandState(r);
    expect(Object.keys(s).sort()).toEqual(["grip", "indexTip", "landmarks", "position", "tracked"]);
    expect(s).toEqual({
      tracked: r.tracked,
      position: r.position,
      grip: r.grip,
      indexTip: r.indexTip,
      landmarks: r.landmarks,
    });
  });

  it("人差し指の先（indexTip）は HandReading の値（position と同じ奥行きの見積もり）をそのまま載せる", () => {
    const { track, t } = trackedHand(observation({ curls: OPEN }));
    const r = readHandTrack(track, t, P);
    const s = toHandState(r);
    expect(s.indexTip).toEqual(r.indexTip);
    // 開いた手では指先は手のひらの中心より上にある（指が上を向いた観測）
    expect(s.indexTip?.y).toBeGreaterThan(s.position.y);
  });

  it("まだ 21 点が無い（一度も認識していない）手は landmarks を省く", () => {
    const s = toHandState(readHandTrack(createHandTrack(), 0, P));
    expect(Object.keys(s).sort()).toEqual(["grip", "indexTip", "position", "tracked"]);
  });
});

describe("handPositions（21 点）", () => {
  const cam = cameraModelOf(P, IMG_W, IMG_H);

  it("21 点は固定の奥行き d = skeletonDepthM × (1 + z × skeletonDepthScale) に，画角から x・y を決めて置く", () => {
    const base = observation();
    const lm = base.landmarks.map((p, i) => ({ ...p, z: (i - 10) * 0.01 }));
    const pos = handPositions({ ...base, landmarks: lm }, cam, P);
    if (pos === null) throw new Error("位置が求められない");
    expect(pos.landmarks).toHaveLength(21);
    for (let i = 0; i < 21; i++) {
      const d = P.skeletonDepthM * (1 + lm[i].z * P.skeletonDepthScale);
      const expected = imageToHead(lm[i], d, cam);
      expect(pos.landmarks[i].x).toBeCloseTo(expected?.x ?? Number.NaN, 9);
      expect(pos.landmarks[i].y).toBeCloseTo(expected?.y ?? Number.NaN, 9);
      expect(pos.landmarks[i].z).toBeCloseTo(expected?.z ?? Number.NaN, 9);
    }
  });

  it("相対の z が 0 の点は skeletonDepthM の奥行き（カメラの位置から -z へ 1.2 m）に置く", () => {
    const pos = handPositions(observation({ z: 0 }), cam, P);
    for (const p of pos?.landmarks ?? []) {
      expect(p.z).toBeCloseTo(-1.2 + P.cameraOffsetZM, 9);
    }
    expect(pos?.landmarks).toHaveLength(21);
  });

  it("z = 0.1 の点は奥行き 1.2 × (1 + 0.1 × 1.5) = 1.38 m に置く", () => {
    const pos = handPositions(observation({ z: 0.1 }), cam, P);
    expect(pos?.landmarks[0].z).toBeCloseTo(-1.38 + P.cameraOffsetZM, 9);
  });

  it("相対の z が同じなら，手首と 4 本の指の付け根の平均は手のひらの中心を同じ奥行きに置いた所", () => {
    const obs = observation();
    const pos = handPositions(obs, cam, P);
    if (pos === null) throw new Error("位置が求められない");
    const center = imageToHead(palmCenter(obs.landmarks), P.skeletonDepthM, cam);
    const ids = [0, 5, 9, 13, 17];
    for (const k of ["x", "y", "z"] as const) {
      const mean = ids.reduce((a, i) => a + pos.landmarks[i][k], 0) / ids.length;
      expect(mean).toBeCloseTo(center?.[k] ?? Number.NaN, 9);
    }
  });

  it("MediaPipe の相対の z が大きい（カメラから遠い）点ほど奥（-z）に置き，他の点は動かさない", () => {
    const base = observation();
    const lm = base.landmarks.map((p, i) => (i === 12 ? { ...p, z: p.z + 0.05 } : p));
    const flat = handPositions(base, cam, P);
    const deep = handPositions({ ...base, landmarks: lm }, cam, P);
    expect(deep?.landmarks[12].z).toBeLessThan(flat?.landmarks[12].z ?? Number.NaN);
    expect(deep?.landmarks[8].z).toBeCloseTo(flat?.landmarks[8].z ?? Number.NaN, 9);
  });

  it("21 点の奥行きは画像の上の手の大きさ（見積もった奥行き）に依らない", () => {
    const small = handPositions(observation({ size: 0.1 }), cam, P);
    const big = handPositions(observation({ size: 0.3 }), cam, P);
    // 手のひらの位置は見積もった奥行きなので変わる
    expect(small?.palm.z).not.toBeCloseTo(big?.palm.z ?? Number.NaN, 3);
    expect(small?.landmarks[9].z).toBeCloseTo(big?.landmarks[9].z ?? Number.NaN, 9);
    expect(small?.landmarks[9].z).toBeCloseTo(-1.2 + P.cameraOffsetZM, 9);
  });

  it("skeletonDepthM・skeletonDepthScale を変えるとその値で置く", () => {
    const p = testHandParams({ skeletonDepthM: 0.6, skeletonDepthScale: 2 });
    const pos = handPositions(observation({ z: 0.1 }), cameraModelOf(p, IMG_W, IMG_H), p);
    expect(pos?.landmarks[0].z).toBeCloseTo(-0.6 * 1.2 + p.cameraOffsetZM, 9);
  });

  it("21 点（固定の奥行き）と人差し指の先（見積もった奥行き）は別の奥行きなので，8 番と indexTip は一致しない", () => {
    const pos = handPositions(observation(), cam, P);
    if (pos === null) throw new Error("位置が求められない");
    expect(pos.landmarks[8].z).toBeCloseTo(-1.2 + P.cameraOffsetZM, 9);
    expect(Math.abs(pos.landmarks[8].z - pos.tip.z)).toBeGreaterThan(0.1);
    // 手のひらの中心・人差し指の先は今までどおり見積もった奥行き（手を伸ばした距離）
    expect(pos.tip.z).toBeGreaterThan(-1.0 + P.cameraOffsetZM - 1e-9);
  });

  it("21 点に足りない手は null", () => {
    const base = observation();
    expect(handPositions({ ...base, landmarks: base.landmarks.slice(0, 20) }, cam, P)).toBeNull();
  });

  it("有限でない点がある手は null（形の崩れた手を描かない）", () => {
    const base = observation();
    const lm = base.landmarks.map((p, i) => (i === 20 ? { ...p, x: Number.NaN } : p));
    expect(handPositions({ ...base, landmarks: lm }, cam, P)).toBeNull();
  });

  it("奥行きが 0 以下になる z（1 + z × k ≦ 0）の点がある手は null", () => {
    const base = observation();
    const lm = base.landmarks.map((p, i) => (i === 4 ? { ...p, z: -1 } : p));
    expect(handPositions({ ...base, landmarks: lm }, cam, P)).toBeNull();
  });
});

describe("readHandTrack（21 点）", () => {
  const cam = cameraModelOf(P, IMG_W, IMG_H);

  it("一度も認識していない手の landmarks は null", () => {
    expect(readHandTrack(createHandTrack(), 0, P).landmarks).toBeNull();
  });

  it("認識した手は 21 点を返し，1 回ごとの 21 点と同じ所にある", () => {
    const obs = observation({ cx: 0.4 });
    const track = createHandTrack();
    see(track, obs, 0);
    const r = readHandTrack(track, 0, P);
    const expected = handPositions(obs, cam, P);
    expect(r.landmarks).toHaveLength(21);
    for (let i = 0; i < 21; i++) {
      expect(r.landmarks?.[i].x).toBeCloseTo(expected?.landmarks[i].x ?? Number.NaN, 9);
      expect(r.landmarks?.[i].y).toBeCloseTo(expected?.landmarks[i].y ?? Number.NaN, 9);
      expect(r.landmarks?.[i].z).toBeCloseTo(expected?.landmarks[i].z ?? Number.NaN, 9);
    }
  });

  it("21 点にはフィルタを掛けない（ぶれた認識が続いても最後の認識の値そのもの）", () => {
    const rnd = seededRandom(11);
    const track = createHandTrack();
    let last: HandObservation = observation();
    let t = 0;
    for (let i = 0; i < 30; i++) {
      t = i * DT;
      const base = observation();
      last = {
        ...base,
        landmarks: base.landmarks.map((p) => ({
          ...p,
          x: p.x + (rnd() - 0.5) * (4 / IMG_W),
          y: p.y + (rnd() - 0.5) * (4 / IMG_H),
        })),
      };
      see(track, last, t);
    }
    const expected = handPositions(last, cam, P);
    const r = readHandTrack(track, t, P);
    for (let i = 0; i < 21; i++) {
      expect(r.landmarks?.[i].x).toBeCloseTo(expected?.landmarks[i].x ?? Number.NaN, 12);
      expect(r.landmarks?.[i].y).toBeCloseTo(expected?.landmarks[i].y ?? Number.NaN, 12);
    }
  });

  it("21 点は外挿しない（認識の合間に手のひらは進むが，21 点は最後の認識の値のまま）", () => {
    const track = createHandTrack();
    let t = 0;
    for (let i = 0; i < 10; i++) {
      t = i * DT;
      see(track, observation({ cx: 0.3 + i * 0.02 }), t);
    }
    const r0 = readHandTrack(track, t, P);
    const r40 = readHandTrack(track, t + 40, P);
    expect(r40.position.x).toBeGreaterThan(r0.position.x);
    expect(r40.landmarks).toEqual(r0.landmarks);
  });

  it("手のひらの中心を変えても 21 点はフィルタで遅れず，最後の位置の所にある（手のひらは遅れる）", () => {
    const track = createHandTrack();
    seeMany(track, observation({ cx: 0.3 }), 0, 5);
    const moved = observation({ cx: 0.7 });
    const t = 5 * DT;
    see(track, moved, t);
    const r = readHandTrack(track, t, P);
    const expected = handPositions(moved, cam, P);
    expect(r.landmarks?.[9].x).toBeCloseTo(expected?.landmarks[9].x ?? Number.NaN, 9);
    // 手のひら（One Euro）は新しい位置まで届いていない
    expect(r.position.x).toBeLessThan((expected?.palm.x ?? Number.NaN) - 1e-3);
  });

  it("握った手は開いた手より指の先が中指の付け根に近い", () => {
    const dist = (r: ReturnType<typeof readHandTrack>, i: number) => {
      const p = r.landmarks?.[i];
      const c = r.landmarks?.[9];
      return p === undefined || c === undefined
        ? Number.NaN
        : Math.hypot(p.x - c.x, p.y - c.y, p.z - c.z);
    };
    const open = trackedHand(observation({ curls: OPEN }));
    const fist = trackedHand(observation({ curls: FIST }));
    const ro = readHandTrack(open.track, open.t, P);
    const rf = readHandTrack(fist.track, fist.t, P);
    for (const tip of [8, 12, 16, 20]) expect(dist(rf, tip)).toBeLessThan(dist(ro, tip));
  });

  it("見失った後に別の形で戻った時は，古い形から滑らず新しい形から始める", () => {
    const { track, t } = trackedHand(observation({ curls: OPEN }));
    see(track, null, t + 400);
    const fistObs = observation({ curls: FIST });
    see(track, fistObs, t + 500);
    const r = readHandTrack(track, t + 500, P);
    const expected = handPositions(fistObs, cam, P);
    expect(r.landmarks?.[12].y).toBeCloseTo(expected?.landmarks[12].y ?? Number.NaN, 9);
  });
});

describe("readHandTrack（skeletonHoldMs）", () => {
  it("見えなかった回が続いても skeletonHoldMs（120 ms）までは直前の 21 点を返す", () => {
    const { track, t } = trackedHand();
    const before = readHandTrack(track, t, P).landmarks;
    see(track, null, t + DT);
    const r = readHandTrack(track, t + DT, P);
    expect(r.landmarks).toEqual(before);
    expect(r.tracked).toBe(true);
  });

  it("見えなかった回が skeletonHoldMs を超えたら landmarks は null，tracked は trackLostMs まで続く", () => {
    const { track, t } = trackedHand();
    see(track, null, t + DT);
    see(track, null, t + 2 * DT);
    const r = readHandTrack(track, t + 2 * DT, P);
    expect(r.landmarks).toBeNull();
    expect(r.tracked).toBe(true);
    expect(Number.isFinite(r.position.x)).toBe(true);
    expect(toHandState(r)).not.toHaveProperty("landmarks");
    expect(toHandState(r).tracked).toBe(true);
  });

  it.each([
    [120, true],
    [121, false],
  ])("最後に認識した映像から %s ms 後の見えない回の後に読むと，21 点を返すか: %s", (gap, shown) => {
    const { track, t } = trackedHand();
    see(track, null, t + gap);
    const r = readHandTrack(track, t + gap, P);
    expect(r.landmarks !== null).toBe(shown);
    expect(r.tracked).toBe(true);
  });

  it("映像の時刻で比べるため，結果が遅れて届いて読む時刻が進んでいても消さない", () => {
    const { track, t } = trackedHand();
    // 見えた回の結果を 300 ms 後に読む
    expect(readHandTrack(track, t + 300, P).landmarks).not.toBeNull();
  });

  it.each([
    [620, true],
    [621, false],
  ])(
    "結果が来なくなった時は読む時刻で比べる（skeletonHoldMs + 500 ms．%s ms 後: %s）",
    (age, shown) => {
      const { track, t } = trackedHand();
      const r = readHandTrack(track, t + age, P);
      expect(r.landmarks !== null).toBe(shown);
      // 開いた手の tracked は 300 + 500 ms まで続く
      expect(r.tracked).toBe(true);
    },
  );

  it("また見えたら 21 点を返す", () => {
    const { track, t } = trackedHand();
    see(track, null, t + DT);
    see(track, null, t + 2 * DT);
    expect(readHandTrack(track, t + 2 * DT, P).landmarks).toBeNull();
    see(track, observation({ cx: 0.6 }), t + 3 * DT);
    const r = readHandTrack(track, t + 3 * DT, P);
    expect(r.landmarks).toHaveLength(21);
    expect(r.tracked).toBe(true);
  });

  it("見失って tracked が外れた手の landmarks は null", () => {
    const { track, t } = trackedHand();
    see(track, null, t + 1000);
    const r = readHandTrack(track, t + 1000, P);
    expect(r.tracked).toBe(false);
    expect(r.landmarks).toBeNull();
  });

  it("skeletonHoldMs を変えるとその時間で消す（0 なら 1 回見えないだけで消す）", () => {
    const p0 = testHandParams({ skeletonHoldMs: 0 });
    const { track, t } = trackedHand();
    see(track, null, t + 10, p0);
    expect(readHandTrack(track, t + 10, p0).landmarks).toBeNull();
    const p200 = testHandParams({ skeletonHoldMs: 200 });
    const b = trackedHand();
    see(b.track, null, b.t + 2 * DT, p200);
    expect(readHandTrack(b.track, b.t + 2 * DT, p200).landmarks).not.toBeNull();
  });
});

describe("handPositions（届く範囲の倍率．Issue #163）", () => {
  const gained = testHandParams({ reachGainX: 1.2, reachGainY: 1.4 });
  const cam = cameraModelOf(gained, IMG_W, IMG_H);

  it("画像の中心にある手は倍率 1 と同じ所に置く", () => {
    const obs = observation({ cx: 0.5, cy: 0.5 });
    // 手のひらの中心が画像の中心に来るように，中心からのずれだけ手全体を動かす
    const c = palmCenter(obs.landmarks);
    const centered = {
      ...obs,
      landmarks: obs.landmarks.map((p) => ({ ...p, x: p.x - (c.x - 0.5), y: p.y - (c.y - 0.5) })),
    };
    const a = handPositions(centered, cam, gained);
    const b = handPositions(centered, cam, P);
    for (const k of ["x", "y", "z"] as const) {
      expect(a?.palm[k]).toBeCloseTo(b?.palm[k] ?? Number.NaN, 9);
      expect(a?.landmarks[8][k]).toBeCloseTo(b?.landmarks[8][k] ?? Number.NaN, 9);
    }
  });

  it("端に寄った手は，手のひらの中心のずれを横 1.2 倍・縦 1.4 倍にした所に置く", () => {
    const obs = observation({ cx: 0.85, cy: 0.2 });
    const pos = handPositions(obs, cam, gained);
    if (pos === null) throw new Error("位置が求められない");
    const c = palmCenter(obs.landmarks);
    const moved = { x: 0.5 + 1.2 * (c.x - 0.5), y: 0.5 + 1.4 * (c.y - 0.5), z: c.z };
    const expected = imageToHead(moved, pos.depth, cam);
    expect(pos.palm.x).toBeCloseTo(expected?.x ?? Number.NaN, 9);
    expect(pos.palm.y).toBeCloseTo(expected?.y ?? Number.NaN, 9);
    // 倍率 1 より外側（右・上）
    const plain = handPositions(obs, cam, P);
    expect(pos.palm.x).toBeGreaterThan(plain?.palm.x ?? Number.POSITIVE_INFINITY);
    expect(pos.palm.y).toBeGreaterThan(plain?.palm.y ?? Number.POSITIVE_INFINITY);
  });

  it("手の形・大きさと奥行きは変えない（21 点の手のひらの中心からの差は倍率 1 と同じ）", () => {
    const obs = observation({ cx: 0.2, cy: 0.75 });
    const a = handPositions(obs, cam, gained);
    const b = handPositions(obs, cam, P);
    if (a === null || b === null) throw new Error("位置が求められない");
    expect(a.depth).toBeCloseTo(b.depth, 9);
    for (let i = 0; i < 21; i++) {
      for (const k of ["x", "y", "z"] as const) {
        expect(a.landmarks[i][k] - a.landmarks[0][k]).toBeCloseTo(
          b.landmarks[i][k] - b.landmarks[0][k],
          9,
        );
      }
    }
  });
});
