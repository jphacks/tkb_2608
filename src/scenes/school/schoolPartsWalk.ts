// 確認用の校舎のパーツの空間の歩行の当たり判定・エリア・目の高さ（walk/ の WalkWorld を作る）．
// 障害物・ドア・床の範囲はパーツの Group から collectSchoolCollision で取り出し，外の地面を床の範囲に足す．
// 建物の外も歩けるようにし，出口から出入りして 2 棟を見て回れるようにする（外壁と閉じたドア・シャッターで止まる）

import type { WalkWorld } from "../walk/locomotion";
import { collectSchoolCollision } from "./schoolPartsCollision";
import type { SchoolPartsSpace } from "./schoolPartsPreview";
import { PREVIEW_EYE_HEIGHT, PREVIEW_GROUND } from "./schoolPartsPreviewLayout";

/** 確認用の空間の WalkWorld を作る（パーツの Group の今の位置から障害物を作る） */
export function createSchoolPartsWalkWorld(space: SchoolPartsSpace): WalkWorld {
  const collision = collectSchoolCollision(space.parts.parts);
  return {
    floors: [PREVIEW_GROUND, ...collision.floors],
    obstacles: collision.obstacles,
    doors: collision.doors,
    areas: collision.areas,
    eyeHeights: PREVIEW_EYE_HEIGHT,
    seats: [],
  };
}
