// エントリポイント．?app を付けると体験の流れ（開始画面 → ロビー → シナリオ．src/app/）を起動する．
// 付けなければ，URL パラメータ（?scene=room 等）で選んだ空間を一人称で表示する PC 確認用のビューア．
// ビューアはドラッグで視点を回せる（歩行・VR 表示は後の Issue で足す）
// ?input=mock|device で入力を切り替える（ビューアのみ）
import * as THREE from "three";
import { startApp } from "./app/app";
import { resolveLaunchMode } from "./app/launchMode";
import { DragLook } from "./controls/dragLook";
import { parseInputKind } from "./input/inputParam";
import { createInputSource } from "./input/inputSource";
import { InputPreview } from "./inputPreview";
import { AVAILABLE_SPACE_IDS, createSpace } from "./scenes";
import { resolveSpaceId } from "./scenes/spaceParam";

function startViewer(): void {
  const renderer = new THREE.WebGLRenderer({ antialias: true });
  // 高解像度の端末で重くなりすぎないよう 2 倍までに抑える
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.setSize(window.innerWidth, window.innerHeight);
  document.body.appendChild(renderer.domElement);

  const spaceId = resolveSpaceId(window.location.search, AVAILABLE_SPACE_IDS);
  const space = createSpace(spaceId, {
    maxAnisotropy: Math.min(renderer.capabilities.getMaxAnisotropy(), 8),
  });

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(space.background);
  scene.add(space.root);

  const camera = new THREE.PerspectiveCamera(70, window.innerWidth / window.innerHeight, 0.05, 50);
  camera.position.copy(space.startPosition);

  // ?input の指定が無ければ今までどおりドラッグで回す
  const inputKind = parseInputKind(window.location.search);
  const preview =
    inputKind === null
      ? null
      : new InputPreview(
          createInputSource({ kind: inputKind, calibration: null, target: renderer.domElement }),
          camera,
          space.startPosition,
          space.startYaw,
        );
  const look =
    preview === null ? new DragLook(renderer.domElement, { yaw: space.startYaw, pitch: 0 }) : null;

  window.addEventListener("resize", () => {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
  });

  renderer.setAnimationLoop(() => {
    if (preview !== null) preview.update(performance.now());
    else look?.applyTo(camera);
    renderer.render(scene, camera);
  });
}

if (resolveLaunchMode(window.location.search) === "app") {
  startApp();
} else {
  startViewer();
}
