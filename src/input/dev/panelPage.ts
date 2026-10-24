// 操作盤のページ（src/input/dev/panel.html．PC 用）．キーを押すとその時刻に誤判定の印を付け，開発サーバー経由で
// スマホの記録に書き込む．時刻は PC とスマホがそれぞれ開発サーバーと合わせた結果で換算する（experiment_山﨑/10「印の付け方」）
import { type ClockEstimate, toServerTime } from "../recorder/clockSync";
import { measureServerClock } from "../recorder/flightRecorder";
import { INPUT_LOG_ENDPOINT, INPUT_LOG_ROUTES } from "../recorder/logProtocol";
import type { MarkRecord } from "../recorder/records";
import { rememberDevPage } from "./devPages";
import { MARK_KINDS, markKindForCode } from "./panelKeys";
import type { SessionInfo } from "./sessionInfo";

rememberDevPage("panel.html");

function $<T extends HTMLElement = HTMLElement>(id: string): T {
  const el = document.getElementById(id);
  if (el === null) throw new Error(`#${id} がありません`);
  return el as T;
}

const sessionsSelect = $<HTMLSelectElement>("sessions");
const sessionInfoEl = $("sessionInfo");
const stateEl = $("state");
const flashEl = $("flash");
const logEl = $("log");
const clockEl = $("clock");

$("keys").textContent = MARK_KINDS.map(
  (k) => `${k.keyLabel.padEnd(6)} ${k.title}（${k.kind}）`,
).join("\n");

let clock: ClockEstimate | null = null;
let sessions: SessionInfo[] = [];
const logLines: string[] = [];

function syncClock(): void {
  clockEl.textContent = "合わせています…";
  void measureServerClock().then((e) => {
    clock = e;
    clockEl.textContent =
      e === null
        ? "開発サーバーにつながりません（印は受け取った時刻で付く）"
        : `往復 ${e.rtt.toFixed(1)} ms で合わせた`;
  });
}

function selected(): SessionInfo | null {
  return sessions.find((s) => s.sessionId === sessionsSelect.value) ?? null;
}

function renderSession(): void {
  const s = selected();
  if (s === null) {
    sessionInfoEl.textContent = "記録している端末がありません（スマホで dev ページの記録を始める）";
    stateEl.textContent = "-";
    return;
  }
  const ago = ((Date.now() - s.lastSeen) / 1000).toFixed(1);
  sessionInfoEl.textContent = [
    `ファイル logs/input/${s.file}  ページ ${s.page ?? "-"}  最後に受け取った ${ago} 秒前`,
    s.clock === null
      ? "時刻合わせ: まだ（端末の壁時計で換算する．ずれることがある）"
      : `時刻合わせ: 済み（往復 ${s.clock.rtt.toFixed(1)} ms）`,
  ].join("\n");
  const st = s.lastState;
  stateEl.textContent =
    st === null ? "-" : `${st.posture} / ${st.loco} / walking ${st.walking}（${st.event}）`;
}

async function pollSessions(): Promise<void> {
  try {
    const res = await fetch(`${INPUT_LOG_ENDPOINT}${INPUT_LOG_ROUTES.sessions}`, {
      cache: "no-store",
    });
    const list: unknown = await res.json();
    if (!Array.isArray(list)) return;
    sessions = list as SessionInfo[];
  } catch {
    return;
  }
  const keep = sessionsSelect.value;
  sessionsSelect.replaceChildren(
    ...sessions.map((s) => {
      const opt = document.createElement("option");
      opt.value = s.sessionId;
      opt.textContent = `${s.sessionId}（${s.page ?? "-"}）`;
      return opt;
    }),
  );
  // 選んでいた端末が残っていればそのまま，無ければ最も新しい端末
  if (sessions.some((s) => s.sessionId === keep)) sessionsSelect.value = keep;
  renderSession();
}

async function sendMark(kind: string, title: string, pressedAt: number): Promise<void> {
  const s = selected();
  if (s === null) {
    flashEl.textContent = "記録している端末がありません";
    return;
  }
  const body = {
    session: s.sessionId,
    kind,
    ...(clock === null ? {} : { serverTime: toServerTime(pressedAt, clock) }),
  };
  flashEl.textContent = title;
  let line: string;
  try {
    const res = await fetch(`${INPUT_LOG_ENDPOINT}${INPUT_LOG_ROUTES.mark}`, {
      method: "POST",
      headers: { "Content-Type": "text/plain;charset=UTF-8" },
      body: JSON.stringify(body),
    });
    if (res.ok) {
      const r = (await res.json()) as MarkRecord;
      line = `${new Date().toLocaleTimeString()}  ${kind}  端末の時刻 ${(r.t / 1000).toFixed(2)} s（${r.clock}）`;
    } else {
      line = `${new Date().toLocaleTimeString()}  ${kind}  失敗: ${res.status} ${await res.text()}`;
    }
  } catch (err) {
    line = `${new Date().toLocaleTimeString()}  ${kind}  失敗: ${String(err)}`;
  }
  logLines.unshift(line);
  logLines.length = Math.min(logLines.length, 30);
  logEl.textContent = logLines.join("\n");
}

window.addEventListener("keydown", (e) => {
  if (e.repeat) return;
  const spec = markKindForCode(e.code);
  if (spec === null) return;
  // Space でページが流れたり，選択中のボタンが押されたりしないようにする
  e.preventDefault();
  void sendMark(spec.kind, spec.title, e.timeStamp);
});
sessionsSelect.addEventListener("change", renderSession);
$("resync").addEventListener("click", syncClock);

syncClock();
void pollSessions();
setInterval(() => void pollSessions(), 1000);
