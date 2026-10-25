// ロビーの部屋（学校の防災学習室: フローリングの床・クリーム色の壁と木の腰板・蛍光灯の天井，立ち位置の印と
// 黒板・消火器・非常口の誘導灯等の置き物（lobbyProps.ts））と，指示を出す板・開始ボタン・見え方の調整の十字・手の印．
// 模様はすべて CanvasTexture でコードから描く（外部ファイルを足さない）．影は使わず，ライトは 2 つに抑える．
// 2 画面で描くため，光の計算は MeshStandardMaterial より軽い MeshLambertMaterial にする

import * as THREE from "three";
import { drawFittedText } from "./canvasText";
import { canvasTexture, createLobbyProps, seededRandom } from "./lobbyProps";

/** 目の高さ（m）．rig の位置を目の位置として扱う（scenes/ の startPosition と同じ） */
export const LOBBY_EYE_HEIGHT = 1.6;

/** 部屋の幅と奥行き（m） */
const ROOM_SIZE = 8;
/** 天井の高さ（m） */
const ROOM_HEIGHT = 3;
/** 床のテクスチャ 1 枚の大きさ（m） */
const FLOOR_TILE = 2;
/** 床板の幅（m） */
const FLOOR_BOARD_WIDTH = 0.125;
/** 腰板の高さ（m） */
const WAIST_LINE_HEIGHT = 0.9;
/** 天井の照明の並び（1 枚のテクスチャの繰り返しの長さ，m） */
const CEILING_TILE = 2;

export interface LobbyRoom {
  readonly root: THREE.Group;
  dispose(): void;
}

/** 床: 木のフローリング（板の色を少しずつ変え，継ぎ目をずらす） */
function createFloorTexture(): THREE.CanvasTexture {
  const size = 512;
  const boards = Math.round(FLOOR_TILE / FLOOR_BOARD_WIDTH);
  const boardPx = size / boards;
  const rand = seededRandom(3);
  const texture = canvasTexture(size, size, (ctx) => {
    for (let i = 0; i < boards; i++) {
      // 1 本の列を 2 枚の板に分け，継ぎ目の位置を列ごとにずらす（端でつながるよう繰り返しの範囲に収める）
      const seam = Math.floor(rand() * size);
      for (const [from, to] of [
        [0, seam],
        [seam, size],
      ] as const) {
        const shade = 0.9 + rand() * 0.18;
        const r = Math.round(196 * shade);
        const g = Math.round(150 * shade);
        const b = Math.round(98 * shade);
        ctx.fillStyle = `rgb(${r}, ${g}, ${b})`;
        ctx.fillRect(i * boardPx, from, boardPx, to - from);
      }
      ctx.fillStyle = "rgba(70, 45, 20, 0.45)";
      ctx.fillRect(i * boardPx, 0, 2, size);
      ctx.fillRect(i * boardPx, seam, boardPx, 2);
      // 木目の細い筋
      ctx.fillStyle = "rgba(120, 80, 40, 0.12)";
      for (let k = 0; k < 3; k++) {
        ctx.fillRect(i * boardPx + 4 + rand() * (boardPx - 8), 0, 1, size);
      }
    }
  });
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.repeat.set(ROOM_SIZE / FLOOR_TILE, ROOM_SIZE / FLOOR_TILE);
  return texture;
}

/** 壁: 腰の高さより下は木の腰板，境目に見切りの線，上は明るいクリーム色．縦方向だけに模様がある */
function createWallTexture(): THREE.CanvasTexture {
  const width = 8;
  const height = 512;
  const toY = (meters: number): number => height * (1 - meters / ROOM_HEIGHT);
  return canvasTexture(width, height, (ctx) => {
    const upper = ctx.createLinearGradient(0, 0, 0, toY(WAIST_LINE_HEIGHT));
    upper.addColorStop(0, "#f6efdc");
    upper.addColorStop(1, "#ece2c8");
    ctx.fillStyle = upper;
    ctx.fillRect(0, 0, width, toY(WAIST_LINE_HEIGHT));
    ctx.fillStyle = "#b8875a";
    ctx.fillRect(0, toY(WAIST_LINE_HEIGHT), width, height);
    ctx.fillStyle = "#7a5230";
    ctx.fillRect(
      0,
      toY(WAIST_LINE_HEIGHT + 0.03),
      width,
      toY(WAIST_LINE_HEIGHT) - toY(WAIST_LINE_HEIGHT + 0.03),
    );
    // 床との境の幅木
    ctx.fillStyle = "#5a3b22";
    ctx.fillRect(0, toY(0.08), width, height - toY(0.08));
  });
}

/** 天井: 白い天井板の目地に，細長い蛍光灯（emissiveMap にも使い，蛍光灯だけが光って見えるようにする） */
function createCeilingTexture(): THREE.CanvasTexture {
  const size = 256;
  const texture = canvasTexture(size, size, (ctx) => {
    ctx.fillStyle = "#8a877e";
    ctx.fillRect(0, 0, size, size);
    ctx.fillStyle = "rgba(255, 255, 255, 0.06)";
    ctx.fillRect(0, size / 2 - 1, size, 2);
    ctx.fillRect(size / 2 - 1, 0, 2, size);
    const glow = ctx.createRadialGradient(size / 2, size / 2, 8, size / 2, size / 2, size * 0.45);
    glow.addColorStop(0, "rgba(255, 250, 235, 0.25)");
    glow.addColorStop(1, "rgba(255, 250, 235, 0)");
    ctx.fillStyle = glow;
    ctx.fillRect(0, 0, size, size);
    ctx.fillStyle = "#fffdf4";
    ctx.fillRect(size * 0.2, size * 0.45, size * 0.6, size * 0.1);
  });
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.repeat.set(ROOM_SIZE / CEILING_TILE, ROOM_SIZE / CEILING_TILE);
  return texture;
}

export function createLobbyRoom(): LobbyRoom {
  const root = new THREE.Group();
  root.name = "lobby-room";

  const floorTexture = createFloorTexture();
  const wallTexture = createWallTexture();
  const ceilingTexture = createCeilingTexture();

  const floorGeometry = new THREE.PlaneGeometry(ROOM_SIZE, ROOM_SIZE);
  const floorMaterial = new THREE.MeshLambertMaterial({ map: floorTexture });
  const floor = new THREE.Mesh(floorGeometry, floorMaterial);
  floor.rotation.x = -Math.PI / 2;
  root.add(floor);

  // 内側から見る箱（壁と天井）．BoxGeometry の面の順は +X, -X, +Y（天井）, -Y（床に隠れる）, +Z, -Z
  const wallGeometry = new THREE.BoxGeometry(ROOM_SIZE, ROOM_HEIGHT, ROOM_SIZE);
  const wallMaterial = new THREE.MeshLambertMaterial({
    map: wallTexture,
    side: THREE.BackSide,
  });
  const ceilingMaterial = new THREE.MeshLambertMaterial({
    map: ceilingTexture,
    emissive: 0xffffff,
    emissiveMap: ceilingTexture,
    emissiveIntensity: 0.7,
    side: THREE.BackSide,
  });
  const walls = new THREE.Mesh(wallGeometry, [
    wallMaterial,
    wallMaterial,
    ceilingMaterial,
    wallMaterial,
    wallMaterial,
    wallMaterial,
  ]);
  walls.position.y = ROOM_HEIGHT / 2 + 0.001;
  root.add(walls);

  // 立ち位置の印
  const markGeometry = new THREE.RingGeometry(0.35, 0.45, 48);
  const markMaterial = new THREE.MeshBasicMaterial({ color: 0xff8a3d });
  const mark = new THREE.Mesh(markGeometry, markMaterial);
  mark.rotation.x = -Math.PI / 2;
  mark.position.y = 0.005;
  root.add(mark);

  const props = createLobbyProps({ size: ROOM_SIZE });
  root.add(props.root);

  // 柔らかい環境光（上は少し暖かい白，下は床の木の照り返し）と，天井の照明の代わりの真上からの弱い光
  root.add(new THREE.HemisphereLight(0xfff8ec, 0x6a5a48, 1.5));
  const light = new THREE.DirectionalLight(0xfff6e8, 0.8);
  light.position.set(0.5, 3, 0.8);
  root.add(light);

  return {
    root,
    dispose() {
      for (const g of [floorGeometry, wallGeometry, markGeometry]) g.dispose();
      for (const m of [floorMaterial, wallMaterial, ceilingMaterial, markMaterial]) m.dispose();
      for (const t of [floorTexture, wallTexture, ceilingTexture]) t.dispose();
      props.dispose();
    },
  };
}

export interface PanelContent {
  readonly title: string;
  readonly body: string;
  /** 右上に出す補足（「手順 1 / 4　残り 5 秒」等） */
  readonly caption: string;
}

export interface LobbyPanel {
  readonly object: THREE.Object3D;
  /** 内容が変わった時だけ描き直す */
  show(content: PanelContent): void;
  /** 枠の明るさ（0〜1）．板を正面に捉えている時に明るくする（描き直さず不透明度だけを変える） */
  setHighlight(amount: number): void;
  dispose(): void;
}

const PANEL_WIDTH = 1.6;
const PANEL_HEIGHT = 0.8;
const PANEL_DISTANCE = 2;
/** 板の中心の目の高さからの高さ（m）．目の高さの正面に置く開始ボタンと重ならないよう少し上げる */
const PANEL_RAISE = 0.5;
/** 板の中心の，pivot（目の位置．頭のヨー角に追従する）から見た位置（m）．注視の判定に使う */
export const LOBBY_PANEL_CENTER = { x: 0, y: PANEL_RAISE, z: -PANEL_DISTANCE } as const;
/** 枠の太さ（m） */
const PANEL_FRAME = 0.025;
/** 枠の不透明度（暗い時・明るい時） */
const PANEL_FRAME_OPACITY_MIN = 0.18;
const PANEL_FRAME_OPACITY_MAX = 0.85;
const CANVAS_WIDTH = 1024;
const CANVAS_HEIGHT = 512;

/** 板の余白（px） */
const PANEL_PADDING = 48;

/**
 * 指示の板の文字の枠（canvas の px）と大きさの範囲（px）．枠に収まるまで文字を小さくし，
 * 下限でも収まらなければ行を省いて「…」にする（textFit.ts）
 */
export const PANEL_TEXT_LAYOUT = {
  canvasWidth: CANVAS_WIDTH,
  canvasHeight: CANVAS_HEIGHT,
  /** 右上の補足（「手順 1 / 4　残り 5 秒」等．1 行，右寄せ） */
  caption: {
    box: { x: PANEL_PADDING, y: 28, width: CANVAS_WIDTH - PANEL_PADDING * 2, height: 40 },
    maxFontPx: 32,
    minFontPx: 22,
    maxLines: 1,
  },
  /** 見出し（1 行） */
  title: {
    box: { x: PANEL_PADDING, y: 84, width: CANVAS_WIDTH - PANEL_PADDING * 2, height: 72 },
    maxFontPx: 60,
    minFontPx: 36,
    maxLines: 1,
  },
  /** 本文（改行と幅で折り返す） */
  body: {
    box: {
      x: PANEL_PADDING,
      y: 184,
      width: CANVAS_WIDTH - PANEL_PADDING * 2,
      height: CANVAS_HEIGHT - 184 - 36,
    },
    maxFontPx: 40,
    minFontPx: 26,
    lineHeight: 1.4,
  },
} as const;

/** 目の高さの正面（少し上）に置く指示の板．object を頭のヨー角に合わせて回すと視界の正面に来る */
export function createLobbyPanel(): LobbyPanel {
  const canvas = document.createElement("canvas");
  canvas.width = CANVAS_WIDTH;
  canvas.height = CANVAS_HEIGHT;
  const ctx = canvas.getContext("2d");
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  const geometry = new THREE.PlaneGeometry(PANEL_WIDTH, PANEL_HEIGHT);
  const material = new THREE.MeshBasicMaterial({ map: texture, transparent: true });
  const mesh = new THREE.Mesh(geometry, material);
  mesh.position.set(0, PANEL_RAISE, -PANEL_DISTANCE);

  // 枠は板の後ろに少し大きい板を置いて作る（板の背景が半透明なので，明るくすると板の全体もほのかに明るくなる）
  const frameGeometry = new THREE.PlaneGeometry(
    PANEL_WIDTH + PANEL_FRAME * 2,
    PANEL_HEIGHT + PANEL_FRAME * 2,
  );
  const frameMaterial = new THREE.MeshBasicMaterial({
    color: 0x9cc8ff,
    transparent: true,
    opacity: PANEL_FRAME_OPACITY_MIN,
    depthWrite: false,
  });
  const frame = new THREE.Mesh(frameGeometry, frameMaterial);
  frame.position.set(0, PANEL_RAISE, -PANEL_DISTANCE - 0.005);

  const pivot = new THREE.Group();
  pivot.name = "lobby-panel";
  pivot.position.y = LOBBY_EYE_HEIGHT;
  pivot.add(frame, mesh);

  let last = "";

  return {
    object: pivot,
    show(content) {
      const signature = `${content.title}\n${content.body}\n${content.caption}`;
      if (signature === last || ctx === null) return;
      last = signature;
      ctx.clearRect(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT);
      ctx.fillStyle = "rgba(16, 20, 28, 0.88)";
      ctx.fillRect(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT);

      const { caption, title, body } = PANEL_TEXT_LAYOUT;
      drawFittedText(ctx, content.caption, caption.box, {
        ...caption,
        align: "right",
        color: "#ffd27a",
      });
      drawFittedText(ctx, content.title, title.box, {
        ...title,
        weight: "bold",
        color: "#ffffff",
      });
      drawFittedText(ctx, content.body, body.box, { ...body, color: "#e0e4ec" });
      texture.needsUpdate = true;
    },
    setHighlight(amount) {
      const t = Math.min(1, Math.max(0, Number.isFinite(amount) ? amount : 0));
      frameMaterial.opacity =
        PANEL_FRAME_OPACITY_MIN + (PANEL_FRAME_OPACITY_MAX - PANEL_FRAME_OPACITY_MIN) * t;
    },
    dispose() {
      geometry.dispose();
      material.dispose();
      texture.dispose();
      frameGeometry.dispose();
      frameMaterial.dispose();
    },
  };
}

export interface StartButtonView {
  readonly object: THREE.Object3D;
  /** 進み具合（0〜1）をボタンの周りのリングで示す */
  setProgress(progress: number): void;
  dispose(): void;
}

const BUTTON_RADIUS = 0.06;
const RING_SEGMENTS = 48;

/**
 * 開始ボタン．position は親（指示の板の pivot．目の位置が原点で頭のヨー角に追従する）の座標．
 * 板と一緒に頭の向きへ追従させるため，createLobbyPanel の object に足す
 */
export function createStartButton(position: { x: number; y: number; z: number }): StartButtonView {
  const group = new THREE.Group();
  group.name = "lobby-start-button";
  group.position.set(position.x, position.y, position.z);

  const discGeometry = new THREE.CircleGeometry(BUTTON_RADIUS, 48);
  const discMaterial = new THREE.MeshBasicMaterial({ color: 0xff8a3d });
  const disc = new THREE.Mesh(discGeometry, discMaterial);
  group.add(disc);

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
  group.add(track);

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
  ring.position.z = 0.002;
  ringGeometry.setDrawRange(0, 0);
  group.add(ring);

  return {
    object: group,
    setProgress(progress) {
      const segments = Math.round(Math.min(1, Math.max(0, progress)) * RING_SEGMENTS);
      ringGeometry.setDrawRange(0, segments * 6);
    },
    dispose() {
      for (const g of [discGeometry, trackGeometry, ringGeometry]) g.dispose();
      for (const m of [discMaterial, trackMaterial, ringMaterial]) m.dispose();
    },
  };
}

export interface AlignmentMarker {
  /**
   * rig に足し，毎フレーム quaternion を頭の向き（PlayerInput.head．app/ がカメラに入れるのと同じ値）にすると，
   * カメラに付けた表示として視野の中心に固定される
   */
  readonly object: THREE.Object3D;
  dispose(): void;
}

/**
 * 十字の置き場所（目からの距離，m）．PerspectiveCamera.focus の既定（10）と合わせる．
 * StereoCamera（StereoEffect）は focus の距離で左右の像が重なるため，ここに置いた点は左右それぞれの目の画面の中心に出る．
 * 2 画面でない時は画面の中心に 1 つ出る
 */
const MARKER_DISTANCE = 10;
const MARKER_ARM = 0.6;
const MARKER_THICKNESS = 0.06;

/** 見え方の調整用の十字と円．部屋の壁より奥にあるため，深度を無視して最前面に描く */
export function createAlignmentMarker(): AlignmentMarker {
  const group = new THREE.Group();
  group.name = "lobby-alignment-marker";
  const material = new THREE.MeshBasicMaterial({
    color: 0x3dff8a,
    depthTest: false,
    depthWrite: false,
    side: THREE.DoubleSide,
  });
  const barGeometry = new THREE.PlaneGeometry(MARKER_ARM, MARKER_THICKNESS);
  const ringGeometry = new THREE.RingGeometry(MARKER_ARM * 0.32, MARKER_ARM * 0.32 + 0.04, 48);
  const horizontal = new THREE.Mesh(barGeometry, material);
  const vertical = new THREE.Mesh(barGeometry, material);
  vertical.rotation.z = Math.PI / 2;
  const ring = new THREE.Mesh(ringGeometry, material);
  for (const mesh of [horizontal, vertical, ring]) {
    mesh.position.z = -MARKER_DISTANCE;
    mesh.renderOrder = 1000;
    group.add(mesh);
  }
  return {
    object: group,
    dispose() {
      barGeometry.dispose();
      ringGeometry.dispose();
      material.dispose();
    },
  };
}
