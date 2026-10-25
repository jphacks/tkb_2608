// 開始画面（許可の画面，start，HTML）．安全確認の案内を出し，
// ボタン 1 回でセンサー・カメラ・音の許可をまとめて取ってホームへ進む．
// 起動直後の 1 回だけ出す（ゴーグル装着の案内はホームで出す．Issue #40）．
// カメラが使えない時は先へ進まず，再読み込みしてカメラを許可するよう案内する（ロビーの開始が手のため．Issue #110）．
// PC モード（pc を渡した時．Issue #205）は音だけを使えるようにし，操作の説明を出してロビーへ進む（センサー・カメラ・ゴーグルの案内は出さない）．
// どちらの画面にも，トップへ戻る入口（topHref）を出す（トップで選び直せるように）

import type { Scene, SceneContext } from "../core/scene";
import { unlockNarration } from "./narrator";
import {
  type AcquiredDevices,
  requestAllPermissions,
  requestAudioOnly,
  requestMotionPermission,
} from "./permissions";
import { decideStart, type StartDecision } from "./startPolicy";
import { TRAINING_BACKGROUND_CSS, TRAINING_BOX_CSS } from "./trainingTheme";

export interface StartSceneOptions {
  /** 許可を取り終えた時に，取れた機器を受け取る（app/ が input/・audio/ に渡すため） */
  readonly onDevices?: (devices: AcquiredDevices) => void;
  /**
   * 「はじめる」のタップの処理の中で呼ぶ（app/ が画面の消灯を止める処理を頼む．ユーザーの操作の中で頼む必要がある端末のため）
   */
  readonly onStartTap?: () => void;
  /** 案内（音が出ない等）を見せてから進むまでの秒数 */
  readonly noticeSeconds?: number;
  /**
   * カメラが使えなければ先へ進まない（既定 true）．手をカメラ以外から作る入力（PC の mock・記録の再生）では
   * app/ が false にする（startPolicy.ts の StartDecisionOptions.requireCamera）
   */
  readonly requireCamera?: boolean;
  /**
   * PC モード（マウス・キーボードで体験する）の時に渡す．センサー・カメラの許可を求めず，音だけを使えるようにして
   * ロビーへ進む．controls は操作の説明（1 行ずつ）
   */
  readonly pc?: { readonly controls: readonly string[] } | null;
  /** トップ（体験の選び直し）の URL（app/ が渡す．null・省略なら「トップへ戻る」を出さない） */
  readonly topHref?: string | null;
}

/** PC モードの開始画面の説明（1 段落ずつ） */
export const PC_START_LINES: readonly string[] = [
  "PC のマウスとキーボードで，火事の校舎から避難する訓練を体験します．音が出ます",
  "訓練の説明を聞いたあと，非常ベルが鳴ったら教室から校庭の集合場所まで逃げます．煙の中ではしゃがんで進みましょう",
];

/** トップへ戻る入口の文字 */
export const START_BACK_TO_TOP_LABEL = "トップへ戻る";

const STYLE = `
.lobby-start {
  position: absolute; inset: 0; overflow-y: auto; pointer-events: auto;
  display: flex; align-items: center; justify-content: center;
  ${TRAINING_BACKGROUND_CSS}
  color: #f2f4f8;
  font-family: system-ui, -apple-system, "Hiragino Sans", sans-serif;
}
.lobby-start__box { max-width: 640px; margin: 16px; padding: 24px 28px; line-height: 1.6; ${TRAINING_BOX_CSS} }
.lobby-start h1 { font-size: 1.5rem; margin: 0 0 12px; }
.lobby-start ul { padding-left: 1.2em; margin: 0 0 16px; }
.lobby-start button {
  font-size: 1.2rem; padding: 12px 32px; margin: 4px 8px 4px 0; border: none; border-radius: 8px;
  background: #ff8a3d; color: #10141c; font-weight: bold;
}
.lobby-start button.secondary { background: #3a4252; color: #f2f4f8; }
.lobby-start button:disabled { opacity: 0.5; }
.lobby-start a.lobby-start__back {
  display: inline-block; font-size: 1.05rem; padding: 10px 24px; margin: 4px 8px 4px 0; border-radius: 8px;
  background: #3a4252; color: #f2f4f8; font-weight: bold; text-decoration: none;
}
.lobby-start__status { min-height: 1.6em; margin-top: 12px; color: #ffd27a; white-space: pre-line; }
`;

export function createStartScene(options: StartSceneOptions = {}): Scene {
  const noticeSeconds = options.noticeSeconds ?? 4;
  const requireCamera = options.requireCamera ?? true;
  let root: HTMLDivElement | null = null;
  let style: HTMLStyleElement | null = null;
  let timer: number | null = null;
  let active = false;

  return {
    id: "start",

    enter(ctx: SceneContext) {
      active = true;
      style = document.createElement("style");
      style.textContent = STYLE;
      document.head.appendChild(style);

      const pc = options.pc ?? null;
      if (pc !== null) {
        root = createPcStart(pc.controls, options.topHref ?? null, () => {
          // 音の再生の解除はクリックの処理の中で呼び始める
          unlockNarration();
          options.onStartTap?.();
          void requestAudioOnly().then((acquired) => {
            if (!active) return;
            options.onDevices?.(acquired);
            // ゴーグルを使わないのでホーム（ゴーグルの装着の案内）を通らず，ロビー（訓練の説明）へ進む
            ctx.goTo("lobby");
          });
        });
        ctx.stage.overlay.appendChild(root);
        return;
      }

      root = document.createElement("div");
      root.className = "lobby-start";
      root.innerHTML = `
        <div class="lobby-start__box">
          <h1>ひなんクラフトVR</h1>
          <ul>
            <li>周りに 1〜2 m の広さがあり，ぶつかる物が無いことを確かめてください</li>
            <li>センサー・カメラ・音の許可を求められたら「許可」を選んでください</li>
          </ul>
          <div class="lobby-start__actions">
            <button type="button" data-action="start">はじめる</button>
          </div>
          <div class="lobby-start__status" aria-live="polite"></div>
        </div>`;
      // 「はじめる」の横に置く（押した後は actions ごと消え，許可の途中で戻らない）
      const backLink = createBackToTopLink(options.topHref ?? null);
      if (backLink !== null) root.querySelector(".lobby-start__actions")?.appendChild(backLink);
      ctx.stage.overlay.appendChild(root);

      const actions = root.querySelector<HTMLDivElement>(".lobby-start__actions");
      const status = root.querySelector<HTMLDivElement>(".lobby-start__status");
      const startButton = root.querySelector<HTMLButtonElement>('button[data-action="start"]');
      if (actions === null || status === null || startButton === null) return;

      let devices: AcquiredDevices | null = null;

      const proceed = (decision: Extract<StartDecision, { kind: "proceed" }>): void => {
        if (!active) return;
        actions.replaceChildren();
        if (decision.notices.length === 0) {
          ctx.goTo("home");
          return;
        }
        status.textContent = `${decision.notices.join("\n")}\n\nまもなく次へ進みます`;
        timer = window.setTimeout(() => {
          timer = null;
          if (active) ctx.goTo("home");
        }, noticeSeconds * 1000);
      };

      const showMotionHelp = (message: string): void => {
        status.textContent = message;
        const retry = document.createElement("button");
        retry.type = "button";
        retry.textContent = "もう一度試す";
        const skip = document.createElement("button");
        skip.type = "button";
        skip.className = "secondary";
        skip.textContent = "センサーなしで進む";
        actions.replaceChildren(retry, skip);

        retry.addEventListener("click", () => {
          retry.disabled = true;
          skip.disabled = true;
          // タップの処理の中で呼ぶ（iOS）
          void requestMotionPermission().then((motion) => {
            if (devices === null) return;
            devices = { ...devices, results: { ...devices.results, motion } };
            handle(decideStart(devices.results, { allowWithoutMotion: false, requireCamera }));
          });
        });
        skip.addEventListener("click", () => {
          if (devices === null) return;
          handle(decideStart(devices.results, { allowWithoutMotion: true, requireCamera }));
        });
      };

      // カメラは iOS の Safari では再読み込みするまで尋ね直さないため，再読み込みのボタンだけを出す
      const showCameraHelp = (message: string): void => {
        status.textContent = message;
        const reload = document.createElement("button");
        reload.type = "button";
        reload.textContent = "再読み込み";
        reload.addEventListener("click", () => {
          window.location.reload();
        });
        actions.replaceChildren(reload);
      };

      const handle = (decision: StartDecision): void => {
        if (!active) return;
        if (decision.kind === "needsMotion") {
          showMotionHelp(decision.message);
          return;
        }
        if (decision.kind === "needsCamera") {
          showCameraHelp(decision.message);
          return;
        }
        if (devices !== null) options.onDevices?.(devices);
        proceed(decision);
      };

      startButton.addEventListener("click", () => {
        startButton.disabled = true;
        status.textContent = "許可を確認しています…";
        // どちらもタップの処理の中で呼び始める（iOS）
        unlockNarration();
        options.onStartTap?.();
        void requestAllPermissions().then((acquired) => {
          devices = acquired;
          handle(decideStart(acquired.results, { allowWithoutMotion: false, requireCamera }));
        });
      });
    },

    update() {
      // HTML の画面なので毎フレームの処理は無い
    },

    exit() {
      active = false;
      if (timer !== null) window.clearTimeout(timer);
      timer = null;
      root?.remove();
      root = null;
      style?.remove();
      style = null;
    },
  };
}

/** PC モードの開始画面（説明・操作・「はじめる」・「トップへ戻る」）．onStart は「はじめる」のクリックの中で呼ぶ */
function createPcStart(
  controls: readonly string[],
  topHref: string | null,
  onStart: () => void,
): HTMLDivElement {
  const root = document.createElement("div");
  root.className = "lobby-start";
  const box = document.createElement("div");
  box.className = "lobby-start__box";
  const title = document.createElement("h1");
  title.textContent = "ひなんクラフトVR（PC で体験）";
  box.appendChild(title);
  for (const line of PC_START_LINES) {
    const p = document.createElement("p");
    p.textContent = line;
    box.appendChild(p);
  }
  const heading = document.createElement("p");
  heading.textContent = "操作";
  heading.style.fontWeight = "bold";
  heading.style.margin = "0 0 4px";
  const list = document.createElement("ul");
  for (const line of controls) {
    const item = document.createElement("li");
    item.textContent = line;
    list.appendChild(item);
  }
  const button = document.createElement("button");
  button.type = "button";
  button.dataset.action = "start";
  button.textContent = "はじめる";
  button.addEventListener("click", () => {
    button.disabled = true;
    onStart();
  });
  const actions = document.createElement("div");
  actions.appendChild(button);
  const backLink = createBackToTopLink(topHref);
  if (backLink !== null) actions.appendChild(backLink);
  box.append(heading, list, actions);
  root.appendChild(box);
  return root;
}

/** 「トップへ戻る」の入口．href が null なら作らない */
function createBackToTopLink(href: string | null): HTMLAnchorElement | null {
  if (href === null) return null;
  const link = document.createElement("a");
  link.className = "lobby-start__back";
  link.href = href;
  link.textContent = START_BACK_TO_TOP_LABEL;
  return link;
}
