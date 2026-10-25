// ホーム（home，HTML）．許可の画面の後と，結果画面から戻った時に出す．
// タイトルと「スタート」「設定」を置き，ゴーグル装着の案内を出してロビーへ進む．
// 「設定」では音量・画面の明るさ・画面の消灯を確かめる（ホームの中の表示の切り替え．画面（SceneId）は増やさない）．
// 設定を一度も開いていない時に「スタート」を押すと，音量や明るさを確かめたかを聞く．
// 「スタート」は，カメラで手を認識できる時は手をかざしても押せる（Issue #147．タッチでも押せるまま）．
// 今後ここにシナリオの選択・遊び方の説明を足すため，表示する項目は sections で増やせるようにする

import type { FrameInfo, Scene, SceneContext } from "../core/scene";
import {
  type HomeHandPress,
  type HomeHandStart,
  handScreenPoints,
  isAnyPointInRect,
} from "./homeHandStart";
import { createHomeMemory, type HomeMemory, shouldConfirmStart } from "./homeSettings";
import {
  createHomeSettingsPanel,
  HOME_SETTINGS_STYLE,
  type VolumeCheckAlarm,
} from "./homeSettingsPanel";
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
  /** 設定の音量の確認で鳴らす非常ベル（app/ が audio/ の非常ベルを渡す．無ければ警報の例を鳴らす） */
  readonly volumeCheckAlarm?: VolumeCheckAlarm | null;
  /** 画面の消灯を止める処理．「スタート」「設定」のタップの中で request を呼ぶ */
  readonly wakeLock?: ScreenWakeLock | null;
  /** 「スタート」を手で押す仕組み（app/ が渡す．無ければタッチだけで押す） */
  readonly handStart?: HomeHandStart | null;
}

/** ホームのタイトルの既定値（トップの画面・開始画面と同じアプリの名前） */
export const DEFAULT_HOME_TITLE = "ひなんクラフトVR";

/** 設定を開いていない時に「スタート」を押すと出す問い */
export const HOME_START_CONFIRM = "音量や画面の明るさは大丈夫ですか？";

/** 手で「スタート」を押せる時に出す案内 */
export const HOME_HAND_START_HINT =
  "スマホの後ろに手をかざし，画面の丸を「スタート」に重ねたまま 1 秒待っても押せます";

/** 手の印が「スタート」に重なっているとみなす，ボタンの周りの余白（px）．手の位置は揺れるため少し広げる */
export const HOME_HAND_START_MARGIN_PX = 16;

/** 「スタート」の前後に出す，ゴーグル装着の案内 */
export const HOME_GOGGLE_GUIDE: readonly string[] = [
  "「スタート」を押したら，スマホを横向きにしてゴーグルに入れ，ゴーグルを着けてください",
  "このあとは画面に触らずに進みます",
  "画面の回転ロックはオフにしてください（オンのままだと，画面が逆さまになることがあります）",
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
.lobby-home button.lobby-home__start {
  background: linear-gradient(to right, #ffd27a calc(var(--hand-progress, 0) * 100%), #ff8a3d 0);
}
.lobby-home__hand-hint { margin: 0 0 8px; color: #ffd27a; }
.lobby-home__hand {
  position: fixed; left: 0; top: 0; width: 44px; height: 44px; margin: -22px 0 0 -22px;
  border: 4px solid #f2f4f8; border-radius: 50%; background: rgba(255, 210, 122, 0.35);
  box-shadow: 0 0 12px rgba(0, 0, 0, 0.5); pointer-events: none; z-index: 2;
}
.lobby-home__hand.is-over { border-color: #ffd27a; background: rgba(255, 210, 122, 0.7); }
.lobby-home.is-pointer-through, .lobby-home.is-pointer-through .lobby-home__box { pointer-events: none; }
.lobby-home.is-pointer-through button { pointer-events: auto; }
.lobby-home.is-pointer-through button.lobby-home__start { pointer-events: none; }
${HOME_SETTINGS_STYLE}
`;

export function createHomeScene(options: HomeSceneOptions = {}): Scene {
  const title = options.title ?? DEFAULT_HOME_TITLE;
  const sections = options.sections ?? [];
  const memory = options.memory ?? createHomeMemory();
  let root: HTMLDivElement | null = null;
  let style: HTMLStyleElement | null = null;
  let disposers: (() => void)[] = [];
  // 手で押す「スタート」の毎フレームの処理（手で押せない時は null）
  let handFrame: ((frame: FrameInfo) => void) | null = null;

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

      const handStart = options.handStart ?? null;
      const handsUsable = handStart?.handsUsable() ?? false;
      if (handsUsable) {
        const hint = document.createElement("p");
        hint.className = "lobby-home__hand-hint";
        hint.textContent = HOME_HAND_START_HINT;
        box.appendChild(hint);
      }

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
      let leaving = false;
      const goLobby = (): void => {
        leaving = true;
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
        alarm: options.volumeCheckAlarm ?? null,
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
        // 最初の表示に戻るたびに数え直す（設定から戻った手でそのまま押さないため）
        if (view === "main") resetHandPress();
      };
      const openSettings = (): void => {
        memory.settingsVisited = true;
        // 設定で状態を見せるため，ここでも頼む（タップの処理の中）
        options.wakeLock?.request();
        showView("settings");
      };

      const mainActions = document.createElement("div");
      mainActions.className = "lobby-home__actions";
      const start = (): void => {
        // 体験の間に画面が消えないよう，タップの処理の中で頼む（手で押した時はタップの外なので，
        // 取れない端末では開始画面のタップで取ったものに頼る）
        options.wakeLock?.request();
        if (shouldConfirmStart(memory)) showView("confirm");
        else goLobby();
      };
      const startButton = button("スタート", false, start);
      startButton.classList.add("lobby-home__start");
      mainActions.append(startButton, button("設定", true, openSettings));
      main.appendChild(mainActions);

      // 手で押す「スタート」（手を認識できる時だけ．タッチで押せるのは変わらない）
      let press: HomeHandPress | null = null;
      const resetHandPress = (): void => {
        press = handStart !== null && handsUsable ? handStart.createPress() : null;
        startButton.style.setProperty("--hand-progress", "0");
      };
      if (handStart !== null && handsUsable) {
        if (handStart.pointerThrough === true) root.classList.add("is-pointer-through");
        const marks = {
          left: document.createElement("div"),
          right: document.createElement("div"),
        };
        for (const mark of [marks.left, marks.right]) {
          mark.className = "lobby-home__hand";
          mark.hidden = true;
          root.appendChild(mark);
        }
        handFrame = ({ dt, input }) => {
          const width = window.innerWidth;
          const height = window.innerHeight;
          const points = handScreenPoints(input.hands, handStart.view, width, height);
          // 押せるのは最初の表示（確認の問い・設定を出している間は押さない）
          const active = !leaving && !main.hidden && !(handStart.isPaused?.() ?? false);
          const over =
            active &&
            isAnyPointInRect(
              points,
              startButton.getBoundingClientRect(),
              HOME_HAND_START_MARGIN_PX,
            );
          for (const side of ["left", "right"] as const) {
            const point = points[side];
            const mark = marks[side];
            mark.hidden = !active || point === null;
            if (point === null) continue;
            mark.style.transform = `translate(${point.x}px, ${point.y}px)`;
            mark.classList.toggle("is-over", over);
          }
          if (!active || press === null) return;
          const pressed = press.advance(dt, over);
          startButton.style.setProperty("--hand-progress", String(press.progress));
          if (pressed) start();
        };
      }
      resetHandPress();

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

    update(frame: FrameInfo) {
      // 手で押す「スタート」の判定だけを毎フレーム行う（手で押せない時は何もしない）
      handFrame?.(frame);
    },

    exit() {
      handFrame = null;
      for (const dispose of disposers) dispose();
      disposers = [];
      root?.remove();
      root = null;
      style?.remove();
      style = null;
    },
  };
}
