// 開始画面（許可の画面，start，HTML）．安全確認の案内を出し，
// ボタン 1 回でセンサー・カメラ・音の許可をまとめて取ってホームへ進む．
// 起動直後の 1 回だけ出す（ゴーグル装着の案内はホームで出す．Issue #40）

import type { Scene, SceneContext } from "../core/scene";
import { unlockNarration } from "./narrator";
import {
  type AcquiredDevices,
  requestAllPermissions,
  requestMotionPermission,
} from "./permissions";
import { decideStart, type StartDecision } from "./startPolicy";
import { TRAINING_BACKGROUND_CSS, TRAINING_BOX_CSS } from "./trainingTheme";

export interface StartSceneOptions {
  /** 許可を取り終えた時に，取れた機器を受け取る（app/ が input/・audio/ に渡すため） */
  readonly onDevices?: (devices: AcquiredDevices) => void;
  /** 案内（カメラが使えない等）を見せてから進むまでの秒数 */
  readonly noticeSeconds?: number;
}

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
.lobby-start__status { min-height: 1.6em; margin-top: 12px; color: #ffd27a; white-space: pre-line; }
`;

export function createStartScene(options: StartSceneOptions = {}): Scene {
  const noticeSeconds = options.noticeSeconds ?? 4;
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

      root = document.createElement("div");
      root.className = "lobby-start";
      root.innerHTML = `
        <div class="lobby-start__box">
          <h1>防災体験VR</h1>
          <ul>
            <li>周りに 1〜2 m の広さがあり，ぶつかる物が無いことを確かめてください</li>
            <li>センサー・カメラ・音の許可を求められたら「許可」を選んでください</li>
          </ul>
          <div class="lobby-start__actions">
            <button type="button" data-action="start">はじめる</button>
          </div>
          <div class="lobby-start__status" aria-live="polite"></div>
        </div>`;
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
            handle(decideStart(devices.results));
          });
        });
        skip.addEventListener("click", () => {
          if (devices === null) return;
          handle(decideStart(devices.results, { allowWithoutMotion: true }));
        });
      };

      const handle = (decision: StartDecision): void => {
        if (!active) return;
        if (decision.kind === "needsMotion") {
          showMotionHelp(decision.message);
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
        void requestAllPermissions().then((acquired) => {
          devices = acquired;
          handle(decideStart(acquired.results));
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
