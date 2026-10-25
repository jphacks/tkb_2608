import { describe, expect, it } from "vitest";
import { pitchOfQuat, yawOfQuat } from "../head/quat";
import { testParams } from "../testFixtures";
import {
  advanceMock,
  applyMockDrag,
  applyMockKeyDown,
  applyMockKeyUp,
  DEFAULT_MOCK_OPTIONS,
  INITIAL_MOCK_STATE,
  interpretMockKey,
  MOCK_MAX_DT_SEC,
  type MockState,
  mockHead,
  mockTargetSpeed,
  mockWalking,
  releaseMockKeys,
  wrapMockAngle,
} from "./mockKeys";

const P = testParams({ speedSpringOmega: 8, speedMaxAccel: 2, speedMaxDecel: 4 });

function runFor(s: MockState, t0: number, ms: number): MockState {
  let st = s;
  for (let t = t0; t <= t0 + ms; t += 16) st = advanceMock(st, t, P);
  return st;
}

describe("interpretMockKey", () => {
  it.each([
    ["KeyW", "forward"],
    ["ArrowUp", "forward"],
    ["KeyS", "slow"],
    ["ArrowDown", "slow"],
    ["KeyC", "crouch"],
    ["KeyA", null],
    ["KeyD", null],
    ["Space", null],
    ["", null],
  ])("%s → %s", (code, action) => {
    expect(interpretMockKey(code)).toBe(action);
  });
});

describe("キー", () => {
  it("W で 1.0 m/s，S で 0.5 m/s（前へ），両方なら W", () => {
    expect(DEFAULT_MOCK_OPTIONS.walkSpeed).toBe(1.0);
    expect(DEFAULT_MOCK_OPTIONS.slowSpeed).toBe(0.5);
    const w = applyMockKeyDown(INITIAL_MOCK_STATE, "KeyW", false);
    expect(mockTargetSpeed(w)).toBe(1.0);
    const s = applyMockKeyDown(INITIAL_MOCK_STATE, "KeyS", false);
    expect(mockTargetSpeed(s)).toBe(0.5);
    expect(mockTargetSpeed(applyMockKeyDown(s, "KeyW", false))).toBe(1.0);
    expect(mockTargetSpeed(INITIAL_MOCK_STATE)).toBe(0);
  });

  it("押し続けると目標の速さに近づき，行き過ぎない", () => {
    const st = runFor(applyMockKeyDown(INITIAL_MOCK_STATE, "KeyW", false), 0, 3000);
    expect(st.speed).toBeCloseTo(1.0, 3);
    expect(st.speed).toBeLessThanOrEqual(1.0);
    const slow = runFor(applyMockKeyDown(INITIAL_MOCK_STATE, "ArrowDown", false), 0, 3000);
    expect(slow.speed).toBeCloseTo(0.5, 3);
    expect(mockWalking(slow)).toEqual({ walking: true, walkSpeed: slow.speed });
  });

  it("離すと止まる（減速し終わるまでは walking）", () => {
    let st = runFor(applyMockKeyDown(INITIAL_MOCK_STATE, "KeyW", false), 0, 2000);
    st = applyMockKeyUp(st, "KeyW");
    st = advanceMock(st, 2016 + 16, P);
    expect(mockWalking(st).walking).toBe(true);
    st = runFor(st, 2048, 3000);
    expect(mockWalking(st)).toEqual({ walking: false, walkSpeed: 0 });
  });

  it("A・D は何もしない（同じ状態を返す）", () => {
    expect(applyMockKeyDown(INITIAL_MOCK_STATE, "KeyA", false)).toBe(INITIAL_MOCK_STATE);
    expect(applyMockKeyDown(INITIAL_MOCK_STATE, "KeyD", false)).toBe(INITIAL_MOCK_STATE);
    expect(applyMockKeyUp(INITIAL_MOCK_STATE, "KeyD")).toBe(INITIAL_MOCK_STATE);
  });

  it("C は押すたびにしゃがみを切り替え，押しっぱなしの繰り返しでは切り替えない", () => {
    const c1 = applyMockKeyDown(INITIAL_MOCK_STATE, "KeyC", false);
    expect(c1.posture).toBe("crouching");
    expect(applyMockKeyDown(c1, "KeyC", true)).toBe(c1);
    const c2 = applyMockKeyDown(applyMockKeyUp(c1, "KeyC"), "KeyC", false);
    expect(c2.posture).toBe("standing");
  });

  it("releaseMockKeys で歩きのキーを離す（姿勢は保つ）", () => {
    let st = applyMockKeyDown(INITIAL_MOCK_STATE, "KeyW", false);
    st = applyMockKeyDown(st, "KeyS", false);
    st = applyMockKeyDown(st, "KeyC", false);
    const r = releaseMockKeys(st);
    expect(r.forward).toBe(false);
    expect(r.slow).toBe(false);
    expect(r.posture).toBe("crouching");
    expect(releaseMockKeys(INITIAL_MOCK_STATE)).toBe(INITIAL_MOCK_STATE);
  });
});

describe("ドラッグ（applyMockDrag）", () => {
  it("右へドラッグで右を向き（ヨーが減る），上へドラッグで上を向く", () => {
    const st = applyMockDrag(INITIAL_MOCK_STATE, 100, -50);
    expect(st.look.yaw).toBeCloseTo(-100 * DEFAULT_MOCK_OPTIONS.sensitivity, 12);
    expect(st.look.pitch).toBeCloseTo(50 * DEFAULT_MOCK_OPTIONS.sensitivity, 12);
    expect(yawOfQuat(mockHead(st))).toBeCloseTo(st.look.yaw, 9);
    expect(pitchOfQuat(mockHead(st))).toBeCloseTo(st.look.pitch, 9);
  });

  it("ヨーは (-π, π] に収める", () => {
    const st = applyMockDrag(INITIAL_MOCK_STATE, -1000, 0); // +4 rad
    expect(st.look.yaw).toBeCloseTo(4 - 2 * Math.PI, 9);
    expect(wrapMockAngle(Math.PI)).toBe(Math.PI);
    expect(wrapMockAngle(-Math.PI)).toBe(Math.PI);
    expect(wrapMockAngle(3 * Math.PI)).toBeCloseTo(Math.PI, 9);
    expect(wrapMockAngle(0.5)).toBe(0.5);
  });

  it("ピッチは上下の限界で止まる", () => {
    const up = applyMockDrag(INITIAL_MOCK_STATE, 0, -100000);
    expect(up.look.pitch).toBe(DEFAULT_MOCK_OPTIONS.pitchLimit);
    const down = applyMockDrag(INITIAL_MOCK_STATE, 0, 100000);
    expect(down.look.pitch).toBe(-DEFAULT_MOCK_OPTIONS.pitchLimit);
  });

  it.each([
    [Number.NaN, 0],
    [0, Number.NaN],
    [Number.POSITIVE_INFINITY, 0],
  ])("非有限のドラッグ量（%s, %s）は無視する", (dx, dy) => {
    expect(applyMockDrag(INITIAL_MOCK_STATE, dx, dy)).toBe(INITIAL_MOCK_STATE);
  });
});

describe("advanceMock", () => {
  it("最初の呼び出しでは時刻だけ合わせる", () => {
    const st = advanceMock(applyMockKeyDown(INITIAL_MOCK_STATE, "KeyW", false), 1000, P);
    expect(st.lastT).toBe(1000);
    expect(st.speed).toBe(0);
  });

  it("上限の秒数は 0.2 秒", () => {
    expect(MOCK_MAX_DT_SEC).toBe(0.2);
  });

  it("時刻が 0.2 秒より飛んだ時は 0.2 秒分だけ速さを動かす", () => {
    let st = applyMockKeyDown(INITIAL_MOCK_STATE, "KeyW", false);
    st = advanceMock(st, 0, P);
    const ok = advanceMock(st, 200, P);
    expect(ok.speed).toBeGreaterThan(0);
    const jumped = advanceMock(st, 201, P);
    expect(jumped.speed).toBeGreaterThan(0);
    expect(jumped.speed).toBe(ok.speed);
    expect(jumped.speedRate).toBe(ok.speedRate);
    expect(jumped.lastT).toBe(201);
    // 大きく飛んでも（タブを隠した等）同じく 0.2 秒分だけ
    const far = advanceMock(st, 60_000, P);
    expect(far.speed).toBe(ok.speed);
    expect(far.lastT).toBe(60_000);
  });

  it("時刻が戻った・同じ時刻の時は速さを動かさず時刻だけ合わせる", () => {
    let st = applyMockKeyDown(INITIAL_MOCK_STATE, "KeyW", false);
    st = advanceMock(st, 0, P);
    st = advanceMock(st, 100, P);
    const before = st.speed;
    expect(before).toBeGreaterThan(0);
    const back = advanceMock(st, 50, P);
    expect(back.speed).toBe(before);
    expect(back.speedRate).toBe(st.speedRate);
    expect(back.lastT).toBe(50);
    const same = advanceMock(st, 100, P);
    expect(same.speed).toBe(before);
    expect(same.lastT).toBe(100);
  });

  it("秒間 4 フレーム（250 ms 間隔）でも W を押し続ければ速さが上がる", () => {
    let st = advanceMock(applyMockKeyDown(INITIAL_MOCK_STATE, "KeyW", false), 0, P);
    st = advanceMock(st, 250, P);
    expect(st.speed).toBeGreaterThan(0);
    for (let t = 500; t <= 5000; t += 250) {
      const prev = st.speed;
      st = advanceMock(st, t, P);
      // 押している間に一時的に遅くならない（刻みが粗いと目標の前後で揺れる）
      expect(st.speed).toBeGreaterThanOrEqual(prev - 1e-9);
      expect(st.speed).toBeGreaterThan(0);
      expect(st.speed).toBeLessThanOrEqual(DEFAULT_MOCK_OPTIONS.walkSpeed);
    }
    expect(st.speed).toBeCloseTo(DEFAULT_MOCK_OPTIONS.walkSpeed, 2);
    expect(mockWalking(st).walking).toBe(true);
  });

  it("秒間 4 フレーム（250 ms 間隔）でも W を離せば速さが 0 に近づき止まる", () => {
    let st = runFor(applyMockKeyDown(INITIAL_MOCK_STATE, "KeyW", false), 0, 2000);
    expect(st.speed).toBeGreaterThan(0.5);
    st = applyMockKeyUp(st, "KeyW");
    const released = st.speed;
    st = advanceMock(st, st.lastT + 250, P);
    expect(st.speed).toBeLessThan(released);
    const t0 = st.lastT;
    for (let t = t0 + 250; t <= t0 + 3000; t += 250) {
      const prev = st.speed;
      st = advanceMock(st, t, P);
      // 離した後に一度速くならない
      expect(st.speed).toBeLessThanOrEqual(prev + 1e-9);
    }
    expect(st.speed).toBeCloseTo(0, 2);
    expect(mockWalking(st)).toEqual({ walking: false, walkSpeed: 0 });
  });

  it("非有限の時刻では状態を変えない", () => {
    const st = advanceMock(INITIAL_MOCK_STATE, 0, P);
    expect(advanceMock(st, Number.NaN, P)).toBe(st);
  });

  it("元の状態を書き換えない", () => {
    const st = advanceMock(applyMockKeyDown(INITIAL_MOCK_STATE, "KeyW", false), 0, P);
    const snapshot = { ...st };
    advanceMock(st, 16, P);
    expect(st).toEqual(snapshot);
    expect(INITIAL_MOCK_STATE.speed).toBe(0);
  });
});
