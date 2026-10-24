// エントリポイント．URL パラメータ（?scene=room 等）で選んだ空間を一人称で表示する．
// 確認用に，ドラッグで視点を回し，画面のボタンで歩く・しゃがむ・ドアを開閉できる
// （本物の入力（src/input/）・VR 表示・画面の切り替え（app/）は後の Issue で足す）
import * as THREE from "three";
import { devPlayerInput } from "./controls/devInput";
import { DragLook } from "./controls/dragLook";
import { WalkButtons } from "./controls/walkButtons";
import { createEventBus } from "./core/event-bus";
import type { AppEvent } from "./core/events";
import { AVAILABLE_SPACE_IDS, createSpace, createWalkWorld } from "./scenes";
import { createDevDoors, findNearbyDevDoor } from "./scenes/devDoors";
import { resolveSpaceId } from "./scenes/spaceParam";
import { SpaceWalker } from "./scenes/walk/walker";

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

// プレイヤーの体（rig）の子にカメラを置く．位置と体の向きは walker が，頭の向きは入力が決める
const rig = new THREE.Object3D();
const camera = new THREE.PerspectiveCamera(70, window.innerWidth / window.innerHeight, 0.05, 50);
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

window.addEventListener("resize", () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
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
