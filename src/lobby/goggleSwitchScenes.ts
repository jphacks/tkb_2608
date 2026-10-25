// ゴーグルの付け外しの案内の画面（薄い殻）．app/ が画面の切り替えの間に挟む（決まりは goggleSwitch.ts）．
// どちらも画面のタッチは使わず，時間がたったら ctx.goTo(next) で本来の次の画面へ進む

import { NARRATION_ID, narrationCue, narrationEndedSignal } from "../core/audioIds";
import type { Unsubscribe } from "../core/event-bus";
import type { Scene, SceneContext, SceneId } from "../core/scene";
import {
  advanceGoggleSwitchElapsed,
  DEFAULT_GOGGLE_SWITCH_CONFIG,
  GOGGLE_OFF_PANEL,
  GOGGLE_ON_TITLE,
  type GoggleSwitchConfig,
  goggleOnCaption,
  goggleOnGuideLines,
  goggleOnRemainingSeconds,
  isGoggleOffDone,
  isGoggleOnDone,
} from "./goggleSwitch";
import { LOBBY_EYE_HEIGHT } from "./lobbyRoom";
import { createNoticeBoard, type NoticeBoard } from "./noticeBoard";
import { DEFAULT_START_GATE_CONFIG, type StartGateConfig } from "./startGate";
import { TRAINING_BACKGROUND_CSS, TRAINING_BOX_CSS } from "./trainingTheme";

export interface GoggleOffSceneOptions {
  /** 案内の後に進む画面（結果画面） */
  readonly next: SceneId;
  readonly config?: GoggleSwitchConfig;
}

/**
 * ゴーグルを外す案内（VR．左右 2 画面で描く）．避難の画面を片付けた後の何も無い空間に板を出し，
 * 「ゴーグルを外して」のナレーションを流す．縦向きの案内が出ても止めない（ゴーグルを外すと縦向きにされやすく，
 * 止めると結果画面へ進めないため．結果画面はボタンを押すまで待つので，外す途中で切り替わっても困らない）．
 * 左右 2 画面で描く画面として扱うため，id は避難の画面と同じ "scenario" にする
 */
export function createGoggleOffScene(options: GoggleOffSceneOptions): Scene {
  const config = options.config ?? DEFAULT_GOGGLE_SWITCH_CONFIG;
  let board: NoticeBoard | null = null;
  let ctxRef: SceneContext | null = null;
  let unsubscribe: Unsubscribe | null = null;
  let elapsed = 0;
  let narrationEnded = false;
  let done = false;

  return {
    id: "scenario",
    enter(ctx) {
      ctxRef = ctx;
      elapsed = 0;
      narrationEnded = false;
      done = false;
      ctx.stage.rig.position.set(0, LOBBY_EYE_HEIGHT, 0);
      ctx.stage.rig.rotation.set(0, 0, 0);
      board = createNoticeBoard();
      board.show(GOGGLE_OFF_PANEL);
      ctx.stage.world.add(board.object);
      const ended = narrationEndedSignal(NARRATION_ID.gogglesOff);
      unsubscribe = ctx.bus.on("signal", (event) => {
        if (event.name === ended) narrationEnded = true;
      });
      ctx.bus.emit({ type: "cue", cue: narrationCue(NARRATION_ID.gogglesOff) });
    },
    update(frame) {
      const ctx = ctxRef;
      if (ctx === null || board === null || done) return;
      board.follow(frame.input.head, frame.dt);
      elapsed = advanceGoggleSwitchElapsed(elapsed, frame.dt, false);
      if (isGoggleOffDone(elapsed, narrationEnded, config)) {
        done = true;
        ctx.goTo(options.next);
      }
    },
    exit() {
      unsubscribe?.();
      unsubscribe = null;
      if (board !== null) {
        ctxRef?.stage.world.remove(board.object);
        board.dispose();
      }
      board = null;
      ctxRef = null;
    },
  };
}

export interface GoggleOnSceneOptions {
  /** 案内の後に進む画面（ロビー） */
  readonly next: SceneId;
  readonly config?: GoggleSwitchConfig;
  /** ロビーの始め方（案内の文をロビーの開始ボタンの案内に合わせる．無ければロビーの既定） */
  readonly startGateConfig?: StartGateConfig;
  /** true の間は時間を数えない（縦向きの案内が出ている間は，この案内が読めないため．app/ が渡す） */
  readonly isPaused?: () => boolean;
  /** 案内の箇条書きを差し替える（デモ用の起動で，ロビーでなく避難が始まる旨を伝える．無ければロビーへの案内） */
  readonly guideLines?: readonly string[];
}

const GOGGLE_ON_STYLE = `
.lobby-goggle-on {
  position: absolute; inset: 0; overflow-y: auto; pointer-events: auto;
  display: flex; align-items: center; justify-content: center;
  ${TRAINING_BACKGROUND_CSS}
  color: #f2f4f8;
  font-family: system-ui, -apple-system, "Hiragino Sans", sans-serif;
}
.lobby-goggle-on__box { max-width: 680px; margin: 16px; padding: 24px 28px; line-height: 1.6; ${TRAINING_BOX_CSS} }
.lobby-goggle-on h1 { font-size: 1.6rem; margin: 0 0 12px; letter-spacing: 0.04em; }
.lobby-goggle-on ul { padding-left: 1.2em; margin: 0 0 12px; font-size: 1.1rem; }
.lobby-goggle-on__caption { font-size: 1rem; color: #ffd27a; font-weight: bold; margin: 0; }
`;

/**
 * スマホをゴーグルにセットする案内（HTML．ゴーグルを外して見ている画面の続き）．
 * 決まった秒数たったらロビーへ進む（ロビーの開始ボタンが手を待つので，ゴーグルに入れるのが遅れても困らない）．
 * 左右 2 画面にしないため，app/ はこの画面を 1 画面で描く
 */
export function createGoggleOnScene(options: GoggleOnSceneOptions): Scene {
  const config = options.config ?? DEFAULT_GOGGLE_SWITCH_CONFIG;
  const gate = options.startGateConfig ?? DEFAULT_START_GATE_CONFIG;
  let root: HTMLDivElement | null = null;
  let style: HTMLStyleElement | null = null;
  let caption: HTMLParagraphElement | null = null;
  let ctxRef: SceneContext | null = null;
  let elapsed = 0;
  let done = false;

  return {
    id: "lobby",
    enter(ctx) {
      ctxRef = ctx;
      elapsed = 0;
      done = false;
      style = document.createElement("style");
      style.textContent = GOGGLE_ON_STYLE;
      document.head.appendChild(style);

      root = document.createElement("div");
      root.className = "lobby-goggle-on";
      root.setAttribute("role", "status");
      const box = document.createElement("div");
      box.className = "lobby-goggle-on__box";
      const heading = document.createElement("h1");
      heading.textContent = GOGGLE_ON_TITLE;
      const list = document.createElement("ul");
      for (const text of options.guideLines ?? goggleOnGuideLines(gate)) {
        const item = document.createElement("li");
        item.textContent = text;
        list.appendChild(item);
      }
      caption = document.createElement("p");
      caption.className = "lobby-goggle-on__caption";
      caption.textContent = goggleOnCaption(goggleOnRemainingSeconds(elapsed, config));
      box.append(heading, list, caption);
      root.appendChild(box);
      ctx.stage.overlay.appendChild(root);
    },
    update(frame) {
      const ctx = ctxRef;
      if (ctx === null || done) return;
      elapsed = advanceGoggleSwitchElapsed(elapsed, frame.dt, options.isPaused?.() === true);
      if (caption !== null) {
        const text = goggleOnCaption(goggleOnRemainingSeconds(elapsed, config));
        // 変わった時だけ書き換える（毎フレームの DOM の更新を避ける）
        if (caption.textContent !== text) caption.textContent = text;
      }
      if (isGoggleOnDone(elapsed, config)) {
        done = true;
        ctx.goTo(options.next);
      }
    },
    exit() {
      root?.remove();
      root = null;
      style?.remove();
      style = null;
      caption = null;
      ctxRef = null;
    },
  };
}
