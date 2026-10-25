// 道具箱の「保存」の薄い殻．ファイルの書き出し（Blob と a 要素でダウンロード）・ファイルの選択・デモの校舎に戻すボタンと，
// 自動保存の状態を出す．校舎の形式は share/planFile.ts，読み込んだ校舎を開くのは呼び出し側（editor.ts）が行う
import type { SchoolPlan } from "../core/schoolPlan";
import type { PlanJsonResult } from "../share/planCodec";
import {
  MAX_PLAN_TEXT_LENGTH,
  PLAN_FILE_EXTENSION,
  PLAN_FILE_MIME,
  PLAN_FILE_REASONS,
  parsePlanText,
  planFileName,
  serializePlan,
} from "../share/planFile";

/** 自動保存の状態の表示 */
export const AUTO_SAVE_TEXT = {
  saved:
    "編集はこのブラウザに自動で保存され，再読み込みしても残る．別の PC で使う時はファイルに書き出す",
  failed: "自動保存できていない．編集を残すにはファイルに書き出す",
} as const;

/** 操作の受け渡し先 */
export interface SavePanelOptions {
  /** 書き出す校舎（押した時に呼ぶ．ドラッグの途中なら呼び出し側で塗り終える） */
  readonly currentPlan: () => SchoolPlan;
  /** ファイルを読み終えた（中身の検査の結果と，選んだファイルの名前） */
  readonly onLoaded: (result: PlanJsonResult, fileName: string) => void;
  /** 「デモの校舎に戻す」を押した */
  readonly onResetDemo: () => void;
  /** 書き出し・読み込みの成否等を画面に知らせる */
  readonly notify: (message: string) => void;
}

/** 保存の道具箱 */
export interface SavePanel {
  /** 道具箱に置く要素 */
  readonly element: HTMLElement;
  /** 自動保存できているかに合わせて表示を直す */
  syncAutoSave(saved: boolean): void;
}

/** 道具箱を作る */
export function createSavePanel(options: SavePanelOptions): SavePanel {
  const element = document.createElement("div");
  const title = document.createElement("h2");
  title.textContent = "保存";

  const exportRow = document.createElement("div");
  exportRow.className = "editor__row";
  const exportButton = button("ファイルに書き出す");
  exportButton.title = "今の校舎と訓練条件を JSON のファイルでダウンロードする";
  exportButton.addEventListener("click", () => {
    const plan = options.currentPlan();
    const fileName = planFileName(plan.name);
    downloadText(serializePlan(plan, { pretty: true }), fileName);
    options.notify(`「${fileName}」に書き出しました`);
  });
  exportRow.appendChild(exportButton);

  const fileInput = document.createElement("input");
  fileInput.type = "file";
  fileInput.accept = `${PLAN_FILE_EXTENSION},${PLAN_FILE_MIME}`;
  fileInput.hidden = true;
  fileInput.addEventListener("change", () => {
    const file = fileInput.files?.[0];
    // 同じファイルを続けて選んでも change が起きるよう，選んだ物は消しておく
    fileInput.value = "";
    if (file !== undefined) void readFile(file);
  });
  const importRow = document.createElement("div");
  importRow.className = "editor__row";
  const importButton = button("ファイルを読み込む");
  importButton.title = "書き出したファイルを選んで開く（元に戻すで戻せる）";
  importButton.addEventListener("click", () => fileInput.click());
  importRow.append(importButton, fileInput);

  const demoRow = document.createElement("div");
  demoRow.className = "editor__row";
  const demoButton = button("デモの校舎に戻す");
  demoButton.title = "同梱のデモの校舎を開く（元に戻すで戻せる）";
  demoButton.addEventListener("click", () => options.onResetDemo());
  demoRow.appendChild(demoButton);

  const status = document.createElement("p");
  status.className = "editor__hint";
  status.textContent = AUTO_SAVE_TEXT.saved;
  element.append(title, exportRow, importRow, demoRow, status);

  async function readFile(file: File): Promise<void> {
    // 大きなファイルを読み込んでから断らないよう，先に大きさで断る（UTF-8 は 1 文字 1 バイト以上なので，バイト数で比べてよい）
    if (file.size > MAX_PLAN_TEXT_LENGTH * 4) {
      options.onLoaded(
        { ok: false, kind: "corrupted", reason: PLAN_FILE_REASONS.tooLarge },
        file.name,
      );
      return;
    }
    let text: string;
    try {
      text = await file.text();
    } catch {
      options.onLoaded(
        { ok: false, kind: "corrupted", reason: PLAN_FILE_REASONS.notJson },
        file.name,
      );
      return;
    }
    options.onLoaded(parsePlanText(text), file.name);
  }

  function syncAutoSave(saved: boolean): void {
    status.textContent = saved ? AUTO_SAVE_TEXT.saved : AUTO_SAVE_TEXT.failed;
    status.classList.toggle("editor__warning", !saved);
  }

  return { element, syncAutoSave };
}

/** 文字列をファイルとしてダウンロードさせる（Blob と a 要素．サーバーは使わない） */
function downloadText(text: string, fileName: string): void {
  const url = URL.createObjectURL(new Blob([text], { type: `${PLAN_FILE_MIME};charset=utf-8` }));
  const a = document.createElement("a");
  a.href = url;
  a.download = fileName;
  a.hidden = true;
  document.body.appendChild(a);
  a.click();
  a.remove();
  // すぐに解放するとダウンロードが始まる前に URL が無効になるブラウザがあるため，少し待つ
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function button(text: string): HTMLButtonElement {
  const b = document.createElement("button");
  b.type = "button";
  b.className = "editor__button";
  b.textContent = text;
  return b;
}
