import { describe, expect, it } from "vitest";
import { testParams } from "../testFixtures";
import {
  createLocomotionState,
  isWalking,
  type LocomotionState,
  onLocomotionStep,
  resetLocomotion,
  smoothSpeed,
  stopTimeoutMs,
  targetSpeed,
  updateLocomotion,
  WALKING_MIN_SPEED,
} from "./locomotion";

const P = testParams({
  stepMinIntervalMs: 300,
  stepTentativeTimeoutMs: 1000,
  stepStopPeriodFactor: 1.5,
  stepStopMaxMs: 1000,
  strideM: 0.5,
  maxWalkSpeed: 1.4,
  tentativeWalkSpeed: 0.4,
  speedSpringOmega: 8,
  speedMaxAccel: 2,
  speedMaxDecel: 4,
});

/** t0 から t1 まで 16 ms ごとに進める．各時刻の状態を返す */
function advance(
  s: LocomotionState,
  t0: number,
  t1: number,
  params = P,
): { t: number; mode: string; speed: number }[] {
  const out = [];
  for (let t = t0; t <= t1; t += 16) {
    updateLocomotion(s, t, 0.016, params);
    out.push({ t, mode: s.mode, speed: s.speed });
  }
  return out;
}

describe("状態機械", () => {
  it("1 歩目で仮に歩く（低速），間隔の合う 2 歩目で歩く", () => {
    const s = createLocomotionState();
    expect(targetSpeed(s, P)).toBe(0);
    onLocomotionStep(s, 1000, P);
    expect(s.mode).toBe("tentative");
    expect(targetSpeed(s, P)).toBe(0.4);
    onLocomotionStep(s, 1500, P);
    expect(s.mode).toBe("walking");
    expect(s.periodSec).toBeCloseTo(0.5, 12);
    expect(targetSpeed(s, P)).toBeCloseTo(1.0, 12);
  });

  it("stepMinIntervalMs より早い 2 歩目は数えない（1 歩目の時刻も保つ）", () => {
    const s = createLocomotionState();
    onLocomotionStep(s, 1000, P);
    onLocomotionStep(s, 1200, P);
    expect(s.mode).toBe("tentative");
    expect(s.lastStepT).toBe(1000);
    onLocomotionStep(s, 1500, P);
    expect(s.mode).toBe("walking");
    expect(s.periodSec).toBeCloseTo(0.5, 12);
  });

  it("stepMinIntervalMs ちょうどの 2 歩目は歩くにする", () => {
    const s = createLocomotionState();
    onLocomotionStep(s, 1000, P);
    onLocomotionStep(s, 1300, P);
    expect(s.mode).toBe("walking");
  });

  it("stepTentativeTimeoutMs を超えた 2 歩目は新しい 1 歩目として扱う", () => {
    const s = createLocomotionState();
    onLocomotionStep(s, 1000, P);
    onLocomotionStep(s, 2100, P);
    expect(s.mode).toBe("tentative");
    expect(s.lastStepT).toBe(2100);
  });

  it("仮に歩いてから stepTentativeTimeoutMs の間に 2 歩目が無ければ止まる", () => {
    const s = createLocomotionState();
    onLocomotionStep(s, 1000, P);
    const log = advance(s, 1000, 2200);
    const stopAt = log.find((x) => x.mode === "stopped")?.t;
    expect(stopAt).toBeGreaterThan(2000);
    expect(stopAt).toBeLessThanOrEqual(2016);
  });

  it("歩いている時は，直近の周期 × stepStopPeriodFactor の間に歩が無ければ止まる", () => {
    const s = createLocomotionState();
    onLocomotionStep(s, 1000, P);
    onLocomotionStep(s, 1500, P);
    expect(stopTimeoutMs(s, P)).toBeCloseTo(750, 9);
    const log = advance(s, 1500, 3000);
    const stopAt = log.find((x) => x.mode === "stopped")?.t ?? Number.NaN;
    expect(stopAt - 1500).toBeGreaterThan(750);
    expect(stopAt - 1500).toBeLessThanOrEqual(766);
  });

  it("止まるまでの待ちは stepStopMaxMs を超えない", () => {
    const s = createLocomotionState();
    onLocomotionStep(s, 1000, P);
    onLocomotionStep(s, 1900, P); // 周期 0.9 秒 × 1.5 = 1350 ms
    expect(stopTimeoutMs(s, P)).toBe(1000);
  });

  it("歩き続けている間は止まらない", () => {
    const s = createLocomotionState();
    for (let t = 1000; t <= 5000; t += 500) {
      onLocomotionStep(s, t, P);
      const log = advance(s, t, t + 484);
      expect(log.every((x) => x.mode !== "stopped")).toBe(true);
    }
    expect(s.mode).toBe("walking");
  });
});

describe("速さ", () => {
  it("歩く時の目標は strideM / 周期", () => {
    const s = createLocomotionState();
    onLocomotionStep(s, 0, P);
    onLocomotionStep(s, 625, P);
    expect(targetSpeed(s, P)).toBeCloseTo(0.5 / 0.625, 12);
  });

  it("速い足踏みでも maxWalkSpeed を超えない", () => {
    const s = createLocomotionState();
    onLocomotionStep(s, 0, P);
    onLocomotionStep(s, 300, P); // 0.5 / 0.3 = 1.67
    expect(targetSpeed(s, P)).toBe(1.4);
    const low = testParams({ ...P, maxWalkSpeed: 0.3 });
    const t = createLocomotionState();
    onLocomotionStep(t, 0, low);
    expect(targetSpeed(t, low)).toBe(0.3);
  });

  it("周期は 1 歩のずれで跳ねない（直近の間隔に寄せた平均）", () => {
    const s = createLocomotionState();
    onLocomotionStep(s, 0, P);
    onLocomotionStep(s, 500, P);
    onLocomotionStep(s, 1500, P); // 1 歩見逃した
    expect(s.periodSec).toBeGreaterThan(0.5);
    expect(s.periodSec).toBeLessThan(1.0);
  });

  it("2 Hz の足踏みを続けると約 1.0 m/s に落ち着く", () => {
    const s = createLocomotionState();
    for (let t = 0; t <= 4000; t += 500) {
      onLocomotionStep(s, t, P);
      advance(s, t, t + 484);
    }
    expect(s.speed).toBeCloseTo(1.0, 2);
    expect(isWalking(s)).toBe(true);
  });

  it("止まった後も減速し終わるまでは walking が true，その後 false", () => {
    const s = createLocomotionState();
    for (let t = 0; t <= 2000; t += 500) {
      onLocomotionStep(s, t, P);
      advance(s, t, t + 484);
    }
    const log = advance(s, 2500, 4000);
    const stopIdx = log.findIndex((x) => x.mode === "stopped");
    expect(stopIdx).toBeGreaterThan(0);
    expect(log[stopIdx].speed).toBeGreaterThan(WALKING_MIN_SPEED);
    const afterStop = { ...s, mode: "stopped" as const, speed: log[stopIdx].speed };
    expect(isWalking(afterStop)).toBe(true);
    expect(s.speed).toBeLessThanOrEqual(WALKING_MIN_SPEED);
    expect(isWalking(s)).toBe(false);
  });

  it("resetLocomotion は速さもすぐに 0 にする", () => {
    const s = createLocomotionState();
    onLocomotionStep(s, 0, P);
    advance(s, 0, 400);
    resetLocomotion(s);
    expect(s).toEqual(createLocomotionState());
    expect(isWalking(s)).toBe(false);
  });
});

describe("smoothSpeed（バネとダンパー）", () => {
  const params = { speedSpringOmega: 8, speedMaxAccel: 2, speedMaxDecel: 4 };

  it.each([0.005, 0.016, 0.05, 0.2, 1])("dt=%s 秒でも目標を行き過ぎない（加速・減速）", (dt) => {
    const v = { speed: 0, speedRate: 0 };
    for (let i = 0; i < 400; i++) {
      smoothSpeed(v, 1.2, dt, params);
      expect(v.speed).toBeLessThanOrEqual(1.2);
    }
    expect(v.speed).toBeCloseTo(1.2, 3);
    for (let i = 0; i < 400; i++) {
      smoothSpeed(v, 0.3, dt, params);
      expect(v.speed).toBeGreaterThanOrEqual(0.3);
    }
    expect(v.speed).toBeCloseTo(0.3, 3);
  });

  it("加速は speedMaxAccel，減速は speedMaxDecel を超えない", () => {
    const dt = 0.016;
    const v = { speed: 0, speedRate: 0 };
    let prev = v.speed;
    for (let i = 0; i < 200; i++) {
      smoothSpeed(v, 1.4, dt, params);
      expect((v.speed - prev) / dt).toBeLessThanOrEqual(2 + 1e-9);
      prev = v.speed;
    }
    for (let i = 0; i < 200; i++) {
      smoothSpeed(v, 0, dt, params);
      expect((prev - v.speed) / dt).toBeLessThanOrEqual(4 + 1e-9);
      prev = v.speed;
    }
    expect(v.speed).toBeCloseTo(0, 6);
  });

  it("速さは負にならない", () => {
    const v = { speed: 0.1, speedRate: -10 };
    smoothSpeed(v, 0, 0.5, params);
    expect(v.speed).toBeGreaterThanOrEqual(0);
  });

  it.each([
    [1, 0],
    [1, -0.01],
    [Number.NaN, 0.016],
    [Number.POSITIVE_INFINITY, 0.016],
    [1, Number.NaN],
  ])("目標 %s・dt %s では何もしない", (target, dt) => {
    const v = { speed: 0.5, speedRate: 0.1 };
    smoothSpeed(v, target, dt, params);
    expect(v).toEqual({ speed: 0.5, speedRate: 0.1 });
  });
});
