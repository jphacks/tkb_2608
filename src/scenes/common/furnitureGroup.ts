// 家具の Group の作成と床占有範囲の取得

import * as THREE from "three";
import {
  computeFootprint,
  type Footprint,
  type FurnitureDef,
  type FurnitureUserData,
} from "./furniture";

/** 定義から家具の Group を作る（位置・向き・userData を設定する．中身は呼び出し側で足す） */
export function createFurnitureGroup<K extends string>(def: FurnitureDef<K>): THREE.Group {
  const group = new THREE.Group();
  group.name = def.id;
  group.position.set(def.position[0], def.position[1], def.position[2]);
  group.rotation.y = def.rotationY;
  const userData: FurnitureUserData<K> = {
    id: def.id,
    kind: def.kind,
    size: def.size,
    mass: def.mass,
    anchored: def.anchored,
    mount: def.mount,
    origin: def.origin,
    tipRisk: def.tipRisk,
    restsOn: def.restsOn,
  };
  group.userData = userData;
  return group;
}

/** 家具の Group の現在の位置・向きから床占有範囲（回転後の外接 AABB）を求める */
export function furnitureFootprint(group: THREE.Object3D): Footprint {
  const { size } = group.userData as FurnitureUserData;
  return computeFootprint(group.position, group.rotation.y, size);
}
