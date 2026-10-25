// 道具箱の項目（見出しごとのまとまり）の開閉の状態を覚える・読む．閉じた項目の名前の並びを localStorage に JSON で置く．
// 並びの出し入れは純粋な関数にし，Storage の読み書きと例外の受け止めは loadClosedSections・saveClosedSections の殻に閉じ込める
import type { PlanStorageLike } from "./planStorage";

/** 閉じた項目を置く localStorage のキー（校舎の保存 `tkb2608.editor.plan` と同じ付け方） */
export const SECTION_FOLD_STORAGE_KEY = "tkb2608.editor.sections";

/**
 * localStorage の文字を閉じた項目の名前の並びに戻す．無い（null）・JSON でない・配列でない時は空（すべて開く）．
 * 文字でない・空の名前と，同じ名前の 2 つ目以降は捨てる
 */
export function parseClosedSections(text: string | null): readonly string[] {
  if (text === null) return [];
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    return [];
  }
  if (!Array.isArray(value)) return [];
  const closed: string[] = [];
  for (const item of value as unknown[]) {
    if (typeof item !== "string" || item === "" || closed.includes(item)) continue;
    closed.push(item);
  }
  return closed;
}

/** 閉じた項目の名前の並びを localStorage に置く文字（JSON の配列）にする */
export function serializeClosedSections(closed: readonly string[]): string {
  return JSON.stringify(closed);
}

/** 項目が開いているか（閉じた並びに無ければ開いている．既定はすべて開く） */
export function isSectionOpen(closed: readonly string[], id: string): boolean {
  return !closed.includes(id);
}

/** 項目を開く・閉じた後の並び．変わらない時は同じ並び（参照）を返す（書き直さずに済むように） */
export function setSectionOpen(
  closed: readonly string[],
  id: string,
  open: boolean,
): readonly string[] {
  if (isSectionOpen(closed, id) === open) return closed;
  return open ? closed.filter((c) => c !== id) : [...closed, id];
}

/** 閉じた項目を読む．Storage が使えない・読めない時は空（すべて開く）．例外は投げない */
export function loadClosedSections(storage: PlanStorageLike | null): readonly string[] {
  if (storage === null) return [];
  try {
    return parseClosedSections(storage.getItem(SECTION_FOLD_STORAGE_KEY));
  } catch {
    return [];
  }
}

/** 閉じた項目を書く．書けた時は true，Storage が使えない・容量が足りない時は false（例外は投げない） */
export function saveClosedSections(
  storage: PlanStorageLike | null,
  closed: readonly string[],
): boolean {
  if (storage === null) return false;
  try {
    storage.setItem(SECTION_FOLD_STORAGE_KEY, serializeClosedSections(closed));
    return true;
  } catch {
    return false;
  }
}
