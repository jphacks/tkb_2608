import { describe, expect, it } from "vitest";
import type { Quat, Vec3 } from "../core/types";
import { LOBBY_PANEL_CENTER } from "./lobbyRoom";
import { multiplyQuat } from "./orientation";
import {
  approachHighlight,
  isGazingAtPanel,
  PANEL_GAZE_TOLERANCE_RAD,
  PANEL_HIGHLIGHT_RATE,
} from "./panelGaze";

const DEG = Math.PI / 180;
const IDENTITY: Quat = { x: 0, y: 0, z: 0, w: 1 };
/** 目の高さの正面 2 m（上下のずれなし） */
const FRONT: Vec3 = { x: 0, y: 0, z: -2 };

function yawQuat(angle: number): Quat {
  return { x: 0, y: Math.sin(angle / 2), z: 0, w: Math.cos(angle / 2) };
}

function pitchQuat(angle: number): Quat {
  return { x: Math.sin(angle / 2), y: 0, z: 0, w: Math.cos(angle / 2) };
}

describe("PANEL_GAZE_TOLERANCE_RAD・PANEL_HIGHLIGHT_RATE", () => {
  it("許容の角度は 15°，明るさの変化は 4/秒", () => {
    expect(PANEL_GAZE_TOLERANCE_RAD).toBeCloseTo(15 * DEG);
    expect(PANEL_HIGHLIGHT_RATE).toBe(4);
  });
});

describe("isGazingAtPanel", () => {
  it("板の中心をまっすぐ見ていれば注視", () => {
    expect(isGazingAtPanel(IDENTITY, 0, FRONT)).toBe(true);
  });

  it("許容の角度の内側なら注視，外側なら注視でない（左右）", () => {
    expect(isGazingAtPanel(yawQuat(14 * DEG), 0, FRONT)).toBe(true);
    expect(isGazingAtPanel(yawQuat(-14 * DEG), 0, FRONT)).toBe(true);
    expect(isGazingAtPanel(yawQuat(16 * DEG), 0, FRONT)).toBe(false);
    expect(isGazingAtPanel(yawQuat(-16 * DEG), 0, FRONT)).toBe(false);
  });

  it("許容の角度の内側なら注視，外側なら注視でない（上下）", () => {
    expect(isGazingAtPanel(pitchQuat(14 * DEG), 0, FRONT)).toBe(true);
    expect(isGazingAtPanel(pitchQuat(-16 * DEG), 0, FRONT)).toBe(false);
  });

  it("板のヨー角に合わせて頭を回せば注視（板が左に回った時）", () => {
    const panelYaw = 60 * DEG;
    expect(isGazingAtPanel(yawQuat(panelYaw), panelYaw, FRONT)).toBe(true);
    expect(isGazingAtPanel(IDENTITY, panelYaw, FRONT)).toBe(false);
  });

  it("板のヨー角に合わせて頭を回せば注視（板が右に回った時）", () => {
    const panelYaw = -100 * DEG;
    expect(isGazingAtPanel(yawQuat(panelYaw), panelYaw, FRONT)).toBe(true);
    expect(isGazingAtPanel(yawQuat(-panelYaw), panelYaw, FRONT)).toBe(false);
  });

  it("板の背を向いていれば注視でない", () => {
    expect(isGazingAtPanel(yawQuat(Math.PI), 0, FRONT)).toBe(false);
  });

  it("板が目の高さより上にある時は，見上げた方向で判定する", () => {
    const raised: Vec3 = { x: 0, y: 1, z: -1 }; // 45° 上
    const yawed = multiplyQuat(yawQuat(30 * DEG), pitchQuat(45 * DEG));
    expect(isGazingAtPanel(pitchQuat(45 * DEG), 0, raised)).toBe(true);
    expect(isGazingAtPanel(IDENTITY, 0, raised)).toBe(false);
    expect(isGazingAtPanel(yawed, 30 * DEG, raised)).toBe(true);
  });

  it("ロビーの指示の板（LOBBY_PANEL_CENTER）の中心を見上げれば注視，大きく横を向けば注視でない", () => {
    const elevation = Math.atan2(LOBBY_PANEL_CENTER.y, -LOBBY_PANEL_CENTER.z);
    expect(isGazingAtPanel(pitchQuat(elevation), 0, LOBBY_PANEL_CENTER)).toBe(true);
    const turned = multiplyQuat(yawQuat(30 * DEG), pitchQuat(elevation));
    expect(isGazingAtPanel(turned, 0, LOBBY_PANEL_CENTER)).toBe(false);
    expect(isGazingAtPanel(turned, 30 * DEG, LOBBY_PANEL_CENTER)).toBe(true);
  });

  it("許容の角度を指定できる", () => {
    expect(isGazingAtPanel(yawQuat(20 * DEG), 0, FRONT, 25 * DEG)).toBe(true);
    expect(isGazingAtPanel(yawQuat(5 * DEG), 0, FRONT, 3 * DEG)).toBe(false);
  });

  it("板の中心が目の位置と同じ（長さ 0）なら注視でない", () => {
    expect(isGazingAtPanel(IDENTITY, 0, { x: 0, y: 0, z: 0 })).toBe(false);
  });

  it.each([Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY])(
    "板のヨー角が %d なら注視でない",
    (yaw) => {
      expect(isGazingAtPanel(IDENTITY, yaw, FRONT)).toBe(false);
    },
  );
});

describe("approachHighlight", () => {
  it("注視していれば 1 へ，していなければ 0 へ近づく", () => {
    const up = approachHighlight(0.5, true, 0.0625);
    const down = approachHighlight(0.5, false, 0.0625);
    expect(up).toBeGreaterThan(0.5);
    expect(up).toBeLessThanOrEqual(1);
    expect(down).toBeLessThan(0.5);
    expect(down).toBeGreaterThanOrEqual(0);
  });

  it("1 フレームで目標との差の dt × rate だけ近づく", () => {
    expect(approachHighlight(0, true, 0.0625)).toBeCloseTo(0.25);
    expect(approachHighlight(1, false, 0.0625)).toBeCloseTo(0.75);
    expect(approachHighlight(0, true, 0.1, 2)).toBeCloseTo(0.2);
  });

  it("dt × rate が 1 以上なら目標に着き，行き過ぎない", () => {
    expect(approachHighlight(0, true, 0.25)).toBeCloseTo(1);
    expect(approachHighlight(0.3, true, 10)).toBeCloseTo(1);
    expect(approachHighlight(0.7, false, 10)).toBeCloseTo(0);
  });

  it("注視を続けると単調に 1 へ近づき，1 を超えない", () => {
    let h = 0;
    let prev = -1;
    for (let i = 0; i < 120; i++) {
      h = approachHighlight(h, true, 1 / 60);
      expect(h).toBeGreaterThan(prev);
      expect(h).toBeLessThanOrEqual(1);
      prev = h;
    }
    expect(h).toBeGreaterThan(0.99);
  });

  it("目標に着いていれば変わらない", () => {
    expect(approachHighlight(1, true, 0.1)).toBe(1);
    expect(approachHighlight(0, false, 0.1)).toBe(0);
  });

  it("範囲外の今の値は 0〜1 に収めてから近づける", () => {
    expect(approachHighlight(5, true, 0)).toBe(1);
    expect(approachHighlight(-3, false, 0)).toBe(0);
    const v = approachHighlight(5, false, 0.0625);
    expect(v).toBeCloseTo(0.75);
  });

  it("今の値が有限でなければ 0 から始める", () => {
    expect(approachHighlight(Number.NaN, false, 0.1)).toBe(0);
    expect(approachHighlight(Number.NaN, true, 0.0625)).toBeCloseTo(0.25);
    expect(approachHighlight(Number.POSITIVE_INFINITY, true, 0)).toBe(0);
  });

  it.each([0, -0.1, Number.NaN, Number.NEGATIVE_INFINITY])("dt が %d の時は変化させない", (dt) => {
    expect(approachHighlight(0.4, true, dt)).toBeCloseTo(0.4);
    expect(approachHighlight(0.4, false, dt)).toBeCloseTo(0.4);
  });

  it("結果は常に 0〜1", () => {
    for (const current of [-1, 0, 0.3, 1, 2, Number.NaN]) {
      for (const dt of [-1, 0, 0.01, 0.5, 100, Number.NaN, Number.POSITIVE_INFINITY]) {
        for (const gazing of [true, false]) {
          const v = approachHighlight(current, gazing, dt);
          expect(v).toBeGreaterThanOrEqual(0);
          expect(v).toBeLessThanOrEqual(1);
        }
      }
    }
  });
});
