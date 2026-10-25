// 板に描く文字を枠に収める計算（DOM に依存しない純粋な関数）．
// 文字の幅は計測関数（canvas の measureText 相当）を引数で受け取る．改行（\n）と幅で折り返し，
// 収まるまで文字を小さくし，下限でも収まらなければ行を省いて最後の行を「…」にする

/** text を fontPx（px）の大きさで描いた時の幅（px）を返す */
export type MeasureText = (text: string, fontPx: number) => number;

export interface FitTextOptions {
  /** 枠の幅（px．余白を除いた，文字を置ける幅） */
  readonly maxWidth: number;
  /** 枠の高さ（px．余白を除いた，文字を置ける高さ） */
  readonly maxHeight: number;
  /** 文字の大きさの上限（px） */
  readonly maxFontPx: number;
  /** 文字の大きさの下限（px）．これでも収まらなければ行を省く */
  readonly minFontPx: number;
  /** 行の間隔（文字の大きさに対する倍率．既定 1.4） */
  readonly lineHeight?: number;
  /** 行の数の上限（既定は制限なし） */
  readonly maxLines?: number;
  /** 文字を小さくする刻み（px．既定 2） */
  readonly stepPx?: number;
}

export interface FittedText {
  /** 決めた文字の大きさ（px） */
  readonly fontPx: number;
  /** 描く行 */
  readonly lines: readonly string[];
  /** 行の間隔（px） */
  readonly lineHeightPx: number;
  /** 行を省いた・「…」にしたか */
  readonly truncated: boolean;
}

const ELLIPSIS = "…";

function positive(value: number | undefined, fallback: number): number {
  return value !== undefined && Number.isFinite(value) && value > 0 ? value : fallback;
}

/** 改行（\n）では必ず行を変え，幅を超える所で折り返す（日本語のため 1 文字ずつ測る） */
export function wrapText(
  text: string,
  maxWidth: number,
  fontPx: number,
  measure: MeasureText,
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

/** 行の末尾を削って「…」を付け，幅に収める */
export function ellipsize(
  line: string,
  maxWidth: number,
  fontPx: number,
  measure: MeasureText,
): string {
  const chars = [...line];
  while (chars.length > 0) {
    const candidate = `${chars.join("")}${ELLIPSIS}`;
    if (measure(candidate, fontPx) <= maxWidth) return candidate;
    chars.pop();
  }
  return ELLIPSIS;
}

/** n 行を描くのに要る高さ（px） */
function blockHeight(lineCount: number, fontPx: number, lineHeightPx: number): number {
  return lineCount <= 0 ? 0 : fontPx + (lineCount - 1) * lineHeightPx;
}

/** 枠に収まる文字の大きさと行を決める */
export function fitText(text: string, options: FitTextOptions, measure: MeasureText): FittedText {
  const maxFontPx = positive(options.maxFontPx, 32);
  const minFontPx = Math.min(maxFontPx, positive(options.minFontPx, maxFontPx));
  const ratio = positive(options.lineHeight, 1.4);
  const step = positive(options.stepPx, 2);
  const maxWidth = positive(options.maxWidth, 1);
  const maxHeight = positive(options.maxHeight, 1);
  const maxLines =
    options.maxLines !== undefined && Number.isFinite(options.maxLines) && options.maxLines >= 1
      ? Math.floor(options.maxLines)
      : Number.POSITIVE_INFINITY;

  for (let px = maxFontPx; px >= minFontPx; px -= step) {
    const lines = wrapText(text, maxWidth, px, measure);
    const lineHeightPx = px * ratio;
    if (lines.length <= maxLines && blockHeight(lines.length, px, lineHeightPx) <= maxHeight) {
      return { fontPx: px, lines, lineHeightPx, truncated: false };
    }
    // 刻みで下限を飛び越えないよう，最後は下限で試す
    if (px - step < minFontPx && px !== minFontPx) px = minFontPx + step;
  }

  // 下限でも収まらない: 入るだけの行を残し，省いた時は最後の行を「…」にする（高さが 1 行に満たなくても 1 行は残す）
  const px = minFontPx;
  const lineHeightPx = px * ratio;
  const lines = wrapText(text, maxWidth, px, measure);
  const byHeight = Math.max(1, Math.floor((maxHeight - px) / lineHeightPx) + 1);
  const keep = Math.min(lines.length, maxLines, byHeight);
  const kept = lines.slice(0, keep);
  const truncated = keep < lines.length;
  const last = kept[keep - 1];
  if (truncated && last !== undefined) kept[keep - 1] = ellipsize(last, maxWidth, px, measure);
  return { fontPx: px, lines: kept, lineHeightPx, truncated };
}

/** 文字を置く枠（px．左上の位置と幅・高さ） */
export interface FitBox {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

export interface CenteredText {
  /** 文字の中心の位置（px．textAlign "center"・textBaseline "middle" で描く） */
  readonly x: number;
  readonly y: number;
  /** 決めた文字の大きさ（px） */
  readonly fontPx: number;
}

/**
 * 短い 1 行（カウントダウンの数字等）を枠の真ん中に大きく置く位置と大きさを決める．
 * 文字の大きさは maxFontPx を上限に，枠の高さ × heightRatio（既定 0.9）以下，かつ幅に収まる大きさにする（1 px 未満にはしない）
 */
export function centerTextInBox(
  text: string,
  box: FitBox,
  maxFontPx: number,
  measure: MeasureText,
  heightRatio = 0.9,
): CenteredText {
  const width = positive(box.width, 1);
  const height = positive(box.height, 1);
  const ratio = positive(heightRatio, 0.9);
  let fontPx = Math.min(positive(maxFontPx, height), height * ratio);
  const measured = measure(text, fontPx);
  if (Number.isFinite(measured) && measured > width) fontPx *= width / measured;
  return {
    x: box.x + width / 2,
    y: box.y + height / 2,
    fontPx: Math.max(1, Math.floor(fontPx)),
  };
}
