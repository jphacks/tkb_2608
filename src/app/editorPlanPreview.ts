// エディタの view モードの実体（editor/planPreview.ts の PlanPreview）．編集中の SchoolPlan から scenes/school の校舎の 3D を作り，
// PC のマウス（ドラッグで見回す）とキー（W/S・矢印で歩く，A/D・←/→ で向きを変える，C でしゃがむ）で歩いて確かめる．
// 開く時にレンダラー・シーンを作り，dispose で animation loop・イベント・three.js の物・WebGL のコンテキストをすべて解放する
import * as THREE from "three";
import { devPlayerInput, lookToQuat } from "../controls/devInput";
import { DragLook } from "../controls/dragLook";
import { type LookAngles, wrapAngle } from "../controls/lookAngles";
import type { SchoolPlan } from "../core/schoolPlan";
import type { Posture } from "../core/types";
import type { PlanPreview, PlanPreviewSession } from "../editor/planPreview";
import { createSchoolScene, type SchoolSpace } from "../scenes/school/schoolPlanScene";
import { createSchoolWalkWorld } from "../scenes/school/schoolPlanWalk";
import { SpaceWalker } from "../scenes/walk/walker";
import {
  advanceKeyTurn,
  CROUCH_KEY,
  PREVIEW_KEYS,
  previewMove,
  walkLook,
} from "./editorPreviewInput";
import { withResolvedRoute } from "./resolvedRoute";

/** 火と煙を止めておく非常ベルからの時刻（s）．延焼は進めず，火元が燃え始めた時点の見た目にする */
const PREVIEW_ALARM_SECONDS = 0;

/** 画面の左下に出す操作の説明 */
const HELP_TEXT =
  "ドラッグ: 見回す　W・↑: 前へ　S・↓: 後ろへ　A・D・←・→: 向きを変える　C: しゃがむ・立つ";

const HELP_STYLE = [
  "position: absolute",
  "left: 8px",
  "bottom: 8px",
  "padding: 4px 10px",
  "border-radius: 4px",
  "background: rgba(16, 20, 28, 0.75)",
  "color: #e8edf3",
  "font-size: 12px",
  "white-space: pre-line",
  "pointer-events: none",
].join(";");

/** 編集中の校舎を 3D で見せる部品を作る（main.ts の ?editor の分岐からエディタへ渡す） */
export function createEditorPlanPreview(): PlanPreview {
  return { open: openPlanPreview };
}

function openPlanPreview(container: HTMLElement, sourcePlan: SchoolPlan): PlanPreviewSession {
  // 生徒の体験（drillScene）と同じく，経路が空の校舎は提案の経路で埋めて床の矢印をそろえる
  const plan = withResolvedRoute(sourcePlan);
  const renderer = new THREE.WebGLRenderer({ antialias: true });
  // 校舎の組み立てが失敗した時もレンダラーを残さない
  let space: SchoolSpace;
  try {
    space = createSchoolScene(
      { maxAnisotropy: Math.min(renderer.capabilities.getMaxAnisotropy(), 8) },
      plan,
    );
  } catch (error) {
    renderer.dispose();
    renderer.forceContextLoss();
    throw error;
  }
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  const canvas = renderer.domElement;
  canvas.style.cssText = "position: absolute; inset: 0; width: 100%; height: 100%; display: block;";
  container.appendChild(canvas);

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(space.background);
  scene.fog = space.fog;
  scene.add(space.root);

  // 生徒の体験（app.ts）と同じ画角・描画距離
  const camera = new THREE.PerspectiveCamera(70, 1, 0.05, 50);
  const rig = new THREE.Object3D();
  rig.add(camera);
  scene.add(rig);

  const walker = new SpaceWalker(
    createSchoolWalkWorld(space),
    { position: space.startPosition, bodyYaw: space.startYaw },
    () => {},
  );
  walker.applyTo(rig);

  const help = document.createElement("div");
  help.style.cssText = HELP_STYLE;
  container.appendChild(help);

  // 頭の向きは体の向き（開始時の向き）から見た値．ドラッグの分とキーで回した分を足す
  const look = new DragLook(canvas, { yaw: 0, pitch: 0 });
  let keyTurn = 0;
  let crouching = false;
  const pressed = new Set<string>();

  const onKeyDown = (e: KeyboardEvent): void => {
    if (e.ctrlKey || e.metaKey || e.altKey || !PREVIEW_KEYS.has(e.code)) return;
    e.preventDefault();
    if (e.code === CROUCH_KEY) {
      if (!e.repeat) crouching = !crouching;
      return;
    }
    pressed.add(e.code);
  };
  const onKeyUp = (e: KeyboardEvent): void => {
    pressed.delete(e.code);
  };
  // 押したまま別の窓へ移ると keyup が届かないので，フォーカスを失った時は離した扱いにする
  const onBlur = (): void => pressed.clear();
  window.addEventListener("keydown", onKeyDown);
  window.addEventListener("keyup", onKeyUp);
  window.addEventListener("blur", onBlur);

  const resize = (): void => {
    const w = Math.max(1, Math.floor(container.clientWidth));
    const h = Math.max(1, Math.floor(container.clientHeight));
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
  };
  const resizeObserver = new ResizeObserver(resize);
  resizeObserver.observe(container);
  resize();

  // 毎フレームの空間の更新に渡す値（毎フレーム作らずに使い回す）
  const spaceFrame: { seconds: number; eye: THREE.Vector3; dt: number; posture: Posture } = {
    seconds: PREVIEW_ALARM_SECONDS,
    eye: new THREE.Vector3(),
    dt: 0,
    posture: "standing",
  };
  let lastHelp = "";
  let lastTime: number | null = null;
  renderer.setAnimationLoop((time) => {
    const dt = lastTime === null ? 0 : (time - lastTime) / 1000;
    lastTime = time;
    const move = previewMove(pressed);
    keyTurn = advanceKeyTurn(keyTurn, move.turn, dt);
    const view: LookAngles = {
      yaw: wrapAngle(look.angles.yaw + keyTurn),
      pitch: look.angles.pitch,
    };
    const input = devPlayerInput(
      { look: walkLook(view, move.forward), walking: move.forward !== 0, crouching },
      time,
    );
    walker.update({ dt, input });
    walker.applyTo(rig);
    // 歩く向きは後ろ向きのこともあるため，カメラには見ている向きを当てる
    const head = lookToQuat(view);
    camera.quaternion.set(head.x, head.y, head.z, head.w);

    spaceFrame.dt = dt;
    spaceFrame.posture = input.posture;
    camera.getWorldPosition(spaceFrame.eye);
    space.update?.(spaceFrame);

    const text = `${HELP_TEXT}\n${crouching ? "しゃがんでいる" : "立っている"}`;
    if (text !== lastHelp) {
      help.textContent = text;
      lastHelp = text;
    }
    renderer.render(scene, camera);
  });

  return {
    dispose: () => {
      renderer.setAnimationLoop(null);
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("keyup", onKeyUp);
      window.removeEventListener("blur", onBlur);
      resizeObserver.disconnect();
      look.dispose();
      scene.remove(space.root);
      space.dispose();
      renderer.dispose();
      // 何度も切り替えると WebGL のコンテキストが溜まり，ブラウザの上限で古いものが失われるため，すぐ手放す
      renderer.forceContextLoss();
      canvas.remove();
      help.remove();
    },
  };
}
