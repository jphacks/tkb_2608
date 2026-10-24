// 入力の入口の形（device・mock で同じ口．ブラウザのグローバルを差し替えて確かめる）
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { UNTRACKED_HAND } from "../core/types";
import { createInputSource } from "./inputSource";
import { TEST_PARAMS } from "./testFixtures";

let windowTarget: EventTarget;
let documentTarget: EventTarget;

function fakeElement() {
  const t = new EventTarget() as EventTarget & Record<string, unknown>;
  t.style = {};
  return t as unknown as HTMLElement;
}

beforeEach(() => {
  windowTarget = new EventTarget();
  documentTarget = new EventTarget();
  vi.stubGlobal("window", windowTarget);
  vi.stubGlobal("document", Object.assign(documentTarget, { body: fakeElement() }));
  vi.stubGlobal("screen", {
    orientation: Object.assign(new EventTarget(), { angle: 0, type: "portrait-primary" }),
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("createInputSource", () => {
  it("device: 手は常に UNTRACKED_HAND，サンプルが無ければ止まって立つ", () => {
    const src = createInputSource({ kind: "device", params: TEST_PARAMS });
    expect(src.kind).toBe("device");
    expect(src.tracker).not.toBeNull();
    const input = src.read(100);
    expect(input).toMatchObject({ time: 100, posture: "standing", walking: false, walkSpeed: 0 });
    expect(input.hands).toEqual({ left: UNTRACKED_HAND, right: UNTRACKED_HAND });
    expect(src.tracker?.params.stepHighStanding).toBe(TEST_PARAMS.stepHighStanding);
    src.dispose();
  });

  it("device: devicemotion を受けて observer を呼び，dispose の後は受けない", () => {
    const seen: number[] = [];
    const src = createInputSource({
      kind: "device",
      params: TEST_PARAMS,
      observer: { onMotion: (s) => seen.push(s.t) },
    });
    const fire = (t: number) => {
      const e = Object.assign(new Event("devicemotion"), {
        acceleration: { x: 0, y: 0, z: 0 },
        accelerationIncludingGravity: { x: 0, y: 9.81, z: 0 },
        rotationRate: { alpha: 0, beta: 0, gamma: 0 },
        interval: 16,
      });
      Object.defineProperty(e, "timeStamp", { value: t });
      windowTarget.dispatchEvent(e);
    };
    fire(10);
    expect(seen).toEqual([10]);
    expect(src.tracker?.body.sampleCount).toBe(1);
    src.dispose();
    fire(26);
    expect(seen).toEqual([10]);
  });

  it("device: 画面が裏に回る・戻ると体の判定を初期化する", () => {
    const src = createInputSource({ kind: "device", params: TEST_PARAMS });
    const before = src.tracker?.body.resetCount ?? 0;
    documentTarget.dispatchEvent(new Event("visibilitychange"));
    expect(src.tracker?.body.resetCount).toBe(before + 1);
    src.dispose();
    documentTarget.dispatchEvent(new Event("visibilitychange"));
    expect(src.tracker?.body.resetCount).toBe(before + 1);
  });

  it("device: 許可の取得で例外が出ても denied を返す", async () => {
    vi.stubGlobal("DeviceMotionEvent", {
      requestPermission: () => {
        throw new Error("x");
      },
    });
    const src = createInputSource({ kind: "device" });
    await expect(src.activate()).resolves.toBeDefined();
    src.dispose();
  });

  it("mock: tracker は null，許可は要らない，手は UNTRACKED_HAND", async () => {
    const src = createInputSource({ kind: "mock", params: TEST_PARAMS, target: fakeElement() });
    expect(src.kind).toBe("mock");
    expect(src.tracker).toBeNull();
    await expect(src.activate()).resolves.toEqual({
      motion: "not-required",
      orientation: "not-required",
    });
    const input = src.read(0);
    expect(input.hands).toEqual({ left: UNTRACKED_HAND, right: UNTRACKED_HAND });
    expect(input).toMatchObject({ posture: "standing", walking: false, walkSpeed: 0 });
    expect(() => src.recenter()).not.toThrow();
    src.dispose();
  });
});
