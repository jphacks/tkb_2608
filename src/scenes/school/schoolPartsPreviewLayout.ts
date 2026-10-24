// 確認用の空間（?scene=school-parts）に並べるパーツの一覧（three に依存しない純粋なデータと関数）．
// 大きさの違う 2 棟（A: 天井 3m・廊下の幅 3m，B: 天井 2.6m・廊下の幅 2.4m）を並べ，同じパーツを
// 2 種類以上の大きさで見比べられるようにする．各棟に正方形と長方形の教室を 1 つずつ置き，
// A は正方形が中身あり・長方形が外側だけ，B はその逆にする．マス目データからの組み立ては #67 の後の別の Issue

import type { ClassroomInterior } from "./classroomLayout";
import {
  type EdgeKind,
  edgePlacementBetween,
  type FloorKind,
  minEdgeLength,
  type PartPlacement,
  type WindowGlass,
  type XZPoint,
} from "./schoolLayout";

/** 並べるパーツ 1 つ */
export type PreviewPart =
  | {
      readonly type: "floor";
      readonly id: string;
      readonly kind: FloorKind;
      readonly width: number;
      readonly depth: number;
      readonly ceilingHeight: number;
      readonly placement: PartPlacement;
    }
  | {
      readonly type: "classroom";
      readonly id: string;
      readonly width: number;
      readonly depth: number;
      readonly ceilingHeight: number;
      readonly interior: ClassroomInterior;
      readonly placement: PartPlacement;
    }
  | {
      readonly type: "edge";
      readonly id: string;
      readonly kind: EdgeKind;
      readonly length: number;
      readonly height: number;
      readonly glass?: WindowGlass;
      readonly locked?: boolean;
      readonly closed?: boolean;
      readonly placement: PartPlacement;
    }
  | {
      readonly type: "post";
      readonly id: string;
      readonly height: number;
      readonly placement: PartPlacement;
    };

/** 1 棟の大きさ（m） */
export interface PreviewBlockSpec {
  readonly id: string;
  /** 棟の原点（-X・-Z の角．教室の北の壁と西の壁の交点ではなく，廊下の北の線の西の端） */
  readonly originX: number;
  readonly originZ: number;
  readonly ceilingHeight: number;
  readonly corridorWidth: number;
  /** 正方形の教室の一辺（西の端） */
  readonly squareSize: number;
  /** 長方形の教室の幅（黒板の壁に沿う．南北）と奥行き（黒板から後ろ．東西） */
  readonly rectWidth: number;
  readonly rectDepth: number;
  /** 正方形の教室が中身ありか（長方形は逆） */
  readonly squareInterior: ClassroomInterior;
  /** 防火シャッターを閉じた状態で始めるか */
  readonly shutterClosed: boolean;
}

/** 並べる 2 棟 */
export const PREVIEW_BLOCKS: readonly PreviewBlockSpec[] = [
  {
    id: "a",
    originX: 0,
    originZ: 0,
    ceilingHeight: 3,
    corridorWidth: 3,
    squareSize: 8,
    rectWidth: 7,
    rectDepth: 9,
    squareInterior: "furnished",
    shutterClosed: true,
  },
  {
    id: "b",
    originX: 24,
    originZ: 0,
    ceilingHeight: 2.6,
    corridorWidth: 2.4,
    squareSize: 6,
    rectWidth: 5,
    rectDepth: 7,
    squareInterior: "shell",
    shutterClosed: false,
  },
];

/**
 * 開始位置（2 棟の間の外．北（-Z）を向く）．正面の左に棟 A，右に棟 B の南の面（窓・出口）が見える．
 * 出口から廊下へ入ると，ドア・シャッター・教室を順に見て回れる
 */
export const PREVIEW_START = { x: 20.5, z: 9, yaw: 0 } as const;

/** 目の高さ（m．立ち・しゃがみ．しゃがみは煙の下をくぐる姿勢の目安） */
export const PREVIEW_EYE_HEIGHT = { standing: 1.6, crouching: 0.9 } as const;

/** 黒板を東に向ける教室の回転（ローカル -Z（黒板）が東 +X を向く．窓（北）が生徒の左，廊下（南）が右） */
const BLACKBOARD_EAST = -Math.PI / 2;

function keyOf(p: XZPoint): string {
  return `${p.x.toFixed(3)},${p.z.toFixed(3)}`;
}

/**
 * 1 棟分のパーツ．教室は廊下（東西に伸びる）の北に並べ，廊下の南は外に面する（窓・出口）．
 * 辺は from → to の右手が +Z（ドアの扉の側・出口の内側）になるように向きを決め，端点に柱を置く
 */
export function previewBlockParts(spec: PreviewBlockSpec): PreviewPart[] {
  const h = spec.ceilingHeight;
  const ox = spec.originX;
  const oz = spec.originZ;
  const s = spec.squareSize;
  // 長方形の教室は黒板を東に向けるため，東西の長さが奥行き，南北の長さが幅
  const rx = spec.rectDepth;
  const rz = spec.rectWidth;
  const totalX = s + rx;
  const cw = spec.corridorWidth;
  const rectInterior: ClassroomInterior =
    spec.squareInterior === "furnished" ? "shell" : "furnished";
  const p = (x: number, z: number): XZPoint => ({ x: ox + x, z: oz + z });
  const parts: PreviewPart[] = [];
  const vertices = new Map<string, XZPoint>();

  const edge = (
    name: string,
    kind: EdgeKind,
    from: XZPoint,
    to: XZPoint,
    extra: { glass?: WindowGlass; locked?: boolean; closed?: boolean } = {},
  ): void => {
    const { placement, length } = edgePlacementBetween(from, to);
    parts.push({
      type: "edge",
      id: `${spec.id}-${name}`,
      kind,
      length,
      height: h,
      placement,
      ...extra,
    });
    vertices.set(keyOf(from), from);
    vertices.set(keyOf(to), to);
  };

  // 教室（原点は床の中心）
  const classroomPart = (
    name: string,
    width: number,
    depth: number,
    interior: ClassroomInterior,
    center: XZPoint,
  ): void => {
    parts.push({
      type: "classroom",
      id: `${spec.id}-${name}`,
      width,
      depth,
      ceilingHeight: h,
      interior,
      placement: { ...center, rotationY: BLACKBOARD_EAST },
    });
  };
  classroomPart("square", s, s, spec.squareInterior, p(s / 2, -s / 2));
  classroomPart("rect", rz, rx, rectInterior, p(s + rx / 2, -rz / 2));

  // 廊下の床（2 枚に分け，シャッターの両側で大きさを変える）
  for (const [name, x0, x1] of [
    ["corridor-west", 0, s],
    ["corridor-east", s, totalX],
  ] as const) {
    parts.push({
      type: "floor",
      id: `${spec.id}-${name}`,
      kind: "corridor",
      width: x1 - x0,
      depth: cw,
      ceilingHeight: h,
      placement: { ...p((x0 + x1) / 2, cw / 2), rotationY: 0 },
    });
  }

  // 中身ありの教室の廊下側は透明，外側だけの教室はすりガラス・開かないドア
  const corridorSide = (interior: ClassroomInterior) =>
    interior === "shell"
      ? { glass: "frosted" as const, locked: true }
      : { glass: "clear" as const, locked: false };

  // 正方形の教室の廊下側（z = 0．西から東へ進むと右手（+Z）が廊下）: 後ろのドア・窓・前のドア
  const sq = corridorSide(spec.squareInterior);
  // ドアの辺は下限（minEdgeLength("door")）を下回らないようにし，残りを窓付きの壁にする
  const doorLen = Math.min(3, Math.max(minEdgeLength("door"), s / 3));
  edge("square-door-back", "door", p(0, 0), p(doorLen, 0), sq);
  edge("square-corridor-window", "windowWall", p(doorLen, 0), p(s - doorLen, 0), sq);
  edge("square-door-front", "door", p(s - doorLen, 0), p(s, 0), sq);
  // 長方形の教室の廊下側
  const re = corridorSide(rectInterior);
  const rectDoorLen = Math.min(3, Math.max(minEdgeLength("door"), rx / 3));
  edge("rect-door-back", "door", p(s, 0), p(s + rectDoorLen, 0), re);
  edge("rect-corridor-window", "windowWall", p(s + rectDoorLen, 0), p(totalX - rectDoorLen, 0), re);
  edge("rect-door-front", "door", p(totalX - rectDoorLen, 0), p(totalX, 0), re);

  // 教室の北（外に面する窓．2 枚に分けて長さの違う窓付きの壁を並べる）
  edge("square-north-1", "windowWall", p(s / 2, -s), p(0, -s));
  edge("square-north-2", "windowWall", p(s, -s), p(s / 2, -s));
  edge("rect-north-1", "windowWall", p(s + rx / 2, -rz), p(s, -rz));
  edge("rect-north-2", "windowWall", p(totalX, -rz), p(s + rx / 2, -rz));
  // 西・東の壁と，2 つの教室の間の壁（長方形の教室の北の壁が交わる点で区切る）
  edge("square-west", "wall", p(0, 0), p(0, -s));
  edge("rect-east", "wall", p(totalX, -rz), p(totalX, 0));
  if (s > rz) {
    edge("between-north", "wall", p(s, -s), p(s, -rz));
  }
  edge("between", "wall", p(s, -Math.min(s, rz)), p(s, 0));
  if (rz > s) {
    edge("between-north", "wall", p(s, -rz), p(s, -s));
  }

  // 廊下の両端の壁と防火シャッター（2 つの教室の境の線の上）
  edge("corridor-west-end", "wall", p(0, cw), p(0, 0));
  edge("corridor-east-end", "wall", p(totalX, 0), p(totalX, cw));
  edge("shutter", "fireShutter", p(s, 0), p(s, cw), { closed: spec.shutterClosed });

  // 廊下の南（外に面する窓と出口．東から西へ進むと右手（+Z）が廊下の内側）
  const exitLen = Math.min(4, rx / 2);
  const exitX0 = s + (rx - exitLen) / 2;
  edge("south-1", "windowWall", p(s / 2, cw), p(0, cw));
  edge("south-2", "windowWall", p(s, cw), p(s / 2, cw));
  edge("south-3", "windowWall", p(exitX0, cw), p(s, cw));
  edge("exit", "exit", p(exitX0 + exitLen, cw), p(exitX0, cw));
  edge("south-4", "windowWall", p(totalX, cw), p(exitX0 + exitLen, cw));

  let i = 0;
  for (const v of vertices.values()) {
    i += 1;
    parts.push({
      type: "post",
      id: `${spec.id}-post-${i}`,
      height: h,
      placement: { x: v.x, z: v.z, rotationY: 0 },
    });
  }
  return parts;
}

/** 確認用の空間に並べるパーツの全部 */
export function previewParts(): PreviewPart[] {
  return PREVIEW_BLOCKS.flatMap(previewBlockParts);
}

/** 外の地面の範囲（両棟の周り．体の中心が動ける範囲にも使う） */
export const PREVIEW_GROUND = { minX: -8, maxX: 48, minZ: -16, maxZ: 12 } as const;
