// エディタの編集中の校舎を localStorage に自動で保存し，次に ?editor を開いた時に読み戻す．
// 保存の形式は share/planFile.ts（ファイルの書き出しと同じ JSON）．Storage は引数で受け取り，読み書きの例外はここで受け止める
import type { SchoolPlan } from "../core/schoolPlan";
import { parsePlanText, serializePlan } from "../share/planFile";

/** 保存に使う localStorage のキー（同じ配信先の他の機能とぶつからないよう，チーム名とエディタの名前を付ける） */
export const PLAN_STORAGE_KEY = "tkb2608.editor.plan";

/** 使う Storage の操作だけを持つ型（テストで代わりを渡せるように） */
export interface PlanStorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

/** 保存から開けなかった時の案内の文 */
export const PLAN_STORAGE_MESSAGES = {
  opened: "前回の編集を開きました",
  unavailable:
    "このブラウザでは自動保存を使えません（プライベートモード等）．デモの校舎で始めます．編集を残すにはファイルに書き出してください",
  saveFailed:
    "自動保存できませんでした（ブラウザの保存の容量が足りない等）．編集を残すにはファイルに書き出してください",
} as const;

/** 前回の編集の読み込みの結果 */
export type SavedPlanLoad =
  /** 保存が無い（初めて開いた） */
  | { readonly kind: "none" }
  /** 保存から開いた．errors は validatePlan の誤り（編集の途中で誤りがあっても開く） */
  | { readonly kind: "opened"; readonly plan: SchoolPlan; readonly errors: readonly string[] }
  /**
   * 保存を読めなかった（Storage が使えない・中身が壊れている・新しい版）．message は画面に出す案内．
   * storageUsable は Storage 自体は使えるか（中身が壊れているだけなら，次の編集から自動保存できる）
   */
  | { readonly kind: "failed"; readonly message: string; readonly storageUsable: boolean };

const UNAVAILABLE: SavedPlanLoad = {
  kind: "failed",
  message: PLAN_STORAGE_MESSAGES.unavailable,
  storageUsable: false,
};

/** ブラウザの localStorage．使えない（プライベートモード・設定で禁止等で例外になる）時は null */
export function browserPlanStorage(): PlanStorageLike | null {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

/** 前回の編集を読む．例外は投げない */
export function loadSavedPlan(storage: PlanStorageLike | null): SavedPlanLoad {
  if (storage === null) return UNAVAILABLE;
  let text: string | null;
  try {
    text = storage.getItem(PLAN_STORAGE_KEY);
  } catch {
    return UNAVAILABLE;
  }
  if (text === null) return { kind: "none" };
  const result = parsePlanText(text);
  if (result.ok) return { kind: "opened", plan: result.plan, errors: [] };
  if (result.kind === "invalidPlan") {
    return { kind: "opened", plan: result.plan, errors: result.errors };
  }
  return {
    kind: "failed",
    message: `前回の編集を読み込めませんでした（${result.reason}）．デモの校舎で始めます`,
    storageUsable: true,
  };
}

/** 校舎を保存する．書けた時は true，Storage が使えない・容量が足りない時は false（例外は投げない） */
export function savePlan(storage: PlanStorageLike | null, plan: SchoolPlan): boolean {
  if (storage === null) return false;
  try {
    storage.setItem(PLAN_STORAGE_KEY, serializePlan(plan));
    return true;
  } catch {
    return false;
  }
}
