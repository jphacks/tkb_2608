// 縦向きの時に「スマホを横向きにしてください」と，横向きの左右が OS の画面の向きと食い違う（画面が逆さ）時に
// 「上下を逆に持ち直してください」と全面に出す案内（薄い殻）．
// ?app の全画面で効かせるため，app/ が起動時に 1 回だけ作り，画面の切り替えとは別に置き続ける

import {
  createLandscapeSideState,
  updateFlipped,
  updateLandscapeSide,
  upFromOrientation,
} from "./landscapeSide";
import { screenAngle } from "./sensorFeed";
import { isPortraitViewport } from "./viewportOrientation";

export interface OrientationGuide {
  /** 今，案内（縦向き・画面が逆さのどちらか）を出しているか（ロビー等が時間を止めるのに使う） */
  readonly visible: boolean;
  dispose(): void;
}

const STYLE = `
.lobby-rotate {
  position: fixed; inset: 0; z-index: 100; pointer-events: auto;
  display: none; flex-direction: column; align-items: center; justify-content: center; gap: 28px;
  background: rgba(16, 24, 38, 0.96); color: #f2f4f8; text-align: center; padding: 24px;
  font-family: system-ui, -apple-system, "Hiragino Sans", sans-serif;
}
.lobby-rotate.is-visible { display: flex; }
.lobby-rotate__phone {
  width: 56px; height: 96px; border: 4px solid #f2f4f8; border-radius: 12px; position: relative;
  animation: lobby-rotate-turn 2.4s ease-in-out infinite;
}
.lobby-rotate__phone::after {
  content: ""; position: absolute; left: 50%; bottom: 6px; width: 14px; height: 4px;
  margin-left: -7px; border-radius: 2px; background: #f2f4f8;
}
.lobby-rotate__text { font-size: 1.3rem; font-weight: bold; line-height: 1.6; }
.lobby-rotate__sub { font-size: 0.95rem; color: #c8d0dc; }
.lobby-rotate__flip { display: none; flex-direction: column; align-items: center; gap: 16px; transform: rotate(180deg); }
.lobby-rotate.is-flipped .lobby-rotate__flip { display: flex; }
.lobby-rotate.is-flipped .lobby-rotate__portrait { display: none; }
.lobby-rotate__portrait { display: flex; flex-direction: column; align-items: center; gap: 28px; }
@keyframes lobby-rotate-turn {
  0%, 20% { transform: rotate(0deg); }
  50%, 80% { transform: rotate(-90deg); }
  100% { transform: rotate(0deg); }
}
@media (prefers-reduced-motion: reduce) {
  .lobby-rotate__phone { animation: none; transform: rotate(-90deg); }
}
`;

export function createOrientationGuide(parent: HTMLElement = document.body): OrientationGuide {
  const style = document.createElement("style");
  style.textContent = STYLE;
  document.head.appendChild(style);

  const root = document.createElement("div");
  root.className = "lobby-rotate";
  root.setAttribute("role", "alert");
  // 画面が逆さの時は OS が描く向きと持っている向きが 180° 違うので，案内だけを 180° 回して読める向きにする
  // （3D の描画と頭の向きは回さない．SPEC_01「画面の流れ」）
  root.innerHTML = `
    <div class="lobby-rotate__portrait">
      <div class="lobby-rotate__phone" aria-hidden="true"></div>
      <div class="lobby-rotate__text">スマホを横向きにしてください</div>
      <div class="lobby-rotate__sub">横向きにすると，この案内は消えます</div>
    </div>
    <div class="lobby-rotate__flip">
      <div class="lobby-rotate__text">画面の上下が逆さまです</div>
      <div class="lobby-rotate__sub">ゴーグルからスマホを出して，上下を逆にして持ち直してください．<br>画面の回転ロックがオンなら，オフにしてください</div>
    </div>`;
  parent.appendChild(root);

  let visible = false;
  const side = createLandscapeSideState();
  const refresh = (): void => {
    const portrait = isPortraitViewport(window.innerWidth, window.innerHeight);
    const flipped = !portrait && updateFlipped(side, screenAngle(), performance.now());
    visible = portrait || flipped;
    root.classList.toggle("is-visible", visible);
    root.classList.toggle("is-flipped", flipped);
  };
  // 向きのセンサーが無い・許可されていない端末ではイベントが来ないので，逆さの案内は出ない（今までどおり）
  const onDeviceOrientation = (event: DeviceOrientationEvent): void => {
    const up = upFromOrientation(event.beta ?? Number.NaN, event.gamma ?? Number.NaN);
    updateLandscapeSide(side, up, performance.now());
    refresh();
  };
  // iOS では回転の直後に innerWidth / innerHeight が古いままのことがあるため，resize でも測り直す
  const portrait = window.matchMedia("(orientation: portrait)");
  portrait.addEventListener("change", refresh);
  window.addEventListener("resize", refresh);
  window.addEventListener("deviceorientation", onDeviceOrientation);
  refresh();

  return {
    get visible() {
      return visible;
    },
    dispose() {
      portrait.removeEventListener("change", refresh);
      window.removeEventListener("resize", refresh);
      window.removeEventListener("deviceorientation", onDeviceOrientation);
      root.remove();
      style.remove();
    },
  };
}
