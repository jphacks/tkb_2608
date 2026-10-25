// ゴーグルの付け外しの案内の画面（薄い殻）．app/ が画面の切り替えの間に挟む（決まりは goggleSwitch.ts）．
// VR の中の手で押すボタンを押したら ctx.goTo(next) で本来の次の画面へ進む（Issue #145）．
// 手が使えない時は時間で進む．手が長く見つからない時・Enter / Space・（外す案内の）画面のタップでも進む（詰まらないため）

import type { Object3D } from "three";
import { NARRATION_ID, narrationCue, narrationEndedSignal } from "../core/audioIds";
import type { Unsubscribe } from "../core/event-bus";
import type { Scene, SceneContext, SceneId } from "../core/scene";
import type { Handedness, HandState, Quat, Vec3 } from "../core/types";
import {
  advanceGoggleSwitchElapsed,
  advanceNoHandSeconds,
  DEFAULT_GOGGLE_SWITCH_CONFIG,
  GOGGLE_OFF_BUTTON_LABEL,
  GOGGLE_ON_BUTTON_LABEL,
  GOGGLE_ON_TITLE,
  type GoggleGuidePanel,
  type GoggleSwitchConfig,
  goggleOffPanel,
  goggleOnCaption,
  goggleOnConfirmPanel,
  goggleOnGuideLines,
  goggleOnNeedsConfirm,
  goggleOnRemainingSeconds,
  isGoggleOffDone,
  isGoggleOnConfirmTimeUp,
  isGoggleOnReadDone,
  isHandLost,
  remainingSeconds,
  shouldPromptHand,
} from "./goggleSwitch";
import { isAnyHandTracked } from "./handPrompt";
import { LOBBY_EYE_HEIGHT } from "./lobbyRoom";
import type { LobbyHandMarkers } from "./lobbyScene";
import { createNoticeBoard, type NoticeBoard } from "./noticeBoard";
import { DEFAULT_START_GATE_CONFIG } from "./startGate";
import { TRAINING_BACKGROUND_CSS, TRAINING_BOX_CSS } from "./trainingTheme";

/**
 * 手で押すボタン（実体は scenes/common/handButton.ts の createHandButton．lobby/ は scenes/ を import しないため，
 * app/ が作る関数を渡す．ここでは使う形だけを型にする）
 */
export interface GuideHandButton {
  readonly object: Object3D;
  /** 1 フレーム進める．押したら（押した後も）true */
  update(frame: {
    readonly head: Quat;
    readonly hands: Readonly<Record<Handedness, HandState>>;
    readonly dt: number;
    readonly parentYaw?: number;
  }): boolean;
  /** 押したことにする（キー・タップ等の代わりの操作） */
  press(): void;
  dispose(): void;
}

export interface GuideHandButtonOptions {
  /** ボタンの中心（親の座標，m） */
  readonly position: Vec3;
  readonly label?: string;
  readonly config?: { readonly armSeconds?: number };
}

/** 手で押すボタンを作る関数（app/ が scenes/common/handButton.ts の createHandButton を渡す） */
export type CreateGuideHandButton = (options: GuideHandButtonOptions) => GuideHandButton;

/** ゴーグルの付け外しの案内の画面．左右 2 画面で描くかが途中で変わるため，app/ は毎フレーム stereo() を見る */
export interface GoggleGuideScene extends Scene {
  /** 今，左右 2 画面で描くか */
  stereo(): boolean;
}

/** 外す案内・付ける案内に共通の設定 */
interface GuideOptionsBase {
  /** 案内の後に進む画面 */
  readonly next: SceneId;
  readonly config?: GoggleSwitchConfig;
  /**
   * 手で押すボタンを作る関数．無ければ手を使わず時間で進む
   */
  readonly createHandButton?: CreateGuideHandButton;
  /** 手の印を作る関数（ボタンへ手を合わせやすくするため．無ければ出さない） */
  readonly createHandMarkers?: () => LobbyHandMarkers;
  /**
   * 手を認識できるか（カメラが使える・手をカメラ以外から作る入力）．false なら手のボタンを出さず時間で進む．
   * 案内に入る時に 1 回だけ見る．省くと true
   */
  readonly handsUsable?: () => boolean;
}

/**
 * VR の中で手のボタンを待つ部分（外す案内と，付ける案内の左右 2 画面で共通）．板・ボタン・手の印を置き，
 * 手のボタン・Enter / Space・手が長く見つからない時に「押した」と返す
 */
interface VrConfirm {
  readonly board: NoticeBoard;
  /** 手のボタンで進むか（false なら呼ぶ側が時間で進める） */
  readonly handsUsable: boolean;
  /** 1 フレーム進める．進んでよければ true．paused の間は手が見つからない秒数を数えない */
  update(frame: { readonly dt: number; readonly input: PlayerHands }, paused: boolean): boolean;
  /** 手が見つからないので「手を出して」と案内するか */
  promptHand(): boolean;
  /** 押したことにする（タップ等） */
  press(): void;
  dispose(): void;
}

type PlayerHands = {
  readonly head: Quat;
  readonly hands: Readonly<Record<Handedness, HandState>>;
};

/** ボタンの位置（板の pivot の座標．ロビーの開始ボタンと同じ正面 0.5 m・目の高さ．背面カメラに映る範囲で確かめ済み） */
const GUIDE_BUTTON_OFFSET: Vec3 = DEFAULT_START_GATE_CONFIG.buttonOffset;

function createVrConfirm(
  ctx: SceneContext,
  options: GuideOptionsBase,
  label: string,
  armSeconds: number,
): VrConfirm {
  const config = options.config ?? DEFAULT_GOGGLE_SWITCH_CONFIG;
  const handsUsable = options.createHandButton !== undefined && (options.handsUsable?.() ?? true);
  ctx.stage.rig.position.set(0, LOBBY_EYE_HEIGHT, 0);
  ctx.stage.rig.rotation.set(0, 0, 0);
  const board = createNoticeBoard();
  ctx.stage.world.add(board.object);
  const button =
    handsUsable && options.createHandButton !== undefined
      ? options.createHandButton({ position: GUIDE_BUTTON_OFFSET, label, config: { armSeconds } })
      : null;
  if (button !== null) board.object.add(button.object);
  const markers = handsUsable ? (options.createHandMarkers?.() ?? null) : null;
  if (markers !== null) ctx.stage.rig.add(markers.object);

  let noHand = 0;
  let pressed = false;
  // PC（mock）・カメラが使えない時の逃げ道．ゴーグルの中でも押せるキーボードは無いので，誤って進む心配は少ない
  const onKeyDown = (event: KeyboardEvent): void => {
    if (event.key === "Enter" || event.key === " ") pressed = true;
  };
  window.addEventListener("keydown", onKeyDown);

  return {
    board,
    handsUsable,
    update(frame, paused) {
      board.follow(frame.input.head, frame.dt);
      if (button !== null) {
        if (
          button.update({
            head: frame.input.head,
            hands: frame.input.hands,
            dt: frame.dt,
            parentYaw: board.object.rotation.y,
          })
        ) {
          pressed = true;
        }
        markers?.update(frame.input.head, frame.input.hands, !pressed, frame.dt);
        noHand = advanceNoHandSeconds(
          noHand,
          paused ? 0 : frame.dt,
          isAnyHandTracked(frame.input.hands),
        );
        if (isHandLost(noHand, config)) pressed = true;
      }
      return pressed;
    },
    promptHand: () => button !== null && shouldPromptHand(noHand, config),
    press() {
      pressed = true;
      button?.press();
    },
    dispose() {
      window.removeEventListener("keydown", onKeyDown);
      ctx.stage.world.remove(board.object);
      if (button !== null) {
        board.object.remove(button.object);
        button.dispose();
      }
      board.dispose();
      if (markers !== null) {
        ctx.stage.rig.remove(markers.object);
        markers.dispose();
      }
    },
  };
}

/** 板の内容が変わった時だけ描き直す */
function showPanel(board: NoticeBoard, last: string, panel: GoggleGuidePanel): string {
  const key = `${panel.title}\n${panel.body}\n${panel.caption}`;
  if (key !== last) board.show(panel);
  return key;
}

export interface GoggleOffSceneOptions extends GuideOptionsBase {
  /** true なら画面のタップでも進む（ゴーグルを外せば触れるため）．PC の mock はマウスで手を動かすので false にする */
  readonly allowTap?: boolean;
}

/**
 * ゴーグルを外す案内（VR．左右 2 画面で描く）．避難の画面を片付けた後の何も無い空間に板と手のボタンを出し，
 * 「ゴーグルを外して」のナレーションを流す．ボタンを押したら結果画面へ進む．
 * 縦向きの案内が出ても止めない（ゴーグルを外すと縦向きにされやすく，止めると結果画面へ進めないため）．
 * 左右 2 画面で描く画面として扱うため，id は避難の画面と同じ "scenario" にする
 */
export function createGoggleOffScene(options: GoggleOffSceneOptions): GoggleGuideScene {
  const config = options.config ?? DEFAULT_GOGGLE_SWITCH_CONFIG;
  let vr: VrConfirm | null = null;
  let ctxRef: SceneContext | null = null;
  let unsubscribe: Unsubscribe | null = null;
  let onPointerDown: (() => void) | null = null;
  let elapsed = 0;
  let narrationEnded = false;
  let lastPanel = "";
  let done = false;

  return {
    id: "scenario",
    stereo: () => true,
    enter(ctx) {
      ctxRef = ctx;
      elapsed = 0;
      narrationEnded = false;
      lastPanel = "";
      done = false;
      const confirm = createVrConfirm(
        ctx,
        options,
        GOGGLE_OFF_BUTTON_LABEL,
        config.takeOffArmSeconds,
      );
      vr = confirm;
      lastPanel = showPanel(confirm.board, lastPanel, goggleOffPanel(confirm.handsUsable));
      if (confirm.handsUsable && options.allowTap === true) {
        const tap = (): void => confirm.press();
        onPointerDown = tap;
        window.addEventListener("pointerdown", tap);
      }
      const ended = narrationEndedSignal(NARRATION_ID.gogglesOff);
      unsubscribe = ctx.bus.on("signal", (event) => {
        if (event.name === ended) narrationEnded = true;
      });
      ctx.bus.emit({ type: "cue", cue: narrationCue(NARRATION_ID.gogglesOff) });
    },
    update(frame) {
      const ctx = ctxRef;
      if (ctx === null || vr === null || done) return;
      const pressed = vr.update(frame, false);
      elapsed = advanceGoggleSwitchElapsed(elapsed, frame.dt, false);
      if (vr.handsUsable) {
        lastPanel = showPanel(vr.board, lastPanel, goggleOffPanel(true, vr.promptHand()));
      }
      const go = vr.handsUsable
        ? pressed
        : pressed || isGoggleOffDone(elapsed, narrationEnded, config);
      if (go) {
        done = true;
        ctx.goTo(options.next);
      }
    },
    exit() {
      unsubscribe?.();
      unsubscribe = null;
      if (onPointerDown !== null) window.removeEventListener("pointerdown", onPointerDown);
      onPointerDown = null;
      vr?.dispose();
      vr = null;
      ctxRef = null;
    },
  };
}

export interface GoggleOnSceneOptions extends GuideOptionsBase {
  /** true の間は時間を数えない（縦向きの案内が出ている間は，この案内が読めないため．app/ が渡す） */
  readonly isPaused?: () => boolean;
  /** デモ用の起動（ロビーでなく避難が始まる旨を出す） */
  readonly demo?: boolean;
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
 * スマホをゴーグルにセットする案内．2 つの段階からなる
 * - read（1 画面の HTML）: ゴーグルに入れる前に読む案内．決まった秒数たつか，画面をタップしたら，
 *   ロビーへ進む時はそのままロビーへ（開始ボタンが装着の確認を兼ねる），ロビーを飛ばす時は confirm へ（goggleOnNeedsConfirm）
 * - confirm（VR．左右 2 画面．ロビーを飛ばす時だけ）: 何も無い空間に板と手のボタンを出し，ボタンを押したら本来の次の画面へ進む．
 *   手が使えない時は決まった秒数で進む
 * id はロビーと同じ "lobby" にする（左右 2 画面にするかは stereo() で app/ に伝える）
 */
export function createGoggleOnScene(options: GoggleOnSceneOptions): GoggleGuideScene {
  const config = options.config ?? DEFAULT_GOGGLE_SWITCH_CONFIG;
  const demo = options.demo === true;
  let root: HTMLDivElement | null = null;
  let style: HTMLStyleElement | null = null;
  let caption: HTMLParagraphElement | null = null;
  let vr: VrConfirm | null = null;
  let ctxRef: SceneContext | null = null;
  let elapsed = 0;
  let lastPanel = "";
  let skipRead = false;
  let done = false;

  const removeRead = (): void => {
    root?.remove();
    root = null;
    style?.remove();
    style = null;
    caption = null;
  };

  const startConfirm = (ctx: SceneContext): void => {
    removeRead();
    elapsed = 0;
    vr = createVrConfirm(ctx, options, GOGGLE_ON_BUTTON_LABEL, config.putOnArmSeconds);
    lastPanel = showPanel(
      vr.board,
      "",
      goggleOnConfirmPanel(vr.handsUsable, config.putOnConfirmSeconds, demo),
    );
  };

  return {
    id: "lobby",
    stereo: () => vr !== null,
    enter(ctx) {
      ctxRef = ctx;
      elapsed = 0;
      lastPanel = "";
      skipRead = false;
      done = false;
      const handsUsable =
        options.createHandButton !== undefined && (options.handsUsable?.() ?? true);
      style = document.createElement("style");
      style.textContent = GOGGLE_ON_STYLE;
      document.head.appendChild(style);

      root = document.createElement("div");
      root.className = "lobby-goggle-on";
      root.setAttribute("role", "status");
      // ゴーグルに入れる前に読み終えた人がすぐ進めるよう，タップで左右 2 画面（またはロビー）へ切り替える
      root.addEventListener("click", () => {
        skipRead = true;
      });
      const box = document.createElement("div");
      box.className = "lobby-goggle-on__box";
      const heading = document.createElement("h1");
      heading.textContent = GOGGLE_ON_TITLE;
      const list = document.createElement("ul");
      for (const text of goggleOnGuideLines(handsUsable, demo)) {
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
      const paused = options.isPaused?.() === true;
      elapsed = advanceGoggleSwitchElapsed(elapsed, frame.dt, paused);
      if (vr === null) {
        if (caption !== null) {
          const text = goggleOnCaption(goggleOnRemainingSeconds(elapsed, config));
          // 変わった時だけ書き換える（毎フレームの DOM の更新を避ける）
          if (caption.textContent !== text) caption.textContent = text;
        }
        if (skipRead || isGoggleOnReadDone(elapsed, config)) {
          if (goggleOnNeedsConfirm(options.next)) {
            startConfirm(ctx);
          } else {
            done = true;
            ctx.goTo(options.next);
          }
        }
        return;
      }
      const pressed = vr.update(frame, paused);
      lastPanel = showPanel(
        vr.board,
        lastPanel,
        goggleOnConfirmPanel(
          vr.handsUsable,
          remainingSeconds(elapsed, config.putOnConfirmSeconds),
          demo,
          vr.promptHand(),
        ),
      );
      const go = vr.handsUsable ? pressed : pressed || isGoggleOnConfirmTimeUp(elapsed, config);
      if (go) {
        done = true;
        ctx.goTo(options.next);
      }
    },
    exit() {
      removeRead();
      vr?.dispose();
      vr = null;
      ctxRef = null;
    },
  };
}
