// 体験の流れ（開始画面 → ホーム → ロビー → シナリオ）の組み立てと画面の切り替え（docs/04_SPEC/SPEC_01）．
// ロジックは書かず，各モジュールをつなぐだけにする

import * as THREE from "three";
import { StereoEffect } from "three/examples/jsm/effects/StereoEffect.js";
import { DragLook } from "../controls/dragLook";
import { createEventBus } from "../core/event-bus";
import type { AppEvent } from "../core/events";
import type { Scene, SceneContext, SceneId, Session, Stage } from "../core/scene";
import { IDLE_PLAYER_INPUT, type PlayerInput } from "../core/types";
import { createHeadOrientationFeed } from "../lobby/headOrientationFeed";
import { resolveHeadPose } from "../lobby/headPose";
import { resolveSceneRequest } from "../lobby/homeFlow";
import { createHomeScene } from "../lobby/homeScene";
import { createLobbyScene } from "../lobby/lobbyScene";
import { createOrientationGuide } from "../lobby/orientationGuide";
import type { AcquiredDevices } from "../lobby/permissions";
import { createStartScene } from "../lobby/startScene";
import { resolveDebug, resolveStereo } from "./launchMode";
import { createScenarioPlaceholder } from "./placeholderScenes";

/** 左右 2 画面で描く画面（ゴーグル装着中の画面） */
const VR_SCENES: ReadonlySet<SceneId> = new Set<SceneId>(["lobby", "scenario"]);

/** 1 フレームの dt の上限（タブが裏に回った後等に大きく飛ばないため） */
const MAX_DT = 0.1;

export function startApp(): void {
  const renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.setSize(window.innerWidth, window.innerHeight);
  document.body.appendChild(renderer.domElement);
  const stereo = new StereoEffect(renderer);
  const useStereo = resolveStereo(
    window.location.search,
    window.matchMedia("(pointer: coarse)").matches,
  );

  const debug = resolveDebug(window.location.search);

  const overlay = document.createElement("div");
  overlay.style.cssText = "position:fixed;inset:0;pointer-events:none;z-index:1;";
  document.body.appendChild(overlay);

  // 縦向きの案内は画面の切り替えと関係なく，?app の全画面で出す
  const orientationGuide = createOrientationGuide();

  const world = new THREE.Scene();
  world.background = new THREE.Color(0x10141c);
  // rig の位置を目の位置とし，カメラ（頭）はその原点に置く
  const rig = new THREE.Object3D();
  const camera = new THREE.PerspectiveCamera(70, window.innerWidth / window.innerHeight, 0.05, 50);
  rig.add(camera);
  world.add(rig);

  const stage: Stage = { world, rig, overlay };
  const session: Session = { calibration: null, result: null, recording: null };
  // 開始画面で取れた機器．input/（カメラ）・audio/（AudioContext）ができたら渡す
  const devices: { current: AcquiredDevices | null } = { current: null };

  const factories: Partial<Record<SceneId, () => Scene>> = {
    start: () =>
      createStartScene({
        onDevices: (acquired) => {
          devices.current = acquired;
        },
      }),
    home: () => createHomeScene(),
    lobby: () => createLobbyScene({ debug, isPaused: () => orientationGuide.visible }),
    scenario: () => createScenarioPlaceholder(),
  };

  let current: Scene | null = null;
  let pending: SceneId | null = "start";
  let switching = false;

  const ctx: SceneContext = {
    bus: createEventBus<AppEvent>(),
    stage,
    session,
    goTo(next) {
      // 許可の画面は起動直後の 1 回だけ（許可・カメラ・AudioContext は取り直さない）
      pending = resolveSceneRequest(next, devices.current !== null);
    },
  };

  const switchTo = async (id: SceneId): Promise<void> => {
    switching = true;
    try {
      current?.exit();
      current = null;
      const factory = factories[id];
      if (factory === undefined) {
        console.warn(`未実装の画面です: ${id}`);
        return;
      }
      const next = factory();
      await next.enter(ctx);
      current = next;
    } catch (error) {
      console.error(`画面の切り替えに失敗しました: ${id}`, error);
    } finally {
      switching = false;
    }
  };

  // 頭の向きは仮実装（input/ の PlayerInput.head ができたら置き換える）．
  // 端末の向き（deviceorientation）が届けばそれを使い，届かない PC 等ではドラッグで代用する．
  // 入力源の選択と正面リセット（yawOffset の差し引き）は lobby/headPose.ts の純粋な関数で決める
  const headFeed = createHeadOrientationFeed();
  const look = new DragLook(renderer.domElement, { yaw: 0, pitch: 0 });
  const euler = new THREE.Euler(0, 0, 0, "YXZ");
  const headQuat = new THREE.Quaternion();
  const readInput = (time: number): PlayerInput => {
    euler.set(look.angles.pitch, look.angles.yaw, 0, "YXZ");
    headQuat.setFromEuler(euler);
    const head = resolveHeadPose({
      latest: headFeed.latest,
      drag: { x: headQuat.x, y: headQuat.y, z: headQuat.z, w: headQuat.w },
      scene: current?.id ?? null,
      calibration: session.calibration,
    });
    return { ...IDLE_PLAYER_INPUT, time, head };
  };

  const resize = (): void => {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
  };
  window.addEventListener("resize", resize);

  let lastTime: number | null = null;
  renderer.setAnimationLoop((time: number) => {
    const dt = lastTime === null ? 0 : Math.min(MAX_DT, (time - lastTime) / 1000);
    lastTime = time;

    if (pending !== null && !switching) {
      const id = pending;
      pending = null;
      void switchTo(id);
    }

    const input = readInput(time);
    camera.quaternion.set(input.head.x, input.head.y, input.head.z, input.head.w);
    if (current !== null && !switching) current.update({ dt, input });

    if (useStereo && current !== null && VR_SCENES.has(current.id)) {
      stereo.render(world, camera);
    } else {
      // StereoEffect はビューポートを右半分のまま残すため戻す
      renderer.setViewport(0, 0, window.innerWidth, window.innerHeight);
      renderer.render(world, camera);
    }
  });
}
