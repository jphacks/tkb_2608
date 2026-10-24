import { describe, expect, it } from "vitest";
import { crouchAccel, testParams } from "../testFixtures";
import {
  candidateThreshold,
  createPostureState,
  onPostureStep,
  type PostureState,
  resetPostureMotion,
  resetSlowCrouch,
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
