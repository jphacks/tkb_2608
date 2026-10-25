// 道具箱の見出し（h2）をクリック・キーボードで開閉できるようにする薄い殻．見出しの中にボタン（aria-expanded）を置き，
// 次の見出しまでの要素を 1 つのまとまりに包んで hidden で隠す（作り直さないので，各パネルの状態はそのまま残る）．
// 開閉の状態の覚え方は sectionFold.ts
import type { PlanStorageLike } from "./planStorage";
import {
  isSectionOpen,
  loadClosedSections,
  saveClosedSections,
  setSectionOpen,
} from "./sectionFold";

/** 開閉の印（開いている時・閉じている時） */
export const FOLD_MARKS = { open: "▾", closed: "▸" } as const;

/** 開閉の見出しとまとまりの見た目（editor.ts の STYLE に足す） */
export const FOLD_STYLE = `
.editor__side h2 .editor__fold {
  display: flex; align-items: center; gap: 4px; width: 100%; padding: 0; text-align: left;
  background: none; border: 0; color: inherit; font: inherit; cursor: pointer;
}
.editor__side h2 .editor__fold:hover { color: #e8edf3; }
.editor__side h2 .editor__fold:focus-visible { outline: 2px solid #5b9bff; outline-offset: 2px; }
.editor__fold-mark { flex: none; width: 1em; text-align: center; }
.editor__section[hidden] { display: none; }
`;

/**
 * container の直下の h2 を開閉の見出しにし，次の h2 までの要素をまとまりに包む．
 * 直下に h2 を持つ子（routePanel.element 等のパネル）は，その中の h2 ごとに同じようにする（パネルの中の見出しも項目にする）．
 * 項目の名前は見出しの文字で，開閉は storage に覚える（使えない時は開いた状態で始まり，覚えないだけで開閉はできる）．
 * 最初の h2 より前の要素（題・校舎の名前等）はそのまま残す．呼んだ後に container へ足した要素は包まない
 */
export function makeSectionsFoldable(
  container: HTMLElement,
  storage: PlanStorageLike | null,
): void {
  let closed = loadClosedSections(storage);
  let count = 0;

  const setOpen = (id: string, open: boolean): void => {
    closed = setSectionOpen(closed, id, open);
    saveClosedSections(storage, closed);
  };

  const attach = (h: HTMLHeadingElement): HTMLElement => {
    const id = h.textContent ?? "";
    const body = document.createElement("div");
    body.className = "editor__section";
    body.id = `editor-section-${++count}`;
    const toggle = document.createElement("button");
    toggle.type = "button";
    toggle.className = "editor__fold";
    toggle.setAttribute("aria-controls", body.id);
    const mark = document.createElement("span");
    mark.className = "editor__fold-mark";
    mark.setAttribute("aria-hidden", "true");
    const text = document.createElement("span");
    text.textContent = id;
    toggle.append(mark, text);
    h.replaceChildren(toggle);
    h.after(body);

    const show = (open: boolean): void => {
      body.hidden = !open;
      mark.textContent = open ? FOLD_MARKS.open : FOLD_MARKS.closed;
      toggle.setAttribute("aria-expanded", String(open));
    };
    show(isSectionOpen(closed, id));
    toggle.addEventListener("click", () => {
      const open = body.hidden !== false;
      show(open);
      setOpen(id, open);
    });
    return body;
  };

  const fold = (parent: HTMLElement): void => {
    let body: HTMLElement | null = null;
    // 包むと子の並びが変わるので，先に写しておく
    for (const child of Array.from(parent.children)) {
      if (child instanceof HTMLHeadingElement && child.tagName === "H2") {
        body = attach(child);
      } else if (child instanceof HTMLElement && hasOwnHeading(child)) {
        // パネルは自分の見出しで項目を作るので，前の項目には入れない
        body = null;
        fold(child);
      } else if (body !== null) {
        body.appendChild(child);
      }
    }
  };
  fold(container);
}

/** 直下に h2 を持つか（見出しを持つパネルの要素か） */
function hasOwnHeading(element: HTMLElement): boolean {
  return Array.from(element.children).some(
    (c) => c instanceof HTMLHeadingElement && c.tagName === "H2",
  );
}
