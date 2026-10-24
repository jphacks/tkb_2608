import { describe, expect, it } from "vitest";
import { crouchAccel, testParams } from "../testFixtures";
import {
  candidateThreshold,
  createPostureState,
  onPostureStep,
  type PostureState,
  resetPostureMotion,
  shouldSuppressSteps,
  updatePosture,
} from "./posture";

const P = testParams({
  postureCandidateAccel: 0.8,
  postureNoiseFactor: 4,
  postureCandidateMs: 100,
  postureRestBeforeMs: 150,
  postureMaxIntegrateMs: 1500,
  zuptAccel: 0.35,
  zuptGyroDps: 25,
  zuptMaxVelocity: 0.25,
  zuptMs: 150,
  crouchDepthM: 0.4,
  postureConfirmRatio: 0.5,
  postureStepSuppressM: 0.08,
  postureStepSuppressAfterMs: 500,
  standEscapeSteps: 4,
});

const DT_MS = 16;

/** t0 から durationMs の間，上下の加速度 f(秒) を通す．姿勢が変わった時刻の一覧を返す */
function feed(
  s: PostureState,
  t0: number,
  durationMs: number,
  f: (sec: number) => number,
  params = P,
  gyro: (sec: number) => number = () => 0,
): number[] {
  const changes: number[] = [];
  for (let t = t0; t < t0 + durationMs; t += DT_MS) {
    const sec = (t - t0) / 1000;
    if (updatePosture(s, t, DT_MS / 1000, f(sec), gyro(sec), params)) changes.push(t);
  }
  return changes;
}

const still = () => 0;

/** 静止 → 深さ depth を dur 秒でしゃがむ（負なら立つ）→ 静止．動作の始まりは startT */
function motion(s: PostureState, startT: number, depth: number, dur: number, params = P): number[] {
  return feed(s, startT, 2500, crouchAccel(depth, dur), params);
}

describe("しゃがみ・立ち上がりの確定", () => {
  it("0.4 m を 0.7 秒でしゃがむと，動作の始まりから 1 秒以内に crouching になる", () => {
    const s = createPostureState();
    feed(s, 0, 1000, still);
    const changes = motion(s, 1000, 0.4, 0.7);
    expect(changes).toHaveLength(1);
    expect(changes[0] - 1000).toBeLessThanOrEqual(1000);
    expect(s.posture).toBe("crouching");
    expect(s.lastOutcome).toBe("crouch");
    expect(s.lastDeltaH).toBeCloseTo(-0.4, 1);
  });

  it("しゃがんだ後に立ち上がると standing に戻る（1 秒以内）", () => {
    const s = createPostureState();
    feed(s, 0, 1000, still);
    motion(s, 1000, 0.4, 0.7);
    feed(s, 3500, 1000, still);
    const changes = motion(s, 4500, -0.4, 0.7);
    expect(changes).toHaveLength(1);
    expect(changes[0] - 4500).toBeLessThanOrEqual(1000);
    expect(s.posture).toBe("standing");
    expect(s.lastOutcome).toBe("stand");
    expect(s.changeCount).toBe(2);
  });

  it("立っている時に上へ動いても，しゃがんでいる時に下へ動いても姿勢は変わらない", () => {
    const up = createPostureState("standing");
    feed(up, 0, 1000, still);
    expect(motion(up, 1000, -0.4, 0.7)).toEqual([]);
    expect(up.posture).toBe("standing");
    const down = createPostureState("crouching");
    feed(down, 0, 1000, still);
    expect(motion(down, 1000, 0.4, 0.7)).toEqual([]);
    expect(down.posture).toBe("crouching");
  });

  it.each([
    [0.17, "standing", "small"],
    [0.24, "crouching", "crouch"],
  ])("確定の境目（深さ × 50% = 0.2 m）: %s m 沈むと %s", (depth, posture, outcome) => {
    const s = createPostureState();
    feed(s, 0, 1000, still);
    motion(s, 1000, depth, 0.6);
    expect(s.posture).toBe(posture);
    expect(s.lastOutcome).toBe(outcome);
  });

  it("確定の境目は crouchDepthM × postureConfirmRatio に従う", () => {
    const s = createPostureState();
    feed(s, 0, 1000, still);
    motion(s, 1000, 0.24, 0.6, testParams({ ...P, crouchDepthM: 0.6 }));
    expect(s.posture).toBe("standing");
    const t = createPostureState();
    feed(t, 0, 1000, still);
    motion(t, 1000, 0.24, 0.6, testParams({ ...P, postureConfirmRatio: 0.3 }));
    expect(t.posture).toBe("crouching");
  });
});

describe("しゃがみ歩き・しゃがんだままの揺れ", () => {
  it("しゃがんで 30 秒，小さな揺れ（足踏み程度）が続いても立ったと判定しない", () => {
    const s = createPostureState("crouching");
    feed(s, 0, 1000, still);
    // 2 Hz・上下 ±2 cm の揺れ（物理的に辻褄の合う形: x = d(cos − 1)）と 0.7 Hz の小さな揺れ
    const d = 0.02;
    const w = 2 * Math.PI * 2;
    const sway = (t: number) =>
      -d * w * w * Math.cos(w * t) + 0.2 * Math.sin(2 * Math.PI * 0.7 * t);
    expect(feed(s, 1000, 30000, sway, P, (t) => 15 + 10 * Math.sin(t))).toEqual([]);
    expect(s.posture).toBe("crouching");
  });

  it("しゃがんだまま周りを見る（角速度だけ大きい）間も立ったと判定しない", () => {
    const s = createPostureState("crouching");
    feed(s, 0, 1000, still);
    expect(
      feed(
        s,
        1000,
        10000,
        (t) => 0.3 * Math.sin(2 * Math.PI * 1.3 * t),
        P,
        () => 120,
      ),
    ).toEqual([]);
    expect(s.posture).toBe("crouching");
  });
});

describe("静止の後だけ動作の候補にする", () => {
  // 静止しない動き（加速度は候補のしきい値未満，静止の条件より大きい）が続いた直後にしゃがむ
  const busy = (t: number) => 0.5 * Math.sin(2 * Math.PI * 5 * t);

  it("静止せずに動いていた直後のしゃがみは確定しない", () => {
    const s = createPostureState();
    feed(s, 0, 2000, busy);
    expect(motion(s, 2000, 0.4, 0.7, testParams({ ...P, postureNoiseFactor: 0 }))).toEqual([]);
    expect(s.posture).toBe("standing");
  });

  it("postureRestBeforeMs=0 なら静止を求めない", () => {
    const params = testParams({ ...P, postureRestBeforeMs: 0, postureNoiseFactor: 0 });
    const s = createPostureState();
    feed(s, 0, 2000, busy, params);
    expect(motion(s, 2000, 0.4, 0.7, params)).toHaveLength(1);
    expect(s.posture).toBe("crouching");
  });
});

describe("積分の打ち切り", () => {
  it("静止しないまま postureMaxIntegrateMs を超えたら確定せずに捨てる（timeout）", () => {
    const s = createPostureState();
    feed(s, 0, 1000, still);
    // しゃがむ動きの後，頭を回し続けて静止しない
    const changes = feed(s, 1000, 3000, crouchAccel(0.4, 0.7), P, (t) => (t < 0.05 ? 0 : 60));
    expect(changes).toEqual([]);
    expect(s.posture).toBe("standing");
    expect(s.lastOutcome).toBe("timeout");
    expect(s.phase).toBe("idle");
  });
});

describe("ノイズとしきい値", () => {
  it("候補のしきい値は max(postureCandidateAccel, 倍率 × ノイズの RMS)", () => {
    const s = createPostureState();
    expect(candidateThreshold(s, P)).toBe(0.8);
    s.noiseVar = 0.3 * 0.3;
    expect(candidateThreshold(s, P)).toBeCloseTo(1.2, 12);
  });

  it("非有限の値・dt が 0 以下のサンプルは無視する", () => {
    const s = createPostureState();
    feed(s, 0, 500, still);
    const before = { ...s };
    expect(updatePosture(s, 600, 0.016, Number.NaN, 0, P)).toBe(false);
    expect(updatePosture(s, 600, 0, 3, 0, P)).toBe(false);
    expect(updatePosture(s, 600, -0.016, 3, 0, P)).toBe(false);
    expect(s).toEqual(before);
  });
});

describe("足踏みの抑止（shouldSuppressSteps）", () => {
  it("動作の途中（Δh が大きい）と，終わった後 postureStepSuppressAfterMs は抑止する", () => {
    const s = createPostureState();
    feed(s, 0, 1000, still);
    let suppressedDuring = false;
    let changeT = Number.NaN;
    for (let t = 1000; t < 3500; t += DT_MS) {
      const changed = updatePosture(s, t, 0.016, crouchAccel(0.4, 0.7)((t - 1000) / 1000), 0, P);
      if (changed) changeT = t;
      if (Number.isNaN(changeT) && shouldSuppressSteps(s, t, P)) suppressedDuring = true;
    }
    expect(suppressedDuring).toBe(true);
    expect(shouldSuppressSteps(s, changeT + 499, P)).toBe(true);
    expect(shouldSuppressSteps(s, changeT + 500, P)).toBe(false);
  });

  it("静止している時は抑止しない", () => {
    const s = createPostureState();
    feed(s, 0, 1000, still);
    expect(shouldSuppressSteps(s, 1000, P)).toBe(false);
  });
});

describe("逃げ道 A（onPostureStep）", () => {
  it("しゃがんだまま，立っている時の大きさの歩が standEscapeSteps 続いたら立つ", () => {
    const s = createPostureState("crouching");
    const changes = [1, 2, 3, 4].map((i) => onPostureStep(s, i * 500, 1.2, 1.0, P));
    expect(changes).toEqual([false, false, false, true]);
    expect(s.posture).toBe("standing");
    expect(s.lastOutcome).toBe("stand-escape");
  });

  it("途中に小さな歩（しゃがみ歩き）が入ると数え直す", () => {
    const s = createPostureState("crouching");
    for (const [i, peak] of [1.2, 1.2, 1.2, 0.7, 1.2, 1.2, 1.2].entries()) {
      expect(onPostureStep(s, i * 500, peak, 1.0, P)).toBe(false);
    }
    expect(s.posture).toBe("crouching");
    expect(onPostureStep(s, 4000, 1.2, 1.0, P)).toBe(true);
  });

  it("standEscapeSteps=0 なら無効", () => {
    const s = createPostureState("crouching");
    const params = testParams({ ...P, standEscapeSteps: 0 });
    for (let i = 0; i < 20; i++) expect(onPostureStep(s, i * 500, 5, 1.0, params)).toBe(false);
    expect(s.posture).toBe("crouching");
  });

  it("立っている時は何もしない", () => {
    const s = createPostureState("standing");
    for (let i = 0; i < 10; i++) expect(onPostureStep(s, i * 500, 5, 1.0, P)).toBe(false);
    expect(s.posture).toBe("standing");
    expect(s.changeCount).toBe(0);
  });

  it("逃げ道で立った直後は足踏みを抑止しない", () => {
    const s = createPostureState("crouching");
    s.lastDeltaH = -0.4;
    for (let i = 1; i <= 4; i++) onPostureStep(s, i * 500, 1.2, 1.0, P);
    expect(shouldSuppressSteps(s, 2001, P)).toBe(false);
  });
});

describe("resetPostureMotion", () => {
  it("動作の途中を捨て，姿勢は保つ", () => {
    const s = createPostureState("crouching");
    feed(s, 0, 1000, still);
    feed(s, 1000, 300, crouchAccel(-0.4, 0.7));
    expect(s.phase).not.toBe("idle");
    resetPostureMotion(s);
    expect(s.phase).toBe("idle");
    expect(s.v).toBe(0);
    expect(s.h).toBe(0);
    expect(s.posture).toBe("crouching");
  });
});
