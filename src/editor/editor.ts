// 教員用エディタ（?editor）の画面の薄い殻．道具箱・上から見た図（Canvas 2D）・校舎の誤りの表示を DOM で組み，
// マウスとキーの操作を editorState.ts の純粋な関数に渡して，返ってきた状態で描き直す．VR・three.js は使わない
import type { SchoolPlan } from "../core/schoolPlan";
import { DEMO_SCHOOL } from "../share/samples/demoSchool";
import { validatePlan } from "../share/validatePlan";
import type { CellXZ } from "../sim/grid";
import { drawEditorGrid } from "./editorCanvas";
import { canvasToCell, computeGridLayout, type GridLayout } from "./editorLayout";
import {
  addRoom,
  beginStroke,
  canRedo,
  canUndo,
  continueStroke,
  createEditorState,
  type EditorState,
  editingFloor,
  endStroke,
  MAX_GRID_SIZE,
  type PaintTool,
  redo,
  renameRoom,
  resizeGrid,
  selectTool,
  startBlank,
  undo,
} from "./editorState";
import { CELL_COLORS, CELL_KIND_LABELS, PART_TOOLS, roomColor } from "./editorStyle";

/** 画面の隅に並べる校舎の誤りの件数（残りは件数だけ出す） */
const SHOWN_ERRORS = 5;

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
.editor__errors ul { margin: 4px 0 0; padding-left: 18px; }
`;

/** エディタを立ち上げる（document.body に画面を置く）．最初はデモの校舎を開いた状態にする */
export function startEditor(initialPlan: SchoolPlan = DEMO_SCHOOL): void {
  const style = document.createElement("style");
  style.textContent = STYLE;
  document.head.appendChild(style);
  document.title = "校舎エディタ | 防災体験VR（仮称）";

  let state: EditorState = createEditorState(initialPlan);
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

  side.append(heading("パーツ"));
  const partList = el("div", "editor__tools");
  const partButtons = PART_TOOLS.map((part) => {
    const button = toolButton(part.label, part.kind === "void" ? null : CELL_COLORS[part.kind]);
    button.addEventListener("click", () => update(selectTool(state, { kind: part.kind })));
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

  // 上から見た図
  const canvas = el("canvas", "editor__canvas");
  const hoverBox = el("div", "editor__hover");
  const errorBox = el("div", "editor__errors");
  main.append(canvas, hoverBox, errorBox);
  const ctx = canvas.getContext("2d");

  const cellAt = (e: PointerEvent): CellXZ | null => {
    const rect = canvas.getBoundingClientRect();
    return canvasToCell(layout, editingFloor(state), e.clientX - rect.left, e.clientY - rect.top);
  };
  canvas.addEventListener("pointerdown", (e) => {
    if (e.button !== 0) return;
    const cell = cellAt(e);
    if (cell === null) return;
    canvas.setPointerCapture(e.pointerId);
    update(beginStroke(state, cell));
  });
  canvas.addEventListener("pointermove", (e) => {
    const cell = cellAt(e);
    hover = cell;
    if (cell !== null && state.stroke !== null) update(continueStroke(state, cell));
    else render();
  });
  const finish = () => {
    if (state.stroke !== null) update(endStroke(state));
  };
  canvas.addEventListener("pointerup", finish);
  canvas.addEventListener("pointercancel", finish);
  canvas.addEventListener("lostpointercapture", finish);
  canvas.addEventListener("pointerleave", () => {
    hover = null;
    render();
  });

  window.addEventListener("keydown", (e) => {
    // 文字の入力中は入力欄の元に戻すに任せる
    if (e.target instanceof HTMLInputElement) return;
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

  new ResizeObserver(() => render()).observe(main);

  function update(next: EditorState): void {
    const toolChanged = next.tool !== state.tool;
    const roomsChanged = next.plan.rooms !== state.plan.rooms;
    state = next;
    if (toolChanged || roomsChanged) renderRooms();
    render();
  }

  /** 教室の一覧のボタンを作り直す（教室の数・名前・選択が変わった時だけ） */
  function renderRooms(): void {
    roomList.replaceChildren();
    state.plan.rooms.forEach((room, index) => {
      const b = toolButton(room.name, roomColor(index));
      b.setAttribute(
        "aria-pressed",
        String(isSameTool(state.tool, { kind: "classroom", room: index })),
      );
      b.addEventListener("click", () =>
        update(selectTool(state, { kind: "classroom", room: index })),
      );
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

  function render(): void {
    const floor = editingFloor(state);
    // 大きさを変えてマウスの下のマスが外に出た時は消す
    if (hover !== null && !(hover.x < floor.width && hover.z < floor.depth)) hover = null;
    planName.textContent = state.plan.name;
    for (const { kind, button: b } of partButtons) {
      b.setAttribute("aria-pressed", String(state.tool.kind === kind));
    }
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
    if (ctx !== null) {
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      drawEditorGrid(ctx, floor, state.plan.rooms, layout, w, h, hover);
    }

    if (hover === null) {
      hoverBox.hidden = true;
    } else {
      const i = hover.z * floor.width + hover.x;
      const kind = floor.cells[i];
      const roomName = kind === "classroom" ? state.plan.rooms[floor.roomOf[i]]?.name : undefined;
      hoverBox.hidden = false;
      hoverBox.textContent = `(${hover.x}, ${hover.z}) ${roomName ?? CELL_KIND_LABELS[kind]}`;
    }

    // 塗っている途中は検査しない（ドラッグ中に毎回検査すると重く，途中の誤りが出入りしてちらつくため）
    if (state.stroke === null) renderErrors(validatePlan(state.plan));
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
}

function isSameTool(a: PaintTool, b: PaintTool): boolean {
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
