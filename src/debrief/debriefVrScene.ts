// VR の中の結果画面（debrief．左右 2 画面で描く．Issue #146）．避難の後にゴーグルを付けたまま見る．
// 目の前の板に経路の地図・避難時間・煙の中の姿勢を出し，手前の 2 つの手のボタンで「同じ訓練をもう一度」「ホームへ」を選ぶ．
// ゴーグルを外して画面をタップすると，今までの HTML の結果画面（debriefScene.ts）に切り替える（手が使えない時の逃げ道）．
// 配置・行き先の決まりは debriefVrLayout.ts，文字の収め方は boardText.ts の純粋な関数

import * as THREE from "three";
import type { Scene, SceneContext } from "../core/scene";
import type { SchoolPlan } from "../core/schoolPlan";
import type { Handedness, HandState, Quat, Vec3 } from "../core/types";
import { fitBoardText, type MeasureBoardText } from "./boardText";
import {
  createDebriefScene,
  DEBRIEF_HOME_LABEL,
  DEBRIEF_NO_RECORD,
  DEBRIEF_RETRY_LABEL,
  type DebriefTheme,
} from "./debriefScene";
import { type DebriefStat, debriefTitle, describeDrill, describeRouteReveal } from "./debriefText";
import {
  advanceDebriefNoHand,
  type BoardTextSlot,
  DEBRIEF_BOARD,
  DEBRIEF_BOARD_LAYOUT,
  DEBRIEF_BUTTONS,
  DEBRIEF_CANVAS,
  DEBRIEF_VR_LEGEND,
  DEFAULT_DEBRIEF_VR_CONFIG,
  type DebriefAction,
  type DebriefVrConfig,
  debriefActionForKey,
  debriefActionTarget,
  debriefVrCaption,
  followYaw,
  statRowLayouts,
} from "./debriefVrLayout";
import { drawDebriefMap } from "./mapCanvas";
import { fitMapCanvas } from "./mapLayout";
import { buildMapOverlay, defaultDebriefFloor } from "./mapOverlay";

/**
 * 手で押すボタン（実体は scenes/common/handButton.ts の createHandButton．debrief/ は scenes/ を import しないため，
 * app/ が作る関数を渡す．ここでは使う形だけを型にする）
 */
export interface DebriefHandButton {
  readonly object: THREE.Object3D;
  /** 1 フレーム進める．押したら（押した後も）true */
  update(frame: {
    readonly head: Quat;
    readonly hands: Readonly<Record<Handedness, HandState>>;
    readonly dt: number;
    readonly parentYaw?: number;
  }): boolean;
  /** 押したことにする（キー等の代わりの操作） */
  press(): void;
  dispose(): void;
}

/** 手で押すボタンを作る関数（app/ が渡す） */
export type CreateDebriefHandButton = (options: {
  readonly position: Vec3;
  readonly label?: string;
  readonly config?: { readonly armSeconds?: number };
}) => DebriefHandButton;

/** 手の印（実体は scenes/common/handMarkers.ts．app/ が作る関数を渡す） */
export interface DebriefHandMarkers {
  /** rig に足す（目の位置が原点） */
  readonly object: THREE.Object3D;
  update(
    head: Quat,
    hands: Readonly<Record<Handedness, HandState>>,
    visible: boolean,
    dt?: number,
  ): void;
  dispose(): void;
}

export interface DebriefVrSceneOptions {
  /** 手で押すボタンを作る関数．無ければ手のボタンを出さない（キー・タップで選ぶ） */
  readonly createHandButton?: CreateDebriefHandButton;
  /** 手の印を作る関数（無ければ出さない） */
  readonly createHandMarkers?: () => DebriefHandMarkers;
  /** 手を認識できるか（カメラが使える等）．false なら手のボタンを出さない．画面に入る時に 1 回だけ見る．省くと true */
  readonly handsUsable?: () => boolean;
  /** true なら画面のタップでスマホの画面の結果（HTML）に切り替える．PC の mock はマウスで手を動かすので false にする */
  readonly allowTap?: boolean;
  /** スマホの画面に切り替えた後の HTML の結果画面の見た目 */
  readonly theme?: DebriefTheme;
  /** 目の高さ（m．rig と板の pivot を置く高さ） */
  readonly eyeHeight?: number;
  readonly config?: DebriefVrConfig;
}

/** VR の中の結果画面．スマホの画面に切り替えると 1 画面になるため，app/ は毎フレーム stereo() を見る */
export interface DebriefVrScene extends Scene {
  /** 今，左右 2 画面で描くか（スマホの画面の HTML に切り替えた後は false） */
  stereo(): boolean;
}

const DEFAULT_EYE_HEIGHT = 1.6;
/**
 * 画面をタップしてから HTML の結果画面に切り替えるまでの秒数（s）．タップの後に届く click が，
 * 切り替えた直後の HTML のボタンに当たって押されないため
 */
const FLAT_SWITCH_DELAY_SECONDS = 0.4;
const FONT_FAMILY = '"Hiragino Sans", "Noto Sans JP", sans-serif';
const TONE_COLORS: Readonly<Record<DebriefStat["tone"], string>> = {
  good: "#6fe39a",
  warn: "#ffb066",
  neutral: "#f2f4f8",
};

// 頭のヨー角を求める作業用の値（毎フレーム使うため 1 回だけ作る）
const headQuaternion = new THREE.Quaternion();
const headEuler = new THREE.Euler(0, 0, 0, "YXZ");

function headYaw(head: Quat): number {
  headQuaternion.set(head.x, head.y, head.z, head.w);
  return headEuler.setFromQuaternion(headQuaternion, "YXZ").y;
}

function font(px: number, bold: boolean): string {
  return `${bold ? "bold " : ""}${px}px ${FONT_FAMILY}`;
}

/** 枠に収めて描く（上詰め）．align は横の寄せ方 */
function drawText(
  ctx: CanvasRenderingContext2D,
  text: string,
  slot: BoardTextSlot,
  color: string,
  bold: boolean,
  align: "left" | "right" = "left",
): void {
  const measure: MeasureBoardText = (t, px) => {
    ctx.font = font(px, bold);
    return ctx.measureText(t).width;
  };
  const fitted = fitBoardText(text, slot, measure);
  ctx.save();
  ctx.fillStyle = color;
  ctx.font = font(fitted.fontPx, bold);
  ctx.textAlign = align;
  ctx.textBaseline = "top";
  const x = align === "left" ? slot.box.x : slot.box.x + slot.box.width;
  fitted.lines.forEach((line, i) => {
    ctx.fillText(line, x, slot.box.y + i * fitted.lineHeightPx);
  });
  ctx.restore();
}

/** 板の地図の欄に，Session の記録で地図を描く（地図の欄の中に縦横比を保って収め，真ん中に置く） */
function drawMap(
  ctx: CanvasRenderingContext2D,
  plan: SchoolPlan,
  drill: NonNullable<SceneContext["session"]["drill"]>,
): void {
  const floorIndex = defaultDebriefFloor(plan);
  const floor = plan.floors[floorIndex];
  if (floor === undefined) return;
  const box = DEBRIEF_BOARD_LAYOUT.map;
  const fit = fitMapCanvas(floor.width, floor.depth, box.width, box.height, {
    paddingPx: 12,
    maxCellPx: 64,
  });
  const overlay = buildMapOverlay(plan, floorIndex, drill.track, drill.evaluation);
  ctx.save();
  ctx.translate(
    box.x + Math.floor((box.width - fit.cssWidth) / 2),
    box.y + Math.floor((box.height - fit.cssHeight) / 2),
  );
  drawDebriefMap(ctx, floor, overlay, fit.layout, fit.cssWidth, fit.cssHeight);
  ctx.restore();
}

/** 板の中身を描く．caption は評価の欄の下の補足 */
function drawBoard(
  ctx: CanvasRenderingContext2D,
  session: SceneContext["session"],
  caption: string,
): void {
  const { width, height } = DEBRIEF_CANVAS;
  const layout = DEBRIEF_BOARD_LAYOUT;
  ctx.clearRect(0, 0, width, height);
  ctx.fillStyle = "rgba(16, 20, 28, 0.92)";
  ctx.fillRect(0, 0, width, height);
  const plan = session.plan;
  const drill = session.drill;
  drawText(ctx, debriefTitle(plan?.name ?? ""), layout.title, "#ffffff", true);
  if (plan === null || drill === null) {
    drawText(ctx, DEBRIEF_NO_RECORD, layout.message, "#e0e4ec", false);
  } else {
    drawText(ctx, describeRouteReveal(plan.drill.mode), layout.reveal, "#c8d0dc", false);
    drawMap(ctx, plan, drill);
    drawText(ctx, DEBRIEF_VR_LEGEND, layout.legend, "#c8d0dc", false);
    const stats = describeDrill(drill.evaluation);
    statRowLayouts(stats.length).forEach((row, i) => {
      const stat = stats[i];
      if (stat === undefined) return;
      drawText(ctx, stat.label, row.label, "#c8d0dc", false);
      const color = TONE_COLORS[stat.tone];
      if (row.note === null) {
        drawText(ctx, stat.value, row.value, color, true, "right");
      } else {
        drawText(ctx, stat.value, row.value, color, true);
        drawText(ctx, stat.note, row.note, "#e0e4ec", false);
      }
    });
  }
  drawText(ctx, caption, layout.caption, "#ffd27a", false);
}

/** 手のボタンの文字 */
function actionLabel(action: DebriefAction): string {
  return action === "retry" ? DEBRIEF_RETRY_LABEL : DEBRIEF_HOME_LABEL;
}

// createDebriefVrScene で作った画面（app/ が左右 2 画面にするかを画面の側に聞くため，見分けられるようにする）
const createdScenes = new WeakSet<Scene>();

/** VR の中の結果画面か（stereo() を持つ） */
export function isDebriefVrScene(scene: Scene): scene is DebriefVrScene {
  return createdScenes.has(scene);
}

/** VR の中の結果画面を作る */
export function createDebriefVrScene(options: DebriefVrSceneOptions = {}): DebriefVrScene {
  const config = options.config ?? DEFAULT_DEBRIEF_VR_CONFIG;
  const eyeHeight = options.eyeHeight ?? DEFAULT_EYE_HEIGHT;
  let ctxRef: SceneContext | null = null;
  let pivot: THREE.Group | null = null;
  let markers: DebriefHandMarkers | null = null;
  let buttons: { action: DebriefAction; button: DebriefHandButton }[] = [];
  let disposeBoard: (() => void) | null = null;
  let redraw: ((caption: string) => void) | null = null;
  let lastCaption = "";
  let handsUsable = false;
  let noHand = 0;
  let placed = false;
  let done = false;
  // ゴーグルを外して画面をタップした後の HTML の結果画面（null の間は VR）
  let flat: Scene | null = null;
  let onKeyDown: ((event: KeyboardEvent) => void) | null = null;
  let onPointerDown: (() => void) | null = null;
  // タップしてから HTML に切り替えるまでの残りの秒数（null はタップしていない）
  let flatDelay: number | null = null;

  const choose = (action: DebriefAction): void => {
    const ctx = ctxRef;
    if (ctx === null || done) return;
    done = true;
    // キャリブレーション（Session.calibration）は消さない．ロビーは前回の値を保ったまま正面だけを取り直す
    ctx.goTo(debriefActionTarget(action));
  };

  const removeListeners = (): void => {
    if (onKeyDown !== null) window.removeEventListener("keydown", onKeyDown);
    onKeyDown = null;
    if (onPointerDown !== null) window.removeEventListener("pointerdown", onPointerDown);
    onPointerDown = null;
  };

  const disposeVr = (): void => {
    const ctx = ctxRef;
    for (const { button } of buttons) button.dispose();
    buttons = [];
    if (pivot !== null) ctx?.stage.world.remove(pivot);
    pivot = null;
    if (markers !== null) {
      ctx?.stage.rig.remove(markers.object);
      markers.dispose();
    }
    markers = null;
    disposeBoard?.();
    disposeBoard = null;
    redraw = null;
  };

  // スマホの画面（HTML の結果画面）に切り替える．ボタンは HTML のボタンになり，行き先の画面へは app/ がゴーグルを
  // 外している前提で案内を挟む（stereo() が false になるため）
  const switchToFlat = (): void => {
    const ctx = ctxRef;
    if (ctx === null || done || flat !== null) return;
    flatDelay = null;
    removeListeners();
    disposeVr();
    flat = createDebriefScene({ theme: options.theme });
    void flat.enter(ctx);
  };

  const scene: DebriefVrScene = {
    id: "debrief",
    stereo: () => flat === null,
    enter(ctx) {
      ctxRef = ctx;
      done = false;
      flatDelay = null;
      noHand = 0;
      placed = false;
      lastCaption = "";
      flat = null;
      handsUsable = options.createHandButton !== undefined && (options.handsUsable?.() ?? true);
      ctx.stage.rig.position.set(0, eyeHeight, 0);
      ctx.stage.rig.rotation.set(0, 0, 0);

      const group = new THREE.Group();
      group.name = "debrief-vr";
      group.position.set(0, eyeHeight, 0);
      pivot = group;
      ctx.stage.world.add(group);

      // 板（canvas が使えない環境では板を出さない）
      if (typeof document !== "undefined") {
        const canvas = document.createElement("canvas");
        canvas.width = DEBRIEF_CANVAS.width;
        canvas.height = DEBRIEF_CANVAS.height;
        const context = canvas.getContext("2d");
        const texture = new THREE.CanvasTexture(canvas);
        texture.colorSpace = THREE.SRGBColorSpace;
        texture.anisotropy = 4;
        const geometry = new THREE.PlaneGeometry(DEBRIEF_BOARD.width, DEBRIEF_BOARD.height);
        const material = new THREE.MeshBasicMaterial({ map: texture, transparent: true });
        const mesh = new THREE.Mesh(geometry, material);
        mesh.name = "debrief-board";
        mesh.position.set(0, DEBRIEF_BOARD.raise, -DEBRIEF_BOARD.distance);
        group.add(mesh);
        redraw = (caption) => {
          if (context === null) return;
          drawBoard(context, ctx.session, caption);
          texture.needsUpdate = true;
        };
        disposeBoard = () => {
          geometry.dispose();
          material.dispose();
          texture.dispose();
        };
      }

      if (handsUsable && options.createHandButton !== undefined) {
        const create = options.createHandButton;
        buttons = DEBRIEF_BUTTONS.map((spec) => {
          const button = create({
            position: spec.position,
            label: actionLabel(spec.action),
            config: { armSeconds: config.armSeconds },
          });
          group.add(button.object);
          return { action: spec.action, button };
        });
        markers = options.createHandMarkers?.() ?? null;
        if (markers !== null) ctx.stage.rig.add(markers.object);
      }

      // PC（mock）・カメラが使えない時の逃げ道．ゴーグルの中でも押せるキーボードは無いので，誤って進む心配は少ない
      const keyDown = (event: KeyboardEvent): void => {
        const action = debriefActionForKey(event.key);
        if (action !== null) choose(action);
      };
      onKeyDown = keyDown;
      window.addEventListener("keydown", keyDown);
      if (options.allowTap === true) {
        const tap = (): void => {
          flatDelay ??= FLAT_SWITCH_DELAY_SECONDS;
        };
        onPointerDown = tap;
        window.addEventListener("pointerdown", tap);
      }
    },
    update(frame) {
      if (flat !== null) {
        flat.update(frame);
        return;
      }
      if (flatDelay !== null) {
        flatDelay -= Number.isFinite(frame.dt) && frame.dt > 0 ? frame.dt : 0;
        if (flatDelay <= 0) {
          switchToFlat();
          return;
        }
      }
      if (ctxRef === null || pivot === null || done) return;
      const { head, hands } = frame.input;
      const target = headYaw(head);
      // 最初は正面にすぐ出す（入った瞬間に横から回り込んで見えないため）
      pivot.rotation.y = placed ? followYaw(pivot.rotation.y, target, frame.dt) : target;
      placed = true;

      let pressed: DebriefAction | null = null;
      for (const { action, button } of buttons) {
        if (
          button.update({ head, hands, dt: frame.dt, parentYaw: pivot.rotation.y }) &&
          pressed === null
        ) {
          pressed = action;
        }
      }
      noHand = advanceDebriefNoHand(noHand, frame.dt, hands.left.tracked || hands.right.tracked);
      markers?.update(head, hands, pressed === null, frame.dt);

      const caption = debriefVrCaption(
        buttons.length > 0,
        buttons.length > 0 && noHand >= config.handPromptSeconds,
        options.allowTap === true,
      );
      // 変わった時だけ描き直す（canvas の描き直しとテクスチャの転送を毎フレーム行わない）
      if (caption !== lastCaption) {
        lastCaption = caption;
        redraw?.(caption);
      }
      if (pressed !== null) choose(pressed);
    },
    exit() {
      removeListeners();
      if (flat !== null) {
        flat.exit();
        flat = null;
      }
      disposeVr();
      ctxRef = null;
    },
  };
  createdScenes.add(scene);
  return scene;
}
