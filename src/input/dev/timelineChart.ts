// 再生と調整のページの時間軸の図（canvas）．波形・Δh・判定（変える前と後）・手順のラベル・印を同じ時間軸に重ねて描く
import type { MarkRecord } from "../recorder/records";
import type { RejudgeResult, TimeSpan } from "../replay/rejudge";
import type { LabelSegment } from "../replay/replayLog";

export interface TimelineData {
  /** 変える前（基準のしきい値）と後（スライダーの値）の判定 */
  readonly before: RejudgeResult;
  readonly after: RejudgeResult;
  readonly segments: readonly LabelSegment[];
  readonly marks: readonly MarkRecord[];
}

const WAVE_RANGE = 4; // m/s^2
const H_RANGE = 0.6; // m
const LABEL_COLORS = ["#26324a", "#2f2640", "#24392f", "#3a3324"];

/** canvas の大きさを表示の大きさに合わせ，2D の描画の口を返す */
function prepare(
  canvas: HTMLCanvasElement,
): { ctx: CanvasRenderingContext2D; w: number; h: number; dpr: number } | null {
  const ctx = canvas.getContext("2d");
  if (ctx === null) return null;
  const dpr = window.devicePixelRatio || 1;
  const w = Math.max(1, Math.round(canvas.clientWidth * dpr));
  const h = Math.max(1, Math.round(canvas.clientHeight * dpr));
  if (canvas.width !== w || canvas.height !== h) {
    canvas.width = w;
    canvas.height = h;
  }
  return { ctx, w, h, dpr };
}

/** 時間軸の図を描く（fromT〜toT ms を横幅いっぱいに） */
export function drawTimeline(
  canvas: HTMLCanvasElement,
  data: TimelineData,
  fromT: number,
  toT: number,
): void {
  const p = prepare(canvas);
  if (p === null || !(toT > fromT)) return;
  const { ctx, w, h, dpr } = p;
  const x = (t: number) => ((t - fromT) / (toT - fromT)) * w;
  const top = 18 * dpr;
  const waveH = (h - top) * 0.42;
  const hH = (h - top) * 0.2;
  const stateTop = top + waveH + hH;
  const rowH = (h - stateTop) / 4;

  ctx.fillStyle = "#111";
  ctx.fillRect(0, 0, w, h);
  ctx.font = `${11 * dpr}px sans-serif`;

  // 手順のラベル（背景の帯と名前）
  data.segments.forEach((s, i) => {
    if (s.endT < fromT || s.startT > toT) return;
    const x0 = Math.max(0, x(s.startT));
    const x1 = Math.min(w, x(s.endT));
    ctx.fillStyle = LABEL_COLORS[i % LABEL_COLORS.length];
    ctx.fillRect(x0, top, x1 - x0, h - top);
    ctx.fillStyle = "#cde";
    ctx.fillText(`${s.label}#${s.repeat}`, x0 + 2 * dpr, 12 * dpr);
  });

  // 軸の線
  ctx.strokeStyle = "#444";
  ctx.lineWidth = 1;
  for (const y of [top + waveH / 2, top + waveH + hH / 2, top + waveH, stateTop]) {
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(w, y);
    ctx.stroke();
  }

  const tl = data.after.timeline;
  const tb = data.before.timeline;
  const line = (
    t: readonly number[],
    v: readonly number[],
    color: string,
    centerY: number,
    halfH: number,
    range: number,
    dash: number[] = [],
  ) => {
    ctx.strokeStyle = color;
    ctx.lineWidth = 1.2 * dpr;
    ctx.setLineDash(dash.map((d) => d * dpr));
    ctx.beginPath();
    let drawing = false;
    for (let i = 0; i < t.length; i++) {
      if (t[i] < fromT) continue;
      if (t[i] > toT) break;
      const val = v[i];
      if (!Number.isFinite(val)) {
        drawing = false;
        continue;
      }
      const y = centerY - (Math.max(-range, Math.min(range, val)) / range) * halfH;
      if (drawing) ctx.lineTo(x(t[i]), y);
      else ctx.moveTo(x(t[i]), y);
      drawing = true;
    }
    ctx.stroke();
    ctx.setLineDash([]);
  };

  const waveC = top + waveH / 2;
  line(tl.t, tl.av, "#4fc3f7", waveC, waveH / 2, WAVE_RANGE);
  line(tl.t, tl.bp, "#fff176", waveC, waveH / 2, WAVE_RANGE);
  line(tb.t, tb.high, "#ef9a9a", waveC, waveH / 2, WAVE_RANGE, [4, 3]);
  line(tl.t, tl.high, "#ef5350", waveC, waveH / 2, WAVE_RANGE);
  line(tl.t, tl.low, "#ab47bc", waveC, waveH / 2, WAVE_RANGE);
  const hC = top + waveH + hH / 2;
  line(tb.t, tb.h, "#90a4ae", hC, hH / 2, H_RANGE, [4, 3]);
  line(tl.t, tl.h, "#4dd0e1", hC, hH / 2, H_RANGE);

  // 判定の帯（前・後 × 歩く・しゃがむ）と歩の印
  const rows: {
    name: string;
    spans: readonly TimeSpan[];
    color: string;
    steps?: readonly number[];
  }[] = [
    {
      name: "前: 歩く",
      spans: data.before.walkingSpans,
      color: "#4b7d4e",
      steps: data.before.steps,
    },
    { name: "前: しゃがむ", spans: data.before.crouchSpans, color: "#3d5f8a" },
    { name: "後: 歩く", spans: data.after.walkingSpans, color: "#81c784", steps: data.after.steps },
    { name: "後: しゃがむ", spans: data.after.crouchSpans, color: "#64b5f6" },
  ];
  rows.forEach((row, i) => {
    const y = stateTop + i * rowH;
    ctx.fillStyle = row.color;
    for (const s of row.spans) {
      if (s.endT < fromT || s.startT > toT) continue;
      const x0 = Math.max(0, x(s.startT));
      ctx.fillRect(x0, y + 3 * dpr, Math.max(1, Math.min(w, x(s.endT)) - x0), rowH - 6 * dpr);
    }
    if (row.steps !== undefined) {
      ctx.fillStyle = "#fff";
      for (const st of row.steps) {
        if (st < fromT || st > toT) continue;
        ctx.fillRect(x(st), y, Math.max(1, dpr), rowH);
      }
    }
    ctx.fillStyle = "#ddd";
    ctx.fillText(row.name, 4 * dpr, y + rowH / 2 + 4 * dpr);
  });

  // 印（縦の線と種類）
  ctx.strokeStyle = "#ff5252";
  ctx.fillStyle = "#ff8a80";
  ctx.lineWidth = 2 * dpr;
  for (const m of data.marks) {
    if (m.t < fromT || m.t > toT) continue;
    ctx.beginPath();
    ctx.moveTo(x(m.t), top);
    ctx.lineTo(x(m.t), h);
    ctx.stroke();
    ctx.fillText(m.kind, x(m.t) + 3 * dpr, top + 12 * dpr);
  }

  // 凡例と目盛り
  ctx.fillStyle = "#aaa";
  ctx.fillText(
    `上下の加速度（青）・帯域通過後（黄）・T_high 後（赤）/ 前（点線）・T_low（紫）±${WAVE_RANGE} m/s²`,
    4 * dpr,
    top + 12 * dpr,
  );
  ctx.fillText(`Δh 後（水色）/ 前（点線）±${H_RANGE} m`, 4 * dpr, top + waveH + 12 * dpr);
  ctx.fillText(`${((toT - fromT) / 1000).toFixed(1)} 秒`, w - 60 * dpr, h - 4 * dpr);
}
