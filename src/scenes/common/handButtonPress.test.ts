// 手で押すボタンの押した判定（Issue #145）．かざし続けたら押す・離れたら数え直す・押せるようになるまで待つ・壊れた値を確かめる

import { describe, expect, it } from "vitest";
import type { HandState, Quat, Vec3 } from "../../core/types";
import {
  advanceHandButtonPress,
  DEFAULT_HAND_BUTTON_PRESS_CONFIG,
  type HandButtonPressConfig,
  type HandButtonPressState,
  handButtonCenter,
  handButtonProgress,
  handPressPoint,
  handSightPoint,
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

/** 手のひらの中心と人差し指の先が離れた手（指先だけ・手のひらだけがボタンに入る形を作る） */
const PALM_IN = { x: 0, y: 0, z: -0.5 };
const TIP_IN = { x: 0, y: 0, z: -0.5 };
const FAR = { x: 0, y: 0.3, z: -0.5 };
const NON_FINITE = [Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY];

describe("isHandOverButton（目から見た向きで判定する）", () => {
  const center = { x: 0, y: 0, z: -0.5 };

  it("ボタンと重なって見えれば，奥行きが違っても入っている", () => {
    // 手の形はボタン（0.5 m）より奥の固定の奥行き（約 1.2 m）に描くため，見た目で重なっていれば押せるようにする
    for (const z of [-0.3, -1.2]) {
      expect(isHandOverButton(IDENTITY, hand({ position: { x: 0, y: 0, z } }), center, 0.12)).toBe(
        true,
      );
    }
  });

  it("奥の点は，ボタンの面で見たずれで比べる", () => {
    // 1.2 m 先で横に 0.24 m ずれた点は，0.5 m 先の面では 0.1 m のずれ
    const near = hand({ position: { x: 0.24, y: 0, z: -1.2 } });
    // 0.36 m のずれは 0.5 m 先の面で 0.15 m（範囲外）
    const far = hand({ position: { x: 0.36, y: 0, z: -1.2 } });
    expect(isHandOverButton(IDENTITY, near, center, 0.12)).toBe(true);
    expect(isHandOverButton(IDENTITY, far, center, 0.12)).toBe(false);
  });

  it.each([
    ["目の後ろ", { x: 0, y: 0, z: 0.5 }],
    ["目の位置", { x: 0, y: 0, z: 0 }],
    ["目の真横", { x: 0.5, y: 0, z: 0 }],
  ])("%sの点は入っていない", (_, position) => {
    expect(isHandOverButton(IDENTITY, hand({ position }), center, 0.12)).toBe(false);
  });
});

describe("handSightPoint", () => {
  const OUT = { x: 0, y: 0.3, z: -0.5 };
  /** 人差し指の先（番号 8）だけ tip，他は OUT に置いた 21 点 */
  const landmarksWithTip = (tip: Vec3): Vec3[] =>
    Array.from({ length: 21 }, (_, i) => (i === 8 ? tip : OUT));

  it("描いた手の形の人差し指の先があれば，indexTip より優先する", () => {
    const drawn = { x: 0, y: 0, z: -1.2 };
    const h = hand({ position: OUT, indexTip: OUT, landmarks: landmarksWithTip(drawn) });
    expect(handSightPoint(h)).toEqual(drawn);
    expect(isHandOverButton(IDENTITY, h, { x: 0, y: 0, z: -0.5 }, 0.12)).toBe(true);
  });

  it("手の形が無ければ handPressPoint と同じ", () => {
    const tip = { x: 0, y: 0, z: -0.5 };
    expect(handSightPoint(hand({ position: OUT, indexTip: tip }))).toEqual(tip);
    expect(handSightPoint(hand({ position: OUT }))).toEqual(OUT);
  });

  it.each([Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY])(
    "手の形の指先に %s を含む時は handPressPoint を使う",
    (v) => {
      const tip = { x: 0, y: 0, z: -0.5 };
      const h = hand({
        position: OUT,
        indexTip: tip,
        landmarks: landmarksWithTip({ x: v, y: 0, z: -1 }),
      });
      expect(handSightPoint(h)).toEqual(tip);
    },
  );

  it("点が足りない手の形は handPressPoint を使う", () => {
    const tip = { x: 0, y: 0, z: -0.5 };
    expect(handSightPoint(hand({ position: OUT, indexTip: tip, landmarks: [OUT] }))).toEqual(tip);
  });
});

describe("handPressPoint", () => {
  it("人差し指の先があればそれを判定点にする", () => {
    const tip = { x: 0.01, y: 0.02, z: -0.4 };
    expect(handPressPoint(hand({ indexTip: tip }))).toEqual(tip);
  });

  it("人差し指の先が無い時（記録の再生・mock 等）は手のひらの中心を判定点にする", () => {
    const h = hand({ position: { x: 0.1, y: -0.1, z: -0.6 } });
    expect(handPressPoint(h)).toEqual({ x: 0.1, y: -0.1, z: -0.6 });
  });

  it.each(NON_FINITE.flatMap((v) => (["x", "y", "z"] as const).map((axis) => [axis, v] as const)))(
    "人差し指の先の %s が %s なら手のひらの中心に戻る",
    (axis, v) => {
      const position = { x: 0.1, y: -0.1, z: -0.6 };
      const indexTip = { x: 0, y: 0, z: -0.5, [axis]: v };
      expect(handPressPoint(hand({ position, indexTip }))).toEqual(position);
    },
  );
});

describe("isHandOverButton（人差し指の先で判定する）", () => {
  const center = { x: 0, y: 0, z: -0.5 };

  it("手のひらは範囲外でも，人差し指の先が範囲内なら入っている", () => {
    expect(
      isHandOverButton(IDENTITY, hand({ position: FAR, indexTip: TIP_IN }), center, 0.12),
    ).toBe(true);
  });

  it("手のひらが範囲内でも，人差し指の先が範囲外なら入っていない", () => {
    expect(
      isHandOverButton(IDENTITY, hand({ position: PALM_IN, indexTip: FAR }), center, 0.12),
    ).toBe(false);
  });

  it("人差し指の先がちょうど半径の距離は入っている・少しでも遠ければ入っていない（境界）", () => {
    expect(
      isHandOverButton(
        IDENTITY,
        hand({ position: FAR, indexTip: { x: 0.12, y: 0, z: -0.5 } }),
        center,
        0.12,
      ),
    ).toBe(true);
    expect(
      isHandOverButton(
        IDENTITY,
        hand({ position: PALM_IN, indexTip: { x: 0.121, y: 0, z: -0.5 } }),
        center,
        0.12,
      ),
    ).toBe(false);
  });

  it("人差し指の先が無ければ手のひらの中心で判定する", () => {
    expect(isHandOverButton(IDENTITY, hand({ position: PALM_IN }), center, 0.12)).toBe(true);
    expect(isHandOverButton(IDENTITY, hand({ position: FAR }), center, 0.12)).toBe(false);
  });

  it.each(NON_FINITE)("人差し指の先に %s を含む時は手のひらの中心で判定する", (v) => {
    const broken = { x: v, y: 0, z: -0.5 };
    expect(
      isHandOverButton(IDENTITY, hand({ position: PALM_IN, indexTip: broken }), center, 0.12),
    ).toBe(true);
    expect(
      isHandOverButton(IDENTITY, hand({ position: FAR, indexTip: broken }), center, 0.12),
    ).toBe(false);
  });

  it("見失った手は人差し指の先が範囲内でも入っていない", () => {
    expect(
      isHandOverButton(
        IDENTITY,
        hand({ tracked: false, position: PALM_IN, indexTip: TIP_IN }),
        center,
        0.12,
      ),
    ).toBe(false);
  });

  it("人差し指の先も頭の座標系（頭を左へ 90° 向けた時の正面の指先は左のボタンに入る）", () => {
    const left = handButtonCenter(center, Math.PI / 2);
    const h = hand({ position: FAR, indexTip: TIP_IN });
    expect(isHandOverButton(yawQuat(Math.PI / 2), h, left, 0.12)).toBe(true);
    expect(isHandOverButton(IDENTITY, h, left, 0.12)).toBe(false);
  });
});

describe("isAnyHandOverButton（人差し指の先で判定する）", () => {
  const center = { x: 0, y: 0, z: -0.5 };
  const tipOnly = hand({ position: FAR, indexTip: TIP_IN });
  const palmOnly = hand({ position: PALM_IN, indexTip: FAR });

  it.each([
    ["左手の指先だけ入っている", tipOnly, untracked, true],
    ["右手の指先だけ入っている", untracked, tipOnly, true],
    ["左右とも手のひらだけ入っている（指先は外）", palmOnly, palmOnly, false],
    ["左は手のひらだけ・右は指先が入っている", palmOnly, tipOnly, true],
  ])("%s", (_name, left, right, expected) => {
    expect(isAnyHandOverButton(IDENTITY, { left, right }, center, 0.12)).toBe(expected);
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
