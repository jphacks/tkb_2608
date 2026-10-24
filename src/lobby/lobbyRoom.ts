// ロビーの簡単な部屋（訓練施設の体験室のような床・壁・天井・照明と立ち位置の印）と，指示を出す板．
// 模様はすべて CanvasTexture でコードから描く（外部ファイルを足さない）．影は使わず，ライトは 2 つに抑える

import * as THREE from "three";

/** 目の高さ（m）．rig の位置を目の位置として扱う（scenes/ の startPosition と同じ） */
export const LOBBY_EYE_HEIGHT = 1.6;

/** 部屋の幅と奥行き（m） */
const ROOM_SIZE = 8;
/** 天井の高さ（m） */
const ROOM_HEIGHT = 3;
/** 床のグリッドの 1 マス（m） */
const FLOOR_TILE = 1;
/** 壁の腰の高さのライン（m） */
const WAIST_LINE_HEIGHT = 0.9;
/** 天井の照明パネルの並び（1 枚のテクスチャの繰り返しの長さ，m） */
const CEILING_TILE = 2;

export interface LobbyRoom {
  readonly root: THREE.Group;
  dispose(): void;
}

/** 描いた canvas をテクスチャにする（色の canvas なので sRGB として扱う） */
function canvasTexture(
  width: number,
  height: number,
  draw: (ctx: CanvasRenderingContext2D) => void,
): THREE.CanvasTexture {
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  if (ctx !== null) draw(ctx);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

/** 床: 灰色の床に，1 m ごとの薄いグリッドと 0.5 m ごとのさらに薄い線（立ち位置の距離感をつかむため） */
function createFloorTexture(): THREE.CanvasTexture {
  const size = 256;
  const texture = canvasTexture(size, size, (ctx) => {
    ctx.fillStyle = "#4a515c";
    ctx.fillRect(0, 0, size, size);
    ctx.fillStyle = "rgba(200, 215, 235, 0.10)";
    ctx.fillRect(size / 2 - 1, 0, 2, size);
    ctx.fillRect(0, size / 2 - 1, size, 2);
    ctx.fillStyle = "rgba(200, 215, 235, 0.32)";
    ctx.fillRect(0, 0, 3, size);
    ctx.fillRect(0, 0, size, 3);
  });
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  // ROOM_SIZE が FLOOR_TILE の偶数倍なので，床の中心（立ち位置）にグリッドの交点が来る
  texture.repeat.set(ROOM_SIZE / FLOOR_TILE, ROOM_SIZE / FLOOR_TILE);
  return texture;
}

/** 壁: 腰の高さより下は紺の腰壁，境目に明るいライン，上は灰色（上ほど少し明るい）．縦方向だけに模様がある */
function createWallTexture(): THREE.CanvasTexture {
  const width = 8;
  const height = 512;
  const toY = (meters: number): number => height * (1 - meters / ROOM_HEIGHT);
  return canvasTexture(width, height, (ctx) => {
    const upper = ctx.createLinearGradient(0, 0, 0, toY(WAIST_LINE_HEIGHT));
    upper.addColorStop(0, "#c3cad4");
    upper.addColorStop(1, "#9aa3b0");
    ctx.fillStyle = upper;
    ctx.fillRect(0, 0, width, toY(WAIST_LINE_HEIGHT));
    ctx.fillStyle = "#24334a";
    ctx.fillRect(0, toY(WAIST_LINE_HEIGHT), width, height);
    ctx.fillStyle = "#8fb4dc";
    ctx.fillRect(
      0,
      toY(WAIST_LINE_HEIGHT + 0.03),
      width,
      toY(WAIST_LINE_HEIGHT) - toY(WAIST_LINE_HEIGHT + 0.03),
    );
    // 床との境の幅木
    ctx.fillStyle = "#1a2433";
    ctx.fillRect(0, toY(0.08), width, height - toY(0.08));
  });
}

/** 天井: 灰色の天井に，柔らかく光る照明パネル（emissiveMap にも使い，パネルだけが光って見えるようにする） */
function createCeilingTexture(): THREE.CanvasTexture {
  const size = 256;
  const texture = canvasTexture(size, size, (ctx) => {
    ctx.fillStyle = "#2c323b";
    ctx.fillRect(0, 0, size, size);
    const glow = ctx.createRadialGradient(size / 2, size / 2, 8, size / 2, size / 2, size * 0.45);
    glow.addColorStop(0, "rgba(220, 232, 250, 0.35)");
    glow.addColorStop(1, "rgba(220, 232, 250, 0)");
    ctx.fillStyle = glow;
    ctx.fillRect(0, 0, size, size);
    ctx.fillStyle = "#eef4ff";
    ctx.fillRect(size * 0.3, size * 0.38, size * 0.4, size * 0.24);
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
  const floorMaterial = new THREE.MeshStandardMaterial({ map: floorTexture, roughness: 0.85 });
  const floor = new THREE.Mesh(floorGeometry, floorMaterial);
  floor.rotation.x = -Math.PI / 2;
  root.add(floor);

  // 内側から見る箱（壁と天井）．BoxGeometry の面の順は +X, -X, +Y（天井）, -Y（床に隠れる）, +Z, -Z
  const wallGeometry = new THREE.BoxGeometry(ROOM_SIZE, ROOM_HEIGHT, ROOM_SIZE);
  const wallMaterial = new THREE.MeshStandardMaterial({
    map: wallTexture,
    roughness: 1,
    side: THREE.BackSide,
  });
  const ceilingMaterial = new THREE.MeshStandardMaterial({
    map: ceilingTexture,
    emissive: 0xffffff,
    emissiveMap: ceilingTexture,
    emissiveIntensity: 0.6,
    roughness: 1,
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

  // 柔らかい環境光（上は少し青白く，下は落ち着いた灰）と，天井の照明の代わりの真上からの弱い光
  root.add(new THREE.HemisphereLight(0xe4ecf8, 0x3a4250, 1.5));
  const light = new THREE.DirectionalLight(0xf2f6ff, 0.8);
  light.position.set(0.5, 3, 0.8);
  root.add(light);

  return {
    root,
    dispose() {
      for (const g of [floorGeometry, wallGeometry, markGeometry]) g.dispose();
      for (const m of [floorMaterial, wallMaterial, ceilingMaterial, markMaterial]) m.dispose();
      for (const t of [floorTexture, wallTexture, ceilingTexture]) t.dispose();
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

/** 文字を幅に合わせて折り返す（日本語のため 1 文字ずつ測る） */
function wrapText(ctx: CanvasRenderingContext2D, text: string, maxWidth: number): string[] {
  const lines: string[] = [];
  let line = "";
  for (const ch of text) {
    if (ctx.measureText(line + ch).width > maxWidth && line !== "") {
      lines.push(line);
      line = ch;
    } else {
      line += ch;
    }
  }
  if (line !== "") lines.push(line);
  return lines;
}

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

      ctx.fillStyle = "#ffd27a";
      ctx.font = "32px sans-serif";
      ctx.textAlign = "right";
      ctx.fillText(content.caption, CANVAS_WIDTH - 40, 64);

      ctx.textAlign = "left";
      ctx.fillStyle = "#ffffff";
      ctx.font = "bold 60px sans-serif";
      ctx.fillText(content.title, 48, 150);

      ctx.font = "40px sans-serif";
      ctx.fillStyle = "#e0e4ec";
      const lines = wrapText(ctx, content.body, CANVAS_WIDTH - 96);
      lines.slice(0, 5).forEach((text, i) => {
        ctx.fillText(text, 48, 240 + i * 56);
      });
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
