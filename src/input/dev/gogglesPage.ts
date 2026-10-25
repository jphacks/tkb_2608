// ゴーグルでの確認ページ（src/input/dev/goggles.html．experiment_山﨑/10「自分だけの dev ページ群」）．
// 最小限の空間（床の格子・距離の目安の柱・正面の目印）を StereoCamera で左右 2 画面に描き，
// createInputSource({ kind: "device" }) の判定で歩く・しゃがむ・見回す感覚を確かめる．
// 判定の状態は 3D 空間の中の板（canvas テクスチャ）に出す（HTML の重ね表示は片目にしか見えないため）．
// 開始の後に 10 秒のカウントダウン（装着の間）を挟んで短いキャリブレーション（約 15 秒．gogglesCalibration.ts）を行い，求めたしきい値で判定する（?calib=0 でしない）．
// scenes/・render/・main.ts には依存しない（dev ページなので three.js は直接使う）
import * as THREE from "three";
import type { CalibrationSegment } from "../../core/types";
import { type CalibrationResult, calibrateParams } from "../body/calibration";
import { standWalkBoundary } from "../body/posture";
import type { DeviceTracker } from "../deviceTracker";
import { createInputSource } from "../inputSource";
import { paramsFromSearch } from "../params";
import {
  buildSchedule,
  locate,
  type ProtocolEvent,
  type ProtocolSchedule,
  scheduleEvents,
  takeDueEvents,
} from "../recorder/protocolSchedule";
import { type InputRecord, roundTo, type StateRecord } from "../recorder/records";
import { probeSensorPermission } from "../sensors/sensorSource";
import type { MotionSample } from "../sensors/types";
import { AudioCues } from "./audioCues";
import { DetectLogger, paramsRecord } from "./detectLog";
import { rememberDevPage } from "./devPages";
import { type DevRecording, startDevRecording } from "./devRecording";
import {
  CALIBRATION_COUNTDOWN_TEXT,
  calibratedOverrides,
  calibrationProtocolSteps,
  describeCalibratedParams,
  describeMeasurements,
  gogglesCalibrationFromSearch,
  isCalibrationKind,
} from "./gogglesCalibration";

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
hudCanvas.height = 420;
const hudCtx = hudCanvas.getContext("2d");
const hudTexture = new THREE.CanvasTexture(hudCanvas);
hudTexture.colorSpace = THREE.SRGBColorSpace;
const hud = new THREE.Mesh(
  new THREE.PlaneGeometry(0.8, 0.33),
  new THREE.MeshBasicMaterial({ map: hudTexture, transparent: true, depthTest: false }),
);
hud.position.set(0, -0.3, -1);
hud.renderOrder = 10;
camera.add(hud);

// ---- 開始の後のカウントダウンの板（カメラの子にして視界の正面の中央に固定する．両目の視界の中央に見える） ----
const centerCanvas = document.createElement("canvas");
centerCanvas.width = 512;
centerCanvas.height = 384;
const centerCtx = centerCanvas.getContext("2d");
const centerTexture = new THREE.CanvasTexture(centerCanvas);
centerTexture.colorSpace = THREE.SRGBColorSpace;
const centerBoard = new THREE.Mesh(
  new THREE.PlaneGeometry(0.4, 0.3),
  new THREE.MeshBasicMaterial({ map: centerTexture, transparent: true, depthTest: false }),
);
centerBoard.position.set(0, 0, -1);
centerBoard.renderOrder = 11;
centerBoard.visible = false;
camera.add(centerBoard);

/** 中央の板に数字と添え書きを描く */
function drawCenterBoard(sec: number): void {
  if (centerCtx === null) return;
  const ctx = centerCtx;
  const w = centerCanvas.width;
  ctx.clearRect(0, 0, w, centerCanvas.height);
  ctx.fillStyle = "rgba(0, 0, 0, 0.6)";
  ctx.fillRect(0, 0, w, centerCanvas.height);
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillStyle = "#fff";
  ctx.font = "bold 220px sans-serif";
  ctx.fillText(String(sec), w / 2, 160);
  ctx.fillStyle = "#fc6";
  ctx.font = "bold 44px sans-serif";
  ctx.fillText(CALIBRATION_COUNTDOWN_TEXT, w / 2, 330);
  centerTexture.needsUpdate = true;
}

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

/** URL のしきい値（キャリブレーションで求めた値より優先する） */
const urlParams = paramsFromSearch(location.search);
const calibOptions = gogglesCalibrationFromSearch(location.search);

/** キャリブレーションの進み具合．null はしていない（?calib=0・開始の前） */
interface CalibrationRun {
  phase: "running" | "finishing" | "done";
  readonly schedule: ProtocolSchedule;
  readonly events: readonly ProtocolEvent[];
  /** 手順の時刻 0（performance.now() の ms） */
  readonly t0: number;
  cursor: number;
  lastCountdownKey: number;
  /** 区間の始まりの時刻（ms．センサーのサンプルの t と同じ時計） */
  readonly starts: Map<string, number>;
  readonly segments: CalibrationSegment[];
  /** キャリブレーションの間のサンプル（準備の間も含む．重力の向きと帯域通過を落ち着かせるため） */
  readonly samples: MotionSample[];
  result: CalibrationResult | null;
  /** 視界の板に出す案内（running・finishing の間） */
  lines: string[];
}
let calib: CalibrationRun | null = null;
let calibTimer: ReturnType<typeof setInterval> | null = null;
/** 開始の後のカウントダウン（キャリブレーションの前．null はしていない） */
let countdown: { readonly t0: number; lastSec: number } | null = null;
let countdownTimer: ReturnType<typeof setInterval> | null = null;

const input = createInputSource({
  kind: "device",
  calibration: null,
  params: urlParams,
  observer: {
    onMotion: (s, t) => {
      logger.onMotion(s.t, t);
      if (calib?.phase === "running") calib.samples.push(s);
    },
  },
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
  const state = `${b.posture.posture === "crouching" ? "しゃがむ" : "立つ"}  ${LOCO_TEXT[b.locomotion.mode]}  ${walkSpeed.toFixed(2)} m/s`;
  // キャリブレーションの間は案内を大きく出し，判定の状態は下に小さく出す
  const lines =
    countdown !== null
      ? ["キャリブレーションの前", CALIBRATION_COUNTDOWN_TEXT, "", notice, state, ""]
      : calib !== null && calib.phase !== "done"
        ? [calib.lines[0] ?? "", calib.lines[1] ?? "", calib.lines[2] ?? "", notice, state, ""]
        : [
            state,
            `歩 ${b.step.stepCount}  除外 ${b.step.rejectedCount}  最後の歩 ${Number.isFinite(b.step.lastStepT) ? `${((now - b.step.lastStepT) / 1000).toFixed(1)} 秒前` : "-"}${Number.isNaN(standWalkBoundary(tracker.params)) ? "" : `  立歩 ${b.posture.walkCount}/${tracker.params.standWalkSteps}`}`,
            changeAgo,
            notice,
            calib === null ? "" : describeCalibratedParams(tracker.params, calib.result),
            calib?.result == null ? "" : describeMeasurements(calib.result.measurements),
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
  ctx.font = "44px sans-serif";
  ctx.fillText(lines[1], 24, 160);
  ctx.fillStyle = "#9cf";
  ctx.font = "40px sans-serif";
  ctx.fillText(lines[2], 24, 222);
  ctx.fillStyle = "#fc6";
  ctx.fillText(lines[3], 24, 284);
  ctx.fillStyle = "#cfc";
  ctx.font = "34px sans-serif";
  ctx.fillText(lines[4], 24, 340);
  ctx.fillText(lines[5], 24, 392);
  hudTexture.needsUpdate = true;
}

// ---- キャリブレーション ----
/** 準備の終わりに鳴らす 3・2・1 の合図（秒） */
const COUNTDOWN = [3, 2, 1];

/**
 * 開始の後，スマホをゴーグルに入れて装着する間のカウントダウン（startDelayMs．視界の中央に 10, 9, ..., 1 を出す）．
 * この間も判定とセンサーの記録は動くが，キャリブレーションのサンプルには入れない（calib がまだ無いため）
 */
function startCountdown(): void {
  countdown = { t0: performance.now(), lastSec: -1 };
  centerBoard.visible = true;
  hudKey = "";
  cues.speak(
    `${CALIBRATION_COUNTDOWN_TEXT}．${Math.ceil(calibOptions.startDelayMs / 1000)}秒後に始めます`,
  );
  countdownTimer = setInterval(countdownTick, 50);
  countdownTick();
}

function countdownTick(): void {
  const c = countdown;
  if (c === null) return;
  const remainingMs = calibOptions.startDelayMs - (performance.now() - c.t0);
  if (remainingMs <= 0) {
    if (countdownTimer !== null) clearInterval(countdownTimer);
    countdownTimer = null;
    countdown = null;
    centerBoard.visible = false;
    hudKey = "";
    startCalibration();
    return;
  }
  const sec = Math.ceil(remainingMs / 1000);
  if (sec === c.lastSec) return;
  c.lastSec = sec;
  drawCenterBoard(sec);
  if (soundBox.checked) cues.beep(sec <= 3 ? 880 : 660, 80, 0.2);
}

function calibTitle(e: ProtocolEvent): string {
  return e.segment?.step.title ?? "";
}

function startCalibration(): void {
  const schedule = buildSchedule(
    calibrationProtocolSteps(calibOptions.lengths),
    calibOptions.prepMs / 1000,
  );
  calib = {
    phase: "running",
    schedule,
    events: scheduleEvents(schedule),
    t0: performance.now(),
    cursor: 0,
    lastCountdownKey: -1,
    starts: new Map(),
    segments: [],
    samples: [],
    result: null,
    lines: ["キャリブレーション", "", ""],
  };
  calibTimer = setInterval(calibTick, 50);
  calibTick();
}

function calibTick(): void {
  const c = calib;
  if (c === null || c.phase !== "running") return;
  const now = performance.now();
  const elapsed = now - c.t0;
  const taken = takeDueEvents(c.events, c.cursor, elapsed);
  c.cursor = taken.cursor;
  for (const e of taken.due) {
    const kind = e.segment?.step.label ?? "";
    switch (e.kind) {
      case "prep":
        cues.speak(`次は${calibTitle(e)}．${e.segment?.step.instruction ?? ""}`);
        break;
      case "start":
        c.starts.set(kind, now);
        cues.beep(1320, 400);
        break;
      case "end": {
        const startMs = c.starts.get(kind);
        if (startMs !== undefined && isCalibrationKind(kind)) {
          c.segments.push({ kind, startMs, endMs: now, outcome: "completed" });
        }
        cues.beep(660, 120);
        setTimeout(() => cues.beep(660, 120), 180);
        break;
      }
      case "done":
        finishCalibration(c);
        return;
      default:
        break;
    }
  }
  const pos = locate(c.schedule, elapsed);
  const total = c.schedule.segments.length;
  if (pos.phase === "prep") {
    const sec = Math.ceil(pos.remainingMs / 1000);
    c.lines = [
      `次: ${pos.segment.step.title}`,
      pos.segment.step.instruction,
      `準備 ${sec}  [${pos.segment.index + 1}/${total}]`,
    ];
    const key = pos.segment.index * 10 + sec;
    if (COUNTDOWN.includes(sec) && key !== c.lastCountdownKey) {
      c.lastCountdownKey = key;
      cues.beep(880, 100);
    }
  } else if (pos.phase === "active") {
    c.lines = [
      pos.segment.step.title,
      pos.segment.step.instruction,
      `${Math.ceil(pos.remainingMs / 1000)}  [${pos.segment.index + 1}/${total}]`,
    ];
  }
}

/**
 * 区間が終わったら値を求め，立ち上がって正面を向く時間（finishMs）の後に判定に反映する．
 * 前処理の設定と上書きの基準は，その時の判定のしきい値（既定値に URL の値を重ねたもの）
 */
function finishCalibration(c: CalibrationRun): void {
  if (calibTimer !== null) clearInterval(calibTimer);
  calibTimer = null;
  c.phase = "finishing";
  c.result = calibrateParams(c.samples, c.segments, tracker.params);
  c.lines = ["おわり", "立ち上がって正面を向いてください", ""];
  cues.speak("おわりです．立ち上がって正面を向いてください");
  setTimeout(() => applyCalibration(c), calibOptions.finishMs);
}

function applyCalibration(c: CalibrationRun): void {
  if (c.result === null) return;
  // 既定値 → キャリブレーションの値 → URL のしきい値の順に重ねる（URL で指定した項目は URL の値のまま）
  tracker.setParams(calibratedOverrides(c.result.overrides, urlParams));
  // キャリブレーションの間に動いた分を捨て，立った姿勢・正面・原点から始める
  tracker.reset();
  tracker.body.posture.posture = "standing";
  input.recenter();
  position.set(0, 0, 0);
  c.phase = "done";
  hudKey = "";
  const now = performance.now();
  record({
    type: "mark",
    t: roundTo(now, 3) ?? 0,
    kind: "calibration",
    note: JSON.stringify({
      segments: c.segments.map((s) => ({
        ...s,
        startMs: roundTo(s.startMs, 3),
        endMs: roundTo(s.endMs, 3),
      })),
      overrides: c.result.overrides,
      measurements: c.result.measurements,
      notes: c.result.notes,
    }),
  });
  record(paramsRecord(now, tracker.params));
  cues.beep(1320, 200);
  cues.speak("求めた値で判定します");
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
      if (calibOptions.enabled) {
        if (calibOptions.startDelayMs > 0) startCountdown();
        else startCalibration();
      }
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
