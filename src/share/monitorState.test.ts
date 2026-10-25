// writeMonitorState・readMonitorState・isNewerMonitorSeq の最小限のテスト．
// 基準は docs/04_SPEC/SPEC_01「見守り」の段階 1「状態」（20 バイト．リトルエンディアン）
import { describe, expect, it } from "vitest";
import {
  isNewerMonitorSeq,
  MONITOR_STATE_BYTES,
  type MonitorState,
  nextMonitorSeq,
  readMonitorState,
  writeMonitorState,
} from "./monitorState";

const state = (overrides: Partial<MonitorState> = {}): MonitorState => ({
  studentId: 3141592653,
  seq: 7,
  floor: 1,
  posture: "crouching",
  t: 12.5,
  x: 3.21,
  z: -4.56,
  yaw: 1,
  pitch: -0.3,
  ...overrides,
});

const encode = (s: MonitorState): ArrayBuffer => {
  const buffer = new ArrayBuffer(MONITOR_STATE_BYTES);
  expect(writeMonitorState(new DataView(buffer), s)).toBe(true);
  return buffer;
};

describe("writeMonitorState・readMonitorState", () => {
  it("書いて読むと元に戻る（位置は cm，向きは π/32768 rad の精度）", () => {
    const back = readMonitorState(encode(state()), 2);
    expect(back).not.toBeNull();
    expect(back?.studentId).toBe(3141592653);
    expect(back?.seq).toBe(7);
    expect(back?.floor).toBe(1);
    expect(back?.posture).toBe("crouching");
    expect(back?.t).toBeCloseTo(12.5, 5);
    expect(back?.x).toBeCloseTo(3.21, 5);
    expect(back?.z).toBeCloseTo(-4.56, 5);
    expect(back?.yaw).toBeCloseTo(1, 4);
    expect(back?.pitch).toBeCloseTo(-0.3, 4);
  });

  it("範囲の外の値は収める", () => {
    const back = readMonitorState(
      encode(state({ x: 1000, z: -1000, yaw: Math.PI, pitch: 3, seq: 65536 })),
      2,
    );
    expect(back?.x).toBe(327.67);
    expect(back?.z).toBe(-327.68);
    expect(back?.yaw).toBeCloseTo(-Math.PI, 6);
    expect(back?.pitch).toBeCloseTo(Math.PI / 2, 6);
    expect(back?.seq).toBe(0);
  });

  it("有限でない値は書かずに false", () => {
    const buffer = new ArrayBuffer(MONITOR_STATE_BYTES);
    expect(writeMonitorState(new DataView(buffer), state({ x: Number.NaN }))).toBe(false);
    expect(new Uint8Array(buffer).every((b) => b === 0)).toBe(true);
  });

  it("長さの違うもの・studentId が 0・floor が階の数以上のものは null", () => {
    expect(readMonitorState(new ArrayBuffer(19), 2)).toBeNull();
    expect(readMonitorState(new Uint8Array(MONITOR_STATE_BYTES), 2)).toBeNull();
    expect(readMonitorState(encode(state({ floor: 1 })), 1)).toBeNull();
  });
});

describe("isNewerMonitorSeq", () => {
  it.each<[number, number, boolean]>([
    [1, 0, true],
    [0, 65535, true],
    [32767, 0, true],
    [32768, 0, false],
    [5, 5, false],
    [4, 5, false],
  ])("seq %i・直前 %i は %s", (seq, last, expected) => {
    expect(isNewerMonitorSeq(seq, last)).toBe(expected);
  });

  it("65535 の次は 0", () => {
    expect(nextMonitorSeq(65535)).toBe(0);
  });
});

// ---- 以下は tester が足した境界値・エラーパス（仕様: SPEC_01「見守り」段階 1「状態」の表と箇条書き） ----

const UNIT = Math.PI / 32768;

/** 仕様の表どおりに 20 バイトを手で組む（writeMonitorState を使わずに読む側を確かめる） */
function rawState(fields: {
  studentId?: number;
  seq?: number;
  floor?: number;
  posture?: number;
  t?: number;
  x?: number;
  z?: number;
  yaw?: number;
  pitch?: number;
}): ArrayBuffer {
  const buffer = new ArrayBuffer(MONITOR_STATE_BYTES);
  const view = new DataView(buffer);
  view.setUint32(0, fields.studentId ?? 1, true);
  view.setUint16(4, fields.seq ?? 0, true);
  view.setUint8(6, fields.floor ?? 0);
  view.setUint8(7, fields.posture ?? 0);
  view.setFloat32(8, fields.t ?? 0, true);
  view.setInt16(12, fields.x ?? 0, true);
  view.setInt16(14, fields.z ?? 0, true);
  view.setInt16(16, fields.yaw ?? 0, true);
  view.setInt16(18, fields.pitch ?? 0, true);
  return buffer;
}

const rawView = (s: MonitorState): DataView => new DataView(encode(s));

describe("状態の大きさ", () => {
  it("20 バイト", () => {
    expect(MONITOR_STATE_BYTES).toBe(20);
  });
});

describe("writeMonitorState のバイトの並び（リトルエンディアン）", () => {
  it("仕様の表の位置・大きさ・型で書く", () => {
    const view = rawView(
      state({
        studentId: 0x01020304,
        seq: 0x0506,
        floor: 3,
        posture: "standing",
        t: -42.25,
        x: 1.23,
        z: -0.07,
        yaw: 0.5,
        pitch: 0.25,
      }),
    );
    expect(view.getUint32(0, true)).toBe(0x01020304);
    expect(view.getUint8(0)).toBe(0x04); // リトルエンディアン
    expect(view.getUint16(4, true)).toBe(0x0506);
    expect(view.getUint8(4)).toBe(0x06);
    expect(view.getUint8(6)).toBe(3);
    expect(view.getUint8(7)).toBe(0);
    expect(view.getFloat32(8, true)).toBe(-42.25);
    expect(view.getInt16(12, true)).toBe(123);
    expect(view.getInt16(14, true)).toBe(-7);
    expect(view.getInt16(16, true)).toBe(Math.round(0.5 / UNIT));
    expect(view.getInt16(18, true)).toBe(Math.round(0.25 / UNIT));
  });

  it("posture は standing が 0，crouching が 1", () => {
    expect(rawView(state({ posture: "standing" })).getUint8(7)).toBe(0);
    expect(rawView(state({ posture: "crouching" })).getUint8(7)).toBe(1);
  });

  it("x・z は m を 100 倍して丸めた cm", () => {
    expect(rawView(state({ x: 1.234 })).getInt16(12, true)).toBe(123);
    expect(rawView(state({ x: 1.236 })).getInt16(12, true)).toBe(124);
    expect(rawView(state({ z: -2.344 })).getInt16(14, true)).toBe(-234);
    expect(rawView(state({ x: 0, z: -0 })).getInt16(12, true)).toBe(0);
  });

  it("view の byteOffset から 20 バイトに書き，外には触らない", () => {
    const buffer = new ArrayBuffer(40);
    new Uint8Array(buffer).fill(0xaa);
    expect(writeMonitorState(new DataView(buffer, 8, 20), state())).toBe(true);
    const bytes = new Uint8Array(buffer);
    expect(bytes.subarray(0, 8).every((b) => b === 0xaa)).toBe(true);
    expect(bytes.subarray(28).every((b) => b === 0xaa)).toBe(true);
    expect(readMonitorState(buffer.slice(8, 28), 2)?.studentId).toBe(3141592653);
  });

  it("20 バイトより長い view には先頭の 20 バイトだけ書く", () => {
    const buffer = new ArrayBuffer(24);
    new Uint8Array(buffer).fill(0xaa);
    expect(writeMonitorState(new DataView(buffer), state())).toBe(true);
    expect(new Uint8Array(buffer).subarray(20).every((b) => b === 0xaa)).toBe(true);
  });

  it("同じ view に何度も書き直せる（送る側が毎回 new しない）", () => {
    const view = new DataView(new ArrayBuffer(MONITOR_STATE_BYTES));
    writeMonitorState(view, state({ seq: 1, x: 1 }));
    writeMonitorState(view, state({ seq: 2, x: 2 }));
    const back = readMonitorState(view, 2);
    expect(back?.seq).toBe(2);
    expect(back?.x).toBe(2);
  });
});

describe("writeMonitorState の丸め（仕様: x・z は −32768〜32767 cm，yaw は −π 以上 π 未満，pitch は ±π/2）", () => {
  it.each<[number, number]>([
    [327.67, 32767],
    [327.674, 32767],
    [327.68, 32767],
    [1e9, 32767],
    [-327.68, -32768],
    [-327.69, -32768],
    [-1e9, -32768],
  ])("x = %f m は %i cm", (x, cm) => {
    expect(rawView(state({ x })).getInt16(12, true)).toBe(cm);
    expect(rawView(state({ z: x })).getInt16(14, true)).toBe(cm);
  });

  it.each<[number, number]>([
    [0, 0],
    [Math.PI / 2, Math.PI / 2],
    [-Math.PI, -Math.PI],
    [Math.PI, -Math.PI],
    [(3 * Math.PI) / 2, -Math.PI / 2],
    [(-3 * Math.PI) / 2, Math.PI / 2],
    [2 * Math.PI + 0.5, 0.5],
    [-2 * Math.PI - 0.5, -0.5],
    [100 * Math.PI + 1, 1],
    [Math.PI - UNIT / 4, -Math.PI],
  ])("yaw = %f は %f（同じ向き）", (yaw, expected) => {
    const back = readMonitorState(encode(state({ yaw })), 2);
    expect(back?.yaw).toBeCloseTo(expected, 4);
  });

  it("yaw は読むと必ず −π 以上 π 未満", () => {
    for (let i = -400; i <= 400; i++) {
      const yaw = i * 0.0789;
      const back = readMonitorState(encode(state({ yaw })), 2);
      expect(back?.yaw).toBeGreaterThanOrEqual(-Math.PI);
      expect(back?.yaw).toBeLessThan(Math.PI);
      // 向きとしては元と同じ（差が 2π の整数倍で，誤差は 1 単位以内）
      const diff = Math.atan2(Math.sin(yaw - (back?.yaw ?? 0)), Math.cos(yaw - (back?.yaw ?? 0)));
      expect(Math.abs(diff)).toBeLessThanOrEqual(UNIT);
    }
  });

  it.each<[number, number]>([
    [Math.PI / 2, Math.PI / 2],
    [-Math.PI / 2, -Math.PI / 2],
    [2, Math.PI / 2],
    [-2, -Math.PI / 2],
    [1e9, Math.PI / 2],
    [0.1, 0.1],
  ])("pitch = %f は %f", (pitch, expected) => {
    const back = readMonitorState(encode(state({ pitch })), 2);
    expect(back?.pitch).toBeCloseTo(expected, 4);
  });

  it("pitch の ±π/2 は i16 の ±16384", () => {
    expect(rawView(state({ pitch: Math.PI / 2 })).getInt16(18, true)).toBe(16384);
    expect(rawView(state({ pitch: -Math.PI / 2 })).getInt16(18, true)).toBe(-16384);
  });

  it.each<[number, number]>([
    [0, 0],
    [65535, 65535],
    [65536, 0],
    [65537, 1],
    [131071, 65535],
  ])("seq %i は %i", (seq, expected) => {
    expect(readMonitorState(encode(state({ seq })), 2)?.seq).toBe(expected);
  });

  it("t は f32（非常ベルの前の負の数もそのまま）", () => {
    expect(readMonitorState(encode(state({ t: -30 })), 2)?.t).toBe(-30);
    expect(readMonitorState(encode(state({ t: 0 })), 2)?.t).toBe(0);
    expect(readMonitorState(encode(state({ t: 1 / 3 })), 2)?.t).toBe(Math.fround(1 / 3));
  });
});

describe("writeMonitorState が送らない時（false を返し何も書かない）", () => {
  const filled = (): ArrayBuffer => {
    const buffer = new ArrayBuffer(MONITOR_STATE_BYTES);
    new Uint8Array(buffer).fill(0xaa);
    return buffer;
  };
  const untouched = (buffer: ArrayBuffer): boolean =>
    new Uint8Array(buffer).every((b) => b === 0xaa);

  it.each<[string, Partial<MonitorState>]>([
    ["t が NaN", { t: Number.NaN }],
    ["t が Infinity", { t: Number.POSITIVE_INFINITY }],
    ["t が -Infinity", { t: Number.NEGATIVE_INFINITY }],
    ["t が f32 に収まらない", { t: 1e300 }],
    ["x が NaN", { x: Number.NaN }],
    ["x が Infinity", { x: Number.POSITIVE_INFINITY }],
    ["z が -Infinity", { z: Number.NEGATIVE_INFINITY }],
    ["z が NaN", { z: Number.NaN }],
    ["yaw が NaN", { yaw: Number.NaN }],
    ["yaw が Infinity", { yaw: Number.POSITIVE_INFINITY }],
    ["pitch が NaN", { pitch: Number.NaN }],
    ["pitch が -Infinity", { pitch: Number.NEGATIVE_INFINITY }],
    ["studentId が 0", { studentId: 0 }],
    ["studentId が 4294967296", { studentId: 4294967296 }],
    ["studentId が小数", { studentId: 1.5 }],
    ["floor が -1", { floor: -1 }],
    ["floor が 256", { floor: 256 }],
    ["floor が小数", { floor: 0.5 }],
    ["floor が NaN", { floor: Number.NaN }],
    ["seq が NaN", { seq: Number.NaN }],
    ["posture が知らない値", { posture: "lying" as MonitorState["posture"] }],
  ])("%s", (_, overrides) => {
    const buffer = filled();
    expect(writeMonitorState(new DataView(buffer), state(overrides))).toBe(false);
    expect(untouched(buffer)).toBe(true);
  });

  it("view が 20 バイトより短い", () => {
    const buffer = new ArrayBuffer(19);
    new Uint8Array(buffer).fill(0xaa);
    expect(writeMonitorState(new DataView(buffer), state())).toBe(false);
    expect(new Uint8Array(buffer).every((b) => b === 0xaa)).toBe(true);
  });

  it("studentId 4294967295・floor 255 は書ける", () => {
    const back = readMonitorState(encode(state({ studentId: 4294967295, floor: 255 })), 256);
    expect(back?.studentId).toBe(4294967295);
    expect(back?.floor).toBe(255);
  });
});

describe("readMonitorState（仕様の表どおりに手で組んだバイト列から読む）", () => {
  it("単位を戻す（x・z は cm → m，yaw・pitch は π/32768 rad 単位 → rad）", () => {
    const back = readMonitorState(
      rawState({
        studentId: 3141592653,
        seq: 65535,
        floor: 2,
        posture: 1,
        t: 99.5,
        x: -32768,
        z: 32767,
        yaw: -32768,
        pitch: 16384,
      }),
      3,
    );
    expect(back).toEqual({
      studentId: 3141592653,
      seq: 65535,
      floor: 2,
      posture: "crouching",
      t: 99.5,
      x: -327.68,
      z: 327.67,
      yaw: -Math.PI,
      pitch: Math.PI / 2,
    });
  });

  it("posture 0 は standing", () => {
    expect(readMonitorState(rawState({ posture: 0 }), 1)?.posture).toBe("standing");
  });

  it("byteOffset が 0 でない Uint8Array・DataView も正しく読む", () => {
    const big = new Uint8Array(64);
    big.fill(0xee);
    big.set(new Uint8Array(rawState({ studentId: 777, floor: 1, x: 250 })), 13);
    const sub = big.subarray(13, 33);
    expect(sub.byteOffset).toBe(13);
    const fromSub = readMonitorState(sub, 2);
    expect(fromSub?.studentId).toBe(777);
    expect(fromSub?.floor).toBe(1);
    expect(fromSub?.x).toBe(2.5);
    const fromView = readMonitorState(new DataView(big.buffer, 13, 20), 2);
    expect(fromView).toEqual(fromSub);
  });

  it("大きい buffer の一部でも長さが 20 でない view は捨てる", () => {
    const big = new Uint8Array(64);
    big.set(new Uint8Array(rawState({})), 0);
    expect(readMonitorState(big.subarray(0, 21), 1)).toBeNull();
    expect(readMonitorState(big, 1)).toBeNull();
  });

  it.each<[string, ArrayBuffer | ArrayBufferView, number]>([
    ["長さ 0", new ArrayBuffer(0), 1],
    ["長さ 19", new ArrayBuffer(19), 1],
    ["長さ 21", new ArrayBuffer(21), 1],
    ["studentId が 0", rawState({ studentId: 0 }), 1],
    ["posture が 2", rawState({ posture: 2 }), 1],
    ["posture が 255", rawState({ posture: 255 }), 1],
    ["t が NaN", rawState({ t: Number.NaN }), 1],
    ["t が Infinity", rawState({ t: Number.POSITIVE_INFINITY }), 1],
    ["t が -Infinity", rawState({ t: Number.NEGATIVE_INFINITY }), 1],
    ["floor が階の数と同じ", rawState({ floor: 2 }), 2],
    ["floor が階の数より大きい", rawState({ floor: 200 }), 2],
    ["階の数が 0", rawState({ floor: 0 }), 0],
  ])("%s は null", (_, data, floorCount) => {
    expect(readMonitorState(data, floorCount)).toBeNull();
  });

  it("floor が階の数 − 1 なら受け取る", () => {
    expect(readMonitorState(rawState({ floor: 1 }), 2)?.floor).toBe(1);
  });

  it("どんなバイト列でも例外を投げない", () => {
    let seed = 12345;
    const next = (): number => {
      seed = (seed * 1103515245 + 12345) >>> 0;
      return seed & 0xff;
    };
    for (let i = 0; i < 500; i++) {
      const length = i % 25;
      const bytes = Uint8Array.from({ length }, next);
      expect(() => readMonitorState(bytes, 3)).not.toThrow();
      expect(() => readMonitorState(bytes.buffer, 3)).not.toThrow();
    }
  });
});

describe("nextMonitorSeq・isNewerMonitorSeq（仕様: 差を 65536 で割った余りが 1〜32767 なら新しい）", () => {
  it.each<[number, number]>([
    [0, 1],
    [1, 2],
    [65534, 65535],
    [65535, 0],
  ])("%i の次は %i", (seq, expected) => {
    expect(nextMonitorSeq(seq)).toBe(expected);
  });

  it.each<[number, number, boolean]>([
    [32766, 65535, true], // 差 32767（折り返し）
    [32767, 65535, false], // 差 32768
    [0, 32768, false], // 差 32768
    [0, 32769, true], // 差 32767
    [65535, 0, false], // 差 65535（古い）
    [100, 65000, true], // 差 636
    [65000, 100, false], // 差 64900
    [0, 0, false],
    [65535, 65535, false],
    [32768, 1, true], // 差 32767
  ])("seq %i・直前 %i は %s", (seq, last, expected) => {
    expect(isNewerMonitorSeq(seq, last)).toBe(expected);
  });

  it("nextMonitorSeq で進めた番号は 65536 回続けて新しいと判定される（一周しても）", () => {
    let last = 65000;
    for (let i = 0; i < 65536; i++) {
      const seq = nextMonitorSeq(last);
      expect(seq).toBeGreaterThanOrEqual(0);
      expect(seq).toBeLessThanOrEqual(65535);
      if (!isNewerMonitorSeq(seq, last)) throw new Error(`seq ${seq} after ${last}`);
      last = seq;
    }
  });
});
