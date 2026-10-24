// 部屋のマテリアル．スマホの 2 画面描画で軽いように Lambert を基本にする

import * as THREE from "three";
import {
  createCeilingTexture,
  createFlooringTexture,
  createSkyTexture,
  createWallpaperTexture,
} from "../common/textures";
import { SKY_BOARD } from "./roomLayout";

const BOOK_COLORS = [0x8c2f2f, 0x2f4f8c, 0x3f6e3a, 0xc9a227, 0x5a3d6e, 0xd8d2c4, 0x2a2a2a];

export function createRoomMaterials(maxAnisotropy: number) {
  const lambert = (color: THREE.ColorRepresentation) => new THREE.MeshLambertMaterial({ color });
  return {
    wall: new THREE.MeshLambertMaterial({ map: createWallpaperTexture(maxAnisotropy) }),
    floor: new THREE.MeshLambertMaterial({ map: createFlooringTexture(maxAnisotropy) }),
    ceiling: new THREE.MeshLambertMaterial({ map: createCeilingTexture(maxAnisotropy) }),
    sky: new THREE.MeshBasicMaterial({
      map: createSkyTexture({ bottom: SKY_BOARD.bottom, top: SKY_BOARD.bottom + SKY_BOARD.height }),
      fog: false,
    }),
    glass: new THREE.MeshBasicMaterial({
      color: 0xdfeef7,
      transparent: true,
      opacity: 0.18,
      depthWrite: false,
    }),
    woodLight: lambert(0xc49a6c),
    woodDark: lambert(0x6b4a33),
    woodTrim: lambert(0x8a6446),
    fabric: lambert(0x5d7a8c),
    cushion: lambert(0x7d97a6),
    black: lambert(0x1c1c1e),
    // 点いている画面（光の影響を受けない明るい色．消すときは color を暗くする）
    screen: new THREE.MeshBasicMaterial({ color: 0x8fb4d6 }),
    metal: lambert(0x9a9a9a),
    white: lambert(0xf2f0ea),
    shade: new THREE.MeshLambertMaterial({
      color: 0xf3e6cc,
      emissive: 0x3a2c18,
      side: THREE.DoubleSide,
    }),
    bulb: new THREE.MeshBasicMaterial({ color: 0xfff1d0 }),
    pot: lambert(0xb5653d),
    soil: lambert(0x3b2a1e),
    leaf: new THREE.MeshLambertMaterial({ color: 0x3f8a43, flatShading: true }),
    books: BOOK_COLORS.map(lambert),
    // キッチン
    counterTop: lambert(0xd9d6cf),
    cabinet: lambert(0xece8df),
    sink: lambert(0xb8bcc0),
    stoveBody: lambert(0x3a3c40),
    stoveTop: lambert(0x18191b),
    flame: new THREE.MeshBasicMaterial({
      color: 0x4f8dff,
      transparent: true,
      opacity: 0.8,
      side: THREE.DoubleSide,
      depthWrite: false,
    }),
    // ブレーカー
    breakerLever: lambert(0x2b2b2b),
    // 床に散らばった窓ガラスの破片（床の上で見えるよう窓より濃く）
    shard: new THREE.MeshLambertMaterial({
      color: 0xcfe6f2,
      emissive: 0x3a4a52,
      transparent: true,
      opacity: 0.7,
      side: THREE.DoubleSide,
    }),
    // 廊下
    hallwayLight: new THREE.MeshBasicMaterial({ color: 0xfffaf0 }),
    frontDoor: lambert(0x4a3a2e),
  };
}

export type RoomMaterials = ReturnType<typeof createRoomMaterials>;
