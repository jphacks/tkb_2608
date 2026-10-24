// 端末と開発サーバーの時刻合わせ（experiment_山﨑/10「印の付け方」・ENV_04「記録を始めると…clock を記録する」）
import { describe, expect, it } from "vitest";
import {
  type ClockPing,
  clockOffset,
  type DeviceTimeContext,
  pickClockEstimate,
  serverTimeToDeviceT,
  toServerTime,
} from "./clockSync";

function ping(o: Partial<ClockPing> = {}): ClockPing {
  return { sendT: 100, recvT: 120, serverTime: 1_000_000, ...o };
}

describe("pickClockEstimate", () => {
  it("往復の最も速いものを選び，時刻は往復の真ん中にする", () => {
    expect(
      pickClockEstimate([
        ping({ sendT: 0, recvT: 50, serverTime: 1 }),
        ping({ sendT: 100, recvT: 110, serverTime: 2 }),
        ping({ sendT: 200, recvT: 230, serverTime: 3 }),
      ]),
    ).toEqual({ t: 105, serverTime: 2, rtt: 10 });
  });

  it("往復が同じ速さなら先のものを使う", () => {
    expect(
      pickClockEstimate([
        ping({ sendT: 0, recvT: 10, serverTime: 1 }),
        ping({ sendT: 100, recvT: 110, serverTime: 2 }),
      ])?.serverTime,
    ).toBe(1);
  });

  it("往復 0 ms も使う", () => {
    expect(pickClockEstimate([ping({ sendT: 5, recvT: 5 })])).toMatchObject({ t: 5, rtt: 0 });
  });

  it.each([
    ["送った時刻が NaN", ping({ sendT: Number.NaN })],
    ["受け取った時刻が Infinity", ping({ recvT: Number.POSITIVE_INFINITY })],
    ["開発サーバーの時刻が NaN", ping({ serverTime: Number.NaN })],
    ["受け取りが送りより前", ping({ sendT: 200, recvT: 100 })],
  ])("使えない往復（%s）は捨てる", (_, bad) => {
    expect(pickClockEstimate([bad])).toBeNull();
    expect(pickClockEstimate([bad, ping({ sendT: 0, recvT: 40 })])).toMatchObject({ rtt: 40 });
  });

  it("往復が無ければ null", () => {
    expect(pickClockEstimate([])).toBeNull();
  });
});

describe("clockOffset・toServerTime", () => {
  it("開発サーバーの時刻 = 端末の時刻 + 差", () => {
    const e = { t: 100, serverTime: 1_000_100, rtt: 10 };
    expect(clockOffset(e)).toBe(1_000_000);
    expect(toServerTime(250, e)).toBe(1_000_250);
  });
});

describe("serverTimeToDeviceT", () => {
  function ctx(o: Partial<DeviceTimeContext> = {}): DeviceTimeContext {
    return { clock: { t: 100, serverTime: 1_000_100 }, timeOrigin: 999_000, ...o };
  }

  it("時刻合わせの結果があれば使う（sync）", () => {
    expect(serverTimeToDeviceT(1_000_600, ctx())).toEqual({ t: 600, clock: "sync" });
  });

  it("時刻合わせの前は端末の壁時計（timeOrigin）で換算する（wall）", () => {
    expect(serverTimeToDeviceT(1_000_600, ctx({ clock: null }))).toEqual({
      t: 1600,
      clock: "wall",
    });
  });

  it("時刻合わせの結果が壊れていれば壁時計で換算する", () => {
    expect(
      serverTimeToDeviceT(1_000_600, ctx({ clock: { t: Number.NaN, serverTime: 1 } }))?.clock,
    ).toBe("wall");
    expect(
      serverTimeToDeviceT(1_000_600, ctx({ clock: { t: 1, serverTime: Number.POSITIVE_INFINITY } }))
        ?.clock,
    ).toBe("wall");
  });

  it.each([
    ["どちらも無い", ctx({ clock: null, timeOrigin: null })],
    ["timeOrigin が NaN", ctx({ clock: null, timeOrigin: Number.NaN })],
  ])("換算できない（%s）なら null", (_, c) => {
    expect(serverTimeToDeviceT(1_000_600, c)).toBeNull();
  });

  it.each([Number.NaN, Number.POSITIVE_INFINITY])("開発サーバーの時刻が %s なら null", (v) => {
    expect(serverTimeToDeviceT(v, ctx())).toBeNull();
  });

  it("PC で合わせた時刻を介して，PC の時刻をスマホの時刻に換算できる", () => {
    // PC は開発サーバーより 5000 ms 遅れ，スマホは 2000 ms 進んだ performance.now() の基準
    const pc = { t: 10, serverTime: 5010, rtt: 4 };
    const phone = { t: 3000, serverTime: 1000 };
    const pressedOnPc = 50;
    const r = serverTimeToDeviceT(toServerTime(pressedOnPc, pc), {
      clock: phone,
      timeOrigin: null,
    });
    expect(r).toEqual({ t: 7050, clock: "sync" });
  });
});
