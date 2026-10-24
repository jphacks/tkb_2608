// ロビーの部屋（学校の防災学習室）に置く物．黒板・時計・扉と非常口の誘導灯・消火器・避難経路図・掲示板・机と椅子．
// 模様や文字はすべて CanvasTexture でコードから描く（外部ファイルを足さない）．
// iPhone の 2 画面表示で 30 fps を保つため，ライトは足さず（誘導灯は光の計算をしない MeshBasicMaterial で光って見せる），
// 机と椅子は単位立方体 1 つを共有した InstancedMesh 2 つ（木・金属）にまとめる

import * as THREE from "three";
import { fillTextFitted } from "./canvasText";

/** 描いた canvas をテクスチャにする（色の canvas なので sRGB として扱う） */
export function canvasTexture(
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

/** 模様のばらつき用の決まった乱数（毎回同じ見た目にする．線形合同法） */
export function seededRandom(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

/** 部屋の大きさ（lobbyRoom.ts と同じ値を受け取る） */
export interface RoomBounds {
  /** 部屋の幅と奥行き（m） */
  readonly size: number;
}

export interface LobbyProps {
  readonly root: THREE.Group;
  dispose(): void;
}

/** 壁から浮かせる距離（m）．壁と同じ面に置くとちらつくため */
const WALL_GAP = 0.012;

// ---- テクスチャ ----

/** 黒板（緑の板に木の枠，チョークの文字） */
function drawBlackboard(ctx: CanvasRenderingContext2D, w: number, h: number): void {
  ctx.fillStyle = "#7a5230";
  ctx.fillRect(0, 0, w, h);
  const board = ctx.createLinearGradient(0, 0, w, h);
  board.addColorStop(0, "#2f5240");
  board.addColorStop(1, "#264536");
  ctx.fillStyle = board;
  ctx.fillRect(18, 18, w - 36, h - 36);
  // チョークの粉のにじみ
  const rand = seededRandom(7);
  ctx.fillStyle = "rgba(255, 255, 255, 0.035)";
  for (let i = 0; i < 40; i++) {
    ctx.beginPath();
    ctx.ellipse(rand() * w, rand() * h, 30 + rand() * 60, 8 + rand() * 14, 0, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.fillStyle = "rgba(250, 250, 240, 0.9)";
  ctx.textAlign = "left";
  fillTextFitted(ctx, "防災学習室", 60, 100, w - 260, 60, "bold");
  fillTextFitted(ctx, "今日のめあて", 60, 190, w - 120, 38);
  ctx.fillStyle = "rgba(255, 236, 140, 0.9)";
  fillTextFitted(ctx, "火事のときの　にげ方を　身につけよう", 60, 260, w - 120, 44);
  ctx.fillStyle = "rgba(250, 250, 240, 0.85)";
  ctx.textAlign = "right";
  fillTextFitted(ctx, "日直", w - 60, 100, 120, 32);
  ctx.textAlign = "left";
  // チョーク受け
  ctx.fillStyle = "#5e3f25";
  ctx.fillRect(18, h - 30, w - 36, 12);
}

/** 掛け時計の文字盤（10 時 10 分） */
function drawClock(ctx: CanvasRenderingContext2D, size: number): void {
  const c = size / 2;
  ctx.fillStyle = "#3a3a3a";
  ctx.beginPath();
  ctx.arc(c, c, c, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = "#fbfaf6";
  ctx.beginPath();
  ctx.arc(c, c, c - 12, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = "#222";
  for (let i = 0; i < 12; i++) {
    const a = (i / 12) * Math.PI * 2;
    ctx.lineWidth = i % 3 === 0 ? 8 : 4;
    ctx.beginPath();
    ctx.moveTo(c + Math.sin(a) * (c - 22), c - Math.cos(a) * (c - 22));
    ctx.lineTo(c + Math.sin(a) * (c - 42), c - Math.cos(a) * (c - 42));
    ctx.stroke();
  }
  const hand = (angle: number, length: number, width: number): void => {
    ctx.lineWidth = width;
    ctx.lineCap = "round";
    ctx.beginPath();
    ctx.moveTo(c, c);
    ctx.lineTo(c + Math.sin(angle) * length, c - Math.cos(angle) * length);
    ctx.stroke();
  };
  hand(((10 + 10 / 60) / 12) * Math.PI * 2, c * 0.5, 10);
  hand((10 / 60) * Math.PI * 2, c * 0.75, 6);
}

/** 教室の引き戸（木の戸に窓） */
function drawDoor(ctx: CanvasRenderingContext2D, w: number, h: number): void {
  ctx.fillStyle = "#6e4a2a";
  ctx.fillRect(0, 0, w, h);
  ctx.fillStyle = "#c49a6c";
  ctx.fillRect(14, 14, w - 28, h - 14);
  ctx.fillStyle = "#a9c3cf";
  ctx.fillRect(40, 50, w - 80, 170);
  ctx.fillStyle = "#c49a6c";
  ctx.fillRect(w / 2 - 4, 50, 8, 170);
  ctx.fillStyle = "#4a3320";
  ctx.fillRect(w - 52, h * 0.52, 14, 60);
}

/** 非常口の誘導灯（緑の地に白い人の形と扉．文字は「非常口」「EXIT」） */
function drawExitSign(ctx: CanvasRenderingContext2D, w: number, h: number): void {
  ctx.fillStyle = "#f4f7f2";
  ctx.fillRect(0, 0, w, h);
  ctx.fillStyle = "#0fa04b";
  ctx.fillRect(8, 8, w - 16, h - 16);
  // 扉（白い枠に緑の開口）
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(28, 22, 70, h - 44);
  ctx.fillStyle = "#0fa04b";
  ctx.fillRect(38, 32, 50, h - 64);
  // 扉へ走る人（棒の人形）
  ctx.strokeStyle = "#ffffff";
  ctx.fillStyle = "#ffffff";
  ctx.lineWidth = 11;
  ctx.lineCap = "round";
  ctx.beginPath();
  ctx.arc(150, 46, 14, 0, Math.PI * 2);
  ctx.fill();
  ctx.beginPath();
  ctx.moveTo(140, 66);
  ctx.lineTo(128, 108);
  ctx.moveTo(140, 70);
  ctx.lineTo(112, 84);
  ctx.moveTo(140, 70);
  ctx.lineTo(166, 92);
  ctx.moveTo(128, 108);
  ctx.lineTo(106, 140);
  ctx.moveTo(128, 108);
  ctx.lineTo(160, 132);
  ctx.stroke();
  ctx.textAlign = "left";
  fillTextFitted(ctx, "非常口", 200, 92, w - 224, 62, "bold");
  fillTextFitted(ctx, "EXIT", 204, 140, w - 228, 34, "bold");
}

/** 消火器の場所を示す赤い札 */
function drawExtinguisherLabel(ctx: CanvasRenderingContext2D, w: number, h: number): void {
  ctx.fillStyle = "#d7261e";
  ctx.fillRect(0, 0, w, h);
  ctx.fillStyle = "#ffffff";
  ctx.textAlign = "center";
  fillTextFitted(ctx, "消火器", w / 2, h / 2 + 22, w - 24, 64, "bold");
}

/** 避難経路図（廊下と教室の簡単な間取りに，現在地と出口までの緑の矢印） */
function drawRouteMap(ctx: CanvasRenderingContext2D, w: number, h: number): void {
  ctx.fillStyle = "#3b3b3b";
  ctx.fillRect(0, 0, w, h);
  ctx.fillStyle = "#fbfbf7";
  ctx.fillRect(8, 8, w - 16, h - 16);
  ctx.fillStyle = "#1f2a44";
  ctx.textAlign = "left";
  fillTextFitted(ctx, "避難経路図", 28, 52, w - 56, 36, "bold");

  const top = 80;
  const roomH = 90;
  const corridorY = top + roomH;
  const corridorH = 50;
  // 教室（上の列）
  const rooms = ["1組", "2組", "防災学習室", "3組"];
  const roomW = (w - 160) / rooms.length;
  ctx.textAlign = "center";
  rooms.forEach((name, i) => {
    const x = 28 + i * roomW;
    const here = i === 2;
    ctx.fillStyle = here ? "#ffe9a8" : "#e4e8ee";
    ctx.fillRect(x, top, roomW - 6, roomH);
    ctx.strokeStyle = "#555";
    ctx.lineWidth = 2;
    ctx.strokeRect(x, top, roomW - 6, roomH);
    ctx.fillStyle = "#222";
    fillTextFitted(ctx, name, x + (roomW - 6) / 2, top + 34, roomW - 14, 22);
  });
  // 廊下
  ctx.fillStyle = "#cfd4da";
  ctx.fillRect(28, corridorY + 6, w - 56, corridorH);
  // 出口（右端）
  ctx.fillStyle = "#0fa04b";
  ctx.fillRect(w - 120, top, 92, roomH);
  ctx.fillStyle = "#ffffff";
  fillTextFitted(ctx, "出口", w - 74, top + 55, 80, 26, "bold");
  // 現在地
  const hereX = 28 + 2 * roomW + (roomW - 6) / 2;
  ctx.fillStyle = "#e0251b";
  ctx.beginPath();
  ctx.arc(hereX, top + 64, 11, 0, Math.PI * 2);
  ctx.fill();
  // 矢印（現在地 → 廊下 → 出口）
  ctx.strokeStyle = "#0fa04b";
  ctx.fillStyle = "#0fa04b";
  ctx.lineWidth = 9;
  ctx.lineCap = "round";
  ctx.beginPath();
  const midY = corridorY + 6 + corridorH / 2;
  ctx.moveTo(hereX, top + 78);
  ctx.lineTo(hereX, midY);
  ctx.lineTo(w - 150, midY);
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(w - 128, midY);
  ctx.lineTo(w - 154, midY - 18);
  ctx.lineTo(w - 154, midY + 18);
  ctx.closePath();
  ctx.fill();
  // 凡例
  const legendY = h - 40;
  ctx.textAlign = "left";
  ctx.fillStyle = "#e0251b";
  ctx.beginPath();
  ctx.arc(40, legendY - 8, 9, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = "#222";
  fillTextFitted(ctx, "現在地", 56, legendY, 94, 22);
  ctx.fillStyle = "#0fa04b";
  ctx.fillRect(160, legendY - 13, 40, 9);
  ctx.fillStyle = "#222";
  fillTextFitted(ctx, "避難経路", 210, legendY, 110, 22);
  ctx.fillStyle = "#d7261e";
  ctx.fillRect(330, legendY - 20, 16, 16);
  ctx.fillStyle = "#222";
  fillTextFitted(ctx, "消火器", 354, legendY, w - 374, 22);
  ctx.fillStyle = "#d7261e";
  ctx.fillRect(hereX + 50, corridorY + 14, 14, 14);
}

/** 紙を貼る（白い紙に色の見出しの帯と，行ごとの文） */
function drawPoster(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  paper: string,
  header: string,
  title: string,
  lines: readonly string[],
): void {
  ctx.fillStyle = "rgba(0, 0, 0, 0.18)";
  ctx.fillRect(x + 6, y + 6, w, h);
  ctx.fillStyle = paper;
  ctx.fillRect(x, y, w, h);
  ctx.fillStyle = header;
  ctx.fillRect(x, y, w, 64);
  ctx.fillStyle = "#ffffff";
  ctx.textAlign = "center";
  fillTextFitted(ctx, title, x + w / 2, y + 46, w - 20, 36, "bold");
  ctx.fillStyle = "#222";
  ctx.textAlign = "left";
  lines.forEach((line, i) => {
    fillTextFitted(ctx, line, x + 22, y + 110 + i * 44, w - 44, 28);
  });
  // 画びょう
  for (const px of [x + 16, x + w - 16]) {
    ctx.fillStyle = "#d33";
    ctx.beginPath();
    ctx.arc(px, y + 12, 7, 0, Math.PI * 2);
    ctx.fill();
  }
}

/** 掲示板（コルクの板に防災のポスターを貼る） */
function drawBulletinBoard(ctx: CanvasRenderingContext2D, w: number, h: number): void {
  ctx.fillStyle = "#6e4a2a";
  ctx.fillRect(0, 0, w, h);
  ctx.fillStyle = "#b98552";
  ctx.fillRect(16, 16, w - 32, h - 32);
  const rand = seededRandom(11);
  for (let i = 0; i < 900; i++) {
    ctx.fillStyle = rand() < 0.5 ? "rgba(90, 55, 25, 0.25)" : "rgba(230, 190, 140, 0.25)";
    ctx.fillRect(16 + rand() * (w - 34), 16 + rand() * (h - 34), 3, 3);
  }
  drawPoster(ctx, 50, 50, 290, 360, "#ffffff", "#d7261e", "おはしも", [
    "お　おさない",
    "は　はしらない",
    "し　しゃべらない",
    "も　もどらない",
  ]);
  drawPoster(ctx, 380, 50, 290, 360, "#fff8dc", "#e07b1a", "けむりが出たら", [
    "ひくい しせいで",
    "ハンカチで",
    "口と鼻を おおう",
    "火に 近づかない",
  ]);
  drawPoster(ctx, 710, 80, 270, 250, "#e6f2ff", "#2a62b8", "避難訓練", [
    "非常ベルが",
    "鳴ったら",
    "落ち着いて にげる",
  ]);
}

// ---- 物の組み立て ----

export function createLobbyProps(bounds: RoomBounds): LobbyProps {
  const root = new THREE.Group();
  root.name = "lobby-props";
  const half = bounds.size / 2;
  const geometries: THREE.BufferGeometry[] = [];
  const materials: THREE.Material[] = [];
  const textures: THREE.Texture[] = [];

  // 壁に貼る板は 1 枚の平面を共有し，scale で大きさを変える
  const plane = new THREE.PlaneGeometry(1, 1);
  geometries.push(plane);

  /**
   * 壁に貼る板．wall は貼る壁（front = -Z，back = +Z，left = -X，right = +X），
   * along は壁に沿った位置（m．front・back は x，left・right は z）
   */
  const addBoard = (
    name: string,
    texture: THREE.Texture,
    wall: "front" | "back" | "left" | "right",
    along: number,
    y: number,
    width: number,
    height: number,
    glow = false,
  ): THREE.Mesh => {
    textures.push(texture);
    const material = glow
      ? new THREE.MeshBasicMaterial({ map: texture })
      : new THREE.MeshLambertMaterial({ map: texture });
    materials.push(material);
    const mesh = new THREE.Mesh(plane, material);
    mesh.name = name;
    mesh.scale.set(width, height, 1);
    const d = half - WALL_GAP;
    switch (wall) {
      case "front":
        mesh.position.set(along, y, -d);
        break;
      case "back":
        mesh.position.set(along, y, d);
        mesh.rotation.y = Math.PI;
        break;
      case "left":
        mesh.position.set(-d, y, along);
        mesh.rotation.y = Math.PI / 2;
        break;
      case "right":
        mesh.position.set(d, y, along);
        mesh.rotation.y = -Math.PI / 2;
        break;
    }
    root.add(mesh);
    return mesh;
  };

  // 正面の壁: 黒板と，その上の時計（指示の板は目の前 2 m にあり，黒板はその奥）
  addBoard(
    "blackboard",
    canvasTexture(1024, 384, (c) => drawBlackboard(c, 1024, 384)),
    "front",
    0,
    1.45,
    3.2,
    1.2,
  );
  const clockTexture = canvasTexture(256, 256, (c) => drawClock(c, 256));
  textures.push(clockTexture);
  const clockGeometry = new THREE.CircleGeometry(0.18, 32);
  geometries.push(clockGeometry);
  const clockMaterial = new THREE.MeshLambertMaterial({ map: clockTexture });
  materials.push(clockMaterial);
  const clock = new THREE.Mesh(clockGeometry, clockMaterial);
  clock.name = "clock";
  clock.position.set(0, 2.5, -half + WALL_GAP);
  root.add(clock);

  // 右の壁: 引き戸と，その上の非常口の誘導灯．戸の手前の壁際に消火器
  const doorZ = -2.6;
  addBoard(
    "door",
    canvasTexture(256, 512, (c) => drawDoor(c, 256, 512)),
    "right",
    doorZ,
    1.0,
    0.9,
    2.0,
  );
  addBoard(
    "exit-sign",
    canvasTexture(512, 170, (c) => drawExitSign(c, 512, 170)),
    "right",
    doorZ,
    2.32,
    0.6,
    0.2,
    true,
  );
  const extinguisherZ = -1.3;
  addBoard(
    "extinguisher-label",
    canvasTexture(256, 100, (c) => drawExtinguisherLabel(c, 256, 100)),
    "right",
    extinguisherZ,
    0.95,
    0.3,
    0.12,
  );
  const extinguisherBodyGeometry = new THREE.CylinderGeometry(0.08, 0.08, 0.48, 12);
  const extinguisherTopGeometry = new THREE.CylinderGeometry(0.03, 0.04, 0.1, 8);
  geometries.push(extinguisherBodyGeometry, extinguisherTopGeometry);
  const redMaterial = new THREE.MeshLambertMaterial({ color: 0xd2231b });
  const blackMaterial = new THREE.MeshLambertMaterial({ color: 0x222222 });
  materials.push(redMaterial, blackMaterial);
  const extinguisherX = half - 0.2;
  const extinguisherBody = new THREE.Mesh(extinguisherBodyGeometry, redMaterial);
  extinguisherBody.name = "extinguisher";
  extinguisherBody.position.set(extinguisherX, 0.26, extinguisherZ);
  const extinguisherTop = new THREE.Mesh(extinguisherTopGeometry, blackMaterial);
  extinguisherTop.name = "extinguisher-top";
  extinguisherTop.position.set(extinguisherX, 0.55, extinguisherZ);
  root.add(extinguisherBody, extinguisherTop);

  // 左の壁: 避難経路図
  addBoard(
    "route-map",
    canvasTexture(512, 360, (c) => drawRouteMap(c, 512, 360)),
    "left",
    -1.2,
    1.55,
    1.2,
    0.85,
  );

  // 後ろの壁: 防災のポスターを貼った掲示板
  addBoard(
    "bulletin-board",
    canvasTexture(1024, 470, (c) => drawBulletinBoard(c, 1024, 470)),
    "back",
    0.8,
    1.5,
    2.4,
    1.1,
  );

  // 机と椅子（後ろの左に 2 × 2 組と，正面の教卓）．目の高さより十分低く，指示の板の視線をさえぎらない
  const box = new THREE.BoxGeometry(1, 1, 1);
  geometries.push(box);
  const woodMaterial = new THREE.MeshLambertMaterial({ color: 0xc89a64 });
  const metalMaterial = new THREE.MeshLambertMaterial({ color: 0x8a9099 });
  materials.push(woodMaterial, metalMaterial);
  const wood: THREE.Matrix4[] = [];
  const metal: THREE.Matrix4[] = [];
  const position = new THREE.Vector3();
  const scale = new THREE.Vector3();
  const rotation = new THREE.Quaternion();
  const part = (
    list: THREE.Matrix4[],
    x: number,
    y: number,
    z: number,
    sx: number,
    sy: number,
    sz: number,
  ): void => {
    list.push(new THREE.Matrix4().compose(position.set(x, y, z), rotation, scale.set(sx, sy, sz)));
  };
  for (const cx of [-2.8, -1.8]) {
    for (const cz of [1.8, 2.9]) {
      // 机: 天板と左右の脚
      part(wood, cx, 0.7, cz, 0.65, 0.03, 0.45);
      part(metal, cx - 0.3, 0.345, cz, 0.03, 0.69, 0.4);
      part(metal, cx + 0.3, 0.345, cz, 0.03, 0.69, 0.4);
      // 椅子: 座面・背もたれと左右の脚
      part(wood, cx, 0.42, cz + 0.42, 0.38, 0.025, 0.36);
      part(wood, cx, 0.72, cz + 0.6, 0.38, 0.22, 0.02);
      part(metal, cx - 0.18, 0.3, cz + 0.45, 0.025, 0.6, 0.32);
      part(metal, cx + 0.18, 0.3, cz + 0.45, 0.025, 0.6, 0.32);
    }
  }
  // 教卓（黒板の前．指示の板（目の前 2 m）より奥に置く）
  part(wood, 0, 0.475, -half + 0.75, 1.2, 0.95, 0.55);
  const addInstanced = (name: string, material: THREE.Material, list: THREE.Matrix4[]): void => {
    const mesh = new THREE.InstancedMesh(box, material, list.length);
    mesh.name = name;
    list.forEach((m, i) => {
      mesh.setMatrixAt(i, m);
    });
    mesh.instanceMatrix.needsUpdate = true;
    root.add(mesh);
  };
  addInstanced("furniture-wood", woodMaterial, wood);
  addInstanced("furniture-metal", metalMaterial, metal);

  return {
    root,
    dispose() {
      for (const g of geometries) g.dispose();
      for (const m of materials) m.dispose();
      for (const t of textures) t.dispose();
      for (const child of root.children) {
        if (child instanceof THREE.InstancedMesh) child.dispose();
      }
    },
  };
}
