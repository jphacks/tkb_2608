// 結果画面の dev 用の単独起動（?debrief）．デモの校舎と手で作った記録（sampleDrill.ts）を Session に入れて結果画面だけを出す．
// 開発サーバーでだけ src/main.ts から動的に読み込む（本番のビルドには含めない）．「同じ訓練をもう一度」「ホームへ」は行き先を出して止まる

import * as THREE from "three";
import { createEventBus } from "../core/event-bus";
import type { AppEvent } from "../core/events";
import type { Scene, SceneContext, Session } from "../core/scene";
import { createDebriefScene } from "../debrief/debriefScene";
import { TRAINING_BACKGROUND_CSS, TRAINING_BOX_CSS } from "../lobby/trainingTheme";
import { DEMO_SCHOOL } from "../share/samples/demoSchool";
import { createSampleDrill, resolveSampleDrillVariant } from "./sampleDrill";

export function startDebriefPreview(): void {
  document.body.style.margin = "0";
  const overlay = document.createElement("div");
  overlay.style.cssText = "position:fixed;inset:0;pointer-events:none;";
  document.body.appendChild(overlay);

  const plan = DEMO_SCHOOL;
  const session: Session = {
    calibration: null,
    result: null,
    recording: null,
    plan,
    planLoadError: null,
    drill: createSampleDrill(plan, resolveSampleDrillVariant(window.location.search)),
  };
  // 結果画面は 3D を使わないが，SceneContext の形に合わせて空の描画先を渡す
  const stage = { world: new THREE.Scene(), rig: new THREE.Object3D(), overlay };

  let scene: Scene | null = null;
  const show = (): void => {
    overlay.replaceChildren();
    scene = createDebriefScene({
      theme: { backgroundCss: TRAINING_BACKGROUND_CSS, boxCss: TRAINING_BOX_CSS },
    });
    void scene.enter(ctx);
  };
  const ctx: SceneContext = {
    bus: createEventBus<AppEvent>(),
    stage,
    session,
    goTo(next) {
      scene?.exit();
      scene = null;
      const note = document.createElement("div");
      note.style.cssText =
        "position:absolute;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:center;" +
        "gap:12px;pointer-events:auto;background:#1a2333;color:#f2f4f8;font:16px/1.6 system-ui,sans-serif;";
      const text = document.createElement("div");
      text.textContent = `「${next}」の画面へ進みます（?debrief は結果画面だけの確認用なので，ここで止まります）`;
      const back = document.createElement("button");
      back.type = "button";
      back.textContent = "結果画面に戻る";
      back.addEventListener("click", show);
      note.append(text, back);
      overlay.replaceChildren(note);
    },
  };
  show();
}
