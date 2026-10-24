// ホーム（home，HTML）．許可の画面の後と，結果画面から戻った時に出す．
// タイトルと「スタート」を置き，ゴーグル装着の案内を出してロビーへ進む．
// 今後ここにシナリオの選択・音量・遊び方の説明を足すため，表示する項目は sections で増やせるようにする

import type { Scene, SceneContext } from "../core/scene";
import { TRAINING_BACKGROUND_CSS, TRAINING_BOX_CSS } from "./trainingTheme";

/** ホームに並べる 1 つの区画（シナリオの選択・音量等を足す時の入れ物） */
export interface HomeSection {
  /** 区画の要素を作る．exit で root ごと取り除くため，片付けが要る物は dispose で返す */
  create(ctx: SceneContext): { readonly element: HTMLElement; dispose?(): void };
}

export interface HomeSceneOptions {
  /** タイトル */
  readonly title?: string;
  /** タイトルと「スタート」の間に並べる区画（無ければ並べない） */
  readonly sections?: readonly HomeSection[];
}

/** ホームのタイトルの既定値（名前は仮） */
export const DEFAULT_HOME_TITLE = "防災シミュレータ（仮）";

/** 「スタート」の前後に出す，ゴーグル装着の案内 */
export const HOME_GOGGLE_GUIDE: readonly string[] = [
  "「スタート」を押したら，スマホを横向きにしてゴーグルに入れ，ゴーグルを着けてください",
  "このあとは画面に触らずに進みます",
];

const STYLE = `
.lobby-home {
  position: absolute; inset: 0; overflow-y: auto; pointer-events: auto;
  display: flex; align-items: center; justify-content: center;
  ${TRAINING_BACKGROUND_CSS}
  color: #f2f4f8;
  font-family: system-ui, -apple-system, "Hiragino Sans", sans-serif;
}
.lobby-home__box { max-width: 640px; margin: 16px; padding: 24px 28px; line-height: 1.6; ${TRAINING_BOX_CSS} }
.lobby-home h1 { font-size: 1.8rem; margin: 0 0 16px; letter-spacing: 0.08em; }
.lobby-home ul { padding-left: 1.2em; margin: 0 0 16px; }
.lobby-home__section { margin: 0 0 16px; }
.lobby-home button {
  font-size: 1.3rem; padding: 12px 40px; border: none; border-radius: 8px;
  background: #ff8a3d; color: #10141c; font-weight: bold;
  box-shadow: 0 4px 16px rgba(255, 138, 61, 0.35);
}
`;

export function createHomeScene(options: HomeSceneOptions = {}): Scene {
  const title = options.title ?? DEFAULT_HOME_TITLE;
  const sections = options.sections ?? [];
  let root: HTMLDivElement | null = null;
  let style: HTMLStyleElement | null = null;
  let disposers: (() => void)[] = [];

  return {
    id: "home",

    enter(ctx: SceneContext) {
      style = document.createElement("style");
      style.textContent = STYLE;
      document.head.appendChild(style);

      root = document.createElement("div");
      root.className = "lobby-home";
      const box = document.createElement("div");
      box.className = "lobby-home__box";

      const heading = document.createElement("h1");
      heading.textContent = title;
      box.appendChild(heading);

      for (const section of sections) {
        const created = section.create(ctx);
        created.element.classList.add("lobby-home__section");
        box.appendChild(created.element);
        if (created.dispose !== undefined) disposers.push(() => created.dispose?.());
      }

      const guide = document.createElement("ul");
      for (const text of HOME_GOGGLE_GUIDE) {
        const item = document.createElement("li");
        item.textContent = text;
        guide.appendChild(item);
      }
      box.appendChild(guide);

      // ゴーグル装着前の操作なのでタップで進める．ゴーグルを着ける時間はロビーの開始ボタンで取る
      const start = document.createElement("button");
      start.type = "button";
      start.textContent = "スタート";
      start.addEventListener("click", () => {
        start.disabled = true;
        ctx.goTo("lobby");
      });
      box.appendChild(start);

      root.appendChild(box);
      ctx.stage.overlay.appendChild(root);
    },

    update() {
      // HTML の画面なので毎フレームの処理は無い
    },

    exit() {
      for (const dispose of disposers) dispose();
      disposers = [];
      root?.remove();
      root = null;
      style?.remove();
      style = null;
    },
  };
}
