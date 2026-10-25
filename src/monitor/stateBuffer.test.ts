// 見守り画面の状態のため置きと補間（lerpAngle・interpolateMonitorState・sampleMonitorStates・staleMonitorStateCount）のテスト．
// 基準は docs/04_SPEC/SPEC_01_画面遷移とモジュール構成.md「見守り」の「見守り画面」の描き方
// （今 − 約 100 ms の前後 2 つの状態を補間．位置と t は直線，向きは近い回り方，姿勢と階は新しい方に移った時に切り替え，
// 階が変わる時は位置を補間しない．新しい状態が届かない時は最後の状態のまま止める）
import { describe, expect, it } from "vitest";
import type { MonitorState } from "../share/monitorState";
import {
  createMonitorPose,
  interpolateMonitorState,
  lerpAngle,
  MONITOR_BUFFER_LIMIT,
  MONITOR_RENDER_DELAY_MS,
  type ReceivedMonitorState,
  sampleMonitorStates,
  staleMonitorStateCount,
} from "./stateBuffer";

const TWO_PI = Math.PI * 2;

/** 角度を −π 以上 π 未満に直す（同じ向きかを比べるため） */
const wrap = (angle: number): number =>
  ((((angle + Math.PI) % TWO_PI) + TWO_PI) % TWO_PI) - Math.PI;

/** 2 つの角度が同じ向きか（2π の違いは同じとみなす） */
function expectSameAngle(actual: number, expected: number): void {
  const d = Math.abs(wrap(actual - expected));
  expect(Math.min(d, TWO_PI - d)).toBeLessThan(1e-9);
}

function state(overrides: Partial<MonitorState> = {}): MonitorState {
  return {
    studentId: 1,
    seq: 0,
    floor: 0,
    posture: "standing",
    t: 0,
    x: 0,
    z: 0,
    yaw: 0,
    pitch: 0,
    ...overrides,
  };
}

const received = (
  receivedAt: number,
  overrides: Partial<MonitorState> = {},
): ReceivedMonitorState => ({
  state: state(overrides),
  receivedAt,
});

describe("定数", () => {
  it("描く時刻は約 100 ms 遅らせる", () => {
    expect(MONITOR_RENDER_DELAY_MS).toBe(100);
  });

  it("ためる数の上限は 64", () => {
    expect(MONITOR_BUFFER_LIMIT).toBe(64);
  });
});

describe("lerpAngle", () => {
  it("alpha 0 で a，1 で b（同じ向き）", () => {
    expectSameAngle(lerpAngle(0.3, 1.2, 0), 0.3);
    expectSameAngle(lerpAngle(0.3, 1.2, 1), 1.2);
  });

  it("差が π より小さければその間を直線に進む", () => {
    expect(lerpAngle(0, 1, 0.5)).toBeCloseTo(0.5, 12);
    expect(lerpAngle(1, -1, 0.25)).toBeCloseTo(0.5, 12);
  });

  it.each<[string, number, number, number]>([
    ["π の近くから −π の近くへ（+π をまたいで進む）", Math.PI - 0.1, -Math.PI + 0.1, Math.PI],
    ["−π の近くから π の近くへ（−π をまたいで戻る）", -Math.PI + 0.1, Math.PI - 0.1, -Math.PI],
    ["3 から −3 へ（短い回り方は 2π − 6 ≈ 0.283）", 3, -3, 3 + (TWO_PI - 6) / 2],
  ])("%s", (_, a, b, expected) => {
    const mid = lerpAngle(a, b, 0.5);
    expectSameAngle(mid, expected);
    // 遠い回り方（0 付近を通る）にならない
    expect(Math.abs(wrap(mid))).toBeGreaterThan(Math.PI - 0.2);
  });

  it("±π をまたぐ時，途中の角度は短い回り方の弧の上にある", () => {
    const a = Math.PI - 0.2;
    const b = -Math.PI + 0.2;
    for (const alpha of [0.1, 0.25, 0.5, 0.75, 0.9]) {
      expectSameAngle(lerpAngle(a, b, alpha), a + 0.4 * alpha);
    }
  });

  it("2π 以上はなれた値でも近い回り方で補間する", () => {
    expectSameAngle(lerpAngle(0, TWO_PI + 0.4, 0.5), 0.2);
    expectSameAngle(lerpAngle(0, -TWO_PI * 3 - 0.4, 0.5), -0.2);
  });

  it("同じ角度（2π の違い）なら回らない", () => {
    for (const alpha of [0, 0.5, 1]) {
      expectSameAngle(lerpAngle(1, 1 + TWO_PI, alpha), 1);
    }
  });

  it("差がちょうど π の時も半周だけ回る（途中は ±π/2）", () => {
    // 差が −π 以上 π 未満の範囲に直すので，ちょうど π の差は −π として回る
    const mid = lerpAngle(0, Math.PI, 0.5);
    expect(Math.abs(Math.abs(wrap(mid)) - Math.PI / 2)).toBeLessThan(1e-9);
    expectSameAngle(lerpAngle(0, Math.PI, 1), Math.PI);
  });
});

describe("interpolateMonitorState", () => {
  it("位置（x・z）と t は直線で補間する", () => {
    const out = createMonitorPose();
    interpolateMonitorState(state({ x: 1, z: -2, t: 10 }), state({ x: 3, z: 2, t: 11 }), 0.25, out);
    expect(out.x).toBeCloseTo(1.5, 12);
    expect(out.z).toBeCloseTo(-1, 12);
    expect(out.t).toBeCloseTo(10.25, 12);
  });

  it("yaw は近い回り方で補間する（±π をまたぐ）", () => {
    const out = createMonitorPose();
    interpolateMonitorState(
      state({ yaw: Math.PI - 0.1 }),
      state({ yaw: -Math.PI + 0.1 }),
      0.5,
      out,
    );
    expectSameAngle(out.yaw, Math.PI);
  });

  it("pitch は間を補間する", () => {
    const out = createMonitorPose();
    interpolateMonitorState(state({ pitch: -0.4 }), state({ pitch: 0.6 }), 0.5, out);
    expect(out.pitch).toBeCloseTo(0.1, 12);
  });

  it("姿勢は新しい方の状態に移った時（alpha 1）に切り替える", () => {
    const a = state({ posture: "standing" });
    const b = state({ posture: "crouching" });
    const out = createMonitorPose();
    expect(interpolateMonitorState(a, b, 0.99, out).posture).toBe("standing");
    expect(interpolateMonitorState(a, b, 1, out).posture).toBe("crouching");
  });

  it("階が変わる区間は位置も向きも補間せず，前の状態のまま．alpha 1 で新しい状態になる", () => {
    const a = state({ floor: 0, x: 1, z: 1, t: 5, yaw: 0.1, pitch: 0.1 });
    const b = state({ floor: 1, x: 9, z: 9, t: 6, yaw: 1, pitch: -0.3, posture: "crouching" });
    const out = createMonitorPose();
    for (const alpha of [0, 0.3, 0.5, 0.99]) {
      interpolateMonitorState(a, b, alpha, out);
      expect(out.floor).toBe(0);
      expect(out.x).toBe(1);
      expect(out.z).toBe(1);
      expect(out.posture).toBe("standing");
    }
    interpolateMonitorState(a, b, 1, out);
    expect(out).toEqual({
      t: 6,
      floor: 1,
      posture: "crouching",
      x: 9,
      z: 9,
      yaw: 1,
      pitch: -0.3,
    });
  });

  it.each<[string, number, number]>([
    ["負の alpha は 0 として扱う", -0.5, 0],
    ["1 を超える alpha は 1 として扱う", 1.5, 10],
    ["−Infinity は 0", Number.NEGATIVE_INFINITY, 0],
  ])("%s", (_, alpha, expectedX) => {
    const out = createMonitorPose();
    interpolateMonitorState(state({ x: 0 }), state({ x: 10 }), alpha, out);
    expect(out.x).toBe(expectedX);
  });

  it.each([Number.NaN, Number.POSITIVE_INFINITY])(
    "alpha が %s でも有限の値を書く（NaN を出さない）",
    (alpha) => {
      const out = createMonitorPose();
      interpolateMonitorState(state({ x: 0, t: 1 }), state({ x: 10, t: 2 }), alpha, out);
      for (const value of [out.x, out.z, out.t, out.yaw, out.pitch]) {
        expect(Number.isFinite(value)).toBe(true);
      }
      expect([0, 10]).toContain(out.x);
    },
  );

  it("書き込み先 out をそのまま返す（作り直さない）", () => {
    const out = createMonitorPose();
    expect(interpolateMonitorState(state(), state(), 0.5, out)).toBe(out);
  });
});

describe("sampleMonitorStates", () => {
  it("状態が無ければ false で，out を変えない", () => {
    const out = createMonitorPose();
    out.x = 123;
    expect(sampleMonitorStates([], 1000, out)).toBe(false);
    expect(out.x).toBe(123);
  });

  it("1 件だけなら，どの時刻でもその状態", () => {
    const buffer = [received(1000, { x: 2 })];
    for (const time of [0, 1000, 5000]) {
      const out = createMonitorPose();
      expect(sampleMonitorStates(buffer, time, out)).toBe(true);
      expect(out.x).toBe(2);
    }
  });

  it("最初の状態より前の時刻は最初の状態", () => {
    const buffer = [received(1000, { x: 1 }), received(1050, { x: 2 })];
    const out = createMonitorPose();
    sampleMonitorStates(buffer, 900, out);
    expect(out.x).toBe(1);
    sampleMonitorStates(buffer, 1000, out);
    expect(out.x).toBe(1);
  });

  it("最後の状態より後の時刻は最後の状態のまま止める（先を見込んで動かさない）", () => {
    const buffer = [received(1000, { x: 1, t: 1 }), received(1050, { x: 2, t: 1.05 })];
    const out = createMonitorPose();
    sampleMonitorStates(buffer, 1050, out);
    expect(out.x).toBe(2);
    sampleMonitorStates(buffer, 9999, out);
    expect(out.x).toBe(2);
    expect(out.t).toBe(1.05);
  });

  it("前後の 2 つの状態の間を受け取った時刻の比で補間する", () => {
    const buffer = [received(1000, { x: 0 }), received(1050, { x: 1 }), received(1100, { x: 3 })];
    const out = createMonitorPose();
    sampleMonitorStates(buffer, 1025, out);
    expect(out.x).toBeCloseTo(0.5, 12);
    sampleMonitorStates(buffer, 1075, out);
    expect(out.x).toBeCloseTo(2, 12);
    sampleMonitorStates(buffer, 1050, out);
    expect(out.x).toBeCloseTo(1, 12);
  });

  it("階が変わる区間は，新しい状態の時刻までは前の状態のまま", () => {
    const buffer = [received(1000, { floor: 0, x: 0 }), received(1100, { floor: 1, x: 5 })];
    const out = createMonitorPose();
    sampleMonitorStates(buffer, 1099, out);
    expect(out.floor).toBe(0);
    expect(out.x).toBe(0);
    sampleMonitorStates(buffer, 1100, out);
    expect(out.floor).toBe(1);
    expect(out.x).toBe(5);
  });

  it("同じ時刻に受け取った 2 つは新しい方を使う（0 で割らない）", () => {
    const buffer = [received(1000, { x: 0 }), received(1000, { x: 1 }), received(1100, { x: 2 })];
    const out = createMonitorPose();
    sampleMonitorStates(buffer, 1000, out);
    expect(Number.isFinite(out.x)).toBe(true);
    sampleMonitorStates(buffer, 1050, out);
    expect(out.x).toBeCloseTo(1.5, 12);
  });
});

describe("staleMonitorStateCount", () => {
  const buffer = [received(1000), received(1050), received(1100), received(1150)];

  it("空なら 0", () => {
    expect(staleMonitorStateCount([], 1000)).toBe(0);
  });

  it("描く時刻がすべての状態より前なら 0", () => {
    expect(staleMonitorStateCount(buffer, 900)).toBe(0);
  });

  it.each<[number, number]>([
    [1000, 0],
    [1049, 0],
    [1050, 1],
    [1075, 1],
    [1100, 2],
    [1150, 3],
    [5000, 3],
  ])("描く時刻 %d では先頭から %d 件を捨ててよい（補間の始まりの 1 件は残す）", (time, count) => {
    expect(staleMonitorStateCount(buffer, time)).toBe(count);
  });

  it("捨てた後でも同じ時刻の補間の結果が変わらない", () => {
    const items = [received(1000, { x: 0 }), received(1050, { x: 1 }), received(1100, { x: 3 })];
    const before = createMonitorPose();
    sampleMonitorStates(items, 1075, before);
    const after = createMonitorPose();
    sampleMonitorStates(items.slice(staleMonitorStateCount(items, 1075)), 1075, after);
    expect(after).toEqual(before);
  });
});
