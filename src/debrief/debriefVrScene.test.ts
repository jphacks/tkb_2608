// VR の中の結果画面（debriefVrScene.ts）の組み立てと行き先のテスト．板（canvas）は node では作らないので，
// 手のボタンの数・位置・文字と，押した時・キーの時の行き先（goTo）を確かめる
import * as THREE from "three";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createEventBus } from "../core/event-bus";
import type { AppEvent } from "../core/events";
import type { SceneContext, SceneId, Session } from "../core/scene";
import type { HandState, PlayerInput, Vec3 } from "../core/types";
import { DEBRIEF_HOME_LABEL, DEBRIEF_RETRY_LABEL } from "./debriefScene";
import { DEBRIEF_BUTTONS } from "./debriefVrLayout";
import { createDebriefVrScene, type DebriefHandButton, isDebriefVrScene } from "./debriefVrScene";

interface FakeButton extends DebriefHandButton {
  readonly position: Vec3;
  readonly label: string | undefined;
  readonly armSeconds: number | undefined;
  pressed: boolean;
  disposed: boolean;
}

function fakeButtonFactory() {
  const made: FakeButton[] = [];
  const create = (options: {
    readonly position: Vec3;
    readonly label?: string;
    readonly config?: { readonly armSeconds?: number };
  }): DebriefHandButton => {
    const button: FakeButton = {
      object: new THREE.Object3D(),
      position: options.position,
      label: options.label,
      armSeconds: options.config?.armSeconds,
      pressed: false,
      disposed: false,
      update() {
        return button.pressed;
      },
      press() {
        button.pressed = true;
      },
      dispose() {
        button.disposed = true;
      },
    };
    made.push(button);
    return button;
  };
  return { made, create };
}

const HAND: HandState = { tracked: false, position: { x: 0, y: 0, z: 0 }, grip: 0 };

function frameInput(): PlayerInput {
  return {
    time: 0,
    head: { x: 0, y: 0, z: 0, w: 1 },
    posture: "standing",
    walking: false,
    walkSpeed: 0,
    hands: { left: HAND, right: HAND },
  };
}

function context() {
  const goTo = vi.fn<(next: SceneId) => void>();
  const session: Session = {
    calibration: null,
    result: null,
    recording: null,
    plan: null,
    planLoadError: null,
    drill: null,
  };
  const world = new THREE.Scene();
  const rig = new THREE.Object3D();
  const ctx: SceneContext = {
    bus: createEventBus<AppEvent>(),
    // 結果画面（VR）は HTML の要素を使わない（タップでスマホの画面に切り替えた時だけ使う）
    stage: { world, rig, overlay: {} as unknown as HTMLElement },
    session,
    goTo,
  };
  return { ctx, goTo, world };
}

let windowTarget: EventTarget;

beforeEach(() => {
  windowTarget = new EventTarget();
  vi.stubGlobal("window", windowTarget);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

function pressKey(key: string): void {
  const event = new Event("keydown");
  Object.defineProperty(event, "key", { value: key });
  windowTarget.dispatchEvent(event);
}

describe("createDebriefVrScene", () => {
  it("左右 2 画面で描く結果画面として見分けられる", () => {
    const scene = createDebriefVrScene();
    expect(scene.id).toBe("debrief");
    expect(scene.stereo()).toBe(true);
    expect(isDebriefVrScene(scene)).toBe(true);
    expect(isDebriefVrScene({ id: "debrief", enter() {}, update() {}, exit() {} })).toBe(false);
  });

  it("手のボタンを 2 つ，決めた位置と文字で出す", () => {
    const { made, create } = fakeButtonFactory();
    const { ctx, world } = context();
    const scene = createDebriefVrScene({ createHandButton: create });
    scene.enter(ctx);
    expect(made.map((b) => b.label)).toEqual([DEBRIEF_RETRY_LABEL, DEBRIEF_HOME_LABEL]);
    expect(made.map((b) => b.position)).toEqual(DEBRIEF_BUTTONS.map((b) => b.position));
    expect(made.every((b) => (b.armSeconds ?? 0) > 0)).toBe(true);
    expect(world.getObjectByName("debrief-vr")).toBeDefined();
    scene.exit();
    expect(made.every((b) => b.disposed)).toBe(true);
    expect(world.getObjectByName("debrief-vr")).toBeUndefined();
  });

  it.each([
    [0, "lobby"],
    [1, "home"],
  ] as const)("%i 番目のボタンを押すと %s へ進む（1 回だけ）", (index, target) => {
    const { made, create } = fakeButtonFactory();
    const { ctx, goTo } = context();
    const scene = createDebriefVrScene({ createHandButton: create });
    scene.enter(ctx);
    scene.update({ dt: 0.1, input: frameInput() });
    expect(goTo).not.toHaveBeenCalled();
    made[index]?.press();
    scene.update({ dt: 0.1, input: frameInput() });
    scene.update({ dt: 0.1, input: frameInput() });
    expect(goTo).toHaveBeenCalledTimes(1);
    expect(goTo).toHaveBeenCalledWith(target);
    scene.exit();
  });

  it.each([
    ["Enter", "lobby"],
    [" ", "lobby"],
    ["Escape", "home"],
  ])("キー %j で %s へ進む（手が使えない時も）", (key, target) => {
    const { made, create } = fakeButtonFactory();
    const { ctx, goTo } = context();
    const scene = createDebriefVrScene({ createHandButton: create, handsUsable: () => false });
    scene.enter(ctx);
    expect(made).toHaveLength(0);
    pressKey(key);
    pressKey(key);
    expect(goTo).toHaveBeenCalledTimes(1);
    expect(goTo).toHaveBeenCalledWith(target);
    scene.exit();
  });

  it("画面を出た後はキーで進まない", () => {
    const { ctx, goTo } = context();
    const scene = createDebriefVrScene();
    scene.enter(ctx);
    scene.exit();
    pressKey("Enter");
    expect(goTo).not.toHaveBeenCalled();
  });
});
