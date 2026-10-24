// 1 文字 1 マスの文字列の行から Floor（cells・roomOf）を組み立てる．デモの校舎等を人が読んで直せる形で書くためのもの．
// 文字は SPEC_02「URL と QR への埋め込み」の表に合わせ，教室だけは教室の添字（0〜9）で書く
import type { CellKind, Floor } from "../../core/schoolPlan";

/** 教室以外の文字とマスの種類の対応（SPEC_02「URL と QR への埋め込み」の表と同じ．教室の `c` は数字で書くため除く） */
export const ROW_CHAR_TO_KIND: Readonly<Record<string, Exclude<CellKind, "classroom">>> = {
  ".": "void",
  h: "corridor",
  "#": "wall",
  d: "door",
  e: "exit",
  s: "shutter",
  o: "outdoor",
};

/**
 * 文字列の行の配列（上の行が z = 0，左の文字が x = 0）から Floor を作る．
 * 数字 `0`〜`9` は教室のマスで，その数字が SchoolPlan.rooms の添字になる．
 * 行の長さがそろっていない・知らない文字がある時は Error を投げる（手で書いたデータの書き間違いを読み込み時に気付けるようにする）
 */
export function createFloorFromRows(level: number, rows: readonly string[]): Floor {
  const depth = rows.length;
  const width = depth > 0 ? rows[0].length : 0;
  const cells: CellKind[] = [];
  const roomOf: number[] = [];
  rows.forEach((row, z) => {
    if (row.length !== width) {
      throw new Error(`行 ${z} の長さが ${row.length} です（${width} にそろえてください）`);
    }
    for (let x = 0; x < width; x++) {
      const ch = row[x];
      if (ch >= "0" && ch <= "9") {
        cells.push("classroom");
        roomOf.push(Number(ch));
        continue;
      }
      const kind = ROW_CHAR_TO_KIND[ch];
      if (kind === undefined) {
        throw new Error(`(${x}, ${z}) の文字 "${ch}" はマスの種類に対応していません`);
      }
      cells.push(kind);
      roomOf.push(-1);
    }
  });
  return { level, width, depth, cells, roomOf };
}
