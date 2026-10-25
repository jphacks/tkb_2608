// SchoolPlan から組み立てた校舎の空間の歩行の当たり判定・エリア・目の高さ（walk/ の WalkWorld を作る）．
// 障害物・閉じたシャッター・屋内の床の範囲はパーツの Group から collectSchoolCollision で取り出し，屋外のマスを床の範囲に足す．
// 閉じた防火シャッターもくぐり戸は通れ，燃えているマスは通れない（SPEC_01「VR 避難の規則」・SPEC_02「通れる・燃え広がる」）．
// エリアは床の面の id に，SPEC_01「エリアの ID」のエリア（schoolPlanAreas）を足す

import type { WalkWorld } from "../walk/locomotion";
import { schoolPlanAreas } from "./schoolAreas";
import { collectSchoolCollision } from "./schoolPartsCollision";
import { SCHOOL_EYE_HEIGHT } from "./schoolPlanLayout";
import type { SchoolSpace } from "./schoolPlanScene";

/**
 * 校舎で PlayerInput.walkSpeed に掛ける倍率（SPEC_01「歩く速さ」の既定 1.5）．
 * 校舎は部屋より広いため，避難を 2〜3 分に収める．他の空間の速さは変えない
 */
export const SCHOOL_WALK_SPEED_SCALE = 1.5;

/** 校舎の空間の WalkWorld を作る（パーツの Group の今の位置から障害物を作る） */
export function createSchoolWalkWorld(space: SchoolSpace): WalkWorld {
  const collision = collectSchoolCollision(space.parts.parts, { shutterWicketPassable: true });
  return {
    floors: [...collision.floors, ...space.layout.outdoor],
    obstacles: collision.obstacles,
    // 燃えているマスは時刻とともに増えるため，閉じている間だけふさぐドアと同じ形で足す（時刻は space.update が渡す）
    doors: [...collision.doors, ...space.fireCells.doors],
    areas: [...collision.areas, ...schoolPlanAreas(space.plan)],
    eyeHeights: SCHOOL_EYE_HEIGHT,
    seats: [],
    walkSpeedScale: SCHOOL_WALK_SPEED_SCALE,
  };
}
