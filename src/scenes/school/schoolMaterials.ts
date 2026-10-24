// 校舎のパーツのマテリアル（すべてのパーツで共有する）．スマホの 2 画面描画で軽いように Lambert を基本にする

import * as THREE from "three";
import { createCeilingTexture, createFlooringTexture } from "../common/textures";
import {
  createAcousticCeilingTexture,
  createBlackboardTexture,
  createCorridorFloorTexture,
  createShutterTexture,
} from "./schoolTextures";

/** 校舎のパーツのマテリアル一式を作る（パーツごとに作らず，1 つの空間で 1 回だけ作って共有する） */
export function createSchoolMaterials(maxAnisotropy: number) {
  const lambert = (color: THREE.ColorRepresentation) => new THREE.MeshLambertMaterial({ color });
  return {
    // 床・天井
    classroomFloor: new THREE.MeshLambertMaterial({ map: createFlooringTexture(maxAnisotropy) }),
    corridorFloor: new THREE.MeshLambertMaterial({
      map: createCorridorFloorTexture(maxAnisotropy),
    }),
    classroomCeiling: new THREE.MeshLambertMaterial({
      map: createAcousticCeilingTexture(maxAnisotropy),
    }),
    corridorCeiling: new THREE.MeshLambertMaterial({ map: createCeilingTexture(maxAnisotropy) }),
    // 天井の照明（光源は付けず，明るい板だけ）
    ceilingLight: new THREE.MeshBasicMaterial({ color: 0xfbfbf4 }),
    // 壁・柱
    wall: lambert(0xe8e2d0),
    baseboard: lambert(0x5d5852),
    // 窓・ドアの枠（アルミ）
    frame: lambert(0xb7babd),
    glass: new THREE.MeshBasicMaterial({
      color: 0xdfeef7,
      transparent: true,
      opacity: 0.18,
      depthWrite: false,
    }),
    // すりガラス（中が見えない程度に不透明）
    frostedGlass: new THREE.MeshLambertMaterial({
      color: 0xe9eef0,
      emissive: 0x30363a,
      transparent: true,
      opacity: 0.93,
    }),
    doorLeaf: lambert(0xcdb894),
    // 出口
    concrete: lambert(0xa9a49b),
    canopy: lambert(0xcfcbc2),
    exitSign: new THREE.MeshBasicMaterial({ color: 0x2fae5a }),
    // 防火シャッター
    shutterCurtain: new THREE.MeshLambertMaterial({
      map: createShutterTexture(maxAnisotropy),
      side: THREE.DoubleSide,
    }),
    shutterBox: lambert(0x80878d),
    wicket: lambert(0x969ca1),
    handle: lambert(0x2a2a2a),
    // 教室の中身
    wood: lambert(0xcfae80),
    metal: lambert(0x8e9398),
    storage: lambert(0x6f767c),
    teacherDesk: lambert(0x9b7a55),
    blackboard: new THREE.MeshLambertMaterial({ map: createBlackboardTexture(maxAnisotropy) }),
  };
}

export type SchoolMaterials = ReturnType<typeof createSchoolMaterials>;

/** マテリアル一式（とテクスチャ）を解放する．パーツが使わなかった物も含めて解放する */
export function disposeSchoolMaterials(materials: SchoolMaterials): void {
  for (const material of Object.values(materials)) {
    const map = "map" in material ? material.map : null;
    map?.dispose();
    material.dispose();
  }
}
