// VR の中の結果画面の板の文字の収め方（boardText.ts）のテスト．文字の幅は「1 文字 = 文字の大きさ」と仮に測る
import { describe, expect, it } from "vitest";
import { BOARD_LINE_HEIGHT, fitBoardText, wrapBoardText } from "./boardText";
import type { BoardTextSlot } from "./debriefVrLayout";

const measure = (text: string, fontPx: number): number => [...text].length * fontPx;

function slot(overrides: Partial<BoardTextSlot> & { width?: number; height?: number } = {}) {
  const { width = 400, height = 100, ...rest } = overrides;
  return {
    box: { x: 0, y: 0, width, height },
    maxFontPx: 40,
    minFontPx: 20,
    maxLines: 2,
    ...rest,
  } satisfies BoardTextSlot;
}

describe("wrapBoardText", () => {
  it("幅を超える所で折り返す", () => {
    expect(wrapBoardText("あいうえお", 60, 20, measure)).toEqual(["あいう", "えお"]);
  });

  it("改行では必ず行を変え，空の段落は飛ばす", () => {
    expect(wrapBoardText("あ\n\nい", 1000, 20, measure)).toEqual(["あ", "い"]);
  });
});

describe("fitBoardText", () => {
  it("収まる時は上限の大きさのまま", () => {
    const fitted = fitBoardText("あいう", slot(), measure);
    expect(fitted.fontPx).toBe(40);
    expect(fitted.lines).toEqual(["あいう"]);
    expect(fitted.lineHeightPx).toBeCloseTo(40 * BOARD_LINE_HEIGHT);
  });

  it("収まるまで小さくする", () => {
    // 15 文字: 40 px では 10 文字で折り返して 2 行（高さ 92 px），1 行に入るのは 26 px 以下
    const fitted = fitBoardText("あ".repeat(15), slot({ maxLines: 1 }), measure);
    expect(fitted.fontPx).toBeLessThanOrEqual(26);
    expect(fitted.fontPx).toBeGreaterThanOrEqual(20);
    expect(fitted.lines).toHaveLength(1);
  });

  it("下限でも収まらなければ行を省いて最後を「…」にする", () => {
    const fitted = fitBoardText("あ".repeat(100), slot({ maxLines: 2 }), measure);
    expect(fitted.fontPx).toBe(20);
    expect(fitted.lines).toHaveLength(2);
    expect(fitted.lines[1]?.endsWith("…")).toBe(true);
    for (const line of fitted.lines) expect(measure(line, 20)).toBeLessThanOrEqual(400);
  });

  it("上限と下限が同じ・下限が上限より大きい時もその大きさで描く", () => {
    expect(fitBoardText("あ", slot({ maxFontPx: 30, minFontPx: 30 }), measure).fontPx).toBe(30);
    expect(fitBoardText("あ", slot({ maxFontPx: 30, minFontPx: 50 }), measure).fontPx).toBe(30);
  });

  it("奇数の刻みでも下限を試す", () => {
    // 41 → 39 → … → 21 → 20（下限）
    const fitted = fitBoardText("あ".repeat(20), slot({ maxFontPx: 41, maxLines: 1 }), measure);
    expect(fitted.fontPx).toBe(20);
    expect(fitted.lines).toEqual(["あ".repeat(20)]);
  });
});
