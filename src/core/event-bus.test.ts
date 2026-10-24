// イベントバスの契約（docs/04_SPEC/SPEC_01「受け渡すデータ」）のテスト
import { describe, expect, it, vi } from "vitest";
import { createEventBus } from "./event-bus";
import type { AppEvent } from "./events";

const touched: AppEvent = { type: "objectTouched", objectId: "exit-door", hand: "right" };
const signal: AppEvent = { type: "signal", name: "door-opened" };

describe("createEventBus", () => {
  it("on で購読した種類のイベントだけを受け取る", () => {
    const bus = createEventBus<AppEvent>();
    const onTouched = vi.fn();
    const onSignal = vi.fn();
    bus.on("objectTouched", onTouched);
    bus.on("signal", onSignal);

    bus.emit(touched);

    expect(onTouched).toHaveBeenCalledTimes(1);
    expect(onTouched).toHaveBeenCalledWith(touched);
    expect(onSignal).not.toHaveBeenCalled();
  });

  it("同じ種類に複数の購読者がいれば全員が受け取る", () => {
    const bus = createEventBus<AppEvent>();
    const a = vi.fn();
    const b = vi.fn();
    bus.on("signal", a);
    bus.on("signal", b);

    bus.emit(signal);

    expect(a).toHaveBeenCalledTimes(1);
    expect(b).toHaveBeenCalledTimes(1);
  });

  it("購読者がいない種類を emit してもエラーにならない", () => {
    const bus = createEventBus<AppEvent>();
    expect(() => bus.emit(signal)).not.toThrow();
  });

  it("onAny はすべての種類のイベントを受け取る", () => {
    const bus = createEventBus<AppEvent>();
    const any = vi.fn();
    bus.onAny(any);

    bus.emit(touched);
    bus.emit(signal);
    bus.emit({ type: "stepEntered", stepId: "intro" });

    expect(any).toHaveBeenCalledTimes(3);
    expect(any).toHaveBeenNthCalledWith(1, touched);
    expect(any).toHaveBeenNthCalledWith(2, signal);
  });

  it("on の戻り値を呼ぶと以降は受け取らない", () => {
    const bus = createEventBus<AppEvent>();
    const handler = vi.fn();
    const off = bus.on("signal", handler);

    bus.emit(signal);
    off();
    bus.emit(signal);

    expect(handler).toHaveBeenCalledTimes(1);
  });

  it("onAny の戻り値を呼ぶと以降は受け取らない", () => {
    const bus = createEventBus<AppEvent>();
    const handler = vi.fn();
    const off = bus.onAny(handler);

    bus.emit(signal);
    off();
    bus.emit(signal);

    expect(handler).toHaveBeenCalledTimes(1);
  });

  it("購読の解除を 2 回呼んでもエラーにならず，他の購読者に影響しない", () => {
    const bus = createEventBus<AppEvent>();
    const a = vi.fn();
    const b = vi.fn();
    const offA = bus.on("signal", a);
    bus.on("signal", b);

    offA();
    expect(() => offA()).not.toThrow();
    bus.emit(signal);

    expect(a).not.toHaveBeenCalled();
    expect(b).toHaveBeenCalledTimes(1);
  });

  it("clear するとすべての購読（on・onAny）がなくなる", () => {
    const bus = createEventBus<AppEvent>();
    const handler = vi.fn();
    const any = vi.fn();
    bus.on("signal", handler);
    bus.onAny(any);

    bus.clear();
    bus.emit(signal);

    expect(handler).not.toHaveBeenCalled();
    expect(any).not.toHaveBeenCalled();
  });

  it("clear の後に購読し直せば受け取れる．古い解除関数を呼んでも新しい購読は残る", () => {
    const bus = createEventBus<AppEvent>();
    const handler = vi.fn();
    const oldOff = bus.on("signal", handler);
    bus.clear();
    bus.on("signal", handler);

    expect(() => oldOff()).not.toThrow();
    bus.emit(signal);

    expect(handler).toHaveBeenCalledTimes(1);
  });

  describe("処理の途中で購読を変えても安全", () => {
    it("ハンドラーが自分自身の購読を外しても，同じ emit の他の購読者は呼ばれる", () => {
      const bus = createEventBus<AppEvent>();
      const calls: string[] = [];
      const offA = bus.on("signal", () => {
        calls.push("a");
        offA();
      });
      bus.on("signal", () => calls.push("b"));
      bus.on("signal", () => calls.push("c"));

      expect(() => bus.emit(signal)).not.toThrow();
      expect(calls).toEqual(["a", "b", "c"]);

      calls.length = 0;
      bus.emit(signal);
      expect(calls).toEqual(["b", "c"]);
    });

    it("ハンドラーが後ろの購読者を外しても，その emit の他の購読者は飛ばされず，次の emit からは外れる", () => {
      const bus = createEventBus<AppEvent>();
      const calls: string[] = [];
      bus.on("signal", () => {
        calls.push("a");
        offB();
      });
      const offB = bus.on("signal", () => calls.push("b"));
      bus.on("signal", () => calls.push("c"));

      expect(() => bus.emit(signal)).not.toThrow();
      expect(calls).toContain("a");
      expect(calls).toContain("c");

      calls.length = 0;
      bus.emit(signal);
      expect(calls).toEqual(["a", "c"]);
    });

    it("onAny のハンドラーが処理中に購読を外しても安全", () => {
      const bus = createEventBus<AppEvent>();
      const calls: string[] = [];
      const offA = bus.onAny(() => {
        calls.push("a");
        offA();
      });
      bus.onAny(() => calls.push("b"));

      expect(() => bus.emit(signal)).not.toThrow();
      expect(calls).toEqual(["a", "b"]);
      calls.length = 0;
      bus.emit(signal);
      expect(calls).toEqual(["b"]);
    });

    it("処理中に購読を足しても無限に呼ばれず，次の emit から受け取る", () => {
      const bus = createEventBus<AppEvent>();
      const added = vi.fn();
      let count = 0;
      bus.on("signal", () => {
        count += 1;
        bus.on("signal", added);
      });

      bus.emit(signal);
      expect(count).toBe(1);
      expect(added).not.toHaveBeenCalled();

      bus.emit(signal);
      expect(added).toHaveBeenCalledTimes(1);
    });

    it("処理中に clear しても例外にならない", () => {
      const bus = createEventBus<AppEvent>();
      const later = vi.fn();
      bus.on("signal", () => bus.clear());
      bus.on("signal", later);

      expect(() => bus.emit(signal)).not.toThrow();
      later.mockClear();
      bus.emit(signal);
      expect(later).not.toHaveBeenCalled();
    });

    it("ハンドラーの中で別のイベントを emit できる", () => {
      const bus = createEventBus<AppEvent>();
      const onSignal = vi.fn();
      bus.on("objectTouched", () => bus.emit(signal));
      bus.on("signal", onSignal);

      bus.emit(touched);

      expect(onSignal).toHaveBeenCalledWith(signal);
    });
  });
});
