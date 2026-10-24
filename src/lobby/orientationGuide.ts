// 縦向きの時に「スマホを横向きにしてください」と全面に出す案内（薄い殻）．
// ?app の全画面で効かせるため，app/ が起動時に 1 回だけ作り，画面の切り替えとは別に置き続ける

import { isPortraitViewport } from "./viewportOrientation";

export interface OrientationGuide {
  /** 今，案内を出しているか（ロビーが時間を止めるのに使う） */
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
  root.innerHTML = `
    <div class="lobby-rotate__phone" aria-hidden="true"></div>
    <div class="lobby-rotate__text">スマホを横向きにしてください</div>
    <div class="lobby-rotate__sub">横向きにすると，この案内は消えます</div>`;
  parent.appendChild(root);

  let visible = false;
  const refresh = (): void => {
    visible = isPortraitViewport(window.innerWidth, window.innerHeight);
    root.classList.toggle("is-visible", visible);
  };
  // iOS では回転の直後に innerWidth / innerHeight が古いままのことがあるため，resize でも測り直す
  const portrait = window.matchMedia("(orientation: portrait)");
  portrait.addEventListener("change", refresh);
  window.addEventListener("resize", refresh);
  refresh();

  return {
    get visible() {
      return visible;
    },
    dispose() {
      portrait.removeEventListener("change", refresh);
      window.removeEventListener("resize", refresh);
      root.remove();
      style.remove();
    },
  };
}
