// エディタの view モード（編集中の校舎を 3D で確かめる）で受け取る表示部品の型．
// エディタは中身（three.js・校舎の 3D）を知らず，app/ が作った実体を EditorOptions.planPreview で受け取る（FloorDraftProvider と同じ考え方）
import type { SchoolPlan } from "../core/schoolPlan";

/** 開いている 3D の表示 1 回分．編集に戻る時に dispose で描画・イベント・three.js の物をすべて解放する */
export interface PlanPreviewSession {
  dispose(): void;
}

/** 校舎を 3D で表示する部品．open は container の中に描画を置き，閉じるまで描き続ける（作れない時は例外を投げる） */
export interface PlanPreview {
  open(container: HTMLElement, plan: SchoolPlan): PlanPreviewSession;
}
