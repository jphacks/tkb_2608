import { describe, expect, it } from "vitest";
import {
  finiteOrNull,
  type MotionEventLike,
  normalizeScreenAngle,
  type OrientationEventLike,
  toMotionSample,
  toOrientationSample,
  toRotationRate,
  toScreenSample,
  toVec3,
} from "./normalize";

const XYZ = { x: 0.1, y: -9.8, z: 0.3 };
const ABG = { alpha: 1, beta: 2, gamma: 3 };

function motion(overrides: Partial<MotionEventLike> = {}): MotionEventLike {
  return {
    timeStamp: 1000,
    acceleration: XYZ,
    accelerationIncludingGravity: XYZ,
    rotationRate: ABG,
    interval: 16,
    ...overrides,
  };
}

function orientation(overrides: Partial<OrientationEventLike> = {}): OrientationEventLike {
  return { timeStamp: 1000, alpha: 10, beta: 20, gamma: 30, absolute: false, ...overrides };
}

describe("finiteOrNull", () => {
  it("有限の数はそのまま", () => {
    expect(finiteOrNull(0)).toBe(0);
    expect(finiteOrNull(-1.5)).toBe(-1.5);
  });

  it.each([NaN, Infinity, -Infinity, null, undefined, "1", {}])("%s は null", (v) => {
    expect(finiteOrNull(v)).toBeNull();
  });
});

describe("toVec3・toRotationRate", () => {
  it("3 成分がすべて有限なら値を返す", () => {
    expect(toVec3(XYZ)).toEqual(XYZ);
    expect(toRotationRate(ABG)).toEqual(ABG);
  });

  it("null・undefined は null", () => {
    expect(toVec3(null)).toBeNull();
    expect(toVec3(undefined)).toBeNull();
    expect(toRotationRate(null)).toBeNull();
  });

  it.each([NaN, Infinity, null])("1 成分でも %s なら null", (bad) => {
    expect(toVec3({ ...XYZ, y: bad })).toBeNull();
    expect(toRotationRate({ ...ABG, gamma: bad })).toBeNull();
  });
});

describe("toMotionSample", () => {
  it("正常な値はそのまま MotionSample にする", () => {
    expect(toMotionSample(motion())).toEqual({
      t: 1000,
      acc: XYZ,
      accG: XYZ,
      rot: ABG,
      interval: 16,
    });
  });

  it("Android の一部のように acceleration が null でも，他の値があれば残す", () => {
    const s = toMotionSample(motion({ acceleration: null }));
    expect(s).not.toBeNull();
    expect(s?.acc).toBeNull();
    expect(s?.accG).toEqual(XYZ);
  });

  it("NaN を含む項目だけ null にする", () => {
    const s = toMotionSample(
      motion({ acceleration: { x: NaN, y: 0, z: 0 }, rotationRate: { ...ABG, beta: Infinity } }),
    );
    expect(s).toEqual({ t: 1000, acc: null, accG: XYZ, rot: null, interval: 16 });
  });

  it("値が 1 つも残らなければ null（捨てる）", () => {
    expect(
      toMotionSample(
        motion({
          acceleration: null,
          accelerationIncludingGravity: { x: NaN, y: NaN, z: NaN },
          rotationRate: null,
        }),
      ),
    ).toBeNull();
  });

  it.each([NaN, Infinity, -Infinity])("時刻が %s なら null", (t) => {
    expect(toMotionSample(motion({ timeStamp: t }))).toBeNull();
  });

  it.each([0, -16, NaN, Infinity, null])("interval が %s なら interval だけ null", (interval) => {
    const s = toMotionSample(motion({ interval }));
    expect(s).not.toBeNull();
    expect(s?.interval).toBeNull();
  });

  it("例外を投げない（各値が想定外の型でも）", () => {
    const weird = {
      timeStamp: 1,
      acceleration: { x: "1", y: undefined, z: {} },
      accelerationIncludingGravity: undefined,
      rotationRate: undefined,
      interval: undefined,
    } as unknown as MotionEventLike;
    expect(() => toMotionSample(weird)).not.toThrow();
    expect(toMotionSample(weird)).toBeNull();
  });
});

describe("toOrientationSample", () => {
  it("正常な値はそのまま", () => {
    expect(toOrientationSample(orientation({ absolute: true }))).toEqual({
      t: 1000,
      alpha: 10,
      beta: 20,
      gamma: 30,
      absolute: true,
    });
  });

  it("使えない角度は項目ごとに null", () => {
    expect(toOrientationSample(orientation({ alpha: null, gamma: NaN }))).toEqual({
      t: 1000,
      alpha: null,
      beta: 20,
      gamma: null,
      absolute: false,
    });
  });

  it("角度が 1 つも取れなければ null", () => {
    expect(
      toOrientationSample(orientation({ alpha: null, beta: NaN, gamma: Infinity })),
    ).toBeNull();
  });

  it("時刻が不正なら null", () => {
    expect(toOrientationSample(orientation({ timeStamp: NaN }))).toBeNull();
  });
});

describe("normalizeScreenAngle", () => {
  it.each([
    [0, 0],
    [90, 90],
    [180, 180],
    [270, 270],
    [-90, 270],
    [-180, 180],
    [-270, 90],
    [360, 0],
    [450, 90],
    [720, 0],
  ])("%s は %s", (angle, expected) => {
    expect(normalizeScreenAngle(angle)).toBe(expected);
  });

  it.each([NaN, Infinity, null, undefined, "90"])("不正な値（%s）は 0", (angle) => {
    expect(normalizeScreenAngle(angle)).toBe(0);
  });

  it("結果は常に 0・90・180・270 のどれか", () => {
    for (let a = -1000; a <= 1000; a += 7.3) {
      expect([0, 90, 180, 270]).toContain(normalizeScreenAngle(a));
    }
  });
});

describe("toScreenSample", () => {
  it("角度を丸め，向きの名前を残す", () => {
    expect(toScreenSample(5, -90, "landscape-secondary")).toEqual({
      t: 5,
      angle: 270,
      orientationType: "landscape-secondary",
    });
  });

  it("向きの名前が無ければ null，時刻が不正なら 0", () => {
    expect(toScreenSample(NaN, 90, undefined)).toEqual({ t: 0, angle: 90, orientationType: null });
    expect(toScreenSample(1, 0, null).orientationType).toBeNull();
  });
});
