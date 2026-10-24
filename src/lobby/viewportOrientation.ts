// 画面の縦横から，横向きにするよう案内を出すかを決める（DOM に依存しない純粋な関数）

/**
 * 縦長の画面か（縦向きの案内を出すか）．width・height は CSS ピクセル．
 * 正方形・0 以下・有限でない値は縦長とみなさない（判定できない時に全面の案内で操作を塞がないため）
 */
export function isPortraitViewport(width: number, height: number): boolean {
  if (!Number.isFinite(width) || !Number.isFinite(height)) return false;
  if (width <= 0 || height <= 0) return false;
  return height > width;
}
