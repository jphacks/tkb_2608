// 未実装の画面の仮表示（シナリオの画面ができたら置き換える）

import type { Scene } from "../core/scene";

/** シナリオの画面の仮表示．到達したことと，受け取った CalibrationProfile を表示する */
export function createScenarioPlaceholder(): Scene {
  let root: HTMLDivElement | null = null;
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
      const again = document.createElement("button");
      again.type = "button";
      again.textContent = "もう一度（ロビーへ．結果画面の代わりの確認用）";
      again.addEventListener("click", () => ctx.goTo("lobby"));
      const home = document.createElement("button");
      home.type = "button";
      home.textContent = "ホームへ（結果画面の代わりの確認用）";
      home.style.marginLeft = "8px";
      home.addEventListener("click", () => ctx.goTo("home"));
      root.append(title, pre, again, home);
      ctx.stage.overlay.appendChild(root);
    },
    update() {},
    exit() {
      root?.remove();
      root = null;
    },
  };
}
