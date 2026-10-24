// 家具の定義と床占有範囲の計算（three に依存しない純粋な型・関数）

export type Vec3Tuple = readonly [number, number, number];

export interface Size3 {
  readonly x: number;
  readonly y: number;
  readonly z: number;
}

/** 取り付け方（床置き・他の家具の上・天井吊り・壁掛け） */
export type FurnitureMount = "floor" | "top" | "ceiling" | "wall";
/** Group 原点の位置（底面中央・天井取付点・中心） */
export type FurnitureOrigin = "bottom" | "top" | "center";
/** 地震で倒れやすいか（後の Issue で揺れの演出に使う目安） */
export type TipRisk = "low" | "medium" | "high";

/**
 * 家具 1 つの定義．position は Group 原点のワールド座標（m），正面は回転前の +Z．
 * size は回転前のバウンディングボックス（m），mass は kg
 */
export interface FurnitureDef<K extends string = string> {
  readonly id: string;
  readonly kind: K;
  readonly position: Vec3Tuple;
  readonly rotationY: number;
  readonly size: Size3;
  readonly mass: number;
  readonly mount: FurnitureMount;
  readonly anchored: boolean;
  readonly origin: FurnitureOrigin;
  readonly tipRisk: TipRisk;
  /** 上に載っている家具の id（床置き等は null） */
  readonly restsOn: string | null;
}

/** 家具の Group.userData に入れる値 */
export type FurnitureUserData<K extends string = string> = Omit<
  FurnitureDef<K>,
  "position" | "rotationY"
>;

/** 床占有範囲（XZ 平面の外接 AABB．中心と半分の幅） */
export interface Footprint {
  readonly centerX: number;
  readonly centerZ: number;
  readonly halfX: number;
  readonly halfZ: number;
}

/**
 * 家具を Y 軸回りに回転したときの床占有範囲（外接 AABB）を求める．
 * 原点は XZ 平面でバウンディングボックスの中央にある前提
 */
export function computeFootprint(
  position: { readonly x: number; readonly z: number },
  rotationY: number,
  size: { readonly x: number; readonly z: number },
): Footprint {
  const cos = Math.abs(Math.cos(rotationY));
  const sin = Math.abs(Math.sin(rotationY));
  return {
    centerX: position.x,
    centerZ: position.z,
    halfX: (cos * size.x + sin * size.z) / 2,
    halfZ: (sin * size.x + cos * size.z) / 2,
  };
}

/** 直方体の体積と密度（kg/m^3）から質量（kg）を求める */
export function massFromDensity(size: Size3, density: number): number {
  return size.x * size.y * size.z * density;
}
