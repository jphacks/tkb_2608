// 認識した手の左右の振り分け（背面カメラでは MediaPipe の左右が逆．同じ側が 2 つなら位置で決める）
import { describe, expect, it } from "vitest";
import { assignHands } from "./handedness";
import { observation } from "./testHands";

describe("assignHands", () => {
  it("手が無ければ空", () => {
    expect(assignHands([], false)).toEqual({});
  });

  it.each([
    ["left", false, "right"],
    ["right", false, "left"],
    ["left", true, "left"],
    ["right", true, "right"],
  ] as const)("MediaPipe の %s は，左右反転 %s の画像では %s の手", (label, mirrored, side) => {
    const h = observation({ label });
    expect(assignHands([h], mirrored)).toEqual({ [side]: h });
  });

  it("背面カメラで左右が違う 2 つはそれぞれの側（逆にして）に振り分ける", () => {
    const a = observation({ label: "left", cx: 0.7 });
    const b = observation({ label: "right", cx: 0.3 });
    expect(assignHands([a, b], false)).toEqual({ right: a, left: b });
  });

  it("背面カメラで同じ側の 2 つは，画像の右にある方を右手にする", () => {
    const onRight = observation({ label: "left", cx: 0.75 });
    const onLeft = observation({ label: "left", cx: 0.25 });
    expect(assignHands([onLeft, onRight], false)).toEqual({ right: onRight, left: onLeft });
    expect(assignHands([onRight, onLeft], false)).toEqual({ right: onRight, left: onLeft });
  });

  it("左右反転した画像で同じ側の 2 つは，画像の左にある方を右手にする", () => {
    const onRight = observation({ label: "right", cx: 0.75 });
    const onLeft = observation({ label: "right", cx: 0.25 });
    expect(assignHands([onLeft, onRight], true)).toEqual({ right: onLeft, left: onRight });
  });

  it("点が 21 個より少ない手は数えない", () => {
    const broken = {
      ...observation({ label: "left" }),
      landmarks: observation().landmarks.slice(0, 10),
    };
    const ok = observation({ label: "right" });
    expect(assignHands([broken, ok], false)).toEqual({ left: ok });
    expect(assignHands([broken], false)).toEqual({});
  });

  it("3 つ以上あっても最初の 2 つだけを使う", () => {
    const a = observation({ label: "left" });
    const b = observation({ label: "right" });
    const c = observation({ label: "right", cx: 0.9 });
    expect(assignHands([a, b, c], false)).toEqual({ right: a, left: b });
  });
});
