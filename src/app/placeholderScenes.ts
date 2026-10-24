// 未実装の画面の仮表示（シナリオの画面ができたら置き換える）

import type { Scene } from "../core/scene";
import { formatPlayerInput } from "../input/inputParam";

/**
 * シナリオの画面の仮表示．到達したことと，受け取った CalibrationProfile と，
 * 毎フレームの PlayerInput（頭の向き・姿勢・足踏み．入力が体験の流れに届いているかの確認用）を表示する
 */
export function createScenarioPlaceholder(): Scene {
  let root: HTMLDivElement | null = null;
  let inputView: HTMLPreElement | null = null;
  return {
    id: "scenario",
    enter(ctx) {
      root = document.createElement("div");
      root.style.cssText =
        "position:absolute;left:16px;top:16px;max-width:90vw;padding:16px;pointer-events:auto;" +
        "background:rgba(16,20,28,0.9);color:#f2f4f8;font:16px/1.6 system-ui,sans-serif;border-radius:8px;";
      const title = document.createElement("div");
      title.style.fontWeight = "bold";
      title.textContent = "シナリオ画面（仮表示．未実装）";
      const pre = document.createElement("pre");
      pre.style.cssText = "margin:8px 0;white-space:pre-wrap;";
      pre.textContent = `Session.calibration:\n${JSON.stringify(ctx.session.calibration, null, 2)}`;
      inputView = document.createElement("pre");
      inputView.style.cssText = "margin:8px 0;white-space:pre-wrap;";
      const again = document.createElement("button");
      again.type = "button";
      again.textContent = "もう一度（ロビーへ．結果画面の代わりの確認用）";
      again.addEventListener("click", () => ctx.goTo("lobby"));
      const home = document.createElement("button");
      home.type = "button";
      home.textContent = "ホームへ（結果画面の代わりの確認用）";
      home.style.marginLeft = "8px";
      home.addEventListener("click", () => ctx.goTo("home"));
      root.append(title, pre, inputView, again, home);
      ctx.stage.overlay.appendChild(root);
    },
    update(frame) {
      if (inputView === null) return;
      const text = `PlayerInput:\n${formatPlayerInput(frame.input)}`;
      // 変わった時だけ書き換える（毎フレームの DOM の更新を避ける）
      if (inputView.textContent !== text) inputView.textContent = text;
    },
    exit() {
      root?.remove();
      root = null;
      inputView = null;
    },
  };
}
