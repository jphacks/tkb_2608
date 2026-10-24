// canvas に枠へ収めた文字を描く薄い殻（大きさと行の計算は textFit.ts の純粋な関数）

import { type FittedText, fitText, type MeasureText } from "./textFit";

/** ロビーの板・置き物で使う字体 */
export const CANVAS_FONT_FAMILY = '"Hiragino Sans", "Noto Sans JP", sans-serif';

/** canvas の字体を font で設定する文字列（"bold 40px ..." 等） */
export function canvasFont(fontPx: number, weight: "normal" | "bold" = "normal"): string {
  return `${weight === "bold" ? "bold " : ""}${fontPx}px ${CANVAS_FONT_FAMILY}`;
}

/** ctx.measureText を，大きさを引数にとる計測関数にする（測るたびに ctx.font を変える） */
export function canvasMeasure(
  ctx: CanvasRenderingContext2D,
  weight: "normal" | "bold" = "normal",
): MeasureText {
  return (text, fontPx) => {
    ctx.font = canvasFont(fontPx, weight);
    return ctx.measureText(text).width;
  };
}

export interface TextBox {
  /** 枠の左端（px） */
  readonly x: number;
  /** 枠の上端（px） */
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

export interface DrawTextOptions {
  readonly maxFontPx: number;
  readonly minFontPx: number;
  readonly weight?: "normal" | "bold";
  readonly lineHeight?: number;
  readonly maxLines?: number;
  readonly align?: "left" | "center" | "right";
  /** 色（無ければ今の fillStyle） */
  readonly color?: string;
}

/** 枠に収めて描く（上詰め）．決めた大きさと行を返す */
export function drawFittedText(
  ctx: CanvasRenderingContext2D,
  text: string,
  box: TextBox,
  options: DrawTextOptions,
): FittedText {
  const weight = options.weight ?? "normal";
  const fitted = fitText(
    text,
    {
      maxWidth: box.width,
      maxHeight: box.height,
      maxFontPx: options.maxFontPx,
      minFontPx: options.minFontPx,
      lineHeight: options.lineHeight,
      maxLines: options.maxLines,
    },
    canvasMeasure(ctx, weight),
  );
  const align = options.align ?? "left";
  const x =
    align === "left" ? box.x : align === "center" ? box.x + box.width / 2 : box.x + box.width;
  ctx.save();
  if (options.color !== undefined) ctx.fillStyle = options.color;
  ctx.font = canvasFont(fitted.fontPx, weight);
  ctx.textAlign = align;
  ctx.textBaseline = "top";
  fitted.lines.forEach((line, i) => {
    ctx.fillText(line, x, box.y + i * fitted.lineHeightPx);
  });
  ctx.restore();
  return fitted;
}

/**
 * 1 行を幅に収めて描く（置き物の札・ポスターの文字用）．y は文字の基準線（alphabetic）の位置．
 * 収まらなければ小さくし（下限は maxFontPx の 6 割），それでも収まらなければ「…」にする
 */
export function fillTextFitted(
  ctx: CanvasRenderingContext2D,
  text: string,
  x: number,
  y: number,
  maxWidth: number,
  maxFontPx: number,
  weight: "normal" | "bold" = "normal",
): void {
  const fitted = fitText(
    text,
    {
      maxWidth,
      maxHeight: Number.MAX_SAFE_INTEGER,
      maxFontPx,
      minFontPx: Math.max(8, Math.round(maxFontPx * 0.6)),
      maxLines: 1,
    },
    canvasMeasure(ctx, weight),
  );
  ctx.font = canvasFont(fitted.fontPx, weight);
  ctx.fillText(fitted.lines[0] ?? "", x, y);
}
