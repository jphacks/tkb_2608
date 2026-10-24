// 部屋の家具．1 つずつ独立した Group（原点・正面・userData は roomLayout の定義どおり）として作る．
// 触れる・動かす部品（テーブルの脚・コンロのつまみと火・ブレーカーのメインスイッチ）は家具の Group の中の
// 独立した子 Group にする

import * as THREE from "three";
import { type FurnitureDef, massFromDensity, type Size3 } from "../common/furniture";
import { createFurnitureGroup } from "../common/furnitureGroup";
import { createBox, mergeBoxes } from "../common/meshHelpers";
import { mulberry32, randomInt, randomRange } from "../common/random";
import {
  type BookUserData,
  BREAKER,
  type BreakerPanelUserData,
  type BreakerSwitchUserData,
  type RoomFurnitureKind,
  STOVE,
  STOVE_BURNERS,
  type StoveFlameUserData,
  type StoveKnobUserData,
  type StoveUserData,
  TABLE_PARTS,
  type TableLegUserData,
  type TableUserData,
  type TvUserData,
  tableLegId,
  tableLegLocalPositions,
} from "./roomLayout";
import type { RoomMaterials } from "./roomMaterials";

/** 家具を作るときに共有する部品 */
export interface FurnitureContext {
  /** 単位立方体（1×1×1）．scale で拡大して使い回す */
  readonly unitBox: THREE.BufferGeometry;
  /** 単位円柱（直径 1・高さ 1） */
  readonly unitCylinder: THREE.BufferGeometry;
  readonly materials: RoomMaterials;
  readonly rand: () => number;
  /** 形が同じ部品のジオメトリのキャッシュ（キーごとに 1 つだけ作って共有する） */
  readonly geometryCache: Map<string, THREE.BufferGeometry>;
}

type Builder = (group: THREE.Group, size: Size3, ctx: FurnitureContext, id: string) => void;

/** 本の密度（kg/m^3） */
const BOOK_DENSITY = 600;

function cached(
  ctx: FurnitureContext,
  key: string,
  build: () => THREE.BufferGeometry,
): THREE.BufferGeometry {
  let geometry = ctx.geometryCache.get(key);
  if (!geometry) {
    geometry = build();
    ctx.geometryCache.set(key, geometry);
  }
  return geometry;
}

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

/**
 * テーブル．天板と脚は別にし，脚は 1 本ずつ独立した子 Group（原点は脚の底面中央）にする
 * （テーブルの下に潜る当たり判定と，脚を握る判定のため）
 */
const buildTable: Builder = (group, size, { unitBox, materials }, id) => {
  const top = TABLE_PARTS.topThickness;
  const leg = TABLE_PARTS.legThickness;
  group.add(
    createBox(
      unitBox,
      materials.woodLight,
      [size.x, top, size.z],
      [0, size.y - top / 2, 0],
      `${id}-top`,
    ),
  );
  const legHeight = size.y - top;
  const legIds = tableLegLocalPositions(size).map(([x, y, z], i) => {
    const legId = tableLegId(id, i);
    const legGroup = new THREE.Group();
    legGroup.name = legId;
    legGroup.position.set(x, y, z);
    const userData: TableLegUserData = {
      id: legId,
      kind: "tableLeg",
      tableId: id,
      index: i + 1,
      size: { x: leg, y: legHeight, z: leg },
      grabbed: false,
    };
    legGroup.userData = userData;
    legGroup.add(
      createBox(unitBox, materials.woodDark, [leg, legHeight, leg], [0, legHeight / 2, 0]),
    );
    group.add(legGroup);
    return legId;
  });
  const userData: TableUserData = { ...(group.userData as TableUserData), legIds };
  group.userData = userData;
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
      const bookData: BookUserData = {
        id: bookId,
        kind: "book",
        size: bookSize,
        mass: massFromDensity(bookSize, BOOK_DENSITY),
      };
      book.userData = bookData;
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

/** テレビ（台座＋首＋本体＋画面．画面は +Z 向き）．① で音を流す発生源で，既定は点いている */
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
  const userData: TvUserData = {
    ...(group.userData as TvUserData),
    screenName: screen.name,
    on: true,
  };
  group.userData = userData;
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

/**
 * キッチンカウンター（正面 +Z．台輪＋本体＋扉 3 枚＋天板＋シンク＋水栓）．
 * コンロは上に載る別の家具（stove）
 */
const buildKitchenCounter: Builder = (group, size, { unitBox, materials }) => {
  const plinth = 0.1;
  const topThickness = 0.03;
  const bodyHeight = size.y - topThickness - plinth;
  const halfZ = size.z / 2;
  group.add(
    createBox(unitBox, materials.black, [size.x, plinth, size.z - 0.08], [0, plinth / 2, -0.04]),
    createBox(
      unitBox,
      materials.cabinet,
      [size.x, bodyHeight, size.z - 0.03],
      [0, plinth + bodyHeight / 2, -0.015],
    ),
    createBox(
      unitBox,
      materials.counterTop,
      [size.x, topThickness, size.z],
      [0, size.y - topThickness / 2, 0],
    ),
  );
  const doorWidth = size.x / 3 - 0.02;
  for (const x of [-size.x / 3, 0, size.x / 3]) {
    group.add(
      createBox(
        unitBox,
        materials.woodLight,
        [doorWidth, bodyHeight - 0.04, 0.012],
        [x, plinth + bodyHeight / 2, halfZ - 0.03 + 0.006],
      ),
    );
  }
  // シンク（コンロと反対の端．天板の上の薄い板）と水栓
  const sinkX = -size.x / 4;
  group.add(
    createBox(unitBox, materials.sink, [0.5, 0.004, 0.36], [sinkX, size.y + 0.002, 0]),
    createBox(unitBox, materials.metal, [0.03, 0.26, 0.03], [sinkX, size.y + 0.13, -halfZ + 0.06]),
    createBox(
      unitBox,
      materials.metal,
      [0.025, 0.025, 0.18],
      [sinkX, size.y + 0.25, -halfZ + 0.15],
    ),
  );
};

/**
 * ガスコンロ（正面 +Z．本体＋天板＋口 2 つ）．口ごとに火（子 Group．既定は点火）と，
 * 正面に消す操作の対象のつまみ（子 Group）を置く
 */
const buildStove: Builder = (group, size, ctx, id) => {
  const { unitBox, materials } = ctx;
  const plate = 0.01;
  group.add(
    createBox(
      unitBox,
      materials.stoveBody,
      [size.x, size.y - plate, size.z],
      [0, (size.y - plate) / 2, 0],
    ),
    createBox(unitBox, materials.stoveTop, [size.x, plate, size.z], [0, size.y - plate / 2, 0]),
  );
  const flameGeometry = cached(
    ctx,
    "stove-flame",
    () =>
      // 上へ細くなる円錐台の側面（青い炎の輪）
      new THREE.CylinderGeometry(
        STOVE.flameDiameter * 0.3,
        STOVE.flameDiameter / 2,
        STOVE.flameHeight,
        16,
        1,
        true,
      ),
  );
  for (const burner of STOVE_BURNERS) {
    const burnerTop = size.y + STOVE.burnerHeight;
    const cap = cylinder(
      ctx,
      materials.black,
      STOVE.burnerDiameter,
      STOVE.burnerHeight,
      size.y + STOVE.burnerHeight / 2,
      `${id}-burner-${burner.index}`,
    );
    cap.position.x = burner.x;
    cap.position.z = STOVE.burnerZ;
    group.add(cap);

    const flame = new THREE.Group();
    flame.name = burner.flameId;
    flame.position.set(burner.x, burnerTop, STOVE.burnerZ);
    const flameData: StoveFlameUserData = {
      id: burner.flameId,
      kind: "stoveFlame",
      stoveId: id,
      knobId: burner.knobId,
      lit: true,
    };
    flame.userData = flameData;
    const flameMesh = new THREE.Mesh(flameGeometry, materials.flame);
    flameMesh.position.y = STOVE.flameHeight / 2;
    flame.add(flameMesh);
    group.add(flame);

    // つまみ（正面の板から +Z へ出る円柱と，向きを示す白い印）
    const knob = new THREE.Group();
    knob.name = burner.knobId;
    knob.position.set(burner.x, STOVE.knobY, size.z / 2);
    const knobData: StoveKnobUserData = {
      id: burner.knobId,
      kind: "stoveKnob",
      stoveId: id,
      flameId: burner.flameId,
      diameter: STOVE.knobDiameter,
      on: true,
    };
    knob.userData = knobData;
    const body = cylinder(ctx, materials.black, STOVE.knobDiameter, STOVE.knobDepth, 0);
    body.rotation.x = Math.PI / 2;
    body.position.z = STOVE.knobDepth / 2;
    knob.add(
      body,
      createBox(
        unitBox,
        materials.white,
        [0.006, STOVE.knobDiameter * 0.45, 0.003],
        [0, STOVE.knobDiameter * 0.2, STOVE.knobDepth + 0.0015],
        `${burner.knobId}-mark`,
      ),
    );
    group.add(knob);
  }
  const userData: StoveUserData = {
    ...(group.userData as StoveUserData),
    knobIds: STOVE_BURNERS.map((b) => b.knobId),
    flameIds: STOVE_BURNERS.map((b) => b.flameId),
  };
  group.userData = userData;
};

/**
 * 分電盤（原点は箱の中心，正面 +Z）．左にメインスイッチ（子 Group．既定は入），
 * 右下に動かない分岐ブレーカーの列
 */
const buildBreakerPanel: Builder = (group, size, { unitBox, materials }, id) => {
  const front = size.z / 2;
  group.add(createBox(unitBox, materials.cabinet, [size.x, size.y, size.z], [0, 0, 0]));
  // 分岐ブレーカー（台の板と，小さなレバーを 1 Mesh にまとめた列）
  const rowY = -0.08;
  group.add(createBox(unitBox, materials.metal, [0.2, 0.06, 0.01], [0.04, rowY, front + 0.005]));
  const pitch = 0.03;
  const firstX = 0.04 - (pitch * (BREAKER.branchCount - 1)) / 2;
  const levers = new THREE.Mesh(
    mergeBoxes(
      Array.from({ length: BREAKER.branchCount }, (_, i) => ({
        size: [0.014, 0.022, 0.012] as const,
        position: [firstX + i * pitch, rowY + 0.006, front + 0.016] as const,
      })),
    ),
    materials.breakerLever,
  );
  levers.name = `${id}-branches`;
  group.add(levers);

  const mainSwitch = new THREE.Group();
  mainSwitch.name = BREAKER.mainSwitchId;
  mainSwitch.position.set(BREAKER.mainSwitchX, BREAKER.mainSwitchY, front);
  const leverName = `${BREAKER.mainSwitchId}-lever`;
  const switchData: BreakerSwitchUserData = {
    id: BREAKER.mainSwitchId,
    kind: "breakerSwitch",
    panelId: id,
    leverName,
    on: true,
  };
  mainSwitch.userData = switchData;
  mainSwitch.add(
    createBox(unitBox, materials.metal, [0.07, 0.1, 0.02], [0, 0, 0.01]),
    // レバー（入で上側）
    createBox(unitBox, materials.breakerLever, [0.026, 0.04, 0.016], [0, 0.02, 0.028], leverName),
  );
  group.add(mainSwitch);

  const userData: BreakerPanelUserData = {
    ...(group.userData as BreakerPanelUserData),
    switchIds: [BREAKER.mainSwitchId],
  };
  group.userData = userData;
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
  kitchenCounter: buildKitchenCounter,
  stove: buildStove,
  breakerPanel: buildBreakerPanel,
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
    geometryCache: new Map(),
  };
  return defs.map((def) => createFurniture(def, ctx));
}
