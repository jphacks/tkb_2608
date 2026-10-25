import { describe, expect, it } from "vitest";
import { DEFAULT_INPUT_PARAMS } from "../params";
import { crouchAccel, testParams } from "../testFixtures";
import {
  candidateThreshold,
  createPostureState,
  onPostureStep,
  type PostureState,
  resetPostureMotion,
  resetSlowCrouch,
  resetStandWalk,
  shouldSuppressSteps,
  standWalkBoundary,
  updatePosture,
  updateStandWalk,
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
  // 仕様の変更（Issue #48）: しゃがみ・立ち上がりの速さ（速度の最大 0.8 m/s 以上）で深さの基準を超えたら，静止を待たずに確定する．
  // 以前のテストは 0.4 m を 0.7 秒（速度の最大 約 1.14 m/s）でしゃがんで頭を回し続ける場面を「時間切れで捨てる」としていたが，
  // その速さは早めの確定の対象になったため，時間切れはゆっくりした動作（速度の最大 0.8 m/s 未満）で確かめる
  it("ゆっくり（速度の最大 0.8 m/s 未満）沈んで静止しないまま postureMaxIntegrateMs を超えたら確定せずに捨てる（timeout）", () => {
    const s = createPostureState();
    feed(s, 0, 1000, still);
    // 0.4 m を 1.2 秒（速度の最大 約 0.67 m/s）でしゃがんだ後，頭を回し続けて静止しない
    const changes = feed(s, 1000, 3000, crouchAccel(0.4, 1.2), P, (t) => (t < 0.05 ? 0 : 60));
    expect(changes).toEqual([]);
    expect(s.posture).toBe("standing");
    expect(s.lastOutcome).toBe("timeout");
    expect(s.phase).toBe("idle");
  });
});

describe("早めの確定（静止を待たない）", () => {
  it("しゃがみの速さ（0.4 m を 0.7 秒）なら，その後に頭を回し続けて静止しなくても 1 秒以内に crouching", () => {
    const s = createPostureState();
    feed(s, 0, 1000, still);
    const changes = feed(s, 1000, 3000, crouchAccel(0.4, 0.7), P, (t) => (t < 0.05 ? 0 : 60));
    expect(changes).toHaveLength(1);
    expect(changes[0] - 1000).toBeLessThanOrEqual(1000);
    expect(s.posture).toBe("crouching");
    expect(s.lastOutcome).toBe("crouch");
  });

  it("早めの確定は動作の途中（動作が終わる 0.7 秒より前）に起きる", () => {
    const s = createPostureState();
    feed(s, 0, 1000, still);
    const changes = feed(s, 1000, 3000, crouchAccel(0.4, 0.7), P, () => 60);
    expect(changes).toHaveLength(1);
    expect(changes[0] - 1000).toBeLessThan(700);
  });

  it("速度の最大が 0.8 m/s 未満なら，深さの基準を超えても静止するまで確定しない（静止の後に確定する）", () => {
    const s = createPostureState();
    feed(s, 0, 1000, still);
    // 0.4 m を 1.2 秒（速度の最大 約 0.67 m/s）．動作は 2200 で終わり，その後は静止
    const changes = feed(s, 1000, 4000, crouchAccel(0.4, 1.2));
    expect(changes).toHaveLength(1);
    expect(changes[0]).toBeGreaterThanOrEqual(2200 + P.zuptMs);
    expect(s.posture).toBe("crouching");
    expect(s.lastOutcome).toBe("crouch");
  });

  it("確定の後，しゃがんだまま体が揺れて静止しなくても，続けて立ち上がる動作を追える", () => {
    // しゃがむ（1000〜1700）→ 静止の条件を満たさない小さな揺れ（gap 秒）→ 立つ（0.7 秒）
    const sway = (t: number) => 0.6 * Math.sin(2 * Math.PI * 5 * t);
    for (const gap of [0.3, 0.5, 0.8]) {
      const s = createPostureState();
      feed(s, 0, 1000, still);
      const standAt = 0.7 + gap;
      const changes = feed(s, 1000, 4000, (t) =>
        t < 0.7
          ? crouchAccel(0.4, 0.7)(t)
          : t < standAt
            ? sway(t)
            : crouchAccel(-0.4, 0.7)(t - standAt),
      );
      expect(changes, `gap ${gap}`).toHaveLength(2);
      expect(s.posture, `gap ${gap}`).toBe("standing");
      // 立ち上がりも動作の始まりから 1 秒以内
      expect(changes[1] - (1000 + standAt * 1000), `gap ${gap}`).toBeLessThanOrEqual(1000);
    }
  });
});

describe("積分を捨てる場面", () => {
  it("立っている時に上へ動いた積分は，時間切れを待たずに捨てる（足踏みを抑止しない）", () => {
    const s = createPostureState();
    feed(s, 0, 1000, still);
    let suppressed = false;
    let idleAt = Number.NaN;
    const f = crouchAccel(-0.4, 0.7);
    for (let t = 1000; t < 3500; t += DT_MS) {
      updatePosture(s, t, DT_MS / 1000, f((t - 1000) / 1000), 0, P);
      if (shouldSuppressSteps(s, t, P)) suppressed = true;
      if (t > 1100 && Number.isNaN(idleAt) && s.phase === "idle") idleAt = t;
    }
    expect(s.posture).toBe("standing");
    expect(s.lastOutcome).not.toBe("timeout");
    expect(idleAt - 1000).toBeLessThan(P.postureMaxIntegrateMs);
    expect(suppressed).toBe(false);
  });

  it("しゃがんでいる時に下へ動いた積分も捨てる", () => {
    const s = createPostureState("crouching");
    feed(s, 0, 1000, still);
    feed(s, 1000, 2500, crouchAccel(0.4, 0.7));
    expect(s.posture).toBe("crouching");
    expect(s.lastOutcome).not.toBe("timeout");
  });

  it.each<"standing" | "crouching">(["standing", "crouching"])(
    "足踏みを数えた（onPostureStep）ら，%s の積分中の動作を捨てる",
    (posture) => {
      const s = createPostureState(posture);
      feed(s, 0, 1000, still);
      feed(s, 1000, 300, crouchAccel(posture === "standing" ? 0.4 : -0.4, 0.7));
      expect(s.phase).not.toBe("idle");
      onPostureStep(s, 1300, 1.2, 1.0, testParams({ ...P, standEscapeSteps: 0 }));
      expect(s.phase).toBe("idle");
      expect(s.v).toBe(0);
      expect(s.h).toBe(0);
      expect(s.posture).toBe(posture);
    },
  );

  it("候補にならずに終わった短い揺れの後も直前の静止が残り，すぐにしゃがむと確定できる", () => {
    const s = createPostureState();
    feed(s, 0, 1000, still);
    // 1 サンプルだけの揺れ（候補のしきい値 0.8 を超え，次のサンプルで 0 に戻る）
    feed(s, 1000, 16, () => 1.0);
    expect(s.phase).toBe("candidate");
    // 揺れの 32 ms 後（新しい静止を数え直す前）にしゃがむ
    feed(s, 1016, 32, still);
    expect(s.phase).toBe("idle");
    expect(s.restMs).toBeGreaterThanOrEqual(P.postureRestBeforeMs);
    const changes = motion(s, 1048, 0.4, 0.7);
    expect(changes).toHaveLength(1);
    expect(s.posture).toBe("crouching");
  });
});

describe("ゆっくりした・静止の無いしゃがみ（漏れ付きの長い積分）", () => {
  const SLOW = testParams({ ...P, postureSlowGyroDps: 40 });
  // 静止しない動き（加速度は候補のしきい値未満，静止の条件より大きい）が 2 秒続いた後に，0.6 m を 2 秒でしゃがむ
  // （速度の最大 0.6 m/s．静止の後でないため短い積分の候補にはならない）
  const busy = (t: number) => 0.5 * Math.sin(2 * Math.PI * 5 * t);
  const slowCrouch = (depth: number) => (t: number) =>
    t < 2 ? busy(t) : crouchAccel(depth, 2)(t - 2);

  it("静止の無いゆっくりしたしゃがみで crouching になる（crouch-slow）", () => {
    const s = createPostureState();
    const changes = feed(s, 0, 8000, slowCrouch(0.6), SLOW);
    expect(changes).toHaveLength(1);
    expect(s.posture).toBe("crouching");
    expect(s.lastOutcome).toBe("crouch-slow");
    expect(s.lastDeltaH).toBeLessThanOrEqual(-SLOW.postureConfirmRatio * SLOW.crouchDepthM);
  });

  it("postureSlowGyroDps=0 なら使わない（同じ動きで立ったまま）", () => {
    const s = createPostureState();
    expect(
      feed(s, 0, 8000, slowCrouch(0.6), testParams({ ...SLOW, postureSlowGyroDps: 0 })),
    ).toEqual([]);
    expect(s.posture).toBe("standing");
  });

  it("頭が回っている間（回転の平均が postureSlowGyroDps 以上）は反応しない", () => {
    const s = createPostureState();
    expect(feed(s, 0, 8000, slowCrouch(0.6), SLOW, () => 60)).toEqual([]);
    expect(s.posture).toBe("standing");
  });

  it("頭の回転が postureSlowGyroDps 未満なら反応する", () => {
    const s = createPostureState();
    expect(feed(s, 0, 8000, slowCrouch(0.6), SLOW, () => 20)).toHaveLength(1);
    expect(s.posture).toBe("crouching");
  });

  it("歩いている間（毎サンプル resetSlowCrouch される）は反応しない", () => {
    const s = createPostureState();
    const f = slowCrouch(0.6);
    for (let t = 0; t < 8000; t += DT_MS) {
      resetSlowCrouch(s, false);
      expect(updatePosture(s, t, DT_MS / 1000, f(t / 1000), 0, SLOW)).toBe(false);
    }
    expect(s.posture).toBe("standing");
  });

  it("立ち上がりには使わない（しゃがんでいる時のゆっくりした・静止の無い立ち上がりでは立たない）", () => {
    const s = createPostureState("crouching");
    expect(feed(s, 0, 8000, slowCrouch(-0.6), SLOW)).toEqual([]);
    expect(s.posture).toBe("crouching");
  });

  it("ゆっくりしたしゃがみで切り替わった後も足踏みを抑止する（crouch-slow は姿勢の変わった動作）", () => {
    const s = createPostureState();
    const changes = feed(s, 0, 8000, slowCrouch(0.6), SLOW);
    expect(shouldSuppressSteps(s, changes[0] + 1, SLOW)).toBe(true);
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
  // 仕様の変更（Issue #48）: 抑止の時間（postureStepSuppressAfterMs）は，姿勢を切り替えた時（早めの確定は動作の途中）ではなく，
  // 動作の終わり（速度が 0 付近に戻った時）から数える．確定の後の減速と揺れの山を足踏みと数えないため
  it("動作の途中（Δh が大きい）と，動作が終わった後 postureStepSuppressAfterMs は抑止する（終わりから数える）", () => {
    const s = createPostureState();
    feed(s, 0, 1000, still);
    let suppressedDuring = false;
    let changeT = Number.NaN;
    let suppressedUntilChange = true;
    for (let t = 1000; t < 3500; t += DT_MS) {
      const changed = updatePosture(s, t, 0.016, crouchAccel(0.4, 0.7)((t - 1000) / 1000), 0, P);
      if (changed) changeT = t;
      if (Number.isNaN(changeT) && shouldSuppressSteps(s, t, P)) suppressedDuring = true;
      // 切り替えてから動作が終わる（lastOutcomeT が確定の時刻より後に動く）までは抑止し続ける
      if (!Number.isNaN(changeT) && s.lastOutcomeT === changeT && !shouldSuppressSteps(s, t, P))
        suppressedUntilChange = false;
    }
    expect(suppressedDuring).toBe(true);
    expect(suppressedUntilChange).toBe(true);
    const endT = s.lastOutcomeT;
    expect(endT).toBeGreaterThan(changeT);
    expect(shouldSuppressSteps(s, endT + 499, P)).toBe(true);
    expect(shouldSuppressSteps(s, endT + 500, P)).toBe(false);
  });

  it("時間切れ・小さすぎた動作の後は抑止しない", () => {
    const timeout = createPostureState();
    feed(timeout, 0, 1000, still);
    const t1 = 4000;
    feed(timeout, 1000, t1 - 1000, crouchAccel(0.4, 1.2), P, (t) => (t < 0.05 ? 0 : 60));
    expect(timeout.lastOutcome).toBe("timeout");
    expect(Math.abs(timeout.lastDeltaH)).toBeGreaterThan(P.postureStepSuppressM);
    expect(shouldSuppressSteps(timeout, timeout.lastOutcomeT + 1, P)).toBe(false);

    const small = createPostureState();
    feed(small, 0, 1000, still);
    motion(small, 1000, 0.17, 0.6);
    expect(small.lastOutcome).toBe("small");
    expect(Math.abs(small.lastDeltaH)).toBeGreaterThan(P.postureStepSuppressM);
    expect(shouldSuppressSteps(small, small.lastOutcomeT + 1, P)).toBe(false);
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

// ---- 反動の後の立つ・しゃがむ（Issue #94）----
// 立つ前に一度沈む・しゃがむ前に一度伸びる（反動）と，反動は今の姿勢から切り替わりえない向きなので捨てるが，
// 静止の記録と速度は残し，静止の後 1 秒（REST_TRACK_MS）の間は逆向きの動作を候補にする．Δh は反動の底（頂点）から測る

/** 長さ T 秒で速度を dv だけ変える半周期の正弦の加速度 */
function velocityBump(T: number, dv: number): (t: number) => number {
  const a = (dv * Math.PI) / (2 * T);
  return (t) => (t < 0 || t > T ? 0 : a * Math.sin((Math.PI * t) / T));
}

/**
 * 反動つきの動作の上下の加速度．up = true なら「下へ vDip m/s まで沈む → 上へ vUp m/s で上がる → 止まる」（立つ），
 * false なら上下を逆にしたもの（しゃがむ）．時間は沈む 0.25 秒・切り返し 0.4 秒・止まる 0.7 秒
 */
function reboundAccel(up: boolean, vDip: number, vUp: number): (t: number) => number {
  const [t1, t2, t3] = [0.25, 0.4, 0.7];
  const dip = velocityBump(t1, -vDip);
  const turn = velocityBump(t2, vDip + vUp);
  const stop = velocityBump(t3, -vUp);
  const sign = up ? 1 : -1;
  return (t) =>
    sign *
    (t < t1 ? dip(t) : t < t1 + t2 ? turn(t - t1) : t < t1 + t2 + t3 ? stop(t - t1 - t2) : 0);
}

/** 加速度 f を積分した変位の最小・最大と速度の最小・最大（合成の波形が意図どおりかを確かめる） */
function kinematics(f: (t: number) => number, durationSec: number) {
  let v = 0;
  let x = 0;
  const r = { xMin: 0, xMax: 0, vMin: 0, vMax: 0 };
  for (let t = 0; t < durationSec; t += 0.001) {
    v += f(t) * 0.001;
    x += v * 0.001;
    r.xMin = Math.min(r.xMin, x);
    r.xMax = Math.max(r.xMax, x);
    r.vMin = Math.min(r.vMin, v);
    r.vMax = Math.max(r.vMax, v);
  }
  return r;
}

describe("updatePosture（反動の後の立つ・しゃがむ）", () => {
  // 下に約 1 m/s 沈んでから，底から約 0.85 m 上がる
  const standWithDip = reboundAccel(true, 1, 1.75);
  const crouchWithRise = reboundAccel(false, 1, 1.75);

  it("合成の波形: 下へ約 1 m/s 沈み，底から約 0.85 m 上がる", () => {
    const k = kinematics(standWithDip, 2);
    expect(k.vMin).toBeCloseTo(-1, 1);
    expect(k.xMax - k.xMin).toBeGreaterThan(0.8);
    expect(k.xMax - k.xMin).toBeLessThan(0.9);
  });

  it("しゃがんでいる時，静止 → 沈み込み → 立ち上がりで standing になる（動作の始まりから 1 秒以内）", () => {
    const s = createPostureState("crouching");
    feed(s, 0, 1000, still);
    const changes = feed(s, 1000, 3000, standWithDip);
    expect(changes).toHaveLength(1);
    expect(changes[0] - 1000).toBeLessThanOrEqual(1000);
    expect(s.posture).toBe("standing");
    expect(s.lastOutcome).toBe("stand");
  });

  it("立っている時，静止 → 伸び上がり → しゃがみで crouching になる（動作の始まりから 1 秒以内）", () => {
    const s = createPostureState("standing");
    feed(s, 0, 1000, still);
    const changes = feed(s, 1000, 3000, crouchWithRise);
    expect(changes).toHaveLength(1);
    expect(changes[0] - 1000).toBeLessThanOrEqual(1000);
    expect(s.posture).toBe("crouching");
    expect(s.lastOutcome).toBe("crouch");
  });

  it("反動の後の立ち上がりは，静止の後 REST_TRACK_MS（1 秒）を過ぎると候補にしない", () => {
    // 沈み込み（0.25 秒で -1 m/s）→ 0.3 秒で止まる → 静止の条件を満たさない小さな揺れが 1.2 秒 → 立ち上がり
    const dip = velocityBump(0.25, -1);
    const stop = velocityBump(0.3, 1);
    const busy = (t: number) => 0.5 * Math.sin(2 * Math.PI * 5 * t);
    const rise = crouchAccel(-0.6, 0.7);
    const f = (t: number) =>
      t < 0.25 ? dip(t) : t < 0.55 ? stop(t - 0.25) : t < 1.75 ? busy(t) : rise(t - 1.75);
    const s = createPostureState("crouching");
    feed(s, 0, 1000, still);
    expect(feed(s, 1000, 4000, f, testParams({ ...P, postureNoiseFactor: 0 }))).toEqual([]);
    expect(s.posture).toBe("crouching");
  });

  it("しゃがんだまま上下に揺れる（下から始まるしゃがみ歩きの揺れ．±6 cm・2 Hz）間は立たない", () => {
    const d = 0.06;
    const w = 2 * Math.PI * 2;
    const s = createPostureState("crouching");
    feed(s, 0, 1000, still);
    expect(feed(s, 1000, 6000, (t) => -d * w * w * Math.cos(w * t))).toEqual([]);
    expect(s.posture).toBe("crouching");
  });

  it("下から始まるしゃがみ歩きの揺れでは，反動の後の候補が積分を続けず（時間切れにならず），足踏みを抑止しない", () => {
    // 反動の後の候補は，速度の向きが一度候補の向きに変わった後は普通に Δh を測り，また反動の向きへ戻れば向きで捨てる
    // （「反動の後の候補をまた向きで捨てた時は何も残さない」．しゃがみ歩きの揺れで候補が続かないため）
    const d = 0.06;
    const w = 2 * Math.PI * 2;
    const f = (t: number) => -d * w * w * Math.cos(w * t);
    const s = createPostureState("crouching");
    feed(s, 0, 1000, still);
    const suppressedAt: number[] = [];
    const outcomes = new Set<string>();
    for (let t = 1000; t < 7000; t += DT_MS) {
      updatePosture(s, t, DT_MS / 1000, f((t - 1000) / 1000), 0, P);
      if (shouldSuppressSteps(s, t, P)) suppressedAt.push(t);
      outcomes.add(s.lastOutcome);
    }
    expect(outcomes.has("timeout")).toBe(false);
    expect(suppressedAt).toEqual([]);
  });

  it("反動の無い普通の立ち上がり・しゃがみは今までどおり（反動の扱いが入っても変わらない）", () => {
    const up = createPostureState("crouching");
    feed(up, 0, 1000, still);
    expect(motion(up, 1000, -0.4, 0.7)).toHaveLength(1);
    expect(up.posture).toBe("standing");
    const down = createPostureState("standing");
    feed(down, 0, 1000, still);
    expect(motion(down, 1000, 0.4, 0.7)).toHaveLength(1);
    expect(down.posture).toBe("crouching");
  });

  it("resetPostureMotion は反動の記録（counterSign・fromCounter）も捨てる", () => {
    const s = createPostureState("crouching");
    feed(s, 0, 1000, still);
    // 沈み込みの途中まで（向きで捨てられ，反動の向きが残る）
    feed(s, 1000, 400, velocityBump(0.25, -1));
    expect(s.counterSign).toBe(-1);
    resetPostureMotion(s);
    expect(s.counterSign).toBe(0);
    expect(s.fromCounter).toBe(false);
  });
});

// ---- しゃがみ歩きから止まらずに立つ（standWalkBoundary・updateStandWalk．Issue #94）----

describe("standWalkBoundary", () => {
  it.each([
    [1, 6, 4, Math.sqrt(6)],
    [6, 1, 4, Math.sqrt(6)],
    [1, 2, 4, Math.sqrt(2)],
    [2, 1, 1, Math.sqrt(2)],
  ])("Ps=%s・Pc=%s・歩数 %s なら境目は幾何平均（%s）", (ps, pc, steps, b) => {
    expect(
      standWalkBoundary({
        standWalkPeakStanding: ps,
        standWalkPeakCrouching: pc,
        standWalkSteps: steps,
      }),
    ).toBeCloseTo(b, 12);
  });

  it.each([
    ["比が 2 未満", 1, 1.99, 4],
    ["比が 2 未満（逆向き）", 1.99, 1, 4],
    ["同じ大きさ", 3, 3, 4],
    ["歩数が 0", 1, 6, 0],
    ["歩数が負", 1, 6, -1],
    ["Ps が 0", 0, 6, 4],
    ["Pc が 0", 1, 0, 4],
    ["Ps が負", -1, 6, 4],
    ["Ps が NaN", Number.NaN, 6, 4],
    ["Pc が NaN", 1, Number.NaN, 4],
    ["歩数が NaN", 1, 6, Number.NaN],
  ])("%s なら NaN（使わない）", (_name, ps, pc, steps) => {
    expect(
      standWalkBoundary({
        standWalkPeakStanding: ps,
        standWalkPeakCrouching: pc,
        standWalkSteps: steps,
      }),
    ).toBeNaN();
  });

  it("既定のしきい値（DEFAULT_INPUT_PARAMS）では NaN（しゃがみ歩きから立つ判定は無効）", () => {
    expect(standWalkBoundary(DEFAULT_INPUT_PARAMS)).toBeNaN();
  });
});

describe("updateStandWalk", () => {
  // しゃがみ歩きの山の方が大きい人（Ps=1・Pc=6．境目 √6 ≈ 2.45）
  const SW = testParams({
    ...P,
    standWalkPeakStanding: 1,
    standWalkPeakCrouching: 6,
    standWalkSteps: 4,
    stepRefractoryMs: 250,
    stepStopMaxMs: 1000,
    stepGyroWindowMs: 200,
  });
  // 立った足踏みの山の方が大きい人（Ps=6・Pc=1）
  const SW_REV = testParams({ ...SW, standWalkPeakStanding: 6, standWalkPeakCrouching: 1 });

  const BP_DT = 10;
  const PULSE_MS = 160;

  interface Peak {
    /** 山の始まりの時刻（ms）．山の最大は始まりから 80 ms */
    readonly t: number;
    /** 帯域通過後の山の大きさ（m/s^2） */
    readonly h: number;
    /** 頭が速く回った最後の時刻（省けば回っていない） */
    readonly gyroHighT?: number;
  }

  /** 山の列（0.5 秒おき等）を作る */
  function peaksEvery(t0: number, intervalMs: number, heights: readonly number[]): Peak[] {
    return heights.map((h, i) => ({ t: t0 + i * intervalMs, h }));
  }

  /**
   * 山の列を，帯域通過後の値（半周期の正弦の山．山の間は 0）として 10 ms ごとに流す．姿勢が変わった時刻の一覧を返す．
   * 既定では歩いている（walking = true）とし，最後に数えた歩はそのサンプルの時刻とする
   */
  function feedPeaks(
    s: PostureState,
    peaks: readonly Peak[],
    params = SW,
    opts: { walking?: boolean; lastStepT?: number } = {},
  ): number[] {
    const changes: number[] = [];
    if (peaks.length === 0) return changes;
    const end = peaks[peaks.length - 1].t + PULSE_MS + 200;
    let gyroHighT = Number.NEGATIVE_INFINITY;
    for (let t = peaks[0].t - 100; t <= end; t += BP_DT) {
      let bp = 0;
      for (const p of peaks) {
        if (t >= p.t && t <= p.t + PULSE_MS) {
          bp = p.h * Math.sin((Math.PI * (t - p.t)) / PULSE_MS);
          if (p.gyroHighT !== undefined) gyroHighT = p.gyroHighT;
        }
      }
      const walking = opts.walking ?? true;
      const lastStepT = opts.lastStepT ?? t;
      if (updateStandWalk(s, t, bp, lastStepT, walking, gyroHighT, params)) changes.push(t);
    }
    return changes;
  }

  it("例: 6 の山を 0.5 秒おき → 1.2 の山を 0.5 秒おきに 4 つで，4 つ目で立つ（stand-walk）", () => {
    const s = createPostureState("crouching");
    expect(feedPeaks(s, peaksEvery(0, 500, [6, 6, 6, 6]))).toEqual([]);
    expect(s.posture).toBe("crouching");
    const changes = feedPeaks(s, peaksEvery(2000, 500, [1.2, 1.2, 1.2, 1.2]));
    expect(changes).toHaveLength(1);
    // 4 つ目の山（3500 から）の後で立つ
    expect(changes[0]).toBeGreaterThan(3500);
    expect(changes[0]).toBeLessThan(3500 + 500);
    expect(s.posture).toBe("standing");
    expect(s.lastOutcome).toBe("stand-walk");
    expect(s.changeCount).toBe(1);
  });

  it("3 つだけでは立たない", () => {
    const s = createPostureState("crouching");
    expect(feedPeaks(s, peaksEvery(0, 500, [6, 6, 1.2, 1.2, 1.2]))).toEqual([]);
    expect(s.posture).toBe("crouching");
  });

  it("途中にしゃがみ歩きの山（6）が入ると数え直す", () => {
    const s = createPostureState("crouching");
    expect(feedPeaks(s, peaksEvery(0, 500, [1.2, 1.2, 1.2, 6, 1.2, 1.2, 1.2]))).toEqual([]);
    expect(s.posture).toBe("crouching");
    // 数え直した後の 4 つ目で立つ
    expect(feedPeaks(s, peaksEvery(3500, 500, [1.2]))).toHaveLength(1);
    expect(s.posture).toBe("standing");
  });

  it("0.6 の山（0.7 × Ps 未満）は数えない（数え直しもしない）", () => {
    const s = createPostureState("crouching");
    // 0.6 が 4 つ続いても立たない
    expect(feedPeaks(s, peaksEvery(0, 450, [0.6, 0.6, 0.6, 0.6, 0.6]))).toEqual([]);
    expect(s.posture).toBe("crouching");
    // 1.2 を 3 つ数えた後に 0.6 が入っても数え直さず，次の 1.2 で 4 つ目
    const t = createPostureState("crouching");
    expect(feedPeaks(t, peaksEvery(0, 450, [1.2, 1.2, 1.2, 0.6]))).toEqual([]);
    expect(feedPeaks(t, peaksEvery(1800, 450, [1.2]))).toHaveLength(1);
    expect(t.posture).toBe("standing");
  });

  it.each([
    [0.7, true],
    [0.69, false],
    [2.4, true],
    [2.5, false],
  ])("Pc > Ps の人の立った側の範囲（0.7 × Ps ≤ P < B）: 山 %s が 4 つで立つ = %s", (h, stands) => {
    const s = createPostureState("crouching");
    feedPeaks(s, peaksEvery(0, 500, [h, h, h, h]));
    expect(s.posture).toBe(stands ? "standing" : "crouching");
  });

  it("境目より大きい山（2.5．しゃがみ歩きの側）が入ると数え直す", () => {
    const s = createPostureState("crouching");
    expect(feedPeaks(s, peaksEvery(0, 500, [1.2, 1.2, 1.2, 2.5, 1.2, 1.2, 1.2]))).toEqual([]);
    expect(s.posture).toBe("crouching");
  });

  it("山とみなす下限（0.5 × min(Ps, Pc)）未満の揺れは山として見ない（数えも数え直しもしない）", () => {
    const s = createPostureState("crouching");
    expect(feedPeaks(s, peaksEvery(0, 450, [1.2, 1.2, 1.2, 0.45]))).toEqual([]);
    expect(feedPeaks(s, peaksEvery(1800, 450, [1.2]))).toHaveLength(1);
    expect(s.posture).toBe("standing");
  });

  it("前に数えた歩から stepStopMaxMs（1 秒）を超えて空くと数え直す（1.4 秒空く）", () => {
    const s = createPostureState("crouching");
    expect(feedPeaks(s, peaksEvery(0, 500, [1.2, 1.2, 1.2]))).toEqual([]);
    // 3 つ目（1000）から 1.4 秒後
    expect(feedPeaks(s, peaksEvery(2400, 500, [1.2, 1.2, 1.2]))).toEqual([]);
    expect(s.posture).toBe("crouching");
    expect(feedPeaks(s, peaksEvery(3900, 500, [1.2]))).toHaveLength(1);
    expect(s.posture).toBe("standing");
  });

  it("前の山から stepRefractoryMs（250 ms）未満の山は歩として見ない", () => {
    const s = createPostureState("crouching");
    // 1000 の山の 150 ms 後に山（見ない）．数えるのは 0・500・1000・1500 の 4 つ目以降
    const peaks: Peak[] = [
      { t: 0, h: 1.2 },
      { t: 500, h: 1.2 },
      { t: 1000, h: 1.2 },
      { t: 1180, h: 1.2 },
    ];
    expect(feedPeaks(s, peaks)).toEqual([]);
    expect(s.posture).toBe("crouching");
    expect(feedPeaks(s, peaksEvery(1500, 500, [1.2]))).toHaveLength(1);
  });

  it("頭が速く回った山は数を 0 に戻す", () => {
    const s = createPostureState("crouching");
    const peaks: Peak[] = [
      ...peaksEvery(0, 500, [1.2, 1.2, 1.2]),
      // 4 つ目の山の最大（1580）の時に頭が回っていた
      { t: 1500, h: 1.2, gyroHighT: 1580 },
      ...peaksEvery(2000, 500, [1.2, 1.2, 1.2]),
    ];
    expect(feedPeaks(s, peaks)).toEqual([]);
    expect(s.posture).toBe("crouching");
    expect(feedPeaks(s, peaksEvery(3500, 500, [1.2]))).toHaveLength(1);
  });

  it("歩いておらず，最後に数えた歩から 2 秒を超えていれば数え始めない（しゃがんで静止の間の揺れ）", () => {
    const s = createPostureState("crouching");
    expect(
      feedPeaks(s, peaksEvery(5000, 500, [1.2, 1.2, 1.2, 1.2, 1.2]), SW, {
        walking: false,
        lastStepT: 0,
      }),
    ).toEqual([]);
    expect(s.posture).toBe("crouching");
  });

  it("歩いていなくても，最後に数えた歩から 2 秒以内なら数え始め，その後は続けて数える", () => {
    const s = createPostureState("crouching");
    // 最後に数えた歩は 0．1 つ目の山（500〜660）は 2 秒以内，4 つ目（2000〜）は 2 秒を過ぎる
    const changes = feedPeaks(s, peaksEvery(500, 500, [1.2, 1.2, 1.2, 1.2]), SW, {
      walking: false,
      lastStepT: 0,
    });
    expect(changes).toHaveLength(1);
    expect(s.posture).toBe("standing");
    expect(s.lastOutcome).toBe("stand-walk");
  });

  it("Pc < Ps の人: 境目より大きい山（立った足踏みの側）が 4 つ続いたら立つ", () => {
    const s = createPostureState("crouching");
    expect(feedPeaks(s, peaksEvery(0, 500, [1, 1, 1, 1]), SW_REV)).toEqual([]);
    expect(feedPeaks(s, peaksEvery(2000, 500, [6, 6, 6, 6]), SW_REV)).toHaveLength(1);
    expect(s.posture).toBe("standing");
    expect(s.lastOutcome).toBe("stand-walk");
  });

  it.each([
    [2.5, true],
    [2.4, false],
    [1, false],
  ])("Pc < Ps の人: 山 %s が 4 つで立つ = %s（P > B が立った側）", (h, stands) => {
    const s = createPostureState("crouching");
    feedPeaks(s, peaksEvery(0, 500, [h, h, h, h]), SW_REV);
    expect(s.posture).toBe(stands ? "standing" : "crouching");
  });

  it("Pc < Ps の人: 途中にしゃがみ歩きの側の山（2.4）が入ると数え直す", () => {
    const s = createPostureState("crouching");
    expect(feedPeaks(s, peaksEvery(0, 500, [6, 6, 6, 2.4, 6, 6, 6]), SW_REV)).toEqual([]);
    expect(s.posture).toBe("crouching");
  });

  it("立っている時は何もしない", () => {
    const s = createPostureState("standing");
    expect(feedPeaks(s, peaksEvery(0, 500, [1.2, 1.2, 1.2, 1.2, 1.2, 1.2]))).toEqual([]);
    expect(s.posture).toBe("standing");
    expect(s.changeCount).toBe(0);
    expect(s.walkCount).toBe(0);
  });

  it("使わない設定（境目が NaN．既定のしきい値を含む）では立たない", () => {
    for (const params of [
      testParams({ ...SW, standWalkPeakStanding: 0 }),
      testParams({ ...SW, standWalkPeakCrouching: 1.5 }),
      testParams({ ...SW, standWalkSteps: 0 }),
      DEFAULT_INPUT_PARAMS,
    ]) {
      const s = createPostureState("crouching");
      expect(
        feedPeaks(s, peaksEvery(0, 500, [6, 6, 1.2, 1.2, 1.2, 1.2, 1.2, 1.2]), params),
      ).toEqual([]);
      expect(s.posture).toBe("crouching");
    }
  });

  it("非有限の値は無視する（状態を変えない）", () => {
    const s = createPostureState("crouching");
    feedPeaks(s, peaksEvery(0, 500, [1.2, 1.2]));
    const before = { ...s };
    expect(updateStandWalk(s, 5000, Number.NaN, 5000, true, Number.NEGATIVE_INFINITY, SW)).toBe(
      false,
    );
    expect(updateStandWalk(s, 5000, Number.POSITIVE_INFINITY, 5000, true, 0, SW)).toBe(false);
    expect(s).toEqual(before);
  });

  it("resetStandWalk で数を捨てる（姿勢は保つ）", () => {
    const s = createPostureState("crouching");
    feedPeaks(s, peaksEvery(0, 500, [1.2, 1.2, 1.2]));
    expect(s.walkCount).toBe(3);
    resetStandWalk(s);
    expect(s.walkCount).toBe(0);
    expect(s.posture).toBe("crouching");
    // 捨てた後は 4 つ数え直す
    expect(feedPeaks(s, peaksEvery(1500, 500, [1.2, 1.2, 1.2]))).toEqual([]);
    expect(feedPeaks(s, peaksEvery(3000, 500, [1.2]))).toHaveLength(1);
  });
});
