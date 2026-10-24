// マスの種類と 1 文字の対応（SPEC_02「URL と QR への埋め込み」の表）．URL への埋め込みと，配置の下書き（ES3）の文字列の読み書きで使い回す
import type { CellKind } from "../core/schoolPlan";

/** マスの種類 → 1 文字（SPEC_02「URL と QR への埋め込み」の表） */
export const CELL_KIND_TO_CHAR: Readonly<Record<CellKind, string>> = {
  void: ".",
  classroom: "c",
  corridor: "h",
  wall: "#",
  door: "d",
  exit: "e",
  shutter: "s",
  outdoor: "o",
};

/** 1 文字 → マスの種類（CELL_KIND_TO_CHAR の逆） */
export const CHAR_TO_CELL_KIND: ReadonlyMap<string, CellKind> = new Map(
  (Object.entries(CELL_KIND_TO_CHAR) as [CellKind, string][]).map(([kind, ch]) => [ch, kind]),
);

/** マスの種類の配列を 1 マス 1 文字の文字列にする */
export function cellsToChars(cells: readonly CellKind[]): string {
  return cells.map((kind) => CELL_KIND_TO_CHAR[kind]).join("");
}

/**
 * 1 マス 1 文字の文字列をマスの種類の配列に戻す．
 * 表に無い文字がある時は null を返す（壊れたデータを例外にせず，呼ぶ側が理由つきの失敗にできるようにする）
 */
export function charsToCells(text: string): CellKind[] | null {
  const cells: CellKind[] = [];
  for (const ch of text) {
    const kind = CHAR_TO_CELL_KIND.get(ch);
    if (kind === undefined) return null;
    cells.push(kind);
  }
  return cells;
}
