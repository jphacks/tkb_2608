// 床の正解経路の矢印の確認ページ（src/scenes/school/dev/routeArrows.html．開発サーバーで直接開く．本番のビルドには入らない）．
// デモの校舎のマス目を種類ごとの色の平らな板で並べ，その上に createRouteArrows() の矢印を出す．
// ?mode=test でテストモード（矢印なし），?route=broken で異常な経路（重複・飛び・存在しない階・マス目の外）を試す．
// 校舎の 3D（#92）とは独立に確かめるため，dev ページの中で three.js を直接使う
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import type { CellKind, CellRef, SchoolPlan } from "../../../core/schoolPlan";
import { DEMO_SCHOOL } from "../../../share/samples/demoSchool";
import { cellCenter } from "../../../sim/grid";
import { createRouteArrows } from "../routeArrows";
import { FLOOR_HEIGHT } from "../routeArrowsLayout";

/** マスの種類ごとの板の色（エディタの見た目に近い淡い色．矢印の緑と紛れない色にする） */
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

function brokenRoute(route: readonly CellRef[]): CellRef[] {
  const r = route;
  return [
    r[0],
    r[1],
    r[2],
    r[2], // 同じマスの重複
    r[3],
    r[4],
    { floor: 9, x: 4, z: 5 }, // 存在しない階
    r[5],
    r[6],
    r[8], // r[7] を抜いた飛び（隣り合わない）
    r[9],
    { floor: 0, x: 99, z: 99 }, // マス目の外
    ...r.slice(10),
  ];
}

const params = new URLSearchParams(location.search);
const mode = params.get("mode") === "test" ? "test" : "learn";
const route =
  params.get("route") === "broken" ? brokenRoute(DEMO_SCHOOL.drill.route) : DEMO_SCHOOL.drill.route;
const plan: SchoolPlan = { ...DEMO_SCHOOL, drill: { ...DEMO_SCHOOL.drill, mode, route } };

const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
document.body.prepend(renderer.domElement);

const scene = new THREE.Scene();
scene.background = new THREE.Color("#101820");

// 簡易な床: 全マスを 1 つの InstancedMesh の板にする（光源なしで見える MeshBasicMaterial）
const floor = plan.floors[0];
const tileGeometry = new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2);
const tileMaterial = new THREE.MeshBasicMaterial();
const tiles = new THREE.InstancedMesh(tileGeometry, tileMaterial, floor.width * floor.depth);
{
  const matrix = new THREE.Matrix4();
  const color = new THREE.Color();
  const size = plan.cellSize - TILE_GAP;
  const y = (floor.level - 1) * FLOOR_HEIGHT;
  for (let z = 0; z < floor.depth; z++) {
    for (let x = 0; x < floor.width; x++) {
      const i = z * floor.width + x;
      const c = cellCenter(plan.cellSize, { x, z });
      matrix.makeScale(size, 1, size).setPosition(c.x, y, c.z);
      tiles.setMatrixAt(i, matrix);
      tiles.setColorAt(i, color.setHex(CELL_COLORS[floor.cells[i]]));
    }
  }
}
scene.add(tiles);

// 開始地点と集合場所の目印（矢印を隠さないよう，矢印より低い位置に輪だけを置く）
const markerGeometry = new THREE.RingGeometry(0.38, 0.46, 32).rotateX(-Math.PI / 2);
const startMaterial = new THREE.MeshBasicMaterial({ color: 0xffd23f, side: THREE.DoubleSide });
const assemblyMaterial = new THREE.MeshBasicMaterial({ color: 0xffffff, side: THREE.DoubleSide });
const markers: THREE.Mesh[] = [];
for (const [cell, material] of [
  [plan.drill.start, startMaterial],
  ...plan.drill.assembly.map((a): [CellRef, THREE.Material] => [a, assemblyMaterial]),
] as const) {
  const m = new THREE.Mesh(markerGeometry, material);
  const c = cellCenter(plan.cellSize, cell);
  m.position.set(c.x, 0.01, c.z);
  markers.push(m);
  scene.add(m);
}

const arrows = createRouteArrows(plan);
if (arrows) scene.add(arrows.object);

// 上から見下ろす視点．ドラッグで回す・ホイールで寄る・右ドラッグで動かす
const centerX = (floor.width * plan.cellSize) / 2;
const centerZ = (floor.depth * plan.cellSize) / 2;
const camera = new THREE.PerspectiveCamera(50, window.innerWidth / window.innerHeight, 0.05, 200);
camera.position.set(centerX, 22, centerZ + 0.01);
const controls = new OrbitControls(camera, renderer.domElement);
controls.target.set(centerX, 0, centerZ);
controls.update();

const kinds = new Map<string, number>();
for (const p of arrows?.placements ?? []) kinds.set(p.kind, (kinds.get(p.kind) ?? 0) + 1);
const info = document.getElementById("info");
if (info) {
  info.textContent = [
    `モード: ${mode}${params.get("route") === "broken" ? "（異常な経路）" : ""}`,
    `経路のマス: ${route.length}`,
    arrows
      ? `矢印: ${arrows.placements.length}（${[...kinds].map(([k, n]) => `${k} ${n}`).join("・")}）`
      : "矢印: 作らない（テストモード）",
    "黄の輪: 開始地点・白の輪: 集合場所",
    "ドラッグ: 回す・ホイール: 寄る・右ドラッグ: 動かす",
  ].join("\n");
}

window.addEventListener("resize", () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

renderer.setAnimationLoop(() => {
  controls.update();
  renderer.render(scene, camera);
});

// HMR で読み直す時に作った物を解放する（dispose() の確認も兼ねる）
import.meta.hot?.dispose(() => {
  renderer.setAnimationLoop(null);
  controls.dispose();
  arrows?.dispose();
  tileGeometry.dispose();
  tileMaterial.dispose();
  tiles.dispose();
  markerGeometry.dispose();
  startMaterial.dispose();
  assemblyMaterial.dispose();
  for (const m of markers) m.removeFromParent();
  renderer.dispose();
  renderer.domElement.remove();
});
