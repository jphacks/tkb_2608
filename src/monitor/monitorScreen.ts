// 見守り画面（?monitor）の殻．中継から受け取った知らせと状態を MonitorSession に渡し，片目分の全画面（カメラ 1 つ）で
// ロビー・校舎を描き直し，終わったら届いた記録の結果画面を出す．
// 案内の文と赤い縁は DOM で重ねる．F でブラウザの全画面にする．音は出さない（SPEC_01「見守り」の「見守り画面」）
import * as THREE from "three";
import type { DrillTrack } from "../core/drill";
import type { SchoolPlan } from "../core/schoolPlan";
import { parseMonitorNotice } from "../share/monitorNotice";
import { readMonitorState } from "../share/monitorState";
import { evaluateDrill } from "../sim/evaluate";
import { computeSpread } from "../sim/spread";
import {
  isMonitorAlert,
  type MonitorDrawKind,
  type RelayStatus,
  resolveMonitorDisplay,
} from "./monitorDisplay";
import { type MonitorEffect, MonitorSession } from "./monitorSession";
import { RelayConnection } from "./relayConnection";
import type { MonitorLobbyWorld, MonitorResultView, MonitorWorld } from "./types";

/** 見守り画面を始めるのに要るもの（app/ が用意する） */
export interface MonitorScreenOptions {
  readonly plan: SchoolPlan;
  /** 開いた校舎の指紋（hello の planFingerprint と比べる） */
  readonly planFingerprint: string;
  /** 中継の URL（`<中継の住所>/rooms/<部屋の ID>?role=monitor`） */
  readonly relayUrl: string;
  /** 校舎の 3D を作る（scenes/school/ から組み立てる．maxAnisotropy はテクスチャの異方性フィルタの上限） */
  readonly createWorld: (maxAnisotropy: number) => MonitorWorld;
  /** ロビーの部屋と板を作る（lobby/ から組み立てる） */
  readonly createLobby: () => MonitorLobbyWorld;
  /** 結果画面（debrief/ から組み立てる） */
  readonly result: MonitorResultView;
}

/** カメラの画角（度）．生徒の画面（app/）と同じ値にそろえる */
const CAMERA_FOV_DEG = 70;

/** 赤い表示の縁（点滅させない） */
const ALERT_SHADOW_CSS = "inset 0 0 80px 40px rgba(230,20,20,0.8)";

/** 校舎を描かない時の背景色 */
const BLANK_BACKGROUND = 0x10141c;

/** 案内の文を画面の真ん中に出す要素を作る */
function createMessageBox(): HTMLDivElement {
  const box = document.createElement("div");
  box.style.cssText = [
    "position:fixed",
    "left:50%",
    "top:50%",
    "transform:translate(-50%,-50%)",
    "max-width:80vw",
    "padding:24px 40px",
    "border-radius:12px",
    "background:rgba(0,0,0,0.65)",
    "color:#fff",
    "font:bold clamp(20px,3.2vw,48px)/1.4 system-ui,sans-serif",
    "text-align:center",
    "pointer-events:none",
    "z-index:2",
  ].join(";");
  return box;
}

function setMessage(box: HTMLDivElement, message: string | null): void {
  if (message === null) {
    box.style.display = "none";
    return;
  }
  box.style.display = "block";
  if (box.textContent !== message) box.textContent = message;
}

/** F キーでブラウザの全画面を切り替える */
function bindFullscreenKey(): void {
  window.addEventListener("keydown", (event) => {
    if (event.key !== "f" && event.key !== "F") return;
    if (event.repeat || event.ctrlKey || event.metaKey || event.altKey) return;
    if (document.fullscreenElement) void document.exitFullscreen().catch(() => {});
    else void document.documentElement.requestFullscreen().catch(() => {});
  });
}

/** 見守り画面を始められない時（room= が無い・中継の住所が無い・校舎が読めない）に，案内だけを出す */
export function showMonitorNotice(message: string): void {
  document.body.style.margin = "0";
  document.body.style.background = "#10141c";
  const box = createMessageBox();
  setMessage(box, message);
  document.body.appendChild(box);
}

/** 見守り画面を始める．ウィンドウを閉じるまで動き続ける */
export function startMonitorScreen(options: MonitorScreenOptions): void {
  const { plan } = options;
  document.body.style.margin = "0";
  document.body.style.overflow = "hidden";

  const renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.setSize(window.innerWidth, window.innerHeight);
  document.body.appendChild(renderer.domElement);

  const world = options.createWorld(Math.min(renderer.capabilities.getMaxAnisotropy(), 8));
  const lobby = options.createLobby();
  // 赤い表示と結果画面の評価は生徒の画面と同じ定義で求めるため，開いた時に 1 回だけ延焼を求めておく
  const spread = computeSpread(plan);

  const scene = new THREE.Scene();
  scene.add(world.root, lobby.root);
  const worldBackground = new THREE.Color(world.background);
  const lobbyBackground = new THREE.Color(lobby.background);
  const blankBackground = new THREE.Color(BLANK_BACKGROUND);
  scene.background = blankBackground;

  const camera = new THREE.PerspectiveCamera(
    CAMERA_FOV_DEG,
    window.innerWidth / window.innerHeight,
    0.05,
    50,
  );
  // yaw（左右）を先に，pitch（上下）を後に当てる（頭の向きと同じ順．ロールは送られない）
  camera.rotation.order = "YXZ";
  camera.add(lobby.cameraAttachment);
  scene.add(camera);

  window.addEventListener("resize", () => {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
  });

  const alertFrame = document.createElement("div");
  alertFrame.style.cssText = `position:fixed;inset:0;pointer-events:none;z-index:1;box-shadow:${ALERT_SHADOW_CSS};display:none;`;
  document.body.appendChild(alertFrame);
  const messageBox = createMessageBox();
  document.body.appendChild(messageBox);
  bindFullscreenKey();

  const floorCount = plan.floors.length;
  const session = new MonitorSession(options.planFingerprint, floorCount);
  const applyEffect = (effect: MonitorEffect | null) => {
    if (effect === null) return;
    if (effect.kind === "resetDoors") world.resetDoors();
    else world.setDoorOpen(effect.cell, effect.open);
  };

  let relayStatus: RelayStatus = "connecting";
  // 受け取ったものは例外を外へ出さない（読めないものは share/ の関数が null にする）
  const connection = new RelayConnection(options.relayUrl, {
    onText: (text) => {
      const notice = parseMonitorNotice(text);
      if (notice) applyEffect(session.receiveNotice(notice, performance.now()));
    },
    onBinary: (data) => {
      const state = readMonitorState(data, floorCount);
      if (state) applyEffect(session.receiveState(state, performance.now()));
    },
    onStatus: (status) => {
      relayStatus = status;
    },
  });
  window.addEventListener("pagehide", () => connection.dispose());

  let lastAlert = false;
  let lastDraw: MonitorDrawKind = "blank";
  let lastNow: number | null = null;
  /** 今出している結果画面の記録（出していなければ null） */
  let shownTrack: DrillTrack | null = null;

  renderer.setAnimationLoop(() => {
    const now = performance.now();
    const dt = lastNow === null ? 0 : Math.min(0.1, (now - lastNow) / 1000);
    lastNow = now;
    const frame = session.frame(now);
    const display = resolveMonitorDisplay(frame, relayStatus);
    setMessage(messageBox, display.message);

    const alert = isMonitorAlert(plan, spread, display, frame.pose);
    if (alert !== lastAlert) {
      alertFrame.style.display = alert ? "block" : "none";
      lastAlert = alert;
    }

    // 結果画面は届いた記録を生徒の画面と同じ関数で評価し直して出す（評価は送られてこない）
    if (display.draw === "result" && frame.track != null && frame.track !== shownTrack) {
      shownTrack = frame.track;
      options.result.show({
        track: frame.track,
        evaluation: evaluateDrill(plan, spread, frame.track),
      });
    } else if (display.draw !== "result" && shownTrack !== null) {
      shownTrack = null;
      options.result.hide();
    }
    const enteredLobby = display.draw === "lobby" && lastDraw !== "lobby";
    lastDraw = display.draw;

    world.root.visible = display.draw === "start" || display.draw === "pose";
    lobby.root.visible = display.draw === "lobby";
    lobby.cameraAttachment.visible = display.draw === "lobby";

    if (display.draw === "blank" || display.draw === "result") {
      scene.background = blankBackground;
      scene.fog = null;
      renderer.render(scene, camera);
      return;
    }

    const pose = frame.pose;
    if (display.draw === "lobby") {
      scene.background = lobbyBackground;
      scene.fog = null;
      if (enteredLobby) lobby.reset();
      if (frame.lobby != null) lobby.show(frame.lobby);
      // 状態の yaw は右回りに増える（DrillSetup.startYaw と同じ）ので，3D の向き（正で左へ回る）にするには符号を反転する
      const headYaw = pose === null ? 0 : -pose.yaw;
      camera.position.set(0, lobby.eyeHeight, 0);
      camera.rotation.set(pose === null ? 0 : pose.pitch, headYaw, 0);
      lobby.follow(headYaw, dt);
      renderer.render(scene, camera);
      return;
    }

    scene.background = worldBackground;
    scene.fog = world.fog;
    if (display.draw === "pose" && pose !== null) {
      camera.position.set(pose.x, world.eyeHeight(pose.posture), pose.z);
      camera.rotation.set(pose.pitch, -pose.yaw, 0);
      // t が負（非常ベルの前）の間は火も煙も出さない
      world.update(pose.t >= 0 ? pose.t : Number.NaN, camera.position);
    } else {
      camera.position.set(world.start.x, world.eyeHeight("standing"), world.start.z);
      camera.rotation.set(0, world.start.yaw, 0);
      world.update(Number.NaN, camera.position);
    }
    renderer.render(scene, camera);
  });
}
