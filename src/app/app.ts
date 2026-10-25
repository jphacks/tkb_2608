// 体験の流れ（開始画面 → ホーム → ロビー → シナリオ → 結果）の組み立てと画面の切り替え（docs/04_SPEC/SPEC_01）．
// ロジックは書かず，各モジュールをつなぐだけにする

import * as THREE from "three";
import { StereoEffect } from "three/examples/jsm/effects/StereoEffect.js";
import { createAlarmSample, createDrillAudio, type DrillAudio } from "../audio";
import { createEventBus } from "../core/event-bus";
import type { AppEvent } from "../core/events";
import type { Scene, SceneContext, SceneId, Session, Stage } from "../core/scene";
import type { CalibrationProfile, Posture } from "../core/types";
import { createDebriefScene } from "../debrief/debriefScene";
import { parseInputKind } from "../input/inputParam";
import { createInputSource, type InputSource } from "../input/inputSource";
import { resolveSceneRequest } from "../lobby/homeFlow";
import { createHomeScene } from "../lobby/homeScene";
import { createHomeMemory } from "../lobby/homeSettings";
import { createLobbyScene } from "../lobby/lobbyScene";
import { createOrientationGuide } from "../lobby/orientationGuide";
import type { AcquiredDevices } from "../lobby/permissions";
import { createStartScene } from "../lobby/startScene";
import { TRAINING_BACKGROUND_CSS, TRAINING_BOX_CSS } from "../lobby/trainingTheme";
import { createScreenWakeLock } from "../lobby/wakeLock";
import { createHandMarkers } from "../scenes/common/handMarkers";
import { createPlanFingerprintFromHash } from "../share/monitorIds";
import { loadPlanFromHash } from "../share/planHash";
import { DEMO_SCHOOL } from "../share/samples/demoSchool";
import { resolveDebug, resolveStereo } from "./launchMode";
import {
  createMonitorSender,
  loadStudentId,
  type MonitorSnapshot,
  monitorPhaseOfScene,
  monitorPitchOfDirection,
  monitorYawOfDirection,
} from "./monitorSender";
import { createScenarioPlaceholder } from "./placeholderScenes";
import { withResolvedRoute } from "./resolvedRoute";
import { yawOnly } from "./yawOnlyCalibration";

/** 左右 2 画面で描く画面（ゴーグル装着中の画面） */
const VR_SCENES: ReadonlySet<SceneId> = new Set<SceneId>(["lobby", "scenario"]);

/** 1 フレームの dt の上限（タブが裏に回った後等に大きく飛ばないため） */
const MAX_DT = 0.1;

// 見守りへ送る状態を作る作業用の値（1 秒に 20 回使うため，1 回だけ作って使い回す）
const monitorPosition = new THREE.Vector3();
const monitorDirection = new THREE.Vector3();
const monitorSnapshot: { -readonly [K in keyof MonitorSnapshot]: MonitorSnapshot[K] } = {
  floor: 0,
  posture: "standing",
  t: 0,
  x: 0,
  z: 0,
  yaw: 0,
  pitch: 0,
};

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
  // 開始画面で取れた機器．カメラは input/ の手の認識に渡す．AudioContext はホームの設定（音量の確認）と audio/ に渡す
  const devices: { current: AcquiredDevices | null } = { current: null };
  const audioContext = (): AudioContext | null => devices.current?.audioContext ?? null;
  // 設定の音量の確認で鳴らす非常ベル（audio/ の非常ベルと同じ音）．ホームを作り直しても 1 つを使い回す
  const volumeCheckAlarm = createAlarmSample(audioContext);
  // 体験の音（audio/）．開始画面で機器を取った後に 1 回だけ作り，体験の間ずっとバスの cue を受けて鳴らす．
  // 画面を切り替える時は止めるだけにし，片付けるのはページを離れる時だけ．
  // AudioContext が無い時（取れなかった等）も読み上げとナレーションの終わりの signal は動く
  let drillAudio: DrillAudio | null = null;
  window.addEventListener("pagehide", () => {
    drillAudio?.dispose();
    drillAudio = null;
    volumeCheckAlarm.stop();
  });
  // 戻る・進むでページがそのまま戻された時（bfcache）は，機器を取り終えていれば作り直す
  window.addEventListener("pageshow", (event) => {
    if (event.persisted && devices.current !== null) {
      drillAudio ??= createDrillAudio({ bus: ctx.bus, audioContext });
    }
  });

  // 画面の消灯を止める処理は ?app の間ずっと 1 つだけ持ち，ロビー・シナリオの間も保つ．
  // 頼むのは許可の画面とホームのタップの中（画面を作り直しても外さない）
  const wakeLock = createScreenWakeLock();
  // 設定を開いたか．ホームを作り直しても（結果画面から戻った時も）その回の利用の中では保つ
  const homeMemory = createHomeMemory();

  // ?app だけなら実機のセンサー（device），?app&input=mock なら PC のキーボード・ドラッグ（mock）
  const inputKind = parseInputKind(window.location.search) ?? "device";
  const input = createInputSource({
    kind: inputKind,
    calibration: null,
    target: renderer.domElement,
  });

  const factories: Partial<Record<SceneId, () => Scene>> = {
    start: () =>
      createStartScene({
        onStartTap: () => wakeLock.request(),
        // ロビーは手で開始ボタンに触れて始めるため，手をカメラから作る device ではカメラが使えないと先へ進めない．
        // mock（マウスが右手）・replay（記録の手）はカメラを使わない
        requireCamera: inputKind === "device",
        onDevices: (acquired) => {
          devices.current = acquired;
          drillAudio ??= createDrillAudio({ bus: ctx.bus, audioContext });
          // 許可は開始画面のタップの中で lobby/ が取り終えている．iOS は許可済みならタップの外でも
          // requestPermission が granted を返すため，ここで呼んでも許可のダイアログは重ならない
          void input.activate();
          // 開始画面で取った背面カメラを手の認識に渡す（device では取れないと開始画面で止まるため，ここに来る時は取れている．
          // mock・replay では null のことがあり，その時は何もしない）
          input.attachCamera(acquired.cameraStream);
        },
      }),
    home: () =>
      createHomeScene({
        memory: homeMemory,
        audioContext,
        volumeCheckAlarm,
        wakeLock,
      }),
    lobby: () =>
      createLobbyScene({
        createHandMarkers,
        debug,
        isPaused: () => orientationGuide.visible,
        // 見守り画面が同じロビーの板を描けるよう，板の内容が変わるたびに送る（送れなくてもロビーは変わらない）
        onPanelView: (view) => monitor.notifyLobby(view),
      }),
    scenario: () => createScenarioPlaceholder({ debug, isPaused: () => orientationGuide.visible }),
    debrief: () =>
      createDebriefScene({
        theme: { backgroundCss: TRAINING_BACKGROUND_CSS, boxCss: TRAINING_BOX_CSS },
      }),
  };

  let current: Scene | null = null;
  // 見守りへ送る値のうち，カメラから取れないもの（避難の画面に入った時刻（performance.now() の ms）と最新の姿勢）
  let drillStartMs = 0;
  let latestPosture: Posture = "standing";

  // 見守りの中継へ送る（#p= の後ろの room= と，ビルドの VITE_MONITOR_RELAY_URL がある時だけ．無ければ何もしない）．
  // 体験の流れはこの送信を待たず，送信の失敗も体験に影響しない（SPEC_01「見守り」の「体験との約束」）
  const monitor = createMonitorSender({
    relayUrl: import.meta.env.VITE_MONITOR_RELAY_URL,
    hash: window.location.hash,
    getStudentId: () => loadStudentId(() => window.sessionStorage),
    getPlanFingerprint: () => createPlanFingerprintFromHash(window.location.hash),
    getMode: () => (session.plan ?? DEMO_SCHOOL).drill.mode,
    readState: () => {
      // 状態を送るのは避難の画面とロビー（見守り画面が同じ目線で描く）だけ
      if (current === null || switching) return null;
      if (current.id !== "scenario" && current.id !== "lobby") return null;
      const inLobby = current.id === "lobby";
      // 生徒の画面で今描いているカメラの，ワールドでの位置と向き（rig の位置・体の向き・頭の向きを反映したもの）
      camera.getWorldPosition(monitorPosition);
      camera.getWorldDirection(monitorDirection);
      // 避難の画面は今は仮で階を持たないため，開始地点の階を送る（避難の画面ができたらそこから取る）
      monitorSnapshot.floor = (session.plan ?? DEMO_SCHOOL).drill.start.floor;
      monitorSnapshot.posture = latestPosture;
      // 仮の避難の画面には非常ベルが無いため，画面に入った時を 0 秒とする（避難の画面ができたら非常ベルからの秒数にする）
      // ロビーは非常ベルの前なので負の数にする（見守り画面はロビーの間 t を使わない）
      monitorSnapshot.t = inLobby ? -1 : (performance.now() - drillStartMs) / 1000;
      monitorSnapshot.x = monitorPosition.x;
      monitorSnapshot.z = monitorPosition.z;
      monitorSnapshot.yaw = monitorYawOfDirection(monitorDirection.x, monitorDirection.z);
      monitorSnapshot.pitch = monitorPitchOfDirection(monitorDirection.y);
      return monitorSnapshot;
    },
  });
  // 最初の画面（開始画面）へは，URL の校舎データ（#p=）を読み終えてから進む（開始画面が planLoadError を読むため）
  let pending: SceneId | null = null;
  let switching = false;

  // 読み込み中も描画のループは回す（空の 3D 空間の背景が出て，画面は真っ白で止まらない）．
  // 想定外の例外で読めなくても開始画面へは進む（plan・planLoadError は null のまま）
  loadPlanFromHash(window.location.hash)
    .then((loaded) => {
      // 教員が経路を決めていない校舎は，ここで提案の経路を入れる（床の矢印・結果画面・評価が同じ経路を使うように）
      session.plan = loaded.plan === null ? null : withResolvedRoute(loaded.plan);
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
      // 避難の画面から結果画面へ進む時が「避難が終わった」（集合場所に着いた・時間切れ）
      if (next === "debrief" && current?.id === "scenario") {
        monitor.setPhase("goal");
        // 見守り画面が同じ結果画面を出せるよう，その回の記録を送る（評価は見守り画面が求め直す）
        if (session.drill !== null) monitor.sendTrack(session.drill.track);
      }
      // 許可の画面は起動直後の 1 回だけ（許可・カメラ・AudioContext は取り直さない）
      pending = resolveSceneRequest(next, devices.current !== null);
    },
  };

  const switchTo = async (id: SceneId): Promise<void> => {
    switching = true;
    try {
      current?.exit();
      current = null;
      // 前の画面の音は次の画面へ持ち越さない（購読は続けるので，次の画面の enter で流した cue は鳴る）
      drillAudio?.stopAll();
      // 中継へは許可を取った後（ホームに入る時）につなぐ．つながるのを待たない
      if (id === "home") monitor.start();
      if (id === "scenario") drillStartMs = performance.now();
      const factory = factories[id];
      if (factory === undefined) {
        console.warn(`未実装の画面です: ${id}`);
        return;
      }
      const next = factory();
      await next.enter(ctx);
      current = next;
      // 画面に入り終えてから知らせる（避難の画面の開始地点にカメラが置かれてから状態を送り始めるため）
      const phase = monitorPhaseOfScene(id);
      if (phase !== null) monitor.setPhase(phase);
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
    latestPosture = frameInput.posture;
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
