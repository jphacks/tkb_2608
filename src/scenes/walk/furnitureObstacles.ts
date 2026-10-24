// 家具の Group から障害物を作る（床占有範囲は furnitureFootprint()，高さは userData の size と origin）．
// Group の位置は親（部屋の furniture・電車の carBody・エレベーターの cabin）から見た値で，
// 親が原点にある（揺らしていない）前提でワールド座標として扱う．揺れで動いた後の更新は後の Issue

import type { Object3D } from "three";
import type { FurnitureUserData } from "../common/furniture";
import { furnitureFootprint } from "../common/furnitureGroup";
import type { Obstacle } from "./collision";
import { footprintObstacle, furnitureVerticalRange } from "./obstacles";

/** 家具の Group 1 つを障害物にする（id は Group の name） */
export function furnitureObstacle(group: Object3D): Obstacle {
  const { size, origin } = group.userData as FurnitureUserData;
  const { minY, maxY } = furnitureVerticalRange(origin, group.position.y, size.y);
  return footprintObstacle(group.name, furnitureFootprint(group), minY, maxY);
}

/** 家具の Group の一覧を障害物にする */
export function furnitureObstacles(groups: readonly Object3D[]): Obstacle[] {
  return groups.map(furnitureObstacle);
}
