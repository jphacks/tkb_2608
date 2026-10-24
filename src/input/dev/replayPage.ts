// 再生と調整のページ（src/input/dev/replay.html．PC 用）．記録を読み込み，今のコードの判定に流し直す．
// スライダーでしきい値を変えるとすぐ判定し直し，基準のしきい値（前）と並べて図と指標で比べる．
// 決めた値は params の JSON として書き出す．表示の範囲を回帰テスト用に切り出せる（experiment_山﨑/10「再生と調整のページ」）
import { DEFAULT_INPUT_PARAMS, type InputParams, mergeParams, paramsFromSearch } from "../params";
import { INPUT_LOG_ENDPOINT, INPUT_LOG_ROUTES } from "../recorder/logProtocol";
import { type InputRecord, toJsonl } from "../recorder/records";
import { compareMetricRow, computeMetrics, metricRows } from "../replay/metrics";
import { clipRecords } from "../replay/regression";
import { type RejudgeResult, rejudgeRecords } from "../replay/rejudge";
import {
  type LabelSegment,
  labelSegments,
  marksOf,
  metaOf,
  motionTimeRange,
  parseRecordsJsonl,
  parseReplaySearch,
  recordedParamsOf,
} from "../replay/replayLog";
import { clipFileName, paramsDiff, paramsExportJson, paramsSearchOf } from "../replay/tuning";
import { rememberDevPage } from "./devPages";
import { buildParamSliders } from "./paramSliders";
import { drawTimeline } from "./timelineChart";

rememberDevPage("replay.html");

function $<T extends HTMLElement = HTMLElement>(id: string): T {
  const el = document.getElementById(id);
  if (el === null) throw new Error(`#${id} がありません`);
  return el as T;
}

const logsSelect = $<HTMLSelectElement>("logs");
const infoEl = $("info");
const canvas = $<HTMLCanvasElement>("timeline");
const viewStart = $<HTMLInputElement>("viewStart");
const viewLength = $<HTMLInputElement>("viewLength");
const clipButton = $<HTMLButtonElement>("clip");
const metricsEl = $<HTMLTableElement>("metrics");
const segmentsEl = $("segments");
const baselineSelect = $<HTMLSelectElement>("baseline");
const exportText = $<HTMLTextAreaElement>("exportText");

interface Loaded {
  readonly name: string;
  readonly records: readonly InputRecord[];
  readonly segments: readonly LabelSegment[];
  readonly marks: ReturnType<typeof marksOf>;
  readonly startT: number;
  readonly endT: number;
  readonly recordedParams: InputParams;
}

let loaded: Loaded | null = null;
let current: InputParams = mergeParams(DEFAULT_INPUT_PARAMS, paramsFromSearch(location.search));
let before: RejudgeResult | null = null;
let after: RejudgeResult | null = null;
let pending = false;

function baseParams(): InputParams {
  return baselineSelect.value === "recorded" && loaded !== null
    ? loaded.recordedParams
    : DEFAULT_INPUT_PARAMS;
}

const syncSliders = buildParamSliders($("sliders"), current, (key, value) => {
  current = { ...current, [key]: value };
  after = null;
  schedule();
});

/** 次の描画で判定し直す（スライダーを動かす間に何度も判定し直さない） */
function schedule(): void {
  if (pending) return;
  pending = true;
  requestAnimationFrame(() => {
    pending = false;
    update();
  });
}

function viewRange(): { fromT: number; toT: number } {
  if (loaded === null) return { fromT: 0, toT: 1 };
  const fromT = loaded.startT + Number(viewStart.value) * 1000;
  return { fromT, toT: Math.min(loaded.endT, fromT + Number(viewLength.value) * 1000) };
}

function fmt(v: number | null): string {
  return v === null || !Number.isFinite(v) ? "-" : Number.isInteger(v) ? String(v) : v.toFixed(0);
}

function renderMetrics(l: Loaded, b: RejudgeResult, a: RejudgeResult): void {
  const mb = computeMetrics(b, l.segments, l.marks);
  const ma = computeMetrics(a, l.segments, l.marks);
  metricsEl.replaceChildren();
  const head = metricsEl.insertRow();
  for (const text of ["指標", "前", "後"]) {
    const th = document.createElement("th");
    th.textContent = text;
    head.append(th);
  }
  for (const r of metricRows(mb, ma)) {
    const tr = metricsEl.insertRow();
    tr.insertCell().textContent = r.name;
    tr.insertCell().textContent = fmt(r.before);
    const cell = tr.insertCell();
    cell.textContent = fmt(r.after);
    const c = compareMetricRow(r);
    if (c !== 0) cell.className = c > 0 ? "better" : "worse";
  }
  const marks = Object.entries(ma.marks)
    .map(([k, n]) => `${k} ${n}`)
    .join("  ");
  segmentsEl.textContent = [
    ...ma.segments.map((s, i) => {
      const p = mb.segments[i];
      const sec = ((s.segment.startT - l.startT) / 1000).toFixed(1);
      const lat = (v: number | null) => (v === null ? "-" : `${Math.round(v)}ms`);
      return `${sec.padStart(6)}s ${`${s.segment.label}#${s.segment.repeat}`.padEnd(18)} 歩 ${p.steps}→${s.steps}  歩き始め ${p.walkOnsets}→${s.walkOnsets}  遅れ ${lat(p.walkLatencyMs)}→${lat(s.walkLatencyMs)}  姿勢の切替 ${p.postureChanges}→${s.postureChanges}`;
    }),
    `印: ${marks === "" ? "なし" : marks}`,
  ].join("\n");
}

function update(): void {
  const base = baseParams();
  exportText.value = `${paramsExportJson(base, current)}\n\nURL パラメータ: ${paramsSearchOf(paramsDiff(base, current)) || "（変更なし）"}`;
  if (loaded === null) return;
  before ??= rejudgeRecords(loaded.records, base);
  after ??= rejudgeRecords(loaded.records, current);
  const { fromT, toT } = viewRange();
  $("viewStartOut").textContent = viewStart.value;
  $("viewLengthOut").textContent = viewLength.value;
  drawTimeline(
    canvas,
    { before, after, segments: loaded.segments, marks: loaded.marks },
    fromT,
    toT,
  );
  renderMetrics(loaded, before, after);
}

function load(name: string, text: string): void {
  const parsed = parseRecordsJsonl(text);
  const range = motionTimeRange(parsed.records);
  if (range === null) {
    infoEl.textContent = `${name}: motion の記録がありません（読めなかった行 ${parsed.skipped}）`;
    return;
  }
  const meta = metaOf(parsed.records);
  const recorded = recordedParamsOf(parsed.records);
  loaded = {
    name,
    records: parsed.records,
    segments: labelSegments(parsed.records),
    marks: marksOf(parsed.records),
    startT: range.startT,
    endT: range.endT,
    recordedParams: mergeParams(DEFAULT_INPUT_PARAMS, recorded),
  };
  const durationSec = (range.endT - range.startT) / 1000;
  viewStart.max = String(Math.max(0, durationSec - 1));
  viewStart.value = "0";
  viewLength.max = String(Math.max(1, Math.ceil(durationSec)));
  viewLength.value = String(Math.min(30, Math.max(1, Math.ceil(durationSec))));
  clipButton.disabled = false;
  infoEl.textContent = [
    `${name}  ${durationSec.toFixed(1)} 秒  レコード ${parsed.records.length}（読めなかった行 ${parsed.skipped}）`,
    `ページ ${meta?.page ?? "-"}  開始 ${meta?.startedAt ?? "-"}  端末 ${meta?.userAgent ?? "-"}`,
    `ラベルの区間 ${loaded.segments.length}  印 ${loaded.marks.length}  記録した時のしきい値 ${recorded === null ? "なし（既定値を使う）" : "あり"}`,
  ].join("\n");
  before = null;
  after = null;
  schedule();
}

async function fetchText(url: string): Promise<string> {
  const res = await fetch(url, { cache: "no-store" });
  if (!res.ok) throw new Error(`${res.status}`);
  return res.text();
}

function loadFromServer(name: string): void {
  infoEl.textContent = `${name} を読み込み中…`;
  fetchText(`${INPUT_LOG_ENDPOINT}${INPUT_LOG_ROUTES.file}?name=${encodeURIComponent(name)}`).then(
    (text) => load(name, text),
    (err: unknown) => {
      infoEl.textContent = `${name} を読めません（${String(err)}）`;
    },
  );
}

$("load").addEventListener("click", () => {
  if (logsSelect.value !== "") loadFromServer(logsSelect.value);
});
$<HTMLInputElement>("file").addEventListener("change", (e) => {
  const file = (e.target as HTMLInputElement).files?.[0];
  if (file === undefined) return;
  void file.text().then((text) => load(file.name, text));
});
baselineSelect.addEventListener("change", () => {
  before = null;
  schedule();
});
$("toBaseline").addEventListener("click", () => {
  current = baseParams();
  syncSliders(current);
  after = null;
  schedule();
});
viewStart.addEventListener("input", schedule);
viewLength.addEventListener("input", schedule);
window.addEventListener("resize", schedule);

function download(name: string, text: string, type: string): void {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

clipButton.addEventListener("click", () => {
  if (loaded === null) return;
  const { fromT, toT } = viewRange();
  download(
    clipFileName(loaded.name, fromT, toT),
    toJsonl(clipRecords(loaded.records, fromT, toT)),
    "application/x-ndjson",
  );
});
$("export").addEventListener("click", () => {
  download("input-params.json", paramsExportJson(baseParams(), current), "application/json");
});

// 開発サーバーの記録の一覧（つながらなければファイルの選択だけで使う）
void fetch(`${INPUT_LOG_ENDPOINT}${INPUT_LOG_ROUTES.list}`, { cache: "no-store" })
  .then((res) => res.json() as Promise<unknown>)
  .then(
    (list) => {
      if (!Array.isArray(list)) return;
      for (const name of list) {
        if (typeof name !== "string") continue;
        const opt = document.createElement("option");
        opt.value = name;
        opt.textContent = name;
        logsSelect.append(opt);
      }
      const wanted = parseReplaySearch(location.search).log;
      if (wanted !== null) {
        logsSelect.value = wanted;
        loadFromServer(wanted);
      }
    },
    () => undefined,
  );

update();
