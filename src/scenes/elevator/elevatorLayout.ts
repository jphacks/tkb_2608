// エレベーター（乗用エレベーターのかご内）の寸法・壁・扉・操作盤・手すり・照明の配置と
// userData の型（three に依存しない定数と純粋な関数）．
// 床の中心が原点（床 y=0），扉のある正面が -Z．正面を向いて右が +X．単位は m・rad．
// かご内の座標はすべてかご（cabin）の Group から見た値（かごを揺らす・上下させても変わらない）．
// 乗り場（ホール）だけはかごの外（root）の座標

import type { FurnitureDef, FurnitureUserData, Vec3Tuple } from "../common/furniture";
import { type SlidingLeafDef, slidingLeaves } from "../common/slidingDoor";
import { type WallDef, type WallRect, wallPointToWorld, wallSpanAt } from "../common/wallLayout";

export const CABIN = {
  width: 2.0, // X
  depth: 1.8, // Z
  height: 2.3,
} as const;

const HALF_W = CABIN.width / 2;
const HALF_D = CABIN.depth / 2;

/** 目の高さ（床から，m）．立ち・しゃがみ */
export const EYE_HEIGHT = {
  standing: 1.6,
  crouching: 0.9,
} as const;

/** かごの壁 4 面（内側から見た左下の端を origin とする）．正面（-Z）に扉 */
export const CABIN_WALLS = {
  front: {
    id: "wall-front",
    origin: [-HALF_W, 0, -HALF_D],
    dir: [1, 0, 0],
    normal: [0, 0, 1],
    rotationY: 0,
    length: CABIN.width,
  },
  right: {
    id: "wall-right",
    origin: [HALF_W, 0, -HALF_D],
    dir: [0, 0, 1],
    normal: [-1, 0, 0],
    rotationY: -Math.PI / 2,
    length: CABIN.depth,
  },
  rear: {
    id: "wall-rear",
    origin: [HALF_W, 0, HALF_D],
    dir: [-1, 0, 0],
    normal: [0, 0, -1],
    rotationY: Math.PI,
    length: CABIN.width,
  },
  left: {
    id: "wall-left",
    origin: [-HALF_W, 0, HALF_D],
    dir: [0, 0, -1],
    normal: [1, 0, 0],
    rotationY: Math.PI / 2,
    length: CABIN.depth,
  },
} as const satisfies Record<string, WallDef>;

export type CabinWallName = keyof typeof CABIN_WALLS;

/** 床・壁の模様 1 枚の大きさ（m）．壁はステンレスの板 1 枚の幅 */
export const TILE_SIZE = {
  floor: 0.5,
  wall: 0.5,
} as const;

// ---- 扉 ----

/**
 * かごの扉（中央開きの 2 枚）．扉は正面の壁より外側（乗り場側）を左右へ滑り，全開で開口部が全幅あく．
 * 三方枠（左右の縦枠と上枠）は壁の内側に付く別の構造
 */
export const CABIN_DOOR = {
  width: 1.0,
  height: 2.1,
  leafThickness: 0.025,
  /** 壁の面から扉の中心までの外側への距離 */
  leafOffset: 0.04,
  /** 扉の下端の床からのすき間（敷居と重ねない） */
  leafBottom: 0.005,
  frameWidth: 0.04,
  frameDepth: 0.03,
} as const;

/** 正面の壁上の扉の開口部（中心 x=0，床から） */
export const CABIN_DOOR_OPENING: WallRect = {
  ...wallSpanAt(CABIN_WALLS.front, 0, -HALF_D, CABIN_DOOR.width),
  v0: 0,
  v1: CABIN_DOOR.height,
};

/** 扉 2 枚の配置（a が -X，b が +X へ開く） */
export const CABIN_DOOR_LEAVES: readonly SlidingLeafDef[] = slidingLeaves(CABIN_DOOR.width, 2);

export const CABIN_DOOR_ID = "cabin-door";

/**
 * かごと乗り場のすき間（正面の壁から乗り場の壁まで）をふさぐ部品．
 * 敷居（床）と上の幕板（扉の上）を，開いた扉が収まる幅まで延ばす
 */
export const DOOR_GAP = {
  /** かごの正面の壁から乗り場の壁までの距離 */
  depth: 0.1,
  /** 敷居・幕板の幅（全開の扉が収まる範囲より少し広く．扉は全開で開口部の外へ扉 1 枚分ずつ出る） */
  width: CABIN_DOOR.width * 2 + 0.1,
  sillThickness: 0.013,
  /** 敷居の上面の床からの高さ（床と同じ面にしてちらつかせない） */
  sillTop: 0.003,
  headerThickness: 0.03,
} as const;

// ---- 操作盤 ----

/** 階の範囲（ボタンは 1〜5 階） */
export const ELEVATOR_FLOORS = {
  lowest: 1,
  highest: 5,
} as const;

/** ボタンのある階の一覧（下から） */
export const FLOOR_NUMBERS: readonly number[] = Array.from(
  { length: ELEVATOR_FLOORS.highest - ELEVATOR_FLOORS.lowest + 1 },
  (_, i) => ELEVATOR_FLOORS.lowest + i,
);

/**
 * 操作盤のボタンの寸法（両方の操作盤で共通）．操作盤の Group は原点が板の中心の壁面上，
 * 正面（かごの内側）がローカル +Z，ローカル X は内側から見て右向き
 */
export const PANEL = {
  /** 板の厚み（壁から） */
  depth: 0.015,
  /** 階・開閉のボタンの直径と，隣のボタンとの中心の間隔 */
  buttonDiameter: 0.055,
  buttonPitch: 0.1,
  /** 非常連絡ボタンの直径（目立つよう少し大きく） */
  emergencyDiameter: 0.065,
  /** ボタンが板から出ている高さ */
  buttonDepth: 0.012,
} as const;

/** 定員・積載量（操作盤の表示板に描く） */
export const CAPACITY = {
  persons: 15,
  loadKg: 1000,
} as const;

/** ボタンの働き（同じ働きのボタンはどちらの操作盤で押しても同じ操作として扱う） */
export type ElevatorButtonAction = "floor" | "open" | "close" | "emergencyCall";

/** ボタンの種類のキー（id の末尾・ラベルの描き分けに使う） */
export type ElevatorButtonKey = `floor-${number}` | "open" | "close" | "emergency-call";

/** 操作盤の上のボタン 1 つ（x は板の中心からのローカル X，y は床からの高さ） */
export interface PanelButtonDef {
  readonly key: ElevatorButtonKey;
  readonly action: ElevatorButtonAction;
  /** 階のボタンの階（それ以外は null） */
  readonly floor: number | null;
  readonly x: number;
  readonly y: number;
  readonly diameter: number;
}

/** 板の上の矩形（x は板の中心からのローカル X，y は床からの高さ．テクスチャに描く範囲） */
export interface PanelRegion {
  readonly x0: number;
  readonly x1: number;
  readonly y0: number;
  readonly y1: number;
}

/** 操作盤 1 枚の形（板の大きさとボタンの並び）．並び方ごとに 1 つ定義する */
export interface PanelLayout {
  readonly name: "vertical" | "horizontal";
  readonly width: number;
  /** 板の下端・上端の床からの高さ */
  readonly bottom: number;
  readonly top: number;
  readonly buttons: readonly PanelButtonDef[];
  /** インターホンのスピーカーの格子 */
  readonly grille: PanelRegion;
  /** 定員・積載量の表示 */
  readonly capacity: PanelRegion;
}

/** 板の中心の高さ */
export function panelCenterY(layout: Pick<PanelLayout, "bottom" | "top">): number {
  return (layout.bottom + layout.top) / 2;
}

/** 階のボタンのキー */
export function floorButtonKey(floor: number): ElevatorButtonKey {
  return `floor-${floor}`;
}

function floorButton(floor: number, x: number, y: number): PanelButtonDef {
  return {
    key: floorButtonKey(floor),
    action: "floor",
    floor,
    x,
    y,
    diameter: PANEL.buttonDiameter,
  };
}

function controlButton(
  key: "open" | "close" | "emergency-call",
  x: number,
  y: number,
): PanelButtonDef {
  const emergency = key === "emergency-call";
  return {
    key,
    action: emergency ? "emergencyCall" : key,
    floor: null,
    x,
    y,
    diameter: emergency ? PANEL.emergencyDiameter : PANEL.buttonDiameter,
  };
}

/** 縦型の操作盤（2 列）の列の中心（板の中心からのローカル X） */
const VERTICAL_COLUMN_X = 0.06;
/** 縦型の操作盤の最下段のボタンの中心の高さ（最上段の 5 階ボタンの縁まで 1.4m 以下に収める） */
const VERTICAL_BOTTOM_Y = 0.97;

/**
 * 縦型の操作盤（副）．左の列に階（下から 1〜5 階，y 0.97〜1.37），右の列に下から「閉」「開」，
 * 少し離して非常連絡．板の上部に格子，下部に定員・積載量
 */
export const VERTICAL_PANEL_LAYOUT: PanelLayout = {
  name: "vertical",
  width: 0.24,
  bottom: 0.84,
  top: 1.62,
  buttons: [
    ...FLOOR_NUMBERS.map((floor, i) =>
      floorButton(floor, -VERTICAL_COLUMN_X, VERTICAL_BOTTOM_Y + PANEL.buttonPitch * i),
    ),
    controlButton("close", VERTICAL_COLUMN_X, VERTICAL_BOTTOM_Y),
    controlButton("open", VERTICAL_COLUMN_X, VERTICAL_BOTTOM_Y + PANEL.buttonPitch),
    controlButton("emergency-call", VERTICAL_COLUMN_X, VERTICAL_BOTTOM_Y + 0.35),
  ],
  grille: { x0: -0.07, x1: 0.07, y0: 1.47, y1: 1.58 },
  capacity: { x0: -0.1, x1: 0.1, y0: 0.85, y1: 0.93 },
};

/** 横型の操作盤の段の高さ（上の段に階，下の段に開・閉・非常連絡） */
const HORIZONTAL_ROW_Y = { floors: 1.2, controls: 1.06 } as const;

/**
 * 横型の操作盤（主．車いす用の操作盤のような横長の板）．上の段に 1〜5 階を左から横一列，
 * 下の段に左から「開」「閉」，右端に離して非常連絡．板の上端の帯の左に定員・積載量，右に格子．
 * 板の中心の高さは 1.15m，ボタンは 1.06m と 1.2m の 2 段
 */
export const HORIZONTAL_PANEL_LAYOUT: PanelLayout = {
  name: "horizontal",
  width: 0.56,
  bottom: 0.94,
  top: 1.36,
  buttons: [
    ...FLOOR_NUMBERS.map((floor, i) =>
      floorButton(
        floor,
        PANEL.buttonPitch * (i - (FLOOR_NUMBERS.length - 1) / 2),
        HORIZONTAL_ROW_Y.floors,
      ),
    ),
    controlButton("open", -2 * PANEL.buttonPitch, HORIZONTAL_ROW_Y.controls),
    controlButton("close", -PANEL.buttonPitch, HORIZONTAL_ROW_Y.controls),
    controlButton("emergency-call", 1.5 * PANEL.buttonPitch, HORIZONTAL_ROW_Y.controls),
  ],
  grille: { x0: 0.06, x1: 0.26, y0: 1.28, y1: 1.34 },
  capacity: { x0: -0.26, x1: 0.0, y0: 1.275, y1: 1.345 },
};

/** ラベルを描くテクスチャ（ボタンの面）の並び順．どの操作盤のボタンの key もすべて含む */
export const BUTTON_LABEL_KEYS: readonly ElevatorButtonKey[] = VERTICAL_PANEL_LAYOUT.buttons.map(
  (b) => b.key,
);

export type ControlPanelRole = "main" | "sub";

/** 操作盤 1 枚の定義．position は板の中心の壁面上の点（かごの座標） */
export interface ControlPanelDef {
  readonly id: string;
  readonly role: ControlPanelRole;
  readonly layout: PanelLayout;
  readonly wall: WallDef;
  /** 壁上の板の中心の位置 u */
  readonly u: number;
  readonly position: Vec3Tuple;
  readonly rotationY: number;
}

function panelOnWall(
  id: string,
  role: ControlPanelRole,
  layout: PanelLayout,
  wall: WallDef,
  u: number,
): ControlPanelDef {
  return {
    id,
    role,
    layout,
    wall,
    u,
    position: wallPointToWorld(wall, u, panelCenterY(layout)),
    rotationY: wall.rotationY,
  };
}

/** 操作盤の置き場所のすき間 */
export const PANEL_PLACEMENT = {
  /** 主の操作盤: 正面の壁（かごの前の隅）から板の端まで */
  mainCornerGap: 0.05,
  /** 副の操作盤: 三方枠の外端から板の端まで */
  subFrameGap: 0.06,
} as const;

/** 主の操作盤の板の中心の z（右の壁の扉寄り．横型） */
export const MAIN_PANEL_Z =
  -HALF_D + PANEL_PLACEMENT.mainCornerGap + HORIZONTAL_PANEL_LAYOUT.width / 2;

/** 副の操作盤の板の中心の x（正面の壁の扉の左．三方枠より外．縦型） */
export const SUB_PANEL_X = -(
  CABIN_DOOR.width / 2 +
  CABIN_DOOR.frameWidth +
  PANEL_PLACEMENT.subFrameGap +
  VERTICAL_PANEL_LAYOUT.width / 2
);

/**
 * 操作盤 2 枚．主（panel-main）は右の壁の扉寄りの横型（板の中心 z=MAIN_PANEL_Z），
 * 副（panel-sub）は正面の壁の扉の左の縦型（板の中心 x=SUB_PANEL_X）
 */
export const CONTROL_PANELS: readonly ControlPanelDef[] = [
  panelOnWall(
    "panel-main",
    "main",
    HORIZONTAL_PANEL_LAYOUT,
    CABIN_WALLS.right,
    MAIN_PANEL_Z + HALF_D,
  ),
  panelOnWall("panel-sub", "sub", VERTICAL_PANEL_LAYOUT, CABIN_WALLS.front, SUB_PANEL_X + HALF_W),
];

/** 操作盤のボタンの id（例: panel-main-floor-1・panel-sub-emergency-call） */
export function panelButtonId(panelId: string, key: ElevatorButtonKey): string {
  return `${panelId}-${key}`;
}

/** Group のローカル座標の点を，Group の位置・Y 軸回りの回転でかごの座標に変換する */
export function localToCabin(
  origin: { readonly position: Vec3Tuple; readonly rotationY: number },
  local: Vec3Tuple,
): Vec3Tuple {
  const c = Math.cos(origin.rotationY);
  const s = Math.sin(origin.rotationY);
  return [
    origin.position[0] + local[0] * c + local[2] * s,
    origin.position[1] + local[1],
    origin.position[2] - local[0] * s + local[2] * c,
  ];
}

/** ボタン 1 つの定義．localPosition は操作盤の Group から見たボタンの付け根の中心 */
export interface ElevatorButtonDef {
  readonly id: string;
  readonly panelId: string;
  readonly key: ElevatorButtonKey;
  readonly action: ElevatorButtonAction;
  readonly floor: number | null;
  readonly diameter: number;
  readonly localPosition: Vec3Tuple;
  /** ボタンの面の中心（かごの座標．手で押す判定の目安） */
  readonly position: Vec3Tuple;
}

/** 両方の操作盤のボタン（主の操作盤の分，続けて副の操作盤の分） */
export const ELEVATOR_BUTTONS: readonly ElevatorButtonDef[] = CONTROL_PANELS.flatMap((panel) =>
  panel.layout.buttons.map((button): ElevatorButtonDef => {
    const localPosition: Vec3Tuple = [button.x, button.y - panelCenterY(panel.layout), PANEL.depth];
    return {
      id: panelButtonId(panel.id, button.key),
      panelId: panel.id,
      key: button.key,
      action: button.action,
      floor: button.floor,
      diameter: button.diameter,
      localPosition,
      position: localToCabin(panel, [
        localPosition[0],
        localPosition[1],
        localPosition[2] + PANEL.buttonDepth,
      ]),
    };
  }),
);

// ---- 手すり・鏡 ----

/** 横の手すり（ステンレスの丸棒．壁から standoff 離し，支えの腕 2 本で留める） */
export const HANDRAIL = {
  /** 棒の中心の床からの高さ */
  y: 0.85,
  diameter: 0.035,
  /** 壁から棒の中心まで */
  standoff: 0.05,
  /** 棒の両端から支えの腕までの距離 */
  bracketInset: 0.08,
  bracketSize: 0.02,
  /** 奥の手すりの両端の，左右の壁からの距離 */
  rearEndGap: 0.15,
  /** 左右の手すりの，正面・奥の壁からの距離 */
  sideEndGap: 0.2,
  /** 右の手すりの手前の端と主の操作盤の板の間のすき間 */
  panelGap: 0.15,
} as const;

export interface ElevatorHandrailDef extends FurnitureDef<"handrail"> {
  readonly wall: CabinWallName;
}

/**
 * 横の手すり（Group 原点は棒の中心，ローカル X が棒の向き，+Z が内側）．奥の壁（handrail-rear）と
 * 左右の壁（handrail-left・handrail-right）．右の手すりは主の操作盤と重ならない範囲（板の奥の端から HANDRAIL.panelGap あける）
 */
function handrail(wall: CabinWallName, u0: number, u1: number): ElevatorHandrailDef {
  const def = CABIN_WALLS[wall];
  return {
    id: `handrail-${wall}`,
    kind: "handrail",
    wall,
    position: wallPointToWorld(def, (u0 + u1) / 2, HANDRAIL.y, HANDRAIL.standoff),
    rotationY: def.rotationY,
    size: { x: u1 - u0, y: HANDRAIL.diameter, z: HANDRAIL.standoff + HANDRAIL.diameter / 2 },
    mass: 3,
    mount: "wall",
    anchored: true,
    origin: "center",
    tipRisk: "low",
    restsOn: null,
  };
}

export const ELEVATOR_HANDRAILS: readonly ElevatorHandrailDef[] = [
  handrail("rear", HANDRAIL.rearEndGap, CABIN.width - HANDRAIL.rearEndGap),
  // 右の壁の u は z + HALF_D．手前（扉側）は主の操作盤を避ける
  handrail(
    "right",
    MAIN_PANEL_Z + HORIZONTAL_PANEL_LAYOUT.width / 2 + HANDRAIL.panelGap + HALF_D,
    CABIN.depth - HANDRAIL.sideEndGap,
  ),
  handrail("left", HANDRAIL.sideEndGap, CABIN.depth - HANDRAIL.sideEndGap),
];

/** 奥の壁の鏡（反射は描かず明るい板）．手すりより上 */
export const MIRROR = {
  width: 1.2,
  bottom: 0.95,
  top: 2.0,
  /** 壁からの浮き */
  offset: 0.004,
} as const;

// ---- 階の表示 ----

/** 扉の上の階の表示（黒地に橙の数字と矢印）．Group 原点は正面の壁面上の表示の中心 */
export const FLOOR_INDICATOR = {
  width: 0.32,
  height: 0.12,
  depth: 0.03,
  centerY: 2.215,
  /** 画面の縁の幅 */
  bezel: 0.01,
} as const;

export const FLOOR_INDICATOR_ID = "floor-indicator";

export type IndicatorDirection = "up" | "down" | "none";

/** 階の表示の文字（1 階以上はそのまま，0 以下は地下として B1・B2…） */
export function formatFloorLabel(floor: number): string {
  const n = Math.round(floor);
  return n >= 1 ? String(n) : `B${1 - n}`;
}

/** 進む向きの矢印の向き（上 1・下 -1・なし 0．描くときに使う） */
export function directionSign(direction: IndicatorDirection): 1 | -1 | 0 {
  if (direction === "up") return 1;
  if (direction === "down") return -1;
  return 0;
}

// ---- 照明・天井の設備 ----

/** 天井の照明パネル（発光の板）と光源 */
export const CEILING_LIGHT = {
  width: 1.1,
  depth: 0.8,
  thickness: 0.02,
  /** パネルの中心の Z（かごの中央） */
  z: 0,
  /** 点灯時の光源の強さ（PointLight の intensity） */
  intensity: 4,
  /** 光源の天井からの下がり */
  lightDrop: 0.15,
} as const;

/** 非常灯（扉寄りの天井の小さな板と光源．既定は消灯） */
export const EMERGENCY_LIGHT = {
  width: 0.16,
  depth: 0.08,
  thickness: 0.02,
  /** 左前の隅（左の壁・正面の壁から 0.35m） */
  x: -HALF_W + 0.35,
  z: -HALF_D + 0.35,
  /** 点灯時の光源の強さ */
  intensity: 1.2,
} as const;

/** 防犯カメラ（天井の奥の右の隅の小さな半球） */
export const SECURITY_CAMERA = {
  radius: 0.05,
  position: [HALF_W - 0.12, CABIN.height, HALF_D - 0.12],
} as const satisfies { radius: number; position: Vec3Tuple };

// ---- 乗り場（ホール） ----

/**
 * 乗り場（扉の外のホール）．かごの外（root 直下）に置き，かごだけを揺らす・上下させても動かない．
 * 内側だけを描く閉じた部屋で，かご側の壁にかごの扉と同じ大きさの開口部がある
 */
export const HALL = {
  /** かごの幅より両側に 0.8m ずつ広い */
  width: CABIN.width + 1.6,
  depth: 3.0,
  height: 2.6,
  /** 乗り場の扉枠（三方枠）の幅と，乗り場側への出っ張り */
  frameWidth: 0.07,
  frameProtrude: 0.07,
} as const;

/** 乗り場のかご側の壁の z（かごの正面の壁の外） */
export const HALL_WALL_Z = -HALF_D - DOOR_GAP.depth;

const HALL_HALF_W = HALL.width / 2;
const HALL_FAR_Z = HALL_WALL_Z - HALL.depth;

/** 乗り場の壁 4 面（乗り場の内側から見た左下の端を origin とする．座標は root） */
export const HALL_WALLS = {
  car: {
    id: "hall-wall-car",
    origin: [HALL_HALF_W, 0, HALL_WALL_Z],
    dir: [-1, 0, 0],
    normal: [0, 0, -1],
    rotationY: Math.PI,
    length: HALL.width,
  },
  far: {
    id: "hall-wall-far",
    origin: [-HALL_HALF_W, 0, HALL_FAR_Z],
    dir: [1, 0, 0],
    normal: [0, 0, 1],
    rotationY: 0,
    length: HALL.width,
  },
  right: {
    id: "hall-wall-right",
    origin: [HALL_HALF_W, 0, HALL_FAR_Z],
    dir: [0, 0, 1],
    normal: [-1, 0, 0],
    rotationY: -Math.PI / 2,
    length: HALL.depth,
  },
  left: {
    id: "hall-wall-left",
    origin: [-HALL_HALF_W, 0, HALL_WALL_Z],
    dir: [0, 0, -1],
    normal: [1, 0, 0],
    rotationY: Math.PI / 2,
    length: HALL.depth,
  },
} as const satisfies Record<string, WallDef>;

/** 乗り場のかご側の壁の開口部（かごの扉と同じ位置・大きさ） */
export const HALL_DOOR_OPENING: WallRect = {
  ...wallSpanAt(HALL_WALLS.car, 0, HALL_WALL_Z, CABIN_DOOR.width),
  v0: 0,
  v1: CABIN_DOOR.height,
};

/** 乗り場の床の中心（root の座標） */
export const HALL_CENTER: Vec3Tuple = [0, 0, (HALL_WALL_Z + HALL_FAR_Z) / 2];

// ---- 開始位置・背景 ----

/**
 * 開始位置．かごの中央付近（中心から 0.25m 奥）に立ち，扉（-Z）を向く．正面に扉と階の表示，
 * 左前に副の操作盤（中心が約 32°），右前に主の操作盤（扉側の端が約 42°，中心が約 51°）がある
 */
export const ELEVATOR_START = {
  position: [0, EYE_HEIGHT.standing, 0.25],
  yaw: 0,
} as const;

export const ELEVATOR_BACKGROUND = 0x1c1d20;

// ---- userData の形 ----

/** 操作盤の Group.userData */
export interface ControlPanelUserData {
  readonly id: string;
  readonly kind: "controlPanel";
  readonly role: ControlPanelRole;
  /** ボタンの並び方（縦型・横型） */
  readonly layout: PanelLayout["name"];
  /** この操作盤のボタンの id */
  readonly buttonIds: readonly string[];
}

/**
 * ボタンの Group.userData．Group 原点は板の上のボタンの付け根の中心，正面がローカル +Z．
 * 同じ action（と floor）のボタンは，どちらの操作盤で押しても同じ操作として扱う
 */
export interface ElevatorButtonUserData {
  readonly id: string;
  readonly kind: "elevatorButton";
  readonly panelId: string;
  readonly key: ElevatorButtonKey;
  readonly action: ElevatorButtonAction;
  readonly floor: number | null;
  readonly diameter: number;
  /** 文字を描いた面の Mesh の name（点灯時はこの Mesh のマテリアルを差し替える） */
  readonly faceName: string;
  /** 押されているか（押す処理は後の Issue） */
  pressed: boolean;
  /** 点灯しているか（setElevatorButtonLit で面のマテリアルと合わせて変える） */
  lit: boolean;
}

/** 手すりの Group.userData */
export interface ElevatorHandrailUserData extends FurnitureUserData<"handrail"> {
  readonly wall: CabinWallName;
  /** 手で握られているか（把持の処理は後の Issue） */
  grabbed: boolean;
}

/** 扉（2 枚まとめて）の Group.userData．Group 原点は開口部の下端中央，ローカル X が壁に沿う向き */
export interface ElevatorDoorUserData {
  readonly id: string;
  readonly kind: "elevatorDoor";
  /** 開口部の幅・高さ（全開で通れる大きさ） */
  readonly width: number;
  readonly height: number;
  readonly leafIds: readonly string[];
  readonly openStyle: "slide";
  /** 開いているか（開閉の処理は後の Issue） */
  open: boolean;
  /** 開き具合（0 で閉，1 で全開．各扉の DoorLeafUserData.openAmount と合わせる） */
  openAmount: number;
  /** 開かない状態か（閉じ込め E2 用．true の間は開ける操作を受け付けない想定） */
  locked: boolean;
}

/** 扉 1 枚の Group.userData．位置は slidingLeafX(this, openAmount) で求める */
export interface ElevatorDoorLeafUserData extends SlidingLeafDef {
  readonly id: string;
  readonly kind: "doorLeaf";
  readonly doorId: string;
  readonly size: { readonly x: number; readonly y: number; readonly z: number };
  readonly slideAxis: "x";
  openAmount: number;
}

/** 階の表示の Group.userData（表示の描き直しは setFloorIndicator） */
export interface FloorIndicatorUserData {
  readonly id: string;
  readonly kind: "floorIndicator";
  /** 画面の Mesh の name（canvas テクスチャを持つ） */
  readonly screenName: string;
  currentFloor: number;
  direction: IndicatorDirection;
}

export type CabinLightKind = "ceilingLight" | "emergencyLight";

/**
 * 照明の Group.userData．光源（PointLight）とパネルの Mesh を子に持つ．
 * 消灯は光源の intensity を 0 にする（visible を切り替えるとシェーダーが作り直されて重い）
 */
export interface CabinLightUserData {
  readonly id: string;
  readonly kind: CabinLightKind;
  /** 非常灯か（停電時に点ける側） */
  readonly emergency: boolean;
  /** 点灯時の光源の強さ */
  readonly intensity: number;
  readonly lightName: string;
  readonly panelName: string;
  on: boolean;
}
