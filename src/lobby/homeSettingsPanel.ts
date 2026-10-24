// ホームの「設定」の表示（HTML）．音量・画面の明るさ・画面の消灯を，ゴーグルに入れる前にタップで確かめる．
// アプリの中の音量や画面の明るさは変えない（Web からは本体の音量・明るさを読めず変えられないため，案内だけにする）

import { BRIGHTNESS_GUIDE, describeWakeLockStatus, type WakeLockStatus } from "./homeSettings";
import { narrate, stopNarration } from "./narrator";
import { DEFAULT_VOLUME_CUES, VOLUME_CHECK_NARRATION } from "./volumeCheck";
import { createVolumeCheckSound } from "./volumeCheckSound";
import type { ScreenWakeLock } from "./wakeLock";

export interface HomeSettingsPanelOptions {
  /** 効果音の例を鳴らす AudioContext（開始画面で再開済みのもの．無ければ null で，読み上げだけ流す） */
  readonly audioContext: () => AudioContext | null;
  /** 画面の消灯を止める処理（無ければ「この端末では使えません」と出す） */
  readonly wakeLock: ScreenWakeLock | null;
  /** 「戻る」を押した時 */
  readonly onBack: () => void;
}

export interface HomeSettingsPanel {
  readonly element: HTMLElement;
  /** 隠す時に呼ぶ（鳴っている音を止める） */
  hide(): void;
  dispose(): void;
}

/** 設定の表示に使う CSS（homeScene.ts の STYLE に足す） */
export const HOME_SETTINGS_STYLE = `
.lobby-home__settings h2 { font-size: 1.15rem; margin: 18px 0 6px; }
.lobby-home__settings h2:first-of-type { margin-top: 0; }
.lobby-home__settings p { margin: 0 0 8px; }
.lobby-home__settings .lobby-home__note { color: #c9d3e2; font-size: 0.95rem; }
.lobby-home__swatches { display: flex; gap: 6px; margin: 8px 0; }
.lobby-home__swatches span {
  flex: 1; height: 44px; border-radius: 6px; border: 1px solid rgba(190, 210, 235, 0.25);
  display: flex; align-items: flex-end; justify-content: center; font-size: 0.75rem; padding-bottom: 2px;
}
.lobby-home__wakelock { font-weight: bold; color: #ffd27a; }
`;

/** 明るさの見本（背景色・文字色・名前）．暗い 2 色が見分けられるかを目安にする */
const SWATCHES: readonly (readonly [string, string, string])[] = [
  ["#ffffff", "#10141c", "白"],
  ["#808080", "#10141c", "灰"],
  ["#303030", "#c9d3e2", "暗い灰"],
  ["#141414", "#c9d3e2", "ほぼ黒"],
];

export function createHomeSettingsPanel(options: HomeSettingsPanelOptions): HomeSettingsPanel {
  const sound = createVolumeCheckSound(options.audioContext);
  const root = document.createElement("div");
  root.className = "lobby-home__settings";

  const heading = (text: string): HTMLHeadingElement => {
    const h = document.createElement("h2");
    h.textContent = text;
    return h;
  };
  const paragraph = (text: string, className?: string): HTMLParagraphElement => {
    const p = document.createElement("p");
    p.textContent = text;
    if (className !== undefined) p.className = className;
    return p;
  };
  const button = (text: string, secondary: boolean): HTMLButtonElement => {
    const b = document.createElement("button");
    b.type = "button";
    b.textContent = text;
    if (secondary) b.className = "secondary";
    return b;
  };

  // 音量
  const play = button("音を鳴らす", false);
  root.append(
    heading("音量"),
    paragraph("ナレーションの例と，警報・揺れの効果音の例が流れます．"),
    paragraph(
      "スマホの横の音量ボタンで，聞きやすい大きさに合わせてください．" +
        "聞こえない時は消音モード（横のスイッチ）を解除してください．",
      "lobby-home__note",
    ),
    play,
  );
  const stopSound = (): void => {
    sound.stop();
    stopNarration();
  };
  play.addEventListener("click", () => {
    // もう一度押した時は最初から鳴らし直す．読み上げはタップの処理の中で始める（iOS）
    stopSound();
    narrate(VOLUME_CHECK_NARRATION);
    for (const cue of DEFAULT_VOLUME_CUES) sound.play(cue.kind, cue.at);
  });

  // 画面の明るさ
  const swatches = document.createElement("div");
  swatches.className = "lobby-home__swatches";
  for (const [background, color, name] of SWATCHES) {
    const swatch = document.createElement("span");
    swatch.style.background = background;
    swatch.style.color = color;
    swatch.textContent = name;
    swatches.appendChild(swatch);
  }
  root.append(
    heading("画面の明るさ"),
    ...BRIGHTNESS_GUIDE.map((text) => paragraph(text, "lobby-home__note")),
    swatches,
  );

  // 画面の消灯
  const wakeLockLabel = document.createElement("span");
  wakeLockLabel.className = "lobby-home__wakelock";
  const wakeLockLine = document.createElement("p");
  wakeLockLine.append("画面の消灯を止める: ", wakeLockLabel);
  const wakeLockHelp = paragraph("", "lobby-home__note");
  root.append(
    heading("画面の消灯"),
    paragraph(
      "ゴーグルに入れている間に画面が消えないよう，体験の間は画面の消灯を止めます．",
      "lobby-home__note",
    ),
    wakeLockLine,
    wakeLockHelp,
  );
  const renderWakeLock = (status: WakeLockStatus): void => {
    const d = describeWakeLockStatus(status);
    wakeLockLabel.textContent = d.label;
    wakeLockHelp.textContent = d.help ?? "";
    wakeLockHelp.hidden = d.help === null;
  };
  renderWakeLock(options.wakeLock?.status ?? "unsupported");
  const unsubscribe = options.wakeLock?.subscribe(renderWakeLock) ?? (() => undefined);

  // 戻る
  const back = button("戻る", true);
  back.addEventListener("click", () => {
    stopSound();
    options.onBack();
  });
  const actions = document.createElement("div");
  actions.className = "lobby-home__actions";
  actions.appendChild(back);
  root.appendChild(actions);

  return {
    element: root,
    hide: stopSound,
    dispose() {
      stopSound();
      unsubscribe();
      root.remove();
    },
  };
}
