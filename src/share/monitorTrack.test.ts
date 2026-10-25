// 見守りの記録（track）のバイト列と分け方・つなぎ方のテスト．
// 基準は docs/04_SPEC/SPEC_01_画面遷移とモジュール構成.md「見守り」の段階 1「知らせ」の track と「中継」の 4 KiB の上限
import { describe, expect, it } from "vitest";
import type { DrillSample, DrillTrack } from "../core/drill";
import { bytesToBase64Url } from "./base64url";
import {
  MONITOR_TRACK_MAX_PARTS,
  parseMonitorNotice,
  stringifyMonitorNotice,
} from "./monitorNotice";
import {
  decodeMonitorTrack,
  encodeMonitorTrack,
  joinMonitorTrack,
  MONITOR_TRACK_CHUNK_BYTES,
  MONITOR_TRACK_SAMPLE_BYTES,
  splitMonitorTrack,
} from "./monitorTrack";

/** 中継が捨てる大きさ（4 KiB） */
const RELAY_LIMIT_BYTES = 4096;
const MAX_U32 = 4294967295;

function sample(overrides: Partial<DrillSample> = {}): DrillSample {
  return { t: 1.5, floor: 0, x: 2.5, z: -3.25, posture: "standing", ...overrides };
}

/** n 件の記録（0.2 秒ごと．階と姿勢を入れ替える） */
function track(n: number, floors = 2): DrillTrack {
  return {
    samples: Array.from({ length: n }, (_, i) =>
      sample({
        t: i * 0.2,
        floor: i % floors,
        x: (i % 300) * 0.5,
        z: -(i % 200) * 0.25,
        posture: i % 3 === 0 ? "crouching" : "standing",
      }),
    ),
  };
}

/** 往復した時に期待する値（t は f32，x・z は cm に丸める） */
function expected(s: DrillSample): DrillSample {
  return {
    t: Math.fround(s.t),
    floor: s.floor,
    // i16 に -0 は無いので 0 にそろえる
    x: Math.round(s.x * 100) / 100 + 0,
    z: Math.round(s.z * 100) / 100 + 0,
    posture: s.posture,
  };
}

function mustEncode(t: DrillTrack): Uint8Array {
  const bytes = encodeMonitorTrack(t);
  if (bytes === null) throw new Error("バイト列にできない");
  return bytes;
}

describe("encodeMonitorTrack・decodeMonitorTrack", () => {
  it("往復すると元の記録に戻る（t は f32，x・z は cm）", () => {
    const original = track(20);
    const decoded = decodeMonitorTrack(mustEncode(original), 2);
    expect(decoded).toEqual({ samples: original.samples.map(expected) });
  });

  it("大きさは 先頭 5 バイト + 1 件 10 バイト", () => {
    expect(MONITOR_TRACK_SAMPLE_BYTES).toBe(10);
    expect(mustEncode(track(0)).byteLength).toBe(5);
    expect(mustEncode(track(1)).byteLength).toBe(15);
    expect(mustEncode(track(751)).byteLength).toBe(7515);
  });

  it("0 件の記録も往復できる", () => {
    const bytes = mustEncode({ samples: [] });
    expect(Array.from(bytes)).toEqual([1, 0, 0, 0, 0]);
    expect(decodeMonitorTrack(bytes, 1)).toEqual({ samples: [] });
  });

  it("並び: 版 u8=1・件数 u32，1 件は t f32・x i16 cm・z i16 cm・floor u8・posture u8（リトルエンディアン）", () => {
    const bytes = mustEncode({
      samples: [
        sample({ t: 2, x: 1.5, z: -0.02, floor: 3, posture: "crouching" }),
        sample({ t: -1, x: 0, z: 0, floor: 0, posture: "standing" }),
      ],
    });
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    expect(view.getUint8(0)).toBe(1);
    expect(view.getUint32(1, true)).toBe(2);
    expect(view.getFloat32(5, true)).toBe(2);
    expect(view.getInt16(9, true)).toBe(150);
    expect(view.getInt16(11, true)).toBe(-2);
    expect(view.getUint8(13)).toBe(3);
    expect(view.getUint8(14)).toBe(1);
    expect(view.getFloat32(15, true)).toBe(-1);
    expect(view.getUint8(23)).toBe(0);
    expect(view.getUint8(24)).toBe(0);
  });

  it.each([
    [1.234, 1.23],
    [1.236, 1.24],
    [-1.234, -1.23],
    [-1.236, -1.24],
    [0.004, 0],
    [327.67, 327.67],
    [-327.68, -327.68],
    [400, 327.67],
    [-400, -327.68],
  ])("x・z の %s m は cm に丸めて %s m（i16 の範囲に収める）", (value, rounded) => {
    const decoded = decodeMonitorTrack(
      mustEncode({ samples: [sample({ x: value, z: value })] }),
      1,
    );
    expect(decoded?.samples[0].x).toBeCloseTo(rounded, 10);
    expect(decoded?.samples[0].z).toBeCloseTo(rounded, 10);
  });

  it("t が負（非常ベルの前）でも往復できる", () => {
    const decoded = decodeMonitorTrack(mustEncode({ samples: [sample({ t: -30 })] }), 1);
    expect(decoded?.samples[0].t).toBe(-30);
  });

  it("階は 255 までバイト列にでき，受け取る側は階の数の中なら受け取る", () => {
    const bytes = mustEncode({ samples: [sample({ floor: 255 })] });
    expect(decodeMonitorTrack(bytes, 256)?.samples[0].floor).toBe(255);
  });

  it.each<[string, Partial<DrillSample>]>([
    ["t が NaN", { t: Number.NaN }],
    ["t が Infinity", { t: Number.POSITIVE_INFINITY }],
    ["t が -Infinity", { t: Number.NEGATIVE_INFINITY }],
    ["t が f32 に収まらない（f32 で Infinity）", { t: 1e40 }],
    ["x が NaN", { x: Number.NaN }],
    ["x が Infinity", { x: Number.POSITIVE_INFINITY }],
    ["z が NaN", { z: Number.NaN }],
    ["z が -Infinity", { z: Number.NEGATIVE_INFINITY }],
    ["階が 256", { floor: 256 }],
    ["階が負", { floor: -1 }],
    ["階が小数", { floor: 0.5 }],
    ["階が NaN", { floor: Number.NaN }],
    ["知らない姿勢", { posture: "lying" as DrillSample["posture"] }],
  ])("%s の件があれば null（送らない）", (_, bad) => {
    const t: DrillTrack = { samples: [sample(), sample(bad)] };
    expect(() => encodeMonitorTrack(t)).not.toThrow();
    expect(encodeMonitorTrack(t)).toBeNull();
  });
});

describe("decodeMonitorTrack（捨てるもの）", () => {
  const good = (): Uint8Array => mustEncode(track(3, 1)).slice();

  it("版が 1 でなければ null", () => {
    for (const version of [0, 2, 255]) {
      const bytes = good();
      bytes[0] = version;
      expect(decodeMonitorTrack(bytes, 1)).toBeNull();
    }
  });

  it("先頭 5 バイトに足りなければ null", () => {
    for (const length of [0, 1, 4]) {
      expect(decodeMonitorTrack(good().subarray(0, length), 1)).toBeNull();
    }
  });

  it("長さが件数に合わなければ null（足りない・余る）", () => {
    const bytes = good();
    expect(decodeMonitorTrack(bytes.subarray(0, bytes.byteLength - 1), 1)).toBeNull();
    const longer = new Uint8Array(bytes.byteLength + 1);
    longer.set(bytes);
    expect(decodeMonitorTrack(longer, 1)).toBeNull();
    const more = good();
    new DataView(more.buffer).setUint32(1, 4, true);
    expect(decodeMonitorTrack(more, 1)).toBeNull();
    const huge = good();
    new DataView(huge.buffer).setUint32(1, MAX_U32, true);
    expect(decodeMonitorTrack(huge, 1)).toBeNull();
  });

  it("階が校舎の階の数以上の件があれば null", () => {
    const bytes = mustEncode({ samples: [sample({ floor: 0 }), sample({ floor: 2 })] });
    expect(decodeMonitorTrack(bytes, 3)).not.toBeNull();
    expect(decodeMonitorTrack(bytes, 2)).toBeNull();
    expect(decodeMonitorTrack(bytes, 1)).toBeNull();
  });

  it("姿勢が 0／1 でない件があれば null", () => {
    const bytes = good();
    bytes[5 + 10 + 9] = 2;
    expect(decodeMonitorTrack(bytes, 1)).toBeNull();
  });

  it.each([Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY])(
    "t が %s の件があれば null",
    (t) => {
      const bytes = good();
      new DataView(bytes.buffer).setFloat32(5 + 10, t, true);
      expect(decodeMonitorTrack(bytes, 1)).toBeNull();
    },
  );

  it("配列の途中を切り出したバイト列（byteOffset が 0 でない）も読める", () => {
    const bytes = mustEncode(track(3, 1));
    const padded = new Uint8Array(bytes.byteLength + 7);
    padded.set(bytes, 7);
    expect(decodeMonitorTrack(padded.subarray(7), 1)?.samples).toHaveLength(3);
  });
});

describe("splitMonitorTrack", () => {
  it("1 つの部分は 2,400 バイト", () => {
    expect(MONITOR_TRACK_CHUNK_BYTES).toBe(2400);
  });

  it("751 件（150 秒・0.2 秒ごと）は 4 つに分け，part は 0 から，parts・trackId・studentId は同じ", () => {
    const notices = splitMonitorTrack(123, 9, track(751));
    expect(notices).toHaveLength(4);
    notices.forEach((n, i) => {
      expect(n).toMatchObject({ type: "track", studentId: 123, trackId: 9, part: i, parts: 4 });
      expect(n.data).toMatch(/^[A-Za-z0-9_-]+$/);
    });
  });

  it("各部分の知らせは JSON にしても UTF-8 で 4,096 バイト未満（studentId・trackId が大きくても）", () => {
    const notices = splitMonitorTrack(MAX_U32, MAX_U32, track(751));
    for (const n of notices) {
      const size = new TextEncoder().encode(stringifyMonitorNotice(n)).byteLength;
      expect(size).toBeLessThan(RELAY_LIMIT_BYTES);
    }
  });

  it("各部分の知らせは受け取る側（parseMonitorNotice）で読め，つなぐと元の記録になる", () => {
    const original = track(751);
    const notices = splitMonitorTrack(5, 1, original);
    const parsed = notices.map((n) => parseMonitorNotice(stringifyMonitorNotice(n)));
    expect(parsed).toEqual(notices);
    const joined = joinMonitorTrack(
      notices.map((n) => n.data),
      2,
    );
    expect(joined).toEqual({ samples: original.samples.map(expected) });
  });

  it("0 件の記録は 1 つの部分", () => {
    const notices = splitMonitorTrack(5, 1, { samples: [] });
    expect(notices).toHaveLength(1);
    expect(notices[0]).toMatchObject({ part: 0, parts: 1 });
    expect(joinMonitorTrack([notices[0].data], 1)).toEqual({ samples: [] });
  });

  it("ちょうど 2,400 バイトなら 1 つ，1 バイト超えれば 2 つ", () => {
    // 5 + 10n = 2400 は整数にならないので，近い件数で確かめる
    expect(splitMonitorTrack(5, 1, track(239, 1))).toHaveLength(1); // 2395 バイト
    expect(splitMonitorTrack(5, 1, track(240, 1))).toHaveLength(2); // 2405 バイト
  });

  it("32 に分けられる最大（7,679 件）までは送り，33 以上に分かれる時は空の配列（送らない）", () => {
    expect(MONITOR_TRACK_MAX_PARTS).toBe(32);
    const max = splitMonitorTrack(5, 1, track(7679, 1));
    expect(max).toHaveLength(32);
    expect(max.every((n) => n.parts === 32)).toBe(true);
    expect(splitMonitorTrack(5, 1, track(7680, 1))).toEqual([]);
  });

  it("バイト列にできない記録は空の配列", () => {
    expect(splitMonitorTrack(5, 1, { samples: [sample({ t: Number.NaN })] })).toEqual([]);
  });
});

describe("joinMonitorTrack", () => {
  const parts = (): string[] => splitMonitorTrack(5, 1, track(751)).map((n) => n.data);

  it("部分が欠けていれば null", () => {
    const all = parts();
    for (let i = 0; i < all.length; i++) {
      const missing: (string | undefined)[] = [...all];
      missing[i] = undefined;
      expect(joinMonitorTrack(missing, 2)).toBeNull();
    }
  });

  it("最後の部分が足りない（配列が短い）と長さが合わず null", () => {
    expect(joinMonitorTrack(parts().slice(0, 3), 2)).toBeNull();
  });

  it("部分が 1 つも無ければ null", () => {
    expect(joinMonitorTrack([], 2)).toBeNull();
  });

  it("順番が違えば null（読めない）", () => {
    const all = parts();
    expect(joinMonitorTrack([all[1], all[0], all[2], all[3]], 2)).toBeNull();
  });

  it.each(["AB=C", "AB+C", "AB/C", "あいう", "A"])(
    "base64url でない部分（%s）があれば null",
    (bad) => {
      const all: string[] = parts();
      all[1] = bad;
      expect(() => joinMonitorTrack(all, 2)).not.toThrow();
      expect(joinMonitorTrack(all, 2)).toBeNull();
    },
  );

  it("階が校舎の階の数以上の記録は null", () => {
    expect(joinMonitorTrack(parts(), 1)).toBeNull();
  });

  it("1 つの部分でもつなげる", () => {
    const bytes = mustEncode(track(3, 1));
    expect(joinMonitorTrack([bytesToBase64Url(bytes)], 1)?.samples).toHaveLength(3);
  });
});
