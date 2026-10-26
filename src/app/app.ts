// 体験の流れ（開始画面 → ホーム → ロビー → シナリオ → 結果）の組み立てと画面の切り替え（docs/04_SPEC/SPEC_01）．
// ロジックは書かず，各モジュールをつなぐだけにする．
// PC モード（?app&pc．Issue #205）は 開始画面（PC 向け）→ ロビー（訓練の説明だけ）→ シナリオ → 結果 とし，
// ホーム・ゴーグルの付け外しの案内・キャリブレーションを通らない．結果画面の「トップへ」はトップの画面（パラメータ無しの URL）へ移る

import * as THREE from "three";
import { StereoEffect } from "three/examples/jsm/effects/StereoEffect.js";
import { createAlarmSample, createDrillAudio, type DrillAudio } from "../audio";
import { createEventBus } from "../core/event-bus";
import type { AppEvent } from "../core/events";
import type { Scene, SceneContext, SceneId, Session, Stage } from "../core/scene";
import type { CalibrationProfile, Posture } from "../core/types";
import { createDebriefScene } from "../debrief/debriefScene";
import { createDebriefVrScene, isDebriefVrScene } from "../debrief/debriefVrScene";
import { parseInputKind } from "../input/inputParam";
import { createInputSource, type InputSource } from "../input/inputSource";
import {
  DEFAULT_GOGGLE_SWITCH_CONFIG,
  GOGGLE_SCENES,
  type GoggleSwitch,
  goggleSwitchBetween,
} from "../lobby/goggleSwitch";
import {
  createGoggleOffScene,
  createGoggleOnScene,
  type GoggleGuideScene,
} from "../lobby/goggleSwitchScenes";
import { resolveSceneRequest } from "../lobby/homeFlow";
import { createHomeScene } from "../lobby/homeScene";
import { createHomeMemory } from "../lobby/homeSettings";
import { createLobbyScene } from "../lobby/lobbyScene";
import { createOrientationGuide, type OrientationGuide } from "../lobby/orientationGuide";
import type { AcquiredDevices } from "../lobby/permissions";
import { createStartScene } from "../lobby/startScene";
import { TRAINING_BACKGROUND_CSS, TRAINING_BOX_CSS } from "../lobby/trainingTheme";
import { createScreenWakeLock } from "../lobby/wakeLock";
import { createHandButton } from "../scenes/common/handButton";
import { createHandMarkers } from "../scenes/common/handMarkers";
import { createPlanFingerprintFromHash } from "../share/monitorIds";
import { loadPlanFromHash } from "../share/planHash";
import { createDrillScene, type DrillScene } from "./drillScene";
import { FALLBACK_PLAN } from "./fallbackPlan";
import { createHomeHandStart } from "./homeHandStart";
import { resolveDebug, resolveDemo, resolveStereo } from "./launchMode";
import {
  type AppliedLobbyParams,
  createMotionSampleBuffer,
  describeLobbyParams,
  replacingOverrides,
  resolveLobbyParams,
} from "./lobbyCalibrationParams";
import {
  createMonitorSender,
  loadStudentId,
  type MonitorSnapshot,
  monitorPhaseOfScene,
  monitorPitchOfDirection,
  monitorYawOfDirection,
} from "./monitorSender";
import { buildTopHref, PC_CONTROLS_LINES, PC_HOME_LABEL, resolvePcMode } from "./pcMode";
import { withResolvedRoute } from "./resolvedRoute";
import {
  browserCalibrationStorage,
  describeSavedCalibration,
  loadCalibrationOverrides,
  type SavedCalibrationOverrides,
  saveCalibrationOverrides,
} from "./savedCalibration";
import { yawOnly } from "./yawOnlyCalibration";

/** デモ用の起動で，開始画面の後の付ける案内の 1 画面（read）を出しておく秒数（s） */
const DEMO_PUT_ON_SECONDS = 5;

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
  // PC モード（?app&pc）．センサー・ゴーグルを使わず，PC のマウスとキーボードで体験する
  const pcMode = resolvePcMode(window.location.search);
  const coarsePointer = window.matchMedia("(pointer: coarse)").matches;
  // PC モードは 1 画面で描く（?stereo= の指定は従う）
  const useStereo = resolveStereo(window.location.search, coarsePointer && !pcMode);

  const debug = resolveDebug(window.location.search);
  // デモ用の起動（?app&demo）．開始画面の後，付ける案内を挟んで ② 非常ベルと校内放送から始める
  const demo = resolveDemo(window.location.search);

  const overlay = document.createElement("div");
  overlay.style.cssText = "position:fixed;inset:0;pointer-events:none;z-index:1;";
  document.body.appendChild(overlay);

  // 縦向きの案内は画面の切り替えと関係なく，?app の全画面で出す（PC モードはスマホを持たないので出さない）
  const orientationGuide: OrientationGuide = pcMode
    ? { visible: false, dispose: () => {} }
    : createOrientationGuide();

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

  // ?app だけなら実機のセンサー（device），?app&input=mock なら PC のキーボード・ドラッグ（mock）．PC モードは常に mock
  const inputKind = pcMode ? "mock" : (parseInputKind(window.location.search) ?? "device");
  // ロビーの間の motion のサンプル（区間から判定の値を求めるため．ロビーを出たら捨てる．上限つき）
  const lobbySamples = createMotionSampleBuffer();
  let collectingLobbySamples = false;
  const input = createInputSource({
    kind: inputKind,
    calibration: null,
    target: renderer.domElement,
    observer: {
      onMotion: (sample) => {
        if (collectingLobbySamples) lobbySamples.push(sample);
      },
    },
  });

  const factories: Partial<Record<SceneId, () => Scene>> = {
    start: () =>
      createStartScene({
        onStartTap: () => wakeLock.request(),
        // ロビーは手で開始ボタンに触れて始めるため，手をカメラから作る device ではカメラが使えないと先へ進めない．
        // mock（マウスが右手）・replay（記録の手）はカメラを使わない
        requireCamera: inputKind === "device",
        pc: pcMode ? { controls: PC_CONTROLS_LINES } : null,
        // トップで PC／ゴーグルを選び直せるように，開始画面から戻れるようにする
        topHref: buildTopHref(window.location.pathname),
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
        // 「スタート」を手をかざしても押せるようにする（手を認識できない時はタッチだけ．Issue #147）
        handStart: createHomeHandStart({
          kind: inputKind,
          handsUsable: () => handsUsable(),
          isPaused: () => orientationGuide.visible,
        }),
      }),
    lobby: () =>
      createLobbyScene({
        // 開始ボタン・見え方の調整のボタンを人差し指の先で押すので，指先に目立つ印を出す
        createHandMarkers: () => createHandMarkers({ highlightIndexTip: true }),
        debug,
        // 準備の合図（3・2・1）の短い音
        audioContext,
        isPaused: () => orientationGuide.visible,
        // 見守り画面が同じロビーの板を描けるよう，板の内容が変わるたびに送る（送れなくてもロビーは変わらない）
        onPanelView: (view) => monitor.notifyLobby(view),
        // 見守り画面が PC の読み上げで同じ文を読めるよう，読み上げた文を送る
        onNarrate: (text, rate) => monitor.notifySpeech(text, rate),
        pc: pcMode,
      }),
    scenario: () => {
      const scene = createDrillScene({
        maxAnisotropy: Math.min(renderer.capabilities.getMaxAnisotropy(), 8),
        debug,
        isPaused: () => orientationGuide.visible,
        // ?debug の時，ロビーの練習から求めた判定の値を左上に出す
        // デモの起動でロビーを通っていない間は，保存から読み込んだ値を出す
        debugInfo: () =>
          demoStarted && lobbyParams === null
            ? describeSavedCalibration(demoOverrides)
            : describeLobbyParams(lobbyParams),
        skipClassroom: demo,
        pc: pcMode ? { controls: PC_CONTROLS_LINES } : null,
      });
      drillScene = scene;
      return scene;
    },
    // 結果画面は VR の中で見る（Issue #146）．手のボタンで「同じ訓練をもう一度」（そのままロビーへ）・「ホームへ」（外す案内を挟む）．
    // 実機ではゴーグルを外して画面をタップすると HTML の結果画面に切り替わり（stereo() が false），その後の行き先には
    // ゴーグルを外している前提で案内を挟む（下の goggleSwitchBetween に currentStereo() を渡す）
    // PC モードは VR の結果画面を使わず，HTML の結果画面を画面いっぱいに出してボタンをクリック（Enter・Esc）で押す．
    // 「ホームへ」はトップの画面へ移るので文字を替える（goTo("home") を上の goTo がトップへの移動に替える）
    debrief: () =>
      pcMode
        ? createDebriefScene({
            theme: { backgroundCss: TRAINING_BACKGROUND_CSS, boxCss: TRAINING_BOX_CSS },
            homeLabel: PC_HOME_LABEL,
            keyboard: true,
          })
        : createDebriefVrScene({
            createHandButton,
            createHandMarkers,
            handsUsable,
            // mock はマウスで手を動かすため，タップで切り替えると手を動かしただけで切り替わってしまう
            allowTap: inputKind === "device",
            theme: { backgroundCss: TRAINING_BACKGROUND_CSS, boxCss: TRAINING_BOX_CSS },
          }),
  };

  let current: Scene | null = null;
  // 今の画面を左右 2 画面で描くか（ゴーグルの付け外しの案内は画面の ID と別に決め，付ける案内は途中で変わるため関数で持つ）
  let currentStereo: () => boolean = () => false;
  // 今の画面がゴーグルの付け外しの案内か（案内からの goTo には，もう案内を挟まない）．
  // 案内の画面は既存の画面の ID を借りるため，ID で画面を見分ける処理（見守りへの送信等）はこれも見る
  let currentIsGuide = false;
  // 見守りへ送る値のうち，カメラから取れないもの（避難の画面の非常ベルからの秒数・階と最新の姿勢）
  let drillScene: DrillScene | null = null;
  let latestPosture: Posture = "standing";
  // デモ用の起動の状態．開始画面からの 1 回だけホーム・ロビーを飛ばす（結果画面の後は普通の流れ）
  let demoStarted = false;
  // 次の切り替えで goggleSwitchBetween の代わりに挟む案内（開始画面 → 避難は通常は挟まないため）
  let forcedGuide: GoggleSwitch | null = null;
  // 付ける案内が終わって避難の画面に入る時に，その時の向きを正面にするか
  let demoRecenterPending = false;
  // デモの起動で保存から読み込んだしきい値（?debug の表示用．null は保存が無い・読めない）
  let demoOverrides: SavedCalibrationOverrides | null = null;

  // 見守りの中継へ送る（#p= の後ろの room= と，ビルドの VITE_MONITOR_RELAY_URL がある時だけ．無ければ何もしない）．
  // 体験の流れはこの送信を待たず，送信の失敗も体験に影響しない（SPEC_01「見守り」の「体験との約束」）
  const monitor = createMonitorSender({
    relayUrl: import.meta.env.VITE_MONITOR_RELAY_URL,
    hash: window.location.hash,
    getStudentId: () => loadStudentId(() => window.sessionStorage),
    getPlanFingerprint: () => createPlanFingerprintFromHash(window.location.hash),
    getMode: () => (session.plan ?? FALLBACK_PLAN).drill.mode,
    readState: () => {
      // 状態を送るのは避難の画面とロビー（見守り画面が同じ目線で描く）だけ
      if (current === null || switching || currentIsGuide) return null;
      if (current.id !== "scenario" && current.id !== "lobby") return null;
      const inLobby = current.id === "lobby";
      // 生徒の画面で今描いているカメラの，ワールドでの位置と向き（rig の位置・体の向き・頭の向きを反映したもの）
      camera.getWorldPosition(monitorPosition);
      camera.getWorldDirection(monitorDirection);
      const drill = inLobby ? null : drillScene;
      monitorSnapshot.floor = drill?.floor() ?? (session.plan ?? FALLBACK_PLAN).drill.start.floor;
      monitorSnapshot.posture = latestPosture;
      // 避難の画面では非常ベルからの秒数を送る．ロビーと非常ベルの前は負の数にする
      // （見守り画面はロビーの間 t を使わず，負の t では赤い表示を出さない）
      monitorSnapshot.t = drill?.alarmSeconds() ?? -1;
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
  // #p= が無い時は，?demo・?pc の有無によらず発表のデモ用の校舎を使う（見守り画面と同じ．fallbackPlan.ts）
  loadPlanFromHash(window.location.hash, FALLBACK_PLAN)
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
      // （外す案内も id は "scenario" だが，案内から進む時は避難の画面が送り終えているので送らない）
      if (next === "debrief" && current?.id === "scenario" && !currentIsGuide) {
        monitor.setPhase("goal");
        // 見守り画面が同じ結果画面を出せるよう，その回の記録を送る（評価は見守り画面が求め直す）
        if (session.drill !== null) monitor.sendTrack(session.drill.track);
      }
      // デモ用の起動: 開始画面が許可を取り終えてホームへ進む所を，付ける案内 → 避難の画面に替える
      // （PC モードの開始画面はロビーへ進む．PC モードはゴーグルを使わないので付ける案内を挟まない）
      if (
        demo &&
        !demoStarted &&
        current?.id === "start" &&
        (next === "home" || (pcMode && next === "lobby"))
      ) {
        startDemo();
        forcedGuide = pcMode ? null : "putOn";
        pending = "scenario";
        return;
      }
      // PC モードはホーム（ゴーグルの装着の案内）を使わない．結果画面の「トップへ」はトップの画面へ移る
      if (pcMode && next === "home") {
        window.location.assign(buildTopHref(window.location.pathname));
        return;
      }
      // 許可の画面は起動直後の 1 回だけ（許可・カメラ・AudioContext は取り直さない）
      pending = resolveSceneRequest(next, devices.current !== null);
    },
  };

  // デモの起動の準備．ホームを通らないため中継へはここでつなぎ，保存したしきい値があれば判定に使う
  // （正面は付け直すたびにずれるため保存せず，案内の終わりに取り直す）
  const startDemo = (): void => {
    demoStarted = true;
    demoRecenterPending = true;
    monitor.start();
    demoOverrides = loadCalibrationOverrides(browserCalibrationStorage());
    // mock はしきい値を使わない（tracker が無い）
    const tracker = input.tracker;
    if (tracker !== null && demoOverrides !== null && Object.keys(demoOverrides).length > 0) {
      tracker.setParams(demoOverrides);
      tracker.reset();
    }
  };

  // 見守り画面が同じ効果音・ナレーションを鳴らせるよう，バスに流れた Cue をそのまま送る（audio/ の購読とは別．送れなくても音は変わらない）
  ctx.bus.on("cue", (event) => monitor.notifyCue(event.cue));

  // 手を認識できるか．device は手をカメラから作るので，開始画面でカメラが取れた時だけ．
  // mock（マウスが右手）・replay（記録の手）はカメラを使わない
  const handsUsable = (): boolean =>
    inputKind !== "device" || (devices.current?.cameraStream ?? null) !== null;

  // ゴーグルの付け外しの案内の画面．案内の手のボタンを押したら本来の画面（next）へ goTo で進む
  const createGuide = (kind: GoggleSwitch, next: SceneId): GoggleGuideScene => {
    const hand = { createHandButton, createHandMarkers, handsUsable };
    if (kind === "takeOff") {
      // mock はマウスで手を動かすため，画面のタップで進めると手を動かしただけで進んでしまう
      return createGoggleOffScene({ next, ...hand, allowTap: inputKind === "device" });
    }
    // 付ける案内から避難の画面へ進むのはデモの起動だけ（ロビーの案内でなく，避難が始まる旨を出す）
    const demoGuide = next === "scenario";
    return createGoggleOnScene({
      next,
      ...hand,
      isPaused: () => orientationGuide.visible,
      demo: demoGuide,
      config: demoGuide
        ? { ...DEFAULT_GOGGLE_SWITCH_CONFIG, putOnSeconds: DEMO_PUT_ON_SECONDS }
        : DEFAULT_GOGGLE_SWITCH_CONFIG,
    });
  };

  const switchTo = async (id: SceneId, guide: GoggleSwitch | null): Promise<void> => {
    switching = true;
    try {
      current?.exit();
      current = null;
      currentIsGuide = false;
      currentStereo = () => false;
      drillScene = null;
      // 前の画面の音は次の画面へ持ち越さない（購読は続けるので，次の画面の enter で流した cue は鳴る）
      drillAudio?.stopAll();
      // 見守り画面でも前の画面の音と読み上げを止める
      monitor.notifyAudioStop();
      // サンプルをためるのはロビーの間だけ（入るたびに空から始め，出たら捨てる）
      lobbySamples.clear();
      collectingLobbySamples = id === "lobby";
      // 中継へは許可を取った後（ホームに入る時）につなぐ．つながるのを待たない
      // （案内の画面は id が行き先の画面なので，案内に入る時は数えない）
      // PC モードはホームを通らないため，ロビーに入る時につなぐ（2 回目以降の start は何もしない）
      if (guide === null && (id === "home" || (pcMode && id === "lobby"))) monitor.start();
      // PC モード: ロビーの説明の間に見回した向きを持ち越さず，避難は開始の向き（正解経路の方）から始める
      if (guide === null && id === "scenario" && pcMode) input.recenter();
      // デモの起動: ゴーグルに入れ終えた今の向きを正面にする（ロビーの正面合わせの代わり）
      if (guide === null && id === "scenario" && demoRecenterPending) {
        demoRecenterPending = false;
        input.recenter();
      }
      const guideScene = guide === null ? null : createGuide(guide, id);
      const factory = guideScene === null ? factories[id] : () => guideScene;
      if (factory === undefined) {
        console.warn(`未実装の画面です: ${id}`);
        return;
      }
      const next = factory();
      await next.enter(ctx);
      current = next;
      currentIsGuide = guideScene !== null;
      // 案内は案内の側が決める（外す案内は 2 画面，付ける案内は読む間 1 画面でゴーグルに入れた後 2 画面）．
      // 結果画面も画面の側が決める（スマホの画面に切り替えると 1 画面）
      const stereoScene = GOGGLE_SCENES.has(id);
      const ownStereo = guideScene ?? (isDebriefVrScene(next) ? next : null);
      currentStereo = ownStereo === null ? () => stereoScene : () => ownStereo.stereo();
      // 画面に入り終えてから知らせる（避難の画面の開始地点にカメラが置かれてから状態を送り始めるため）．
      // 案内の画面では知らせず，案内の後に本来の画面へ入った時に知らせる
      const phase = guide === null ? monitorPhaseOfScene(id) : null;
      if (phase !== null) monitor.setPhase(phase);
    } catch (error) {
      console.error(`画面の切り替えに失敗しました: ${id}`, error);
    } finally {
      switching = false;
    }
  };

  // ロビーが Session.calibration を書いたら（「もう一度」で書き直した時も）入力に渡し，正面をリセットする
  let appliedCalibration: CalibrationProfile | null = null;
  // ロビーの区間から求めて判定に反映した値（「もう一度」で区間が前回のままなら使い回す）
  let lobbyParams: AppliedLobbyParams | null = null;
  const applyCalibration = (source: InputSource, calibration: CalibrationProfile): void => {
    appliedCalibration = calibration;
    // mock: センサーの向きが無いため今の向きを正面にする（判定をしないためしきい値も使わない）
    const tracker = source.tracker;
    if (tracker === null) {
      source.recenter();
      return;
    }
    // device・replay: 正面（yawOffset）と手順の区間（segments）を渡す（非推奨のしきい値は yawOnly で外す）
    tracker.setCalibration(yawOnly(calibration));
    // 判定のしきい値は，ロビーの間にためたサンプルと区間から input/ の calibrateParams() で求めて上書きする
    // （開発用のゴーグルのページと同じ使い方．測れなかった項目は上書きに入らず既定値のまま．理由は notes）
    const next = resolveLobbyParams(
      lobbySamples.snapshot(),
      calibration.segments ?? [],
      lobbyParams,
    );
    if (next !== lobbyParams) {
      tracker.setParams(
        replacingOverrides(lobbyParams?.result.overrides ?? null, next.result.overrides),
      );
      lobbyParams = next;
      // デモ用の起動で使えるよう端末に保存する．何も求められなかった時は，前に保存した値を消さない
      if (Object.keys(next.result.overrides).length > 0) {
        saveCalibrationOverrides(browserCalibrationStorage(), next.result.overrides);
      }
    }
    // 体の判定の途中の状態を捨て，姿勢を立ちに戻す（頭の向きは保つ）．ロビーの間は既定のしきい値で判定しており，
    // しゃがみ歩きから止まらずに立つ場面を「しゃがんでいる」と誤ったまま避難の画面に持ち越すと，本当のしゃがみが
    // 切り替わりえない向きとして捨てられるため．ロビーの手順の終わり（「もう一度」の正面合わせだけの時も）は
    // 立っているので，しきい値を変えなかった時も常に戻す
    tracker.resetPosture("standing");
    // 求め終えたらサンプルは要らない（説明の間もためないようにする）
    collectingLobbySamples = false;
    lobbySamples.clear();
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
      // ゴーグルを付けて見る画面と外して見る画面の間では，付け外しの案内を挟む（案内からの切り替えには挟まない）
      const guide = currentIsGuide
        ? null
        : (forcedGuide ?? goggleSwitchBetween(current?.id ?? null, id, currentStereo()));
      forcedGuide = null;
      void switchTo(id, guide);
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

    if (useStereo && current !== null && currentStereo()) {
      stereo.render(world, camera);
    } else {
      // StereoEffect はビューポートを右半分のまま残すため戻す
      renderer.setViewport(0, 0, window.innerWidth, window.innerHeight);
      renderer.render(world, camera);
    }
  });
}
