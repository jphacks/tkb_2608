// 電車のマテリアル．スマホの 2 画面描画で軽いように Lambert を基本にする

import * as THREE from "three";
import { CAR, OUTSIDE_BOARD, SEAT_SECTIONS, TILE_SIZE } from "./trainLayout";
import {
  createCityscapeTexture,
  createDoorDisplayTexture,
  createSeatFabricTexture,
  createTrainFloorTexture,
} from "./trainTextures";

/** 中吊り広告の色（無地の板．インスタンスごとに変える） */
export const AD_COLORS = [0xf2d16b, 0x9fd3e8, 0xf0a3a3, 0xb8e0a8, 0xf4f1ea, 0xc7b3e5];

export function createTrainMaterials(maxAnisotropy: number) {
  const lambert = (color: THREE.ColorRepresentation) => new THREE.MeshLambertMaterial({ color });
  const floorMap = createTrainFloorTexture(maxAnisotropy);
  const outsideMap = createCityscapeTexture({
    bottom: OUTSIDE_BOARD.bottom,
    top: OUTSIDE_BOARD.bottom + OUTSIDE_BOARD.height,
    groundY: OUTSIDE_BOARD.groundY,
  });
  outsideMap.repeat.set(OUTSIDE_BOARD.length / OUTSIDE_BOARD.tileLength, 1);
  floorMap.repeat.set(CAR.width / TILE_SIZE.floor, CAR.length / TILE_SIZE.floor);
  // 座面・背もたれの模様は 1 枚 = 1 人分．区画の種類ごとに人数分くり返す
  const persons = (kind: string): number =>
    SEAT_SECTIONS.find((section) => section.kind === kind)?.persons ?? 1;
  const longSeatMap = createSeatFabricTexture("#2f5fae", 811, maxAnisotropy);
  longSeatMap.repeat.set(persons("longSeat"), 1);
  const prioritySeatMap = createSeatFabricTexture("#5b5f8f", 812, maxAnisotropy);
  prioritySeatMap.repeat.set(persons("prioritySeat"), 1);
  return {
    floor: new THREE.MeshLambertMaterial({ map: floorMap }),
    wall: lambert(0xe9e5da),
    ceiling: lambert(0xf4f4f0),
    stainless: lambert(0xc4c9ce),
    darkGray: lambert(0x3a3d42),
    rack: lambert(0x9aa0a6),
    seatBase: lambert(0x55595f),
    seatArm: lambert(0xdedad0),
    longSeat: new THREE.MeshLambertMaterial({ map: longSeatMap }),
    prioritySeat: new THREE.MeshLambertMaterial({ map: prioritySeatMap }),
    doorPanel: lambert(0xd5d8dc),
    gangway: new THREE.MeshLambertMaterial({ color: 0x4a4d52, side: THREE.BackSide }),
    strapBelt: lambert(0xe8e8e8),
    strapRing: lambert(0xf2f2ee),
    intercom: lambert(0xd9342b),
    button: lambert(0xf0c419),
    ad: lambert(0xffffff),
    cardboard: lambert(0xb48a5a),
    bag: lambert(0x2b3550),
    backpack: lambert(0x8c2f35),
    platform: lambert(0xa9a7a0),
    tactile: lambert(0xe8c23a),
    light: new THREE.MeshBasicMaterial({ color: 0xfbfcff }),
    display: new THREE.MeshBasicMaterial({ map: createDoorDisplayTexture() }),
    glass: new THREE.MeshBasicMaterial({
      color: 0xdfeef7,
      transparent: true,
      opacity: 0.15,
      depthWrite: false,
    }),
    outside: new THREE.MeshBasicMaterial({ map: outsideMap, fog: false }),
  };
}

export type TrainMaterials = ReturnType<typeof createTrainMaterials>;
