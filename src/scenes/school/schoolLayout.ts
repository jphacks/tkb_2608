// 校舎のパーツ（床の面・辺に置く物・柱）の寸法・配置・当たり判定の範囲（three に依存しない純粋な型・関数）．
// 各パーツは大きさ（面は幅と奥行き，辺に置く物は辺の長さ，どちらも天井の高さ）を引数で受け取り，
// そこから寸法・配置を出す．ドア・窓等の開口部は実寸のまま固定し，壁の残りの部分が伸び縮みする
//
// 原点と向きの約束（パーツのローカル座標．Y が上，単位は m）:
// - 床の面（教室・廊下）: 原点は面の中心の床の上．幅が X，奥行きが Z（-width/2〜width/2，-depth/2〜depth/2）
// - 教室の中身: 床の面と同じ原点．黒板は -Z の端の壁に付き，生徒は -Z（黒板）を向いて座る
// - 辺に置く物（壁・窓付きの壁・ドア・出口・シャッター）: 原点は辺の中心の床の上．辺はローカル X に沿い
//   -length/2〜length/2，壁の厚みは辺の線を中心に Z の ±WALL_THICKNESS/2．ただし壁の板は両端の
//   柱の半分（POST_SIZE/2）を除いた範囲に置く．引き戸の扉は +Z の側，出口の外（ポーチ・庇）は -Z の側
// - 柱: 原点は辺の端点（マス目の格子点）の床の上．POST_SIZE 四方
// 辺が交わる・つながる点で辺を区切り，その点に柱を 1 本置けば，壁どうしに隙間も重なりも出ない

import type { Vec3Tuple } from "../common/furniture";
import { splitWallAroundOpenings, type WallDef, type WallRect } from "../common/wallLayout";
import type { Obstacle, XZRect } from "../walk/collision";
import { localToParentXZ, wallRectObstacle } from "../walk/obstacles";

/**
 * マス目 1 つの一辺の長さの既定値（m．仮の提案）．廊下の幅（建築基準法施行令 119 条の 1.8〜2.3m 以上，
 * 実際の校舎で 2.5〜3m 程度）より少し広く，標準的な教室（8m × 8m・7m × 9m）を 2 × 2 マスで表せる値．
 * パーツはこの値に直接依存せず，組み立て側が渡す大きさから寸法を出す
 */
export const DEFAULT_CELL_SIZE = 4;

/** 天井の高さの既定値（m．仮の提案）．小学校の教室で一般的な 3m */
export const DEFAULT_CEILING_HEIGHT = 3;

/** 天井の高さの下限（m）．防火シャッターの収納箱の下にくぐり戸（高さ 1.9m）が収まる高さ */
export const MIN_CEILING_HEIGHT = 2.5;

/** 壁の厚み（m）．教室と廊下の間の間仕切り壁程度 */
export const WALL_THICKNESS = 0.12;

/** 柱（辺の端点に置く角柱）の一辺（m）．壁の厚みと同じにし，壁の端と面をそろえる */
export const POST_SIZE = WALL_THICKNESS;

/** 床の面の幅・奥行きの下限（m） */
export const MIN_FLOOR_SIZE = 0.5;

/** 直方体 1 つ（大きさと中心の位置．meshHelpers の BoxPlacement と同じ形） */
export interface BoxSpec {
  readonly size: Vec3Tuple;
  readonly position: Vec3Tuple;
}

/**
 * 長さの比較の許容誤差（m）．下限を寸法の和で出すと浮動小数の誤差で下限ちょうどの値を
 * 拒んでしまう（例: 2.32 が 2.3200000000000003 未満になる）ため，これだけの差は等しいとみなす
 */
export const LENGTH_EPSILON = 1e-9;

function requireAtLeast(name: string, value: number, min: number): void {
  if (!Number.isFinite(value) || value < min - LENGTH_EPSILON) {
    throw new RangeError(`${name} は ${min} m 以上にしてください: ${value}`);
  }
}

/** 天井の高さが範囲内かを確かめる（範囲外は RangeError） */
export function assertCeilingHeight(height: number): void {
  requireAtLeast("天井の高さ", height, MIN_CEILING_HEIGHT);
}

/** ratio を丸めた 1 以上の整数（数でなければ 1．Math.max(1, NaN) は NaN になるため） */
function atLeastOneCount(ratio: number): number {
  const n = Math.round(ratio);
  return Number.isFinite(n) ? Math.max(1, n) : 1;
}

/**
 * 繰り返しのテクスチャを extent（m）に貼るときの枚数．整数にして，同じ大きさの面を並べた時に
 * 継ぎ目で模様がつながるようにする（1 枚の大きさは tileSize から少しずれる）
 */
export function tileRepeat(extent: number, tileSize: number): number {
  return atLeastOneCount(extent / tileSize);
}

// ---------------------------------------------------------------------------
// 床の面（教室・廊下の床と天井）

/** 床の面の種類（見た目を分ける） */
export type FloorKind = "classroom" | "corridor";

/** 天井の照明 1 灯の大きさ（m．ローカル X に長い 2 灯用の蛍光灯の器具） */
export const CEILING_LIGHT = { length: 1.25, width: 0.22, thickness: 0.06 } as const;

/** 天井の照明を並べる間隔の目安（m）．面の幅・奥行きをこれで割った数（1 以上）だけ並べる */
export const CEILING_LIGHT_PITCH: Readonly<Record<FloorKind, number>> = {
  classroom: 2,
  corridor: 3.5,
};

/** 床の面の寸法と，天井の照明の配置 */
export interface FloorSurfaceLayout {
  readonly kind: FloorKind;
  readonly width: number;
  readonly depth: number;
  readonly ceilingHeight: number;
  /** 床の範囲（ローカル座標）．体の中心が動ける範囲にも使う */
  readonly rect: XZRect;
  /** 天井の照明の器具（ローカル座標）．面が器具より小さい向きがあれば空 */
  readonly lights: readonly BoxSpec[];
}

/** 面の extent（m）に，間隔 pitch の目安で並べる数（1 以上） */
export function lightCount(extent: number, pitch: number): number {
  return atLeastOneCount(extent / pitch);
}

/** 床の面（幅 width × 奥行き depth・天井の高さ ceilingHeight）の寸法と照明の配置 */
export function floorSurfaceLayout(
  kind: FloorKind,
  width: number,
  depth: number,
  ceilingHeight: number,
): FloorSurfaceLayout {
  requireAtLeast("床の幅", width, MIN_FLOOR_SIZE);
  requireAtLeast("床の奥行き", depth, MIN_FLOOR_SIZE);
  assertCeilingHeight(ceilingHeight);
  const pitch = CEILING_LIGHT_PITCH[kind];
  const lights: BoxSpec[] = [];
  // 器具が壁にかからない大きさの面にだけ付ける
  if (width >= CEILING_LIGHT.length + WALL_THICKNESS && depth >= CEILING_LIGHT.width * 2) {
    const nx = lightCount(width, pitch);
    const nz = lightCount(depth, pitch);
    const y = ceilingHeight - CEILING_LIGHT.thickness / 2;
    for (let i = 0; i < nx; i++) {
      for (let j = 0; j < nz; j++) {
        lights.push({
          size: [CEILING_LIGHT.length, CEILING_LIGHT.thickness, CEILING_LIGHT.width],
          position: [((i + 0.5) / nx - 0.5) * width, y, ((j + 0.5) / nz - 0.5) * depth],
        });
      }
    }
  }
  return {
    kind,
    width,
    depth,
    ceilingHeight,
    rect: { minX: -width / 2, maxX: width / 2, minZ: -depth / 2, maxZ: depth / 2 },
    lights,
  };
}

// ---------------------------------------------------------------------------
// 辺に置く物（壁・窓付きの壁・ドア・出口・防火シャッター）

/** 辺に置く物の種類 */
export type EdgeKind = "wall" | "windowWall" | "door" | "exit" | "fireShutter";

/** 窓のガラス（透明・すりガラス．すりガラスは外側だけの教室の廊下側に使い，中を見せない） */
export type WindowGlass = "clear" | "frosted";

/** 窓（引き違い窓 1 か所）．幅・高さは実寸で固定し，辺の長さに応じて数を変える（m） */
export const WINDOW = {
  width: 1.6,
  sill: 0.9,
  height: 1.5,
  /** 窓と窓・窓と壁の端の間に残す壁の最小の幅 */
  minPier: 0.2,
  /** 窓の上端と天井の間に残す最小の高さ（天井が低い時は窓の上端を下げる） */
  minHeadroom: 0.2,
  /** 窓の高さの下限（天井が低くてこれより低くなるなら窓を付けない） */
  minHeight: 0.5,
  frameWidth: 0.05,
} as const;

/** 教室の引き戸 1 枚（m）．開口部の幅・高さは実寸で固定 */
export const DOOR = {
  width: 1.0,
  height: 2.0,
  /** 開口部と壁の端の間に残す壁の最小の幅 */
  minPier: 0.1,
  leafThickness: 0.04,
  /** 扉が開口部の枠にかかる幅（左右それぞれの半分ずつ） */
  leafOverlap: 0.04,
  frameWidth: 0.06,
} as const;

/** 出口（昇降口）．扉は開け放した開口部として作る（m） */
export const EXIT = {
  width: 2.4,
  height: 2.2,
  minPier: 0.1,
  frameWidth: 0.08,
  /** 外（-Z の側）のポーチの奥行き．外へ出たことの判定（outsideRect）にも使う */
  apronDepth: 1.5,
  /** 庇の奥行き・厚み・開口部の上端からの高さ */
  canopyDepth: 1.5,
  canopyThickness: 0.12,
  canopyRise: 0.3,
  /** 開口部の上の誘導灯の大きさ */
  signWidth: 0.4,
  signHeight: 0.15,
} as const;

/** 防火シャッター（m）．くぐり戸は建設省告示 1369 号（幅 75cm 以上・高さ 1.8m 以上・下端 15cm 以下）に合わせる */
export const FIRE_SHUTTER = {
  /** 天井に付く収納箱（シャッターを巻き取る）の高さ・奥行き */
  boxHeight: 0.4,
  boxDepth: 0.35,
  curtainThickness: 0.03,
  /** 両端のガイドレール（壁の板の範囲の内側） */
  railWidth: 0.08,
  railDepth: 0.14,
  wicketWidth: 0.8,
  wicketHeight: 1.9,
  wicketBottom: 0.05,
  /** くぐり戸とガイドレールの間に残す最小の幅 */
  wicketMargin: 0.1,
} as const;

/** 辺の長さから，両端の柱の半分を除いた壁の板の長さ（m） */
export function edgeWallLength(length: number): number {
  return length - POST_SIZE;
}

/** 壁の板の上の位置 u（壁の左端（-X の端）からの距離）をローカル X に変換する */
export function edgeLocalX(length: number, u: number): number {
  return -edgeWallLength(length) / 2 + u;
}

/**
 * 辺に置く物ごとの辺の長さの下限（m）．開口部（実寸）と最小の壁の幅が入る長さ．
 * 窓付きの壁は窓が 1 つも入らなければ無地の壁になるため，無地の壁と同じ
 */
export function minEdgeLength(kind: EdgeKind): number {
  switch (kind) {
    case "wall":
    case "windowWall":
      return POST_SIZE + 0.1;
    case "door":
      // 開口部と，開いた扉が収まる壁（開口部の +X の側）
      return POST_SIZE + 2 * DOOR.width + 2 * DOOR.minPier;
    case "exit":
      return POST_SIZE + EXIT.width + 2 * EXIT.minPier;
    case "fireShutter":
      return (
        POST_SIZE +
        2 * (FIRE_SHUTTER.railWidth + FIRE_SHUTTER.wicketMargin) +
        FIRE_SHUTTER.wicketWidth
      );
  }
}

/** 窓が 1 つ以上入る窓付きの壁の辺の長さの下限（m） */
export const MIN_WINDOW_EDGE_LENGTH = POST_SIZE + WINDOW.width + 2 * WINDOW.minPier;

/**
 * 辺の壁の板の定義（ローカル座標）．u は -X の端から +X へ，面は +Z の側（z = WALL_THICKNESS/2）．
 * 当たり判定（wallRectObstacle）に厚み WALL_THICKNESS を渡すと，辺の線を中心にした厚みになる
 */
export function edgeWallDef(length: number): WallDef {
  const wallLength = edgeWallLength(length);
  return {
    id: "edge",
    origin: [-wallLength / 2, 0, WALL_THICKNESS / 2],
    dir: [1, 0, 0],
    normal: [0, 0, 1],
    rotationY: 0,
    length: wallLength,
  };
}

/** 壁の板（長さ wallLength・天井の高さ height）に入る窓の開口部（u の小さい順．等間隔） */
export function windowOpenings(wallLength: number, height: number): WallRect[] {
  const top = Math.min(WINDOW.sill + WINDOW.height, height - WINDOW.minHeadroom);
  if (top - WINDOW.sill < WINDOW.minHeight) return [];
  const count = Math.floor((wallLength - WINDOW.minPier) / (WINDOW.width + WINDOW.minPier));
  if (count <= 0) return [];
  const pier = (wallLength - count * WINDOW.width) / (count + 1);
  return Array.from({ length: count }, (_, i) => {
    const u0 = pier + i * (WINDOW.width + pier);
    return { u0, u1: u0 + WINDOW.width, v0: WINDOW.sill, v1: top };
  });
}

/**
 * ドアの開口部．壁の中央に置くが，開いた扉が収まる壁が +X の側に足りない時は -X の側へ寄せる
 */
export function doorOpening(wallLength: number): WallRect {
  const centered = (wallLength + DOOR.width) / 2;
  const u1 = Math.min(centered, wallLength - DOOR.width - DOOR.minPier);
  return { u0: u1 - DOOR.width, u1, v0: 0, v1: DOOR.height };
}

/** 出口の開口部（壁の中央） */
export function exitOpening(wallLength: number): WallRect {
  const u0 = (wallLength - EXIT.width) / 2;
  return { u0, u1: u0 + EXIT.width, v0: 0, v1: EXIT.height };
}

/** 防火シャッターの寸法（u・v は壁の板の上の位置） */
export interface FireShutterLayout {
  /** 閉じた時の幕（両端のガイドレールの間を含む壁の板の全幅・床から収納箱の下まで） */
  readonly curtain: WallRect;
  /** 収納箱の下面の高さ（m） */
  readonly boxBottom: number;
  /** くぐり戸 */
  readonly wicket: WallRect;
  /** くぐり戸の中心のローカル X（m） */
  readonly wicketCenterX: number;
  /** 両端のガイドレール */
  readonly rails: readonly WallRect[];
}

/**
 * 防火シャッターの寸法．くぐり戸は中央から wicketOffset（m．ローカル X の向き）ずらした位置に置き，
 * ガイドレールにかからない範囲に切り詰める（±Infinity は端へ寄せる）．wicketOffset が NaN なら RangeError
 */
export function fireShutterLayout(
  length: number,
  height: number,
  wicketOffset = 0,
): FireShutterLayout {
  // NaN は Math.min・Math.max を通り抜けて位置が数でなくなるため，ここで止める
  if (Number.isNaN(wicketOffset)) {
    throw new RangeError(`くぐり戸のずれは数にしてください: ${wicketOffset}`);
  }
  const wallLength = edgeWallLength(length);
  const boxBottom = height - FIRE_SHUTTER.boxHeight;
  const half = FIRE_SHUTTER.wicketWidth / 2;
  const minCenter = FIRE_SHUTTER.railWidth + FIRE_SHUTTER.wicketMargin + half;
  const maxCenter = wallLength - minCenter;
  const center = Math.min(maxCenter, Math.max(minCenter, wallLength / 2 + wicketOffset));
  return {
    curtain: { u0: 0, u1: wallLength, v0: 0, v1: boxBottom },
    boxBottom,
    wicket: {
      u0: center - half,
      u1: center + half,
      v0: FIRE_SHUTTER.wicketBottom,
      v1: FIRE_SHUTTER.wicketBottom + FIRE_SHUTTER.wicketHeight,
    },
    wicketCenterX: edgeLocalX(length, center),
    rails: [
      { u0: 0, u1: FIRE_SHUTTER.railWidth, v0: 0, v1: boxBottom },
      { u0: wallLength - FIRE_SHUTTER.railWidth, u1: wallLength, v0: 0, v1: boxBottom },
    ],
  };
}

/** 辺に置く物の作り方の追加の指定 */
export interface EdgeOptions {
  /** 防火シャッターのくぐり戸の位置（中央からのずれ．m．ローカル X の向き） */
  readonly wicketOffset?: number;
}

/** 辺に置く物の寸法（壁の板・開口部．u・v は壁の板の上の位置） */
export interface EdgeLayout {
  readonly kind: EdgeKind;
  readonly length: number;
  readonly height: number;
  /** 壁の板の長さ（両端の柱の半分を除く） */
  readonly wallLength: number;
  /** 壁の板の定義（ローカル座標） */
  readonly wall: WallDef;
  /** 開口部（窓・ドア・出口・シャッターの幕） */
  readonly openings: readonly WallRect[];
  /** 開口部を除いた壁の板（シャッターは収納箱が上をふさぐため空） */
  readonly wallRects: readonly WallRect[];
  /** 防火シャッターの寸法（シャッター以外は null） */
  readonly shutter: FireShutterLayout | null;
}

/**
 * 辺に置く物（長さ length・天井の高さ height）の寸法．
 * 長さ・高さが下限（minEdgeLength・MIN_CEILING_HEIGHT）より小さければ RangeError
 */
export function edgeLayout(
  kind: EdgeKind,
  length: number,
  height: number,
  options: EdgeOptions = {},
): EdgeLayout {
  requireAtLeast(`辺の長さ（${kind}）`, length, minEdgeLength(kind));
  assertCeilingHeight(height);
  const wall = edgeWallDef(length);
  const wallLength = wall.length;
  if (kind === "fireShutter") {
    const shutter = fireShutterLayout(length, height, options.wicketOffset);
    return {
      kind,
      length,
      height,
      wallLength,
      wall,
      openings: [shutter.curtain],
      wallRects: [],
      shutter,
    };
  }
  const openings =
    kind === "windowWall"
      ? windowOpenings(wallLength, height)
      : kind === "door"
        ? [doorOpening(wallLength)]
        : kind === "exit"
          ? [exitOpening(wallLength)]
          : [];
  return {
    kind,
    length,
    height,
    wallLength,
    wall,
    openings,
    wallRects: splitWallAroundOpenings(wallLength, height, openings),
    shutter: null,
  };
}

/** 引き戸の扉の配置（ローカル X．slidingLeafX にそのまま渡せる形） */
export interface DoorLeafLayout {
  /** 扉の幅（開口部の幅＋枠にかかる幅） */
  readonly width: number;
  readonly height: number;
  /** 閉じた時の扉の中心のローカル X */
  readonly closedX: number;
  readonly slideDirection: 1;
  readonly slideDistance: number;
  /** 扉の中心のローカル Z（+Z の側の壁の面の外） */
  readonly z: number;
}

/** ドアの扉の配置．扉は +Z の側の面に沿って +X の向きへ開口部の幅だけ滑る */
export function doorLeafLayout(layout: EdgeLayout): DoorLeafLayout {
  const opening = layout.openings[0];
  if (layout.kind !== "door" || !opening) throw new Error("ドアの寸法ではありません");
  return {
    width: DOOR.width + DOOR.leafOverlap,
    height: DOOR.height,
    closedX: edgeLocalX(layout.length, (opening.u0 + opening.u1) / 2),
    slideDirection: 1,
    slideDistance: DOOR.width,
    // 枠（面から 0.01m 出る）に当たらないよう少し離す
    z: WALL_THICKNESS / 2 + 0.015 + DOOR.leafThickness / 2,
  };
}

// ---------------------------------------------------------------------------
// 当たり判定の範囲（パーツのローカル座標．placeObstacle で置いた先の座標に変える）

/** 柱の当たり判定（ローカル座標） */
export function postObstacle(height: number, id: string): Obstacle {
  const h = POST_SIZE / 2;
  return { id, minX: -h, maxX: h, minZ: -h, maxZ: h, minY: 0, maxY: height };
}

/** 辺に置く物の動かない部分の当たり判定（壁の板・シャッターのガイドレール．id は `${id}-wall-${i}` 等） */
export function edgeStaticObstacles(layout: EdgeLayout, id: string): Obstacle[] {
  const walls = layout.wallRects.map((rect, i) =>
    wallRectObstacle(layout.wall, rect, WALL_THICKNESS, `${id}-wall-${i}`),
  );
  const rails = (layout.shutter?.rails ?? []).map((rect, i) => {
    const o = wallRectObstacle(layout.wall, rect, WALL_THICKNESS, `${id}-rail-${i}`);
    const extra = (FIRE_SHUTTER.railDepth - WALL_THICKNESS) / 2;
    return { ...o, minZ: o.minZ - extra, maxZ: o.maxZ + extra };
  });
  return [...walls, ...rails];
}

/** 閉じた時だけ通れなくなる範囲（ドアは開口部，シャッターは幕．壁・窓付きの壁・出口は null） */
export function edgeClosableObstacle(layout: EdgeLayout, id: string): Obstacle | null {
  if (layout.kind === "door") {
    const opening = layout.openings[0];
    return opening ? wallRectObstacle(layout.wall, opening, WALL_THICKNESS, id) : null;
  }
  if (layout.shutter)
    return wallRectObstacle(layout.wall, layout.shutter.curtain, WALL_THICKNESS, id);
  return null;
}

/**
 * 閉じたシャッターの幕の当たり判定．wicketOpen ならくぐり戸の範囲を空ける（くぐり戸の操作（S4）で使う想定）
 */
export function fireShutterCurtainObstacles(
  layout: EdgeLayout,
  id: string,
  wicketOpen: boolean,
): Obstacle[] {
  const shutter = layout.shutter;
  if (!shutter) return [];
  const rects = wicketOpen
    ? splitWallAroundOpenings(layout.wallLength, shutter.curtain.v1, [shutter.wicket])
    : [shutter.curtain];
  return rects.map((rect, i) =>
    wallRectObstacle(layout.wall, rect, WALL_THICKNESS, `${id}-curtain-${i}`),
  );
}

/** 出口の外（ポーチ）の床の範囲（ローカル座標）．外へ出たことの判定や，外の床の範囲に使う */
export function exitOutsideRect(layout: EdgeLayout): XZRect {
  const opening = layout.openings[0];
  if (layout.kind !== "exit" || !opening) throw new Error("出口の寸法ではありません");
  return {
    minX: edgeLocalX(layout.length, opening.u0),
    maxX: edgeLocalX(layout.length, opening.u1),
    minZ: -WALL_THICKNESS / 2 - EXIT.apronDepth,
    maxZ: -WALL_THICKNESS / 2,
  };
}

/**
 * 出口の開口部の敷居（壁の厚みの分）の床の範囲（ローカル座標）．床の面は辺の線で終わり，
 * ポーチは壁の外の面から始まるため，この範囲を床にしないと内から外へ歩いて出られない
 */
export function exitSillRect(layout: EdgeLayout): XZRect {
  const outside = exitOutsideRect(layout);
  return {
    minX: outside.minX,
    maxX: outside.maxX,
    minZ: -WALL_THICKNESS / 2,
    maxZ: WALL_THICKNESS / 2,
  };
}

// ---------------------------------------------------------------------------
// 置き方（パーツのローカル座標 → 置いた先の座標）

/** パーツの置き方（親から見た原点の位置と Y 軸回りの回転．rad．0 で回さない．正で左へ回る） */
export interface PartPlacement {
  readonly x: number;
  readonly z: number;
  readonly rotationY: number;
}

export interface XZPoint {
  readonly x: number;
  readonly z: number;
}

/**
 * 2 点 from → to を結ぶ辺に置く物の置き方と長さ．ローカル X が from → to の向き，
 * ローカル +Z は from から to へ進む向きの右手の側になる（引き戸の扉・出口の内側）
 */
export function edgePlacementBetween(
  from: XZPoint,
  to: XZPoint,
): { readonly placement: PartPlacement; readonly length: number } {
  const dx = to.x - from.x;
  const dz = to.z - from.z;
  return {
    placement: {
      x: (from.x + to.x) / 2,
      z: (from.z + to.z) / 2,
      // ローカル +X（1, 0）を回転 θ で回すと（cos θ, -sin θ）になる
      rotationY: Math.atan2(-dz, dx),
    },
    length: Math.hypot(dx, dz),
  };
}

/** ローカル座標の点を置いた先の座標に変える（three の Object3D と同じ回転の向き） */
export function placePoint(local: XZPoint, placement: PartPlacement): XZPoint {
  return localToParentXZ(placement, placement.rotationY, local);
}

/** ローカル座標の矩形を置いた先の座標の矩形（回転後の外接 AABB．90° 単位の回転なら同じ大きさ）に変える */
export function placeRect(rect: XZRect, placement: PartPlacement): XZRect {
  const corners = [
    placePoint({ x: rect.minX, z: rect.minZ }, placement),
    placePoint({ x: rect.maxX, z: rect.minZ }, placement),
    placePoint({ x: rect.minX, z: rect.maxZ }, placement),
    placePoint({ x: rect.maxX, z: rect.maxZ }, placement),
  ];
  const xs = corners.map((c) => c.x);
  const zs = corners.map((c) => c.z);
  return {
    minX: Math.min(...xs),
    maxX: Math.max(...xs),
    minZ: Math.min(...zs),
    maxZ: Math.max(...zs),
  };
}

/** ローカル座標の当たり判定を置いた先の座標に変える */
export function placeObstacle(obstacle: Obstacle, placement: PartPlacement): Obstacle {
  return { ...obstacle, ...placeRect(obstacle, placement) };
}

// ---------------------------------------------------------------------------
// パーツの Group の userData（schoolPartsCollision がここから当たり判定を取り出す）

/** 床の面の userData */
export interface FloorSurfaceUserData {
  readonly kind: "schoolFloor";
  readonly id: string;
  readonly floorKind: FloorKind;
  readonly width: number;
  readonly depth: number;
  readonly ceilingHeight: number;
}

interface EdgeUserDataBase {
  readonly kind: "schoolEdge";
  readonly id: string;
  readonly length: number;
  readonly height: number;
}

/** 引き戸のドアの userData．open・openAmount は開閉で書き換える */
export interface SchoolDoorUserData extends EdgeUserDataBase {
  readonly edgeKind: "door";
  /** 開いているか（当たり判定はこれを見る） */
  open: boolean;
  /** 開き具合（0 で閉，1 で全開） */
  openAmount: number;
  /** 開かないドア（外側だけの教室のドア）．true の間は開閉しない */
  readonly locked: boolean;
  /** 扉の Group の name */
  readonly leafName: string;
}

/** 引き戸の扉の userData（slidingLeafX に渡せる形） */
export interface SchoolDoorLeafUserData {
  readonly kind: "schoolDoorLeaf";
  readonly doorId: string;
  readonly closedX: number;
  readonly slideDirection: 1;
  readonly slideDistance: number;
  openAmount: number;
}

/** 防火シャッターの userData．closed は開閉で書き換える */
export interface FireShutterUserData extends EdgeUserDataBase {
  readonly edgeKind: "fireShutter";
  /** 閉じているか（当たり判定はこれを見る） */
  closed: boolean;
  /** くぐり戸の位置（ローカル X の中心・下端の高さ・幅・高さ．m） */
  readonly wicket: {
    readonly centerX: number;
    readonly bottom: number;
    readonly width: number;
    readonly height: number;
  };
  /** くぐり戸が開いているか（くぐり戸の操作（S4）は範囲外のため今は常に false） */
  wicketOpen: boolean;
  /** くぐり戸の位置の指定（中央からのずれ．m） */
  readonly wicketOffset: number;
  /** 閉じた時の幕の Group の name（表示を切り替える） */
  readonly curtainName: string;
  /** 開いた時に収納箱の下に見える座板の Mesh の name（表示を切り替える） */
  readonly openBarName: string;
}

/** 辺に置く物の userData */
export type SchoolEdgeUserData =
  | (EdgeUserDataBase & { readonly edgeKind: "wall" | "exit" })
  | (EdgeUserDataBase & { readonly edgeKind: "windowWall"; readonly glass: WindowGlass })
  | SchoolDoorUserData
  | FireShutterUserData;

/** 柱の userData */
export interface SchoolPostUserData {
  readonly kind: "schoolPost";
  readonly id: string;
  readonly height: number;
}
