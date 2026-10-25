// 教員用エディタ（?editor）の画面の薄い殻．道具箱・上から見た図（Canvas 2D）・校舎の誤りの表示を DOM で組み，
// マウスとキーの操作を editorState.ts の純粋な関数に渡して，返ってきた状態で描き直す．VR・three.js は使わない
import type { SchoolPlan } from "../core/schoolPlan";
import { createRoomId } from "../share/monitorIds";
import { DEMO_SCHOOL } from "../share/samples/demoSchool";
import { createShareLink } from "../share/shareUrl";
import { validatePlan } from "../share/validatePlan";
import type { CellXZ } from "../sim/grid";
import { drawEditorGrid } from "./editorCanvas";
import { canvasToCell, computeGridLayout, drillMarkers, type GridLayout } from "./editorLayout";
import {
  addRoom,
  beginRouteStroke,
  beginStroke,
  canRedo,
  canUndo,
  clearRoute,
  continueRouteStroke,
  continueStroke,
  createEditorState,
  EDIT_FLOOR,
  type EditorState,
  type EditorTool,
  editingFloor,
  endStroke,
  FACINGS,
  facingOfYaw,
  isMarkerTool,
  isRouteTool,
  MAX_GRID_SIZE,
  type MarkerKind,
  openPlan,
  placeMarker,
  redo,
  renameRoom,
  resizeGrid,
  selectTool,
  setDrillMode,
  setSpreadSeconds,
  setStartFacing,
  setTimeLimit,
  startBlank,
  suggestRoute,
  undo,
} from "./editorState";
import {
  CELL_COLORS,
  CELL_KIND_LABELS,
  DRILL_MODES,
  EDITOR_COLORS,
  FACING_LABELS,
  MARKER_LABELS,
  MARKER_TOOLS,
  PART_TOOLS,
  ROUTE_TOOL_LABEL,
  roomColor,
} from "./editorStyle";
import { browserPlanStorage, loadSavedPlan, PLAN_STORAGE_MESSAGES, savePlan } from "./planStorage";
import { createRoomIdResolver } from "./roomStorage";
import { checkRoute, isEmptyRouteUnreachable, type RouteCheck } from "./routeCheck";
import { createRoutePanel } from "./routePanel";
import { createSavePanel } from "./savePanel";
import { createSharePanel } from "./sharePanel";
import { createSpreadPanel } from "./spreadPanel";
import { countSpreadAt, createSpreadCache } from "./spreadPreview";
import { canvasToGridPoint } from "./underlay";
import { createUnderlayPanel } from "./underlayPanel";

/** 画面の隅に並べる校舎の誤りの件数（残りは件数だけ出す） */
const SHOWN_ERRORS = 5;

/** 置けないマスを選んだ時の案内を出しておく時間（ms） */
const NOTICE_MS = 3000;

/** 読み込めなかった理由など，長めの案内を出しておく時間（ms） */
const LONG_NOTICE_MS = 8000;

const STYLE = `
.editor {
  position: fixed; inset: 0; display: flex; background: #1b222d; color: #e8edf3;
  font: 14px/1.5 system-ui, -apple-system, "Hiragino Sans", sans-serif;
}
.editor__side {
  flex: none; width: 260px; overflow-y: auto; padding: 12px; box-sizing: border-box;
  background: #222b38; border-right: 1px solid #333f50;
}
.editor__side h1 { font-size: 16px; margin: 0 0 4px; }
.editor__side h2 { font-size: 13px; margin: 14px 0 6px; color: #9fb0c4; font-weight: normal; }
.editor__name { margin: 0 0 4px; color: #9fb0c4; font-size: 12px; }
.editor__tools { display: flex; flex-direction: column; gap: 4px; }
.editor__tool {
  display: flex; align-items: center; gap: 8px; width: 100%; padding: 4px 8px; text-align: left;
  background: #2c3646; color: inherit; border: 2px solid transparent; border-radius: 4px; cursor: pointer; font: inherit;
}
.editor__tool:hover { background: #354154; }
.editor__tool[aria-pressed="true"] { border-color: #5b9bff; background: #34445c; }
.editor__swatch {
  flex: none; width: 16px; height: 16px; border-radius: 3px; border: 1px solid rgba(0, 0, 0, 0.4);
}
.editor__swatch--void { background: repeating-linear-gradient(45deg, #26303f 0 3px, #3a4658 3px 6px); }
.editor__row { display: flex; gap: 6px; align-items: center; margin-top: 6px; }
.editor__row[hidden] { display: none; }
.editor__row input[type="text"] { flex: 1; min-width: 0; }
.editor__row input[type="number"] { width: 56px; }
.editor input { font: inherit; padding: 2px 4px; background: #141a23; color: inherit; border: 1px solid #3b4859; border-radius: 3px; }
.editor__button {
  padding: 4px 10px; background: #34445c; color: inherit; border: 1px solid #4a5d78; border-radius: 4px;
  cursor: pointer; font: inherit;
}
.editor__button:hover:not(:disabled) { background: #3f5372; }
.editor__button:disabled { opacity: 0.4; cursor: default; }
.editor__hint { color: #8494a8; font-size: 12px; margin: 4px 0 0; }
.editor__main { position: relative; flex: 1; min-width: 0; }
.editor__canvas { position: absolute; inset: 0; width: 100%; height: 100%; cursor: crosshair; touch-action: none; }
.editor__hover {
  position: absolute; left: 8px; top: 8px; padding: 2px 8px; border-radius: 4px;
  background: rgba(16, 20, 28, 0.75); font-size: 12px; pointer-events: none;
}
.editor__errors {
  position: absolute; right: 8px; bottom: 8px; max-width: 420px; padding: 8px 12px; border-radius: 6px;
  background: rgba(60, 20, 20, 0.88); border: 1px solid #a94442; font-size: 12px; pointer-events: none;
}
.editor__errors[hidden] { display: none; }
.editor__notice {
  position: absolute; left: 50%; top: 8px; transform: translateX(-50%); padding: 6px 14px; border-radius: 6px;
  background: rgba(120, 60, 10, 0.92); border: 1px solid #e0a040; font-size: 13px; pointer-events: none;
}
.editor__notice[hidden] { display: none; }
.editor__facings { display: grid; grid-template-columns: repeat(4, 1fr); gap: 4px; margin-top: 6px; }
.editor__facings .editor__button { padding: 4px 0; }
.editor__facings .editor__button[aria-pressed="true"] { border-color: #5b9bff; background: #4a6390; }
.editor__errors ul { margin: 4px 0 0; padding-left: 18px; }
.editor__modes { display: grid; grid-template-columns: repeat(2, 1fr); gap: 4px; margin-top: 6px; }
.editor__modes .editor__button[aria-pressed="true"] { border-color: #5b9bff; background: #4a6390; }
.editor__share {
  position: absolute; inset: 0; display: flex; align-items: center; justify-content: center;
  background: rgba(10, 14, 20, 0.6);
}
.editor__share[hidden] { display: none; }
.editor__share-card {
  max-width: min(640px, calc(100% - 32px)); max-height: calc(100% - 32px); overflow-y: auto; box-sizing: border-box;
  padding: 16px; border-radius: 8px; background: #222b38; border: 1px solid #4a5d78;
}
.editor__share-card h2 { font-size: 16px; margin: 0 0 8px; }
.editor__share-body { display: flex; flex-direction: column; align-items: stretch; }
.editor__share-qr { align-self: center; image-rendering: pixelated; }
.editor__share-qr-area { display: flex; flex-wrap: wrap; align-items: center; justify-content: center; gap: 12px; }
.editor__share-qr-area .editor__share-qr { flex: none; }
.editor__share-monitor { display: flex; flex-direction: column; align-items: flex-start; gap: 4px; max-width: 200px; }
.editor__share-body .editor__row input[type="text"] { flex: 1; min-width: 0; }
.editor__share-error { margin: 0; color: #ffb4a8; }
.editor__share-reasons { margin: 4px 0 0; padding-left: 18px; font-size: 13px; }
.editor__share-actions { justify-content: flex-end; margin-top: 12px; }
.editor__spread-field { display: flex; align-items: center; gap: 6px; }
.editor__spread-field span { width: 5em; }
.editor__warning { color: #ffc56b; white-space: pre-line; }
.editor__warning[hidden], .editor__spread-time[hidden] { display: none; }
.editor__row input[type="range"] { flex: 1; min-width: 0; }
.editor__canvas--aligning { cursor: move; }
.editor__photo-only {
  position: absolute; left: 8px; bottom: 8px; padding: 4px 10px; border-radius: 4px;
  background: rgba(16, 20, 28, 0.85); border: 1px solid #5b9bff; font-size: 13px; pointer-events: none;
}
.editor__photo-only[hidden] { display: none; }
`;

/**
 * エディタを立ち上げる（document.body に画面を置く）．localStorage に前回の編集があればそれを開き，
 * 無い・読めない時は demoPlan（デモの校舎）を開いた状態にする
 */
export function startEditor(demoPlan: SchoolPlan = DEMO_SCHOOL): void {
  const style = document.createElement("style");
  style.textContent = STYLE;
  document.head.appendChild(style);
  document.title = "校舎エディタ | 防災体験VR（仮称）";

  const storage = browserPlanStorage();
  const saved = loadSavedPlan(storage);
  let state: EditorState = createEditorState(saved.kind === "opened" ? saved.plan : demoPlan);
  /** 最後に localStorage に書いた校舎（開いた時の校舎は書かずに済ませる．参照が変わった時だけ書く） */
  let storedPlan: SchoolPlan = state.plan;
  /** 自動保存できているか（できなくなった時に一度だけ案内を出す） */
  let autoSaveOk = saved.kind !== "failed" || saved.storageUsable;
  let hover: CellXZ | null = null;
  let layout: GridLayout = { cellPx: 1, offsetX: 0, offsetY: 0 };

  const root = el("div", "editor");
  const side = el("div", "editor__side");
  const main = el("div", "editor__main");
  root.append(side, main);
  document.body.appendChild(root);

  // 道具箱
  const title = el("h1");
  title.textContent = "校舎エディタ";
  const planName = el("p", "editor__name");
  side.append(title, planName);

  // 下敷き（E1）．道具箱の下の方に置くが，道具を選んだ時にモードを終えるため先に作る．
  // 通知の帯・描き直しはこの後に作るので，呼ばれた時に引く
  const underlayPanel = createUnderlayPanel({
    gridSize: () => editingFloor(state),
    onChange: () => render(),
    onAligningChange: (aligning) => {
      // 合わせ始める時に塗っている途中なら，そこで塗り終える
      if (aligning && state.stroke !== null) state = endStroke(state);
      canvas.classList.toggle("editor__canvas--aligning", aligning);
      renderRooms();
      render();
      persist();
    },
    notify: (message) => showNotice(message, LONG_NOTICE_MS),
    storage,
  });

  /** 道具を選ぶ（下敷きを合わせている途中なら，合わせ終えて塗る操作に戻す） */
  const pickTool = (tool: EditorTool): void => {
    underlayPanel.setAligning(false);
    update(selectTool(state, tool));
  };

  side.append(heading("パーツ"));
  const partList = el("div", "editor__tools");
  const partButtons = PART_TOOLS.map((part) => {
    const button = toolButton(part.label, part.kind === "void" ? null : CELL_COLORS[part.kind]);
    button.addEventListener("click", () => pickTool({ kind: part.kind }));
    partList.appendChild(button);
    return { kind: part.kind, button };
  });
  side.appendChild(partList);

  side.append(heading("教室"));
  const roomList = el("div", "editor__tools");
  side.appendChild(roomList);
  const renameRow = el("div", "editor__row");
  const renameInput = el("input");
  renameInput.type = "text";
  renameInput.placeholder = "教室の名前";
  renameInput.setAttribute("aria-label", "選んでいる教室の名前");
  renameRow.appendChild(renameInput);
  const addRoomButton = button("教室を追加");
  addRoomButton.addEventListener("click", () => update(addRoom(state)));
  const addRow = el("div", "editor__row");
  addRow.appendChild(addRoomButton);
  side.append(renameRow, addRow);
  // 名前は確定（Enter・フォーカスを外す）した時だけ変える（1 文字ごとに「元に戻す」が積まれないように）
  renameInput.addEventListener("change", () => {
    if (state.tool.kind === "classroom")
      update(renameRoom(state, state.tool.room, renameInput.value));
  });
  renameInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter") renameInput.blur();
  });

  side.append(heading("訓練条件"));
  const markerList = el("div", "editor__tools");
  const markerButtons = MARKER_TOOLS.map((marker) => {
    const b = toolButton(marker.label, marker.color);
    b.addEventListener("click", () => pickTool({ kind: marker.kind }));
    markerList.appendChild(b);
    return { kind: marker.kind, button: b };
  });
  side.appendChild(markerList);
  const facingRow = el("div", "editor__facings");
  facingRow.setAttribute("role", "group");
  facingRow.setAttribute("aria-label", "開始時の向き");
  const facingButtons = FACINGS.map((facing) => {
    const b = button(FACING_LABELS[facing]);
    b.setAttribute("aria-pressed", "false");
    b.addEventListener("click", () => update(setStartFacing(state, facing)));
    facingRow.appendChild(b);
    return { facing, button: b };
  });
  const markerHint = el("p", "editor__hint");
  markerHint.textContent =
    "クリックで置く．火元・集合場所はもう一度クリックで外す．開始地点は 1 つだけで，置き直すと移る．開始時の向きは上のボタンで選ぶ";
  side.append(heading("開始時の向き"), facingRow, markerHint);

  /** 延焼の計算結果（校舎が変わった時だけ計算し直す．延焼のプレビューと E5 の経路の提案で同じものを使う） */
  const spreadOf = createSpreadCache();

  // 正解経路（E5）．通知の帯はこの後に作るので，呼ばれた時に引く
  const routePanel = createRoutePanel(
    {
      onSelectTool: () => pickTool({ kind: "route" }),
      onSuggest: () => {
        const result = suggestRoute(state, spreadOf);
        update(result.state);
        if (result.reason !== null) showNotice(result.reason);
      },
      onClear: () => update(clearRoute(state)),
    },
    toolButton(ROUTE_TOOL_LABEL, EDITOR_COLORS.route),
  );
  side.appendChild(routePanel.element);

  side.append(heading("モード"));
  const modeRow = el("div", "editor__modes");
  modeRow.setAttribute("role", "group");
  modeRow.setAttribute("aria-label", "訓練のモード");
  const modeButtons = DRILL_MODES.map(({ mode, label: text, hint }) => {
    const b = button(text);
    b.title = hint;
    b.setAttribute("aria-pressed", "false");
    b.addEventListener("click", () => update(setDrillMode(state, mode)));
    modeRow.appendChild(b);
    return { mode, button: b };
  });
  const modeHint = el("p", "editor__hint");
  side.append(modeRow, modeHint);

  // 延焼の速さとプレビュー（E4）．通知の帯はこの後に作るので，呼ばれた時に引く
  const spreadPanel = createSpreadPanel({
    onSpreadSeconds: (key, seconds) => update(setSpreadSeconds(state, key, seconds)),
    onTimeLimit: (seconds) => update(setTimeLimit(state, seconds)),
    onPreviewChange: () => render(),
    notify: (message) => showNotice(message),
  });
  side.appendChild(spreadPanel.element);

  side.append(heading("生徒用の QR コード"));
  const shareButton = button("QR コードを出す");
  shareButton.addEventListener("click", () => void openShare());
  const shareRow = el("div", "editor__row");
  shareRow.appendChild(shareButton);
  const shareHint = el("p", "editor__hint");
  shareHint.textContent =
    "今の校舎とモードで，生徒が読み取る QR コードと URL を出す．校舎に誤りがある時・大きすぎる時は理由を出す";
  side.append(shareRow, shareHint);

  // 保存（ファイルの書き出し・読み込み，デモの校舎に戻す）．通知の帯はこの後に作るので，呼ばれた時に引く
  const savePanel = createSavePanel({
    currentPlan: () => {
      const settled = endStroke(state);
      if (settled !== state) update(settled);
      return state.plan;
    },
    onLoaded: (result, fileName) => {
      if (result.ok || result.kind === "invalidPlan") {
        update(openPlan(state, result.plan));
        showNotice(
          result.ok
            ? `「${fileName}」を開きました（元に戻すで戻せる）`
            : `「${fileName}」を開きました．校舎に誤りがあります（右下）`,
          LONG_NOTICE_MS,
        );
        return;
      }
      // 版が新しい時の理由は読み方の案内を含むので，そのまま出す
      const hint =
        result.kind === "corrupted" ? "．このアプリで書き出した校舎のファイルを選んでください" : "";
      showNotice(`「${fileName}」を開けません．${result.reason}${hint}`, LONG_NOTICE_MS);
    },
    onResetDemo: () => {
      const next = openPlan(state, demoPlan);
      if (next.plan === state.plan) return;
      update(next);
      showNotice("デモの校舎を開きました（元に戻すで戻せる）");
    },
    notify: (message) => showNotice(message),
  });
  savePanel.syncAutoSave(autoSaveOk);
  side.appendChild(savePanel.element);

  side.append(heading("元に戻す"));
  const historyRow = el("div", "editor__row");
  const undoButton = button("元に戻す");
  const redoButton = button("やり直す");
  undoButton.addEventListener("click", () => update(undo(state)));
  redoButton.addEventListener("click", () => update(redo(state)));
  historyRow.append(undoButton, redoButton);
  const historyHint = el("p", "editor__hint");
  historyHint.textContent = "Ctrl+Z で元に戻す，Ctrl+Shift+Z か Ctrl+Y でやり直す";
  side.append(historyRow, historyHint);

  side.append(heading("マス目の大きさ"));
  const sizeRow = el("div", "editor__row");
  const widthInput = numberInput("幅");
  const depthInput = numberInput("奥行き");
  sizeRow.append(label("幅", widthInput), label("奥行き", depthInput));
  const resizeButton = button("大きさを変える");
  resizeButton.addEventListener("click", () =>
    update(resizeGrid(state, widthInput.valueAsNumber, depthInput.valueAsNumber)),
  );
  const blankButton = button("空のマス目から始める");
  blankButton.addEventListener("click", () =>
    update(startBlank(state, widthInput.valueAsNumber, depthInput.valueAsNumber)),
  );
  const resizeRow = el("div", "editor__row");
  resizeRow.appendChild(resizeButton);
  const blankRow = el("div", "editor__row");
  blankRow.appendChild(blankButton);
  const sizeHint = el("p", "editor__hint");
  sizeHint.textContent = `1〜${MAX_GRID_SIZE} マス．左上をそろえて残るマスは保ち，増えたマスは「何もない」になる．空のマス目は幅・奥行きの値で作る`;
  side.append(sizeRow, resizeRow, blankRow, sizeHint);

  side.appendChild(underlayPanel.element);

  // 上から見た図
  const canvas = el("canvas", "editor__canvas");
  const hoverBox = el("div", "editor__hover");
  const errorBox = el("div", "editor__errors");
  const noticeBox = el("div", "editor__notice");
  noticeBox.hidden = true;
  noticeBox.setAttribute("role", "status");
  const photoOnlyBox = el("div", "editor__photo-only");
  photoOnlyBox.textContent = "写真だけを表示中（Space を離すと戻る）";
  photoOnlyBox.hidden = true;
  main.append(canvas, hoverBox, errorBox, photoOnlyBox, noticeBox);
  /** Space を押している間は，マスの塗りと延焼のプレビューを隠して下敷きの写真だけを見せる */
  let photoOnly = false;
  const setPhotoOnly = (next: boolean): void => {
    if (next === photoOnly) return;
    photoOnly = next;
    photoOnlyBox.hidden = !photoOnly;
    render();
  };
  const ctx = canvas.getContext("2d");
  let noticeTimer: number | undefined;

  /** 置けなかった理由などを数秒（ms）だけ出す */
  const showNotice = (message: string, ms = NOTICE_MS): void => {
    noticeBox.textContent = message;
    noticeBox.hidden = false;
    window.clearTimeout(noticeTimer);
    noticeTimer = window.setTimeout(() => {
      noticeBox.hidden = true;
    }, ms);
  };

  // 生徒用の QR の窓（案内の帯より下に重ね，コピーの成否は案内の帯で知らせる）
  const sharePanel = createSharePanel(showNotice);
  main.insertBefore(sharePanel.element, noticeBox);
  /** QR を出している校舎．これと違う校舎になったら窓を閉じる（古い QR を配らないように） */
  let sharedPlan: SchoolPlan | null = null;
  /** 校舎の指紋から見守りの部屋の ID を引く（同じ校舎データの間は同じ ID．SPEC_01「見守り」） */
  const resolveRoomId = createRoomIdResolver(storage, createRoomId);

  /** 今の校舎で生徒用の URL を作り，QR か理由を窓に出す */
  async function openShare(): Promise<void> {
    const settled = endStroke(state);
    if (settled !== state) update(settled);
    const plan = state.plan;
    sharedPlan = plan;
    sharePanel.showPending();
    const result = await createShareLink(plan, {
      baseUrl: window.location.origin + window.location.pathname,
      resolveRoomId,
    });
    // 作っている間に校舎が変わった・閉じられた時は出さない
    if (sharedPlan !== plan || !sharePanel.isOpen()) return;
    sharePanel.show(result);
  }

  const cellAt = (e: PointerEvent): CellXZ | null => {
    const rect = canvas.getBoundingClientRect();
    return canvasToCell(layout, editingFloor(state), e.clientX - rect.left, e.clientY - rect.top);
  };
  const gridPointAt = (e: PointerEvent | WheelEvent) => {
    const rect = canvas.getBoundingClientRect();
    return canvasToGridPoint(layout, e.clientX - rect.left, e.clientY - rect.top);
  };
  canvas.addEventListener("pointerdown", (e) => {
    if (e.button !== 0) return;
    // 下敷きを合わせている間は，マス目の外でもドラッグで写真を動かす（塗り・置く・経路の操作はしない）
    if (underlayPanel.isAligning()) {
      if (underlayPanel.beginDrag(gridPointAt(e), e.shiftKey))
        canvas.setPointerCapture(e.pointerId);
      return;
    }
    const cell = cellAt(e);
    if (cell === null) return;
    // 訓練条件はクリックで 1 マスずつ置く・外す（ドラッグで続けると，足す・外すが混ざって分かりにくいため）
    if (isMarkerTool(state.tool)) {
      const result = placeMarker(state, cell);
      update(result.state);
      if (result.reason !== null) showNotice(result.reason);
      return;
    }
    canvas.setPointerCapture(e.pointerId);
    if (isRouteTool(state.tool)) {
      const result = beginRouteStroke(state, cell);
      update(result.state);
      if (result.reason !== null) showNotice(result.reason);
      return;
    }
    update(beginStroke(state, cell));
  });
  canvas.addEventListener("pointermove", (e) => {
    const cell = cellAt(e);
    hover = cell;
    if (underlayPanel.isAligning()) {
      // 写真が動けば onChange で描き直す．動かない時もマウスの下のマスの表示を直す
      underlayPanel.dragTo(gridPointAt(e));
      render();
    } else if (cell !== null && state.stroke !== null && isRouteTool(state.tool)) {
      const result = continueRouteStroke(state, cell);
      update(result.state);
      if (result.reason !== null) showNotice(result.reason);
    } else if (cell !== null && state.stroke !== null) update(continueStroke(state, cell));
    else render();
  });
  const finish = () => {
    underlayPanel.endDrag();
    if (state.stroke !== null) update(endStroke(state));
  };
  canvas.addEventListener("pointerup", finish);
  canvas.addEventListener("pointercancel", finish);
  canvas.addEventListener("lostpointercapture", finish);
  canvas.addEventListener("pointerleave", () => {
    hover = null;
    render();
  });
  // ホイールで下敷きの大きさを変える（合わせている間だけ．ページのスクロールは止める）
  canvas.addEventListener(
    "wheel",
    (e) => {
      if (underlayPanel.zoomAt(gridPointAt(e), e.deltaY)) e.preventDefault();
    },
    { passive: false },
  );

  window.addEventListener("keydown", (e) => {
    if (e.code === "Space" && !isTextEntry(e.target)) {
      // 写真が無い（表示していない）時は何もしない．ある時はスクロール・フォーカス中のボタンの押下を止める
      if (underlayPanel.overlay() === null) return;
      e.preventDefault();
      setPhotoOnly(true);
      return;
    }
    // 文字の入力中は入力欄の元に戻すに任せる
    if (e.target instanceof HTMLInputElement) return;
    if (e.key === "Escape" && underlayPanel.isAligning()) {
      underlayPanel.setAligning(false);
      return;
    }
    if (!(e.ctrlKey || e.metaKey)) return;
    const key = e.key.toLowerCase();
    if (key === "z" && !e.shiftKey) {
      e.preventDefault();
      update(undo(state));
    } else if ((key === "z" && e.shiftKey) || key === "y") {
      e.preventDefault();
      update(redo(state));
    }
  });

  window.addEventListener("keyup", (e) => {
    if (e.code !== "Space" || !photoOnly) return;
    e.preventDefault();
    setPhotoOnly(false);
  });
  // 押したまま別の窓へ移ると keyup が届かないので，フォーカスを失った時も戻す
  window.addEventListener("blur", () => setPhotoOnly(false));

  new ResizeObserver(() => render()).observe(main);

  function update(next: EditorState): void {
    const toolChanged = next.tool !== state.tool;
    const roomsChanged = next.plan.rooms !== state.plan.rooms;
    state = next;
    if (sharedPlan !== null && state.plan !== sharedPlan) {
      sharedPlan = null;
      sharePanel.hide();
    }
    if (toolChanged || roomsChanged) renderRooms();
    render();
    persist();
  }

  /** 校舎が変わっていれば localStorage に書く（ドラッグの途中は書かず，塗り終えた時にまとめて書く） */
  function persist(): void {
    if (state.stroke !== null || state.plan === storedPlan) return;
    const ok = savePlan(storage, state.plan);
    if (ok) storedPlan = state.plan;
    if (!ok && autoSaveOk) showNotice(PLAN_STORAGE_MESSAGES.saveFailed, LONG_NOTICE_MS);
    if (ok !== autoSaveOk) savePanel.syncAutoSave(ok);
    autoSaveOk = ok;
  }

  // ドラッグの途中で閉じた・再読み込みした時も，そこまでの編集を残す
  window.addEventListener("pagehide", () => {
    if (state.stroke !== null) update(endStroke(state));
  });

  /** 教室の一覧のボタンを作り直す（教室の数・名前・選択が変わった時だけ） */
  function renderRooms(): void {
    roomList.replaceChildren();
    state.plan.rooms.forEach((room, index) => {
      const b = toolButton(room.name, roomColor(index));
      b.setAttribute(
        "aria-pressed",
        String(
          !underlayPanel.isAligning() && isSameTool(state.tool, { kind: "classroom", room: index }),
        ),
      );
      b.addEventListener("click", () => pickTool({ kind: "classroom", room: index }));
      roomList.appendChild(b);
    });
    if (state.plan.rooms.length === 0) {
      const empty = el("p", "editor__hint");
      empty.textContent = "教室がありません．「教室を追加」で足してください";
      roomList.appendChild(empty);
    }
    const tool = state.tool;
    renameRow.hidden = tool.kind !== "classroom";
    if (tool.kind === "classroom") renameInput.value = state.plan.rooms[tool.room].name;
  }

  /** 最後に誤りを検査した校舎 */
  let checkedPlan: SchoolPlan | null = null;
  /** 正解経路の確かめの結果（経路・訓練条件・マス目が変わった時だけ確かめ直す．ドラッグ中も線の色に使う） */
  let routeCheck: RouteCheck | null = null;
  let routeCheckedPlan: SchoolPlan | null = null;
  /** 経路が空で自動の提案でもたどり着けないか（延焼と探索が要るので，塗っている途中は確かめず前の結果を使う） */
  let routeUnreachable = false;
  let unreachableCheckedPlan: SchoolPlan | null = null;

  function render(): void {
    const floor = editingFloor(state);
    // 大きさを変えてマウスの下のマスが外に出た時は消す
    if (hover !== null && !(hover.x < floor.width && hover.z < floor.depth)) hover = null;
    planName.textContent = state.plan.name;
    // 下敷きを合わせている間は，どの道具も選んでいない見た目にする（塗れると思わせないように）
    const aligning = underlayPanel.isAligning();
    for (const { kind, button: b } of partButtons) {
      b.setAttribute("aria-pressed", String(!aligning && state.tool.kind === kind));
    }
    for (const { kind, button: b } of markerButtons) {
      b.setAttribute("aria-pressed", String(!aligning && state.tool.kind === kind));
    }
    const facing = facingOfYaw(state.plan.drill.startYaw);
    for (const { facing: f, button: b } of facingButtons) {
      b.setAttribute("aria-pressed", String(f === facing));
    }
    for (const { mode, button: b } of modeButtons) {
      b.setAttribute("aria-pressed", String(state.plan.drill.mode === mode));
    }
    modeHint.textContent =
      DRILL_MODES.find((m) => m.mode === state.plan.drill.mode)?.hint ?? "モードを選んでください";
    if (routeCheck === null || routeCheckedPlan !== state.plan) {
      routeCheck = checkRoute(state.plan.drill, EDIT_FLOOR, floor);
      routeCheckedPlan = state.plan;
    }
    if (state.stroke === null && unreachableCheckedPlan !== state.plan) {
      unreachableCheckedPlan = state.plan;
      routeUnreachable =
        state.plan.drill.route.length === 0 &&
        isEmptyRouteUnreachable(state.plan, spreadOf(state.plan));
    }
    routePanel.sync(
      !aligning && isRouteTool(state.tool),
      state.plan.drill.route.length,
      routeCheck,
      routeUnreachable,
    );
    undoButton.disabled = !canUndo(state);
    redoButton.disabled = !canRedo(state);
    // 入力中の値は書き換えない
    if (document.activeElement !== widthInput) widthInput.value = String(floor.width);
    if (document.activeElement !== depthInput) depthInput.value = String(floor.depth);

    const rect = main.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    const w = Math.max(1, Math.floor(rect.width));
    const h = Math.max(1, Math.floor(rect.height));
    if (canvas.width !== Math.round(w * dpr) || canvas.height !== Math.round(h * dpr)) {
      canvas.width = Math.round(w * dpr);
      canvas.height = Math.round(h * dpr);
    }
    layout = computeGridLayout(floor, w, h);
    const previewSeconds = spreadPanel.previewSeconds();
    const spread = previewSeconds === null ? null : spreadOf(state.plan);
    spreadPanel.sync(
      state.plan,
      spread === null || previewSeconds === null
        ? null
        : countSpreadAt(spread, EDIT_FLOOR, previewSeconds),
    );
    if (ctx !== null) {
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      drawEditorGrid(
        ctx,
        floor,
        state.plan.rooms,
        layout,
        w,
        h,
        hover,
        drillMarkers(state.plan.drill, EDIT_FLOOR, floor),
        state.plan.drill.startYaw,
        spread === null || previewSeconds === null
          ? null
          : { spread, floorIndex: EDIT_FLOOR, atSeconds: previewSeconds },
        { cells: state.plan.drill.route, badSteps: routeCheck.badSteps },
        underlayPanel.overlay(),
        photoOnly,
      );
    }

    if (hover === null) {
      hoverBox.hidden = true;
    } else {
      const i = hover.z * floor.width + hover.x;
      const kind = floor.cells[i];
      const roomName = kind === "classroom" ? state.plan.rooms[floor.roomOf[i]]?.name : undefined;
      hoverBox.hidden = false;
      const marks = markersAt(state, hover).map((m) => `・${MARKER_LABELS[m]}`);
      const { x: hx, z: hz } = hover;
      const routeAt = state.plan.drill.route.findIndex(
        (r) => r.floor === EDIT_FLOOR && r.x === hx && r.z === hz,
      );
      if (routeAt >= 0) marks.push(`・経路 ${routeAt + 1} マス目`);
      const ref = { floor: EDIT_FLOOR, x: hover.x, z: hover.z };
      const arrival =
        spread === null
          ? ""
          : `　${arrivalText("火", spread.fireAt(ref))}・${arrivalText("煙", spread.smokeAt(ref))}`;
      hoverBox.textContent = `(${hover.x}, ${hover.z}) ${roomName ?? CELL_KIND_LABELS[kind]}${marks.join("")}${arrival}`;
    }

    // 塗っている途中は検査しない（ドラッグ中に毎回検査すると重く，途中の誤りが出入りしてちらつくため）．
    // プレビューの再生で毎フレーム描き直すので，同じ校舎は検査し直さない
    if (state.stroke === null && state.plan !== checkedPlan) {
      checkedPlan = state.plan;
      renderErrors(validatePlan(state.plan));
    }
  }

  function renderErrors(errors: readonly string[]): void {
    errorBox.hidden = errors.length === 0;
    if (errors.length === 0) return;
    const head = el("div");
    head.textContent = `校舎に誤りが ${errors.length} 件あります`;
    const list = el("ul");
    for (const message of errors.slice(0, SHOWN_ERRORS)) {
      const item = el("li");
      item.textContent = message;
      list.appendChild(item);
    }
    if (errors.length > SHOWN_ERRORS) {
      const item = el("li");
      item.textContent = `ほか ${errors.length - SHOWN_ERRORS} 件`;
      list.appendChild(item);
    }
    errorBox.replaceChildren(head, list);
  }

  renderRooms();
  render();
  if (saved.kind === "opened") showNotice(PLAN_STORAGE_MESSAGES.opened);
  else if (saved.kind === "failed") showNotice(saved.message, LONG_NOTICE_MS);
}

/** そのマス（編集中の階）に置いてある訓練条件の印 */
function markersAt(state: EditorState, cell: CellXZ): MarkerKind[] {
  const { fireOrigins, start, assembly } = state.plan.drill;
  const at = (ref: { readonly floor: number; readonly x: number; readonly z: number }): boolean =>
    ref.floor === EDIT_FLOOR && ref.x === cell.x && ref.z === cell.z;
  const marks: MarkerKind[] = [];
  if (fireOrigins.some(at)) marks.push("fireOrigin");
  if (at(start)) marks.push("start");
  if (assembly.some(at)) marks.push("assembly");
  return marks;
}

/** マスに火・煙が着く時刻の表示（着かなければ「着かない」） */
function arrivalText(name: string, seconds: number): string {
  return Number.isFinite(seconds) ? `${name} ${Math.round(seconds)} 秒` : `${name}は着かない`;
}

/** 文字を打つ欄（Space を空白の入力に使う欄）か．チェックボックス・スライダー等は含めない（Space で写真だけを見られるように） */
function isTextEntry(target: EventTarget | null): boolean {
  if (target instanceof HTMLTextAreaElement || target instanceof HTMLSelectElement) return true;
  if (!(target instanceof HTMLInputElement)) return false;
  return !NON_TEXT_INPUT_TYPES.has(target.type);
}

/** 文字を打たない input の種類 */
const NON_TEXT_INPUT_TYPES: ReadonlySet<string> = new Set([
  "checkbox",
  "radio",
  "range",
  "button",
  "submit",
  "reset",
  "file",
  "color",
]);

function isSameTool(a: EditorTool, b: EditorTool): boolean {
  if (a.kind === "classroom" && b.kind === "classroom") return a.room === b.room;
  return a.kind === b.kind;
}

function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className?: string,
): HTMLElementTagNameMap[K] {
  const element = document.createElement(tag);
  if (className !== undefined) element.className = className;
  return element;
}

function heading(text: string): HTMLHeadingElement {
  const h = el("h2");
  h.textContent = text;
  return h;
}

function button(text: string): HTMLButtonElement {
  const b = el("button", "editor__button");
  b.type = "button";
  b.textContent = text;
  return b;
}

/** 色見本つきの道具のボタン．color が null なら「何もない」の見本 */
function toolButton(text: string, color: string | null): HTMLButtonElement {
  const b = el("button", "editor__tool");
  b.type = "button";
  b.setAttribute("aria-pressed", "false");
  const swatch = el(
    "span",
    color === null ? "editor__swatch editor__swatch--void" : "editor__swatch",
  );
  if (color !== null) swatch.style.background = color;
  const name = el("span");
  name.textContent = text;
  b.append(swatch, name);
  return b;
}

function numberInput(ariaLabel: string): HTMLInputElement {
  const input = el("input");
  input.type = "number";
  input.min = "1";
  input.max = String(MAX_GRID_SIZE);
  input.step = "1";
  input.setAttribute("aria-label", ariaLabel);
  return input;
}

function label(text: string, input: HTMLInputElement): HTMLLabelElement {
  const l = el("label");
  l.append(`${text} `, input);
  return l;
}
