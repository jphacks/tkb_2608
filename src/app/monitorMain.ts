// 見守り画面（?monitor#p=…&room=…）の組み立て．URL から部屋の ID・校舎・校舎の指紋を読み，scenes/school/ の校舎の 3D を
// monitor/ に渡して始める．音は audio/ から作って渡す（画面を持つモジュール同士は直接 import しないため，つなぐのは app/．SPEC_01「見守り」）
import * as THREE from "three";
import { createDrillAudio, createSpeech, unlockSpeech } from "../audio";
import type { DrillEvaluation, DrillTrack } from "../core/drill";
import { createEventBus } from "../core/event-bus";
import type { AppEvent } from "../core/events";
import type { Scene, SceneContext, Session } from "../core/scene";
import type { CellRef, SchoolPlan } from "../core/schoolPlan";
import { createDebriefScene } from "../debrief/debriefScene";
import {
  createAlignmentMarker,
  createLobbyPanel,
  createLobbyRoom,
  createStartButton,
  LOBBY_EYE_HEIGHT,
} from "../lobby/lobbyRoom";
import { angleDifference } from "../lobby/orientation";
import { DEFAULT_START_GATE_CONFIG } from "../lobby/startGate";
import { TRAINING_BACKGROUND_CSS, TRAINING_BOX_CSS } from "../lobby/trainingTheme";
import { MONITOR_MESSAGES } from "../monitor/monitorDisplay";
import { showMonitorNotice, startMonitorScreen } from "../monitor/monitorScreen";
import { createMonitorRelayUrl, resolveRelayBaseUrl } from "../monitor/relayUrl";
import type {
  MonitorAudio,
  MonitorLobbyWorld,
  MonitorResultView,
  MonitorWorld,
} from "../monitor/types";
import { SCHOOL_EYE_HEIGHT } from "../scenes/school/schoolPlanLayout";
import { createSchoolScene } from "../scenes/school/schoolPlanScene";
import { createPlanFingerprintFromHash, getRoomIdFromHash } from "../share/monitorIds";
import { loadPlanFromHash } from "../share/planHash";
import { DEMO_PITCH_SCHOOL } from "../share/samples/demoPitchSchool";
import { DEMO_SCHOOL } from "../share/samples/demoSchool";
import { resolveDemo } from "./launchMode";

/** 校舎を読めなかった時の案内 */
const PLAN_LOAD_FAILED =
  "校舎のデータを読み込めませんでした．エディタの「見守り画面を開く」から開き直してください";

/** 校舎の指紋を作れなかった時（http の画面で crypto.subtle が無い等）の案内 */
const FINGERPRINT_FAILED =
  "校舎の確認ができませんでした．https か localhost の URL で開いてください";

/**
 * scenes/school/ の校舎（SchoolPlan の 1 つ目の階）を見守り画面の形にする．
 * SchoolPlan から組み立てた校舎では，ドアのマスは開いたままの開口部として作られ，開け閉めする扉が無い．
 * そのためドアの開け閉め（setDoorOpen・resetDoors）は今は何もしない（生徒の画面でも開け閉めできるドアが無い）
 */
function createMonitorWorld(plan: SchoolPlan, maxAnisotropy: number): MonitorWorld {
  const space = createSchoolScene({ maxAnisotropy }, plan);
  const frame = { seconds: Number.NaN, eye: null as { x: number; y: number; z: number } | null };
  return {
    root: space.root,
    background: space.background,
    fog: space.fog,
    start: { x: space.layout.start.x, z: space.layout.start.z, yaw: space.startYaw },
    eyeHeight: (posture) => SCHOOL_EYE_HEIGHT[posture],
    update: (seconds, eye) => {
      frame.seconds = seconds;
      frame.eye = eye;
      space.update?.(frame);
    },
    setDoorOpen: (_cell: CellRef, _open: boolean) => {},
    resetDoors: () => {},
    dispose: () => space.dispose(),
  };
}

/** 指示の板が頭の向きに追いつく速さ（1/秒．生徒のロビー（lobbyScene.ts）の PANEL_FOLLOW_RATE と同じ） */
const LOBBY_PANEL_FOLLOW_RATE = 1.2;

/** ロビーの背景色（生徒の画面の world.background と同じ．部屋の外が見えた時の色） */
const LOBBY_BACKGROUND = 0x10141c;

/**
 * lobby/ の部屋・指示の板・開始ボタン・見え方の調整の丸を，見守り画面のロビーの形にする．
 * 手の印と開始ボタンの進み具合のリングは送られないので描かない
 */
function createMonitorLobby(): MonitorLobbyWorld {
  const room = createLobbyRoom();
  const panel = createLobbyPanel();
  panel.setHighlight(0);
  const button = createStartButton(DEFAULT_START_GATE_CONFIG.buttonOffset);
  panel.object.add(button.object);
  const marker = createAlignmentMarker();
  const root = new THREE.Group();
  root.name = "monitor-lobby";
  root.add(room.root, panel.object);
  return {
    root,
    cameraAttachment: marker.object,
    background: LOBBY_BACKGROUND,
    eyeHeight: LOBBY_EYE_HEIGHT,
    show(view) {
      panel.show({ title: view.title, body: view.body, caption: view.caption });
      button.object.visible = view.startButton;
      // marker.object の表示は見守り画面がロビーの間だけにするので，丸の有無は子の表示で切り替える
      for (const child of marker.object.children) child.visible = view.alignMarker;
    },
    follow(headYaw, dt) {
      const current = panel.object.rotation.y;
      const rate = Math.min(1, Math.max(0, dt) * LOBBY_PANEL_FOLLOW_RATE);
      panel.object.rotation.y = current + angleDifference(current, headYaw) * rate;
    },
    reset() {
      panel.object.rotation.y = 0;
    },
    dispose() {
      room.dispose();
      panel.dispose();
      button.dispose();
      marker.dispose();
    },
  };
}

/** debrief/ の結果画面を，見守り画面の結果の形にする（画面を移るボタンは出さない） */
function createMonitorResult(plan: SchoolPlan): MonitorResultView {
  const overlay = document.createElement("div");
  overlay.style.cssText = "position:fixed;inset:0;pointer-events:none;z-index:1;";
  document.body.appendChild(overlay);
  let scene: Scene | null = null;
  const hide = () => {
    scene?.exit();
    scene = null;
  };
  return {
    show(drill: { readonly track: DrillTrack; readonly evaluation: DrillEvaluation }) {
      hide();
      const session: Session = {
        calibration: null,
        result: null,
        recording: null,
        plan,
        planLoadError: null,
        drill,
      };
      // 結果画面は 3D を使わないが，SceneContext の形に合わせて空の描画先を渡す．画面は移らない
      const ctx: SceneContext = {
        bus: createEventBus<AppEvent>(),
        stage: { world: new THREE.Scene(), rig: new THREE.Object3D(), overlay },
        session,
        goTo: () => {},
      };
      const next = createDebriefScene({
        theme: { backgroundCss: TRAINING_BACKGROUND_CSS, boxCss: TRAINING_BOX_CSS },
        showActions: false,
      });
      // debrief/ の enter は同期で DOM を組み立てる
      void next.enter(ctx);
      scene = next;
    },
    hide,
  };
}

/** 見守り画面の AudioContext を作る（使えないブラウザでは null．効果音は鳴らさず読み上げだけ行う） */
function createAudioContext(): AudioContext | null {
  const Context =
    window.AudioContext ??
    (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (Context === undefined) return null;
  try {
    return new Context();
  } catch {
    return null;
  }
}

/**
 * audio/ の体験の音（生徒の端末と同じ createDrillAudio）と読み上げを，見守り画面の音の口にする．
 * drillAudio には見守り画面の中だけのバスを渡すので，ナレーションの終わりの signal はどこにも届かない（生徒の端末へ返さない）
 */
function createMonitorAudio(): MonitorAudio {
  let context: AudioContext | null = null;
  const speech = createSpeech();
  const drillAudio = createDrillAudio({
    bus: createEventBus<AppEvent>(),
    audioContext: () => context,
    speech,
  });
  return {
    enable() {
      // クリックの処理の中で作って再開する（自動再生の制限で，クリックの外では鳴らせないため）
      context ??= createAudioContext();
      void context?.resume().catch(() => {});
      unlockSpeech();
    },
    playCue: (cue) => drillAudio.handleCue(cue),
    speak(text, rate) {
      speech.speak(text, rate, () => {});
    },
    stopAll() {
      drillAudio.stopAll();
      speech.cancel();
    },
    dispose() {
      drillAudio.dispose();
      speech.cancel();
      void context?.close().catch(() => {});
      context = null;
    },
  };
}

/** 見守り画面を起動する（main.ts の ?monitor から呼ぶ） */
export async function startMonitorApp(): Promise<void> {
  const hash = window.location.hash;
  const roomId = getRoomIdFromHash(hash);
  if (roomId === null) {
    showMonitorNotice(MONITOR_MESSAGES.noRoom);
    return;
  }
  const relayBase = resolveRelayBaseUrl(import.meta.env.VITE_MONITOR_RELAY_URL);
  if (relayBase === null) {
    showMonitorNotice(MONITOR_MESSAGES.noRelay);
    return;
  }

  // ?monitor&demo で #p= が無い時は，生徒の ?app&demo と同じ発表のデモ用の校舎を描く（Issue #189）
  const fallback = resolveDemo(window.location.search) ? DEMO_PITCH_SCHOOL : DEMO_SCHOOL;
  const { plan } = await loadPlanFromHash(hash, fallback);
  if (plan === null) {
    showMonitorNotice(PLAN_LOAD_FAILED);
    return;
  }
  let planFingerprint: string;
  try {
    planFingerprint = await createPlanFingerprintFromHash(hash);
  } catch {
    showMonitorNotice(FINGERPRINT_FAILED);
    return;
  }

  startMonitorScreen({
    plan,
    planFingerprint,
    relayUrl: createMonitorRelayUrl(relayBase, roomId),
    createWorld: (maxAnisotropy) => createMonitorWorld(plan, maxAnisotropy),
    createLobby: createMonitorLobby,
    result: createMonitorResult(plan),
    audio: createMonitorAudio(),
  });
}
