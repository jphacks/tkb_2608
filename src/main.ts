// エントリポイント．?app を付けると体験の流れ（開始画面 → ロビー → シナリオ．src/app/）を起動する．
// 付けなければ，URL パラメータ（?scene=room 等）で選んだ空間を一人称で表示する PC 確認用のビューア．
// ビューアはドラッグで視点を回し，画面のボタンで歩く・しゃがむ・ドアを開閉できる（VR 表示は後の Issue で足す）
// ?input=mock|device を付けると，代わりに担当D の入力で動かす（当たり判定の無い仮の移動．歩行への統合は別 Issue）
import * as THREE from "three";
import { startApp } from "./app/app";
import { resolveLaunchMode } from "./app/launchMode";
import { devPlayerInput } from "./controls/devInput";
import { DragLook } from "./controls/dragLook";
import { WalkButtons } from "./controls/walkButtons";
import { createEventBus } from "./core/event-bus";
import type { AppEvent } from "./core/events";
import { parseInputKind } from "./input/inputParam";
import { createInputSource, type InputKind } from "./input/inputSource";
import { InputPreview } from "./inputPreview";
import { AVAILABLE_SPACE_IDS, createSpace, createWalkWorld } from "./scenes";
import { createDevDoors, findNearbyDevDoor } from "./scenes/devDoors";
import { resolveSpaceId } from "./scenes/spaceParam";
import type { Space } from "./scenes/types";
import { SpaceWalker } from "./scenes/walk/walker";

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

  window.addEventListener("resize", () => {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
  });

  // ?input の指定が無ければボタンで歩く（当たり判定あり）
  const inputKind = parseInputKind(window.location.search);
  if (inputKind === null) startWalkView(renderer, scene, camera, space);
  else startInputPreview(renderer, scene, camera, space, inputKind);
}

// 確認用の仮の入力（ドラッグ・ボタン）を SpaceWalker につなぐ
function startWalkView(
  renderer: THREE.WebGLRenderer,
  scene: THREE.Scene,
  camera: THREE.PerspectiveCamera,
  space: Space,
): void {
  // プレイヤーの体（rig）の子にカメラを置く．位置と体の向きは walker が，頭の向きは入力が決める
  const rig = new THREE.Object3D();
  rig.add(camera);
  scene.add(rig);

  const bus = createEventBus<AppEvent>();
  const walker = new SpaceWalker(
    createWalkWorld(space),
    { position: space.startPosition, bodyYaw: space.startYaw },
    (event) => bus.emit(event),
  );
  walker.applyTo(rig);

  // 向きは体の向きから見た値（開始時は正面）
  const look = new DragLook(renderer.domElement, { yaw: 0, pitch: 0 });
  // 確認用: ボタンで近くのドア 1 つだけを開閉する（本物のドア開閉が入ったら差し替える）
  const devDoors = createDevDoors(space);
  const nearbyDoor = () => findNearbyDevDoor(devDoors, walker.state);
  const buttons = new WalkButtons(document.body, {
    onDoorToggle: () => {
      const door = nearbyDoor();
      if (!door) return null;
      door.setOpen(!door.isOpen());
      return { id: door.id, open: door.isOpen() };
    },
  });

  let lastEvent = "";
  bus.onAny((event) => {
    if (event.type === "areaEntered" || event.type === "areaExited") {
      lastEvent = `${event.type}: ${event.areaId}`;
      console.info(`[walk] ${lastEvent}`);
    }
  });

  let lastTime: number | null = null;
  renderer.setAnimationLoop((time) => {
    const dt = lastTime === null ? 0 : (time - lastTime) / 1000;
    lastTime = time;
    const input = devPlayerInput(
      { look: look.angles, walking: buttons.walking, crouching: buttons.crouching },
      time,
    );
    walker.update({ dt, input });
    walker.applyTo(rig);
    const { head } = input;
    camera.quaternion.set(head.x, head.y, head.z, head.w);

    const { x, z, eyeHeight, seat } = walker.state;
    const areas = walker.observe().areaIds;
    const door = nearbyDoor();
    buttons.setDoorTarget(door && { id: door.id, open: door.isOpen() });
    buttons.setStatus(
      [
        `pos ${x.toFixed(2)}, ${z.toFixed(2)}  eye ${eyeHeight.toFixed(2)}${seat ? `  seat ${seat.id}` : ""}`,
        `areas ${areas.length > 0 ? areas.join(", ") : "-"}`,
        `last ${lastEvent || "-"}`,
        door ? `door ${door.id} (${door.isOpen() ? "開" : "閉"})` : "近くにドアなし",
      ].join("\n"),
    );
    renderer.render(scene, camera);
  });
}

// 担当D の入力（PlayerInput）でカメラを直接動かす（当たり判定なし）
function startInputPreview(
  renderer: THREE.WebGLRenderer,
  scene: THREE.Scene,
  camera: THREE.PerspectiveCamera,
  space: Space,
  inputKind: InputKind,
): void {
  camera.position.copy(space.startPosition);
  const preview = new InputPreview(
    createInputSource({ kind: inputKind, calibration: null, target: renderer.domElement }),
    camera,
    space.startPosition,
    space.startYaw,
  );
  renderer.setAnimationLoop(() => {
    preview.update(performance.now());
    renderer.render(scene, camera);
  });
}

if (resolveLaunchMode(window.location.search) === "app") {
  startApp();
} else {
  startViewer();
}
