// エントリポイント．URL パラメータ（?scene=room 等）で選んだ空間を一人称で表示する．
// PC での確認用に，ドラッグで視点を回せる（歩行・VR 表示は後の Issue で足す）
import * as THREE from "three";
import { DragLook } from "./controls/dragLook";
import { AVAILABLE_SPACE_IDS, createSpace } from "./scenes";
import { resolveSpaceId } from "./scenes/spaceParam";

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

const look = new DragLook(renderer.domElement, { yaw: space.startYaw, pitch: 0 });

window.addEventListener("resize", () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

renderer.setAnimationLoop(() => {
  look.applyTo(camera);
  renderer.render(scene, camera);
});
