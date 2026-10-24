// 道具箱の「延焼の速さ」「延焼のプレビュー」の薄い殻（E4）．秒数の入力は呼び出し側が editorState.ts の純粋な関数に渡し，
// プレビューは時刻のスライダーと再生だけを持つ（校舎は変えない．火・煙を描くのは editorCanvas.ts）
import type { SchoolPlan } from "../core/schoolPlan";
import { isValidSeconds, type SpreadSecondsKey } from "./editorState";
import { previewMaxSeconds, type SpreadCount, spreadWarnings } from "./spreadPreview";

/** 再生の速さ（倍．制限時間 150 秒を 15 秒で見終える） */
const PLAY_SPEED = 10;

/** 制限時間が誤った校舎で使うスライダーの上限（s．SPEC_02 の既定値） */
const FALLBACK_MAX_SECONDS = 150;

/** 秒数として受け付けない値を入れた時の案内 */
const INVALID_SECONDS = "0 より大きい秒数を入れてください";

/** 入力の受け渡し先 */
export interface SpreadPanelOptions {
  /** 火・煙が隣のマスへ移る秒数（s）が入力された（受け付ける値だけを渡す） */
  readonly onSpreadSeconds: (key: SpreadSecondsKey, seconds: number) => void;
  /** 制限時間（s）が入力された（受け付ける値だけを渡す） */
  readonly onTimeLimit: (seconds: number) => void;
  /** プレビューの表示・時刻が変わった（図を描き直す） */
  readonly onPreviewChange: () => void;
  /** 受け付けない値を入れた時等の案内を画面に出す */
  readonly notify: (message: string) => void;
}

/** 延焼の速さとプレビューの道具箱 */
export interface SpreadPanel {
  /** 道具箱に置く要素 */
  readonly element: HTMLElement;
  /** 校舎に合わせて入力欄・注意・スライダーの上限を直す．count はプレビュー中の火・煙のマスの数（閉じていれば null） */
  sync(plan: SchoolPlan, count: SpreadCount | null): void;
  /** プレビューの時刻（s．非常ベルが 0）．プレビューを閉じていれば null */
  previewSeconds(): number | null;
}

/** 道具箱を作る（プレビューは閉じた状態で始まる） */
export function createSpreadPanel(options: SpreadPanelOptions): SpreadPanel {
  const element = document.createElement("div");
  let plan: SchoolPlan | null = null;
  let open = false;
  let seconds = 0;
  let playFrame: number | null = null;
  let lastFrameMs = 0;

  element.append(heading("延焼の速さ"));
  const fireInput = secondsInput("火が隣のマスへ移る秒数", "0.5");
  const smokeInput = secondsInput("煙が隣のマスへ移る秒数", "0.5");
  const limitInput = secondsInput("制限時間（秒）", "1");
  element.append(
    labeledRow("火", fireInput, "秒／マス"),
    labeledRow("煙", smokeInput, "秒／マス"),
    labeledRow("制限時間", limitInput, "秒"),
  );
  const warningBox = document.createElement("p");
  warningBox.className = "editor__hint editor__warning";
  const speedHint = hint(
    "秒数が小さいほど速く広がる．火元から「マスの数 × 秒数」で着く．防火シャッターで止まり，屋外へは広がらない",
  );
  element.append(warningBox, speedHint);

  const bindSeconds = (input: HTMLInputElement, apply: (value: number) => void): void => {
    // 確定（Enter・フォーカスを外す）した時だけ変える（1 文字ごとに「元に戻す」が積まれないように）
    input.addEventListener("change", () => {
      const value = input.valueAsNumber;
      if (isValidSeconds(value)) apply(value);
      else options.notify(INVALID_SECONDS);
      // 受け付けなかった値・丸められた値を，今の校舎の値に戻す
      writeInputs(true);
    });
    input.addEventListener("keydown", (e) => {
      if (e.key === "Enter") input.blur();
    });
  };
  bindSeconds(fireInput, (v) => options.onSpreadSeconds("fireSecondsPerCell", v));
  bindSeconds(smokeInput, (v) => options.onSpreadSeconds("smokeSecondsPerCell", v));
  bindSeconds(limitInput, (v) => options.onTimeLimit(v));

  element.append(heading("延焼のプレビュー"));
  const toggleButton = button("プレビューを出す");
  toggleButton.setAttribute("aria-pressed", "false");
  const playButton = button("再生");
  const toggleRow = row();
  toggleRow.append(toggleButton, playButton);
  const slider = document.createElement("input");
  slider.type = "range";
  slider.min = "0";
  slider.step = "any";
  slider.setAttribute("aria-label", "非常ベルからの時刻（秒）");
  const sliderRow = row();
  sliderRow.appendChild(slider);
  const timeLabel = document.createElement("p");
  timeLabel.className = "editor__hint editor__spread-time";
  const previewHint = hint(
    "非常ベルからの時刻で，火（赤）と煙（灰色）が着いているマスを重ねる．表示だけで校舎は変えない．出したまま編集もできる",
  );
  element.append(toggleRow, sliderRow, timeLabel, previewHint);

  toggleButton.addEventListener("click", () => {
    open = !open;
    if (!open) stopPlay();
    options.onPreviewChange();
  });
  slider.addEventListener("input", () => {
    stopPlay();
    seconds = slider.valueAsNumber;
    options.onPreviewChange();
  });
  playButton.addEventListener("click", () => {
    if (playFrame !== null) {
      stopPlay();
      options.onPreviewChange();
      return;
    }
    open = true;
    // 終わりまで進んでいたら最初から見せる
    if (seconds >= maxSeconds()) seconds = 0;
    lastFrameMs = performance.now();
    playFrame = requestAnimationFrame(step);
    options.onPreviewChange();
  });

  // requestAnimationFrame の時刻はフレームの始まりで，押した時の performance.now() より前のことがあるため，戻る分は 0 にする
  function step(nowMs: number): void {
    seconds = Math.min(
      maxSeconds(),
      seconds + (Math.max(0, nowMs - lastFrameMs) / 1000) * PLAY_SPEED,
    );
    lastFrameMs = nowMs;
    if (seconds >= maxSeconds()) playFrame = null;
    else playFrame = requestAnimationFrame(step);
    options.onPreviewChange();
  }

  function stopPlay(): void {
    if (playFrame !== null) cancelAnimationFrame(playFrame);
    playFrame = null;
  }

  function maxSeconds(): number {
    return plan === null
      ? FALLBACK_MAX_SECONDS
      : previewMaxSeconds(plan.drill, FALLBACK_MAX_SECONDS);
  }

  /** 入力欄に今の校舎の値を書く．force でなければ入力中の欄は書き換えない */
  function writeInputs(force: boolean): void {
    if (plan === null) return;
    const { spread, timeLimitSeconds } = plan.drill;
    const write = (input: HTMLInputElement, value: number): void => {
      if (force || document.activeElement !== input) input.value = String(value);
    };
    write(fireInput, spread.fireSecondsPerCell);
    write(smokeInput, spread.smokeSecondsPerCell);
    write(limitInput, timeLimitSeconds);
  }

  function sync(next: SchoolPlan, count: SpreadCount | null): void {
    plan = next;
    writeInputs(false);
    const warnings = spreadWarnings(next.drill);
    warningBox.hidden = warnings.length === 0;
    warningBox.textContent = warnings.join("\n");

    // 制限時間を縮めて今の時刻が範囲の外に出た時は，上限にそろえる
    const max = maxSeconds();
    seconds = Math.min(seconds, max);
    slider.max = String(max);
    slider.value = String(seconds);
    toggleButton.textContent = open ? "プレビューを閉じる" : "プレビューを出す";
    toggleButton.setAttribute("aria-pressed", String(open));
    playButton.textContent = playFrame !== null ? "一時停止" : "再生";
    sliderRow.hidden = !open;
    timeLabel.hidden = !open;
    const countText = count === null ? "" : `　火 ${count.fire} マス・煙 ${count.smoke} マス`;
    timeLabel.textContent = `${Math.floor(seconds)} 秒 / ${max} 秒${countText}`;
  }

  return { element, sync, previewSeconds: () => (open ? seconds : null) };
}

function heading(text: string): HTMLHeadingElement {
  const h = document.createElement("h2");
  h.textContent = text;
  return h;
}

function hint(text: string): HTMLParagraphElement {
  const p = document.createElement("p");
  p.className = "editor__hint";
  p.textContent = text;
  return p;
}

function row(): HTMLDivElement {
  const r = document.createElement("div");
  r.className = "editor__row";
  return r;
}

function button(text: string): HTMLButtonElement {
  const b = document.createElement("button");
  b.type = "button";
  b.className = "editor__button";
  b.textContent = text;
  return b;
}

function secondsInput(ariaLabel: string, step: string): HTMLInputElement {
  const input = document.createElement("input");
  input.type = "number";
  input.min = step;
  input.step = step;
  input.setAttribute("aria-label", ariaLabel);
  return input;
}

/** 「名前 [入力欄] 単位」の 1 行 */
function labeledRow(name: string, input: HTMLInputElement, unit: string): HTMLDivElement {
  const r = row();
  const l = document.createElement("label");
  l.className = "editor__spread-field";
  const nameSpan = document.createElement("span");
  nameSpan.textContent = name;
  l.append(nameSpan, input, unit);
  r.appendChild(l);
  return r;
}
