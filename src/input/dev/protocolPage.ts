// 手順記録ページ（src/input/dev/protocol.html）．決まった手順を表示と音で案内し，
// 案内した時刻から label レコードを自動で書く（experiment_山﨑/06・10）．
// ゴーグルに入れたまま見られるよう，表示は左右の 2 画面に同じものを出す
import {
  buildSchedule,
  cueRecordFor,
  DEFAULT_PROTOCOL_STEPS,
  labelRecordFor,
  locate,
  type ProtocolEvent,
  scheduleEvents,
  segmentCues,
  takeDueEvents,
} from "../recorder/protocolSchedule";
import { roundTo } from "../recorder/records";
import { AudioCues } from "./audioCues";
import { rememberDevPage } from "./devPages";
import {
  type DevRecording,
  describeRecorderStatus,
  downloadJsonl,
  startDevRecording,
} from "./devRecording";

// 入口（./）を開いた時に，このページへ自動で戻れるようにする
rememberDevPage("protocol.html");

function $(id: string): HTMLElement {
  const el = document.getElementById(id);
  if (el === null) throw new Error(`#${id} がありません`);
  return el;
}

const startButton = $("start") as HTMLButtonElement;
const abortButton = $("abort") as HTMLButtonElement;
const downloadButton = $("download") as HTMLButtonElement;
const controls = $("controls");
const recorderEl = $("recorder");
const eyes = Array.from(document.querySelectorAll<HTMLElement>(".eye"));

const schedule = buildSchedule(DEFAULT_PROTOCOL_STEPS);
const events = scheduleEvents(schedule);
const cues = new AudioCues();

/** 開始ボタンを押してから時刻 0 までの間（ゴーグルに入れる時間．秒） */
const LEAD_IN_SEC = 10;
/** 準備の終わりに鳴らす 3・2・1 の合図（秒） */
const COUNTDOWN = [3, 2, 1];

let recording: DevRecording | null = null;
let t0 = 0;
let cursor = 0;
let timer: ReturnType<typeof setInterval> | null = null;
let wakeLock: { release(): Promise<void> } | null = null;
/** 鳴らした最後の合図（区間の番号 × 10 + 秒）．同じ合図を 2 回鳴らさない */
let lastCountdownKey = -1;

/** 記録中の印を置く sessionStorage のキー．終わる前に再読み込みされたことを次の読み込みで知らせる */
const RUNNING_KEY = "input.protocol.running";

function markRunning(running: boolean): void {
  try {
    if (running) sessionStorage.setItem(RUNNING_KEY, new Date().toISOString());
    else sessionStorage.removeItem(RUNNING_KEY);
  } catch {
    // プライベートブラウズ等で使えない時は知らせないだけ
  }
}

/** 前の読み込みで記録が途中のまま再読み込みされたか（読んだら印を消す） */
function takeInterrupted(): boolean {
  try {
    const was = sessionStorage.getItem(RUNNING_KEY) !== null;
    sessionStorage.removeItem(RUNNING_KEY);
    return was;
  } catch {
    return false;
  }
}

function setEyes(main: string, sub: string, time: string): void {
  for (const eye of eyes) {
    const [mainEl, subEl, timeEl] = eye.children;
    mainEl.textContent = main;
    subEl.textContent = sub;
    timeEl.textContent = time;
  }
}

function segmentTitle(e: ProtocolEvent): string {
  const s = e.segment;
  if (s === null) return "";
  return s.repeatCount > 1 ? `${s.step.title}（${s.repeat}/${s.repeatCount}）` : s.step.title;
}

/** 節目ごとの音の合図 */
function announce(e: ProtocolEvent): void {
  switch (e.kind) {
    case "prep":
      cues.speak(`次は${segmentTitle(e)}．${e.segment?.step.instruction ?? ""}`);
      break;
    case "start":
      cues.beep(1320, 400);
      break;
    case "cue":
      // 音の高さで向きを伝える（しゃがむは低く，立つは高く）．言葉は音声の遅れがあるため補助
      cues.beep(e.cue?.cue === "stand" ? 1047 : 523, 250);
      if (e.cue !== undefined) cues.speak(e.cue.say);
      break;
    case "end":
      cues.beep(660, 120);
      setTimeout(() => cues.beep(660, 120), 180);
      break;
    case "done":
      cues.speak("おわりです．おつかれさまでした");
      break;
  }
}

function tick(): void {
  if (recording === null) return;
  const now = performance.now();
  const elapsed = now - t0;
  const taken = takeDueEvents(events, cursor, elapsed);
  cursor = taken.cursor;
  for (const e of taken.due) {
    const label = labelRecordFor(e, roundTo(now, 3) ?? now, t0);
    if (label !== null) recording.recorder.record(label);
    const cueRecord = cueRecordFor(e, roundTo(now, 3) ?? now, t0);
    if (cueRecord !== null) recording.recorder.record(cueRecord);
    announce(e);
  }

  const pos = locate(schedule, elapsed);
  const total = schedule.segments.length;
  if (pos.phase === "before") {
    setEyes("ゴーグルに入れてください", "まもなく始まります", `${Math.ceil(-elapsed / 1000)}`);
  } else if (pos.phase === "prep") {
    const sec = Math.ceil(pos.remainingMs / 1000);
    const s = pos.segment;
    const title =
      s.repeatCount > 1 ? `${s.step.title}（${s.repeat}/${s.repeatCount}）` : s.step.title;
    setEyes(`次: ${title}`, s.step.instruction, `準備 ${sec}  [${s.index + 1}/${total}]`);
    const key = s.index * 10 + sec;
    if (COUNTDOWN.includes(sec) && key !== lastCountdownKey) {
      lastCountdownKey = key;
      cues.beep(880, 100);
    }
  } else if (pos.phase === "active") {
    const s = pos.segment;
    const title =
      s.repeatCount > 1 ? `${s.step.title}（${s.repeat}/${s.repeatCount}）` : s.step.title;
    // 合図のある区間では，最後に出した合図の言葉を大きく出す
    const activeMs = s.endMs - s.startMs - pos.remainingMs;
    const lastCue = segmentCues(s)
      .filter((c) => c.atSec * 1000 <= activeMs)
      .at(-1);
    setEyes(
      lastCue === undefined ? title : `${lastCue.say}（${title}）`,
      s.step.instruction,
      `${Math.ceil(pos.remainingMs / 1000)}  [${s.index + 1}/${total}]`,
    );
  } else {
    setEyes("おわり", "ゴーグルから外してください", "");
    finish();
  }
  recorderEl.textContent = describeRecorderStatus(recording.recorder.status(), now);
}

function finish(): void {
  if (timer !== null) clearInterval(timer);
  timer = null;
  markRunning(false);
  void wakeLock?.release().catch(() => undefined);
  wakeLock = null;
  // 記録は止めずに送り続ける（最後の分も送るため．ページを閉じる時にも送る）
  void recording?.recorder.flush();
  controls.hidden = false;
  abortButton.disabled = true;
  downloadButton.disabled = recording === null;
}

startButton.addEventListener("click", () => {
  if (recording !== null) return;
  startButton.disabled = true;
  // 音の許可はタップの中で取る（センサーの許可より先に同期的に呼ぶ）
  cues.unlock();
  // 画面が消えないようにする（対応していない端末では何もしない）
  const wl = (
    navigator as unknown as {
      wakeLock?: { request(type: "screen"): Promise<{ release(): Promise<void> }> };
    }
  ).wakeLock;
  if (wl !== undefined) {
    wl.request("screen").then(
      (lock) => {
        wakeLock = lock;
      },
      () => undefined,
    );
  }
  void startDevRecording("protocol").then((r) => {
    recording = r;
    t0 = performance.now() + LEAD_IN_SEC * 1000;
    r.recorder.record({
      type: "protocol",
      t: roundTo(performance.now(), 3) ?? 0,
      t0: roundTo(t0, 3) ?? t0,
      prepMs: schedule.prepMs,
      segments: schedule.segments.map((s) => ({
        label: s.step.label,
        startMs: s.startMs,
        endMs: s.endMs,
      })),
    });
    controls.hidden = true;
    abortButton.disabled = false;
    markRunning(true);
    cues.speak(`${LEAD_IN_SEC}秒後に始めます．ゴーグルに入れてください`);
    timer = setInterval(tick, 50);
    tick();
  });
});

abortButton.addEventListener("click", () => {
  if (recording === null || timer === null) return;
  recording.recorder.record({
    type: "mark",
    t: roundTo(performance.now(), 3) ?? 0,
    kind: "protocol_aborted",
  });
  cues.cancelSpeech();
  setEyes("中止しました", "", "");
  finish();
});

downloadButton.addEventListener("click", () => {
  if (recording !== null) downloadJsonl(recording.recorder);
});

const totalSec = Math.round(schedule.totalMs / 1000);
const summary = `全 ${schedule.segments.length} 区間・約 ${Math.floor(totalSec / 60)} 分 ${totalSec % 60} 秒`;
// 音声は読み込みの直後には出せない（iPhone はタップが要る）ため，画面にだけ出す
if (takeInterrupted()) {
  setEyes(
    "前の記録は途中で再読み込みされました",
    `最初からやり直してください（npm run dev:record で開くと防げます）．${summary}`,
    "",
  );
} else {
  setEyes("手順の記録", summary, "");
}
