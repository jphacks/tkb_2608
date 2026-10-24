import { describe, expect, it } from "vitest";
import {
  type InputRecord,
  joinJsonl,
  type MarkRecord,
  motionRecord,
  orientationRecord,
  roundTo,
  screenRecord,
  toJsonl,
  toRecordLine,
} from "./records";

describe("roundTo", () => {
  it("指定の桁に丸める", () => {
    expect(roundTo(1.23456, 3)).toBe(1.235);
    expect(roundTo(-9.80666, 4)).toBe(-9.8067);
    expect(roundTo(12, 0)).toBe(12);
  });

  it("-0 は 0 にする", () => {
    expect(Object.is(roundTo(-0, 3), 0)).toBe(true);
    expect(Object.is(roundTo(-0.00001, 3), 0)).toBe(true);
  });

  it.each([NaN, Infinity, -Infinity])("%s は null", (v) => {
    expect(roundTo(v, 3)).toBeNull();
  });
});

describe("motionRecord・orientationRecord・screenRecord", () => {
  it("motion は [x, y, z]・[alpha, beta, gamma] の配列にし，桁を丸める", () => {
    const r = motionRecord({
      t: 1234.56789,
      acc: { x: 0.123456, y: -0.00001, z: 1 },
      accG: null,
      rot: { alpha: 1.23456, beta: 2, gamma: 3 },
      interval: 16.6666,
    });
    expect(r.type).toBe("motion");
    expect(r.t).toBeCloseTo(1234.568, 6);
    expect(r.acc).toEqual([0.1235, 0, 1]);
    expect(r.accG).toBeNull();
    expect(r.rot).toEqual([1.235, 2, 3]);
    expect(r.interval).toBeCloseTo(16.667, 6);
  });

  it("motion の interval が null なら null のまま", () => {
    expect(motionRecord({ t: 0, acc: null, accG: null, rot: null, interval: null }).interval).toBe(
      null,
    );
  });

  it("orientation は取れない角度を null のまま残す", () => {
    expect(
      orientationRecord({ t: 1, alpha: null, beta: 10.12345, gamma: -0.0001, absolute: true }),
    ).toEqual({ type: "orientation", t: 1, alpha: null, beta: 10.123, gamma: 0, absolute: true });
  });

  it("screen は角度と向きの名前を残す", () => {
    expect(screenRecord({ t: 2, angle: 90, orientationType: "landscape-primary" })).toEqual({
      type: "screen",
      t: 2,
      angle: 90,
      orientationType: "landscape-primary",
    });
  });
});

describe("toRecordLine", () => {
  it("1 レコードを改行を含まない JSON の 1 行にする", () => {
    const mark: MarkRecord = { type: "mark", t: 1, kind: "1", note: "改行\nを含む" };
    const line = toRecordLine(mark);
    expect(line).not.toBeNull();
    expect(line).not.toContain("\n");
    expect(JSON.parse(line as string)).toEqual(mark);
  });

  it("NaN は null として書かれる", () => {
    const line = toRecordLine({ type: "visibility", t: NaN, state: "hidden" });
    expect(JSON.parse(line as string)).toEqual({ type: "visibility", t: null, state: "hidden" });
  });

  it("循環参照で整形できなければ null（例外を投げない）", () => {
    const extra: Record<string, unknown> = {};
    extra.self = extra;
    const meta = {
      type: "meta",
      t: 0,
      version: 1,
      sessionId: "abc",
      page: "sensors",
      startedAt: "",
      timeOrigin: 0,
      userAgent: "",
      screen: { width: 1, height: 1, dpr: 1 },
      extra,
    } as InputRecord;
    expect(() => toRecordLine(meta)).not.toThrow();
    expect(toRecordLine(meta)).toBeNull();
  });
});

describe("joinJsonl・toJsonl", () => {
  it("空なら空文字列", () => {
    expect(joinJsonl([])).toBe("");
    expect(toJsonl([])).toBe("");
  });

  it("各行の末尾に改行を付ける", () => {
    expect(joinJsonl(["{}"])).toBe("{}\n");
    expect(joinJsonl(['{"a":1}', '{"b":2}'])).toBe('{"a":1}\n{"b":2}\n');
  });

  it("整形できないレコードは飛ばす", () => {
    const cyclic: Record<string, unknown> = { type: "mark", t: 0, kind: "x" };
    cyclic.note = cyclic;
    const out = toJsonl([
      { type: "visibility", t: 1, state: "visible" },
      cyclic as unknown as InputRecord,
      { type: "visibility", t: 2, state: "hidden" },
    ]);
    const lines = out.split("\n");
    expect(lines).toHaveLength(3);
    expect(lines[2]).toBe("");
    expect(JSON.parse(lines[0]).t).toBe(1);
    expect(JSON.parse(lines[1]).t).toBe(2);
  });

  it("循環参照だけなら空文字列", () => {
    const cyclic: Record<string, unknown> = { type: "mark", t: 0, kind: "x" };
    cyclic.note = cyclic;
    expect(toJsonl([cyclic as unknown as InputRecord])).toBe("");
  });
});
