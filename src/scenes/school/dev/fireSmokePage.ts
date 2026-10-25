// 火と煙の確認ページ（src/scenes/school/dev/fireSmoke.html．開発サーバーで直接開く．本番のビルドには入らない）．
// デモの校舎のマス目を簡易な床（種類ごとの色の板）・柱のマスの箱・天井の板で並べ，computeSpread() の結果で createFireSmoke() の火と煙を描く．
// 時刻はスライダーと再生で動かす．一人称の視点（立つ 1.6 m／しゃがむ 0.9 m）と見下ろす視点を切り替えられる．
// ?plan=large で 60 × 34 マス（約 2,000 マス）の廊下だけの校舎にし，更新にかかる時間を確かめる．
// ?plan=smoke で火元から離れた西の廊下に煙の発生源（extraSmokes）を足し，煙だけが広がる様子を確かめる．
// #p=<埋め込みデータ> を付けると，その校舎を URL から読み込む（埋め込んで読み直しても同じ広がりになるかを見る）．
// 同じ場面を見比べるため，?t=<秒>・?at=<x>,<z>（m）・?yaw=<度>・?pitch=<度>・?crouch=1 で始める時刻と視点を決められる．
// 校舎の 3D（#92）とは独立に確かめるため，dev ページの中で three.js を直接使う
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import type { CellKind, SchoolPlan } from "../../../core/schoolPlan";
import { decodePlan, encodePlan } from "../../../share/planCodec";
import { DEMO_SCHOOL } from "../../../share/samples/demoSchool";
import { createFloorFromRows } from "../../../share/samples/floorFromRows";
import { cellCenter, kindAt, worldToCell } from "../../../sim/grid";
import { computeSpread } from "../../../sim/spread";
import { createFireSmoke } from "../fireSmoke";
import {
  FIRE_PARTICLES,
  isEmberParticle,
  SMOKE_CEILING_HEIGHT,
  SMOKE_VOLUME,
} from "../fireSmokeLayout";

/** マスの種類ごとの板の色（routeArrowsPage.ts と同じ） */
const CELL_COLORS: Record<CellKind, number> = {
  void: 0x1a1f26,
  classroom: 0xc9a77c,
  corridor: 0x9aa0a6,
  wall: 0x3a3f45,
  door: 0x8a6a45,
  exit: 0x5b8fd6,
  shutter: 0xd65b5b,
  outdoor: 0x6f8f4f,
};

/** 板どうしの隙間（m）．マスの境目が見えるようにする */
const TILE_GAP = 0.04;

/** 目の高さ（m．床から）．SPEC_01 の立つ・しゃがむに合わせた確認用の値 */
const EYE_STANDING = 1.6;
const EYE_CROUCHING = 0.9;
/** 目の高さが変わる速さ（m/s．scenes/walk/locomotion.ts の EYE_HEIGHT_SPEED と同じ） */
const EYE_SPEED = 2.5;
/** 歩く速さ（m/s） */
const WALK_SPEED = 1.5;

/** 60 × 34 マスの廊下だけの校舎（中央が火元）．更新にかかる時間を確かめるため */
function createLargePlan(): SchoolPlan {
  const width = 60;
  const depth = 34;
  const rows = Array.from({ length: depth }, () => "h".repeat(width));
  return {
    ...DEMO_SCHOOL,
    name: "大きなマス目",
    floors: [createFloorFromRows(1, rows)],
    drill: {
      ...DEMO_SCHOOL.drill,
      fireOrigins: [{ floor: 0, x: 30, z: 17 }],
      start: { floor: 0, x: 26, z: 17 },
      assembly: [],
      route: [],
    },
  };
}

/**
 * デモの校舎に，火元（理科室．シャッターより東）から離れた西の廊下の煙の発生源を足したもの．
 * シャッターより西には火も煙も来ないので，西の廊下・1年1組の煙はすべて発生源から来たもの
 */
function createSmokeSourcePlan(): SchoolPlan {
  return {
    ...DEMO_SCHOOL,
    name: `${DEMO_SCHOOL.name}（西の廊下に煙の発生源）`,
    drill: {
      ...DEMO_SCHOOL.drill,
      spread: {
        ...DEMO_SCHOOL.drill.spread,
        extraSmokes: [{ cell: { floor: 0, x: 8, z: 6 }, atSeconds: 10 }],
      },
    },
  };
}

/** #p= の校舎．無ければ null（読み込めなかった時は理由を画面に出して止める） */
async function planFromHash(): Promise<SchoolPlan | null> {
  const encoded = new URLSearchParams(location.hash.slice(1)).get("p");
  if (encoded === null) return null;
  const decoded = await decodePlan(encoded);
  if (decoded.ok) return decoded.plan;
  document.body.textContent = `#p= の校舎を読み込めません: ${decoded.reason}`;
  throw new Error(decoded.reason);
}

const params = new URLSearchParams(location.search);
const hashPlan = await planFromHash();
const plan =
  hashPlan ??
  (params.get("plan") === "large"
    ? createLargePlan()
    : params.get("plan") === "smoke"
      ? createSmokeSourcePlan()
      : DEMO_SCHOOL);
const floor = plan.floors[0];
const spread = computeSpread(plan);

// スライダーの上限: 制限時間と，最後に煙が着くマスが十分に濃くなる時刻の大きい方
let lastArrival = 0;
for (const t of [...spread.fireSeconds[0], ...spread.smokeSeconds[0]]) {
  if (Number.isFinite(t)) lastArrival = Math.max(lastArrival, t);
}
const maxSeconds = Math.ceil(Math.max(plan.drill.timeLimitSeconds, lastArrival + 25));

const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
document.body.prepend(renderer.domElement);

const scene = new THREE.Scene();
const skyColor = new THREE.Color("#8fb3d9");
scene.background = skyColor;
scene.add(new THREE.HemisphereLight(0xffffff, 0x445566, 2.2));
const sun = new THREE.DirectionalLight(0xffffff, 1.2);
sun.position.set(-3, 10, 6);
scene.add(sun);

// 簡易な校舎: 床の板・柱のマスの箱・天井の板を，それぞれ 1 つの InstancedMesh にする
const cellCount = floor.width * floor.depth;
const tileGeometry = new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2);
const tileMaterial = new THREE.MeshLambertMaterial();
const tiles = new THREE.InstancedMesh(tileGeometry, tileMaterial, cellCount);
const boxGeometry = new THREE.BoxGeometry(1, 1, 1).translate(0, 0.5, 0);
const wallMaterial = new THREE.MeshLambertMaterial({ color: 0xd8d4cc });
const ceilingGeometry = new THREE.PlaneGeometry(1, 1).rotateX(Math.PI / 2);
const ceilingMaterial = new THREE.MeshLambertMaterial({ color: 0xe8e8e2 });
let wallCount = 0;
let ceilingCount = 0;
for (const kind of floor.cells) {
  if (kind === "wall") wallCount++;
  else if (kind !== "outdoor" && kind !== "void") ceilingCount++;
}
const walls = new THREE.InstancedMesh(boxGeometry, wallMaterial, Math.max(1, wallCount));
walls.count = wallCount;
const ceilings = new THREE.InstancedMesh(
  ceilingGeometry,
  ceilingMaterial,
  Math.max(1, ceilingCount),
);
ceilings.count = ceilingCount;
{
  const matrix = new THREE.Matrix4();
  const color = new THREE.Color();
  const size = plan.cellSize - TILE_GAP;
  let w = 0;
  let c = 0;
  for (let z = 0; z < floor.depth; z++) {
    for (let x = 0; x < floor.width; x++) {
      const i = z * floor.width + x;
      const kind = floor.cells[i];
      const center = cellCenter(plan.cellSize, { x, z });
      matrix.makeScale(size, 1, size).setPosition(center.x, 0, center.z);
      tiles.setMatrixAt(i, matrix);
      tiles.setColorAt(i, color.setHex(CELL_COLORS[kind]));
      if (kind === "wall") {
        matrix
          .makeScale(plan.cellSize, SMOKE_CEILING_HEIGHT, plan.cellSize)
          .setPosition(center.x, 0, center.z);
        walls.setMatrixAt(w++, matrix);
      } else if (kind !== "outdoor" && kind !== "void") {
        matrix
          .makeScale(plan.cellSize, 1, plan.cellSize)
          .setPosition(center.x, SMOKE_CEILING_HEIGHT, center.z);
        ceilings.setMatrixAt(c++, matrix);
      }
    }
  }
}
scene.add(tiles, walls, ceilings);

const fireSmoke = createFireSmoke(plan, spread);
scene.add(fireSmoke.object);
// 煙のフォグは空間全体に効くため，呼び出し側（ここ）が scene.fog に付ける
scene.fog = fireSmoke.fog;

// ---- 視点 ----
const centerX = (floor.width * plan.cellSize) / 2;
const centerZ = (floor.depth * plan.cellSize) / 2;
const topCamera = new THREE.PerspectiveCamera(
  50,
  window.innerWidth / window.innerHeight,
  0.05,
  300,
);
topCamera.position.set(centerX, Math.max(floor.width, floor.depth) * 1.1, centerZ + 8);
const controls = new OrbitControls(topCamera, renderer.domElement);
controls.target.set(centerX, 0, centerZ);
controls.update();

const fpCamera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.05, 300);
fpCamera.rotation.order = "YXZ";
/** URL パラメータの数（無い・数でない時は fallback） */
function numberParam(name: string, fallback: number): number {
  const value = Number(params.get(name) ?? Number.NaN);
  return Number.isFinite(value) ? value : fallback;
}
const start = cellCenter(plan.cellSize, plan.drill.start);
const at = (params.get("at") ?? "").split(",").map(Number);
const startCrouching = params.get("crouch") === "1";
const player = {
  x: Number.isFinite(at[0]) && at.length === 2 ? at[0] : start.x,
  z: Number.isFinite(at[1]) && at.length === 2 ? at[1] : start.z,
  eye: startCrouching ? EYE_CROUCHING : EYE_STANDING,
  yaw: THREE.MathUtils.degToRad(numberParam("yaw", 0)),
  pitch: THREE.MathUtils.degToRad(numberParam("pitch", 0)),
  crouching: startCrouching,
};
let emberCount = 0;
for (let i = 0; i < FIRE_PARTICLES.count; i++) if (isEmberParticle(i)) emberCount++;

let firstPerson = params.get("view") !== "top";
controls.enabled = !firstPerson;

const keys = new Set<string>();
window.addEventListener("keydown", (e) => {
  const key = e.key.toLowerCase();
  if (key === "c") toggleCrouch();
  else if (key === "v") toggleView();
  else if (key === " ") togglePlay();
  else keys.add(key);
});
window.addEventListener("keyup", (e) => keys.delete(e.key.toLowerCase()));

// 一人称の視点ではドラッグで向きを変える
let dragging: { x: number; y: number } | null = null;
renderer.domElement.addEventListener("pointerdown", (e) => {
  if (!firstPerson) return;
  dragging = { x: e.clientX, y: e.clientY };
  renderer.domElement.setPointerCapture(e.pointerId);
});
renderer.domElement.addEventListener("pointermove", (e) => {
  if (!firstPerson || dragging === null) return;
  player.yaw -= (e.clientX - dragging.x) * 0.005;
  player.pitch = Math.max(-1.3, Math.min(1.3, player.pitch + (e.clientY - dragging.y) * 0.005));
  dragging = { x: e.clientX, y: e.clientY };
});
renderer.domElement.addEventListener("pointerup", () => {
  dragging = null;
});

/** 柱・何もないマス・マス目の外へは入らない（確認用の簡易な当たり判定．薄い壁は見ない） */
function canStand(x: number, z: number): boolean {
  const cell = worldToCell(plan.cellSize, x, z);
  const kind = kindAt(floor, cell.x, cell.z);
  return kind !== null && kind !== "wall" && kind !== "void";
}

function movePlayer(dt: number): void {
  let forward = 0;
  let right = 0;
  if (keys.has("w")) forward += 1;
  if (keys.has("s")) forward -= 1;
  if (keys.has("d")) right += 1;
  if (keys.has("a")) right -= 1;
  if (forward !== 0 || right !== 0) {
    const len = Math.hypot(forward, right);
    // yaw は three.js の rotation.y と同じ（0 で -Z を向き，正で左へ回る）
    const sin = Math.sin(player.yaw);
    const cos = Math.cos(player.yaw);
    const step = (WALK_SPEED * dt) / len;
    const dx = (-sin * forward + cos * right) * step;
    const dz = (-cos * forward - sin * right) * step;
    if (canStand(player.x + dx, player.z)) player.x += dx;
    if (canStand(player.x, player.z + dz)) player.z += dz;
  }
  const target = player.crouching ? EYE_CROUCHING : EYE_STANDING;
  const eyeStep = EYE_SPEED * dt;
  player.eye += Math.max(-eyeStep, Math.min(eyeStep, target - player.eye));
  fpCamera.position.set(player.x, player.eye, player.z);
  fpCamera.rotation.set(-player.pitch, player.yaw, 0);
}

// ---- 時刻の操作 ----
const playButton = document.getElementById("play") as HTMLButtonElement;
const speedSelect = document.getElementById("speed") as HTMLSelectElement;
const timeSlider = document.getElementById("time") as HTMLInputElement;
const timeLabel = document.getElementById("timeLabel") as HTMLSpanElement;
const viewButton = document.getElementById("view") as HTMLButtonElement;
const crouchButton = document.getElementById("crouch") as HTMLButtonElement;
const info = document.getElementById("info") as HTMLDivElement;
const embedLink = document.getElementById("embed") as HTMLAnchorElement;
const appLink = document.getElementById("app") as HTMLAnchorElement;
{
  // 今の校舎を埋め込んだ URL（この確認ページで読み直す／体験の流れで開く）．?plan= は外し，ほかの値は残す
  const encoded = await encodePlan(plan);
  const search = new URLSearchParams(location.search);
  search.delete("plan");
  const query = search.toString();
  embedLink.href = `${location.pathname}${query === "" ? "" : `?${query}`}#p=${encoded}`;
  appLink.href = `/?app&input=mock#p=${encoded}`;
}
// 検索の部分が同じだと #p= だけが変わって読み直されないため，自分で読み直す
window.addEventListener("hashchange", () => location.reload());
const smokeSourceCount = plan.drill.spread.extraSmokes?.length ?? 0;
timeSlider.max = String(maxSeconds);

let seconds = Math.max(0, Math.min(maxSeconds, numberParam("t", 0)));
timeSlider.value = String(seconds);
let playing = false;
function togglePlay(): void {
  playing = !playing;
  playButton.textContent = playing ? "一時停止" : "再生";
}
function toggleView(): void {
  firstPerson = !firstPerson;
  controls.enabled = !firstPerson;
}
function toggleCrouch(): void {
  player.crouching = !player.crouching;
  crouchButton.textContent = player.crouching ? "立つ（C）" : "しゃがむ（C）";
}
playButton.addEventListener("click", togglePlay);
viewButton.addEventListener("click", toggleView);
crouchButton.addEventListener("click", toggleCrouch);
if (startCrouching) crouchButton.textContent = "立つ（C）";
timeSlider.addEventListener("input", () => {
  seconds = Number(timeSlider.value);
});

window.addEventListener("resize", () => {
  for (const camera of [topCamera, fpCamera]) {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
  }
  renderer.setSize(window.innerWidth, window.innerHeight);
});

// ---- 計測（fps と update の時間．1 秒ごとに平均・最大を出す） ----
let frames = 0;
let updateTotal = 0;
let updateMax = 0;
let windowStart = performance.now();
let fps = 0;
let updateAvg = 0;
let updatePeak = 0;
let last = performance.now();
/** 前のフレームの描画の回数（renderer.info は render のたびに数え直す） */
let drawCalls = 0;

renderer.setAnimationLoop(() => {
  const now = performance.now();
  const dt = Math.min(0.1, (now - last) / 1000);
  last = now;

  if (playing) {
    seconds = Math.min(maxSeconds, seconds + dt * Number(speedSelect.value));
    if (seconds >= maxSeconds) togglePlay();
    timeSlider.value = String(seconds);
  }
  if (firstPerson) movePlayer(dt);

  const t0 = performance.now();
  fireSmoke.update(seconds, firstPerson ? fpCamera.position : null);
  const spent = performance.now() - t0;
  updateTotal += spent;
  updateMax = Math.max(updateMax, spent);
  frames++;
  if (now - windowStart >= 1000) {
    fps = (frames * 1000) / (now - windowStart);
    updateAvg = updateTotal / frames;
    updatePeak = updateMax;
    frames = 0;
    updateTotal = 0;
    updateMax = 0;
    windowStart = now;
  }

  // 見下ろす視点では天井を隠し，フォグを外して全体の広がりを見る
  ceilings.visible = firstPerson;
  scene.fog = firstPerson ? fireSmoke.fog : null;
  if (!firstPerson) controls.update();

  const s = fireSmoke.stats;
  timeLabel.textContent = `${seconds.toFixed(1)} / ${maxSeconds} 秒`;
  info.textContent = [
    `${plan.name}（${floor.width} × ${floor.depth} マス．火の対象 ${fireSmoke.cells.fire.length}・煙の対象 ${fireSmoke.cells.smoke.length}）`,
    `校舎: ${hashPlan === null ? "同梱" : "#p= から読み込み"}・煙の発生源: ${smokeSourceCount}`,
    `炎の粒: ${FIRE_PARTICLES.count} 個（うち火の粉 ${emberCount}）・煙: 視線に垂直な板 ${SMOKE_VOLUME.sliceCount} 枚（描画はそれぞれ 1 回）`,
    `fps: ${fps.toFixed(0)}・update: 平均 ${updateAvg.toFixed(3)} ms／最大 ${updatePeak.toFixed(3)} ms・描画: ${drawCalls} 回（簡易な校舎の 3 回を含む）`,
    `時刻: ${seconds.toFixed(1)} 秒・燃えているマス: ${s.burningCells}・煙のあるマス: ${s.smokyCells}`,
    firstPerson
      ? `目の高さ: ${player.eye.toFixed(2)} m（${player.crouching ? "しゃがむ" : "立つ"}）・目の位置の煙: ${s.eyeSmoke.toFixed(2)}・フォグ: ${s.fogDensity.toFixed(3)} /m`
      : "見下ろす視点（フォグなし．天井を隠す）",
    firstPerson
      ? "WASD: 動く・ドラッグ: 向き・C: しゃがむ・V: 視点・Space: 再生"
      : "ドラッグ: 回す・ホイール: 寄る・右ドラッグ: 動かす・V: 視点・Space: 再生",
  ].join("\n");

  renderer.render(scene, firstPerson ? fpCamera : topCamera);
  drawCalls = renderer.info.render.calls;
});

// HMR で読み直す時に作った物を解放する（dispose() の確認も兼ねる）
import.meta.hot?.dispose(() => {
  renderer.setAnimationLoop(null);
  controls.dispose();
  scene.fog = null;
  fireSmoke.dispose();
  tileGeometry.dispose();
  tileMaterial.dispose();
  tiles.dispose();
  boxGeometry.dispose();
  wallMaterial.dispose();
  walls.dispose();
  ceilingGeometry.dispose();
  ceilingMaterial.dispose();
  ceilings.dispose();
  renderer.dispose();
  renderer.domElement.remove();
});
