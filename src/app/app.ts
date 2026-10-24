// 体験の流れ（開始画面 → ホーム → ロビー → シナリオ）の組み立てと画面の切り替え（docs/04_SPEC/SPEC_01）．
// ロジックは書かず，各モジュールをつなぐだけにする

import * as THREE from "three";
import { StereoEffect } from "three/examples/jsm/effects/StereoEffect.js";
import { createEventBus } from "../core/event-bus";
import type { AppEvent } from "../core/events";
import type { Scene, SceneContext, SceneId, Session, Stage } from "../core/scene";
import type { CalibrationProfile } from "../core/types";
import { parseInputKind } from "../input/inputParam";
import { createInputSource, type InputSource } from "../input/inputSource";
import { resolveSceneRequest } from "../lobby/homeFlow";
import { createHomeScene } from "../lobby/homeScene";
import { createHomeMemory } from "../lobby/homeSettings";
import { createLobbyScene } from "../lobby/lobbyScene";
import { createOrientationGuide } from "../lobby/orientationGuide";
import type { AcquiredDevices } from "../lobby/permissions";
import { createStartScene } from "../lobby/startScene";
import { createScreenWakeLock } from "../lobby/wakeLock";
import { loadPlanFromHash } from "../share/planHash";
import { resolveDebug, resolveStereo } from "./launchMode";
import { createScenarioPlaceholder } from "./placeholderScenes";
import { yawOnly } from "./yawOnlyCalibration";

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
  const session: Session = {
    calibration: null,
    result: null,
    recording: null,
    plan: null,
    planLoadError: null,
    drill: null,
  };
  // 開始画面で取れた機器．カメラは input/ の手の認識に渡す．AudioContext はホームの設定（音量の確認）に渡す（audio/ ができたらそちらにも渡す）
  const devices: { current: AcquiredDevices | null } = { current: null };

  // 画面の消灯を止める処理は ?app の間ずっと 1 つだけ持ち，ロビー・シナリオの間も保つ．
  // 頼むのは許可の画面とホームのタップの中（画面を作り直しても外さない）
  const wakeLock = createScreenWakeLock();
  // 設定を開いたか．ホームを作り直しても（結果画面から戻った時も）その回の利用の中では保つ
  const homeMemory = createHomeMemory();

  // ?app だけなら実機のセンサー（device），?app&input=mock なら PC のキーボード・ドラッグ（mock）
  const input = createInputSource({
    kind: parseInputKind(window.location.search) ?? "device",
    calibration: null,
    target: renderer.domElement,
  });

  const factories: Partial<Record<SceneId, () => Scene>> = {
    start: () =>
      createStartScene({
        onStartTap: () => wakeLock.request(),
        onDevices: (acquired) => {
          devices.current = acquired;
          // 許可は開始画面のタップの中で lobby/ が取り終えている．iOS は許可済みならタップの外でも
          // requestPermission が granted を返すため，ここで呼んでも許可のダイアログは重ならない
          void input.activate();
          // 開始画面で取った背面カメラを手の認識に渡す（取れなかった時は null で，手なしで進む）
          input.attachCamera(acquired.cameraStream);
        },
      }),
    home: () =>
      createHomeScene({
        memory: homeMemory,
        audioContext: () => devices.current?.audioContext ?? null,
        wakeLock,
      }),
    lobby: () => createLobbyScene({ debug, isPaused: () => orientationGuide.visible }),
    scenario: () => createScenarioPlaceholder(),
  };

  let current: Scene | null = null;
  // 最初の画面（開始画面）へは，URL の校舎データ（#p=）を読み終えてから進む（開始画面が planLoadError を読むため）
  let pending: SceneId | null = null;
  let switching = false;

  // 読み込み中も描画のループは回す（空の 3D 空間の背景が出て，画面は真っ白で止まらない）．
  // 想定外の例外で読めなくても開始画面へは進む（plan・planLoadError は null のまま）
  loadPlanFromHash(window.location.hash)
    .then((loaded) => {
      session.plan = loaded.plan;
      session.planLoadError = loaded.planLoadError;
    })
    .catch((error: unknown) => {
      console.error("校舎データの読み込みに失敗しました", error);
    })
    .finally(() => {
      pending = "start";
    });

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

  // ロビーが Session.calibration を書いたら（「もう一度」で書き直した時も）入力に渡し，正面をリセットする
  let appliedCalibration: CalibrationProfile | null = null;
  const applyCalibration = (source: InputSource, calibration: CalibrationProfile): void => {
    appliedCalibration = calibration;
    // device: 正面（yawOffset）と手順の区間（segments）を渡す（非推奨のしきい値は yawOnly で外す）．
    // mock: センサーの向きが無いため今の向きを正面にする
    if (source.tracker !== null) source.tracker.setCalibration(yawOnly(calibration));
    else source.recenter();
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

    if (session.calibration !== null && session.calibration !== appliedCalibration) {
      applyCalibration(input, session.calibration);
    }
    // InputSource.read は performance.now() の時刻を受け取る（センサーのサンプルの時刻と同じ時計にする）
    const frameInput = input.read(performance.now());
    const { head } = frameInput;
    camera.quaternion.set(head.x, head.y, head.z, head.w);
    if (current !== null && !switching) current.update({ dt, input: frameInput });

    if (useStereo && current !== null && VR_SCENES.has(current.id)) {
      stereo.render(world, camera);
    } else {
      // StereoEffect はビューポートを右半分のまま残すため戻す
      renderer.setViewport(0, 0, window.innerWidth, window.innerHeight);
      renderer.render(world, camera);
    }
  });
}
