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

/** モックの手の操作を受ける要素（800x600．ポインターの捕捉は何もしない） */
function fakeMouseTarget() {
  const captured = new Set<number>();
  return Object.assign(fakeElement(), {
    getBoundingClientRect: () => ({ left: 0, top: 0, width: 800, height: 600 }),
    setPointerCapture: (id: number) => captured.add(id),
    hasPointerCapture: (id: number) => captured.has(id),
    releasePointerCapture: (id: number) => captured.delete(id),
  }) as unknown as HTMLElement;
}

function pointer(type: string, o: Record<string, unknown> = {}): Event {
  return Object.assign(new Event(type), {
    pointerType: "mouse",
    pointerId: 1,
    clientX: 400,
    clientY: 300,
    button: -1,
    buttons: 0,
    ...o,
  });
}

function key(type: string, code: string): Event {
  return Object.assign(new Event(type), {
    code,
    repeat: false,
    ctrlKey: false,
    metaKey: false,
    altKey: false,
    preventDefault: () => undefined,
  });
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
  it("device: カメラを渡していなければ手は UNTRACKED_HAND，サンプルが無ければ止まって立つ", () => {
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

  it("mock: マウスを動かすと右手が目の前に出て（左手は未認識），画面の外に出ると未認識に戻る", () => {
    const target = fakeMouseTarget();
    const src = createInputSource({ kind: "mock", params: TEST_PARAMS, target });
    target.dispatchEvent(pointer("pointermove", { clientX: 400, clientY: 300 }));
    const input = src.read(16);
    expect(input.hands.left).toEqual(UNTRACKED_HAND);
    expect(input.hands.right.tracked).toBe(true);
    expect(input.hands.right.position.x).toBeCloseTo(0, 9);
    expect(input.hands.right.position.y).toBeCloseTo(0, 9);
    expect(input.hands.right.position.z).toBeCloseTo(-0.45, 9);
    expect(input.hands.right.grip).toBe(0);

    target.dispatchEvent(pointer("pointermove", { clientX: 700, clientY: 100 }));
    const moved = src.read(32).hands.right.position;
    expect(moved.x).toBeGreaterThan(0);
    expect(moved.y).toBeGreaterThan(0);

    target.dispatchEvent(pointer("pointerleave"));
    expect(src.read(48).hands).toEqual({ left: UNTRACKED_HAND, right: UNTRACKED_HAND });
    src.dispose();
  });

  it("mock: 右ボタンか F キーを押している間は右手が握る（grip: 1）", () => {
    vi.stubGlobal("HTMLElement", class {});
    const target = fakeMouseTarget();
    const src = createInputSource({ kind: "mock", params: TEST_PARAMS, target });
    target.dispatchEvent(pointer("pointermove"));
    target.dispatchEvent(pointer("pointerdown", { button: 2, buttons: 2 }));
    expect(src.read(16).hands.right.grip).toBe(1);
    target.dispatchEvent(pointer("pointerup", { button: 2, buttons: 0 }));
    expect(src.read(32).hands.right.grip).toBe(0);

    windowTarget.dispatchEvent(key("keydown", "KeyF"));
    expect(src.read(48).hands.right.grip).toBe(1);
    windowTarget.dispatchEvent(key("keyup", "KeyF"));
    expect(src.read(64).hands.right.grip).toBe(0);
    src.dispose();
  });

  it("mock: ホイールで右手の奥行きが変わる", () => {
    const target = fakeMouseTarget();
    const src = createInputSource({ kind: "mock", params: TEST_PARAMS, target });
    target.dispatchEvent(pointer("pointermove"));
    target.dispatchEvent(Object.assign(new Event("wheel"), { deltaY: -200 }));
    expect(src.read(16).hands.right.position.z).toBeCloseTo(-0.55, 9);
    src.dispose();
  });

  it("mock・device: attachCamera は例外を出さない（mock では手は変わらない）", () => {
    const mock = createInputSource({ kind: "mock", params: TEST_PARAMS, target: fakeElement() });
    expect(() => mock.attachCamera(null)).not.toThrow();
    expect(mock.read(0).hands).toEqual({ left: UNTRACKED_HAND, right: UNTRACKED_HAND });
    mock.dispose();
    const device = createInputSource({ kind: "device", params: TEST_PARAMS });
    expect(() => device.attachCamera(null)).not.toThrow();
    expect(device.read(0).hands).toEqual({ left: UNTRACKED_HAND, right: UNTRACKED_HAND });
    device.dispose();
  });

  it("replay: 許可は要らず，記録を読み込むまでは止まって立ち，読み込むと判定の中身（tracker）が出る", async () => {
    const motion = (t: number) =>
      JSON.stringify({
        type: "motion",
        t,
        acc: [0, 0, 0],
        accG: [0, 9.81, 0],
        rot: [0, 0, 0],
        interval: 16,
      });
    const src = createInputSource({
      kind: "replay",
      params: TEST_PARAMS,
      replay: { text: `${motion(0)}\n${motion(16)}\n`, loop: false },
    });
    expect(src.kind).toBe("replay");
    await expect(src.activate()).resolves.toEqual({
      motion: "not-required",
      orientation: "not-required",
    });
    expect(src.read(5)).toMatchObject({
      time: 5,
      posture: "standing",
      walking: false,
      walkSpeed: 0,
    });
    await vi.waitFor(() => expect(src.tracker).not.toBeNull());
    const input = src.read(100);
    expect(input).toMatchObject({ time: 100, posture: "standing", walking: false });
    expect(input.hands).toEqual({ left: UNTRACKED_HAND, right: UNTRACKED_HAND });
    expect(() => src.recenter()).not.toThrow();
    src.dispose();
  });
});
