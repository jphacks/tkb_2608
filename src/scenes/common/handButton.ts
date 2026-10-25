// 手で押すボタン（VR の中）の共通部品（Issue #145）．位置・文字・押した時の処理を渡せば，どの画面にも置ける．
// 見た目はロビーの開始ボタン（lobby/lobbyRoom.ts の createStartButton）と同じ丸とリングに，下に文字を足したもの．
// 判定は handButtonPress.ts の純粋な関数．画面を持つモジュール（lobby/・debrief/ 等）には app/ がこの関数を渡す
// （画面を持つモジュール同士は import しないため．scenes/common/handMarkers.ts と同じ渡し方）

import * as THREE from "three";
import type { Handedness, HandState, Quat, Vec3 } from "../../core/types";
import {
  advanceHandButtonPress,
  DEFAULT_HAND_BUTTON_PRESS_CONFIG,
  type HandButtonPressConfig,
  type HandButtonPressState,
  type HandButtonTrigger,
  handButtonCenter,
  handButtonProgress,
  INITIAL_HAND_BUTTON_PRESS,
  isAnyHandOverButton,
  isHandButtonArmed,
  pressHandButton,
} from "./handButtonPress";

export interface HandButtonOptions {
  /**
   * ボタンの中心（親の座標，m）．親は目の位置が原点で Y 軸回りだけに回るもの（rig，または頭の向きに追従する板の pivot）．
   * 例: 正面 0.5 m・目の高さなら { x: 0, y: 0, z: -0.5 }
   */
  readonly position: Vec3;
  /** ボタンの下に出す文字（省くと文字なし） */
  readonly label?: string;
  /** 判定の値（省いた項目は DEFAULT_HAND_BUTTON_PRESS_CONFIG） */
  readonly config?: Partial<HandButtonPressConfig>;
  /** 押した時に 1 回だけ呼ぶ（手でも press() でも） */
  readonly onPress?: (by: HandButtonTrigger) => void;
}

export interface HandButtonFrame {
  /** 頭の向き（PlayerInput.head） */
  readonly head: Quat;
  /** 手（PlayerInput.hands．位置は頭の座標系） */
  readonly hands: Readonly<Record<Handedness, HandState>>;
  /** 前のフレームからの秒数（s） */
  readonly dt: number;
  /** 親のヨー角（rad）．頭の向きに追従する板に付けた時はその rotation.y．rig に付けた時は省く（0） */
  readonly parentYaw?: number;
}

/** 手で押すボタン．object を親に足し，毎フレーム update を呼ぶ */
export interface HandButton {
  /** 親に足す．表示・非表示を画面の側で決める時は object.visible を使う（押せるようになる前と押した後は中身を自分で隠す） */
  readonly object: THREE.Object3D;
  /** 1 フレーム進める．押したら（押した後も）true */
  update(frame: HandButtonFrame): boolean;
  /** 押したことにする（タップ・キー等の代わりの操作．カメラが使えない時の逃げ道） */
  press(): void;
  /** 押したか */
  isPressed(): boolean;
  /** 押す前の状態に戻す（出し直す時．押せるようになるまでの待ちも数え直す） */
  reset(): void;
  dispose(): void;
}

const BUTTON_RADIUS = 0.06;
const RING_SEGMENTS = 48;
/** 文字の板の大きさ（m）．ボタンの下に置く */
const LABEL_WIDTH = 0.3;
const LABEL_HEIGHT = 0.06;
/** 文字の板の中心の，ボタンの中心からの下へのずれ（m） */
const LABEL_OFFSET_Y = -(BUTTON_RADIUS * 1.45 + LABEL_HEIGHT / 2 + 0.01);
const LABEL_CANVAS_WIDTH = 640;
const LABEL_CANVAS_HEIGHT = Math.round((LABEL_CANVAS_WIDTH * LABEL_HEIGHT) / LABEL_WIDTH);
const LABEL_FONT_FAMILY = '"Hiragino Sans", "Noto Sans JP", sans-serif';

/** 文字を canvas に描いた板．canvas が使えない環境（テスト等）では null */
function createLabel(text: string): { mesh: THREE.Mesh; dispose: () => void } | null {
  if (typeof document === "undefined") return null;
  const canvas = document.createElement("canvas");
  canvas.width = LABEL_CANVAS_WIDTH;
  canvas.height = LABEL_CANVAS_HEIGHT;
  const ctx = canvas.getContext("2d");
  if (ctx === null) return null;
  ctx.fillStyle = "rgba(16, 20, 28, 0.75)";
  ctx.fillRect(0, 0, LABEL_CANVAS_WIDTH, LABEL_CANVAS_HEIGHT);
  // 枠に収まるまで小さくする（下限 24px）
  let fontPx = Math.round(LABEL_CANVAS_HEIGHT * 0.62);
  ctx.font = `bold ${fontPx}px ${LABEL_FONT_FAMILY}`;
  while (fontPx > 24 && ctx.measureText(text).width > LABEL_CANVAS_WIDTH * 0.92) {
    fontPx -= 2;
    ctx.font = `bold ${fontPx}px ${LABEL_FONT_FAMILY}`;
  }
  ctx.fillStyle = "#ffffff";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(text, LABEL_CANVAS_WIDTH / 2, LABEL_CANVAS_HEIGHT / 2);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  const geometry = new THREE.PlaneGeometry(LABEL_WIDTH, LABEL_HEIGHT);
  const material = new THREE.MeshBasicMaterial({ map: texture, transparent: true });
  const mesh = new THREE.Mesh(geometry, material);
  mesh.name = "hand-button-label";
  mesh.position.y = LABEL_OFFSET_Y;
  return {
    mesh,
    dispose() {
      geometry.dispose();
      material.dispose();
      texture.dispose();
    },
  };
}

/** 手で押すボタンを作る */
export function createHandButton(options: HandButtonOptions): HandButton {
  const config: HandButtonPressConfig = { ...DEFAULT_HAND_BUTTON_PRESS_CONFIG, ...options.config };
  const offset: Vec3 = { ...options.position };

  const group = new THREE.Group();
  group.name = "hand-button";
  group.position.set(offset.x, offset.y, offset.z);
  // 押せるようになる前と押した後に隠す中身（group.visible は画面の側に任せる）
  const body = new THREE.Group();
  body.name = "hand-button-body";
  group.add(body);

  const discGeometry = new THREE.CircleGeometry(BUTTON_RADIUS, 48);
  const discMaterial = new THREE.MeshBasicMaterial({ color: 0xff8a3d });
  body.add(new THREE.Mesh(discGeometry, discMaterial));

  const trackGeometry = new THREE.RingGeometry(
    BUTTON_RADIUS * 1.2,
    BUTTON_RADIUS * 1.45,
    RING_SEGMENTS,
  );
  const trackMaterial = new THREE.MeshBasicMaterial({
    color: 0xffffff,
    transparent: true,
    opacity: 0.25,
  });
  const track = new THREE.Mesh(trackGeometry, trackMaterial);
  track.position.z = 0.001;
  body.add(track);

  // 12 時の位置から時計回りに伸びるリング（RingGeometry の三角形は角度の順に並ぶので drawRange で切る）
  const ringGeometry = new THREE.RingGeometry(
    BUTTON_RADIUS * 1.2,
    BUTTON_RADIUS * 1.45,
    RING_SEGMENTS,
    1,
    Math.PI / 2,
    -Math.PI * 2,
  );
  const ringMaterial = new THREE.MeshBasicMaterial({ color: 0xffd27a, side: THREE.DoubleSide });
  const ring = new THREE.Mesh(ringGeometry, ringMaterial);
  ring.name = "hand-button-progress";
  ring.position.z = 0.002;
  ringGeometry.setDrawRange(0, 0);
  body.add(ring);

  const label = options.label === undefined ? null : createLabel(options.label);
  if (label !== null) body.add(label.mesh);

  let state: HandButtonPressState = INITIAL_HAND_BUTTON_PRESS;
  let notified = false;

  const render = (): void => {
    body.visible = state.pressedBy === null && isHandButtonArmed(state, config);
    const segments = Math.round(handButtonProgress(state, config) * RING_SEGMENTS);
    ringGeometry.setDrawRange(0, segments * 6);
  };
  const notify = (): void => {
    if (notified || state.pressedBy === null) return;
    notified = true;
    options.onPress?.(state.pressedBy);
  };
  render();

  return {
    object: group,
    update(frame) {
      if (state.pressedBy === null) {
        const center = handButtonCenter(offset, frame.parentYaw ?? 0);
        const handOver = isAnyHandOverButton(frame.head, frame.hands, center, config.radius);
        state = advanceHandButtonPress(state, { dt: frame.dt, handOver }, config);
        render();
        notify();
      }
      return state.pressedBy !== null;
    },
    press() {
      state = pressHandButton(state);
      render();
      notify();
    },
    isPressed: () => state.pressedBy !== null,
    reset() {
      state = INITIAL_HAND_BUTTON_PRESS;
      notified = false;
      render();
    },
    dispose() {
      for (const g of [discGeometry, trackGeometry, ringGeometry]) g.dispose();
      for (const m of [discMaterial, trackMaterial, ringMaterial]) m.dispose();
      label?.dispose();
    },
  };
}
