// 部屋（リビング）の寸法・壁・窓・ドア・家具の配置（three に依存しない定数）．
// 床の中心が原点（床 y=0），窓は -Z（北）の壁，ドアは +Z（南）の壁．単位は m・rad

import type { FurnitureDef, Size3 } from "../common/furniture";
import type { WallDef, WallRect } from "../common/wallLayout";

export const ROOM = {
  width: 6, // X
  depth: 5, // Z
  height: 2.4,
} as const;

const HALF_W = ROOM.width / 2;
const HALF_D = ROOM.depth / 2;

/** 壁 4 面（内側から見た左下の端を origin とする） */
export const WALLS = {
  north: {
    id: "wall-north",
    origin: [-HALF_W, 0, -HALF_D],
    dir: [1, 0, 0],
    normal: [0, 0, 1],
    rotationY: 0,
    length: ROOM.width,
  },
  east: {
    id: "wall-east",
    origin: [HALF_W, 0, -HALF_D],
    dir: [0, 0, 1],
    normal: [-1, 0, 0],
    rotationY: -Math.PI / 2,
    length: ROOM.depth,
  },
  south: {
    id: "wall-south",
    origin: [HALF_W, 0, HALF_D],
    dir: [-1, 0, 0],
    normal: [0, 0, -1],
    rotationY: Math.PI,
    length: ROOM.width,
  },
  west: {
    id: "wall-west",
    origin: [-HALF_W, 0, HALF_D],
    dir: [0, 0, -1],
    normal: [1, 0, 0],
    rotationY: Math.PI / 2,
    length: ROOM.depth,
  },
} as const satisfies Record<string, WallDef>;

/** 壁紙・床・天井のタイル 1 枚の大きさ（m） */
export const TILE_SIZE = {
  wall: 0.5,
  floor: 1.2,
  ceiling: 1,
} as const;

export const BASEBOARD = { height: 0.08, thickness: 0.012 } as const;

/** 窓（北の壁．中心 x=0） */
export const WINDOW = {
  centerX: 0,
  width: 2,
  bottom: 0.8,
  height: 1.2,
  frameWidth: 0.05,
  frameDepth: 0.1,
} as const;

/** 窓の外の景色の板（窓から外へ 2m） */
export const SKY_BOARD = {
  distance: 2,
  width: 24,
  height: 12,
  bottom: -4,
} as const;

/** ドア（南の壁．中心 x=0）．内側から見て右にレバー，左にヒンジ */
export const DOOR = {
  centerX: 0,
  width: 0.85,
  height: 2,
  thickness: 0.035,
  frameWidth: 0.06,
  frameDepth: 0.05,
  /** 内側から見たヒンジの側 */
  hingeSide: "left",
} as const;

/** 内側から見て左端を u=0 とした壁上の位置（中心 x から変換．北は +X，南は -X が u の向き） */
function openingOnWall(wall: WallDef, centerX: number, width: number): { u0: number; u1: number } {
  const centerU = (centerX - wall.origin[0]) * wall.dir[0];
  return { u0: centerU - width / 2, u1: centerU + width / 2 };
}

/** 北の壁の窓の開口部 */
export const WINDOW_OPENING: WallRect = {
  ...openingOnWall(WALLS.north, WINDOW.centerX, WINDOW.width),
  v0: WINDOW.bottom,
  v1: WINDOW.bottom + WINDOW.height,
};

/** 南の壁のドアの開口部 */
export const DOOR_OPENING: WallRect = {
  ...openingOnWall(WALLS.south, DOOR.centerX, DOOR.width),
  v0: 0,
  v1: DOOR.height,
};

/** 開始位置（目の高さ）と向き（窓のある -Z 向き） */
export const ROOM_START = {
  position: [0, 1.6, HALF_D - 0.7],
  yaw: 0,
} as const;

export const ROOM_BACKGROUND = 0xcfe3f0;

export type RoomFurnitureKind =
  | "table"
  | "chair"
  | "bookshelf"
  | "tvStand"
  | "tv"
  | "sofa"
  | "pendant"
  | "plant"
  | "clock";

const CHAIR_SIZE: Size3 = { x: 0.42, y: 0.85, z: 0.44 };

/** 床置きの家具の共通項目 */
const FLOOR = {
  mount: "floor",
  anchored: false,
  origin: "bottom",
  restsOn: null,
} as const;

/** 家具の配置．position は Group 原点（床置きは底面中央，天井吊りは天井取付点，壁掛けは中心） */
export const ROOM_FURNITURE: readonly FurnitureDef<RoomFurnitureKind>[] = [
  {
    ...FLOOR,
    id: "dining-table",
    kind: "table",
    position: [1.3, 0, -0.9],
    rotationY: 0,
    size: { x: 1.4, y: 0.72, z: 0.8 },
    mass: 30,
    tipRisk: "low",
  },
  ...(
    [
      ["chair-1", 0.95, -1.55, 0],
      ["chair-2", 1.65, -1.55, 0],
      ["chair-3", 0.95, -0.25, Math.PI],
      ["chair-4", 1.65, -0.25, Math.PI],
    ] as const
  ).map(
    ([id, x, z, rotationY]): FurnitureDef<RoomFurnitureKind> => ({
      ...FLOOR,
      id,
      kind: "chair",
      position: [x, 0, z],
      rotationY,
      size: CHAIR_SIZE,
      mass: 5,
      tipRisk: "medium",
    }),
  ),
  {
    ...FLOOR,
    id: "bookshelf",
    kind: "bookshelf",
    position: [2.82, 0, 1.2],
    rotationY: -Math.PI / 2,
    size: { x: 0.9, y: 1.8, z: 0.32 },
    mass: 40,
    tipRisk: "high",
  },
  {
    ...FLOOR,
    id: "tv-stand",
    kind: "tvStand",
    position: [-2.78, 0, 0],
    rotationY: Math.PI / 2,
    size: { x: 1.5, y: 0.45, z: 0.4 },
    mass: 25,
    tipRisk: "low",
  },
  {
    ...FLOOR,
    id: "tv",
    kind: "tv",
    position: [-2.8, 0.45, 0],
    rotationY: Math.PI / 2,
    size: { x: 1.1, y: 0.72, z: 0.2 },
    mass: 12,
    mount: "top",
    tipRisk: "high",
    restsOn: "tv-stand",
  },
  {
    ...FLOOR,
    id: "sofa",
    kind: "sofa",
    position: [-1.1, 0, 0],
    rotationY: -Math.PI / 2,
    size: { x: 1.8, y: 0.8, z: 0.85 },
    mass: 45,
    tipRisk: "low",
  },
  {
    ...FLOOR,
    id: "pendant-light",
    kind: "pendant",
    position: [1.3, ROOM.height, -0.9],
    rotationY: 0,
    size: { x: 0.4, y: 0.75, z: 0.4 },
    mass: 1.5,
    mount: "ceiling",
    anchored: true,
    origin: "top",
    tipRisk: "low",
  },
  {
    ...FLOOR,
    id: "plant",
    kind: "plant",
    position: [-2.55, 0, -2.05],
    rotationY: 0,
    size: { x: 0.45, y: 1.1, z: 0.45 },
    mass: 8,
    tipRisk: "medium",
  },
  {
    ...FLOOR,
    id: "clock",
    kind: "clock",
    position: [-1.8, 1.75, -HALF_D + 0.025],
    rotationY: 0,
    size: { x: 0.32, y: 0.32, z: 0.05 },
    mass: 0.8,
    mount: "wall",
    anchored: true,
    origin: "center",
    tipRisk: "low",
  },
];
