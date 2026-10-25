// 手で押すボタンの部品（Issue #145）．置き場所・中身の表示・押した時の処理の呼ばれ方を確かめる（描画結果は見ない）．
// 文字は canvas で描くため，node 環境では document を何もしない canvas に差し替える

import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { Handedness, HandState, Quat } from "../../core/types";
import { createHandButton, type HandButtonFrame } from "./handButton";

/** 何もしない 2D コンテキスト（measureText は幅 0 を返す） */
function fakeContext(): CanvasRenderingContext2D {
  const store: Record<string | symbol, unknown> = {};
  const noopResult = { width: 0 };
  return new Proxy(store, {
    get: (target, prop) => (prop in target ? target[prop] : () => noopResult),
    set: (target, prop, value) => {
      target[prop] = value;
      return true;
    },
  }) as unknown as CanvasRenderingContext2D;
}

beforeAll(() => {
  vi.stubGlobal("document", {
    createElement: (tag: string) => {
      if (tag !== "canvas") throw new Error(`unexpected element: ${tag}`);
      const ctx = fakeContext();
      return { width: 0, height: 0, getContext: () => ctx };
    },
  });
});

afterAll(() => {
  vi.unstubAllGlobals();
});

const IDENTITY: Quat = { x: 0, y: 0, z: 0, w: 1 };
const UNTRACKED: HandState = { tracked: false, position: { x: 0, y: 0, z: 0 }, grip: 0 };
const onButton: HandState = { tracked: true, position: { x: 0, y: 0, z: -0.5 }, grip: 0 };

const frame = (right: HandState, overrides: Partial<HandButtonFrame> = {}): HandButtonFrame => {
  const hands: Record<Handedness, HandState> = { left: UNTRACKED, right };
  return { head: IDENTITY, hands, dt: 0.25, ...overrides };
};

describe("createHandButton", () => {
  it("渡した位置に置き，丸・リング・進み具合・文字を持つ", () => {
    const button = createHandButton({ position: { x: 0.1, y: -0.2, z: -0.5 }, label: "準備OK" });
    expect(button.object.name).toBe("hand-button");
    expect(button.object.position.toArray()).toEqual([0.1, -0.2, -0.5]);
    expect(button.object.getObjectByName("hand-button-progress")).toBeDefined();
    expect(button.object.getObjectByName("hand-button-label")).toBeDefined();
    button.dispose();
  });

  it("文字を省くと文字の板を作らない", () => {
    const button = createHandButton({ position: { x: 0, y: 0, z: -0.5 } });
    expect(button.object.getObjectByName("hand-button-label")).toBeUndefined();
    button.dispose();
  });

  it("かざし続けたら押した扱いになり，onPress を 1 回だけ呼ぶ", () => {
    const onPress = vi.fn();
    const button = createHandButton({ position: { x: 0, y: 0, z: -0.5 }, onPress });
    for (let i = 0; i < 3; i++) expect(button.update(frame(onButton))).toBe(false);
    expect(button.update(frame(onButton))).toBe(true);
    expect(button.update(frame(onButton))).toBe(true);
    expect(onPress).toHaveBeenCalledTimes(1);
    expect(onPress).toHaveBeenCalledWith("hand");
    button.dispose();
  });

  it("手を出さなければ時間がたっても押さない", () => {
    const button = createHandButton({ position: { x: 0, y: 0, z: -0.5 } });
    for (let i = 0; i < 100; i++) button.update(frame(UNTRACKED));
    expect(button.isPressed()).toBe(false);
    button.dispose();
  });

  it("親のヨー角を渡すと，回した先のボタンで判定する", () => {
    const button = createHandButton({ position: { x: 0, y: 0, z: -0.5 } });
    // 親が左へ 90° 回っている（ボタンは左）ので，正面の手では押せない
    for (let i = 0; i < 8; i++) button.update(frame(onButton, { parentYaw: Math.PI / 2 }));
    expect(button.isPressed()).toBe(false);
    button.dispose();
  });

  it("押せるようになるまで中身を隠し，押した後も隠す", () => {
    const button = createHandButton({
      position: { x: 0, y: 0, z: -0.5 },
      config: { armSeconds: 0.5 },
    });
    const body = button.object.getObjectByName("hand-button-body");
    expect(body?.visible).toBe(false);
    button.update(frame(UNTRACKED));
    button.update(frame(UNTRACKED));
    button.update(frame(UNTRACKED));
    expect(body?.visible).toBe(true);
    button.press();
    expect(body?.visible).toBe(false);
    // 出す・隠すを画面の側で決める object.visible には触れない
    expect(button.object.visible).toBe(true);
    button.dispose();
  });

  it("press() で押した扱いになり onPress に manual を渡す．reset() で押す前に戻る", () => {
    const onPress = vi.fn();
    const button = createHandButton({ position: { x: 0, y: 0, z: -0.5 }, onPress });
    button.press();
    button.press();
    expect(button.isPressed()).toBe(true);
    expect(onPress).toHaveBeenCalledTimes(1);
    expect(onPress).toHaveBeenCalledWith("manual");
    button.reset();
    expect(button.isPressed()).toBe(false);
    button.press();
    expect(onPress).toHaveBeenCalledTimes(2);
    button.dispose();
  });
});
