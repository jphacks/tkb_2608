// VR の中の結果画面の板に描く文字を枠に収める計算（DOM に依存しない純粋な関数）．
// ロビーの板の textFit.ts と同じ考え方（改行と幅で折り返し，収まるまで小さくし，下限でも収まらなければ最後を「…」にする）．
// debrief/ は lobby/ を import しないため，要る分だけを書き写す

import type { BoardTextSlot } from "./debriefVrLayout";

/** text を fontPx（px）の大きさで描いた時の幅（px）を返す（canvas の measureText 相当） */
export type MeasureBoardText = (text: string, fontPx: number) => number;

/** 枠に収めた文字 */
export interface FittedBoardText {
  /** 決めた文字の大きさ（px） */
  readonly fontPx: number;
  /** 描く行 */
  readonly lines: readonly string[];
  /** 行の間隔（px） */
  readonly lineHeightPx: number;
}

/** 行の間隔（文字の大きさに対する倍率） */
export const BOARD_LINE_HEIGHT = 1.3;

const ELLIPSIS = "…";

/** 改行（\n）では必ず行を変え，幅を超える所で折り返す（日本語のため 1 文字ずつ測る） */
export function wrapBoardText(
  text: string,
  maxWidth: number,
  fontPx: number,
  measure: MeasureBoardText,
): string[] {
  const lines: string[] = [];
  for (const paragraph of text.split("\n")) {
    let line = "";
    for (const ch of paragraph) {
      if (line !== "" && measure(line + ch, fontPx) > maxWidth) {
        lines.push(line);
        line = ch;
      } else {
        line += ch;
      }
    }
    if (line !== "") lines.push(line);
  }
  return lines;
}

/** n 行を描くのに要る高さ（px） */
function blockHeight(lineCount: number, fontPx: number): number {
  return lineCount <= 0 ? 0 : fontPx + (lineCount - 1) * fontPx * BOARD_LINE_HEIGHT;
}

/**
 * 枠（slot）に収まる文字の大きさと行を決める．大きさは maxFontPx から 2 px ずつ下げ，minFontPx でも収まらなければ
 * maxLines と枠の高さに入るだけの行を残し，省いた時は最後の行を「…」にする
 */
export function fitBoardText(
  text: string,
  slot: BoardTextSlot,
  measure: MeasureBoardText,
): FittedBoardText {
  const { box } = slot;
  const maxLines = Math.max(1, Math.floor(slot.maxLines));
  const minFontPx = Math.min(slot.minFontPx, slot.maxFontPx);
  for (
    let px = slot.maxFontPx;
    px >= minFontPx;
    px = px - 2 < minFontPx && px !== minFontPx ? minFontPx : px - 2
  ) {
    const lines = wrapBoardText(text, box.width, px, measure);
    if (lines.length <= maxLines && blockHeight(lines.length, px) <= box.height) {
      return { fontPx: px, lines, lineHeightPx: px * BOARD_LINE_HEIGHT };
    }
    if (px === minFontPx) break;
  }
  const px = minFontPx;
  const lineHeightPx = px * BOARD_LINE_HEIGHT;
  const lines = wrapBoardText(text, box.width, px, measure);
  const byHeight = Math.max(1, Math.floor((box.height - px) / lineHeightPx) + 1);
  const keep = Math.min(lines.length, maxLines, byHeight);
  const kept = lines.slice(0, keep);
  const last = kept[keep - 1];
  if (keep < lines.length && last !== undefined) {
    const chars = [...last];
    while (chars.length > 0 && measure(`${chars.join("")}${ELLIPSIS}`, px) > box.width) chars.pop();
    kept[keep - 1] = `${chars.join("")}${ELLIPSIS}`;
  }
  return { fontPx: px, lines: kept, lineHeightPx };
}
