// 部屋（リビング）の寸法・壁・窓・ドア・家具・廊下・エリアの配置と userData の型
// （three に依存しない定数と純粋な関数）．
// 床の中心が原点（床 y=0），窓は -Z（北）の壁，ドアは +Z（南）の壁，キッチン（コンロ）は +X（東）の壁．
// 開始時は +X（コンロ）を向き，左（-Z）に窓と本棚，右（+Z）に廊下へ出るドアとブレーカー，
// 後ろ（-X）にテレビがある（シナリオ H1）．単位は m・rad．
// 座標はすべて root から見た値（部屋の殻 shell・家具の Group は原点に置くため，揺らしていない時は同じ）

import {
  computeFootprint,
  type Footprint,
  type FurnitureDef,
  type FurnitureUserData,
  type Size3,
  type Vec3Tuple,
} from "../common/furniture";
import { type WallDef, type WallRect, wallSpanAt } from "../common/wallLayout";

export const ROOM = {
  width: 6, // X
  depth: 5, // Z
  height: 2.4,
} as const;

const HALF_W = ROOM.width / 2;
const HALF_D = ROOM.depth / 2;

/**
 * 目の高さ（床から，m）．立ち・しゃがみ．
 * しゃがみはテーブルの下に頭が収まる高さ（天板の下面 0.68m より低く）にする
 */
export const EYE_HEIGHT = {
  standing: 1.6,
  crouching: 0.55,
} as const;

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

/** 壁の厚み（ドアの開口部の奥行き．部屋の壁の面から廊下の壁の面まで） */
export const WALL_THICKNESS = 0.1;

/** 壁紙・床・天井のタイル 1 枚の大きさ（m） */
export const TILE_SIZE = {
  wall: 0.5,
  floor: 1.2,
  ceiling: 1,
} as const;

export const BASEBOARD = { height: 0.08, thickness: 0.012 } as const;

/** 窓（北の壁．中心 x=0）．開始位置から見て左 */
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

/** ドアのヒンジの側（部屋の内側から見て） */
export type DoorHingeSide = "left" | "right";

/**
 * 廊下へ出るドア（南の壁）．開始位置から見て右前．内開きで，内側から見て右（-X）にヒンジ，
 * 左（+X．ブレーカーのある側）にレバー
 */
export const DOOR = {
  centerX: 0.9,
  width: 0.85,
  height: 2,
  thickness: 0.035,
  frameWidth: 0.06,
  /** 枠の奥行き（壁の厚みの小口を覆い，両側の壁面から少し出す） */
  frameDepth: WALL_THICKNESS + 0.05,
  /** 内側から見たヒンジの側 */
  hingeSide: "right" as DoorHingeSide,
  /** 全開の角度（rad．壁に当たらない 100°） */
  maxOpenAngle: (100 * Math.PI) / 180,
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

/** ドアの開口部の x の範囲（ワールド座標） */
export const DOOR_SPAN_X = {
  minX: DOOR.centerX - DOOR.width / 2,
  maxX: DOOR.centerX + DOOR.width / 2,
} as const;

/** 開始位置（目の高さ）と向き（コンロのある +X 向き．yaw は正で左へ回るため -π/2） */
export const ROOM_START = {
  position: [-0.6, EYE_HEIGHT.standing, 0.2],
  yaw: -Math.PI / 2,
} as const;

export const ROOM_BACKGROUND = 0xcfe3f0;

// ---- 家具 ----

export type RoomFurnitureKind =
  | "table"
  | "chair"
  | "bookshelf"
  | "tvStand"
  | "tv"
  | "sofa"
  | "pendant"
  | "plant"
  | "clock"
  | "kitchenCounter"
  | "stove"
  | "breakerPanel";

export const TABLE_ID = "dining-table";
export const BOOKSHELF_ID = "bookshelf";
export const TV_ID = "tv";
export const PENDANT_ID = "pendant-light";
export const COUNTER_ID = "kitchen-counter";
export const STOVE_ID = "gas-stove";
export const BREAKER_PANEL_ID = "breaker-panel";

const CHAIR_SIZE: Size3 = { x: 0.42, y: 0.85, z: 0.44 };

/** 床置きの家具の共通項目 */
const FLOOR = {
  mount: "floor",
  anchored: false,
  origin: "bottom",
  restsOn: null,
} as const;

/**
 * テーブル（開始位置の前方．長辺が X に沿い，-X の端からしゃがんで潜り込む）．
 * 潜り込んで +X を向いた時に奥の脚 2 本が背面カメラの画角（左右およそ ±25°）に入り，
 * 手が届く距離になるよう，2〜4 人用の小さめの大きさにする
 */
const TABLE_DEF: FurnitureDef<RoomFurnitureKind> = {
  ...FLOOR,
  id: TABLE_ID,
  kind: "table",
  position: [0.8, 0, 0.2],
  rotationY: 0,
  size: { x: 1.1, y: 0.72, z: 0.7 },
  mass: 25,
  tipRisk: "low",
};

/** 本棚（窓と同じ北の壁の東寄り．窓の右に 0.4m 離す） */
const BOOKSHELF_DEF: FurnitureDef<RoomFurnitureKind> = {
  ...FLOOR,
  id: BOOKSHELF_ID,
  kind: "bookshelf",
  position: [1.85, 0, -HALF_D + 0.16],
  rotationY: 0,
  size: { x: 0.9, y: 1.8, z: 0.32 },
  mass: 40,
  tipRisk: "high",
};

/** キッチンカウンター（東の壁．正面は -X） */
const COUNTER_DEF: FurnitureDef<RoomFurnitureKind> = {
  ...FLOOR,
  id: COUNTER_ID,
  kind: "kitchenCounter",
  position: [HALF_W - 0.3, 0, 0],
  rotationY: -Math.PI / 2,
  size: { x: 1.8, y: 0.85, z: 0.6 },
  mass: 60,
  anchored: true,
  tipRisk: "low",
};

/** ガスコンロ（カウンターの上．正面をカウンターの前端にそろえ，開始位置の正面 z=0.25 に置く） */
const STOVE_DEF: FurnitureDef<RoomFurnitureKind> = {
  ...FLOOR,
  id: STOVE_ID,
  kind: "stove",
  position: [HALF_W - COUNTER_DEF.size.z + 0.03 + 0.25, COUNTER_DEF.size.y, 0.25],
  rotationY: -Math.PI / 2,
  size: { x: 0.6, y: 0.12, z: 0.5 },
  mass: 10,
  mount: "top",
  restsOn: COUNTER_ID,
  tipRisk: "low",
};

/** 分電盤（南の壁のドアの左．メインスイッチを手の届く・カメラに写る高さに置く） */
const BREAKER_PANEL_DEF: FurnitureDef<RoomFurnitureKind> = {
  ...FLOOR,
  id: BREAKER_PANEL_ID,
  kind: "breakerPanel",
  position: [1.75, 1.3, HALF_D - 0.04],
  rotationY: Math.PI,
  size: { x: 0.3, y: 0.36, z: 0.08 },
  mass: 3,
  mount: "wall",
  anchored: true,
  origin: "center",
  tipRisk: "low",
};

/** 家具の配置．position は Group 原点（床置きは底面中央，天井吊りは天井取付点，壁掛けは中心） */
export const ROOM_FURNITURE: readonly FurnitureDef<RoomFurnitureKind>[] = [
  TABLE_DEF,
  // テーブルの長辺（±Z）に 2 脚ずつ．-X の端（開始位置側）は空けて潜り込めるようにする
  ...(
    [
      ["chair-1", 0.53, -0.4, 0],
      ["chair-2", 1.07, -0.4, 0],
      ["chair-3", 0.53, 0.8, Math.PI],
      ["chair-4", 1.07, 0.8, Math.PI],
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
  BOOKSHELF_DEF,
  COUNTER_DEF,
  STOVE_DEF,
  BREAKER_PANEL_DEF,
  {
    ...FLOOR,
    id: "tv-stand",
    kind: "tvStand",
    position: [-2.78, 0, 0.2],
    rotationY: Math.PI / 2,
    size: { x: 1.5, y: 0.45, z: 0.4 },
    mass: 25,
    tipRisk: "low",
  },
  {
    ...FLOOR,
    id: TV_ID,
    kind: "tv",
    position: [-2.8, 0.45, 0.2],
    rotationY: Math.PI / 2,
    size: { x: 1.1, y: 0.72, z: 0.2 },
    mass: 12,
    mount: "top",
    tipRisk: "high",
    restsOn: "tv-stand",
  },
  {
    // テレビの方を向く（開始位置のすぐ後ろ）
    ...FLOOR,
    id: "sofa",
    kind: "sofa",
    position: [-1.5, 0, 0.2],
    rotationY: -Math.PI / 2,
    size: { x: 1.8, y: 0.8, z: 0.85 },
    mass: 45,
    tipRisk: "low",
  },
  {
    // テーブルの真上
    ...FLOOR,
    id: PENDANT_ID,
    kind: "pendant",
    position: [TABLE_DEF.position[0], ROOM.height, TABLE_DEF.position[2]],
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

/** id から家具の定義を引く（無ければ例外．レイアウトの定数どうしを結び付けるため） */
export function roomFurnitureDef(id: string): FurnitureDef<RoomFurnitureKind> {
  const def = ROOM_FURNITURE.find((f) => f.id === id);
  if (!def) throw new Error(`家具がありません: ${id}`);
  return def;
}

/** 家具の床占有範囲（回転後の外接 AABB） */
export function furnitureDefFootprint(def: FurnitureDef): Footprint {
  return computeFootprint({ x: def.position[0], z: def.position[2] }, def.rotationY, def.size);
}

// ---- テーブルの脚 ----

/** テーブルの天板と脚の寸法 */
export const TABLE_PARTS = {
  topThickness: 0.04,
  legThickness: 0.05,
  /** 天板の端から脚の外側までの距離 */
  legInset: 0.06,
} as const;

/**
 * テーブルの脚 4 本の底面中央の位置（テーブルのローカル座標．y=0）．
 * 順に (-X,-Z)・(+X,-Z)・(-X,+Z)・(+X,+Z)．id は `${tableId}-leg-${i + 1}`
 */
export function tableLegLocalPositions(size: Size3): Vec3Tuple[] {
  const lx = size.x / 2 - TABLE_PARTS.legInset - TABLE_PARTS.legThickness / 2;
  const lz = size.z / 2 - TABLE_PARTS.legInset - TABLE_PARTS.legThickness / 2;
  return [
    [-lx, 0, -lz],
    [lx, 0, -lz],
    [-lx, 0, lz],
    [lx, 0, lz],
  ];
}

export function tableLegId(tableId: string, index: number): string {
  return `${tableId}-leg-${index + 1}`;
}

/** テーブルの天板の下面の高さ（しゃがんだ目の高さより上にする） */
export function tableUndersideY(size: Size3): number {
  return size.y - TABLE_PARTS.topThickness;
}

// ---- コンロ ----

/**
 * ガスコンロの部品の寸法（コンロのローカル座標．正面 +Z，原点は底面中央）．
 * 本体（size.y の高さの箱）の上面に口 2 つ，正面につまみ 2 つ
 */
export const STOVE = {
  /** 口の中心の x（コンロのローカル．負が正面から見て左） */
  burnerX: [-0.15, 0.15],
  burnerZ: -0.03,
  burnerDiameter: 0.1,
  burnerHeight: 0.015,
  /** 火（上へ細くなる円錐の側面）の下端の直径と高さ */
  flameDiameter: 0.12,
  flameHeight: 0.05,
  knobDiameter: 0.04,
  knobDepth: 0.025,
  /** つまみの中心の高さ（コンロの底面から） */
  knobY: 0.06,
} as const;

/** 口 1 つ分の定義（つまみと火の対応） */
export interface StoveBurnerDef {
  readonly index: number;
  readonly knobId: string;
  readonly flameId: string;
  /** コンロのローカル x */
  readonly x: number;
}

export const STOVE_BURNERS: readonly StoveBurnerDef[] = STOVE.burnerX.map((x, i) => ({
  index: i + 1,
  knobId: `stove-knob-${i + 1}`,
  flameId: `stove-flame-${i + 1}`,
  x,
}));

// ---- ブレーカー ----

/** 分電盤の部品（分電盤のローカル座標．原点は箱の中心，正面 +Z） */
export const BREAKER = {
  mainSwitchId: "breaker-main-switch",
  /** メインスイッチの付け根の中心（箱の中心から） */
  mainSwitchX: -0.08,
  mainSwitchY: 0.03,
  /** 小さな分岐ブレーカーの数（動かない飾り） */
  branchCount: 6,
} as const;

/** メインスイッチの付け根の床からの高さ（手の判定のため 1.2〜1.4m に収める） */
export function breakerSwitchHeight(): number {
  return BREAKER_PANEL_DEF.position[1] + BREAKER.mainSwitchY;
}

// ---- 窓ガラスの破片 ----

/** 床の上の矩形（XZ．ワールド座標） */
export interface FloorRect {
  readonly minX: number;
  readonly maxX: number;
  readonly minZ: number;
  readonly maxZ: number;
}

/** 割れた後に窓の前の床に散らばる破片（既定は非表示） */
export const GLASS_SHARDS = {
  id: "glass-shards",
  count: 12,
  seed: 2608,
  minSize: 0.04,
  maxSize: 0.13,
  area: {
    minX: WINDOW.centerX - WINDOW.width / 2 + 0.1,
    maxX: WINDOW.centerX + WINDOW.width / 2 - 0.1,
    minZ: -HALF_D + 0.15,
    maxZ: -HALF_D + 0.85,
  },
} as const;

/** 破片 1 枚（床の上の平らな板） */
export interface GlassShard {
  readonly shape: "triangle" | "quad";
  readonly x: number;
  readonly z: number;
  readonly rotationY: number;
  /** 外接円の半径（三角）・辺の長さ（四角） */
  readonly size: number;
}

/** 破片の並び（rand は 0〜1 の一様乱数．シード固定の乱数を渡せば毎回同じ並び） */
export function glassShardLayout(
  rand: () => number,
  count: number,
  area: FloorRect,
  minSize: number,
  maxSize: number,
): GlassShard[] {
  return Array.from({ length: count }, (_, i) => {
    const size = minSize + rand() * (maxSize - minSize);
    // 板が範囲からはみ出さないよう，半分の大きさだけ内側に置く
    const half = size / 2;
    return {
      shape: i % 3 === 0 ? "quad" : "triangle",
      x: area.minX + half + rand() * (area.maxX - area.minX - size),
      z: area.minZ + half + rand() * (area.maxZ - area.minZ - size),
      rotationY: rand() * Math.PI * 2,
      size,
    };
  });
}

// ---- 廊下 ----

/** 廊下（ドアの外．X に沿って伸びる．部屋の南の壁から壁の厚みだけ離れた所から始まる） */
export const HALLWAY = {
  minX: -2,
  maxX: HALF_W,
  /** 床は壁の厚みの分も覆う（ドアの敷居） */
  floorMinZ: HALF_D,
  /** 部屋側の壁の面 */
  nearZ: HALF_D + WALL_THICKNESS,
  farZ: HALF_D + WALL_THICKNESS + 1.2,
  height: ROOM.height,
  /** 西の端の玄関ドア（飾り．開かない） */
  frontDoor: { width: 0.9, height: 2.0, centerZ: HALF_D + WALL_THICKNESS + 0.6 },
} as const;

/** 廊下の壁 4 面（廊下の内側から見た左下の端を origin とする）．near は部屋側でドアの開口部がある */
export const HALLWAY_WALLS = {
  near: {
    id: "hallway-wall-near",
    origin: [HALLWAY.minX, 0, HALLWAY.nearZ],
    dir: [1, 0, 0],
    normal: [0, 0, 1],
    rotationY: 0,
    length: HALLWAY.maxX - HALLWAY.minX,
  },
  east: {
    id: "hallway-wall-east",
    origin: [HALLWAY.maxX, 0, HALLWAY.nearZ],
    dir: [0, 0, 1],
    normal: [-1, 0, 0],
    rotationY: -Math.PI / 2,
    length: HALLWAY.farZ - HALLWAY.nearZ,
  },
  far: {
    id: "hallway-wall-far",
    origin: [HALLWAY.maxX, 0, HALLWAY.farZ],
    dir: [-1, 0, 0],
    normal: [0, 0, -1],
    rotationY: Math.PI,
    length: HALLWAY.maxX - HALLWAY.minX,
  },
  west: {
    id: "hallway-wall-west",
    origin: [HALLWAY.minX, 0, HALLWAY.farZ],
    dir: [0, 0, -1],
    normal: [1, 0, 0],
    rotationY: Math.PI / 2,
    length: HALLWAY.farZ - HALLWAY.nearZ,
  },
} as const satisfies Record<string, WallDef>;

/** 廊下の部屋側の壁のドアの開口部（部屋の DOOR_OPENING と同じ x の範囲） */
export const HALLWAY_DOOR_OPENING: WallRect = {
  ...wallSpanAt(HALLWAY_WALLS.near, DOOR.centerX, HALLWAY.nearZ, DOOR.width),
  v0: 0,
  v1: DOOR.height,
};

// ---- エリア ----

/** シナリオの判定に使う床の範囲の id */
export type RoomAreaId =
  | "under-table"
  | "near-window"
  | "near-bookshelf"
  | "glass-shards"
  | "stove-front"
  | "breaker-front"
  | "door-front"
  | "hallway";

/** シナリオの判定に使う床の範囲（XZ の矩形．判定は後の Issue） */
export interface RoomArea extends FloorRect {
  readonly id: RoomAreaId;
}

/** 危険範囲（窓・本棚の前）の奥行き */
const DANGER_DEPTH = 1.0;
/** 窓・本棚の前の危険範囲を左右に広げる幅 */
const DANGER_MARGIN = 0.3;
/** 設備（コンロ・ブレーカー・ドア）の前の範囲の奥行き */
const FRONT_DEPTH = 0.8;

function footprintRect(fp: Footprint): FloorRect {
  return {
    minX: fp.centerX - fp.halfX,
    maxX: fp.centerX + fp.halfX,
    minZ: fp.centerZ - fp.halfZ,
    maxZ: fp.centerZ + fp.halfZ,
  };
}

function buildAreas(): RoomArea[] {
  const table = footprintRect(furnitureDefFootprint(TABLE_DEF));
  const shelf = footprintRect(furnitureDefFootprint(BOOKSHELF_DEF));
  const counter = footprintRect(furnitureDefFootprint(COUNTER_DEF));
  const stove = footprintRect(furnitureDefFootprint(STOVE_DEF));
  const breakerX = BREAKER_PANEL_DEF.position[0];
  return [
    { id: "under-table", ...table },
    {
      id: "near-window",
      minX: WINDOW.centerX - WINDOW.width / 2 - DANGER_MARGIN,
      maxX: WINDOW.centerX + WINDOW.width / 2 + DANGER_MARGIN,
      minZ: -HALF_D,
      maxZ: -HALF_D + DANGER_DEPTH,
    },
    {
      id: "near-bookshelf",
      minX: shelf.minX - DANGER_MARGIN,
      maxX: shelf.maxX + DANGER_MARGIN,
      minZ: shelf.maxZ,
      maxZ: shelf.maxZ + DANGER_DEPTH,
    },
    { id: "glass-shards", ...GLASS_SHARDS.area },
    {
      // コンロの左右 0.25m まで．カウンターの正面（-X 側）から手前へ
      id: "stove-front",
      minX: counter.minX - FRONT_DEPTH,
      maxX: counter.minX,
      minZ: stove.minZ - 0.25,
      maxZ: stove.maxZ + 0.25,
    },
    {
      id: "breaker-front",
      minX: breakerX - 0.35,
      maxX: breakerX + 0.35,
      minZ: HALF_D - FRONT_DEPTH,
      maxZ: HALF_D,
    },
    {
      id: "door-front",
      minX: DOOR_SPAN_X.minX,
      maxX: DOOR_SPAN_X.maxX,
      minZ: HALF_D - FRONT_DEPTH,
      maxZ: HALF_D,
    },
    {
      // ドアの開口部（壁の厚み）から廊下の奥まで
      id: "hallway",
      minX: HALLWAY.minX,
      maxX: HALLWAY.maxX,
      minZ: HALLWAY.floorMinZ,
      maxZ: HALLWAY.farZ,
    },
  ];
}

/** シナリオの判定に使うエリアの一覧（家具の定義から導く） */
export const ROOM_AREAS: readonly RoomArea[] = buildAreas();

// ---- userData の形 ----

/**
 * ドアの Group.userData．Group 原点はヒンジ（開口部の下端の端）の壁面上，
 * ローカル +Z が部屋の内側．rotation.y は roomDoorRotationY(this, openAngle) で求める
 */
export interface DoorUserData {
  readonly id: "door";
  readonly kind: "door";
  /** 部屋の内側から見たヒンジの側 */
  readonly hingeSide: DoorHingeSide;
  readonly width: number;
  readonly height: number;
  readonly thickness: number;
  /** 閉じた状態の rotation.y */
  readonly closedRotationY: number;
  /** 部屋の内側へ開くときの rotation.y の増える向き（closedRotationY + sign × 開き角） */
  readonly openInwardSign: 1 | -1;
  /** 全開の角度（rad） */
  readonly maxOpenAngle: number;
  /** 開いているか（開ける処理は後の Issue） */
  open: boolean;
  /** 今の開き角（rad．0 で閉，maxOpenAngle で全開） */
  openAngle: number;
}

/** ドアの開き角（0〜maxOpenAngle に丸める）から rotation.y を求める */
export function roomDoorRotationY(
  door: Pick<DoorUserData, "closedRotationY" | "openInwardSign" | "maxOpenAngle">,
  openAngle: number,
): number {
  const angle = Math.min(Math.max(openAngle, 0), door.maxOpenAngle);
  return door.closedRotationY + door.openInwardSign * angle;
}

/** テーブルの Group.userData（家具の欄に脚の id を足す） */
export interface TableUserData extends FurnitureUserData<"table"> {
  readonly legIds: readonly string[];
}

/** テーブルの脚 1 本の Group.userData．Group 原点は脚の底面中央（テーブルのローカル座標） */
export interface TableLegUserData {
  readonly id: string;
  readonly kind: "tableLeg";
  readonly tableId: string;
  /** 1〜4（tableLegLocalPositions の順） */
  readonly index: number;
  readonly size: Size3;
  /** 手で握られているか（握る判定は後の Issue） */
  grabbed: boolean;
}

/** 本 1 冊の Mesh.userData（落下させる対象） */
export interface BookUserData {
  readonly id: string;
  readonly kind: "book";
  readonly size: Size3;
  readonly mass: number;
}

/** コンロの Group.userData（家具の欄につまみ・火の id を足す） */
export interface StoveUserData extends FurnitureUserData<"stove"> {
  readonly knobIds: readonly string[];
  readonly flameIds: readonly string[];
}

/** つまみの Group.userData．原点はつまみの付け根の中心，正面がローカル +Z（回す軸） */
export interface StoveKnobUserData {
  readonly id: string;
  readonly kind: "stoveKnob";
  readonly stoveId: string;
  /** このつまみで消す火の id */
  readonly flameId: string;
  readonly diameter: number;
  /** 点火側か（消す処理は後の Issue．火の lit と合わせる） */
  on: boolean;
}

/** 火の Group.userData．原点は口の上面の中心．表示は Group の visible で切り替える */
export interface StoveFlameUserData {
  readonly id: string;
  readonly kind: "stoveFlame";
  readonly stoveId: string;
  readonly knobId: string;
  /** 点いているか（visible と合わせる） */
  lit: boolean;
}

/** 分電盤の Group.userData（家具の欄にスイッチの id を足す） */
export interface BreakerPanelUserData extends FurnitureUserData<"breakerPanel"> {
  readonly switchIds: readonly string[];
}

/**
 * メインスイッチの Group.userData．原点はスイッチの付け根の中心（分電盤のローカル座標），正面がローカル +Z．
 * レバー（子の Mesh．name は leverName）は入で上，切で下を向く
 */
export interface BreakerSwitchUserData {
  readonly id: string;
  readonly kind: "breakerSwitch";
  readonly panelId: string;
  readonly leverName: string;
  /** 入っているか（切る処理は後の Issue） */
  on: boolean;
}

/** テレビの Group.userData（家具の欄に画面の状態を足す）．① で音を流す発生源 */
export interface TvUserData extends FurnitureUserData<"tv"> {
  /** 画面の Mesh の name（点いている時は明るい色） */
  readonly screenName: string;
  on: boolean;
}

/** 窓ガラスの Group.userData（割れる動きは後の Issue） */
export interface WindowGlassUserData {
  readonly id: "window-glass";
  readonly kind: "windowGlass";
  readonly width: number;
  readonly height: number;
  broken: boolean;
}

/** 床に散らばった破片の Group.userData（既定は非表示．割れた後に visible にする） */
export interface GlassShardsUserData {
  readonly id: "glass-shards";
  readonly kind: "glassShards";
  readonly count: number;
}
