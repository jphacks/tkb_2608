// ゴーグルでの確認ページ（src/input/dev/goggles.html．experiment_山﨑/10「自分だけの dev ページ群」）．
// 最小限の空間（床の格子・距離の目安の柱・正面の目印）を StereoCamera で左右 2 画面に描き，
// createInputSource({ kind: "device" }) の判定で歩く・しゃがむ・見回す感覚を確かめる．
// 判定の状態は 3D 空間の中の板（canvas テクスチャ）に出す（HTML の重ね表示は片目にしか見えないため）．
// scenes/・render/・main.ts には依存しない（dev ページなので three.js は直接使う）
import * as THREE from "three";
import type { DeviceTracker } from "../deviceTracker";
import { createInputSource } from "../inputSource";
import { paramsFromSearch } from "../params";
import type { InputRecord, StateRecord } from "../recorder/records";
import { probeSensorPermission } from "../sensors/sensorSource";
import { AudioCues } from "./audioCues";
import { DetectLogger, paramsRecord } from "./detectLog";
import { rememberDevPage } from "./devPages";
import { type DevRecording, startDevRecording } from "./devRecording";

rememberDevPage("goggles.html");

function $(id: string): HTMLElement {
  const el = document.getElementById(id);
  if (el === null) throw new Error(`#${id} がありません`);
  return el;
}

const overlay = $("overlay");
const startButton = $("start") as HTMLButtonElement;
const soundBox = $("sound") as HTMLInputElement;
soundBox.checked = new URLSearchParams(location.search).get("sound") !== "0";

/** 目の高さ（m．仮の値） */
const EYE_STANDING = 1.6;
const EYE_CROUCHING = 1.0;
/** 目の高さのバネの固有角振動数（rad/s．臨界減衰で約 0.3 秒で動き終わる） */
const EYE_OMEGA = 16;

// ---- 空間 ----
const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.autoClear = false;
document.body.prepend(renderer.domElement);

const scene = new THREE.Scene();
scene.background = new THREE.Color("#101820");
scene.add(new THREE.HemisphereLight(0xffffff, 0x334455, 2.5));

const grid = new THREE.GridHelper(40, 40, 0x88aacc, 0x335066);
scene.add(grid);

// 距離の目安の柱: 正面（-z）に 1 m ごと，左右 1.5 m に並べる．5 m ごとに色を変える
const pillarGeo = new THREE.BoxGeometry(0.12, 2.2, 0.12);
const pillarMat = new THREE.MeshLambertMaterial({ color: 0x778899 });
const pillarMat5 = new THREE.MeshLambertMaterial({ color: 0xffcc66 });
for (let d = 1; d <= 15; d++) {
  for (const x of [-1.5, 1.5]) {
    const m = new THREE.Mesh(pillarGeo, d % 5 === 0 ? pillarMat5 : pillarMat);
    m.position.set(x, 1.1, -d);
    scene.add(m);
  }
}
// 後ろと左右の目印（見回した時に向きが分かるように）
const sideMat = new THREE.MeshLambertMaterial({ color: 0x5577aa });
for (const [x, z] of [
  [-6, 0],
  [6, 0],
  [0, 6],
]) {
  const m = new THREE.Mesh(new THREE.BoxGeometry(0.6, 0.6, 0.6), sideMat);
  m.position.set(x, 1.6, z);
  scene.add(m);
}
// 正面の目印（目の高さの赤い板と，立ち・しゃがみの目の高さの線）
const front = new THREE.Mesh(
  new THREE.BoxGeometry(0.8, 0.8, 0.05),
  new THREE.MeshLambertMaterial({ color: 0xe53935 }),
);
front.position.set(0, EYE_STANDING, -8);
scene.add(front);
for (const [y, color] of [
  [EYE_STANDING, 0x66bb6a],
  [EYE_CROUCHING, 0x42a5f5],
] as const) {
  const line = new THREE.Mesh(
    new THREE.BoxGeometry(6, 0.02, 0.02),
    new THREE.MeshBasicMaterial({ color }),
  );
  line.position.set(0, y, -6);
  scene.add(line);
}

const camera = new THREE.PerspectiveCamera(80, 1, 0.05, 60);
camera.position.set(0, EYE_STANDING, 0);
scene.add(camera);
const stereo = new THREE.StereoCamera();
stereo.eyeSep = 0.064;

// ---- 判定の状態の板（カメラの子にして視界の下の方に固定する．両目に同じ位置で見える） ----
const hudCanvas = document.createElement("canvas");
hudCanvas.width = 1024;
hudCanvas.height = 320;
const hudCtx = hudCanvas.getContext("2d");
const hudTexture = new THREE.CanvasTexture(hudCanvas);
hudTexture.colorSpace = THREE.SRGBColorSpace;
const hud = new THREE.Mesh(
  new THREE.PlaneGeometry(0.8, 0.25),
  new THREE.MeshBasicMaterial({ map: hudTexture, transparent: true, depthTest: false }),
);
hud.position.set(0, -0.33, -1);
hud.renderOrder = 10;
camera.add(hud);

// ---- 入力と記録 ----
const cues = new AudioCues();
let soundUnlocked = false;
let recording: DevRecording | null = null;
const record = (r: InputRecord) => recording?.recorder.record(r);

let lastChange: { t: number; text: string } | null = null;

function onState(r: StateRecord): void {
  if (r.event === "posture") {
    lastChange = {
      t: r.t,
      text: `${r.posture === "crouching" ? "しゃがんだ" : "立った"}（${r.detail ?? ""} Δh ${r.value ?? "-"} m）`,
    };
    if (soundBox.checked) {
      if (r.posture === "crouching") cues.beep(330, 300);
      else {
        cues.beep(660, 120);
        setTimeout(() => cues.beep(990, 160), 150);
      }
    }
  } else if (r.event === "step" && soundBox.checked) {
    cues.beep(1200, 40, 0.15);
  }
}
const logger = new DetectLogger(record, onState);

const input = createInputSource({
  kind: "device",
  calibration: null,
  params: paramsFromSearch(location.search),
  observer: { onMotion: (s, t) => logger.onMotion(s.t, t) },
});
const tracker = input.tracker as DeviceTracker;

// ---- 表示 ----
const LOCO_TEXT = { stopped: "止まる", tentative: "仮に歩く", walking: "歩く" } as const;
let hudKey = "";

function drawHud(now: number, walkSpeed: number): void {
  if (hudCtx === null) return;
  const b = tracker.body;
  const changeAgo =
    lastChange === null
      ? ""
      : `${((now - lastChange.t) / 1000).toFixed(0)} 秒前 ${lastChange.text}`;
  const notice =
    recording === null
      ? "開始していません"
      : soundBox.checked && !soundUnlocked
        ? "音: タップで有効"
        : "";
  const lines = [
    `${b.posture.posture === "crouching" ? "しゃがむ" : "立つ"}  ${LOCO_TEXT[b.locomotion.mode]}  ${walkSpeed.toFixed(2)} m/s`,
    `歩 ${b.step.stepCount}  除外 ${b.step.rejectedCount}  最後の歩 ${Number.isFinite(b.step.lastStepT) ? `${((now - b.step.lastStepT) / 1000).toFixed(1)} 秒前` : "-"}`,
    changeAgo,
    notice,
  ];
  const key = lines.join("|");
  if (key === hudKey) return;
  hudKey = key;
  const ctx = hudCtx;
  ctx.clearRect(0, 0, hudCanvas.width, hudCanvas.height);
  ctx.fillStyle = "rgba(0, 0, 0, 0.55)";
  ctx.fillRect(0, 0, hudCanvas.width, hudCanvas.height);
  ctx.fillStyle = "#fff";
  ctx.font = "bold 72px sans-serif";
  ctx.fillText(lines[0], 24, 84);
  ctx.font = "48px sans-serif";
  ctx.fillText(lines[1], 24, 160);
  ctx.fillStyle = "#9cf";
  ctx.font = "40px sans-serif";
  ctx.fillText(lines[2], 24, 222);
  ctx.fillStyle = "#fc6";
  ctx.fillText(lines[3], 24, 284);
  hudTexture.needsUpdate = true;
}

// ---- 動き（仮: 頭のヨーの向きへ進み，姿勢で目の高さを変える） ----
const position = new THREE.Vector3(0, 0, 0);
const forward = new THREE.Vector3();
let eyeY = EYE_STANDING;
let eyeRate = 0;
let lastNow: number | null = null;
let hudTimer = 0;

function resize(): void {
  renderer.setSize(window.innerWidth, window.innerHeight);
  camera.aspect = window.innerWidth / 2 / window.innerHeight;
  camera.updateProjectionMatrix();
}
window.addEventListener("resize", resize);
resize();

renderer.setAnimationLoop(() => {
  const now = performance.now();
  const dt = lastNow === null ? 0 : Math.min(0.1, Math.max(0, (now - lastNow) / 1000));
  lastNow = now;
  const p = input.read(now);
  camera.quaternion.set(p.head.x, p.head.y, p.head.z, p.head.w);
  if (p.walking && p.walkSpeed > 0) {
    forward.set(0, 0, -1).applyQuaternion(camera.quaternion);
    forward.y = 0;
    if (forward.lengthSq() > 1e-6) position.addScaledVector(forward.normalize(), p.walkSpeed * dt);
  }
  const target = p.posture === "crouching" ? EYE_CROUCHING : EYE_STANDING;
  // 臨界減衰のバネ（フレームが落ちた時に不安定にならないよう，1 回に進める時間を抑える）
  const springDt = Math.min(dt, 0.03);
  eyeRate += (EYE_OMEGA * EYE_OMEGA * (target - eyeY) - 2 * EYE_OMEGA * eyeRate) * springDt;
  eyeY += eyeRate * springDt;
  camera.position.set(position.x, eyeY, position.z);
  camera.updateMatrixWorld();

  hudTimer += dt;
  if (hudTimer >= 0.1) {
    hudTimer = 0;
    drawHud(now, p.walkSpeed);
  }

  stereo.update(camera);
  const w = window.innerWidth;
  const h = window.innerHeight;
  renderer.setScissorTest(true);
  renderer.clear();
  renderer.setScissor(0, 0, w / 2, h);
  renderer.setViewport(0, 0, w / 2, h);
  renderer.render(scene, stereo.cameraL);
  renderer.setScissor(w / 2, 0, w / 2, h);
  renderer.setViewport(w / 2, 0, w / 2, h);
  renderer.render(scene, stereo.cameraR);
  renderer.setScissorTest(false);
});

// ---- 開始 ----
let wakeLock: { release(): Promise<void> } | null = null;

function requestWakeLock(): void {
  const wl = (
    navigator as unknown as {
      wakeLock?: { request(type: "screen"): Promise<{ release(): Promise<void> }> };
    }
  ).wakeLock;
  wl?.request("screen").then(
    (lock) => {
      wakeLock = lock;
    },
    () => undefined,
  );
}

/** 全画面と横向きの固定（対応していない端末・iPhone の Safari では何もしない） */
function requestFullscreenLandscape(): void {
  const el = document.documentElement as HTMLElement & { requestFullscreen?: () => Promise<void> };
  el.requestFullscreen?.().then(
    () => {
      const so = screen.orientation as ScreenOrientation & {
        lock?: (o: string) => Promise<void>;
      };
      so.lock?.("landscape").catch(() => undefined);
    },
    () => undefined,
  );
}

function unlockSound(): void {
  cues.unlock();
  soundUnlocked = true;
  hudKey = "";
}

function start(fromTap: boolean): void {
  if (recording !== null || startButton.disabled) return;
  startButton.disabled = true;
  if (fromTap) {
    // 音・画面の常時点灯・全画面はタップの中でしか取れない
    unlockSound();
    requestWakeLock();
    requestFullscreenLandscape();
  }
  void startDevRecording("goggles", {}).then(
    (r) => {
      recording = r;
      r.recorder.record(paramsRecord(performance.now(), tracker.params));
      overlay.hidden = true;
      hudKey = "";
    },
    () => {
      startButton.disabled = false;
    },
  );
}

startButton.addEventListener("click", () => start(true));

// 開始の後のタップ: 音が未だなら有効にし，正面と位置をリセットする
renderer.domElement.addEventListener("click", () => {
  if (recording === null) return;
  if (!soundUnlocked) unlockSound();
  if (wakeLock === null) requestWakeLock();
  if (document.fullscreenElement == null) requestFullscreenLandscape();
  input.recenter();
  position.set(0, 0, 0);
});

// 画面が裏から戻った時は Wake Lock が外れるため取り直す
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "visible" && recording !== null && wakeLock !== null) {
    wakeLock = null;
    requestWakeLock();
  }
});

// 読み込み直し（HMR 等）の時，許可済みなら自動で再開する（音は鳴らないので板に案内を出す）
void probeSensorPermission().then(
  (p) => {
    const ok = (v: string) => v === "granted" || v === "not-required";
    if (ok(p.motion) && ok(p.orientation)) start(false);
  },
  () => undefined,
);
