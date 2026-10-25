// 歩行の 1 フレーム分の計算（stepWalk 等）のテスト．
// Issue #31 の「足踏みと体の向きから動かす」「机の下はしゃがみの時だけ」「立ち上がっても天板をすり抜けない」
// 「ドアの開閉で通れる・通れない」「しゃがみ・着座の目の高さ」を，作った小さな空間で確かめる

import { describe, expect, it } from "vitest";
import { IDLE_PLAYER_INPUT, type PlayerInput, type Quat } from "../../core/types";
import { circleOverlapsRect, DEFAULT_BODY, type Obstacle } from "./collision";
import {
  activeObstacles,
  type DoorBlocker,
  headYaw,
  initialWalkState,
  MAX_WALK_SPEED,
  type SeatSpot,
  scaledWalkSpeed,
  stepWalk,
  type WalkState,
  type WalkWorld,
  wrapAngle,
} from "./locomotion";

const STAND = 1.6;
const CROUCH = 0.55;
const R = DEFAULT_BODY.radius;

function yawQuat(yaw: number): Quat {
  return { x: 0, y: Math.sin(yaw / 2), z: 0, w: Math.cos(yaw / 2) };
}

function input(over: Partial<PlayerInput> = {}): PlayerInput {
  return { ...IDLE_PLAYER_INPUT, ...over };
}

function walk(speed = 1, over: Partial<PlayerInput> = {}): PlayerInput {
  return input({ walking: true, walkSpeed: speed, ...over });
}

function world(over: Partial<WalkWorld> = {}): WalkWorld {
  return {
    floors: [{ minX: -10, maxX: 10, minZ: -10, maxZ: 10 }],
    obstacles: [],
    doors: [],
    areas: [],
    eyeHeights: { standing: STAND, crouching: CROUCH },
    seats: [],
    ...over,
  };
}

function run(
  state: WalkState,
  frame: PlayerInput,
  w: WalkWorld,
  seconds: number,
  bodyYaw = 0,
  dt = 1 / 30,
): WalkState {
  let s = state;
  const n = Math.round(seconds / dt);
  for (let i = 0; i < n; i++) s = stepWalk(s, frame, dt, w, bodyYaw);
  return s;
}

const start = () => initialWalkState(0, 0, STAND);

describe("headYaw / wrapAngle", () => {
  it("Y 軸回りだけの回転の角度を返す（正で左）", () => {
    for (const yaw of [0, 0.5, -1.2, 3]) {
      expect(headYaw(yawQuat(yaw))).toBeCloseTo(yaw);
    }
  });

  it("wrapAngle は (-π, π] に収める", () => {
    expect(wrapAngle(Math.PI * 3)).toBeCloseTo(Math.PI);
    expect(wrapAngle(-Math.PI)).toBeCloseTo(Math.PI);
    expect(wrapAngle(-Math.PI / 2 - Math.PI * 4)).toBeCloseTo(-Math.PI / 2);
  });
});

describe("stepWalk: 移動", () => {
  it("足踏みしていなければ動かない（walkSpeed が正でも）", () => {
    const s = run(start(), input({ walking: false, walkSpeed: 1 }), world(), 1);
    expect(s.x).toBeCloseTo(0);
    expect(s.z).toBeCloseTo(0);
  });

  it("足踏みの間，体の向き 0 なら -Z へ walkSpeed の速さで進む", () => {
    const s = run(start(), walk(1), world(), 1);
    expect(s.x).toBeCloseTo(0);
    expect(s.z).toBeCloseTo(-1, 2);
  });

  it("進む向きは体の向き＋頭の向き（正で左）", () => {
    // 体を左へ 90°（-X 向き）
    const left = run(start(), walk(1), world(), 1, Math.PI / 2);
    expect(left.x).toBeCloseTo(-1, 2);
    expect(left.z).toBeCloseTo(0, 5);
    // 体は 0，頭を右へ 90°（+X 向き）
    const right = run(start(), walk(1, { head: yawQuat(-Math.PI / 2) }), world(), 1, 0);
    expect(right.x).toBeCloseTo(1, 2);
    expect(right.z).toBeCloseTo(0, 5);
    // 体を左 90°，頭を右 90° → 正面（-Z）
    const both = run(start(), walk(1, { head: yawQuat(-Math.PI / 2) }), world(), 1, Math.PI / 2);
    expect(both.x).toBeCloseTo(0, 5);
    expect(both.z).toBeCloseTo(-1, 2);
  });

  it("頭を上下に向けても進む速さは変わらない（水平に進む）", () => {
    const pitch = 0.6;
    const head: Quat = { x: Math.sin(pitch / 2), y: 0, z: 0, w: Math.cos(pitch / 2) };
    const s = run(start(), walk(1, { head }), world(), 1);
    expect(Math.hypot(s.x, s.z)).toBeCloseTo(1, 2);
  });

  it("速さは上限（2 m/s）で頭打ちになる．負の速さでは後ろへ進まない", () => {
    const fast = run(start(), walk(50), world(), 1);
    expect(Math.hypot(fast.x, fast.z)).toBeCloseTo(2, 2);
    const back = run(start(), walk(-1), world(), 1);
    expect(back.z).toBeCloseTo(0);
  });

  it("1 フレームの dt が大きくても 0.1 秒分しか進まない．負の dt では動かない", () => {
    const s = stepWalk(start(), walk(1), 5, world(), 0);
    expect(s.z).toBeCloseTo(-0.1);
    const neg = stepWalk(start(), walk(1), -1, world(), 0);
    expect(neg.z).toBeCloseTo(0);
  });

  it("壁に向かって歩き続けても壁と重ならない", () => {
    const wall: Obstacle = {
      id: "w",
      minX: -5,
      maxX: 5,
      minZ: -1.05,
      maxZ: -1,
      minY: 0,
      maxY: 2.4,
    };
    const s = run(start(), walk(2), world({ obstacles: [wall] }), 3);
    expect(s.z).toBeCloseTo(-1 + R, 3);
    expect(circleOverlapsRect(s.x, s.z, R - 1e-6, wall)).toBe(false);
  });
});

describe("stepWalk: 目の高さ", () => {
  it("しゃがむと少しずつしゃがみの目の高さへ下がり，立つと戻る（瞬間的に飛ばない）", () => {
    const w = world();
    const one = stepWalk(start(), input({ posture: "crouching" }), 1 / 30, w, 0);
    expect(one.eyeHeight).toBeLessThan(STAND);
    expect(one.eyeHeight).toBeGreaterThan(CROUCH);
    const down = run(start(), input({ posture: "crouching" }), w, 2);
    expect(down.eyeHeight).toBeCloseTo(CROUCH);
    const up = run(down, input({ posture: "standing" }), w, 2);
    expect(up.eyeHeight).toBeCloseTo(STAND);
  });
});

// 机: 天板 0.68〜0.72m（XZ: x 0〜1.1, z -0.35〜0.35），脚は四隅
const TOP: Obstacle = {
  id: "top",
  minX: 0,
  maxX: 1.1,
  minZ: -0.35,
  maxZ: 0.35,
  minY: 0.68,
  maxY: 0.72,
};
function leg(id: string, cx: number, cz: number): Obstacle {
  return {
    id,
    minX: cx - 0.025,
    maxX: cx + 0.025,
    minZ: cz - 0.025,
    maxZ: cz + 0.025,
    minY: 0,
    maxY: 0.68,
  };
}
const LEGS = [
  leg("l1", 0.085, -0.265),
  leg("l2", 1.015, -0.265),
  leg("l3", 0.085, 0.265),
  leg("l4", 1.015, 0.265),
];
const DESK_WORLD = world({ obstacles: [TOP, ...LEGS] });
// 机の -X 側から +X へ（体の向き -π/2）
const TO_DESK_YAW = -Math.PI / 2;
const deskStart = (eye = STAND) => initialWalkState(-0.6, 0, eye);

describe("stepWalk: 机の下", () => {
  it("立ったままでは天板にぶつかって机の下に入れない", () => {
    const s = run(deskStart(), walk(1), DESK_WORLD, 3, TO_DESK_YAW);
    expect(s.x).toBeCloseTo(-R, 2);
    expect(s.eyeHeight).toBeCloseTo(STAND);
  });

  it("しゃがむと机の下に入れる", () => {
    const crouched = run(deskStart(), input({ posture: "crouching" }), DESK_WORLD, 1, TO_DESK_YAW);
    const s = run(crouched, walk(1, { posture: "crouching" }), DESK_WORLD, 0.9, TO_DESK_YAW);
    expect(s.x).toBeGreaterThan(0.25);
    expect(s.x).toBeLessThan(0.85);
  });

  it("しゃがんでいても脚はすり抜けない", () => {
    // 脚 l3（z=0.265）の列を +X へ歩く
    const st = initialWalkState(-0.6, 0.265, CROUCH);
    const s = run(st, walk(1, { posture: "crouching" }), DESK_WORLD, 3, TO_DESK_YAW);
    for (const l of LEGS) expect(circleOverlapsRect(s.x, s.z, R - 1e-6, l)).toBe(false);
    expect(s.x).toBeLessThan(0.085);
  });

  it("机の下で立ち上がっても，頭のてっぺんは天板の下面より上に出ない", () => {
    const under: WalkState = { ...initialWalkState(0.55, 0, CROUCH), posture: "crouching" };
    let s = under;
    for (let i = 0; i < 60; i++) {
      s = stepWalk(s, input({ posture: "standing" }), 1 / 30, DESK_WORLD, TO_DESK_YAW);
      expect(s.eyeHeight + DEFAULT_BODY.headClearance).toBeLessThanOrEqual(TOP.minY + 1e-6);
    }
    expect(s.eyeHeight).toBeGreaterThan(CROUCH);
    expect(s.eyeHeight).toBeCloseTo(TOP.minY - DEFAULT_BODY.headClearance);
  });

  it("机の下で立ち上がりかけた姿勢のまま歩いて外へ出ると，立った目の高さに戻る", () => {
    let s: WalkState = { ...initialWalkState(0.55, 0, CROUCH), posture: "crouching" };
    s = run(s, input({ posture: "standing" }), DESK_WORLD, 1, TO_DESK_YAW);
    // +X へ歩いて机の反対側へ出る
    s = run(s, walk(1, { posture: "standing" }), DESK_WORLD, 1.5, TO_DESK_YAW);
    expect(s.x).toBeGreaterThan(1.1 + R);
    s = run(s, input({ posture: "standing" }), DESK_WORLD, 1, TO_DESK_YAW);
    expect(s.eyeHeight).toBeCloseTo(STAND);
  });

  it("机の下で立ち上がっても天板を突き抜けて上に出ることはない（ずっと立とうとし続ける）", () => {
    let s: WalkState = { ...initialWalkState(0.55, 0, CROUCH), posture: "crouching" };
    s = run(s, input({ posture: "standing" }), DESK_WORLD, 5, TO_DESK_YAW);
    expect(s.eyeHeight).toBeLessThan(TOP.minY);
    expect(s.x).toBeCloseTo(0.55);
  });
});

describe("stepWalk: ドア", () => {
  const doorObstacle: Obstacle = {
    id: "door",
    minX: -0.5,
    maxX: 0.5,
    minZ: -1.1,
    maxZ: -1,
    minY: 0,
    maxY: 2,
  };
  const walls: Obstacle[] = [
    { id: "wl", minX: -5, maxX: -0.5, minZ: -1.1, maxZ: -1, minY: 0, maxY: 2.4 },
    { id: "wr", minX: 0.5, maxX: 5, minZ: -1.1, maxZ: -1, minY: 0, maxY: 2.4 },
  ];
  function doorWorld(open: { value: boolean }): WalkWorld {
    const door: DoorBlocker = { id: "door", obstacle: doorObstacle, isOpen: () => open.value };
    return world({ obstacles: walls, doors: [door] });
  }

  it("閉じたドアは通れず，開いたドアは通れる", () => {
    const open = { value: false };
    const w = doorWorld(open);
    const closed = run(start(), walk(1), w, 3);
    expect(closed.z).toBeCloseTo(-1 + R, 2);
    open.value = true;
    const opened = run(closed, walk(1), w, 2);
    expect(opened.z).toBeLessThan(-1.5);
  });

  it("activeObstacles は閉じたドアだけを含む", () => {
    const open = { value: false };
    const w = doorWorld(open);
    expect(activeObstacles(w).map((o) => o.id)).toContain("door");
    open.value = true;
    expect(activeObstacles(w).map((o) => o.id)).not.toContain("door");
  });

  it("開口部にいる間にドアが閉じても，体はドアと重ならない位置へ出される", () => {
    const open = { value: false };
    const w = doorWorld(open);
    const st = initialWalkState(0, -1.05, STAND);
    const s = stepWalk(st, input(), 1 / 30, w, 0);
    expect(circleOverlapsRect(s.x, s.z, R - 1e-6, doorObstacle)).toBe(false);
  });
});

describe("stepWalk: 着座", () => {
  // 座席は -X 側の壁沿い．座ると +X（通路）を向く（yaw -π/2）．座席の前の床でしゃがむと座る
  const SEAT: SeatSpot = {
    id: "seat-1",
    x: -1.2,
    z: 0,
    eyeHeight: 1.2,
    facingYaw: -Math.PI / 2,
    zone: { minX: -0.9, maxX: -0.55, minZ: -0.225, maxZ: 0.225 },
  };
  const seatBox: Obstacle = {
    id: "seat",
    minX: -1.4,
    maxX: -0.9,
    minZ: -1,
    maxZ: 1,
    minY: 0,
    maxY: 1.05,
  };
  const w = world({ obstacles: [seatBox], seats: [SEAT] });
  const front = () => initialWalkState(-0.7, 0, STAND);

  it("座席に背を向けてしゃがむと座り，目は座席の着座の位置・高さになる", () => {
    let s = stepWalk(front(), input({ posture: "crouching" }), 1 / 30, w, SEAT.facingYaw);
    expect(s.seat?.id).toBe("seat-1");
    s = run(s, input({ posture: "crouching" }), w, 2, SEAT.facingYaw);
    expect(s.x).toBeCloseTo(SEAT.x);
    expect(s.z).toBeCloseTo(SEAT.z);
    expect(s.eyeHeight).toBeCloseTo(1.2);
  });

  it("座席の方を向いてしゃがんでも座らず，しゃがむだけ", () => {
    const s = run(front(), input({ posture: "crouching" }), w, 2, SEAT.facingYaw + Math.PI);
    expect(s.seat).toBeNull();
    expect(s.eyeHeight).toBeCloseTo(CROUCH);
  });

  it("座席の前の範囲の外でしゃがんでも座らない", () => {
    const s = run(
      initialWalkState(1, 0, STAND),
      input({ posture: "crouching" }),
      w,
      1,
      SEAT.facingYaw,
    );
    expect(s.seat).toBeNull();
  });

  it("座っている間は足踏みしても動かず，立つと座る前の位置へ戻る", () => {
    let s = run(front(), input({ posture: "crouching" }), w, 1, SEAT.facingYaw);
    s = run(s, walk(1, { posture: "crouching" }), w, 1, SEAT.facingYaw);
    expect(s.seat).not.toBeNull();
    expect(s.x).toBeCloseTo(SEAT.x);
    s = stepWalk(s, input({ posture: "standing" }), 1 / 30, w, SEAT.facingYaw);
    expect(s.seat).toBeNull();
    expect(s.x).toBeCloseTo(-0.7);
    expect(s.z).toBeCloseTo(0);
    s = run(s, input(), w, 2, SEAT.facingYaw);
    expect(s.eyeHeight).toBeCloseTo(STAND);
  });

  it("しゃがんだまま座席の前へ来ても座らない（しゃがみ始めた時だけ座る）", () => {
    const crouched = run(
      initialWalkState(0, 0, STAND),
      input({ posture: "crouching" }),
      w,
      1,
      Math.PI / 2,
    );
    // -X（座席の方）へ歩いて座席の前まで来る．進む向きは座席の方なので，背は向けていないが，
    // 向きを変えて背を向けた状態でしゃがみ続けても座らない
    const moved = run(crouched, walk(1, { posture: "crouching" }), w, 0.7, Math.PI / 2);
    const s = run(moved, input({ posture: "crouching" }), w, 1, SEAT.facingYaw);
    expect(s.seat).toBeNull();
  });
});

// SPEC_01「VR 避難の規則」の「歩く速さ」（校舎では PlayerInput.walkSpeed に倍率を掛ける．他の空間は変えない）．Issue #121
describe("scaledWalkSpeed", () => {
  it.each([
    ["倍率 1.5 で 1.0 m/s は 1.5 m/s", 1, 1.5, 1.5],
    ["倍率 1.5 で 0.5 m/s は 0.75 m/s", 0.5, 1.5, 0.75],
    ["倍率を省略すると変わらない", 1, undefined, 1],
    ["倍率 1 は変わらない", 0.8, 1, 0.8],
    ["倍率 0 は進まない", 1, 0, 0],
    ["掛けた後も上限 2 m/s で抑える", 1.5, 1.5, 2],
    ["倍率が大きくても上限 2 m/s", 1, 100, 2],
    ["walkSpeed が上限を超えていても 2 m/s", 50, undefined, 2],
    ["walkSpeed が 0 なら 0", 0, 1.5, 0],
    ["負の walkSpeed は 0（後ろへ進まない）", -1, 1.5, 0],
    ["walkSpeed が NaN なら 0", Number.NaN, 1.5, 0],
    ["walkSpeed が Infinity なら上限", Number.POSITIVE_INFINITY, 1.5, 2],
    ["倍率が NaN なら 1 とみなす", 1, Number.NaN, 1],
    ["倍率が Infinity なら 1 とみなす", 1, Number.POSITIVE_INFINITY, 1],
    ["倍率が負なら 1 とみなす（後ろへ進まない）", 1, -1.5, 1],
  ])("%s", (_, speed, scale, expected) => {
    expect(scaledWalkSpeed(speed, scale)).toBeCloseTo(expected, 10);
  });

  it("結果は常に 0〜MAX_WALK_SPEED", () => {
    const speeds = [-10, -1, 0, 0.3, 1, 2, 10, Number.NaN, Number.POSITIVE_INFINITY];
    const scales = [undefined, -1, 0, 0.5, 1, 1.5, 3, Number.NaN];
    for (const v of speeds) {
      for (const k of scales) {
        const r = scaledWalkSpeed(v, k);
        expect(r).toBeGreaterThanOrEqual(0);
        expect(r).toBeLessThanOrEqual(MAX_WALK_SPEED);
      }
    }
  });
});

describe("stepWalk: 歩く速さの倍率（walkSpeedScale）", () => {
  it("walkSpeedScale 1.5 なら 1.0 m/s の足踏みで 1 秒に 1.5 m 進む", () => {
    const s = run(start(), walk(1), world({ walkSpeedScale: 1.5 }), 1);
    expect(s.z).toBeCloseTo(-1.5, 2);
  });

  it("walkSpeedScale が無い空間は今までどおり（1.0 m/s で 1 m）", () => {
    const s = run(start(), walk(1), world(), 1);
    expect(s.z).toBeCloseTo(-1, 2);
  });

  it("倍率を掛けても上限 2 m/s で頭打ちになる", () => {
    const s = run(start(), walk(1.5), world({ walkSpeedScale: 1.5 }), 1);
    expect(Math.hypot(s.x, s.z)).toBeCloseTo(2, 2);
  });

  it("足踏みしていなければ倍率があっても動かない", () => {
    const s = run(
      start(),
      input({ walking: false, walkSpeed: 1 }),
      world({ walkSpeedScale: 1.5 }),
      1,
    );
    expect(s.x).toBeCloseTo(0);
    expect(s.z).toBeCloseTo(0);
  });
});
