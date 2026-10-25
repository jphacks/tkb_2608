import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { InputSource } from "./input/inputSource";
import { InputPreview } from "./inputPreview";

// テストは node で動くため，InputPreview が使う document・window だけを EventTarget で代わりにする
function stubDom(): { body: EventTarget } {
  const body = Object.assign(new EventTarget(), { appendChild: () => undefined });
  vi.stubGlobal("window", new EventTarget());
  vi.stubGlobal("document", {
    body,
    createElement: () => ({ style: {}, textContent: "", remove: () => undefined }),
  });
  return { body };
}

function inputSource(kind: InputSource["kind"] = "device"): InputSource {
  return {
    kind,
    tracker: null,
    read: vi.fn(),
    activate: vi.fn(async () => ({ motion: "granted", orientation: "granted" }) as const),
    recenter: vi.fn(),
    attachCamera: vi.fn(),
    dispose: vi.fn(),
  };
}

function tap(target: EventTarget): void {
  target.dispatchEvent(new Event("click"));
}

describe("InputPreview", () => {
  beforeEach(() => {
    // カメラの取得は navigator が無いので null で返る
    vi.stubGlobal("navigator", undefined);
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("device: tapTarget へのタップでセンサーの許可を求める（iOS は window まで click が届かないため）", () => {
    stubDom();
    const canvas = new EventTarget() as HTMLElement;
    const input = inputSource();
    const preview = new InputPreview(input, { tapTarget: canvas });
    tap(canvas);
    expect(input.activate).toHaveBeenCalledTimes(1);
    preview.dispose();
  });

  it("device: tapTarget を省くと document.body へのタップで許可を求める", () => {
    const { body } = stubDom();
    const input = inputSource();
    const preview = new InputPreview(input);
    tap(body);
    expect(input.activate).toHaveBeenCalledTimes(1);
    preview.dispose();
  });

  it("dispose の後はタップしても許可を求めない", () => {
    stubDom();
    const canvas = new EventTarget() as HTMLElement;
    const input = inputSource();
    new InputPreview(input, { tapTarget: canvas }).dispose();
    tap(canvas);
    expect(input.activate).not.toHaveBeenCalled();
  });

  it("mock: タップしても許可を求めない", () => {
    stubDom();
    const canvas = new EventTarget() as HTMLElement;
    const input = inputSource("mock");
    const preview = new InputPreview(input, { tapTarget: canvas });
    tap(canvas);
    expect(input.activate).not.toHaveBeenCalled();
    preview.dispose();
  });
});
