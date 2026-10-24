// エントリポイント．?app を付けると体験の流れ（開始画面 → ロビー → シナリオ → 結果．src/app/）を起動する．
// 開発サーバーでは ?debrief で結果画面だけを，デモの校舎と手で作った記録で表示する（?debrief=late・?debrief=nosmoke で記録を変える）．
// 付けなければ，URL パラメータ（?scene=room 等）で選んだ空間を一人称で表示する PC 確認用のビューア．
// ビューアはドラッグで視点を回し，画面のボタンで歩く・しゃがむ・ドアを開閉できる（VR 表示は後の Issue で足す）
// ?input=mock|device を付けると，ボタン・ドラッグの代わりに担当D の入力（足踏み・しゃがみ・頭の向き）で歩く
import * as THREE from "three";
import { startApp } from "./app/app";
import { resolveLaunchMode } from "./app/launchMode";
import { devPlayerInput } from "./controls/devInput";
import { DragLook } from "./controls/dragLook";
import { type DoorButtonTarget, WalkButtons } from "./controls/walkButtons";
import { createEventBus } from "./core/event-bus";
import type { AppEvent } from "./core/events";
import type { PlayerInput } from "./core/types";
import { parseInputKind } from "./input/inputParam";
import { createInputSource, type InputKind } from "./input/inputSource";
import { InputPreview } from "./inputPreview";
import { AVAILABLE_SPACE_IDS, createSpace, createWalkWorld } from "./scenes";
import { createDevDoors, type DevDoor, findNearbyDevDoor } from "./scenes/devDoors";
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

  // ?input の指定が無ければボタンで，あれば担当D の入力で歩く（どちらも当たり判定あり）
  const inputKind = parseInputKind(window.location.search);
  if (inputKind === null) startWalkView(renderer, scene, camera, space);
  else startInputWalk(renderer, scene, camera, space, inputKind);
}

/** プレイヤーの体（rig）と歩行（walker）と確認用のドア．ボタン歩行と ?input の歩行で共通 */
interface WalkSetup {
  readonly rig: THREE.Object3D;
  readonly walker: SpaceWalker;
  /** 近くのドア（確認用．無ければ null） */
  readonly nearbyDoor: () => DevDoor | null;
  /** 近くのドアの開閉を切り替える．切り替えた後の対象を返す（近くに無ければ null） */
  readonly toggleNearbyDoor: () => DoorButtonTarget | null;
  /** 画面の左上に出す歩行の状態（位置・エリア・直前の出入り・近くのドア） */
  readonly statusLines: () => string[];
}

function setupWalk(scene: THREE.Scene, camera: THREE.PerspectiveCamera, space: Space): WalkSetup {
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

  // 確認用: 近くのドア 1 つだけを開閉する（本物のドア開閉が入ったら差し替える）
  const devDoors = createDevDoors(space);
  const nearbyDoor = () => findNearbyDevDoor(devDoors, walker.state);
  const toggleNearbyDoor = () => {
    const door = nearbyDoor();
    if (!door) return null;
    door.setOpen(!door.isOpen());
    return { id: door.id, open: door.isOpen() };
  };

  let lastEvent = "";
  bus.onAny((event) => {
    if (event.type === "areaEntered" || event.type === "areaExited") {
      lastEvent = `${event.type}: ${event.areaId}`;
      console.info(`[walk] ${lastEvent}`);
    }
  });

  const statusLines = () => {
    const { x, z, eyeHeight, seat } = walker.state;
    const areas = walker.observe().areaIds;
    const door = nearbyDoor();
    return [
      `pos ${x.toFixed(2)}, ${z.toFixed(2)}  eye ${eyeHeight.toFixed(2)}${seat ? `  seat ${seat.id}` : ""}`,
      `areas ${areas.length > 0 ? areas.join(", ") : "-"}`,
      `last ${lastEvent || "-"}`,
      door ? `door ${door.id} (${door.isOpen() ? "開" : "閉"})` : "近くにドアなし",
    ];
  };

  return { rig, walker, nearbyDoor, toggleNearbyDoor, statusLines };
}

/** 1 フレーム分歩かせ，rig とカメラに反映する．頭の向き（head）は体の向きから見た値として rig の子のカメラに当てる */
function stepAndApply(
  walk: WalkSetup,
  camera: THREE.PerspectiveCamera,
  dt: number,
  input: PlayerInput,
): void {
  walk.walker.update({ dt, input });
  walk.walker.applyTo(walk.rig);
  const { head } = input;
  camera.quaternion.set(head.x, head.y, head.z, head.w);
}

// 確認用の仮の入力（ドラッグ・ボタン）を SpaceWalker につなぐ
function startWalkView(
  renderer: THREE.WebGLRenderer,
  scene: THREE.Scene,
  camera: THREE.PerspectiveCamera,
  space: Space,
): void {
  const walk = setupWalk(scene, camera, space);
  // 向きは体の向きから見た値（開始時は正面）
  const look = new DragLook(renderer.domElement, { yaw: 0, pitch: 0 });
  const buttons = new WalkButtons(document.body, { onDoorToggle: walk.toggleNearbyDoor });

  let lastTime: number | null = null;
  renderer.setAnimationLoop((time) => {
    const dt = lastTime === null ? 0 : (time - lastTime) / 1000;
    lastTime = time;
    const input = devPlayerInput(
      { look: look.angles, walking: buttons.walking, crouching: buttons.crouching },
      time,
    );
    stepAndApply(walk, camera, dt, input);

    const door = walk.nearbyDoor();
    buttons.setDoorTarget(door && { id: door.id, open: door.isOpen() });
    buttons.setStatus(walk.statusLines().join("\n"));
    renderer.render(scene, camera);
  });
}

// 担当D の入力（PlayerInput）を SpaceWalker につなぐ（当たり判定あり．ボタン・ドラッグの視点操作は出さない）
function startInputWalk(
  renderer: THREE.WebGLRenderer,
  scene: THREE.Scene,
  camera: THREE.PerspectiveCamera,
  space: Space,
  inputKind: InputKind,
): void {
  const walk = setupWalk(scene, camera, space);
  // PlayerInput.head は正面リセット済み（最初に受け取った向き＝正面）なので，体の向き（startYaw）から見た値として扱う
  const preview = new InputPreview(
    createInputSource({ kind: inputKind, calibration: null, target: renderer.domElement }),
    {
      onDoorToggle: () => {
        walk.toggleNearbyDoor();
      },
    },
  );

  let lastNow: number | null = null;
  renderer.setAnimationLoop(() => {
    // InputSource.read は performance.now() の時刻を受け取るため，dt も同じ時計で測る
    const now = performance.now();
    const dt = lastNow === null ? 0 : (now - lastNow) / 1000;
    lastNow = now;
    const input = preview.read(now);
    stepAndApply(walk, camera, dt, input);
    preview.show(input, walk.statusLines());
    renderer.render(scene, camera);
  });
}

const launchMode = resolveLaunchMode(window.location.search);
if (launchMode === "app") {
  startApp();
} else if (launchMode === "debrief" && import.meta.env.DEV) {
  // 結果画面の dev 用の単独起動．本番のビルドには含めない（import.meta.env.DEV が false の分岐ごと消える）
  void import("./app/debriefPreview").then((m) => m.startDebriefPreview());
} else {
  startViewer();
}
