// 壁の自動配置と，人・火・煙が隣のマスへ移れるかの規則のテスト．
// 基準は docs/04_SPEC/SPEC_02_校舎データの形式.md「壁の自動配置」「通れる・燃え広がる」
import { describe, expect, it } from "vitest";
import type { CellKind, Floor } from "../core/schoolPlan";
import { createFloorFromRows } from "../share/samples/floorFromRows";
import {
  canPersonStep,
  canSpreadStep,
  isSpreadableKind,
  isWalkableKind,
  wallBetween,
} from "./walls";

/** 2 文字（左右に並ぶ 2 マス）の階．教室は数字（rooms の添字） */
const pair = (a: string, b: string): Floor => createFloorFromRows(1, [`${a}${b}`]);
/** 2 文字（上下に並ぶ 2 マス）の階 */
const column = (a: string, b: string): Floor => createFloorFromRows(1, [a, b]);
/** 1 マスだけの階（周りはすべてマス目の外） */
const single = (a: string): Floor => createFloorFromRows(1, [a]);

const L = { x: 0, z: 0 };
const R = { x: 1, z: 0 };
const D = { x: 0, z: 1 };

// 文字: 0・1 教室（別の教室），h 廊下，o 屋外，d ドア，e 出口，s シャッター，. void，# wall
describe("wallBetween（SPEC_02「壁の自動配置」の表）", () => {
  it.each<[string, string, string, boolean]>([
    // 同じ空間どうし → 置かない
    ["同じ教室どうし", "0", "0", false],
    ["廊下どうし", "h", "h", false],
    ["屋外どうし", "o", "o", false],
    // 違う空間どうし → 置く
    ["教室と別の教室", "0", "1", true],
    ["教室と廊下", "0", "h", true],
    ["廊下と屋外", "h", "o", true],
    ["教室と屋外", "0", "o", true],
    // 開口と，教室・廊下・屋外 → 置かない
    ["ドアと教室", "d", "0", false],
    ["ドアと廊下", "d", "h", false],
    ["ドアと屋外", "d", "o", false],
    ["出口と教室", "e", "0", false],
    ["出口と廊下", "e", "h", false],
    ["出口と屋外", "e", "o", false],
    ["シャッターと教室", "s", "0", false],
    ["シャッターと廊下", "s", "h", false],
    ["シャッターと屋外", "s", "o", false],
    // 開口と開口 → 置かない
    ["ドアとドア", "d", "d", false],
    ["ドアと出口", "d", "e", false],
    ["ドアとシャッター", "d", "s", false],
    ["出口とシャッター", "e", "s", false],
    ["シャッターとシャッター", "s", "s", false],
    // 教室・廊下・開口と，void・wall → 置く
    ["教室と void", "0", ".", true],
    ["教室と wall", "0", "#", true],
    ["廊下と void", "h", ".", true],
    ["廊下と wall", "h", "#", true],
    ["ドアと void", "d", ".", true],
    ["ドアと wall", "d", "#", true],
    ["出口と void", "e", ".", true],
    ["出口と wall", "e", "#", true],
    ["シャッターと void", "s", ".", true],
    ["シャッターと wall", "s", "#", true],
    // 屋外と，void → 置かない（校庭の端）
    ["屋外と void", "o", ".", false],
  ])("%s（%s と %s）は壁 %s", (_label, a, b, expected) => {
    // 左右・上下・向きを入れ替えても同じ
    expect(wallBetween(pair(a, b), L, R)).toBe(expected);
    expect(wallBetween(pair(a, b), R, L)).toBe(expected);
    expect(wallBetween(pair(b, a), L, R)).toBe(expected);
    expect(wallBetween(column(a, b), L, D)).toBe(expected);
    expect(wallBetween(column(a, b), D, L)).toBe(expected);
  });

  const outside = [
    { x: -1, z: 0 },
    { x: 1, z: 0 },
    { x: 0, z: -1 },
    { x: 0, z: 1 },
  ];

  it.each<[string, string, boolean]>([
    ["教室", "0", true],
    ["廊下", "h", true],
    ["ドア", "d", true],
    ["出口", "e", true],
    ["シャッター", "s", true],
    ["屋外", "o", false],
  ])("%s とマス目の外（4 方向）の間は壁 %s", (_label, a, expected) => {
    for (const out of outside) {
      expect(wallBetween(single(a), L, out)).toBe(expected);
      expect(wallBetween(single(a), out, L)).toBe(expected);
    }
  });

  it("教室の空間は roomOf の値で区別する（同じ値なら壁なし，違えば壁あり）", () => {
    const floor: Floor = {
      level: 1,
      width: 3,
      depth: 1,
      cells: ["classroom", "classroom", "classroom"],
      roomOf: [4, 4, 7],
    };
    expect(wallBetween(floor, L, R)).toBe(false);
    expect(wallBetween(floor, R, { x: 2, z: 0 })).toBe(true);
  });

  it.each([
    ["同じマス", { x: 0, z: 0 }, { x: 0, z: 0 }],
    ["斜め", { x: 0, z: 0 }, { x: 1, z: 1 }],
    ["2 マス離れた", { x: 0, z: 0 }, { x: 2, z: 0 }],
    ["遠く離れたマス目の外", { x: -5, z: 3 }, { x: 10, z: 10 }],
  ])("隣り合わない 2 マス（%s）は RangeError", (_label, a, b) => {
    const floor = createFloorFromRows(1, ["hhh", "hhh"]);
    expect(() => wallBetween(floor, a, b)).toThrow(RangeError);
  });

  it("デモの校舎のように，シャッターの左右の廊下とは壁なしでつながる", () => {
    const floor = createFloorFromRows(1, ["hsh"]);
    expect(wallBetween(floor, { x: 0, z: 0 }, { x: 1, z: 0 })).toBe(false);
    expect(wallBetween(floor, { x: 1, z: 0 }, { x: 2, z: 0 })).toBe(false);
  });
});

describe("isWalkableKind", () => {
  it.each<[CellKind | null, boolean]>([
    ["classroom", true],
    ["corridor", true],
    ["door", true],
    ["exit", true],
    ["shutter", true], // くぐり戸を通れる
    ["outdoor", true],
    ["void", false],
    ["wall", false],
    [null, false], // マス目の外
  ])("%s は %s", (kind, expected) => {
    expect(isWalkableKind(kind)).toBe(expected);
  });
});

describe("isSpreadableKind", () => {
  it.each<[CellKind | null, boolean]>([
    ["classroom", true],
    ["corridor", true],
    ["door", true],
    ["exit", true],
    ["shutter", false], // 防火シャッターで止まる
    ["outdoor", false], // 屋外へは広がらない
    ["void", false],
    ["wall", false],
    [null, false],
  ])("%s は %s", (kind, expected) => {
    expect(isSpreadableKind(kind)).toBe(expected);
  });
});

describe("canPersonStep", () => {
  it.each<[string, string, string, boolean]>([
    ["廊下 → 廊下", "h", "h", true],
    ["廊下 → ドア", "h", "d", true],
    ["ドア → 教室", "d", "0", true],
    ["廊下 → シャッター（くぐり戸）", "h", "s", true],
    ["出口 → 屋外", "e", "o", true],
    ["廊下 → 屋外（間に壁）", "h", "o", false],
    ["教室 → 廊下（間に壁）", "0", "h", false],
    ["廊下 → void", "h", ".", false],
    ["廊下 → wall", "h", "#", false],
    ["屋外 → void（壁は無いが入れない）", "o", ".", false],
  ])("%s は %s", (_label, a, b, expected) => {
    expect(canPersonStep(pair(a, b), L, R)).toBe(expected);
  });

  it("マス目の外へは出られない（屋外の端でも）", () => {
    expect(canPersonStep(single("o"), L, { x: -1, z: 0 })).toBe(false);
    expect(canPersonStep(single("o"), L, { x: 0, z: 1 })).toBe(false);
  });
});

describe("canSpreadStep", () => {
  it.each<[string, string, string, boolean]>([
    ["廊下 → 廊下", "h", "h", true],
    ["教室 → ドア", "0", "d", true],
    ["ドア → 廊下", "d", "h", true],
    ["廊下 → 出口", "h", "e", true],
    ["廊下 → シャッター", "h", "s", false],
    ["出口 → 屋外", "e", "o", false],
    ["教室 → 廊下（間に壁）", "0", "h", false],
    ["教室 → 別の教室（間に壁）", "0", "1", false],
    ["廊下 → void", "h", ".", false],
    ["廊下 → wall", "h", "#", false],
  ])("%s は %s", (_label, a, b, expected) => {
    expect(canSpreadStep(pair(a, b), L, R)).toBe(expected);
  });

  it("マス目の外へは広がらない", () => {
    expect(canSpreadStep(single("h"), L, { x: 1, z: 0 })).toBe(false);
  });
});
