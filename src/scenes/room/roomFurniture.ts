// 部屋の家具．1 つずつ独立した Group（原点・正面・userData は roomLayout の定義どおり）として作る

import * as THREE from "three";
import { type FurnitureDef, massFromDensity, type Size3 } from "../common/furniture";
import { createFurnitureGroup } from "../common/furnitureGroup";
import { createBox } from "../common/meshHelpers";
import { mulberry32, randomInt, randomRange } from "../common/random";
import type { RoomFurnitureKind } from "./roomLayout";
import type { RoomMaterials } from "./roomMaterials";

/** 家具を作るときに共有する部品 */
export interface FurnitureContext {
  /** 単位立方体（1×1×1）．scale で拡大して使い回す */
  readonly unitBox: THREE.BufferGeometry;
  /** 単位円柱（直径 1・高さ 1） */
  readonly unitCylinder: THREE.BufferGeometry;
  readonly materials: RoomMaterials;
  readonly rand: () => number;
}

type Builder = (group: THREE.Group, size: Size3, ctx: FurnitureContext, id: string) => void;

/** 本の密度（kg/m^3） */
const BOOK_DENSITY = 600;

function cylinder(
  ctx: FurnitureContext,
  material: THREE.Material,
  diameter: number,
  height: number,
  y: number,
  name = "",
): THREE.Mesh {
  const mesh = new THREE.Mesh(ctx.unitCylinder, material);
  mesh.scale.set(diameter, height, diameter);
  mesh.position.y = y;
  mesh.name = name;
  return mesh;
}

/** テーブル．天板と脚は別 Mesh（後で脚だけ揺らす等ができるように） */
const buildTable: Builder = (group, size, { unitBox, materials }, id) => {
  const top = 0.04;
  const leg = 0.05;
  const inset = 0.06;
  group.add(
    createBox(
      unitBox,
      materials.woodLight,
      [size.x, top, size.z],
      [0, size.y - top / 2, 0],
      `${id}-top`,
    ),
  );
  const lx = size.x / 2 - inset - leg / 2;
  const lz = size.z / 2 - inset - leg / 2;
  const legHeight = size.y - top;
  [
    [-lx, -lz],
    [lx, -lz],
    [-lx, lz],
    [lx, lz],
  ].forEach(([x, z], i) => {
    group.add(
      createBox(
        unitBox,
        materials.woodDark,
        [leg, legHeight, leg],
        [x, legHeight / 2, z],
        `${id}-leg-${i + 1}`,
      ),
    );
  });
};

/** 椅子（背もたれは -Z 側．前脚は座面の下まで，後脚は全高まで） */
const buildChair: Builder = (group, size, { unitBox, materials }, id) => {
  const leg = 0.03;
  const seatThickness = 0.03;
  const seatTop = size.y * 0.52;
  const seatBottom = seatTop - seatThickness;
  const lx = size.x / 2 - leg / 2;
  const lz = size.z / 2 - leg / 2;
  for (const x of [-lx, lx]) {
    group.add(
      createBox(unitBox, materials.woodDark, [leg, seatBottom, leg], [x, seatBottom / 2, lz]),
    );
    group.add(createBox(unitBox, materials.woodDark, [leg, size.y, leg], [x, size.y / 2, -lz]));
  }
  group.add(
    createBox(
      unitBox,
      materials.woodLight,
      [size.x, seatThickness, size.z],
      [0, seatTop - seatThickness / 2, 0],
      `${id}-seat`,
    ),
  );
  const backBottom = seatTop + 0.15;
  const backTop = size.y - 0.02;
  group.add(
    createBox(
      unitBox,
      materials.woodLight,
      [size.x - leg * 2, backTop - backBottom, 0.02],
      [0, (backTop + backBottom) / 2, -lz],
      `${id}-back`,
    ),
  );
};

/** 本棚（板厚 0.02，5 段）．本は 1 冊 1 Mesh にし，落下させられるよう userData を付ける */
const buildBookshelf: Builder = (group, size, ctx, id) => {
  const { unitBox, materials, rand } = ctx;
  const t = 0.02;
  const shelves = 5;
  const halfX = size.x / 2;
  const halfZ = size.z / 2;
  for (const x of [-halfX + t / 2, halfX - t / 2]) {
    group.add(createBox(unitBox, materials.woodTrim, [t, size.y, size.z], [x, size.y / 2, 0]));
  }
  group.add(
    createBox(
      unitBox,
      materials.woodTrim,
      [size.x - t * 2, size.y, t],
      [0, size.y / 2, -halfZ + t / 2],
    ),
  );
  const innerWidth = size.x - t * 2;
  const pitch = (size.y - t) / shelves;
  for (let i = 0; i <= shelves; i++) {
    group.add(
      createBox(
        unitBox,
        materials.woodTrim,
        [innerWidth, t, size.z - t],
        [0, t / 2 + i * pitch, t / 2],
      ),
    );
  }

  let bookIndex = 0;
  for (let shelf = 0; shelf < shelves; shelf++) {
    const baseY = t + shelf * pitch;
    const count = randomInt(rand, 3, 7);
    let x = -halfX + t + randomRange(rand, 0, 0.08);
    for (let i = 0; i < count; i++) {
      const bookSize: Size3 = {
        x: randomRange(rand, 0.025, 0.06),
        y: randomRange(rand, 0.18, 0.3),
        z: randomRange(rand, 0.14, 0.22),
      };
      if (x + bookSize.x > halfX - t) break;
      bookIndex += 1;
      const material = materials.books[Math.floor(rand() * materials.books.length)];
      const bookId = `${id}-book-${bookIndex}`;
      const book = createBox(
        unitBox,
        material,
        [bookSize.x, bookSize.y, bookSize.z],
        [x + bookSize.x / 2, baseY + bookSize.y / 2, -halfZ + t + bookSize.z / 2],
        bookId,
      );
      book.userData = {
        id: bookId,
        kind: "book",
        size: bookSize,
        mass: massFromDensity(bookSize, BOOK_DENSITY),
      };
      group.add(book);
      x += bookSize.x + 0.002;
    }
  }
};

/** テレビ台（黒い台座＋本体＋引き出しの前板 2 枚） */
const buildTvStand: Builder = (group, size, { unitBox, materials }) => {
  const plinth = 0.05;
  group.add(
    createBox(unitBox, materials.black, [size.x - 0.1, plinth, size.z - 0.04], [0, plinth / 2, 0]),
  );
  const bodyHeight = size.y - plinth;
  group.add(
    createBox(
      unitBox,
      materials.woodDark,
      [size.x, bodyHeight, size.z],
      [0, plinth + bodyHeight / 2, 0],
    ),
  );
  const frontWidth = size.x / 2 - 0.04;
  for (const x of [-size.x / 4, size.x / 4]) {
    group.add(
      createBox(
        unitBox,
        materials.woodLight,
        [frontWidth, bodyHeight - 0.08, 0.01],
        [x, plinth + bodyHeight / 2, size.z / 2 + 0.005],
      ),
    );
  }
};

/** テレビ（台座＋首＋本体＋画面．画面は +Z 向き） */
const buildTv: Builder = (group, size, { unitBox, materials }, id) => {
  group.add(createBox(unitBox, materials.black, [0.35, 0.02, size.z], [0, 0.01, 0]));
  group.add(createBox(unitBox, materials.black, [0.06, 0.1, 0.03], [0, 0.07, -0.02]));
  const bodyBottom = 0.1;
  const bodyHeight = size.y - bodyBottom;
  const bodyDepth = 0.05;
  const bodyY = bodyBottom + bodyHeight / 2;
  group.add(createBox(unitBox, materials.black, [size.x, bodyHeight, bodyDepth], [0, bodyY, 0]));
  const screen = new THREE.Mesh(
    new THREE.PlaneGeometry(size.x - 0.04, bodyHeight - 0.04),
    materials.screen,
  );
  screen.position.set(0, bodyY, bodyDepth / 2 + 0.001);
  screen.name = `${id}-screen`;
  group.add(screen);
};

/** ソファ（台座＋座面＋背もたれ＋肘掛け 2＋座・背クッション各 2．背もたれは -Z 側） */
const buildSofa: Builder = (group, size, { unitBox, materials }) => {
  const halfX = size.x / 2;
  const halfZ = size.z / 2;
  const plinth = 0.08;
  const seatTop = 0.28;
  const backDepth = 0.18;
  const armWidth = 0.15;
  group.add(
    createBox(unitBox, materials.black, [size.x - 0.1, plinth, size.z - 0.07], [0, plinth / 2, 0]),
  );
  group.add(
    createBox(
      unitBox,
      materials.fabric,
      [size.x, seatTop - plinth, size.z],
      [0, (plinth + seatTop) / 2, 0],
    ),
  );
  group.add(
    createBox(
      unitBox,
      materials.fabric,
      [size.x, size.y - seatTop, backDepth],
      [0, (seatTop + size.y) / 2, -halfZ + backDepth / 2],
    ),
  );
  const armHeight = 0.35;
  for (const x of [-halfX + armWidth / 2, halfX - armWidth / 2]) {
    group.add(
      createBox(
        unitBox,
        materials.fabric,
        [armWidth, armHeight, size.z],
        [x, seatTop + armHeight / 2, 0],
      ),
    );
  }
  const cushionWidth = (size.x - armWidth * 2) / 2 - 0.01;
  const seatCushionDepth = size.z - backDepth - 0.03;
  const seatCushionHeight = 0.12;
  for (const x of [-cushionWidth / 2 - 0.005, cushionWidth / 2 + 0.005]) {
    group.add(
      createBox(
        unitBox,
        materials.cushion,
        [cushionWidth, seatCushionHeight, seatCushionDepth],
        [x, seatTop + seatCushionHeight / 2, -halfZ + backDepth + seatCushionDepth / 2],
      ),
    );
    const back = createBox(
      unitBox,
      materials.cushion,
      [cushionWidth, 0.4, 0.12],
      [x, seatTop + seatCushionHeight + 0.2, -halfZ + backDepth + 0.07],
    );
    // 少し後ろに傾ける（上端が -Z へ）
    back.rotation.x = -0.15;
    group.add(back);
  }
};

/** ペンダントライト（原点は天井取付点．下へ伸びる）．電球の子に PointLight を付ける */
const buildPendant: Builder = (group, size, ctx) => {
  const { materials } = ctx;
  group.add(cylinder(ctx, materials.white, 0.12, 0.03, -0.015));
  const shadeHeight = 0.2;
  const shadeTop = -size.y + shadeHeight;
  const cordLength = -0.03 - shadeTop;
  group.add(cylinder(ctx, materials.black, 0.008, cordLength, -0.03 - cordLength / 2));
  const shade = new THREE.Mesh(
    new THREE.CylinderGeometry(0.06, size.x / 2, shadeHeight, 20, 1, true),
    materials.shade,
  );
  shade.position.y = shadeTop - shadeHeight / 2;
  shade.name = "shade";
  group.add(shade);
  const bulb = new THREE.Mesh(new THREE.SphereGeometry(0.045, 12, 8), materials.bulb);
  bulb.position.y = shadeTop - 0.11;
  bulb.name = "bulb";
  bulb.add(new THREE.PointLight(0xffe6c0, 3, 0, 2));
  group.add(bulb);
};

/** 観葉植物（鉢＋土＋茎＋葉 5 枚） */
const buildPlant: Builder = (group, size, ctx) => {
  const { materials } = ctx;
  const potHeight = 0.3;
  const pot = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.12, potHeight, 16), materials.pot);
  pot.position.y = potHeight / 2;
  group.add(pot);
  group.add(cylinder(ctx, materials.soil, 0.3, 0.02, potHeight - 0.01));
  group.add(cylinder(ctx, materials.woodDark, 0.025, 0.55, potHeight + 0.275));
  const leafGeometry = new THREE.IcosahedronGeometry(1, 0);
  const leaves = [
    [0, size.y - 0.15, 0, 0.16, 0.15, 0.16],
    [0.1, 0.8, 0.04, 0.13, 0.17, 0.12],
    [-0.09, 0.75, -0.05, 0.12, 0.16, 0.13],
    [0.03, 0.62, -0.1, 0.12, 0.13, 0.11],
    [-0.04, 0.6, 0.1, 0.11, 0.13, 0.12],
  ] as const;
  for (const [x, y, z, sx, sy, sz] of leaves) {
    const leaf = new THREE.Mesh(leafGeometry, materials.leaf);
    leaf.position.set(x, y, z);
    leaf.scale.set(sx, sy, sz);
    leaf.rotation.set(x * 4, y * 3, z * 5);
    group.add(leaf);
  }
};

/** 掛け時計（枠＋文字盤＋針 2 本．10 時 10 分．原点は中心，正面は +Z） */
const buildClock: Builder = (group, size, ctx, id) => {
  const { unitBox, materials } = ctx;
  const frame = cylinder(ctx, materials.woodDark, size.x, size.z, 0);
  frame.rotation.x = Math.PI / 2;
  group.add(frame);
  const face = cylinder(ctx, materials.white, size.x - 0.04, 0.004, 0);
  face.rotation.x = Math.PI / 2;
  face.position.z = size.z / 2;
  group.add(face);
  // 角度は 12 時から時計回り（正面から見て）
  const hands = [
    { name: "hour", angle: ((10 + 10 / 60) / 12) * Math.PI * 2, length: 0.07, width: 0.012 },
    { name: "minute", angle: (10 / 60) * Math.PI * 2, length: 0.11, width: 0.008 },
  ];
  hands.forEach((hand, i) => {
    const mesh = createBox(
      unitBox,
      materials.black,
      [hand.width, hand.length, 0.003],
      [
        (Math.sin(hand.angle) * hand.length) / 2,
        (Math.cos(hand.angle) * hand.length) / 2,
        size.z / 2 + 0.004 + i * 0.003,
      ],
      `${id}-${hand.name}-hand`,
    );
    mesh.rotation.z = -hand.angle;
    group.add(mesh);
  });
};

const BUILDERS: Record<RoomFurnitureKind, Builder> = {
  table: buildTable,
  chair: buildChair,
  bookshelf: buildBookshelf,
  tvStand: buildTvStand,
  tv: buildTv,
  sofa: buildSofa,
  pendant: buildPendant,
  plant: buildPlant,
  clock: buildClock,
};

/** 家具 1 つの Group を作る */
export function createFurniture(
  def: FurnitureDef<RoomFurnitureKind>,
  ctx: FurnitureContext,
): THREE.Group {
  const group = createFurnitureGroup(def);
  BUILDERS[def.kind](group, def.size, ctx, def.id);
  return group;
}

/** 家具の一覧から Group をまとめて作る（本の並びはシード固定） */
export function createRoomFurniture(
  defs: readonly FurnitureDef<RoomFurnitureKind>[],
  materials: RoomMaterials,
  unitBox: THREE.BufferGeometry,
): THREE.Group[] {
  const ctx: FurnitureContext = {
    unitBox,
    unitCylinder: new THREE.CylinderGeometry(0.5, 0.5, 1, 16),
    materials,
    rand: mulberry32(505),
  };
  return defs.map((def) => createFurniture(def, ctx));
}
