// 見守り画面（?monitor）の殻．中継から受け取った知らせと状態を MonitorSession に渡し，片目分の全画面（カメラ 1 つ）で
// ロビー・校舎を描き直し，終わったら届いた記録の結果画面を出す．
// 案内の文と赤い縁は DOM で重ねる．F でブラウザの全画面にする．最初のクリックの後は，生徒の端末と同じ音を鳴らす
// （SPEC_01「見守り」の「見守り画面」「音」）
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
import type { MonitorAudio, MonitorLobbyWorld, MonitorResultView, MonitorWorld } from "./types";

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
  /** 生徒と同じ音を鳴らす口（audio/ から組み立てる．省略すると音を出さず，クリックの案内も出さない） */
  readonly audio?: MonitorAudio;
}

/** 音を使えるようにする前に出す案内 */
const AUDIO_PROMPT = "クリックして音を出す";

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

/** 音を使えるようにするまで，画面の下に出す案内の要素を作る（画面のどこをクリックしてもよい） */
function createAudioPrompt(): HTMLDivElement {
  const prompt = document.createElement("div");
  prompt.textContent = AUDIO_PROMPT;
  prompt.style.cssText = [
    "position:fixed",
    "left:50%",
    "bottom:24px",
    "transform:translateX(-50%)",
    "padding:12px 28px",
    "border-radius:999px",
    "background:rgba(255,255,255,0.9)",
    "color:#10141c",
    "font:bold clamp(16px,2vw,28px)/1.4 system-ui,sans-serif",
    "cursor:pointer",
    "z-index:3",
  ].join(";");
  return prompt;
}

/**
 * 最初のクリックで音を使えるようにする（ブラウザの自動再生の制限のため）．使えるようになったら true を返す関数を返す．
 * 押すまでに届いた音の合図は捨てる（後から鳴らすと生徒の端末とずれるため）
 */
function bindAudioUnlock(audio: MonitorAudio): () => boolean {
  let enabled = false;
  const prompt = createAudioPrompt();
  document.body.appendChild(prompt);
  const onClick = (): void => {
    window.removeEventListener("click", onClick);
    prompt.remove();
    try {
      audio.enable();
      enabled = true;
    } catch {
      // 音が使えなくても映像は続ける
    }
  };
  window.addEventListener("click", onClick);
  return () => enabled;
}

/** 音の口を呼ぶ（音の失敗で受け取りを止めない） */
function safely(task: () => void): void {
  try {
    task();
  } catch {
    // 音が鳴らなくても映像は続ける
  }
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
  const audio = options.audio ?? null;
  const isAudioEnabled = audio === null ? () => false : bindAudioUnlock(audio);
  if (audio !== null) window.addEventListener("pagehide", () => safely(() => audio.dispose()));
  const applyEffect = (effect: MonitorEffect | null) => {
    if (effect === null) return;
    switch (effect.kind) {
      case "resetDoors":
        world.resetDoors();
        return;
      case "door":
        world.setDoorOpen(effect.cell, effect.open);
        return;
      case "cue":
        if (audio !== null && isAudioEnabled()) safely(() => audio.playCue(effect.cue));
        return;
      case "speech":
        if (audio !== null && isAudioEnabled()) safely(() => audio.speak(effect.text, effect.rate));
        return;
      case "stopAudio":
        if (audio !== null) safely(() => audio.stopAll());
        return;
    }
  };

  let relayStatus: RelayStatus = "connecting";
  // 受け取ったものは例外を外へ出さない（読めないものは share/ の関数が null にする）
  const connection = new RelayConnection(options.relayUrl, {
    onText: (text) => {
      const notice = parseMonitorNotice(text);
      if (notice === null) return;
      applyEffect(session.receiveNotice(notice, performance.now()));
      // 映す生徒が替わった・違う校舎になった時は，前の音を鳴らし続けない
      if (session.takeAudioStop() && audio !== null) safely(() => audio.stopAll());
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
