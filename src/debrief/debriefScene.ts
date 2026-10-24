// 結果画面（debrief，HTML）．避難の後にゴーグルを外して見る画面で，校舎の地図に正解経路と自分の経路を重ね，
// 避難時間・煙の中の姿勢・外れた所・火に近づいた回数を示す（docs/04_SPEC/SPEC_01「結果の評価」．F7・F8）．
// 読むのは Session.plan と Session.drill だけ．文・縮尺・重ねるものは純粋な関数（debriefText.ts・mapLayout.ts・mapOverlay.ts）で作る

import type { Scene, SceneContext } from "../core/scene";
import type { SchoolPlan } from "../core/schoolPlan";
import { type DebriefStat, debriefTitle, describeDrill, describeRouteReveal } from "./debriefText";
import { drawDebriefMap } from "./mapCanvas";
import { DEFAULT_MAP_FIT, fitMapCanvas } from "./mapLayout";
import { buildMapOverlay, defaultDebriefFloor } from "./mapOverlay";
import { type LegendItem, MAP_LEGEND } from "./mapStyle";

/** 画面の見た目（ホーム・開始画面と同じ訓練施設の背景と文字の箱．app/ が lobby/ の trainingTheme.ts の値を渡す） */
export interface DebriefTheme {
  /** 背景の CSS の宣言 */
  readonly backgroundCss: string;
  /** 文字の箱の CSS の宣言 */
  readonly boxCss: string;
}

export interface DebriefSceneOptions {
  /** 見た目（無ければ単色の背景） */
  readonly theme?: DebriefTheme;
}

/** 結果画面から同じ訓練（同じ校舎・同じ条件）を繰り返すボタンの文字（ロビーの短い手順の後に同じ避難へ進む） */
export const DEBRIEF_RETRY_LABEL = "同じ訓練をもう一度";

/** ホームへ戻るボタンの文字 */
export const DEBRIEF_HOME_LABEL = "ホームへ";

/** 記録が無い時（避難を終えずに結果画面へ来た時）に出す文 */
export const DEBRIEF_NO_RECORD =
  "避難の記録がありません．「同じ訓練をもう一度」から避難してみましょう";

/** 縦向きの時，地図に使う高さの上限（画面の高さに対する割合．下の評価までスクロールで届くよう残す） */
const PORTRAIT_MAP_HEIGHT_RATIO = 0.6;

const DEFAULT_THEME: DebriefTheme = {
  backgroundCss: "background: #1a2333;",
  boxCss: "background: rgba(14, 20, 31, 0.72); border-radius: 12px;",
};

function styleText(theme: DebriefTheme): string {
  return `
.debrief {
  position: absolute; inset: 0; box-sizing: border-box; pointer-events: auto;
  display: flex; flex-direction: column; gap: 10px; padding: 10px 12px; overflow: hidden;
  ${theme.backgroundCss}
  color: #f2f4f8; font-family: system-ui, -apple-system, "Hiragino Sans", sans-serif; line-height: 1.5;
}
.debrief h1 { font-size: 1.25rem; margin: 0; letter-spacing: 0.04em; }
.debrief__reveal { margin: 2px 0 0; font-size: 0.9rem; color: #c8d0dc; }
.debrief__main { flex: 1 1 auto; min-height: 0; display: flex; gap: 12px; }
.debrief__map {
  flex: 1 1 auto; min-width: 0; min-height: 0; overflow: hidden; box-sizing: border-box; padding: 8px;
  display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 6px;
  ${theme.boxCss}
}
.debrief__map canvas { display: block; border-radius: 6px; }
.debrief__floors { display: flex; gap: 6px; }
.debrief__side { flex: 0 0 min(340px, 42%); min-height: 0; overflow-y: auto; display: flex; flex-direction: column; gap: 8px; }
.debrief__box { box-sizing: border-box; padding: 10px 14px; ${theme.boxCss} }
.debrief__stat-label { font-size: 0.85rem; color: #c8d0dc; }
.debrief__stat-value { font-size: 1.5rem; font-weight: bold; }
.debrief__stat-value.is-good { color: #6fe39a; }
.debrief__stat-value.is-warn { color: #ffb066; }
.debrief__stat-note { font-size: 0.9rem; }
.debrief__legend { list-style: none; margin: 0; padding: 0; display: flex; flex-wrap: wrap; gap: 4px 12px; font-size: 0.85rem; }
.debrief__legend li { display: flex; align-items: center; gap: 6px; }
.debrief__swatch { display: inline-block; flex: none; box-sizing: border-box; }
.debrief__swatch.is-line { width: 22px; height: 5px; border-radius: 3px; }
.debrief__swatch.is-band { width: 22px; height: 11px; border-radius: 6px; }
.debrief__swatch.is-dot { width: 12px; height: 12px; border-radius: 50%; border: 2px solid #fff; }
.debrief__swatch.is-cell { width: 14px; height: 14px; }
.debrief__swatch.is-ring { width: 14px; height: 14px; border-radius: 50%; background: #fff; border: 3px solid; }
.debrief__swatch.is-frame { width: 14px; height: 14px; border: 3px solid; }
.debrief__actions { display: flex; flex-wrap: wrap; gap: 10px; }
.debrief button {
  font-size: 1.15rem; padding: 10px 28px; border: none; border-radius: 8px;
  background: #ff8a3d; color: #10141c; font-weight: bold;
  box-shadow: 0 4px 16px rgba(255, 138, 61, 0.35);
}
.debrief button.secondary { background: #3a4252; color: #f2f4f8; box-shadow: none; }
.debrief button.is-small { font-size: 0.9rem; padding: 4px 14px; }
.debrief button.is-current { background: #f2f4f8; color: #10141c; box-shadow: none; }
.debrief button:disabled { opacity: 0.5; }
@media (orientation: portrait) {
  .debrief { overflow-y: auto; }
  .debrief__main { flex: none; flex-direction: column; }
  .debrief__map { flex: none; }
  .debrief__side { flex: none; overflow: visible; }
}
`;
}

export function createDebriefScene(options: DebriefSceneOptions = {}): Scene {
  const theme = options.theme ?? DEFAULT_THEME;
  let root: HTMLDivElement | null = null;
  let style: HTMLStyleElement | null = null;
  let disposers: (() => void)[] = [];

  return {
    id: "debrief",

    enter(ctx: SceneContext) {
      style = document.createElement("style");
      style.textContent = styleText(theme);
      document.head.appendChild(style);

      root = document.createElement("div");
      root.className = "debrief";
      const plan = ctx.session.plan;
      const drill = ctx.session.drill;

      const header = document.createElement("div");
      const heading = document.createElement("h1");
      heading.textContent = debriefTitle(plan?.name ?? "");
      header.appendChild(heading);
      root.appendChild(header);

      const main = document.createElement("div");
      main.className = "debrief__main";
      const side = document.createElement("div");
      side.className = "debrief__side";

      if (plan === null || drill === null) {
        const box = document.createElement("div");
        box.className = "debrief__box";
        box.textContent = DEBRIEF_NO_RECORD;
        side.appendChild(box);
      } else {
        const reveal = document.createElement("p");
        reveal.className = "debrief__reveal";
        reveal.textContent = describeRouteReveal(plan.drill.mode);
        header.appendChild(reveal);

        const mapPane = document.createElement("div");
        mapPane.className = "debrief__map";
        main.appendChild(mapPane);
        disposers.push(mountMap(mapPane, plan, drill));

        for (const stat of describeDrill(drill.evaluation)) side.appendChild(createStatBox(stat));
        side.appendChild(createLegend(MAP_LEGEND));
      }

      side.appendChild(
        createActions([
          // キャリブレーション（Session.calibration）は消さない．ロビーは前回の値を保ったまま正面だけを取り直す
          { text: DEBRIEF_RETRY_LABEL, secondary: false, onClick: () => ctx.goTo("lobby") },
          { text: DEBRIEF_HOME_LABEL, secondary: true, onClick: () => ctx.goTo("home") },
        ]),
      );
      main.appendChild(side);
      root.appendChild(main);
      ctx.stage.overlay.appendChild(root);
    },

    update() {
      // HTML の画面なので毎フレームの処理は無い（地図は大きさが変わった時だけ描き直す）
    },

    exit() {
      for (const dispose of disposers) dispose();
      disposers = [];
      root?.remove();
      root = null;
      style?.remove();
      style = null;
    },
  };
}

/** 地図の Canvas を置き，画面の大きさが変わるたびに描き直す．片付けの関数を返す */
function mountMap(
  pane: HTMLElement,
  plan: SchoolPlan,
  drill: NonNullable<SceneContext["session"]["drill"]>,
): () => void {
  let floorIndex = defaultDebriefFloor(plan);
  const canvas = document.createElement("canvas");
  canvas.setAttribute("role", "img");
  canvas.setAttribute("aria-label", "校舎の地図と，自分の経路・正解経路");
  pane.appendChild(canvas);

  // 複数の階がある時だけ階の切り替えを出す（段階 1 の校舎は 1 階だけなので出ない）
  const floorButtons: HTMLButtonElement[] = [];
  if (plan.floors.length > 1) {
    const floors = document.createElement("div");
    floors.className = "debrief__floors";
    plan.floors.forEach((floor, index) => {
      const b = document.createElement("button");
      b.type = "button";
      b.className = "secondary is-small";
      b.textContent = `${floor.level}階`;
      b.addEventListener("click", () => {
        floorIndex = index;
        draw();
      });
      floorButtons.push(b);
      floors.appendChild(b);
    });
    pane.appendChild(floors);
  }

  const portrait = window.matchMedia("(orientation: portrait)");
  const draw = (): void => {
    floorButtons.forEach((b, i) => {
      b.classList.toggle("is-current", i === floorIndex);
    });
    const floor = plan.floors[floorIndex];
    if (floor === undefined) return;
    const extra = floorButtons.length > 0 ? 40 : 0;
    const paneStyle = window.getComputedStyle(pane);
    const padX = parseFloat(paneStyle.paddingLeft) + parseFloat(paneStyle.paddingRight);
    const padY = parseFloat(paneStyle.paddingTop) + parseFloat(paneStyle.paddingBottom);
    const maxWidth = pane.clientWidth - padX;
    // 縦向きでは地図の欄の高さが中身で決まるため，画面の高さから上限を決める．横向きでは欄の高さに収める
    const maxHeight = portrait.matches
      ? window.innerHeight * PORTRAIT_MAP_HEIGHT_RATIO
      : pane.clientHeight - padY - extra;
    const fit = fitMapCanvas(floor.width, floor.depth, maxWidth, maxHeight, DEFAULT_MAP_FIT);
    const ratio = Math.min(window.devicePixelRatio || 1, 3);
    canvas.style.width = `${fit.cssWidth}px`;
    canvas.style.height = `${fit.cssHeight}px`;
    canvas.width = Math.round(fit.cssWidth * ratio);
    canvas.height = Math.round(fit.cssHeight * ratio);
    const context = canvas.getContext("2d");
    if (context === null) return;
    context.setTransform(ratio, 0, 0, ratio, 0, 0);
    const overlay = buildMapOverlay(plan, floorIndex, drill.track, drill.evaluation);
    drawDebriefMap(context, floor, overlay, fit.layout, fit.cssWidth, fit.cssHeight);
  };

  // 描き直す前に Canvas を小さくして，前の大きさが欄の大きさの測定に混ざらないようにする
  const redraw = (): void => {
    canvas.style.width = "0px";
    canvas.style.height = "0px";
    draw();
  };
  // 要素が DOM に入って大きさが決まった後に描く
  const frame = window.requestAnimationFrame(redraw);
  window.addEventListener("resize", redraw);
  portrait.addEventListener("change", redraw);
  return () => {
    window.cancelAnimationFrame(frame);
    window.removeEventListener("resize", redraw);
    portrait.removeEventListener("change", redraw);
  };
}

function createStatBox(stat: DebriefStat): HTMLElement {
  const box = document.createElement("div");
  box.className = "debrief__box";
  const label = document.createElement("div");
  label.className = "debrief__stat-label";
  label.textContent = stat.label;
  const value = document.createElement("div");
  value.className = "debrief__stat-value";
  if (stat.tone !== "neutral") value.classList.add(`is-${stat.tone}`);
  value.textContent = stat.value;
  const note = document.createElement("div");
  note.className = "debrief__stat-note";
  note.textContent = stat.note;
  box.append(label, value, note);
  return box;
}

function createLegend(items: readonly LegendItem[]): HTMLElement {
  const box = document.createElement("div");
  box.className = "debrief__box";
  const list = document.createElement("ul");
  list.className = "debrief__legend";
  for (const item of items) {
    const li = document.createElement("li");
    const swatch = document.createElement("span");
    swatch.className = `debrief__swatch is-${item.shape}`;
    if (item.shape === "ring" || item.shape === "frame") swatch.style.borderColor = item.color;
    else swatch.style.background = item.color;
    const text = document.createElement("span");
    text.textContent = item.label;
    li.append(swatch, text);
    list.appendChild(li);
  }
  box.appendChild(list);
  return box;
}

interface ActionSpec {
  readonly text: string;
  readonly secondary: boolean;
  readonly onClick: () => void;
}

/** ボタンを並べる．どれかを押したら全部を押せなくする（二度押しで画面の切り替えを重ねないため） */
function createActions(specs: readonly ActionSpec[]): HTMLElement {
  const actions = document.createElement("div");
  actions.className = "debrief__actions";
  const buttons = specs.map((spec) => {
    const b = document.createElement("button");
    b.type = "button";
    b.textContent = spec.text;
    if (spec.secondary) b.className = "secondary";
    b.addEventListener("click", () => {
      for (const other of buttons) other.disabled = true;
      spec.onClick();
    });
    return b;
  });
  actions.append(...buttons);
  return actions;
}
