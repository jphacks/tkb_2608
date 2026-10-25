// 判定の確認ページ（src/input/dev/detect.html）．センサーの値・判定の途中の値・判定の状態をグラフと数値で出し，
// しきい値をスライダーで変えられる．フライトレコーダーで生の値に加えて途中の値（detect）と結果（state）も記録する
import { standWalkBoundary } from "../body/posture";
import { StepResult } from "../body/stepDetector";
import type { DeviceTracker } from "../deviceTracker";
import { pitchOfQuat, yawOfQuat } from "../head/quat";
import { formatPlayerInput } from "../inputParam";
import { createInputSource } from "../inputSource";
import { DEFAULT_INPUT_PARAMS, paramsFromSearch } from "../params";
import type { InputRecord, StateRecord } from "../recorder/records";
import { probeSensorPermission } from "../sensors/sensorSource";
import { DetectLogger, paramsRecord } from "./detectLog";
import { rememberDevPage } from "./devPages";
import {
  type DevRecording,
  describeRecorderStatus,
  downloadJsonl,
  startDevRecording,
} from "./devRecording";
import { buildParamSliders } from "./paramSliders";
import { StripChart } from "./stripChart";

rememberDevPage("detect.html");

function $(id: string): HTMLElement {
  const el = document.getElementById(id);
  if (el === null) throw new Error(`#${id} がありません`);
  return el;
}

const startButton = $("start") as HTMLButtonElement;
const downloadButton = $("download") as HTMLButtonElement;
const stateEl = $("state");
const detailEl = $("detail");
const eventsEl = $("events");
const recorderEl = $("recorder");

const stepChart = new StripChart(
  $("stepChart") as HTMLCanvasElement,
  [
    { name: "上下の加速度", color: "#4fc3f7" },
    { name: "帯域通過後", color: "#fff176" },
    { name: "T_high", color: "#ef5350" },
    { name: "T_low", color: "#ab47bc" },
  ],
  300,
  4,
);
const stateChart = new StripChart(
  $("stateChart") as HTMLCanvasElement,
  [
    { name: "速さ", color: "#81c784" },
    { name: "Δh × 2", color: "#4fc3f7" },
    { name: "|回転速度| / 100", color: "#ffb74d" },
    { name: "歩（+1.5）・除外（-1.5）", color: "#ef5350" },
  ],
  300,
  2,
);

let recording: DevRecording | null = null;
const record = (r: InputRecord) => recording?.recorder.record(r);

/** 直近の出来事（表示用．歩は数が多いので除く） */
const recentEvents: string[] = [];
function onState(r: StateRecord): void {
  if (r.event === "step" || r.event === "step-rejected") return;
  const value = r.value === undefined || r.value === null ? "" : ` ${r.value}`;
  recentEvents.unshift(
    `${(r.t / 1000).toFixed(2)}s  ${r.event}${value}${r.detail ? ` (${r.detail})` : ""}  → ${r.posture} / ${r.loco}`,
  );
  recentEvents.length = Math.min(recentEvents.length, 12);
}
const logger = new DetectLogger(record, onState);

function onMotionProcessed(t: number, tracker: DeviceTracker): void {
  logger.onMotion(t, tracker);
  const b = tracker.body;
  stepChart.push(b.av, b.bp, b.thresholds.high, b.thresholds.low);
  const mark =
    b.lastStepResult === StepResult.Step ? 1.5 : b.lastStepResult === StepResult.None ? 0 : -1.5;
  stateChart.push(b.locomotion.speed, b.posture.h * 2, b.gyro / 100, mark);
}

const input = createInputSource({
  kind: "device",
  calibration: null,
  params: paramsFromSearch(location.search),
  observer: { onMotion: (s, tracker) => onMotionProcessed(s.t, tracker) },
});
// device の入力は必ず tracker を持つ
const tracker = input.tracker as DeviceTracker;

const syncSliders = buildParamSliders($("sliders"), tracker.params, (key, value) => {
  tracker.setParams({ [key]: value });
  record(paramsRecord(performance.now(), tracker.params));
});

$("defaults").addEventListener("click", () => {
  tracker.setParams(DEFAULT_INPUT_PARAMS);
  syncSliders(tracker.params);
  record(paramsRecord(performance.now(), tracker.params));
});
$("recenter").addEventListener("click", () => input.recenter());
$("reset").addEventListener("click", () => tracker.reset());

function f(v: number, digits = 2): string {
  return Number.isFinite(v) ? v.toFixed(digits) : "-";
}

function render(): void {
  const now = performance.now();
  const p = input.read(now);
  stateEl.textContent = formatPlayerInput(p);
  const b = tracker.body;
  const s = b.step;
  const po = b.posture;
  const timing = tracker.timing;
  const raw = tracker.head;
  detailEl.textContent = [
    `足踏み   ${b.locomotion.mode}  周期 ${f(b.locomotion.periodSec)} s  速さ ${f(b.locomotion.speed)} m/s`,
    `         歩 ${s.stepCount}  除外 ${s.rejectedCount}  直近の山 ${f(s.lastStepPeak)}  ノイズ RMS ${f(Math.sqrt(s.noiseVar), 3)}`,
    `         T_high ${f(b.thresholds.high)}  T_low ${f(b.thresholds.low)}`,
    `しゃがみ ${po.phase}  v ${f(po.v)} m/s  h ${f(po.h)} m  直近 Δh ${f(po.lastDeltaH)} m（${po.lastOutcome}）`,
    `         逃げ道 ${po.escapeCount}/${tracker.params.standEscapeSteps}  しゃがみ歩きから立つ ${po.walkCount}/${tracker.params.standWalkSteps}（境目 ${f(standWalkBoundary(tracker.params))}・直近の山 ${f(po.walkLastPeak)}）  切り替え ${po.changeCount} 回`,
    `頭       画面 ${raw.screenAngle}°  先読み ${tracker.params.headPredictionMs} ms  yaw ${f((yawOfQuat(p.head) * 180) / Math.PI, 1)}°  pitch ${f((pitchOfQuat(p.head) * 180) / Math.PI, 1)}°`,
    `サンプル 使用 ${b.sampleCount}  捨て ${b.droppedCount}  初期化 ${b.resetCount}  間隔 ${f(b.dtEstSec * 1000, 1)} ms`,
    `処理時間 平均 ${f(timing.count > 0 ? (timing.totalMs / timing.count) * 1000 : 0, 1)} µs  最大 ${f(timing.maxMs * 1000, 1)} µs`,
  ].join("\n");
  eventsEl.textContent = recentEvents.length === 0 ? "-" : recentEvents.join("\n");
  if (recording !== null) {
    recorderEl.textContent = describeRecorderStatus(recording.recorder.status(), now);
  }
  stepChart.draw();
  stateChart.draw();
  requestAnimationFrame(render);
}

function start(): void {
  if (recording !== null || startButton.disabled) return;
  startButton.disabled = true;
  // 許可は startDevRecording の中で取る（input/ の購読は作った時から始めている）
  void startDevRecording("detect").then(
    (r) => {
      recording = r;
      r.recorder.record(paramsRecord(performance.now(), tracker.params));
      startButton.textContent = `記録中（motion: ${r.permission.motion} / orientation: ${r.permission.orientation}）`;
      downloadButton.disabled = false;
    },
    () => {
      startButton.disabled = false;
    },
  );
}

startButton.addEventListener("click", start);
downloadButton.addEventListener("click", () => {
  if (recording !== null) downloadJsonl(recording.recorder);
});

// 許可済み（iOS）か許可が要らない端末なら，読み込み時に自動で始める
void probeSensorPermission().then(
  (p) => {
    const ok = (v: string) => v === "granted" || v === "not-required";
    if (ok(p.motion) && ok(p.orientation)) start();
  },
  () => undefined,
);

requestAnimationFrame(render);
