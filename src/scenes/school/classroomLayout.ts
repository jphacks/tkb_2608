// 教室の中身（黒板・教卓・机と椅子）の寸法と並び，当たり判定の範囲（three に依存しない純粋な型・関数）．
// 教室は幅（黒板の壁に沿うローカル X）と奥行き（黒板から後ろの壁へ向かうローカル Z）を受け取り，
// 机の列数は幅から，行数は奥行きから決める．原点は教室の床の面の中心で，黒板は -Z の端の壁に付き，
// 生徒は -Z（黒板）を向いて座る．壁は辺に置く物として別に置く前提で，壁の厚みの半分だけ内側を使う

import type { Obstacle, XZRect } from "../walk/collision";
import { type BoxSpec, LENGTH_EPSILON, WALL_THICKNESS } from "./schoolLayout";

/** 教室の中身の有無．shell（外側だけ）は机と椅子・黒板・教卓を置かない（床・天井と周りの壁は同じ） */
export type ClassroomInterior = "furnished" | "shell";

/** 児童用の机（m．JIS S 1021 の高学年向けの大きさ程度） */
export const DESK = {
  width: 0.65,
  depth: 0.45,
  height: 0.7,
  topThickness: 0.025,
} as const;

/** 児童用の椅子（m）．机の後ろ（+Z）に置き，座面の前を机の下へ tuck だけ入れる */
export const CHAIR = {
  width: 0.4,
  depth: 0.4,
  seatHeight: 0.42,
  backHeight: 0.8,
  tuck: 0.05,
} as const;

/** 机 1 組（机と椅子）の奥行き（m） */
export const DESK_SET_DEPTH = DESK.depth + CHAIR.depth - CHAIR.tuck;

/**
 * 机の並べ方（m）．pitchX・pitchZ は机の中心の間隔，sideAisle は左右の壁と端の机の間の最小の通路，
 * frontZone は黒板の壁から 1 行目の机の前端まで（教卓と先生の通路），backZone は最後の椅子の後ろの最小の通路
 */
export const DESK_GRID = {
  pitchX: 1.1,
  pitchZ: 1.1,
  sideAisle: 0.6,
  frontZone: 1.8,
  backZone: 0.7,
} as const;

/** 黒板（m）．幅は教室の幅に合わせて maxWidth まで広げる */
export const BLACKBOARD = {
  maxWidth: 3.6,
  minWidth: 1.8,
  /** 黒板の左右の端と壁の間に残す最小の幅 */
  sideMargin: 0.3,
  height: 1.2,
  bottom: 0.85,
  thickness: 0.03,
  frameWidth: 0.04,
  trayDepth: 0.07,
} as const;

/** 教卓（m）．黒板の前，distanceFromBoard だけ離して中央に置く */
export const TEACHER_DESK = {
  width: 0.9,
  depth: 0.6,
  height: 0.9,
  distanceFromBoard: 0.6,
} as const;

/** 中身を置ける教室の幅の下限（m）．これより狭ければ中身を置かない（外側だけと同じ） */
export const MIN_CLASSROOM_WIDTH =
  WALL_THICKNESS +
  Math.max(2 * DESK_GRID.sideAisle + DESK.width, BLACKBOARD.minWidth + 2 * BLACKBOARD.sideMargin);

/** 中身を置ける教室の奥行きの下限（m）．これより浅ければ中身を置かない */
export const MIN_CLASSROOM_DEPTH =
  WALL_THICKNESS + DESK_GRID.frontZone + DESK_SET_DEPTH + DESK_GRID.backZone;

/** 机 1 組の位置（机の中心．ローカル座標の床の上） */
export interface DeskSpot {
  readonly id: string;
  /** 黒板に近い順に 0 から */
  readonly row: number;
  /** -X の側から 0 から */
  readonly column: number;
  readonly x: number;
  readonly z: number;
}

/** 黒板の配置（中心のローカル X は 0．face は黒板が付く壁の面のローカル Z） */
export interface BlackboardLayout {
  readonly width: number;
  readonly face: number;
}

/** 教室の中身の並び */
export interface ClassroomLayout {
  readonly width: number;
  readonly depth: number;
  readonly interior: ClassroomInterior;
  /** 中身を置いたか（shell，または幅・奥行きが下限より小さければ false） */
  readonly furnished: boolean;
  /** 壁の内側の床の範囲（ローカル座標） */
  readonly inner: XZRect;
  readonly columns: number;
  readonly rows: number;
  readonly desks: readonly DeskSpot[];
  readonly blackboard: BlackboardLayout | null;
  /** 教卓の中心（ローカル座標．置かなければ null） */
  readonly teacherDesk: { readonly x: number; readonly z: number } | null;
}

/** 長さ available の中に，大きさ size の物を間隔 pitch で並べられる数（入らなければ 0） */
export function countAlong(available: number, size: number, pitch: number): number {
  // 下限ちょうどの教室で浮動小数の誤差（0.7999… < 0.8）により 1 つも置けなくならないようにする
  if (!(available >= size - LENGTH_EPSILON)) return 0;
  return Math.max(0, Math.floor((available - size + LENGTH_EPSILON) / pitch)) + 1;
}

/**
 * 教室（幅 width × 奥行き depth）の中身の並び．interior が shell，または幅・奥行きが
 * MIN_CLASSROOM_WIDTH・MIN_CLASSROOM_DEPTH より小さければ何も置かない．
 * 幅・奥行きが壁の厚み以下・数でなければ RangeError
 */
export function classroomLayout(
  width: number,
  depth: number,
  interior: ClassroomInterior = "furnished",
): ClassroomLayout {
  for (const [name, value] of [
    ["教室の幅", width],
    ["教室の奥行き", depth],
  ] as const) {
    if (!Number.isFinite(value) || value <= WALL_THICKNESS) {
      throw new RangeError(`${name} は ${WALL_THICKNESS} m より大きくしてください: ${value}`);
    }
  }
  const half = WALL_THICKNESS / 2;
  const inner: XZRect = {
    minX: -width / 2 + half,
    maxX: width / 2 - half,
    minZ: -depth / 2 + half,
    maxZ: depth / 2 - half,
  };
  const empty: ClassroomLayout = {
    width,
    depth,
    interior,
    furnished: false,
    inner,
    columns: 0,
    rows: 0,
    desks: [],
    blackboard: null,
    teacherDesk: null,
  };
  if (interior === "shell" || width < MIN_CLASSROOM_WIDTH || depth < MIN_CLASSROOM_DEPTH) {
    return empty;
  }

  const innerWidth = inner.maxX - inner.minX;
  const innerDepth = inner.maxZ - inner.minZ;
  const columns = countAlong(innerWidth - 2 * DESK_GRID.sideAisle, DESK.width, DESK_GRID.pitchX);
  const rows = countAlong(
    innerDepth - DESK_GRID.frontZone - DESK_GRID.backZone,
    DESK_SET_DEPTH,
    DESK_GRID.pitchZ,
  );
  // 列は左右の中央にそろえ，行は前（黒板の側）から詰める（余りは後ろの通路になる）
  const firstX = (-(columns - 1) * DESK_GRID.pitchX) / 2;
  const firstZ = inner.minZ + DESK_GRID.frontZone + DESK.depth / 2;
  const desks: DeskSpot[] = [];
  for (let row = 0; row < rows; row++) {
    for (let column = 0; column < columns; column++) {
      desks.push({
        id: `desk-${row + 1}-${column + 1}`,
        row,
        column,
        x: firstX + column * DESK_GRID.pitchX,
        z: firstZ + row * DESK_GRID.pitchZ,
      });
    }
  }
  return {
    ...empty,
    furnished: true,
    columns,
    rows,
    desks,
    blackboard: {
      width: Math.min(BLACKBOARD.maxWidth, innerWidth - 2 * BLACKBOARD.sideMargin),
      face: inner.minZ,
    },
    teacherDesk: {
      x: 0,
      z: inner.minZ + TEACHER_DESK.distanceFromBoard + TEACHER_DESK.depth / 2,
    },
  };
}

/** 机の椅子の中心のローカル Z（机の後ろ） */
export function chairZ(desk: Pick<DeskSpot, "z">): number {
  return desk.z + DESK.depth / 2 + CHAIR.depth / 2 - CHAIR.tuck;
}

/** 机 1 組を作る直方体（材質ごと．ローカル座標） */
export interface DeskSetBoxes {
  /** 天板・椅子の座面と背もたれ（木） */
  readonly wood: readonly BoxSpec[];
  /** 机の脚・椅子の脚（金属） */
  readonly metal: readonly BoxSpec[];
  /** 天板の下の道具入れ */
  readonly storage: readonly BoxSpec[];
}

/** 机 1 組（机と椅子）の直方体 */
export function deskSetBoxes(desk: Pick<DeskSpot, "x" | "z">): DeskSetBoxes {
  const { x, z } = desk;
  const legHeight = DESK.height - DESK.topThickness;
  const cz = chairZ(desk);
  const seatY = CHAIR.seatHeight;
  const legX = CHAIR.width / 2 - 0.03;
  const legZ = CHAIR.depth / 2 - 0.03;
  const leg = 0.022;
  return {
    wood: [
      {
        size: [DESK.width, DESK.topThickness, DESK.depth],
        position: [x, DESK.height - DESK.topThickness / 2, z],
      },
      { size: [CHAIR.width, 0.025, CHAIR.depth], position: [x, seatY, cz] },
      {
        size: [CHAIR.width - 0.02, 0.22, 0.02],
        position: [x, CHAIR.backHeight - 0.11, cz + CHAIR.depth / 2 - 0.01],
      },
    ],
    metal: [
      ...[-1, 1].map(
        (side): BoxSpec => ({
          size: [0.03, legHeight, DESK.depth - 0.04],
          position: [x + side * (DESK.width / 2 - 0.03), legHeight / 2, z],
        }),
      ),
      // 椅子の脚（後ろの 2 本は背もたれの下端まで伸ばす）
      ...[-1, 1].flatMap((sx) => [
        {
          size: [leg, seatY, leg] as const,
          position: [x + sx * legX, seatY / 2, cz - legZ] as const,
        },
        {
          size: [leg, CHAIR.backHeight - 0.22, leg] as const,
          position: [x + sx * legX, (CHAIR.backHeight - 0.22) / 2, cz + legZ] as const,
        },
      ]),
    ],
    storage: [
      {
        size: [DESK.width - 0.1, 0.1, DESK.depth - 0.08],
        position: [x, DESK.height - DESK.topThickness - 0.05, z],
      },
    ],
  };
}

/** 教卓の直方体（天板と，生徒の側（+Z）の前板・左右の側板．ローカル座標） */
export function teacherDeskBoxes(center: { readonly x: number; readonly z: number }): {
  readonly top: BoxSpec;
  readonly panels: readonly BoxSpec[];
} {
  const { width, depth, height } = TEACHER_DESK;
  const t = 0.03;
  const panelHeight = height - t;
  return {
    top: { size: [width, t, depth], position: [center.x, height - t / 2, center.z] },
    panels: [
      {
        size: [width, panelHeight - 0.05, 0.02],
        position: [center.x, 0.05 + (panelHeight - 0.05) / 2, center.z + depth / 2 - 0.01],
      },
      ...[-1, 1].map(
        (side): BoxSpec => ({
          size: [0.02, panelHeight, depth],
          position: [center.x + side * (width / 2 - 0.01), panelHeight / 2, center.z],
        }),
      ),
    ],
  };
}

/** 黒板の直方体（板・枠・粉受け．ローカル座標） */
export function blackboardBoxes(board: BlackboardLayout): {
  readonly board: BoxSpec;
  readonly frame: readonly BoxSpec[];
} {
  const { height, bottom, thickness, frameWidth: f, trayDepth } = BLACKBOARD;
  const w = board.width;
  const z = board.face + thickness / 2;
  const cy = bottom + height / 2;
  const fz = board.face + (thickness + 0.01) / 2;
  const ft = thickness + 0.01;
  return {
    board: { size: [w, height, thickness], position: [0, cy, z] },
    frame: [
      { size: [w + 2 * f, f, ft], position: [0, bottom + height + f / 2, fz] },
      { size: [f, height, ft], position: [-w / 2 - f / 2, cy, fz] },
      { size: [f, height, ft], position: [w / 2 + f / 2, cy, fz] },
      // 粉受け（下の枠を兼ねる）
      {
        size: [w + 2 * f, 0.03, trayDepth],
        position: [0, bottom - 0.015, board.face + trayDepth / 2],
      },
    ],
  };
}

/** 教室の中身の当たり判定（ローカル座標．id は `${id}-desk-1-1` 等） */
export function classroomObstacles(layout: ClassroomLayout, id: string): Obstacle[] {
  const obstacles: Obstacle[] = [];
  for (const desk of layout.desks) {
    obstacles.push({
      id: `${id}-${desk.id}`,
      minX: desk.x - DESK.width / 2,
      maxX: desk.x + DESK.width / 2,
      minZ: desk.z - DESK.depth / 2,
      maxZ: desk.z + DESK.depth / 2,
      minY: 0,
      maxY: DESK.height,
    });
    const cz = chairZ(desk);
    obstacles.push({
      id: `${id}-${desk.id}-chair`,
      minX: desk.x - CHAIR.width / 2,
      maxX: desk.x + CHAIR.width / 2,
      minZ: cz - CHAIR.depth / 2,
      maxZ: cz + CHAIR.depth / 2,
      minY: 0,
      maxY: CHAIR.backHeight,
    });
  }
  if (layout.teacherDesk) {
    const { x, z } = layout.teacherDesk;
    obstacles.push({
      id: `${id}-teacher-desk`,
      minX: x - TEACHER_DESK.width / 2,
      maxX: x + TEACHER_DESK.width / 2,
      minZ: z - TEACHER_DESK.depth / 2,
      maxZ: z + TEACHER_DESK.depth / 2,
      minY: 0,
      maxY: TEACHER_DESK.height,
    });
  }
  if (layout.blackboard) {
    const w = layout.blackboard.width / 2 + BLACKBOARD.frameWidth;
    obstacles.push({
      id: `${id}-blackboard`,
      minX: -w,
      maxX: w,
      minZ: layout.blackboard.face,
      maxZ: layout.blackboard.face + BLACKBOARD.trayDepth,
      minY: BLACKBOARD.bottom - 0.03,
      maxY: BLACKBOARD.bottom + BLACKBOARD.height + BLACKBOARD.frameWidth,
    });
  }
  return obstacles;
}

/** 教室の中身の userData（Group の userData に入れる） */
export interface ClassroomUserData {
  readonly kind: "schoolClassroom";
  readonly id: string;
  readonly width: number;
  readonly depth: number;
  readonly ceilingHeight: number;
  readonly interior: ClassroomInterior;
  readonly furnished: boolean;
  readonly columns: number;
  readonly rows: number;
}
