import { describe, expect, it } from "vitest";
import {
  classifyLandscapeSide,
  createLandscapeSideState,
  DEFAULT_LANDSCAPE_SIDE_CONFIG,
  type LandscapeSideState,
  normalizeScreenAngleDeg,
  type UpVector,
  updateFlipped,
  updateLandscapeSide,
  upFromOrientation,
} from "./landscapeSide";
import { deviceOrientationToQuat, rotateVec } from "./orientation";

const { holdMs, flipHoldMs } = DEFAULT_LANDSCAPE_SIDE_CONFIG;

/** 縦持ちの右の辺が上（screen angle 90 で正しく見える） */
const RIGHT_UP: UpVector = { x: 1, y: 0, z: 0 };
/** 縦持ちの左の辺が上（screen angle 270 で正しく見える） */
const LEFT_UP: UpVector = { x: -1, y: 0, z: 0 };
/** 机に置いた（画面が上） */
const FLAT: UpVector = { x: 0, y: 0, z: 1 };

/** x の割合が ratio になる上の向き（残りは z） */
function tilted(ratio: number): UpVector {
  return { x: ratio, y: 0, z: Math.sqrt(1 - ratio * ratio) };
}

/** 同じ上の向きを t0 から durationMs の間，stepMs ごとに流す */
function feed(
  state: LandscapeSideState,
  up: UpVector | null,
  t0: number,
  durationMs: number,
  stepMs = 20,
): number {
  let t = t0;
  for (; t <= t0 + durationMs; t += stepMs) updateLandscapeSide(state, up, t);
  return t;
}

function expectClose(v: UpVector | null, x: number, y: number, z: number): void {
  expect(v).not.toBeNull();
  if (v === null) return;
  expect(v.x).toBeCloseTo(x, 6);
  expect(v.y).toBeCloseTo(y, 6);
  expect(v.z).toBeCloseTo(z, 6);
}

describe("upFromOrientation", () => {
  it("机に置くと上は画面の手前（+z）", () => {
    expectClose(upFromOrientation(0, 0), 0, 0, 1);
  });

  it("縦持ちで立てると上は画面の上（+y）", () => {
    expectClose(upFromOrientation(90, 0), 0, 1, 0);
  });

  it("右の辺を上にして立てると +x（gamma -90）", () => {
    expectClose(upFromOrientation(0, -90), 1, 0, 0);
  });

  it("左の辺を上にして立てると -x（gamma 90）", () => {
    expectClose(upFromOrientation(0, 90), -1, 0, 0);
  });

  it("gamma が ±90 をまたいで beta が 180 に飛んでも，上の向きは続いている", () => {
    // 右の辺が上のまま，画面が少し下を向いた: beta 180・gamma 85 になる
    const v = upFromOrientation(180, 85);
    expect(v?.x).toBeCloseTo(Math.sin(85 * (Math.PI / 180)), 6);
    expect(v?.z).toBeLessThan(0);
  });

  it.each([
    [Number.NaN, 0],
    [0, Number.NaN],
    [Number.POSITIVE_INFINITY, 0],
  ])("有限でない値（%s, %s）は null", (b, g) => {
    expect(upFromOrientation(b, g)).toBeNull();
  });

  it.each([
    [90, 0, -90],
    [270, 0, 90],
  ])(
    "判断した側（%d）の screen angle で頭の向きを求めると，視界の上が世界の上になる（頭の向きの計算と同じ約束）",
    (angle, beta, gamma) => {
      const up = upFromOrientation(beta, gamma);
      expect(classifyLandscapeSide(up, null)).toBe(angle);
      const q = deviceOrientationToQuat(0, beta, gamma, angle);
      expect(rotateVec(q, { x: 0, y: 1, z: 0 }).y).toBeCloseTo(1, 6);
      // 逆の側の angle では視界の上が世界の下になる（これが「画面が逆さ」）
      const wrong = deviceOrientationToQuat(0, beta, gamma, angle === 90 ? 270 : 90);
      expect(rotateVec(wrong, { x: 0, y: 1, z: 0 }).y).toBeCloseTo(-1, 6);
    },
  );
});

describe("classifyLandscapeSide", () => {
  it.each([
    [RIGHT_UP, 90],
    [LEFT_UP, 270],
    [tilted(0.7), 90],
    [tilted(-0.7), 270],
  ])("x の割合が enterRatio 以上なら，その側", (up, side) => {
    expect(classifyLandscapeSide(up, null)).toBe(side);
  });

  it.each([FLAT, { x: 0, y: 1, z: 0 }, tilted(0.39), tilted(-0.39)])(
    "水平・縦持ちに近い時は判断しない（前の判断があっても）",
    (up) => {
      expect(classifyLandscapeSide(up, 90)).toBeNull();
      expect(classifyLandscapeSide(up, 270)).toBeNull();
    },
  );

  it.each([0.4, 0.55, 0.69])("割合 %d は前の判断を保つ（ヒステリシス）", (ratio) => {
    expect(classifyLandscapeSide(tilted(ratio), 90)).toBe(90);
    expect(classifyLandscapeSide(tilted(ratio), null)).toBeNull();
    expect(classifyLandscapeSide(tilted(-ratio), 270)).toBe(270);
  });

  it("中間の割合では逆の側に飛ばない", () => {
    expect(classifyLandscapeSide(tilted(-0.55), 90)).toBe(90);
  });

  it("長さは問わない（重力の大きさのままでよい）", () => {
    expect(classifyLandscapeSide({ x: 9.8, y: 0.3, z: 0.5 }, null)).toBe(90);
  });

  it.each([
    null,
    { x: Number.NaN, y: 0, z: 0 },
    { x: 0, y: Number.POSITIVE_INFINITY, z: 0 },
    { x: 0, y: 0, z: 0 },
  ])("使えない上の向き（%o）は前の判断を保つ", (up) => {
    expect(classifyLandscapeSide(up, 270)).toBe(270);
    expect(classifyLandscapeSide(up, null)).toBeNull();
  });
});

describe("normalizeScreenAngleDeg", () => {
  it.each([
    [0, 0],
    [90, 90],
    [180, 180],
    [270, 270],
    [-90, 270],
    [360, 0],
    [89, 90],
  ])("%d は %d", (a, want) => {
    expect(normalizeScreenAngleDeg(a)).toBe(want);
  });

  it("有限でなければ null", () => {
    expect(normalizeScreenAngleDeg(Number.NaN)).toBeNull();
  });
});

describe("updateLandscapeSide", () => {
  it("最初は判断しない", () => {
    expect(createLandscapeSideState().side).toBeNull();
  });

  it("holdMs 続くまでは採らず，続いたら採る", () => {
    const s = createLandscapeSideState();
    updateLandscapeSide(s, RIGHT_UP, 1000);
    expect(updateLandscapeSide(s, RIGHT_UP, 1000 + holdMs - 1)).toBeNull();
    expect(updateLandscapeSide(s, RIGHT_UP, 1000 + holdMs)).toBe(90);
  });

  it("回す途中で一瞬だけ逆の側になっても変えない", () => {
    const s = createLandscapeSideState();
    const t = feed(s, RIGHT_UP, 0, 1000);
    updateLandscapeSide(s, LEFT_UP, t);
    updateLandscapeSide(s, LEFT_UP, t + holdMs / 2);
    expect(updateLandscapeSide(s, RIGHT_UP, t + holdMs / 2 + 20)).toBe(90);
    expect(updateLandscapeSide(s, RIGHT_UP, t + holdMs * 3)).toBe(90);
  });

  it("逆の側が holdMs 続いたら切り替える", () => {
    const s = createLandscapeSideState();
    const t = feed(s, RIGHT_UP, 0, 1000);
    feed(s, LEFT_UP, t, holdMs + 20);
    expect(s.side).toBe(270);
  });

  it("水平に置いたまま holdMs たつと判断しない", () => {
    const s = createLandscapeSideState();
    const t = feed(s, RIGHT_UP, 0, 1000);
    feed(s, FLAT, t, holdMs + 20);
    expect(s.side).toBeNull();
  });

  it("使えないサンプルが続いても判断を保つ", () => {
    const s = createLandscapeSideState();
    const t = feed(s, LEFT_UP, 0, 1000);
    feed(s, null, t, 5000);
    expect(s.side).toBe(270);
  });

  it("時刻が有限でなければ何もしない", () => {
    const s = createLandscapeSideState();
    feed(s, RIGHT_UP, 0, 1000);
    expect(updateLandscapeSide(s, LEFT_UP, Number.NaN)).toBe(90);
    expect(s.candidate).toBe(90);
  });
});

describe("updateFlipped", () => {
  function decided(side: UpVector): LandscapeSideState {
    const s = createLandscapeSideState();
    feed(s, side, 0, 1000);
    return s;
  }

  it("判断した側と OS の向きが同じなら逆さでない", () => {
    const s = decided(RIGHT_UP);
    expect(updateFlipped(s, 90, 2000)).toBe(false);
    expect(updateFlipped(s, 90, 2000 + flipHoldMs * 2)).toBe(false);
  });

  it.each([
    [RIGHT_UP, 270],
    [RIGHT_UP, -90],
    [LEFT_UP, 90],
  ])("食い違い（%o と angle %d）が flipHoldMs 続いたら逆さ", (side, angle) => {
    const s = decided(side);
    expect(updateFlipped(s, angle, 2000)).toBe(false);
    expect(updateFlipped(s, angle, 2000 + flipHoldMs - 1)).toBe(false);
    expect(updateFlipped(s, angle, 2000 + flipHoldMs)).toBe(true);
  });

  it("OS が遅れて画面を回せば，逆さにならない", () => {
    const s = decided(LEFT_UP);
    updateFlipped(s, 90, 2000);
    expect(updateFlipped(s, 270, 2000 + flipHoldMs / 2)).toBe(false);
    expect(updateFlipped(s, 270, 2000 + flipHoldMs * 2)).toBe(false);
  });

  it("逆さの後に食い違いが無くなったら，すぐに逆さでなくなる", () => {
    const s = decided(RIGHT_UP);
    updateFlipped(s, 270, 2000);
    expect(updateFlipped(s, 270, 2000 + flipHoldMs)).toBe(true);
    expect(updateFlipped(s, 90, 2000 + flipHoldMs + 20)).toBe(false);
    // 再び食い違っても，また flipHoldMs 待つ
    expect(updateFlipped(s, 270, 2000 + flipHoldMs + 40)).toBe(false);
  });

  it.each([0, 180])(
    "OS が縦向き（angle %d）の時は逆さとみなさない（縦向きの案内に任せる）",
    (angle) => {
      const s = decided(RIGHT_UP);
      updateFlipped(s, angle, 2000);
      expect(updateFlipped(s, angle, 2000 + flipHoldMs * 2)).toBe(false);
    },
  );

  it("判断していない（センサーが無い・水平）時は逆さとみなさない", () => {
    const s = createLandscapeSideState();
    updateFlipped(s, 270, 0);
    expect(updateFlipped(s, 270, flipHoldMs * 10)).toBe(false);
  });

  it.each([
    [Number.NaN, 2000],
    [270, Number.NaN],
  ])("角度・時刻が有限でない（%s, %s）時は逆さとみなさない", (angle, t) => {
    const s = decided(RIGHT_UP);
    updateFlipped(s, 270, 0);
    expect(updateFlipped(s, angle, t)).toBe(false);
  });
});
