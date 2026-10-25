// 手で押すボタンの押した判定（Issue #145）．かざし続けたら押す・離れたら数え直す・押せるようになるまで待つ・壊れた値を確かめる

import { describe, expect, it } from "vitest";
import type { HandState, Quat } from "../../core/types";
import {
  advanceHandButtonPress,
  DEFAULT_HAND_BUTTON_PRESS_CONFIG,
  type HandButtonPressConfig,
  type HandButtonPressState,
  handButtonCenter,
  handButtonProgress,
  INITIAL_HAND_BUTTON_PRESS,
  isAnyHandOverButton,
  isHandButtonArmed,
  isHandOverButton,
  pressHandButton,
  rotateByQuat,
} from "./handButtonPress";

/** 1 フレームの秒数（2 進数で割り切れる値にして，足し合わせの誤差で境界がずれないようにする） */
const DT = 0.125;
const IDENTITY: Quat = { x: 0, y: 0, z: 0, w: 1 };
/** Y 軸回りに angle（rad）回すクォータニオン */
const yawQuat = (angle: number): Quat => ({
  x: 0,
  y: Math.sin(angle / 2),
  z: 0,
  w: Math.cos(angle / 2),
});

const hand = (overrides: Partial<HandState> = {}): HandState => ({
  tracked: true,
  position: { x: 0, y: 0, z: -0.5 },
  grip: 0,
  ...overrides,
});
const untracked = hand({ tracked: false });

const config = (overrides: Partial<HandButtonPressConfig> = {}): HandButtonPressConfig => ({
  ...DEFAULT_HAND_BUTTON_PRESS_CONFIG,
  ...overrides,
});

/** dt ずつ n フレーム進める */
function run(
  state: HandButtonPressState,
  n: number,
  dt: number,
  handOver: boolean,
  c: HandButtonPressConfig = DEFAULT_HAND_BUTTON_PRESS_CONFIG,
): HandButtonPressState {
  let s = state;
  for (let i = 0; i < n; i++) s = advanceHandButtonPress(s, { dt, handOver }, c);
  return s;
}

describe("rotateByQuat", () => {
  it("回転なしではそのまま", () => {
    expect(rotateByQuat(IDENTITY, { x: 1, y: 2, z: 3 })).toEqual({ x: 1, y: 2, z: 3 });
  });

  it("左へ 90° 回すと正面（-z）は左（-x）になる", () => {
    const v = rotateByQuat(yawQuat(Math.PI / 2), { x: 0, y: 0, z: -1 });
    expect(v.x).toBeCloseTo(-1);
    expect(v.y).toBeCloseTo(0);
    expect(v.z).toBeCloseTo(0);
  });
});

describe("handButtonCenter", () => {
  it("親のヨー角 0 ではずれのまま", () => {
    expect(handButtonCenter({ x: 0, y: -0.1, z: -0.5 }, 0)).toEqual({ x: 0, y: -0.1, z: -0.5 });
  });

  it("親が左へ 90° 回ると左に来る", () => {
    const c = handButtonCenter({ x: 0, y: 0, z: -0.5 }, Math.PI / 2);
    expect(c.x).toBeCloseTo(-0.5);
    expect(c.z).toBeCloseTo(0);
  });

  it("ヨー角が NaN なら 0 として扱う", () => {
    expect(handButtonCenter({ x: 0, y: 0, z: -0.5 }, Number.NaN)).toEqual({ x: 0, y: 0, z: -0.5 });
  });
});

describe("isHandOverButton", () => {
  const center = { x: 0, y: 0, z: -0.5 };

  it("手のひらがボタンの中心にあれば入っている", () => {
    expect(isHandOverButton(IDENTITY, hand(), center, 0.12)).toBe(true);
  });

  it("ちょうど半径の距離は入っている（境界）", () => {
    expect(
      isHandOverButton(IDENTITY, hand({ position: { x: 0.12, y: 0, z: -0.5 } }), center, 0.12),
    ).toBe(true);
  });

  it("半径より遠ければ入っていない", () => {
    expect(
      isHandOverButton(IDENTITY, hand({ position: { x: 0.121, y: 0, z: -0.5 } }), center, 0.12),
    ).toBe(false);
  });

  it("見失った手は位置が合っていても入っていない", () => {
    expect(isHandOverButton(IDENTITY, untracked, center, 0.12)).toBe(false);
  });

  it("位置が NaN の手は入っていない", () => {
    expect(
      isHandOverButton(
        IDENTITY,
        hand({ position: { x: Number.NaN, y: 0, z: -0.5 } }),
        center,
        0.12,
      ),
    ).toBe(false);
  });

  it("頭を左へ 90° 向けた時の正面の手は，左にあるボタンに入っている（手は頭の座標系）", () => {
    const left = handButtonCenter(center, Math.PI / 2);
    expect(isHandOverButton(yawQuat(Math.PI / 2), hand(), left, 0.12)).toBe(true);
    expect(isHandOverButton(IDENTITY, hand(), left, 0.12)).toBe(false);
  });
});

describe("isAnyHandOverButton", () => {
  const center = { x: 0, y: 0, z: -0.5 };

  it.each([
    ["左手だけ", hand(), untracked, true],
    ["右手だけ", untracked, hand(), true],
    ["どちらも見失った", untracked, untracked, false],
  ])("%s", (_name, left, right, expected) => {
    expect(isAnyHandOverButton(IDENTITY, { left, right }, center, 0.12)).toBe(expected);
  });
});

describe("advanceHandButtonPress", () => {
  it("かざし続けて holdSeconds たったら手で押した扱いになる", () => {
    const s = run(INITIAL_HAND_BUTTON_PRESS, 8, DT, true);
    expect(s.pressedBy).toBe("hand");
  });

  it("holdSeconds の手前ではまだ押していない", () => {
    const s = run(INITIAL_HAND_BUTTON_PRESS, 7, DT, true);
    expect(s.pressedBy).toBeNull();
    expect(s.held).toBe(0.875);
  });

  it("離れたらかざした秒数は 0 に戻る", () => {
    let s = run(INITIAL_HAND_BUTTON_PRESS, 7, DT, true);
    s = advanceHandButtonPress(s, { dt: DT, handOver: false });
    expect(s.held).toBe(0);
    s = run(s, 7, DT, true);
    expect(s.pressedBy).toBeNull();
  });

  it("時間がたつだけでは押さない（手をかざさない限り進まない）", () => {
    const s = run(INITIAL_HAND_BUTTON_PRESS, 1000, DT, false);
    expect(s.pressedBy).toBeNull();
  });

  it("押せるようになる前（armSeconds）にかざしても数えない", () => {
    const c = config({ armSeconds: 2 });
    let s = run(INITIAL_HAND_BUTTON_PRESS, 15, DT, true, c);
    expect(isHandButtonArmed(s, c)).toBe(false);
    expect(s.held).toBe(0);
    // 押せるようになってから holdSeconds かざし続けて押す
    s = run(s, 2, DT, true, c);
    expect(isHandButtonArmed(s, c)).toBe(true);
    s = run(s, 8, DT, true, c);
    expect(s.pressedBy).toBe("hand");
  });

  it("待ちの秒数は armSeconds で止まる", () => {
    const s = run(INITIAL_HAND_BUTTON_PRESS, 100, DT, false, config({ armSeconds: 2 }));
    expect(s.shown).toBe(2);
  });

  it("押した後は変えない", () => {
    const pressed = run(INITIAL_HAND_BUTTON_PRESS, 8, DT, true);
    expect(advanceHandButtonPress(pressed, { dt: DT, handOver: false })).toBe(pressed);
  });

  it.each([Number.NaN, -1, Number.POSITIVE_INFINITY])("dt が %s のフレームは数えない", (dt) => {
    const s = advanceHandButtonPress(INITIAL_HAND_BUTTON_PRESS, { dt, handOver: true });
    expect(s.held).toBe(0);
    expect(s.shown).toBe(0);
    expect(s.pressedBy).toBeNull();
  });
});

describe("pressHandButton", () => {
  it("押したことにすると manual になる", () => {
    expect(pressHandButton(INITIAL_HAND_BUTTON_PRESS).pressedBy).toBe("manual");
  });

  it("押せるようになる前でも押せる（代わりの操作は待たない）", () => {
    const c = config({ armSeconds: 5 });
    const s = pressHandButton(INITIAL_HAND_BUTTON_PRESS);
    expect(isHandButtonArmed(s, c)).toBe(false);
    expect(s.pressedBy).toBe("manual");
  });

  it("手で押した後は変えない", () => {
    const pressed = run(INITIAL_HAND_BUTTON_PRESS, 8, DT, true);
    expect(pressHandButton(pressed)).toBe(pressed);
  });
});

describe("handButtonProgress", () => {
  it("かざした秒数の割合", () => {
    const s = run(INITIAL_HAND_BUTTON_PRESS, 4, DT, true);
    expect(handButtonProgress(s)).toBeCloseTo(0.5);
  });

  it("押した後は 1", () => {
    expect(handButtonProgress(pressHandButton(INITIAL_HAND_BUTTON_PRESS))).toBe(1);
  });

  it("holdSeconds が 0 以下・NaN なら 0（割り算で壊れない）", () => {
    expect(handButtonProgress(INITIAL_HAND_BUTTON_PRESS, config({ holdSeconds: 0 }))).toBe(0);
    expect(handButtonProgress(INITIAL_HAND_BUTTON_PRESS, config({ holdSeconds: Number.NaN }))).toBe(
      0,
    );
  });
});
