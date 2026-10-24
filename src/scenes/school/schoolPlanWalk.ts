// SchoolPlan から組み立てた校舎の空間の歩行の当たり判定・エリア・目の高さ（walk/ の WalkWorld を作る）．
// 障害物・閉じたシャッター・屋内の床の範囲はパーツの Group から collectSchoolCollision で取り出し，屋外のマスを床の範囲に足す

import type { WalkWorld } from "../walk/locomotion";
import { collectSchoolCollision } from "./schoolPartsCollision";
import { SCHOOL_EYE_HEIGHT } from "./schoolPlanLayout";
import type { SchoolSpace } from "./schoolPlanScene";

/** 校舎の空間の WalkWorld を作る（パーツの Group の今の位置から障害物を作る） */
export function createSchoolWalkWorld(space: SchoolSpace): WalkWorld {
  const collision = collectSchoolCollision(space.parts.parts);
  return {
    floors: [...collision.floors, ...space.layout.outdoor],
    obstacles: collision.obstacles,
    doors: collision.doors,
    areas: collision.areas,
    eyeHeights: SCHOOL_EYE_HEIGHT,
    seats: [],
  };
}
