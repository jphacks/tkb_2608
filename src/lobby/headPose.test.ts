import { describe, expect, it } from "vitest";
import type { SceneId } from "../core/scene";
import type { CalibrationProfile, Quat } from "../core/types";
import { DEFAULT_CALIBRATION_VALUES, type OrientationSample } from "./calibration";
import {
  headFromOrientation,
  removeYawOffset,
  resolveHeadPose,
  selectHeadSource,
  shouldApplyYawOffset,
} from "./headPose";
import {
  angleDifference,
  deviceOrientationToQuat,
  headYawFromDeviceOrientation,
  multiplyQuat,
  rotateVec,
  yawOfQuat,
} from "./orientation";

const DEG = Math.PI / 180;
const IDENTITY: Quat = { x: 0, y: 0, z: 0, w: 1 };
const ALL_SCENES: readonly SceneId[] = ["start", "home", "lobby", "scenario", "debrief"];

function yawQuat(angle: number): Quat {
  return { x: 0, y: Math.sin(angle / 2), z: 0, w: Math.cos(angle / 2) };
}

function pitchQuat(angle: number): Quat {
  return { x: Math.sin(angle / 2), y: 0, z: 0, w: Math.cos(angle / 2) };
}

function rollQuat(angle: number): Quat {
  return { x: 0, y: 0, z: Math.sin(angle / 2), w: Math.cos(angle / 2) };
}

/** 視線（-Z）の上下の角度（rad．正で上） */
function pitchOf(q: Quat): number {
  const f = rotateVec(q, { x: 0, y: 0, z: -1 });
  return Math.asin(Math.max(-1, Math.min(1, f.y)));
}

/** 頭の上（+Y）の向きの鉛直成分（傾きの大きさの目安） */
function upY(q: Quat): number {
  return rotateVec(q, { x: 0, y: 1, z: 0 }).y;
}

function sample(patch: Partial<OrientationSample> = {}): OrientationSample {
  // 横向き（screenAngle 90）でゴーグルに入れて前を向いた姿勢に近い値
  return { t: 1, alpha: 30, beta: 0, gamma: -90, screenAngle: 90, ...patch };
}

function calibration(patch: Partial<CalibrationProfile> = {}): CalibrationProfile {
  return { createdAt: 0, ...DEFAULT_CALIBRATION_VALUES, yawOffset: 40 * DEG, ...patch };
}

function expectQuatClose(a: Quat, b: Quat): void {
  // q と -q は同じ回転
  const sign = a.x * b.x + a.y * b.y + a.z * b.z + a.w * b.w < 0 ? -1 : 1;
  expect(a.x).toBeCloseTo(sign * b.x);
  expect(a.y).toBeCloseTo(sign * b.y);
  expect(a.z).toBeCloseTo(sign * b.z);
  expect(a.w).toBeCloseTo(sign * b.w);
}

describe("selectHeadSource", () => {
  it("端末の向きのサンプルが無ければドラッグ", () => {
    expect(selectHeadSource(null)).toBe("drag");
  });

  it("有限なサンプルがあれば端末の向き", () => {
    expect(selectHeadSource(sample())).toBe("device");
    expect(selectHeadSource(sample({ alpha: 0, beta: 0, gamma: 0, screenAngle: 0 }))).toBe(
      "device",
    );
  });

  it.each(["alpha", "beta", "gamma", "screenAngle"] as const)(
    "%s が有限でなければドラッグ",
    (key) => {
      expect(selectHeadSource(sample({ [key]: Number.NaN }))).toBe("drag");
      expect(selectHeadSource(sample({ [key]: Number.POSITIVE_INFINITY }))).toBe("drag");
      expect(selectHeadSource(sample({ [key]: Number.NEGATIVE_INFINITY }))).toBe("drag");
    },
  );
});

describe("headFromOrientation", () => {
  it("端末の向きの変換（deviceOrientationToQuat）と同じ向きになる", () => {
    const s = sample({ alpha: 75, beta: 10, gamma: -80, screenAngle: 90 });
    expectQuatClose(headFromOrientation(s), deviceOrientationToQuat(75, 10, -80, 90));
  });

  it("ヨー角はキャリブレーションの正面の測り方（headYawFromDeviceOrientation）と一致する", () => {
    for (const alpha of [0, 45, 120, 250, 359]) {
      const s = sample({ alpha });
      expect(yawOfQuat(headFromOrientation(s))).toBeCloseTo(
        headYawFromDeviceOrientation(s.alpha, s.beta, s.gamma, s.screenAngle),
      );
    }
  });
});

describe("shouldApplyYawOffset", () => {
  it.each(ALL_SCENES)("キャリブレーションの値が無ければ %s でも差し引かない", (scene) => {
    expect(shouldApplyYawOffset(scene, null)).toBe(false);
  });

  it.each(ALL_SCENES.map((s) => [s, s !== "lobby"] as const))(
    "キャリブレーションの値があれば %s では差し引くか: %s",
    (scene, expected) => {
      expect(shouldApplyYawOffset(scene, calibration())).toBe(expected);
    },
  );

  it("画面がまだ無い（null）時もロビー以外として扱う", () => {
    expect(shouldApplyYawOffset(null, calibration())).toBe(true);
    expect(shouldApplyYawOffset(null, null)).toBe(false);
  });
});

describe("removeYawOffset", () => {
  it.each([0, 0.3, -0.8, 1.5, Math.PI - 0.1])(
    "正面を向いた向き（yawOffset と同じヨー角）が正面（ヨー角 0）になる（yawOffset %d）",
    (offset) => {
      const head = yawQuat(offset);
      expect(yawOfQuat(removeYawOffset(head, offset))).toBeCloseTo(0);
    },
  );

  it("ヨー角だけが yawOffset だけ減る", () => {
    const head = multiplyQuat(yawQuat(70 * DEG), pitchQuat(20 * DEG));
    const out = removeYawOffset(head, 25 * DEG);
    expect(angleDifference(yawOfQuat(head) - 25 * DEG, yawOfQuat(out))).toBeCloseTo(0);
  });

  it("上下の角度と左右の傾きは変えない", () => {
    const head = multiplyQuat(
      multiplyQuat(yawQuat(-50 * DEG), pitchQuat(-30 * DEG)),
      rollQuat(12 * DEG),
    );
    const out = removeYawOffset(head, 35 * DEG);
    expect(pitchOf(out)).toBeCloseTo(pitchOf(head));
    expect(upY(out)).toBeCloseTo(upY(head));
  });

  it("結果は単位クォータニオン", () => {
    const head = multiplyQuat(yawQuat(1), pitchQuat(0.4));
    const out = removeYawOffset(head, 2.2);
    expect(Math.hypot(out.x, out.y, out.z, out.w)).toBeCloseTo(1);
  });

  it.each([0, Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY])(
    "yawOffset が %d の時はそのまま",
    (offset) => {
      const head = multiplyQuat(yawQuat(0.7), pitchQuat(0.2));
      expectQuatClose(removeYawOffset(head, offset), head);
    },
  );
});

describe("resolveHeadPose", () => {
  const drag = multiplyQuat(yawQuat(0.5), pitchQuat(0.1));

  it("端末の向きが無ければドラッグの向きを使う", () => {
    expectQuatClose(
      resolveHeadPose({ latest: null, drag, scene: "home", calibration: null }),
      drag,
    );
  });

  it("端末の向きの値が有限でなければドラッグの向きを使う", () => {
    expectQuatClose(
      resolveHeadPose({
        latest: sample({ alpha: Number.NaN }),
        drag,
        scene: "home",
        calibration: null,
      }),
      drag,
    );
  });

  it("端末の向きがあればそれを使う（キャリブレーション前は生の向き）", () => {
    const s = sample({ alpha: 60 });
    expectQuatClose(
      resolveHeadPose({ latest: s, drag, scene: "lobby", calibration: null }),
      headFromOrientation(s),
    );
  });

  it("ロビーではキャリブレーションの値があっても差し引かない（測り直すため）", () => {
    const s = sample({ alpha: 60 });
    expectQuatClose(
      resolveHeadPose({ latest: s, drag, scene: "lobby", calibration: calibration() }),
      headFromOrientation(s),
    );
  });

  it("シナリオでは，ロビーで正面として測った向きがヨー角 0 になる", () => {
    const front = sample({ alpha: 123, beta: 5, gamma: -85 });
    const yawOffset = headYawFromDeviceOrientation(
      front.alpha,
      front.beta,
      front.gamma,
      front.screenAngle,
    );
    const head = resolveHeadPose({
      latest: front,
      drag,
      scene: "scenario",
      calibration: calibration({ yawOffset }),
    });
    expect(yawOfQuat(head)).toBeCloseTo(0);
    // 上下の角度は変えない
    expect(pitchOf(head)).toBeCloseTo(pitchOf(headFromOrientation(front)));
  });

  it("ロビー以外ではドラッグの向きからも yawOffset を差し引く", () => {
    const head = resolveHeadPose({
      latest: null,
      drag: yawQuat(0.9),
      scene: "home",
      calibration: calibration({ yawOffset: 0.4 }),
    });
    expect(yawOfQuat(head)).toBeCloseTo(0.5);
  });

  it("yawOffset が 0 なら差し引いても変わらない", () => {
    const s = sample({ alpha: 200 });
    expectQuatClose(
      resolveHeadPose({
        latest: s,
        drag: IDENTITY,
        scene: "scenario",
        calibration: calibration({ yawOffset: 0 }),
      }),
      headFromOrientation(s),
    );
  });
});
