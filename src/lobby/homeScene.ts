// ホーム（home，HTML）．許可の画面の後と，結果画面から戻った時に出す．
// タイトルと「スタート」「設定」を置き，ゴーグル装着の案内を出してロビーへ進む．
// 「設定」では音量・画面の明るさ・画面の消灯を確かめる（ホームの中の表示の切り替え．画面（SceneId）は増やさない）．
// 設定を一度も開いていない時に「スタート」を押すと，音量や明るさを確かめたかを聞く．
// 今後ここにシナリオの選択・遊び方の説明を足すため，表示する項目は sections で増やせるようにする

import type { Scene, SceneContext } from "../core/scene";
import { createHomeMemory, type HomeMemory, shouldConfirmStart } from "./homeSettings";
import { createHomeSettingsPanel, HOME_SETTINGS_STYLE } from "./homeSettingsPanel";
import { TRAINING_BACKGROUND_CSS, TRAINING_BOX_CSS } from "./trainingTheme";
import type { ScreenWakeLock } from "./wakeLock";

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
  /**
   * ホームを作り直しても保つ状態（設定を開いたか）．app/ が 1 つだけ作って毎回渡す
   * （無ければホームを作るたびに新しく作る）
   */
  readonly memory?: HomeMemory;
  /** 設定の音量で効果音の例を鳴らす AudioContext（開始画面で再開済みのもの．無ければ null） */
  readonly audioContext?: () => AudioContext | null;
  /** 画面の消灯を止める処理．「スタート」「設定」のタップの中で request を呼ぶ */
  readonly wakeLock?: ScreenWakeLock | null;
}

/** ホームのタイトルの既定値（名前は仮） */
export const DEFAULT_HOME_TITLE = "防災シミュレータ（仮）";

/** 設定を開いていない時に「スタート」を押すと出す問い */
export const HOME_START_CONFIRM = "音量や画面の明るさは大丈夫ですか？";

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
.lobby-home button.secondary { background: #3a4252; color: #f2f4f8; box-shadow: none; }
.lobby-home button:disabled { opacity: 0.5; }
.lobby-home__actions { display: flex; flex-wrap: wrap; gap: 12px; margin-top: 16px; }
.lobby-home__confirm p { font-size: 1.2rem; margin: 0 0 8px; }
${HOME_SETTINGS_STYLE}
`;

export function createHomeScene(options: HomeSceneOptions = {}): Scene {
  const title = options.title ?? DEFAULT_HOME_TITLE;
  const sections = options.sections ?? [];
  const memory = options.memory ?? createHomeMemory();
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
      const buttons: HTMLButtonElement[] = [];
      const button = (text: string, secondary: boolean, onClick: () => void): HTMLButtonElement => {
        const b = document.createElement("button");
        b.type = "button";
        b.textContent = text;
        if (secondary) b.className = "secondary";
        b.addEventListener("click", onClick);
        buttons.push(b);
        return b;
      };
      const goLobby = (): void => {
        for (const b of buttons) b.disabled = true;
        ctx.goTo("lobby");
      };

      // 表示の切り替え: 最初（main）・スタートの確認（confirm）・設定（settings）
      const main = document.createElement("div");
      // タイトルはどの表示でも出し，それ以外を最初の表示に入れる
      main.append(...Array.from(box.childNodes).filter((node) => node !== heading));
      const confirm = document.createElement("div");
      confirm.className = "lobby-home__confirm";
      confirm.hidden = true;
      const settings = createHomeSettingsPanel({
        audioContext: options.audioContext ?? (() => null),
        wakeLock: options.wakeLock ?? null,
        onBack: () => showView("main"),
      });
      settings.element.hidden = true;
      disposers.push(() => settings.dispose());
      box.append(main, confirm, settings.element);

      const showView = (view: "main" | "confirm" | "settings"): void => {
        if (view !== "settings") settings.hide();
        main.hidden = view !== "main";
        confirm.hidden = view !== "confirm";
        settings.element.hidden = view !== "settings";
        root?.scrollTo(0, 0);
      };
      const openSettings = (): void => {
        memory.settingsVisited = true;
        // 設定で状態を見せるため，ここでも頼む（タップの処理の中）
        options.wakeLock?.request();
        showView("settings");
      };

      const mainActions = document.createElement("div");
      mainActions.className = "lobby-home__actions";
      mainActions.append(
        button("スタート", false, () => {
          // 体験の間に画面が消えないよう，タップの処理の中で頼む
          options.wakeLock?.request();
          if (shouldConfirmStart(memory)) showView("confirm");
          else goLobby();
        }),
        button("設定", true, openSettings),
      );
      main.appendChild(mainActions);

      const question = document.createElement("p");
      question.textContent = HOME_START_CONFIRM;
      const confirmActions = document.createElement("div");
      confirmActions.className = "lobby-home__actions";
      confirmActions.append(
        button("設定を確認する", true, openSettings),
        button("このまま始める", false, () => {
          options.wakeLock?.request();
          goLobby();
        }),
      );
      confirm.append(question, confirmActions);

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
