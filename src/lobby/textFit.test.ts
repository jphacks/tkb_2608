// 板の文字を枠に収める計算（Issue #110 の決定事項: 枠に収まるまで自動で小さくし，下限でも収まらなければ「…」にする）

import { describe, expect, it } from "vitest";
import { ellipsize, type FitTextOptions, fitText, type MeasureText, wrapText } from "./textFit";

/** 1 文字 = fontPx の幅（等幅）として測る */
const mono: MeasureText = (text, fontPx) => [...text].length * fontPx;

function options(patch: Partial<FitTextOptions> = {}): FitTextOptions {
  return { maxWidth: 100, maxHeight: 100, maxFontPx: 20, minFontPx: 10, ...patch };
}

describe("wrapText", () => {
  it("幅に収まる文はそのまま 1 行", () => {
    expect(wrapText("あいう", 30, 10, mono)).toEqual(["あいう"]);
  });

  it("幅を超える所で折り返す", () => {
    expect(wrapText("あいうえお", 30, 10, mono)).toEqual(["あいう", "えお"]);
  });

  it("改行では必ず行を変える", () => {
    expect(wrapText("あ\nい", 100, 10, mono)).toEqual(["あ", "い"]);
  });

  it("空の文字列は 0 行", () => {
    expect(wrapText("", 100, 10, mono)).toEqual([]);
  });

  it("1 文字が幅を超えても 1 行に 1 文字は置く（無限に続かない）", () => {
    expect(wrapText("あい", 5, 10, mono)).toEqual(["あ", "い"]);
  });
});

describe("ellipsize", () => {
  it("末尾を削って「…」を付け，幅に収める", () => {
    const out = ellipsize("あいうえお", 30, 10, mono);
    expect(out).toBe("あい…");
    expect(mono(out, 10)).toBeLessThanOrEqual(30);
  });

  it("「…」も入らない幅なら「…」だけ", () => {
    expect(ellipsize("あいう", 5, 10, mono)).toBe("…");
  });
});

describe("fitText", () => {
  it("上限の大きさで収まればそのまま", () => {
    const f = fitText("あいう", options(), mono);
    expect(f.fontPx).toBe(20);
    expect(f.lines).toEqual(["あいう"]);
    expect(f.truncated).toBe(false);
    expect(f.lineHeightPx).toBeCloseTo(28);
  });

  it("収まらなければ小さくする（下限まで）", () => {
    // 20px では 5 文字／行，10 文字は 2 行で高さ 20 + 28 = 48 > 30．16px では 6 文字／行・2 行で 16 + 22.4 > 30．
    // 小さくして 1 行（10 文字 × 10px = 100）に収まるのは 10px
    const f = fitText("あいうえおかきくけこ", options({ maxHeight: 30 }), mono);
    expect(f.truncated).toBe(false);
    expect(f.fontPx).toBeLessThan(20);
    expect(f.fontPx).toBeGreaterThanOrEqual(10);
    for (const line of f.lines) expect(mono(line, f.fontPx)).toBeLessThanOrEqual(100);
    const height = f.fontPx + (f.lines.length - 1) * f.lineHeightPx;
    expect(height).toBeLessThanOrEqual(30);
  });

  it("刻みで下限を飛び越えず，下限でも試す", () => {
    // 1 行に 10 文字が入るのは 10px だけ．刻み 4 では 20 → 16 → 12 → 10 と試す
    const f = fitText("あいうえおかきくけこ", options({ maxHeight: 12, stepPx: 4 }), mono);
    expect(f.fontPx).toBe(10);
    expect(f.truncated).toBe(false);
    expect(f.lines).toEqual(["あいうえおかきくけこ"]);
  });

  it("下限でも収まらなければ入るだけの行を残し，最後の行を「…」にする", () => {
    const text = "あ".repeat(50);
    const f = fitText(text, options({ maxHeight: 30 }), mono);
    expect(f.fontPx).toBe(10);
    expect(f.truncated).toBe(true);
    // 10px・行間 14px で高さ 30 に入るのは 2 行
    expect(f.lines.length).toBe(2);
    expect(f.lines[1]?.endsWith("…")).toBe(true);
    for (const line of f.lines) expect(mono(line, 10)).toBeLessThanOrEqual(100);
  });

  it("行の数の上限（maxLines）を超えれば小さくし，それでも超えれば「…」", () => {
    const fits = fitText("あ".repeat(8), options({ maxLines: 1 }), mono);
    expect(fits.lines.length).toBe(1);
    expect(fits.truncated).toBe(false);
    const cut = fitText("あ".repeat(30), options({ maxLines: 1 }), mono);
    expect(cut.lines.length).toBe(1);
    expect(cut.truncated).toBe(true);
    expect(cut.lines[0]?.endsWith("…")).toBe(true);
  });

  it("高さが 1 行に満たなくても 1 行は残す", () => {
    const f = fitText("あ".repeat(30), options({ maxHeight: 1 }), mono);
    expect(f.lines.length).toBe(1);
    expect(f.truncated).toBe(true);
  });

  it("空の文字列は 0 行で，省いていない", () => {
    const f = fitText("", options(), mono);
    expect(f.lines).toEqual([]);
    expect(f.truncated).toBe(false);
  });

  it("下限が上限より大きい時は上限で扱う", () => {
    const f = fitText("あいう", options({ maxFontPx: 12, minFontPx: 40 }), mono);
    expect(f.fontPx).toBe(12);
  });

  it.each([Number.NaN, 0, -2])("刻みが %s でも止まる（既定の刻みで扱う）", (stepPx) => {
    const f = fitText("あ".repeat(50), options({ maxHeight: 30, stepPx }), mono);
    expect(f.fontPx).toBe(10);
  });

  it.each([Number.NaN, 0, -5])("行の数の上限が %s なら制限しない", (maxLines) => {
    const f = fitText("あ\nい\nう", options({ maxLines }), mono);
    expect(f.lines.length).toBe(3);
    expect(f.truncated).toBe(false);
  });

  it("枠の幅・高さが不正（NaN・0）でも例外を出さず，1 行は残す", () => {
    for (const bad of [Number.NaN, 0]) {
      const f = fitText("あいう", options({ maxWidth: bad, maxHeight: bad }), mono);
      expect(f.lines.length).toBeGreaterThanOrEqual(1);
    }
  });
});
