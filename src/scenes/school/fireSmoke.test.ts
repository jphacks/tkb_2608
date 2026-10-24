// 火と煙の見た目（F4）の three.js の組み立て（fireSmoke.ts）のテスト．
// 基準は SPEC_01「VR 避難の規則」（煙は天井近くほど濃く，しゃがむと視界が晴れる．燃えているマス＝火が着く時刻 ≤ 今），
// SPEC_01「処理速度」（毎フレームの update で new しない），SPEC_02「座標」（level 階の床 y = (level - 1) * 3.5，天井 3 m）と Issue #96 の振る舞いの約束．
// 描画結果は見ず，Group の構造（名前・子の数・頂点の数・高さ）と update による状態の変化・解放を確かめる
import * as THREE from "three";
import { describe, expect, it } from "vitest";
import type { CellRef, SchoolPlan } from "../../core/schoolPlan";
import { DEMO_SCHOOL } from "../../share/samples/demoSchool";
import { createFloorFromRows } from "../../share/samples/floorFromRows";
import { computeSpread } from "../../sim/spread";
import {
  createFireSmoke,
  FIRE_MESH_NAME,
  FIRE_SMOKE_NAME,
  type FireSmoke,
  GLOW_MESH_NAME,
  SMOKE_MESH_NAME,
} from "./fireSmoke";
import {
  eyeSmokeDensity,
  FIRE_PARTICLES,
  isEmberParticle,
  listFireSmokeCells,
  SMOKE_CEILING_HEIGHT,
  SMOKE_LAYER_COUNT,
  smokeAtHeight,
  smokeLayerHeight,
} from "./fireSmokeLayout";

const at = (x: number, z: number, floor = 0): CellRef => ({ floor, x, z });

/** 行の文字列から校舎を作る（階ごとの行．火元だけ上書き） */
function makePlan(
  floorsRows: readonly (readonly string[])[],
  fireOrigins: readonly CellRef[] = [],
): SchoolPlan {
  return {
    version: 1,
    name: "テスト校舎",
    cellSize: 1,
    floors: floorsRows.map((rows, i) => createFloorFromRows(i + 1, rows)),
    rooms: [{ name: "教室A" }],
    drill: {
      mode: "learn",
      fireOrigins,
      start: at(0, 0),
      startYaw: 0,
      assembly: [],
      route: [],
      timeLimitSeconds: 150,
      spread: { fireSecondsPerCell: 6, smokeSecondsPerCell: 2, extraFires: [] },
    },
  };
}

function build(plan: SchoolPlan = DEMO_SCHOOL): FireSmoke {
  return createFireSmoke(plan, computeSpread(plan));
}

function meshByName(fs: FireSmoke, name: string): THREE.Mesh {
  const mesh = fs.object.getObjectByName(name);
  if (!(mesh instanceof THREE.Mesh)) throw new Error(`${name} の Mesh が無い`);
  return mesh;
}

function shaderOf(mesh: THREE.Mesh): THREE.ShaderMaterial {
  if (!(mesh.material instanceof THREE.ShaderMaterial)) throw new Error("ShaderMaterial でない");
  return mesh.material;
}

function cellTextureOf(fs: FireSmoke): THREE.DataTexture {
  const tex = shaderOf(meshByName(fs, SMOKE_MESH_NAME)).uniforms.uCells.value;
  if (!(tex instanceof THREE.DataTexture)) throw new Error("uCells が DataTexture でない");
  return tex;
}

/** 理科室の火元の隣（十分後に最も濃い煙のマス）の目の位置 */
const standingEye = { x: 15.5, y: 1.6, z: 2.5 };
const crouchingEye = { x: 15.5, y: 0.9, z: 2.5 };

describe("createFireSmoke（デモの校舎の構造）", () => {
  it("名前付きの Group の中に照り返し・煙の層・炎の粒の 3 つ", () => {
    const fs = build();
    expect(fs.object).toBeInstanceOf(THREE.Group);
    expect(fs.object.name).toBe(FIRE_SMOKE_NAME);
    expect(fs.object.children.map((c) => c.name).sort()).toEqual(
      [GLOW_MESH_NAME, SMOKE_MESH_NAME, FIRE_MESH_NAME].sort(),
    );
    fs.dispose();
  });

  it("fog は FogExp2 で，作った直後（時刻 0・目なし）は濃さ 0", () => {
    const fs = build();
    expect(fs.fog).toBeInstanceOf(THREE.FogExp2);
    expect(fs.fog.density).toBe(0);
    fs.dispose();
  });

  it("cells は listFireSmokeCells の結果と同じ", () => {
    const fs = build();
    expect(fs.cells).toEqual(listFireSmokeCells(DEMO_SCHOOL, computeSpread(DEMO_SCHOOL)));
    fs.dispose();
  });

  it("作った直後から時刻 0（非常ベル）の様子になっている（火元 1 マスが燃え，煙はまだ濃くない）", () => {
    const fs = build();
    expect(fs.stats.seconds).toBe(0);
    expect(fs.stats.burningCells).toBe(1);
    expect(fs.stats.smokyCells).toBe(0);
    expect(fs.stats.eyeSmoke).toBe(0);
    expect(fs.stats.fogDensity).toBe(0);
    fs.dispose();
  });

  it("煙の層は 1 階 × 4 枚 × 4 頂点で，高さは床からの層の高さ（天井 3 m より下）", () => {
    const fs = build();
    const geometry = meshByName(fs, SMOKE_MESH_NAME).geometry;
    const position = geometry.getAttribute("position");
    expect(SMOKE_LAYER_COUNT).toBe(4);
    expect(position.count).toBe(DEMO_SCHOOL.floors.length * SMOKE_LAYER_COUNT * 4);
    const ys = new Set<number>();
    for (let i = 0; i < position.count; i++) ys.add(Math.round(position.getY(i) * 1000) / 1000);
    const expected = [0, 1, 2, 3].map((i) => Math.round(smokeLayerHeight(i) * 1000) / 1000);
    expect([...ys].sort()).toEqual([...expected].sort());
    for (const y of ys) expect(y).toBeLessThan(SMOKE_CEILING_HEIGHT);
    fs.dispose();
  });

  it("煙の層は校舎のマス目全体（幅 19 m × 奥行き 13 m）を覆う", () => {
    const fs = build();
    const geometry = meshByName(fs, SMOKE_MESH_NAME).geometry;
    geometry.computeBoundingBox();
    const box = geometry.boundingBox;
    if (box === null) throw new Error("bounding box が無い");
    expect(box.min.x).toBeCloseTo(0, 10);
    expect(box.min.z).toBeCloseTo(0, 10);
    expect(box.max.x).toBeCloseTo(19, 10);
    expect(box.max.z).toBeCloseTo(13, 10);
    fs.dispose();
  });

  it("照り返しは床のすぐ上の板 1 枚（4 頂点）", () => {
    const fs = build();
    const position = meshByName(fs, GLOW_MESH_NAME).geometry.getAttribute("position");
    expect(position.count).toBe(4);
    for (let i = 0; i < position.count; i++) {
      expect(position.getY(i)).toBeGreaterThan(0);
      expect(position.getY(i)).toBeLessThan(0.1);
    }
    fs.dispose();
  });

  it("炎の粒は InstancedBufferGeometry の Mesh で，粒の数は FIRE_PARTICLES.count", () => {
    const fs = build();
    const mesh = meshByName(fs, FIRE_MESH_NAME);
    expect(mesh).not.toBeInstanceOf(THREE.InstancedMesh);
    expect(mesh.geometry).toBeInstanceOf(THREE.InstancedBufferGeometry);
    expect((mesh.geometry as THREE.InstancedBufferGeometry).instanceCount).toBe(
      FIRE_PARTICLES.count,
    );
    fs.dispose();
  });

  it("煙の層と照り返しは同じ DataTexture（RGBA8．1 マス 1 テクセル＋縁）を共有する", () => {
    const fs = build();
    const glowTex = shaderOf(meshByName(fs, GLOW_MESH_NAME)).uniforms.uCells.value;
    const tex = cellTextureOf(fs);
    expect(glowTex).toBe(tex);
    expect(tex.format).toBe(THREE.RGBAFormat);
    expect(tex.type).toBe(THREE.UnsignedByteType);
    expect(tex.image.width).toBe(19 + 2);
    expect(tex.image.height).toBe(13 + 2);
    expect(tex.image.data).toHaveLength(21 * 15 * 4);
    fs.dispose();
  });
});

describe("createFireSmoke（2 階建て）", () => {
  it("煙の層の頂点は 階の数 × 4 枚 × 4 頂点で，2 階の層は 3.5 m 上", () => {
    const plan = makePlan([["hhh", "hhh"], ["hhh"]], [at(1, 0, 0), at(1, 0, 1)]);
    const fs = build(plan);
    const position = meshByName(fs, SMOKE_MESH_NAME).geometry.getAttribute("position");
    expect(position.count).toBe(2 * SMOKE_LAYER_COUNT * 4);
    const ys = new Set<number>();
    for (let i = 0; i < position.count; i++) ys.add(Math.round(position.getY(i) * 1000) / 1000);
    for (let i = 0; i < SMOKE_LAYER_COUNT; i++) {
      expect(ys.has(Math.round(smokeLayerHeight(i) * 1000) / 1000)).toBe(true);
      expect(ys.has(Math.round((3.5 + smokeLayerHeight(i)) * 1000) / 1000)).toBe(true);
    }
    expect(meshByName(fs, GLOW_MESH_NAME).geometry.getAttribute("position").count).toBe(8);
    fs.dispose();
  });
});

describe("createFireSmoke（火も煙も無い校舎）", () => {
  it("中身が空の Group を返し，update はフォグを 0 にするだけ", () => {
    const fs = build(makePlan([["hhh"]]));
    expect(fs.object.name).toBe(FIRE_SMOKE_NAME);
    expect(fs.object.children).toHaveLength(0);
    expect(fs.cells.fire).toEqual([]);
    expect(fs.cells.smoke).toEqual([]);
    fs.update(100, { x: 1.5, y: 1.6, z: 0.5 });
    expect(fs.fog.density).toBe(0);
    expect(fs.stats.burningCells).toBe(0);
    expect(fs.stats.smokyCells).toBe(0);
    expect(fs.stats.eyeSmoke).toBe(0);
    expect(() => fs.dispose()).not.toThrow();
  });
});

describe("FireSmoke.update", () => {
  it("煙の中で立つとフォグが濃く，しゃがむと薄くなる（F4）", () => {
    const fs = build();
    fs.update(1000, standingEye);
    const standingFog = fs.fog.density;
    const standingEyeSmoke = fs.stats.eyeSmoke;
    expect(standingEyeSmoke).toBeCloseTo(smokeAtHeight(1, 1.6), 10);
    expect(standingFog).toBeCloseTo(0.8 * standingEyeSmoke, 10);
    fs.update(1000, crouchingEye);
    expect(fs.stats.eyeSmoke).toBeCloseTo(0.12, 10);
    expect(fs.fog.density).toBeCloseTo(0.8 * 0.12, 10);
    expect(fs.fog.density).toBeLessThan(standingFog);
    fs.dispose();
  });

  it("stats.eyeSmoke は eyeSmokeDensity と同じで，fogDensity は fog.density と同じ", () => {
    const fs = build();
    const spread = computeSpread(DEMO_SCHOOL);
    for (const [t, eye] of [
      [10, standingEye],
      [25, { x: 14.2, y: 1.6, z: 6.7 }],
      [60, crouchingEye],
    ] as const) {
      fs.update(t, eye);
      expect(fs.stats.eyeSmoke).toBe(eyeSmokeDensity(DEMO_SCHOOL, spread, t, eye));
      expect(fs.stats.fogDensity).toBe(fs.fog.density);
    }
    fs.dispose();
  });

  it("目の位置が null の時はフォグを 0 にする", () => {
    const fs = build();
    fs.update(1000, standingEye);
    expect(fs.fog.density).toBeGreaterThan(0);
    fs.update(1000, null);
    expect(fs.fog.density).toBe(0);
    expect(fs.stats.eyeSmoke).toBe(0);
    fs.dispose();
  });

  it("防火シャッターより西（1年1組）ではいつまでもフォグは 0", () => {
    const fs = build();
    for (const t of [0, 60, 150, 1000]) {
      fs.update(t, { x: 2.5, y: 1.6, z: 2.5 });
      expect(fs.fog.density).toBe(0);
      fs.update(t, { x: 11.5, y: 1.6, z: 6.5 });
      expect(fs.fog.density).toBe(0);
    }
    fs.dispose();
  });

  it("燃えているマスの数は，火が着く時刻 ≤ 今のマスの数（時間とともに増える）", () => {
    const fs = build();
    const spread = computeSpread(DEMO_SCHOOL);
    let prev = 0;
    for (const t of [0, 5.999, 6, 12, 60, 300]) {
      fs.update(t, null);
      const expected = spread.fireSeconds[0].filter((s) => s <= t).length;
      expect(fs.stats.burningCells).toBe(expected);
      expect(fs.stats.burningCells).toBeGreaterThanOrEqual(prev);
      expect(fs.stats.seconds).toBe(t);
      prev = fs.stats.burningCells;
    }
    fs.dispose();
  });

  it("負の時刻（非常ベルより前）は何も燃えておらず煙も無い", () => {
    const fs = build();
    fs.update(-1, standingEye);
    expect(fs.stats.burningCells).toBe(0);
    expect(fs.stats.smokyCells).toBe(0);
    expect(fs.fog.density).toBe(0);
    expect(Array.from(cellTextureOf(fs).image.data ?? [1]).every((b) => b === 0)).toBe(true);
    fs.dispose();
  });

  it("時刻が NaN の時は炎のメッシュを隠し，何も燃えておらずフォグも 0．有限の時刻に戻すと見える", () => {
    const fs = build();
    const fire = meshByName(fs, FIRE_MESH_NAME);
    fs.update(30, standingEye);
    expect(fire.visible).toBe(true);
    fs.update(Number.NaN, standingEye);
    expect(fire.visible).toBe(false);
    expect(fs.stats.burningCells).toBe(0);
    expect(fs.fog.density).toBe(0);
    fs.update(31, standingEye);
    expect(fire.visible).toBe(true);
    fs.dispose();
  });

  it("時刻が Infinity の時も炎のメッシュを隠す", () => {
    const fs = build();
    fs.update(Infinity, null);
    expect(meshByName(fs, FIRE_MESH_NAME).visible).toBe(false);
    fs.dispose();
  });

  it("stats は update のたびに新しく作らず同じオブジェクトを書き換える", () => {
    const fs = build();
    const stats = fs.stats;
    fs.update(10, standingEye);
    fs.update(500, crouchingEye);
    expect(fs.stats).toBe(stats);
    expect(stats.seconds).toBe(500);
    fs.dispose();
  });

  it("update で fog・テクスチャ・その中身・粒の属性を作り直さない", () => {
    const fs = build();
    const fog = fs.fog;
    const tex = cellTextureOf(fs);
    const data = tex.image.data;
    const fireGeometry = meshByName(fs, FIRE_MESH_NAME).geometry;
    const spawn = fireGeometry.getAttribute("aSpawn");
    const spawnArray = spawn.array;
    for (const t of [1, 2, 30, 200]) fs.update(t, standingEye);
    expect(fs.fog).toBe(fog);
    expect(cellTextureOf(fs)).toBe(tex);
    expect(tex.image.data).toBe(data);
    expect(fireGeometry.getAttribute("aSpawn")).toBe(spawn);
    expect(spawn.array).toBe(spawnArray);
    fs.dispose();
  });

  it("テクスチャは中身が変わった時だけ GPU へ送る（同じ時刻の 2 回目は version が増えない）", () => {
    const fs = build();
    const tex = cellTextureOf(fs);
    fs.update(10, null);
    const v = tex.version;
    fs.update(10, null);
    expect(tex.version).toBe(v);
    fs.update(11, null);
    expect(tex.version).toBeGreaterThan(v);
    fs.dispose();
  });

  it("テクスチャの中身は時刻とともに変わり，十分後は火元のマスの煙・炎が最大", () => {
    const fs = build();
    const tex = cellTextureOf(fs);
    fs.update(1000, null);
    const data = tex.image.data as Uint8Array;
    // 火元 (16, 2) のテクセル（縁 1 を足す）
    const o = ((2 + 1) * 21 + 16 + 1) * 4;
    expect(data[o]).toBe(255);
    expect(data[o + 1]).toBe(255);
    expect(data[o + 2]).toBe(255);
    fs.dispose();
  });

  it("粒の位置は生まれ直した粒の分だけ書き直す（同じ時刻の 2 回目は version が増えない）", () => {
    const fs = build();
    const spawn = meshByName(fs, FIRE_MESH_NAME).geometry.getAttribute(
      "aSpawn",
    ) as THREE.InstancedBufferAttribute;
    fs.update(20, null);
    const v = spawn.version;
    fs.update(20, null);
    expect(spawn.version).toBe(v);
    fs.update(25, null);
    expect(spawn.version).toBeGreaterThan(v);
    fs.dispose();
  });

  it("燃えている時刻には，出す粒の位置は燃えているマスの近く・床の高さにある", () => {
    const fs = build();
    const spread = computeSpread(DEMO_SCHOOL);
    const t = 40;
    fs.update(t, standingEye);
    const spawn = meshByName(fs, FIRE_MESH_NAME).geometry.getAttribute("aSpawn");
    const burning = fs.cells.fire.filter((c) => c.seconds <= t);
    let active = 0;
    for (let i = 0; i < spawn.count; i++) {
      const ignition = spawn.getW(i);
      if (ignition > t) continue;
      active++;
      expect(spawn.getY(i)).toBe(0);
      const x = spawn.getX(i);
      const z = spawn.getZ(i);
      const near = burning.some(
        (c) => Math.abs(x - c.centerX) <= 0.625 + 1e-6 && Math.abs(z - c.centerZ) <= 0.625 + 1e-6,
      );
      expect(near).toBe(true);
      // 割り当てたマスに火が着く時刻は SpreadMap の時刻のどれか
      expect(spread.fireSeconds[0]).toContain(ignition);
    }
    expect(active).toBeGreaterThan(0);
    expect(active).toBeLessThanOrEqual(Math.min(FIRE_PARTICLES.count, burning.length * 20));
    fs.dispose();
  });
});

describe("FireSmoke の炎の粒（火の粉・先の細い炎）", () => {
  it("aKind は粒ごとに isEmberParticle と同じ（火の粉は粒の数を増やさず，同じ描画で出す）", () => {
    const fs = build();
    const kind = meshByName(fs, FIRE_MESH_NAME).geometry.getAttribute("aKind");
    expect(kind.count).toBe(FIRE_PARTICLES.count);
    let embers = 0;
    for (let i = 0; i < kind.count; i++) {
      expect(kind.getX(i)).toBe(isEmberParticle(i) ? 1 : 0);
      if (kind.getX(i) === 1) embers++;
    }
    expect(embers).toBeGreaterThan(0);
    expect(embers).toBeLessThan(FIRE_PARTICLES.count);
    fs.dispose();
  });

  it("出す粒の aCenter は燃えているマスの中心で，生まれる位置はそこから ±0.625 マス以内", () => {
    const fs = build();
    const t = 40;
    fs.update(t, standingEye);
    const geometry = meshByName(fs, FIRE_MESH_NAME).geometry;
    const spawn = geometry.getAttribute("aSpawn");
    const center = geometry.getAttribute("aCenter");
    const burning = fs.cells.fire.filter((c) => c.seconds <= t);
    let active = 0;
    for (let i = 0; i < spawn.count; i++) {
      if (spawn.getW(i) > t) continue;
      active++;
      const cx = center.getX(i);
      const cz = center.getY(i);
      expect(burning.some((c) => c.centerX === cx && c.centerZ === cz)).toBe(true);
      expect(Math.abs(spawn.getX(i) - cx)).toBeLessThanOrEqual(0.625 + 1e-6);
      expect(Math.abs(spawn.getZ(i) - cz)).toBeLessThanOrEqual(0.625 + 1e-6);
    }
    expect(active).toBeGreaterThan(0);
    fs.dispose();
  });

  it("update で aCenter を作り直さず，生まれ直した粒がある時だけ GPU へ送る", () => {
    const fs = build();
    const center = meshByName(fs, FIRE_MESH_NAME).geometry.getAttribute(
      "aCenter",
    ) as THREE.InstancedBufferAttribute;
    const array = center.array;
    fs.update(20, null);
    const v = center.version;
    fs.update(20, null);
    expect(center.version).toBe(v);
    fs.update(25, null);
    expect(center.version).toBeGreaterThan(v);
    expect(center.array).toBe(array);
    fs.dispose();
  });
});

describe("FireSmoke.dispose", () => {
  it("DataTexture・全てのジオメトリ・マテリアルを解放する", () => {
    const fs = build();
    const disposed: string[] = [];
    const tex = cellTextureOf(fs);
    tex.addEventListener("dispose", () => disposed.push("texture"));
    for (const name of [GLOW_MESH_NAME, SMOKE_MESH_NAME, FIRE_MESH_NAME]) {
      const mesh = meshByName(fs, name);
      mesh.geometry.addEventListener("dispose", () => disposed.push(`${name}:geometry`));
      shaderOf(mesh).addEventListener("dispose", () => disposed.push(`${name}:material`));
    }
    fs.dispose();
    expect(disposed).toContain("texture");
    for (const name of [GLOW_MESH_NAME, SMOKE_MESH_NAME, FIRE_MESH_NAME]) {
      expect(disposed).toContain(`${name}:geometry`);
      expect(disposed).toContain(`${name}:material`);
    }
  });
});
