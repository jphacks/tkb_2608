// 手の確認ページ（src/input/dev/hands.html）．カメラの映像に 21 点・手の形・遅れを重ね，
// 認識の結果（21 点）をフライトレコーダーで logs/input/ に記録する（experiment_山﨑/07・10）
import type { Handedness } from "../../core/types";
import { HandCamera } from "../hand/handCamera";
import { requestHandCameraStream } from "../hand/handCameraStream";
import { type HandParams, handParamsFromSearch } from "../hand/handParams";
import { cameraModelOf } from "../hand/handTracker";
import { headToImage } from "../hand/projection";
import { HAND_CONNECTIONS, type HandFrameResult, type HandReading } from "../hand/types";
import { handRecord } from "../recorder/records";
import { rememberDevPage } from "./devPages";
import {
  type DevRecording,
  describeRecorderStatus,
  downloadJsonl,
  startDevRecording,
} from "./devRecording";

rememberDevPage("hands.html");

function $(id: string): HTMLElement {
  const el = document.getElementById(id);
  if (el === null) throw new Error(`#${id} がありません`);
  return el;
}

const startButton = $("start") as HTMLButtonElement;
const downloadButton = $("download") as HTMLButtonElement;
const canvas = $("view") as HTMLCanvasElement;
const statsEl = $("stats");
const handsEl = $("hands");
const recorderEl = $("recorder");
const ctx = canvas.getContext("2d");

const search = new URLSearchParams(location.search);
const overrides = handParamsFromSearch(location.search);
let recording: DevRecording | null = null;

const hands = new HandCamera({
  params: overrides,
  useWorker: search.get("worker") !== "0",
  onResult: (r) => recording?.recorder.record(handRecord(r)),
});

/** 記録に残すしきい値（数の項目だけ） */
function numericParams(p: HandParams): Record<string, number> {
  const out: Record<string, number> = {};
  for (const [k, v] of Object.entries(p)) if (typeof v === "number") out[k] = v;
  return out;
}

const SIDE_COLOR: Record<Handedness, string> = { left: "#4fc3f7", right: "#ffb74d" };

function drawResult(r: HandFrameResult, w: number, h: number): void {
  if (ctx === null) return;
  ctx.lineWidth = 2;
  for (const hand of r.hands) {
    // MediaPipe の左右は背面カメラでは逆（handedness.ts）．色は直した後の左右で付ける
    const side: Handedness = hand.label === "left" ? "right" : "left";
    ctx.strokeStyle = SIDE_COLOR[side];
    ctx.fillStyle = SIDE_COLOR[side];
    for (const [a, b] of HAND_CONNECTIONS) {
      const pa = hand.landmarks[a];
      const pb = hand.landmarks[b];
      ctx.beginPath();
      ctx.moveTo(pa.x * w, pa.y * h);
      ctx.lineTo(pb.x * w, pb.y * h);
      ctx.stroke();
    }
    for (const p of hand.landmarks) ctx.fillRect(p.x * w - 2, p.y * h - 2, 4, 4);
  }
}

function drawReading(side: Handedness, reading: HandReading, w: number, h: number): void {
  if (ctx === null || !reading.tracked) return;
  const r = hands.lastResult;
  const cam = cameraModelOf(hands.currentParams, r?.width ?? w, r?.height ?? h);
  const palm = headToImage(reading.position, cam);
  const tip = headToImage(reading.indexTip, cam);
  if (palm !== null) {
    ctx.strokeStyle = "#fff";
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.arc(
      palm.x * w,
      palm.y * h,
      reading.grip >= hands.currentParams.gripOn ? 14 : 8,
      0,
      Math.PI * 2,
    );
    ctx.stroke();
    ctx.fillStyle = "#fff";
    ctx.font = "14px ui-monospace, monospace";
    const shape = [
      side === "left" ? "L" : "R",
      reading.grip >= hands.currentParams.gripOn ? "握" : "",
      reading.pinching ? "摘" : "",
      reading.pointing ? "指" : "",
    ].join(" ");
    ctx.fillText(shape, palm.x * w + 16, palm.y * h);
  }
  if (tip !== null) {
    ctx.fillStyle = "#ff0";
    ctx.beginPath();
    ctx.arc(tip.x * w, tip.y * h, 5, 0, Math.PI * 2);
    ctx.fill();
  }
}

function fmt(v: number, digits = 1): string {
  return Number.isFinite(v) ? v.toFixed(digits) : "-";
}

function describeHand(side: Handedness, r: HandReading): string {
  const track = hands.track(side);
  if (!r.tracked) return `${side.padEnd(5)} -（最後に見えてから ${fmt(r.ageMs, 0)} ms）`;
  const p = r.position;
  return [
    `${side.padEnd(5)} pos (${fmt(p.x, 2)}, ${fmt(p.y, 2)}, ${fmt(p.z, 2)}) m  奥行き ${fmt(track.depth, 2)} m`,
    `      grip ${fmt(r.grip, 2)}（生 ${fmt(track.gripRaw, 2)}）  pinch ${fmt(r.pinch, 2)}${r.pinching ? " つまむ" : ""}${r.pointing ? "  指を差す" : ""}  経過 ${fmt(r.ageMs, 0)} ms`,
  ].join("\n");
}

function render(): void {
  const now = performance.now();
  hands.read(now);
  const detail = hands.readDetail(now);
  const video = hands.video;
  if (ctx !== null && video !== null && video.videoWidth > 0) {
    if (canvas.width !== video.videoWidth || canvas.height !== video.videoHeight) {
      canvas.width = video.videoWidth;
      canvas.height = video.videoHeight;
    }
    const w = canvas.width;
    const h = canvas.height;
    ctx.drawImage(video, 0, 0, w, h);
    const r = hands.lastResult;
    if (r !== null) drawResult(r, w, h);
    drawReading("left", detail.left, w, h);
    drawReading("right", detail.right, w, h);
  }
  const s = hands.stats;
  const r = hands.lastResult;
  statsEl.textContent = [
    `状態 ${s.status}  処理 ${s.backend ?? "-"}（${s.delegate ?? "-"}）${s.error === null ? "" : `\n${s.error}`}`,
    `描画 ${fmt(s.fps)} fps  認識の目標 ${s.rateHz} 回/秒  実際 ${fmt(s.resultHz)} 回/秒`,
    `認識 ${fmt(s.inferMs)} ms  映像 → 結果 ${fmt(s.latencyMs)} ms  最後の結果から ${r === null ? "-" : fmt(now - r.t, 0)} ms`,
    `画像 ${r === null ? "-" : `${r.width}x${r.height}`}  手 ${r?.hands.length ?? 0} 個`,
  ].join("\n");
  handsEl.textContent = [
    describeHand("left", detail.left),
    describeHand("right", detail.right),
  ].join("\n");
  if (recording !== null) {
    recorderEl.textContent = describeRecorderStatus(recording.recorder.status(), now);
  }
  requestAnimationFrame(render);
}

startButton.addEventListener("click", () => {
  if (startButton.disabled) return;
  startButton.disabled = true;
  // カメラとセンサーの許可はどちらもタップの中で呼び始める
  const cameraPromise = requestHandCameraStream();
  void startDevRecording("hands").then(
    (r) => {
      recording = r;
      r.recorder.record({
        type: "params",
        t: performance.now(),
        params: numericParams(hands.currentParams),
      });
      downloadButton.disabled = false;
    },
    () => undefined,
  );
  void cameraPromise.then((stream) => {
    if (stream === null) {
      statsEl.textContent = "カメラを使えません（許可・HTTPS を確かめる）";
      startButton.disabled = false;
      return;
    }
    hands.attach(stream);
    startButton.textContent = "記録中";
  });
});

downloadButton.addEventListener("click", () => {
  if (recording !== null) downloadJsonl(recording.recorder);
});

requestAnimationFrame(render);
