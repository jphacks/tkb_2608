// エレベーターのマテリアル．スマホの 2 画面描画で軽いように Lambert を基本にする

import * as THREE from "three";
import {
  CABIN,
  CABIN_DOOR,
  HALL,
  HORIZONTAL_PANEL_LAYOUT,
  TILE_SIZE,
  VERTICAL_PANEL_LAYOUT,
} from "./elevatorLayout";
import {
  createButtonLabelTexture,
  createFloorIndicatorTexture,
  createHairlineTexture,
  createPanelPlateTexture,
  createTileFloorTexture,
} from "./elevatorTextures";

/** 点灯したボタンの面の色（ラベルのテクスチャに掛ける） */
export const BUTTON_LIT_COLOR = 0xffa64d;

export function createElevatorMaterials(maxAnisotropy: number) {
  const lambert = (color: THREE.ColorRepresentation) => new THREE.MeshLambertMaterial({ color });
  const wallMap = createHairlineTexture(maxAnisotropy);
  // 扉は箱の面ごとに UV が 0〜1 のため，扉 1 枚の大きさに合わせて繰り返す（画像は壁と共有）
  const leafMap = wallMap.clone();
  leafMap.repeat.set(CABIN_DOOR.width / 2 / TILE_SIZE.wall, CABIN_DOOR.height / TILE_SIZE.wall);
  const floorMap = createTileFloorTexture("#6f6b66", 921, maxAnisotropy);
  floorMap.repeat.set(CABIN.width / TILE_SIZE.floor, CABIN.depth / TILE_SIZE.floor);
  const hallFloorMap = createTileFloorTexture("#b9b2a6", 922, maxAnisotropy);
  hallFloorMap.repeat.set(HALL.width / 0.6, HALL.depth / 0.6);
  const labelMap = createButtonLabelTexture();
  return {
    wall: new THREE.MeshLambertMaterial({ map: wallMap }),
    doorLeaf: new THREE.MeshLambertMaterial({ map: leafMap, color: 0xdde0e3 }),
    floor: new THREE.MeshLambertMaterial({ map: floorMap }),
    ceiling: lambert(0xeeeeea),
    /** 三方枠・敷居・幕板・手すりの支え（濃いめのステンレス） */
    frame: lambert(0x8e949a),
    handrail: lambert(0xd4d8dc),
    /** 操作盤の板（並び方ごとに格子・定員の位置が違うため別のテクスチャ） */
    panelPlate: {
      vertical: new THREE.MeshLambertMaterial({
        map: createPanelPlateTexture(VERTICAL_PANEL_LAYOUT),
      }),
      horizontal: new THREE.MeshLambertMaterial({
        map: createPanelPlateTexture(HORIZONTAL_PANEL_LAYOUT),
      }),
    },
    buttonBody: lambert(0x7d838a),
    /** ボタンの面（消灯） */
    buttonFace: new THREE.MeshLambertMaterial({ map: labelMap }),
    /** ボタンの面（点灯．自ら光るよう Basic で色を掛ける）．setElevatorButtonLit で差し替える */
    buttonLit: new THREE.MeshBasicMaterial({ map: labelMap, color: BUTTON_LIT_COLOR }),
    indicatorHousing: lambert(0x2a2c30),
    indicatorScreen: new THREE.MeshBasicMaterial({ map: createFloorIndicatorTexture(1, "none") }),
    /** 鏡（反射は描かず明るい板） */
    mirror: new THREE.MeshBasicMaterial({ color: 0xc8d2da }),
    lightPanel: new THREE.MeshBasicMaterial({ color: 0xfbfcff }),
    /** 非常灯のパネル（既定は消灯の色） */
    emergencyPanel: lambert(0xe8e2d0),
    camera: lambert(0x222326),
    hallFloor: new THREE.MeshLambertMaterial({ map: hallFloorMap }),
    hallWall: lambert(0xe6e1d6),
    hallCeiling: lambert(0xf2f1ec),
  };
}

export type ElevatorMaterials = ReturnType<typeof createElevatorMaterials>;
