// エレベーター（乗用エレベーターのかご内）の空間．
// かご（cabin）の Group に床・壁・天井・三方枠・操作盤・手すり・鏡・階の表示・照明・扉を載せ，
// 乗り場（ホール）と全体を照らす光は root に直接置く（かごだけを揺らす・上下させても乗り場は動かない）

import * as THREE from "three";
import { type BoxPlacement, disposeObjectTree, mergeBoxes } from "../common/meshHelpers";
import {
  splitWallAroundOpening,
  type WallDef,
  type WallRect,
  wallPointToWorld,
} from "../common/wallLayout";
import { createMergedWall } from "../common/wallMeshes";
import type { Space, SpaceBuildOptions } from "../types";
import {
  createCabinDoor,
  createCabinLights,
  createControlPanel,
  createFloorIndicator,
  createHandrail,
  type FixtureContext,
} from "./elevatorFixtures";
import {
  CABIN,
  CABIN_DOOR,
  CABIN_DOOR_OPENING,
  CABIN_WALLS,
  CONTROL_PANELS,
  DOOR_GAP,
  ELEVATOR_BACKGROUND,
  ELEVATOR_HANDRAILS,
  ELEVATOR_START,
  HALL,
  HALL_CENTER,
  HALL_DOOR_OPENING,
  HALL_WALL_Z,
  HALL_WALLS,
  MIRROR,
  SECURITY_CAMERA,
  TILE_SIZE,
} from "./elevatorLayout";
import { createElevatorMaterials, type ElevatorMaterials } from "./elevatorMaterials";

/** かごの床・壁・天井（個別に揺らす・演出できるよう 1 面ずつ別の Mesh） */
export interface CabinSurfaces {
  readonly floor: THREE.Mesh;
  readonly ceiling: THREE.Mesh;
  readonly walls: {
    readonly front: THREE.Mesh;
    readonly right: THREE.Mesh;
    readonly rear: THREE.Mesh;
    readonly left: THREE.Mesh;
  };
}

/** 後で触れる・動かす・表示を変える対象を種類ごとに引ける一覧（hall 以外は cabin の子孫） */
export interface ElevatorParts {
  /** かご全体．揺れ（position / rotation）と上昇・下降（position.y）の演出で動かす親 */
  readonly cabin: THREE.Group;
  /** かごの床・壁・天井 */
  readonly surfaces: CabinSurfaces;
  /** かごの扉（2 枚まとめて．userData は ElevatorDoorUserData） */
  readonly doors: readonly THREE.Group[];
  /** 扉 1 枚ずつ（userData は ElevatorDoorLeafUserData） */
  readonly doorLeaves: readonly THREE.Group[];
  /** 操作盤（主・副．userData は ControlPanelUserData） */
  readonly panels: readonly THREE.Group[];
  /** 両方の操作盤のボタン（userData は ElevatorButtonUserData） */
  readonly buttons: readonly THREE.Group[];
  /** 奥・左右の手すり（userData は ElevatorHandrailUserData） */
  readonly handrails: readonly THREE.Group[];
  /** 扉の上の階の表示（userData は FloorIndicatorUserData．描き直しは setFloorIndicator） */
  readonly indicator: THREE.Group;
  /** 天井の照明と非常灯（userData は CabinLightUserData） */
  readonly lights: readonly THREE.Group[];
  /** 全体を照らす環境光（root 直下．停電の演出で暗くする想定） */
  readonly ambient: THREE.HemisphereLight;
  /** 乗り場（root 直下．かごの外） */
  readonly hall: THREE.Group;
  /** ボタンの面のマテリアル（消灯・点灯．setElevatorButtonLit に渡す） */
  readonly buttonMaterials: Pick<ElevatorMaterials, "buttonFace" | "buttonLit">;
  /** 上の Group（cabin・hall・surfaces を除く）を id（= Group の name）で引く */
  readonly byId: ReadonlyMap<string, THREE.Group>;
}

/** エレベーターの空間．Space に加え，触れる・動かす対象の一覧を持つ */
export interface ElevatorSpace extends Space {
  readonly id: "elevator";
  readonly parts: ElevatorParts;
}

/** Space がエレベーターか（parts を持つか）を判定する */
export function isElevatorSpace(space: Space): space is ElevatorSpace {
  return space.id === "elevator" && "parts" in space;
}

function horizontalPlane(
  width: number,
  depth: number,
  material: THREE.Material,
  y: number,
  facingUp: boolean,
  name: string,
): THREE.Mesh {
  const plane = new THREE.Mesh(new THREE.PlaneGeometry(width, depth), material);
  plane.rotation.x = facingUp ? -Math.PI / 2 : Math.PI / 2;
  plane.position.y = y;
  plane.name = name;
  return plane;
}

/** かごの床・壁 4 面・天井（正面の壁は扉の開口部を空ける） */
function createCabinSurfaces(materials: ElevatorMaterials): CabinSurfaces {
  const wall = (def: WallDef, rects: WallRect[]): THREE.Mesh => {
    const m = createMergedWall([[def, rects]], materials.wall, TILE_SIZE.wall, def.id);
    if (!m) throw new Error(`壁を作れません: ${def.id}`);
    return m;
  };
  const full = (def: WallDef): WallRect[] => [{ u0: 0, u1: def.length, v0: 0, v1: CABIN.height }];
  return {
    floor: horizontalPlane(CABIN.width, CABIN.depth, materials.floor, 0, true, "floor"),
    ceiling: horizontalPlane(
      CABIN.width,
      CABIN.depth,
      materials.ceiling,
      CABIN.height,
      false,
      "ceiling",
    ),
    walls: {
      front: wall(
        CABIN_WALLS.front,
        splitWallAroundOpening(CABIN_WALLS.front.length, CABIN.height, CABIN_DOOR_OPENING),
      ),
      right: wall(CABIN_WALLS.right, full(CABIN_WALLS.right)),
      rear: wall(CABIN_WALLS.rear, full(CABIN_WALLS.rear)),
      left: wall(CABIN_WALLS.left, full(CABIN_WALLS.left)),
    },
  };
}

/** 壁上の位置 (u, v)・壁から内側への offset に置く直方体の配置 */
function onWall(
  wall: WallDef,
  u: number,
  v: number,
  offset: number,
  size: readonly [number, number, number],
): BoxPlacement {
  return { size, position: wallPointToWorld(wall, u, v, offset), rotationY: wall.rotationY };
}

/**
 * かごの三方枠（内側の左右の縦枠と上枠）と，乗り場とのすき間をふさぐ敷居・幕板（1 Mesh）．
 * 扉とは別の構造で，開口部の内側をふさがない
 */
function createCabinDoorFrame(materials: ElevatorMaterials): THREE.Mesh {
  const { u0, u1, v1 } = CABIN_DOOR_OPENING;
  const fw = CABIN_DOOR.frameWidth;
  const fd = CABIN_DOOR.frameDepth;
  const w = CABIN_WALLS.front;
  const cu = (u0 + u1) / 2;
  const gapCenter = -DOOR_GAP.depth / 2;
  const frame = new THREE.Mesh(
    mergeBoxes([
      onWall(w, u0 - fw / 2, (v1 + fw) / 2, fd / 2, [fw, v1 + fw, fd]),
      onWall(w, u1 + fw / 2, (v1 + fw) / 2, fd / 2, [fw, v1 + fw, fd]),
      onWall(w, cu, v1 + fw / 2, fd / 2, [u1 - u0 + fw * 2, fw, fd]),
      // 敷居（壁の面から乗り場の壁まで．上面は床とほぼ同じ高さ）
      onWall(w, cu, DOOR_GAP.sillTop - DOOR_GAP.sillThickness / 2, gapCenter, [
        DOOR_GAP.width,
        DOOR_GAP.sillThickness,
        DOOR_GAP.depth,
      ]),
      // 幕板（扉の上．開いた扉の上のすき間から外が覗けないように）
      onWall(w, cu, v1 + DOOR_GAP.headerThickness / 2, gapCenter, [
        DOOR_GAP.width,
        DOOR_GAP.headerThickness,
        DOOR_GAP.depth,
      ]),
    ]),
    materials.frame,
  );
  frame.name = "door-frame";
  return frame;
}

/** 奥の壁の鏡（明るい板） */
function createMirror(materials: ElevatorMaterials, unitPlane: THREE.BufferGeometry): THREE.Mesh {
  const mirror = new THREE.Mesh(unitPlane, materials.mirror);
  const wall = CABIN_WALLS.rear;
  mirror.scale.set(MIRROR.width, MIRROR.top - MIRROR.bottom, 1);
  mirror.position.set(
    ...wallPointToWorld(wall, wall.length / 2, (MIRROR.bottom + MIRROR.top) / 2, MIRROR.offset),
  );
  mirror.rotation.y = wall.rotationY;
  mirror.name = "mirror";
  return mirror;
}

/** 防犯カメラ（天井の隅の小さな半球） */
function createSecurityCamera(materials: ElevatorMaterials): THREE.Mesh {
  const camera = new THREE.Mesh(
    new THREE.SphereGeometry(
      SECURITY_CAMERA.radius,
      12,
      6,
      0,
      Math.PI * 2,
      Math.PI / 2,
      Math.PI / 2,
    ),
    materials.camera,
  );
  camera.position.set(...SECURITY_CAMERA.position);
  camera.name = "security-camera";
  return camera;
}

/**
 * 乗り場（床・天井・壁 4 面・扉枠・照明パネル）．内側だけを描く閉じた部屋で，root の直下に置く．
 * かご側の壁にかごの扉と同じ開口部があり，扉が開くとかごから見える
 */
function createHall(materials: ElevatorMaterials, unitBox: THREE.BufferGeometry): THREE.Group {
  const hall = new THREE.Group();
  hall.name = "hall";
  const floor = horizontalPlane(HALL.width, HALL.depth, materials.hallFloor, 0, true, "hall-floor");
  floor.position.z = HALL_CENTER[2];
  const ceiling = horizontalPlane(
    HALL.width,
    HALL.depth,
    materials.hallCeiling,
    HALL.height,
    false,
    "hall-ceiling",
  );
  ceiling.position.z = HALL_CENTER[2];
  const full = (def: WallDef): [WallDef, WallRect[]] => [
    def,
    [{ u0: 0, u1: def.length, v0: 0, v1: HALL.height }],
  ];
  const walls = createMergedWall(
    [
      [
        HALL_WALLS.car,
        splitWallAroundOpening(HALL_WALLS.car.length, HALL.height, HALL_DOOR_OPENING),
      ],
      full(HALL_WALLS.far),
      full(HALL_WALLS.right),
      full(HALL_WALLS.left),
    ],
    materials.hallWall,
    1,
    "hall-walls",
  );

  // 乗り場側の三方枠と敷居．かごの扉の外側（扉の裏）から乗り場側へ出っ張る
  const { u0, u1, v1 } = HALL_DOOR_OPENING;
  const fw = HALL.frameWidth;
  const leafBack = CABIN_DOOR.leafOffset + CABIN_DOOR.leafThickness / 2 + 0.003;
  const backZ = -CABIN.depth / 2 - leafBack;
  const frontZ = HALL_WALL_Z - HALL.frameProtrude;
  const depth = backZ - frontZ;
  const w = HALL_WALLS.car;
  // 乗り場の壁から見た offset（乗り場の内側が正）．枠の中心
  const offset = (HALL_WALL_Z - (backZ + frontZ) / 2) * -w.normal[2];
  const frame = new THREE.Mesh(
    mergeBoxes([
      onWall(w, u0 - fw / 2, (v1 + fw) / 2, offset, [fw, v1 + fw, depth]),
      onWall(w, u1 + fw / 2, (v1 + fw) / 2, offset, [fw, v1 + fw, depth]),
      onWall(w, (u0 + u1) / 2, v1 + fw / 2, offset, [u1 - u0 + fw * 2, fw, depth]),
      onWall(
        w,
        (u0 + u1) / 2,
        DOOR_GAP.sillTop - DOOR_GAP.sillThickness / 2,
        HALL.frameProtrude / 2,
        [u1 - u0 + fw * 2, DOOR_GAP.sillThickness, HALL.frameProtrude],
      ),
    ]),
    materials.frame,
  );
  frame.name = "hall-door-frame";

  const light = new THREE.Mesh(unitBox, materials.lightPanel);
  light.scale.set(1.2, 0.02, 0.6);
  light.position.set(HALL_CENTER[0], HALL.height - 0.01, HALL_CENTER[2]);
  light.name = "hall-light";

  hall.add(floor, ceiling, frame, light);
  if (walls) hall.add(walls);
  return hall;
}

/** エレベーターの空間を作る */
export function createElevatorScene(options: SpaceBuildOptions): ElevatorSpace {
  const root = new THREE.Group();
  root.name = "elevator";
  const cabin = new THREE.Group();
  cabin.name = "cabin";
  root.add(cabin);

  const materials = createElevatorMaterials(options.maxAnisotropy);
  const unitBox = new THREE.BoxGeometry(1, 1, 1);
  const unitPlane = new THREE.PlaneGeometry(1, 1);
  const ctx: FixtureContext = {
    unitBox,
    unitCylinder: new THREE.CylinderGeometry(0.5, 0.5, 1, 16),
    unitPlane,
    materials,
    geometryCache: new Map(),
  };

  const surfaces = createCabinSurfaces(materials);
  cabin.add(
    surfaces.floor,
    surfaces.ceiling,
    surfaces.walls.front,
    surfaces.walls.right,
    surfaces.walls.rear,
    surfaces.walls.left,
    createCabinDoorFrame(materials),
    createMirror(materials, unitPlane),
    createSecurityCamera(materials),
  );

  const panelParts = CONTROL_PANELS.map((def) => createControlPanel(def, ctx));
  const panels = panelParts.map((p) => p.panel);
  const buttons = panelParts.flatMap((p) => p.buttons);
  const handrails = ELEVATOR_HANDRAILS.map((def) => createHandrail(def, ctx));
  const { door, leaves: doorLeaves } = createCabinDoor(ctx);
  const indicator = createFloorIndicator(ctx);
  const lights = createCabinLights(ctx);

  const groupOf = (name: string, children: readonly THREE.Object3D[]): THREE.Group => {
    const group = new THREE.Group();
    group.name = name;
    if (children.length > 0) group.add(...children);
    return group;
  };
  cabin.add(
    groupOf("panels", panels),
    groupOf("handrails", handrails),
    groupOf("doors", [door]),
    indicator,
    groupOf("lights", lights),
  );

  const ambient = new THREE.HemisphereLight(0xffffff, 0x8a8a86, 1.2);
  ambient.name = "ambient-light";
  const hall = createHall(materials, unitBox);
  root.add(hall, ambient);

  const byId = new Map<string, THREE.Group>();
  for (const group of [
    door,
    ...doorLeaves,
    ...panels,
    ...buttons,
    ...handrails,
    indicator,
    ...lights,
  ]) {
    byId.set(group.name, group);
  }

  return {
    id: "elevator",
    root,
    startPosition: new THREE.Vector3(...ELEVATOR_START.position),
    startYaw: ELEVATOR_START.yaw,
    background: ELEVATOR_BACKGROUND,
    parts: {
      cabin,
      surfaces,
      doors: [door],
      doorLeaves,
      panels,
      buttons,
      handrails,
      indicator,
      lights,
      ambient,
      hall,
      buttonMaterials: { buttonFace: materials.buttonFace, buttonLit: materials.buttonLit },
      byId,
    },
    dispose: () => {
      root.removeFromParent();
      disposeObjectTree(root);
      // 点灯用のマテリアルは Mesh に付いていないことがあるため別に解放する
      materials.buttonLit.dispose();
    },
  };
}
