// 電車（通勤電車 1 両のうちドア 2 か所分）の寸法・壁・ドア・座席・手すり・つり革の配置
// （three に依存しない定数と純粋な関数）．
// 床の中心が原点（床 y=0），車両の長手方向が Z．-Z の端を「前」とし，前を向いて左が -X．単位は m・rad．
// 座標はすべて車体（carBody）の Group から見た値（車体を動かしても変わらない）

import type { FurnitureDef, FurnitureUserData, Size3, Vec3Tuple } from "../common/furniture";
import { type SlidingLeafDef, slidingLeaves } from "../common/slidingDoor";
import { type WallDef, type WallRect, wallSpanAt } from "../common/wallLayout";

export const CAR = {
  length: 10, // Z（ドア 2 か所分．両端は妻面で閉じる）
  width: 2.8, // X
  height: 2.3,
} as const;

const HALF_L = CAR.length / 2;
const HALF_W = CAR.width / 2;

/** 目の高さ（床から，m）．立ち・しゃがみ・着座 */
export const EYE_HEIGHT = {
  standing: 1.6,
  crouching: 0.9,
  seated: 1.2,
} as const;

export type TrainSide = "left" | "right";
export const TRAIN_SIDES: readonly TrainSide[] = ["left", "right"];
export type TrainEnd = "front" | "rear";

/** 側面の X の符号（左 -1，右 +1） */
export function sideSign(side: TrainSide): 1 | -1 {
  return side === "left" ? -1 : 1;
}

/** 壁 4 面（内側から見た左下の端を origin とする）．前・後ろは妻面 */
export const TRAIN_WALLS = {
  front: {
    id: "wall-front",
    origin: [-HALF_W, 0, -HALF_L],
    dir: [1, 0, 0],
    normal: [0, 0, 1],
    rotationY: 0,
    length: CAR.width,
  },
  right: {
    id: "wall-right",
    origin: [HALF_W, 0, -HALF_L],
    dir: [0, 0, 1],
    normal: [-1, 0, 0],
    rotationY: -Math.PI / 2,
    length: CAR.length,
  },
  rear: {
    id: "wall-rear",
    origin: [HALF_W, 0, HALF_L],
    dir: [-1, 0, 0],
    normal: [0, 0, -1],
    rotationY: Math.PI,
    length: CAR.width,
  },
  left: {
    id: "wall-left",
    origin: [-HALF_W, 0, HALF_L],
    dir: [0, 0, -1],
    normal: [1, 0, 0],
    rotationY: Math.PI / 2,
    length: CAR.length,
  },
} as const satisfies Record<string, WallDef>;

export const SIDE_WALLS: Readonly<Record<TrainSide, WallDef>> = {
  left: TRAIN_WALLS.left,
  right: TRAIN_WALLS.right,
};
export const END_WALLS: Readonly<Record<TrainEnd, WallDef>> = {
  front: TRAIN_WALLS.front,
  rear: TRAIN_WALLS.rear,
};

/** 床・天井のタイル 1 枚の大きさ（m） */
export const TILE_SIZE = {
  floor: 1,
  wall: 1,
} as const;

// ---- ドア ----

/**
 * 側面の両開きドア．扉は壁の面より外側（戸袋）を左右へ滑る．
 * window* は扉の窓（床からの高さと，扉の縦の端からの幅）
 */
export const SIDE_DOOR = {
  width: 1.3,
  height: 1.85,
  leafThickness: 0.03,
  /** 壁の面から扉の中心までの外側への距離（扉が戸袋へ入れるように壁の外に置く） */
  leafOffset: 0.045,
  frameWidth: 0.05,
  frameDepth: 0.04,
  windowBottom: 1.0,
  windowTop: 1.65,
  windowMargin: 0.09,
} as const;

/** ドアの中心の Z（片側 2 か所．両側面で同じ） */
export const DOOR_CENTERS_Z = [-2.4, 2.4] as const;

/** 妻面の貫通扉（片開き．壁の外を u の増える向きへ滑る） */
export const GANGWAY_DOOR = {
  width: 0.8,
  height: 1.9,
  leafThickness: 0.03,
  leafOffset: 0.045,
  frameWidth: 0.05,
  frameDepth: 0.04,
  windowBottom: 0.85,
  windowTop: 1.7,
  windowMargin: 0.1,
} as const;

/** 貫通扉の向こうの通路（外が覗けないよう閉じた箱）の大きさ */
export const GANGWAY = {
  width: 1.1,
  height: 2.0,
  depth: 0.6,
} as const;

// 引き戸の扉の配置（slidingLeaves・slidingLeafX）は common/slidingDoor.ts（エレベーターと共用）
export { type SlidingLeafDef, slidingLeafX, slidingLeaves } from "../common/slidingDoor";

export type TrainDoorKind = "sideDoor" | "gangwayDoor" | "emergencyDoor";

/** ドア 1 か所（側面の両開き・妻面の貫通扉・非常扉）の定義 */
export interface TrainDoorDef {
  readonly id: string;
  readonly kind: TrainDoorKind;
  readonly wall: WallDef;
  /** 壁上の開口部（床から） */
  readonly opening: WallRect;
  readonly side: TrainSide | null;
  readonly end: TrainEnd | null;
  readonly leaves: readonly SlidingLeafDef[];
}

/** 側面のドア．id は door-<側>-<前からの番号> */
export const SIDE_DOORS: readonly TrainDoorDef[] = TRAIN_SIDES.flatMap((side) =>
  DOOR_CENTERS_Z.map(
    (z, i): TrainDoorDef => ({
      id: `door-${side}-${i + 1}`,
      kind: "sideDoor",
      wall: SIDE_WALLS[side],
      opening: {
        ...wallSpanAt(SIDE_WALLS[side], sideSign(side) * HALF_W, z, SIDE_DOOR.width),
        v0: 0,
        v1: SIDE_DOOR.height,
      },
      side,
      end: null,
      leaves: slidingLeaves(SIDE_DOOR.width, 2),
    }),
  ),
);

/** 非常扉にする妻面（前の端の貫通扉） */
export const EMERGENCY_DOOR_END: TrainEnd = "front";

/**
 * 妻面の貫通扉（中心 x=0）．前の端は非常扉（id emergency-door），後ろの端は通常の貫通扉
 * （id gangway-door-rear）
 */
export const GANGWAY_DOORS: readonly TrainDoorDef[] = (["front", "rear"] as const).map(
  (end): TrainDoorDef => ({
    id: end === EMERGENCY_DOOR_END ? "emergency-door" : `gangway-door-${end}`,
    kind: end === EMERGENCY_DOOR_END ? "emergencyDoor" : "gangwayDoor",
    wall: END_WALLS[end],
    opening: {
      ...wallSpanAt(END_WALLS[end], 0, end === "front" ? -HALF_L : HALF_L, GANGWAY_DOOR.width),
      v0: 0,
      v1: GANGWAY_DOOR.height,
    },
    side: null,
    end,
    leaves: slidingLeaves(GANGWAY_DOOR.width, 1),
  }),
);

// ---- 座席 ----

/** ロングシートの寸法．座席の Group は正面（通路側）がローカル +Z，長さがローカル X */
export const SEAT = {
  /** 1 人分の幅 */
  personWidth: 0.45,
  /** 壁から座面の前端まで */
  depth: 0.55,
  /** 座面の上端の高さ */
  height: 0.43,
  cushionThickness: 0.1,
  backTop: 0.95,
  backThickness: 0.1,
  /** 袖仕切り（座席の両端の板） */
  armThickness: 0.04,
  armHeight: 1.05,
  /** 妻面と車端の座席の間のすき間 */
  endGap: 0.1,
} as const;

export type SeatKind = "longSeat" | "prioritySeat";

/** 座席の全長（袖仕切りを含む） */
export function seatLength(persons: number): number {
  return persons * SEAT.personWidth + SEAT.armThickness * 2;
}

/** 座席の 1 区画（片側 3 区画．ドア間に 7 人掛け，両端に 3 人掛けの優先席） */
export const SEAT_SECTIONS: readonly {
  readonly kind: SeatKind;
  readonly persons: number;
  readonly centerZ: number;
}[] = [
  { kind: "prioritySeat", persons: 3, centerZ: -(HALF_L - SEAT.endGap - seatLength(3) / 2) },
  { kind: "longSeat", persons: 7, centerZ: (DOOR_CENTERS_Z[0] + DOOR_CENTERS_Z[1]) / 2 },
  { kind: "prioritySeat", persons: 3, centerZ: HALF_L - SEAT.endGap - seatLength(3) / 2 },
];

export interface SeatDef extends FurnitureDef<SeatKind> {
  readonly side: TrainSide;
  readonly persons: number;
}

/** 座席．id は seat-<側>-<前からの番号>．Group 原点は床の上の座席の中央（壁から depth/2） */
export const TRAIN_SEATS: readonly SeatDef[] = TRAIN_SIDES.flatMap((side) =>
  SEAT_SECTIONS.map(
    (section, i): SeatDef => ({
      id: `seat-${side}-${i + 1}`,
      kind: section.kind,
      side,
      persons: section.persons,
      position: [sideSign(side) * (HALF_W - SEAT.depth / 2), 0, section.centerZ],
      // 正面（ローカル +Z）を通路へ向ける
      rotationY: side === "left" ? Math.PI / 2 : -Math.PI / 2,
      size: { x: seatLength(section.persons), y: SEAT.armHeight, z: SEAT.depth },
      mass: 15 * section.persons,
      mount: "floor",
      anchored: true,
      origin: "bottom",
      tipRisk: "low",
      restsOn: null,
    }),
  ),
);

/** 着座位置 1 人分（座席の Group のローカル座標） */
export interface SeatSlot {
  readonly index: number;
  /** 腰を下ろす位置（座面の上） */
  readonly sitPosition: Vec3Tuple;
  /** 座ったときの目の位置 */
  readonly eyePosition: Vec3Tuple;
}

/** 座席の着座位置の一覧（ローカル座標．端から順に） */
export function seatSlots(persons: number): SeatSlot[] {
  const start = -(persons * SEAT.personWidth) / 2;
  const back = -SEAT.depth / 2 + SEAT.backThickness;
  return Array.from({ length: persons }, (_, i) => {
    const x = start + SEAT.personWidth * (i + 0.5);
    return {
      index: i,
      sitPosition: [x, SEAT.height, back + 0.2],
      eyePosition: [x, EYE_HEIGHT.seated, back + 0.12],
    };
  });
}

/** Group のローカル座標の点を，Group の位置・Y 軸回りの回転で車体の座標に変換する */
export function localToCar(
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

/**
 * 座ったときの向き（開始位置と同じ形式．0 で -Z，正で左へ回る）．
 * 座席の正面（ローカル +Z）を向く
 */
export function seatFacingYaw(rotationY: number): number {
  const yaw = rotationY + Math.PI;
  return Math.atan2(Math.sin(yaw), Math.cos(yaw));
}

// ---- 手すり・つり革 ----

/** 縦の握り棒（ステンレス．床から天井まで） */
export const POLE = {
  diameter: 0.032,
  /** ドア脇の握り棒: 壁からの距離と，ドアの開口部の端からの距離 */
  doorWallGap: 0.12,
  doorEdgeGap: 0.08,
  /** シート中央の握り棒: 座面の前端からの通路側への距離 */
  seatFrontGap: 0.03,
} as const;

/** 横の握り棒（つり革を掛ける．通路の両側に車両の長手方向へ通す） */
export const RAIL = {
  x: 0.6,
  y: 2.0,
  diameter: 0.03,
  length: CAR.length - 0.4,
  /** 天井から吊る支えの Z */
  hangerZ: [-3.6, -1.2, 1.2, 3.6],
} as const;

export type HandrailOrientation = "vertical" | "horizontal";

export interface HandrailDef extends FurnitureDef<"handrail"> {
  readonly orientation: HandrailOrientation;
}

const POLE_SIZE: Size3 = { x: POLE.diameter, y: CAR.height, z: POLE.diameter };

function verticalPole(id: string, x: number, z: number): HandrailDef {
  return {
    id,
    kind: "handrail",
    orientation: "vertical",
    position: [x, 0, z],
    rotationY: 0,
    size: POLE_SIZE,
    mass: 3,
    mount: "floor",
    anchored: true,
    origin: "bottom",
    tipRisk: "low",
    restsOn: null,
  };
}

/**
 * 手すり．ドア脇の縦の握り棒（pole-door-<側>-<ドア番号>-<front/rear>），
 * 7 人掛けの中央の縦の握り棒（pole-seat-<側>-<座席番号>），非常扉の脇の縦の手すり
 * （emergency-door-handrail），横の握り棒（rail-<側>）
 */
export const TRAIN_HANDRAILS: readonly HandrailDef[] = [
  ...TRAIN_SIDES.flatMap((side) =>
    DOOR_CENTERS_Z.flatMap((centerZ, i) => {
      const x = sideSign(side) * (HALF_W - POLE.doorWallGap);
      const dz = SIDE_DOOR.width / 2 + POLE.doorEdgeGap;
      return [
        verticalPole(`pole-door-${side}-${i + 1}-front`, x, centerZ - dz),
        verticalPole(`pole-door-${side}-${i + 1}-rear`, x, centerZ + dz),
      ];
    }),
  ),
  ...TRAIN_SEATS.filter((seat) => seat.kind === "longSeat").map((seat) =>
    verticalPole(
      `pole-${seat.id}`,
      sideSign(seat.side) * (HALF_W - SEAT.depth - POLE.seatFrontGap),
      seat.position[2],
    ),
  ),
  {
    // 非常扉の脇（扉が開く側と反対）の壁の縦の手すり．床から 0.8m〜1.8m
    id: "emergency-door-handrail",
    kind: "handrail",
    orientation: "vertical",
    position: [
      -(GANGWAY_DOOR.width / 2 + 0.15),
      0.8,
      (EMERGENCY_DOOR_END === "front" ? -1 : 1) * (HALF_L - 0.07),
    ],
    rotationY: 0,
    size: { x: POLE.diameter, y: 1.0, z: POLE.diameter },
    mass: 1,
    mount: "wall",
    anchored: true,
    origin: "bottom",
    tipRisk: "low",
    restsOn: null,
  },
  ...TRAIN_SIDES.map(
    (side): HandrailDef => ({
      id: `rail-${side}`,
      kind: "handrail",
      orientation: "horizontal",
      position: [sideSign(side) * RAIL.x, RAIL.y, 0],
      rotationY: 0,
      size: { x: RAIL.diameter, y: RAIL.diameter, z: RAIL.length },
      mass: 8,
      mount: "ceiling",
      anchored: true,
      origin: "center",
      tipRisk: "low",
      restsOn: null,
    }),
  ),
];

/** つり革（帯＋輪）．Group 原点は横の握り棒に掛かる上端（ここを支点に振れる） */
export const STRAP = {
  pitch: 0.6,
  /** 両端の妻面から離す距離 */
  endMargin: 0.4,
  beltLength: 0.2,
  beltWidth: 0.025,
  beltThickness: 0.006,
  /** 輪の外径と太さ */
  ringDiameter: 0.13,
  ringThickness: 0.014,
} as const;

/** つり革の上端から輪の下端までの長さ */
export const STRAP_LENGTH = STRAP.beltLength + STRAP.ringDiameter;

/** 長さ span の範囲に間隔 pitch で中央揃えに並べた位置（-span/2〜span/2） */
export function evenlySpaced(span: number, pitch: number): number[] {
  const count = Math.floor(span / pitch + 1e-9) + 1;
  const start = (-(count - 1) * pitch) / 2;
  return Array.from({ length: count }, (_, i) => start + i * pitch);
}

export interface StrapDef {
  readonly id: string;
  /** 掛かっている横の握り棒の id */
  readonly railId: string;
  /** 上端（支点）の位置 */
  readonly position: Vec3Tuple;
}

/** つり革（描画負荷を抑えるため控えめの数．頭上なので手でつかむ判定はしない方針）．id は strap-01 から（左の握り棒の前から順に，続けて右） */
export const TRAIN_STRAPS: readonly StrapDef[] = TRAIN_SIDES.flatMap((side) =>
  evenlySpaced(CAR.length - STRAP.endMargin * 2, STRAP.pitch).map((z) => ({
    railId: `rail-${side}`,
    position: [sideSign(side) * RAIL.x, RAIL.y, z] as Vec3Tuple,
  })),
).map((strap, i) => ({ id: `strap-${String(i + 1).padStart(2, "0")}`, ...strap }));

// ---- 設備 ----

/** 非常通報装置（左の 2 番目のドアの前側の壁．座席の袖仕切りより上） */
export const EMERGENCY_INTERCOM: FurnitureDef<"emergencyIntercom"> = {
  id: "intercom-left-2",
  kind: "emergencyIntercom",
  position: [-HALF_W + 0.03, 1.3, DOOR_CENTERS_Z[1] - SIDE_DOOR.width / 2 - 0.2],
  rotationY: Math.PI / 2,
  size: { x: 0.14, y: 0.2, z: 0.06 },
  mass: 1,
  mount: "wall",
  anchored: true,
  origin: "center",
  tipRisk: "low",
  restsOn: null,
};

/** 座席の上の窓（側面．座席の区画の中央） */
export const SIDE_WINDOW = {
  bottom: 0.95,
  top: 1.75,
  frameWidth: 0.04,
  frameDepth: 0.05,
  /** 7 人掛け・3 人掛けの上の窓の幅（開いた扉が戸袋に入る範囲と重ならない幅） */
  longWidth: 2.0,
  shortWidth: 1.0,
} as const;

export interface SideWindowDef {
  readonly id: string;
  readonly wall: WallDef;
  readonly opening: WallRect;
  /** 中央に縦桟を入れるか */
  readonly mullion: boolean;
}

export const SIDE_WINDOWS: readonly SideWindowDef[] = TRAIN_SIDES.flatMap((side) =>
  SEAT_SECTIONS.map((section, i) => {
    const width = section.persons > 3 ? SIDE_WINDOW.longWidth : SIDE_WINDOW.shortWidth;
    return {
      id: `window-${side}-${i + 1}`,
      wall: SIDE_WALLS[side],
      opening: {
        ...wallSpanAt(SIDE_WALLS[side], sideSign(side) * HALF_W, section.centerZ, width),
        v0: SIDE_WINDOW.bottom,
        v1: SIDE_WINDOW.top,
      },
      mullion: section.persons > 3,
    };
  }),
);

/** 網棚（座席の上．壁から張り出す）．y は棚板の中心の高さ */
export const RACK = {
  y: 1.8,
  depth: 0.28,
  thickness: 0.02,
} as const;

/** 網棚．id は rack-<側>-<座席番号>．座席と同じ区画・向き（ローカル X が長さ，+Z が通路側） */
export const TRAIN_RACKS: readonly FurnitureDef<"luggageRack">[] = TRAIN_SEATS.map((seat) => ({
  id: seat.id.replace("seat-", "rack-"),
  kind: "luggageRack",
  position: [sideSign(seat.side) * (HALF_W - RACK.depth / 2), RACK.y, seat.position[2]],
  rotationY: seat.rotationY,
  size: { x: seat.size.x - SEAT.armThickness * 2, y: RACK.thickness, z: RACK.depth },
  mass: 6,
  mount: "wall",
  anchored: true,
  origin: "center",
  tipRisk: "low",
  restsOn: null,
}));

/** 網棚の上面の高さ */
export const RACK_TOP = RACK.y + RACK.thickness / 2;

export type LuggageShape = "bag" | "box" | "backpack";

export interface LuggageDef extends FurnitureDef<"luggage"> {
  readonly shape: LuggageShape;
}

/**
 * 網棚の上の荷物（揺れで落とせるよう 1 つずつ独立）．rackId の網棚の上に，網棚の中心から
 * 長さ方向へ offset の位置に置く．向きは網棚と同じ（size.x が長さ方向，size.z ≦ 網棚の奥行き）
 */
function luggage(
  id: string,
  shape: LuggageShape,
  rackId: string,
  offset: number,
  size: Size3,
  mass: number,
): LuggageDef {
  const rack = TRAIN_RACKS.find((r) => r.id === rackId);
  if (!rack) throw new Error(`網棚がありません: ${rackId}`);
  const [x, , z] = localToCar(rack, [offset, 0, 0]);
  return {
    id,
    kind: "luggage",
    shape,
    position: [x, RACK_TOP, z],
    rotationY: rack.rotationY,
    size,
    mass,
    mount: "top",
    anchored: false,
    origin: "bottom",
    tipRisk: "high",
    restsOn: rackId,
  };
}

export const TRAIN_LUGGAGE: readonly LuggageDef[] = [
  luggage("luggage-1", "bag", "rack-left-2", -0.6, { x: 0.45, y: 0.28, z: 0.22 }, 5),
  luggage("luggage-2", "box", "rack-left-2", 0.5, { x: 0.35, y: 0.22, z: 0.25 }, 3),
  luggage("luggage-3", "backpack", "rack-right-2", 0.2, { x: 0.3, y: 0.38, z: 0.2 }, 6),
  luggage("luggage-4", "bag", "rack-left-3", 0.1, { x: 0.4, y: 0.25, z: 0.2 }, 4),
];

/**
 * 非常用ドアコック（蓋付きの小さな箱）．側面のドアごとに 1 つ，ドアの車端側の壁の下部に付ける．
 * Group 原点は箱の中心，正面（ローカル +Z）は車内．id は door-cock-<番号>
 */
export const DOOR_COCK = {
  width: 0.2,
  height: 0.14,
  depth: 0.05,
  /** 箱の中心の床からの高さ */
  centerY: 0.3,
  /** ドアの開口部の端から箱の中心までの距離 */
  edgeGap: 0.22,
  lidThickness: 0.01,
} as const;

export interface DoorCockDef extends FurnitureDef<"doorCock"> {
  readonly doorId: string;
}

export const DOOR_COCKS: readonly DoorCockDef[] = SIDE_DOORS.map((door, i) => {
  const side = door.side ?? "left";
  const centerZ = DOOR_CENTERS_Z[i % DOOR_CENTERS_Z.length];
  // 車端側（座席の区画の短い方）．ロングシートの前に重ならない
  const towardEnd = centerZ < 0 ? -1 : 1;
  return {
    id: `door-cock-${i + 1}`,
    kind: "doorCock",
    doorId: door.id,
    position: [
      sideSign(side) * (HALF_W - DOOR_COCK.depth / 2),
      DOOR_COCK.centerY,
      centerZ + towardEnd * (SIDE_DOOR.width / 2 + DOOR_COCK.edgeGap),
    ],
    rotationY: SIDE_WALLS[side].rotationY,
    size: { x: DOOR_COCK.width, y: DOOR_COCK.height, z: DOOR_COCK.depth },
    mass: 1.5,
    mount: "wall",
    anchored: true,
    origin: "center",
    tipRisk: "low",
    restsOn: null,
  };
});

/** ホーム（左の側面の外．ドアが開いたときに外が不自然にならないよう置く） */
export const PLATFORM = {
  side: "left",
  /** 車体の側面からホームの端までのすき間 */
  gap: 0.1,
  width: 3.5,
  length: 40,
  /** ホームの床の高さ（車内の床とほぼ同じ） */
  y: -0.02,
  /** 点字ブロックの帯（ホームの端から内側へ） */
  tactileOffset: 0.8,
  tactileWidth: 0.3,
} as const;

/** ドア上の案内表示 */
export const DOOR_DISPLAY = {
  width: 0.6,
  height: 0.16,
  depth: 0.06,
  centerY: 2.05,
} as const;

/** 中吊り広告（通路の中央に吊る．正面は ±Z） */
export const HANGING_AD = {
  width: 0.5,
  height: 0.35,
  thickness: 0.005,
  x: 0.28,
  top: 2.22,
  rowsZ: [-3.6, -1.2, 1.2, 3.6],
} as const;

/** 天井の照明（帯状の発光パネル 2 列．横の握り棒の支えと重ならない位置） */
export const CEILING_LIGHT = {
  x: 0.4,
  width: 0.14,
  thickness: 0.03,
  length: CAR.length - 0.4,
} as const;

/** 窓の外の景色の板（両側面から外へ distance．地面の高さは車内の床より下） */
export const OUTSIDE_BOARD = {
  distance: 4,
  length: 80,
  bottom: -6,
  height: 14,
  groundY: -1.1,
  /** 景色の模様 1 枚の長さ（板に繰り返し貼る） */
  tileLength: 20,
} as const;

/**
 * 開始位置．左の 2 番目のドア（door-left-2）の車端側の脇に立ち，すぐ左に縦の握り棒
 * （pole-door-left-2-rear）がある．前（-Z）を少し左へ向き，ドア・握り棒・つり革・座席が見える
 */
export const TRAIN_START = {
  position: [-0.92, EYE_HEIGHT.standing, 3.28],
  yaw: 0.25,
} as const;

export const TRAIN_BACKGROUND = 0xbcd6ea;

// ---- userData の形 ----

/** 座席の Group.userData */
export interface SeatUserData extends FurnitureUserData<SeatKind> {
  readonly side: TrainSide;
  readonly persons: number;
  /** 着座位置の一覧（座席の Group のローカル座標） */
  readonly slots: readonly SeatSlot[];
  /** 座ったときの向き（車体から見た yaw．0 で -Z，正で左へ回る） */
  readonly facingYaw: number;
}

/** 手すり（縦・横の握り棒）の Group.userData */
export interface HandrailUserData extends FurnitureUserData<"handrail"> {
  readonly orientation: HandrailOrientation;
  /** 手で握られているか（把持の処理は後の Issue） */
  grabbed: boolean;
}

/** つり革の Group.userData．Group 原点が支点（rotation.x / z で振り子状に揺らす想定） */
export interface StrapUserData {
  readonly id: string;
  readonly kind: "strap";
  readonly railId: string;
  /** 支点から輪の下端までの長さ（m） */
  readonly length: number;
  grabbed: boolean;
}

/** ドア 1 か所の Group.userData．Group 原点は開口部の下端中央，ローカル X が壁に沿う向き */
export interface DoorUserData {
  readonly id: string;
  readonly kind: TrainDoorKind;
  readonly side: TrainSide | null;
  readonly end: TrainEnd | null;
  /** 開口部の幅・高さ（全開で通れる大きさ） */
  readonly width: number;
  readonly height: number;
  readonly leafIds: readonly string[];
  /** 開き方（扉はすべて引き戸．移動の向き・量は各扉の DoorLeafUserData） */
  readonly openStyle: "slide";
  /** 開いているか（開閉の処理は後の Issue） */
  open: boolean;
}

/** 非常用ドアコックの Group.userData */
export interface DoorCockUserData extends FurnitureUserData<"doorCock"> {
  readonly doorId: string;
  /** 蓋の Group の name（蓋は上端を軸に rotation.x で開く想定） */
  readonly lidName: string;
  /** 操作されたか（蓋を開けてコックを引いた．操作の処理は後の Issue） */
  opened: boolean;
}

/** 荷物の Group.userData */
export interface LuggageUserData extends FurnitureUserData<"luggage"> {
  readonly shape: LuggageShape;
}

/** 扉 1 枚の Group.userData．位置は slidingLeafX(this, openAmount) で求める */
export interface DoorLeafUserData extends SlidingLeafDef {
  readonly id: string;
  readonly kind: "doorLeaf";
  readonly doorId: string;
  readonly size: Size3;
  /** 動かす軸（ドアの Group のローカル軸） */
  readonly slideAxis: "x";
  /** 開き具合（0 で閉，1 で全開） */
  openAmount: number;
}
