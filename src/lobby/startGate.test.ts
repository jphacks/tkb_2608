import { describe, expect, it } from "vitest";
import type { HandState, Quat, Vec3 } from "../core/types";
import { UNTRACKED_HAND } from "../core/types";
import {
  ALIGN_BUTTON_ARM_SECONDS,
  ALIGN_BUTTON_OFFSET,
  advanceStartGate,
  autoStartRemainingSeconds,
  buttonCenter,
  DEFAULT_START_GATE_CONFIG,
  handPressPoint,
  handSightPoint,
  INITIAL_START_GATE,
  isDeviceLevel,
  isGazingAtButton,
  isHandOnButton,
  type StartGateConfig,
  type StartGateFrame,
  type StartGateState,
  skipStartGate,
  startGateProgress,
} from "./startGate";

const DEG = Math.PI / 180;
const IDENTITY: Quat = { x: 0, y: 0, z: 0, w: 1 };
const HAND_CONFIG: StartGateConfig = { ...DEFAULT_START_GATE_CONFIG, startMode: "hand" };
/** 手が無かった頃の自動開始（既定ではない．config で明示して使う） */
const AUTO_CONFIG: StartGateConfig = { ...DEFAULT_START_GATE_CONFIG, startMode: "auto" };

function yawQuat(angle: number): Quat {
  return { x: 0, y: Math.sin(angle / 2), z: 0, w: Math.cos(angle / 2) };
}

function pitchQuat(angle: number): Quat {
  return { x: Math.sin(angle / 2), y: 0, z: 0, w: Math.cos(angle / 2) };
}

function hand(position: Vec3, tracked = true): HandState {
  return { tracked, position, grip: 0 };
}

/** 人差し指の先（indexTip）を持つ手 */
function tipHand(position: Vec3, indexTip: Vec3, tracked = true): HandState {
  return { tracked, position, grip: 0, indexTip };
}

const ON = { x: 0, y: 0, z: -0.5 };
const OFF = { x: 0, y: 0.3, z: -0.5 };
const NON_FINITE = [Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY];

function frame(patch: Partial<StartGateFrame> = {}): StartGateFrame {
  return {
    dt: 0.125, // 2 進で正確に表せる刻み（累積の誤差を避ける）
    sources: { gaze: false },
    head: IDENTITY,
    hands: { left: UNTRACKED_HAND, right: UNTRACKED_HAND },
    buttonYaw: 0,
    deviceLevel: null,
    ...patch,
  };
}

function run(
  state: StartGateState,
  f: StartGateFrame,
  seconds: number,
  config: StartGateConfig = DEFAULT_START_GATE_CONFIG,
): StartGateState {
  let s = state;
  const n = Math.round(seconds / f.dt);
  for (let i = 0; i < n; i++) s = advanceStartGate(s, f, config);
  return s;
}

describe("DEFAULT_START_GATE_CONFIG（決定事項）", () => {
  it("既定は手で開始ボタンに触れて始める（Issue #110）", () => {
    expect(DEFAULT_START_GATE_CONFIG.startMode).toBe("hand");
  });

  it("auto に切り替えた時の自動開始は 15 秒", () => {
    expect(DEFAULT_START_GATE_CONFIG.autoStartSeconds).toBe(15);
  });

  it("ボタンは正面 0.5 m，手は 0.12 m 以内を 1 秒，注視は 10° 以内を 3 秒，水平は ±20°", () => {
    expect(DEFAULT_START_GATE_CONFIG.buttonOffset).toEqual({ x: 0, y: 0, z: -0.5 });
    expect(DEFAULT_START_GATE_CONFIG.handRadius).toBeCloseTo(0.12);
    expect(DEFAULT_START_GATE_CONFIG.handHoldSeconds).toBe(1);
    expect(DEFAULT_START_GATE_CONFIG.gazeToleranceRad).toBeCloseTo(10 * DEG);
    expect(DEFAULT_START_GATE_CONFIG.gazeHoldSeconds).toBe(3);
    expect(DEFAULT_START_GATE_CONFIG.levelToleranceRad).toBeCloseTo(20 * DEG);
  });
});

describe("buttonCenter", () => {
  it("ヨー角 0 で正面 0.5 m", () => {
    const c = buttonCenter(0);
    expect(c.x).toBeCloseTo(0);
    expect(c.y).toBeCloseTo(0);
    expect(c.z).toBeCloseTo(-0.5);
  });

  it("ヨー角 +90° で左（-X）0.5 m に追従する", () => {
    const c = buttonCenter(Math.PI / 2);
    expect(c.x).toBeCloseTo(-0.5);
    expect(c.z).toBeCloseTo(0);
  });

  it("中心からの距離はヨー角によらない", () => {
    for (const yaw of [-2, -0.4, 0.9, 3]) {
      const c = buttonCenter(yaw);
      expect(Math.hypot(c.x, c.y, c.z)).toBeCloseTo(0.5);
    }
  });
});

describe("isHandOnButton", () => {
  const center = buttonCenter(0);

  it("手のひらがボタンの中心から 0.12 m 以内なら触れている", () => {
    expect(isHandOnButton(IDENTITY, hand({ x: 0, y: 0, z: -0.5 }), center)).toBe(true);
    expect(isHandOnButton(IDENTITY, hand({ x: 0.1, y: 0, z: -0.5 }), center)).toBe(true);
  });

  it("0.12 m より遠ければ触れていない", () => {
    expect(isHandOnButton(IDENTITY, hand({ x: 0.13, y: 0, z: -0.5 }), center)).toBe(false);
  });

  it("目から見た向きで判定する（ボタンと重なって見えれば，奥行きが違っても触れている）", () => {
    // 手の形はボタン（0.5 m）より奥の固定の奥行きに描くため，見た目で重なっていれば押せるようにする
    expect(isHandOnButton(IDENTITY, hand({ x: 0, y: 0, z: -0.3 }), center)).toBe(true);
    expect(isHandOnButton(IDENTITY, hand({ x: 0, y: 0, z: -1.2 }), center)).toBe(true);
    // 1.2 m 先で横に 0.24 m ずれた点は，0.5 m 先では 0.1 m のずれに見える
    expect(isHandOnButton(IDENTITY, hand({ x: 0.24, y: 0, z: -1.2 }), center)).toBe(true);
    // 0.36 m のずれは 0.5 m 先で 0.15 m（範囲外）
    expect(isHandOnButton(IDENTITY, hand({ x: 0.36, y: 0, z: -1.2 }), center)).toBe(false);
  });

  it("目の後ろや目の位置の点は触れていない", () => {
    expect(isHandOnButton(IDENTITY, hand({ x: 0, y: 0, z: 0.5 }), center)).toBe(false);
    expect(isHandOnButton(IDENTITY, hand({ x: 0, y: 0, z: 0 }), center)).toBe(false);
  });

  it("認識できていない手は位置が合っていても触れていない", () => {
    expect(isHandOnButton(IDENTITY, hand({ x: 0, y: 0, z: -0.5 }, false), center)).toBe(false);
  });

  it("手の位置は頭の座標系（頭が左を向けば，頭の正面の手は rig の左にある）", () => {
    const head = yawQuat(Math.PI / 2);
    const front = hand({ x: 0, y: 0, z: -0.5 });
    expect(isHandOnButton(head, front, buttonCenter(0))).toBe(false);
    expect(isHandOnButton(head, front, buttonCenter(Math.PI / 2))).toBe(true);
  });
});

describe("handSightPoint", () => {
  /** 人差し指の先（番号 8）だけ tip，他は手のひらの位置に置いた 21 点 */
  function landmarksWithTip(tip: Vec3): Vec3[] {
    return Array.from({ length: 21 }, (_, i) => (i === 8 ? tip : OFF));
  }

  it("描いた手の形の人差し指の先があれば，indexTip より優先する", () => {
    const drawn = { x: 0, y: 0, z: -1.2 };
    const h: HandState = { ...tipHand(OFF, OFF), landmarks: landmarksWithTip(drawn) };
    expect(handSightPoint(h)).toEqual(drawn);
    expect(isHandOnButton(IDENTITY, h, buttonCenter(0))).toBe(true);
  });

  it("手の形が無ければ handPressPoint と同じ", () => {
    expect(handSightPoint(tipHand(OFF, ON))).toEqual(ON);
    expect(handSightPoint(hand(OFF))).toEqual(OFF);
  });

  it.each(NON_FINITE)("手の形の指先に %s を含む時は handPressPoint を使う", (v) => {
    const h: HandState = {
      ...tipHand(OFF, ON),
      landmarks: landmarksWithTip({ x: v, y: 0, z: -1 }),
    };
    expect(handSightPoint(h)).toEqual(ON);
  });

  it("点が足りない手の形は handPressPoint を使う", () => {
    const h: HandState = { ...tipHand(OFF, ON), landmarks: [OFF, OFF] };
    expect(handSightPoint(h)).toEqual(ON);
  });
});

describe("handPressPoint", () => {
  it("人差し指の先があればそれを判定点にする", () => {
    const tip = { x: 0.01, y: 0.02, z: -0.4 };
    expect(handPressPoint(tipHand(OFF, tip))).toEqual(tip);
  });

  it("人差し指の先が無い時は手のひらの中心を判定点にする", () => {
    expect(handPressPoint(hand(OFF))).toEqual(OFF);
  });

  it.each(NON_FINITE.flatMap((v) => (["x", "y", "z"] as const).map((axis) => [axis, v] as const)))(
    "人差し指の先の %s が %s なら手のひらの中心に戻る",
    (axis, v) => {
      expect(handPressPoint(tipHand(OFF, { ...ON, [axis]: v }))).toEqual(OFF);
    },
  );
});

describe("isHandOnButton（人差し指の先で判定する）", () => {
  const center = buttonCenter(0);

  it("手のひらは範囲外でも，人差し指の先が範囲内なら触れている", () => {
    expect(isHandOnButton(IDENTITY, tipHand(OFF, ON), center)).toBe(true);
  });

  it("手のひらが範囲内でも，人差し指の先が範囲外なら触れていない", () => {
    expect(isHandOnButton(IDENTITY, tipHand(ON, OFF), center)).toBe(false);
  });

  it("人差し指の先が 0.12 m 以内なら触れている・0.12 m より遠ければ触れていない", () => {
    expect(isHandOnButton(IDENTITY, tipHand(OFF, { x: 0.1, y: 0, z: -0.5 }), center)).toBe(true);
    expect(isHandOnButton(IDENTITY, tipHand(ON, { x: 0.13, y: 0, z: -0.5 }), center)).toBe(false);
  });

  it("人差し指の先が無ければ手のひらの中心で判定する", () => {
    expect(isHandOnButton(IDENTITY, hand(ON), center)).toBe(true);
    expect(isHandOnButton(IDENTITY, hand(OFF), center)).toBe(false);
  });

  it.each(NON_FINITE)("人差し指の先に %s を含む時は手のひらの中心で判定する", (v) => {
    const broken = { x: 0, y: 0, z: v };
    expect(isHandOnButton(IDENTITY, tipHand(ON, broken), center)).toBe(true);
    expect(isHandOnButton(IDENTITY, tipHand(OFF, broken), center)).toBe(false);
  });

  it("認識できていない手は人差し指の先が合っていても触れていない", () => {
    expect(isHandOnButton(IDENTITY, tipHand(ON, ON, false), center)).toBe(false);
  });
});

describe("isGazingAtButton", () => {
  const center = buttonCenter(0);

  it("ボタンの方向を見ていれば true", () => {
    expect(isGazingAtButton(IDENTITY, center)).toBe(true);
  });

  it("ずれが 10° 以内なら true，超えれば false", () => {
    expect(isGazingAtButton(yawQuat(9 * DEG), center)).toBe(true);
    expect(isGazingAtButton(yawQuat(11 * DEG), center)).toBe(false);
    expect(isGazingAtButton(pitchQuat(-11 * DEG), center)).toBe(false);
  });

  it("中心が原点なら false", () => {
    expect(isGazingAtButton(IDENTITY, { x: 0, y: 0, z: 0 })).toBe(false);
  });
});

describe("isDeviceLevel", () => {
  it("横向き（90 / 270）で前を向いていれば true", () => {
    expect(isDeviceLevel({ t: 0, alpha: 0, beta: 0, gamma: -90, screenAngle: 90 })).toBe(true);
    expect(isDeviceLevel({ t: 0, alpha: 0, beta: 0, gamma: 90, screenAngle: 270 })).toBe(true);
    expect(isDeviceLevel({ t: 0, alpha: 0, beta: 0, gamma: 90, screenAngle: -90 })).toBe(true);
  });

  it("縦向き（0 / 180）は水平でも false", () => {
    expect(isDeviceLevel({ t: 0, alpha: 0, beta: 90, gamma: 0, screenAngle: 0 })).toBe(false);
    expect(isDeviceLevel({ t: 0, alpha: 0, beta: -90, gamma: 0, screenAngle: 180 })).toBe(false);
  });

  it("横向きでも上下に 20° を超えて傾いていれば false", () => {
    // gamma を -90 から 25° ずらすと視線が上下に 25° 傾く
    expect(isDeviceLevel({ t: 0, alpha: 0, beta: 0, gamma: -65, screenAngle: 90 })).toBe(false);
    expect(isDeviceLevel({ t: 0, alpha: 0, beta: 0, gamma: -75, screenAngle: 90 })).toBe(true);
  });

  it("机に平らに置いた状態は false", () => {
    expect(isDeviceLevel({ t: 0, alpha: 0, beta: 0, gamma: 0, screenAngle: 90 })).toBe(false);
  });
});

describe("advanceStartGate", () => {
  describe("既定の config（startMode: hand）", () => {
    it("何もしなければ自動では始まらない", () => {
      const s = run(INITIAL_START_GATE, frame(), 60);
      expect(s.startedBy).toBeNull();
    });

    it("手のひらをボタンに 1 秒かざすと始まる", () => {
      const f = frame({ hands: { left: UNTRACKED_HAND, right: hand({ x: 0, y: 0, z: -0.5 }) } });
      expect(run(INITIAL_START_GATE, f, 0.875).startedBy).toBeNull();
      expect(run(INITIAL_START_GATE, f, 1).startedBy).toBe("hand");
    });
  });

  describe("startMode: auto（明示した時）", () => {
    it("何もしなくても 15 秒で自動で始まる", () => {
      const before = run(INITIAL_START_GATE, frame(), 14.9, AUTO_CONFIG);
      expect(before.startedBy).toBeNull();
      const after = run(before, frame(), 0.2, AUTO_CONFIG);
      expect(after.startedBy).toBe("auto");
    });

    it("手は無視する", () => {
      const f = frame({ hands: { left: UNTRACKED_HAND, right: hand({ x: 0, y: 0, z: -0.5 }) } });
      const s = run(INITIAL_START_GATE, f, 2, AUTO_CONFIG);
      expect(s.startedBy).toBeNull();
      expect(s.handHeld).toBe(0);
    });
  });

  describe("startMode: hand", () => {
    const onButton = frame({
      hands: { left: UNTRACKED_HAND, right: hand({ x: 0, y: 0, z: -0.5 }) },
    });

    it("自動では始まらない", () => {
      const s = run(INITIAL_START_GATE, frame(), 60, HAND_CONFIG);
      expect(s.startedBy).toBeNull();
    });

    it("手をボタンに 1 秒かざすと始まる（開始理由 hand）", () => {
      const before = run(INITIAL_START_GATE, onButton, 0.9, HAND_CONFIG);
      expect(before.startedBy).toBeNull();
      const after = run(before, onButton, 0.1, HAND_CONFIG);
      expect(after.startedBy).toBe("hand");
    });

    it("左手でも始まる", () => {
      const f = frame({ hands: { left: hand({ x: 0, y: 0, z: -0.5 }), right: UNTRACKED_HAND } });
      expect(run(INITIAL_START_GATE, f, 1, HAND_CONFIG).startedBy).toBe("hand");
    });

    it("途中で手が離れると保持は 0 に戻る", () => {
      let s = run(INITIAL_START_GATE, onButton, 0.8, HAND_CONFIG);
      s = advanceStartGate(s, frame(), HAND_CONFIG);
      expect(s.handHeld).toBe(0);
      s = run(s, onButton, 0.8, HAND_CONFIG);
      expect(s.startedBy).toBeNull();
    });

    it("手のひらが外れていても，人差し指の先をボタンに 1 秒当てると始まる（左右どちらでも）", () => {
      const right = frame({ hands: { left: UNTRACKED_HAND, right: tipHand(OFF, ON) } });
      const left = frame({ hands: { left: tipHand(OFF, ON), right: UNTRACKED_HAND } });
      expect(run(INITIAL_START_GATE, right, 1, HAND_CONFIG).startedBy).toBe("hand");
      expect(run(INITIAL_START_GATE, left, 1, HAND_CONFIG).startedBy).toBe("hand");
    });

    it("手のひらだけがボタンにあり人差し指の先が外れていれば始まらない", () => {
      const f = frame({ hands: { left: tipHand(ON, OFF), right: tipHand(ON, OFF) } });
      const s = run(INITIAL_START_GATE, f, 3, HAND_CONFIG);
      expect(s.startedBy).toBeNull();
      expect(s.handHeld).toBe(0);
    });

    it("ボタンが頭のヨー角に追従しても，その位置に手があれば始まる", () => {
      const f = frame({
        buttonYaw: Math.PI / 2,
        hands: { left: UNTRACKED_HAND, right: hand({ x: -0.5, y: 0, z: 0 }) },
      });
      expect(run(INITIAL_START_GATE, f, 1, HAND_CONFIG).startedBy).toBe("hand");
    });
  });

  describe("注視（debug のみ）", () => {
    it("sources.gaze が false なら注視しても始まらない", () => {
      const s = run(INITIAL_START_GATE, frame(), 5, HAND_CONFIG);
      expect(s.startedBy).toBeNull();
      expect(s.gazeHeld).toBe(0);
    });

    it("sources.gaze が true で 3 秒見つめると始まる（開始理由 gaze）", () => {
      const f = frame({ sources: { gaze: true } });
      const before = run(INITIAL_START_GATE, f, 2.9, HAND_CONFIG);
      expect(before.startedBy).toBeNull();
      expect(run(before, f, 0.1, HAND_CONFIG).startedBy).toBe("gaze");
    });

    it("端末が水平でない（deviceLevel が false）間は数えない", () => {
      const f = frame({ sources: { gaze: true }, deviceLevel: false });
      const s = run(INITIAL_START_GATE, f, 5, HAND_CONFIG);
      expect(s.startedBy).toBeNull();
      expect(s.gazeHeld).toBe(0);
    });

    it("deviceLevel が true なら数える", () => {
      const f = frame({ sources: { gaze: true }, deviceLevel: true });
      expect(run(INITIAL_START_GATE, f, 3, HAND_CONFIG).startedBy).toBe("gaze");
    });

    it("視線が外れると保持は 0 に戻る", () => {
      const f = frame({ sources: { gaze: true } });
      let s = run(INITIAL_START_GATE, f, 2, HAND_CONFIG);
      s = advanceStartGate(
        s,
        frame({ sources: { gaze: true }, head: yawQuat(30 * DEG) }),
        HAND_CONFIG,
      );
      expect(s.gazeHeld).toBe(0);
    });

    it("startMode が auto でも注視で始められる", () => {
      const f = frame({ sources: { gaze: true } });
      expect(run(INITIAL_START_GATE, f, 3, AUTO_CONFIG).startedBy).toBe("gaze");
    });

    it("既定の config（hand）でも注視で始められる", () => {
      const f = frame({ sources: { gaze: true } });
      expect(run(INITIAL_START_GATE, f, 3).startedBy).toBe("gaze");
    });
  });

  it("開始後は状態を変えない", () => {
    const started = run(INITIAL_START_GATE, frame(), 15, AUTO_CONFIG);
    expect(started.startedBy).toBe("auto");
    const next = advanceStartGate(started, frame({ sources: { gaze: true } }), AUTO_CONFIG);
    expect(next).toBe(started);
  });

  it("dt が不正（NaN・負・Infinity）なら時間を進めない", () => {
    for (const dt of [Number.NaN, -1, Number.POSITIVE_INFINITY]) {
      const s = advanceStartGate(INITIAL_START_GATE, frame({ dt }));
      expect(s.waited).toBe(0);
      expect(s.startedBy).toBeNull();
    }
  });

  it("元の状態を書き換えない", () => {
    const state = Object.freeze({ ...INITIAL_START_GATE });
    const next = advanceStartGate(state, frame({ sources: { gaze: true } }));
    expect(state).toEqual(INITIAL_START_GATE);
    expect(next).not.toBe(state);
  });
});

describe("skipStartGate", () => {
  it("開始前なら開始理由 skip で始める", () => {
    expect(skipStartGate(INITIAL_START_GATE).startedBy).toBe("skip");
  });

  it("開始後は変えない", () => {
    const started: StartGateState = { ...INITIAL_START_GATE, startedBy: "hand" };
    expect(skipStartGate(started)).toBe(started);
  });
});

describe("autoStartRemainingSeconds", () => {
  it("auto では 15 秒から減っていき 0 で止まる", () => {
    expect(autoStartRemainingSeconds(INITIAL_START_GATE, AUTO_CONFIG)).toBeCloseTo(15);
    expect(
      autoStartRemainingSeconds({ ...INITIAL_START_GATE, waited: 10 }, AUTO_CONFIG),
    ).toBeCloseTo(5);
    expect(autoStartRemainingSeconds({ ...INITIAL_START_GATE, waited: 20 }, AUTO_CONFIG)).toBe(0);
  });

  it("hand モードでは null", () => {
    expect(autoStartRemainingSeconds(INITIAL_START_GATE, HAND_CONFIG)).toBeNull();
  });

  it("既定の config（hand）では null（自動開始のカウントダウンを出さない）", () => {
    expect(autoStartRemainingSeconds({ ...INITIAL_START_GATE, waited: 10 })).toBeNull();
  });

  it("開始後は null", () => {
    expect(autoStartRemainingSeconds({ ...INITIAL_START_GATE, startedBy: "auto" })).toBeNull();
  });
});

describe("startGateProgress", () => {
  it("最初は 0，開始後は 1", () => {
    expect(startGateProgress(INITIAL_START_GATE)).toBe(0);
    expect(startGateProgress({ ...INITIAL_START_GATE, startedBy: "skip" })).toBe(1);
  });

  it("自動・手・注視のうち最も進んでいるもの", () => {
    const s: StartGateState = { waited: 3, handHeld: 0.5, gazeHeld: 0.3, startedBy: null };
    // auto 3/15 = 0.2，手 0.5/1 = 0.5，注視 0.3/3 = 0.1
    expect(startGateProgress(s, AUTO_CONFIG)).toBeCloseTo(0.5);
    expect(startGateProgress({ ...s, waited: 12 }, AUTO_CONFIG)).toBeCloseTo(0.8);
  });

  it("hand モードでは自動のカウントダウンを含めない", () => {
    const s: StartGateState = { waited: 12, handHeld: 0, gazeHeld: 0, startedBy: null };
    expect(startGateProgress(s, HAND_CONFIG)).toBe(0);
    // 既定（hand）でも同じ
    expect(startGateProgress(s)).toBe(0);
  });

  it("0〜1 に収める", () => {
    const s: StartGateState = { waited: 100, handHeld: 0, gazeHeld: 0, startedBy: null };
    expect(startGateProgress(s, AUTO_CONFIG)).toBe(1);
    expect(startGateProgress({ ...s, waited: 0, handHeld: 5 })).toBe(1);
  });
});

// lobbyScene の isPaused（縦向きの案内中）は advanceStartGate を呼ばないことで自動開始を止める．
// 自動開始までの時間が dt の累積で数えられ，呼ばない間は進まないことを確かめる
describe("advanceStartGate（止めている間）", () => {
  it("止めている間は自動開始までの残り時間が減らず，再開すると続きから数える", () => {
    const auto = DEFAULT_START_GATE_CONFIG.autoStartSeconds;
    let s = INITIAL_START_GATE;
    // 半分まで進める
    const half = Math.round(auto / 2 / 0.125);
    for (let i = 0; i < half; i++) s = advanceStartGate(s, frame(), AUTO_CONFIG);
    const remaining = autoStartRemainingSeconds(s, AUTO_CONFIG);
    // ここで自動開始の時間より長く止めたとする（lobbyScene は advanceStartGate を呼ばない）
    expect(s.startedBy).toBeNull();
    expect(remaining).not.toBeNull();
    expect(autoStartRemainingSeconds(s, AUTO_CONFIG)).toBe(remaining);
    // 再開すると残りの時間で自動開始する
    const rest = Math.ceil((remaining ?? 0) / 0.125);
    for (let i = 0; i < rest - 1; i++) s = advanceStartGate(s, frame(), AUTO_CONFIG);
    expect(s.startedBy).toBeNull();
    s = advanceStartGate(s, frame(), AUTO_CONFIG);
    expect(s.startedBy).toBe("auto");
  });
});

describe("ALIGN_BUTTON_OFFSET・ALIGN_BUTTON_ARM_SECONDS（見え方の調整を終えるボタン）", () => {
  const alignConfig: StartGateConfig = { ...HAND_CONFIG, buttonOffset: ALIGN_BUTTON_OFFSET };

  it("開始ボタンの 0.15 m 下にある", () => {
    const start = DEFAULT_START_GATE_CONFIG.buttonOffset;
    expect(ALIGN_BUTTON_OFFSET.x).toBeCloseTo(start.x);
    expect(ALIGN_BUTTON_OFFSET.y).toBeCloseTo(start.y - 0.15);
    expect(ALIGN_BUTTON_OFFSET.z).toBeCloseTo(start.z);
  });

  it("開始ボタンから handRadius より遠い", () => {
    const a = ALIGN_BUTTON_OFFSET;
    const b = DEFAULT_START_GATE_CONFIG.buttonOffset;
    const d = Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
    expect(d).toBeGreaterThan(DEFAULT_START_GATE_CONFIG.handRadius);
  });

  it("開始ボタンにかざしたままの手では，見え方の調整のボタンに触れていない", () => {
    const onStart = hand(DEFAULT_START_GATE_CONFIG.buttonOffset);
    expect(isHandOnButton(IDENTITY, onStart, buttonCenter(0, alignConfig), alignConfig)).toBe(
      false,
    );
    expect(isHandOnButton(IDENTITY, hand(ALIGN_BUTTON_OFFSET), buttonCenter(0, alignConfig))).toBe(
      true,
    );
  });

  it("押せるようになるまでの秒数は 3 秒", () => {
    expect(ALIGN_BUTTON_ARM_SECONDS).toBe(3);
  });
});
