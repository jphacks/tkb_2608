// AI の矩形 → マス目の下書き（draftFromBoxes）のテスト．
// 基準は docs/04_SPEC/SPEC_02「配置の下書き」（FloorDraft の形・名前が読めなければ「教室1」等）と，PR #168 で決めたこと:
// 0〜1000 の正規化座標の矩形をマスの境界に丸める・重なりは面積の小さい矩形を優先・どの矩形にも入らないマスは void・
// 種類の対応（階段は exit，EV は wall）・教室と廊下が接する辺の中央付近にドアを 1 か所置く
import { describe, expect, it } from "vitest";
import type { DraftRoomBox, DraftRoomKind } from "../core/floorDraftApi";
import type { CellKind, Floor, FloorDraft } from "../core/schoolPlan";
import { validateFloor } from "../share/validatePlan";
import { canPersonStep } from "../sim";
import type { CellXZ } from "../sim/grid";
import { DRAFT_KIND_TO_CELL, draftFromBoxes } from "./draftFromBoxes";
import { draftRejection } from "./editorState";

/** テスト用の矩形（box は [ymin, xmin, ymax, xmax]） */
const box = (
  kind: DraftRoomKind,
  b: readonly [number, number, number, number],
  name = "",
): DraftRoomBox => ({ name, kind, box: b });

/** マスの種類を 1 文字にした行（教室は roomOf の数字．SPEC_02 の表と同じ文字） */
const CHAR: Readonly<Record<Exclude<CellKind, "classroom">, string>> = {
  void: ".",
  corridor: "h",
  wall: "#",
  door: "d",
  exit: "e",
  shutter: "s",
  outdoor: "o",
};

function rowsOf(draft: FloorDraft): string[] {
  const rows: string[] = [];
  for (let z = 0; z < draft.depth; z++) {
    let row = "";
    for (let x = 0; x < draft.width; x++) {
      const i = z * draft.width + x;
      const kind = draft.cells[i];
      row += kind === "classroom" ? String(draft.roomOf[i]) : CHAR[kind];
    }
    rows.push(row);
  }
  return rows;
}

const toFloor = (draft: FloorDraft): Floor => ({ level: 1, ...draft });

/** SPEC_02 の FloorDraft の決まりを満たす（配列の長さ・教室以外は -1・教室は rooms の添字） */
function expectValidDraft(draft: FloorDraft, width: number, depth: number): void {
  expect(draft.width).toBe(width);
  expect(draft.depth).toBe(depth);
  expect(draft.cells).toHaveLength(width * depth);
  expect(draft.roomOf).toHaveLength(width * depth);
  expect(validateFloor(toFloor(draft), 0, draft.rooms.length)).toEqual([]);
  expect(draftRejection(draft)).toBeNull();
}

/** 教室 room のマスから，人が歩いて廊下に出られるか（壁の規則は sim/ の canPersonStep） */
function reachesCorridor(draft: FloorDraft, room: number): boolean {
  const floor = toFloor(draft);
  const start = draft.roomOf.indexOf(room);
  if (start < 0) return false;
  const seen = new Set<number>([start]);
  const queue: CellXZ[] = [{ x: start % draft.width, z: Math.floor(start / draft.width) }];
  while (queue.length > 0) {
    const cur = queue.shift() as CellXZ;
    if (draft.cells[cur.z * draft.width + cur.x] === "corridor") return true;
    for (const [dx, dz] of [
      [1, 0],
      [-1, 0],
      [0, 1],
      [0, -1],
    ]) {
      const next = { x: cur.x + dx, z: cur.z + dz };
      if (next.x < 0 || next.z < 0 || next.x >= draft.width || next.z >= draft.depth) continue;
      const i = next.z * draft.width + next.x;
      if (seen.has(i) || !canPersonStep(floor, cur, next)) continue;
      seen.add(i);
      queue.push(next);
    }
  }
  return false;
}

/** ドアのマスの (x, z) の一覧 */
const doorsOf = (draft: FloorDraft): CellXZ[] =>
  draft.cells.flatMap((k, i) =>
    k === "door" ? [{ x: i % draft.width, z: Math.floor(i / draft.width) }] : [],
  );

describe("draftFromBoxes", () => {
  describe("座標の換算と丸め", () => {
    it("画像全体の矩形はマス目全体になる", () => {
      const draft = draftFromBoxes([box("corridor", [0, 0, 1000, 1000])], 4, 3);
      expect(rowsOf(draft)).toEqual(["hhhh", "hhhh", "hhhh"]);
      expectValidDraft(draft, 4, 3);
    });

    it("box は [ymin, xmin, ymax, xmax] の順（y が z，x が x）", () => {
      // 上半分・左 1/4
      const draft = draftFromBoxes([box("corridor", [0, 0, 500, 250])], 4, 4);
      expect(rowsOf(draft)).toEqual(["h...", "h...", "....", "...."]);
    });

    it.each<[number, string]>([
      [140, ".hhhhhhhhh"], // 1.4 マス → 1
      [160, "..hhhhhhhh"], // 1.6 マス → 2
      [0, "hhhhhhhhhh"],
      [940, ".........h"], // 9.4 → 9
    ])("左端 %d は近いマスの境界に丸める", (xmin, row) => {
      const draft = draftFromBoxes([box("corridor", [0, xmin, 1000, 1000])], 10, 1);
      expect(rowsOf(draft)).toEqual([row]);
    });

    it.each<[number, string]>([
      [860, "hhhhhhhhh."], // 8.6 → 9
      [840, "hhhhhhhh.."], // 8.4 → 8
    ])("右端 %d も近いマスの境界に丸める", (xmax, row) => {
      const draft = draftFromBoxes([box("corridor", [0, 0, 1000, xmax])], 10, 1);
      expect(rowsOf(draft)).toEqual([row]);
    });

    it("マスより細い矩形も最低 1 マスにする（中心を含むマス）", () => {
      // x: 4.2〜4.4 マス．どちらの端も 4 に丸まるが，中心 4.3 のマス x = 4 を塗る
      const draft = draftFromBoxes([box("corridor", [0, 420, 1000, 440])], 10, 2);
      expect(rowsOf(draft)).toEqual(["....h.....", "....h....."]);
    });

    it("幅 0 の矩形が端にあってもマス目の外にはみ出さない", () => {
      const draft = draftFromBoxes([box("corridor", [1000, 1000, 1000, 1000])], 3, 3);
      expect(rowsOf(draft)).toEqual(["...", "...", "..h"]);
      expectValidDraft(draft, 3, 3);
    });

    it("1 × 1 のマス目でも作れる", () => {
      const draft = draftFromBoxes([box("outdoor", [0, 0, 1000, 1000])], 1, 1);
      expect(rowsOf(draft)).toEqual(["o"]);
      expectValidDraft(draft, 1, 1);
    });

    it("80 × 80 のマス目でも作れる", () => {
      const draft = draftFromBoxes(
        [box("room", [0, 0, 500, 1000], "体育館"), box("corridor", [500, 0, 1000, 1000])],
        80,
        80,
      );
      expectValidDraft(draft, 80, 80);
    });
  });

  describe("塗り分け", () => {
    it("どの矩形にも入らないマスは void（roomOf は -1）", () => {
      const draft = draftFromBoxes([box("corridor", [0, 0, 500, 500])], 4, 4);
      draft.cells.forEach((k, i) => {
        const x = i % 4;
        const z = Math.floor(i / 4);
        if (x >= 2 || z >= 2) {
          expect(k).toBe("void");
          expect(draft.roomOf[i]).toBe(-1);
        }
      });
    });

    it("矩形が無ければすべて void で教室も無い", () => {
      const draft = draftFromBoxes([], 3, 2);
      expect(rowsOf(draft)).toEqual(["...", "..."]);
      expect(draft.rooms).toEqual([]);
      expectValidDraft(draft, 3, 2);
    });

    it.each<[DraftRoomKind, CellKind]>([
      ["room", "classroom"],
      ["corridor", "corridor"],
      ["outdoor", "outdoor"],
      ["stairs", "exit"],
      ["elevator", "wall"],
    ])("種類 %s はマスの %s になる", (kind, cell) => {
      expect(DRAFT_KIND_TO_CELL[kind]).toBe(cell);
      const draft = draftFromBoxes([box(kind, [0, 0, 1000, 1000], "名前")], 2, 2);
      expect(draft.cells).toEqual(new Array(4).fill(cell));
      expectValidDraft(draft, 2, 2);
    });

    it.each<[string, boolean]>([
      ["大きい矩形が先", false],
      ["小さい矩形が先", true],
    ])("重なったマスは面積の小さい矩形を優先する（%s）", (_, reversed) => {
      const boxes = [box("corridor", [0, 0, 1000, 1000]), box("stairs", [250, 250, 750, 750])];
      const draft = draftFromBoxes(reversed ? [...boxes].reverse() : boxes, 4, 4);
      expect(rowsOf(draft)).toEqual(["hhhh", "heeh", "heeh", "hhhh"]);
    });

    it("大部屋の中の小部屋は別の教室になる", () => {
      const draft = draftFromBoxes(
        [box("room", [0, 0, 1000, 1000], "図書室"), box("room", [0, 0, 500, 500], "司書室")],
        4,
        4,
      );
      const names = draft.rooms.map((r) => r.name);
      expect(names).toEqual(expect.arrayContaining(["図書室", "司書室"]));
      const small = names.indexOf("司書室");
      const big = names.indexOf("図書室");
      expect(draft.roomOf[0]).toBe(small); // (0, 0) は小部屋
      expect(draft.roomOf[3 * 4 + 3]).toBe(big); // (3, 3) は大部屋
      expectValidDraft(draft, 4, 4);
    });

    it("ほかの矩形にすべて覆われた教室は一覧に残らず，添字は rooms の範囲に収まる", () => {
      // 教室（2 × 4 マス）を，それより小さい 2 つの廊下（2 × 2 マス）がすべて覆う
      const draft = draftFromBoxes(
        [
          box("room", [0, 0, 500, 1000], "消える教室"),
          box("corridor", [0, 0, 500, 500]),
          box("corridor", [0, 500, 500, 1000]),
          box("room", [500, 0, 1000, 1000], "残る教室"),
        ],
        4,
        4,
      );
      expect(draft.rooms.map((r) => r.name)).toEqual(["残る教室"]);
      expectValidDraft(draft, 4, 4);
    });
  });

  describe("教室の名前", () => {
    it("読めた名前はそのまま使う", () => {
      const draft = draftFromBoxes([box("room", [0, 0, 1000, 1000], "3年1組")], 2, 2);
      expect(draft.rooms).toEqual([{ name: "3年1組" }]);
    });

    it("名前が空の教室は「教室1」等の仮の名前にし，同じ名前にしない", () => {
      const draft = draftFromBoxes(
        [
          box("room", [0, 0, 1000, 300]),
          box("room", [0, 300, 1000, 600], "教室1"),
          box("room", [0, 600, 1000, 1000], "  "),
        ],
        10,
        2,
      );
      const names = draft.rooms.map((r) => r.name);
      expect(names).toHaveLength(3);
      expect(new Set(names).size).toBe(3);
      for (const n of names) expect(n).toMatch(/^教室\d+$/);
      expectValidDraft(draft, 10, 2);
    });

    it("教室は矩形ごとに別の教室になる（同じ名前の矩形も分ける）", () => {
      const draft = draftFromBoxes(
        [box("room", [0, 0, 1000, 500], "理科室"), box("room", [0, 500, 1000, 1000], "理科室")],
        4,
        2,
      );
      expect(draft.rooms).toHaveLength(2);
      // 左端の列と右端の列は別の教室（ドアの置き方はここでは見ない）
      expect(draft.roomOf[0]).toBe(0);
      expect(draft.roomOf[3]).toBe(1);
      expect(draft.roomOf[4]).toBe(0);
      expect(draft.roomOf[7]).toBe(1);
    });

    it("教室以外の矩形は教室の一覧に入れない", () => {
      const draft = draftFromBoxes(
        [box("corridor", [0, 0, 500, 1000], "廊下"), box("outdoor", [500, 0, 1000, 1000], "校庭")],
        2,
        2,
      );
      expect(draft.rooms).toEqual([]);
    });
  });

  describe("ドア", () => {
    // 10 × 10 マス: 上 5 行が教室，下 5 行が廊下
    const roomOverCorridor = (): FloorDraft =>
      draftFromBoxes(
        [box("room", [0, 0, 500, 1000], "1年1組"), box("corridor", [500, 0, 1000, 1000])],
        10,
        10,
      );

    it("教室と廊下が接する辺に 1 か所だけドアを置く", () => {
      const draft = roomOverCorridor();
      const doors = doorsOf(draft);
      expect(doors).toHaveLength(1);
      // 教室側の最後の行（z = 4）で，下が廊下
      expect(doors[0].z).toBe(4);
      expect(draft.cells[5 * 10 + doors[0].x]).toBe("corridor");
      expectValidDraft(draft, 10, 10);
    });

    it("ドアは辺の中央付近に置く", () => {
      const [door] = doorsOf(roomOverCorridor());
      expect(Math.abs(door.x + 0.5 - 5)).toBeLessThanOrEqual(1);
    });

    it("ドアのマスは教室に属さない（roomOf は -1）", () => {
      const draft = roomOverCorridor();
      const [door] = doorsOf(draft);
      expect(draft.roomOf[door.z * 10 + door.x]).toBe(-1);
    });

    it("教室から歩いて廊下に出られる", () => {
      expect(reachesCorridor(roomOverCorridor(), 0)).toBe(true);
    });

    it("縦の辺で接する時も辺の中央付近に置く", () => {
      // 左 3 列が教室，右が廊下（10 行）
      const draft = draftFromBoxes(
        [box("room", [0, 0, 1000, 300], "音楽室"), box("corridor", [0, 300, 1000, 1000])],
        10,
        10,
      );
      const doors = doorsOf(draft);
      expect(doors).toHaveLength(1);
      expect(doors[0].x).toBe(2);
      expect(Math.abs(doors[0].z + 0.5 - 5)).toBeLessThanOrEqual(1);
      expect(reachesCorridor(draft, 0)).toBe(true);
    });

    it("廊下に囲まれた教室にもドアは 1 か所", () => {
      const draft = draftFromBoxes(
        [box("corridor", [0, 0, 1000, 1000]), box("room", [200, 200, 800, 800], "職員室")],
        10,
        10,
      );
      expect(doorsOf(draft)).toHaveLength(1);
      expect(reachesCorridor(draft, 0)).toBe(true);
      expectValidDraft(draft, 10, 10);
    });

    it("並んだ教室はそれぞれ 1 か所ずつドアを持ち，隣の教室とはドアでつながらない", () => {
      // 上半分に教室 2 つ（左右），下半分が廊下
      const draft = draftFromBoxes(
        [
          box("room", [0, 0, 500, 500], "1年1組"),
          box("room", [0, 500, 500, 1000], "1年2組"),
          box("corridor", [500, 0, 1000, 1000]),
        ],
        10,
        10,
      );
      const doors = doorsOf(draft);
      expect(doors).toHaveLength(2);
      for (const door of doors) {
        expect(draft.cells[(door.z + 1) * 10 + door.x]).toBe("corridor");
        const neighborRooms = new Set(
          [
            [door.x - 1, door.z],
            [door.x + 1, door.z],
            [door.x, door.z - 1],
          ]
            .filter(([x, z]) => x >= 0 && x < 10 && z >= 0)
            .map(([x, z]) => z * 10 + x)
            .filter((i) => draft.cells[i] === "classroom")
            .map((i) => draft.roomOf[i]),
        );
        // ドアの隣の教室は 1 つだけ（2 つの教室をドアでつながない）
        expect(neighborRooms.size).toBe(1);
      }
      expect(reachesCorridor(draft, 0)).toBe(true);
      expect(reachesCorridor(draft, 1)).toBe(true);
      expectValidDraft(draft, 10, 10);
    });

    it("どこにも接しない教室にはドアを置かない（教室のマスのまま）", () => {
      const draft = draftFromBoxes([box("room", [0, 0, 500, 500], "倉庫")], 4, 4);
      expect(doorsOf(draft)).toEqual([]);
      expect(draft.cells.filter((k) => k === "classroom")).toHaveLength(4);
    });

    it("廊下以外（屋外）に接するだけの教室にも廊下へのドアは作らない", () => {
      const draft = draftFromBoxes(
        [box("room", [0, 0, 500, 1000], "1年1組"), box("outdoor", [500, 0, 1000, 1000])],
        4,
        4,
      );
      // 屋外との辺は「教室と廊下が接する辺」ではない
      expect(doorsOf(draft)).toEqual([]);
    });
  });

  it("入力の矩形を書き換えない", () => {
    const boxes = Object.freeze([
      Object.freeze(box("room", [0, 0, 500, 1000], "1年1組")),
      Object.freeze(box("corridor", [500, 0, 1000, 1000])),
    ]);
    expect(() => draftFromBoxes(boxes, 6, 6)).not.toThrow();
  });
});
