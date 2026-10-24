// センサー確認ページ（src/input/dev/sensors.html）．値・簡易グラフ・サンプルの周期・記録の状態を出す．
// フライトレコーダーも動かし，記録は開発サーバーの logs/input/ に送る
import { probeSensorPermission } from "../sensors/sensorSource";
import type { MotionSample, OrientationSample, ScreenSample } from "../sensors/types";
import { rememberDevPage } from "./devPages";
import {
  type DevRecording,
  describeRecorderStatus,
  downloadJsonl,
  startDevRecording,
} from "./devRecording";
import { StripChart } from "./stripChart";

// 入口（./）を開いた時に，このページへ自動で戻れるようにする
rememberDevPage("sensors.html");

function $(id: string): HTMLElement {
  const el = document.getElementById(id);
  if (el === null) throw new Error(`#${id} がありません`);
  return el;
}

const startButton = $("start") as HTMLButtonElement;
const downloadButton = $("download") as HTMLButtonElement;
const permissionEl = $("permission");
const motionEl = $("motion");
const orientationEl = $("orientation");
const screenEl = $("screen");
const rateEl = $("rate");
const recorderEl = $("recorder");

/** 60 Hz で 5 秒分 */
const chart = new StripChart(
  $("chart") as HTMLCanvasElement,
  [
    { name: "上下の加速度（重力方向の成分 − g, m/s²）", color: "#4fc3f7" },
    { name: "|回転速度| / 50（deg/s）", color: "#ffb74d" },
  ],
  300,
  10,
);

// 表示用の最新の値（イベントでは代入だけにし，描画は requestAnimationFrame でまとめる）
let lastMotion: MotionSample | null = null;
let lastOrientation: OrientationSample | null = null;
let lastScreen: ScreenSample | null = null;

// サンプルの間隔（実際の timeStamp の差）の直近 120 個
const INTERVALS = 120;
const intervals = new Float32Array(INTERVALS);
let intervalHead = 0;
let intervalCount = 0;
let prevMotionT: number | null = null;
let motionCount = 0;
let orientationCount = 0;
/** 間隔が 0 以下か 200 ms を超えた回数（experiment_山﨑/09「dt が飛ぶ・戻る」） */
let gapCount = 0;

// 重力の向きの見積もり（重力を含む加速度の指数移動平均．時定数 1 秒）
let gx = 0;
let gy = 0;
let gz = 0;
let gravityReady = false;
const GRAVITY_TAU_MS = 1000;

function onMotion(s: MotionSample): void {
  motionCount++;
  if (prevMotionT !== null) {
    const dt = s.t - prevMotionT;
    if (dt <= 0 || dt > 200) gapCount++;
    intervals[intervalHead] = dt;
    intervalHead = (intervalHead + 1) % INTERVALS;
    intervalCount = Math.min(intervalCount + 1, INTERVALS);
  }
  const dt = prevMotionT === null ? 0 : Math.max(0, Math.min(200, s.t - prevMotionT));
  prevMotionT = s.t;
  lastMotion = s;

  let vertical = Number.NaN;
  if (s.accG !== null) {
    if (!gravityReady) {
      gx = s.accG.x;
      gy = s.accG.y;
      gz = s.accG.z;
      gravityReady = true;
    } else {
      const k = 1 - Math.exp(-dt / GRAVITY_TAU_MS);
      gx += (s.accG.x - gx) * k;
      gy += (s.accG.y - gy) * k;
      gz += (s.accG.z - gz) * k;
    }
    const g = Math.hypot(gx, gy, gz);
    if (g > 1e-3) vertical = (s.accG.x * gx + s.accG.y * gy + s.accG.z * gz) / g - g;
  }
  const rot = s.rot === null ? Number.NaN : Math.hypot(s.rot.alpha, s.rot.beta, s.rot.gamma) / 50;
  chart.push(vertical, rot);
}

function fmt(v: number | null | undefined, digits = 2): string {
  return v === null || v === undefined ? "null" : v.toFixed(digits);
}

function fmtVec(v: { x: number; y: number; z: number } | null): string {
  return v === null ? "null" : `x ${fmt(v.x)}  y ${fmt(v.y)}  z ${fmt(v.z)}`;
}

let recording: DevRecording | null = null;

function render(): void {
  const m = lastMotion;
  motionEl.textContent =
    m === null
      ? "（まだ届いていません）"
      : [
          `acc   ${fmtVec(m.acc)}`,
          `accG  ${fmtVec(m.accG)}`,
          `rot   ${m.rot === null ? "null" : `α ${fmt(m.rot.alpha)}  β ${fmt(m.rot.beta)}  γ ${fmt(m.rot.gamma)}`}`,
          `interval（申告） ${fmt(m.interval)} ms`,
        ].join("\n");
  const o = lastOrientation;
  orientationEl.textContent =
    o === null
      ? "（まだ届いていません）"
      : `α ${fmt(o.alpha)}  β ${fmt(o.beta)}  γ ${fmt(o.gamma)}  absolute ${o.absolute}`;
  screenEl.textContent =
    lastScreen === null ? "-" : `${lastScreen.angle}°  ${lastScreen.orientationType ?? ""}`;

  let sum = 0;
  let max = 0;
  for (let i = 0; i < intervalCount; i++) {
    sum += intervals[i];
    max = Math.max(max, intervals[i]);
  }
  const mean = intervalCount > 0 ? sum / intervalCount : 0;
  rateEl.textContent =
    intervalCount === 0
      ? "-"
      : `平均 ${mean.toFixed(2)} ms（${(1000 / mean).toFixed(1)} Hz）  最大 ${max.toFixed(1)} ms  飛び ${gapCount} 回  motion ${motionCount} 件  orientation ${orientationCount} 件`;

  if (recording !== null) {
    recorderEl.textContent = describeRecorderStatus(recording.recorder.status(), performance.now());
  }
  chart.draw();
  requestAnimationFrame(render);
}

function startRecording(): void {
  if (recording !== null || startButton.disabled) return;
  startButton.disabled = true;
  void startDevRecording("sensors", {
    onMotion,
    onOrientation: (s) => {
      orientationCount++;
      lastOrientation = s;
    },
    onScreen: (s) => {
      lastScreen = s;
    },
  }).then(
    (r) => {
      recording = r;
      permissionEl.textContent = `motion: ${r.permission.motion} / orientation: ${r.permission.orientation}`;
      startButton.textContent = "記録中";
      downloadButton.disabled = false;
    },
    () => {
      startButton.disabled = false;
    },
  );
}

startButton.addEventListener("click", startRecording);

// 再読み込み（Vite の HMR 等）のたびにボタンを押し直さなくて済むよう，
// 既に許可済み（iOS）か許可が要らない端末なら，読み込み時に自動で記録を始める
void probeSensorPermission().then(
  (p) => {
    const ok = (v: string) => v === "granted" || v === "not-required";
    if (ok(p.motion) && ok(p.orientation)) startRecording();
    else
      permissionEl.textContent = `motion: ${p.motion} / orientation: ${p.orientation}（ボタンで許可）`;
  },
  () => undefined,
);

downloadButton.addEventListener("click", () => {
  if (recording !== null) downloadJsonl(recording.recorder);
});

requestAnimationFrame(render);
