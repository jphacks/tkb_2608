// 教室の中身の並び（classroomLayout.ts）のテスト．基準は Issue #73 の引継ぎメモ:
// - 教室は「中身あり（furnished）／外側だけ（shell）」を切り替える．shell は机・椅子・黒板・教卓を作らない
// - 机の並びは幅（黒板の壁に沿うローカル X）から列数，奥行き（黒板から後ろへのローカル Z）から行数を自動で決める
// - 中身を置ける下限は幅 2.52 m・奥行き 3.42 m
// - 原点は床の面の中心，黒板は -Z 側．生徒は黒板（-Z）を向いて座る

import { describe, expect, it } from "vitest";
import {
  BLACKBOARD,
  CHAIR,
  chairZ,
  classroomLayout,
  classroomObstacles,
  countAlong,
  DESK,
  DESK_GRID,
  deskSetBoxes,
  MIN_CLASSROOM_DEPTH,
  MIN_CLASSROOM_WIDTH,
  TEACHER_DESK,
  teacherDeskBoxes,
} from "./classroomLayout";
import { WALL_THICKNESS } from "./schoolLayout";

const EPS = 1e-9;

describe("下限", () => {
  it("中身を置ける下限は幅 2.52 m・奥行き 3.42 m", () => {
    expect(MIN_CLASSROOM_WIDTH).toBeCloseTo(2.52, 9);
    expect(MIN_CLASSROOM_DEPTH).toBeCloseTo(3.42, 9);
  });
});

describe("countAlong", () => {
  it.each([
    [0.5, 0.65, 1.1, 0],
    [0.65, 0.65, 1.1, 1],
    [1.75, 0.65, 1.1, 2],
    [1.7499, 0.65, 1.1, 1],
    [Number.NaN, 0.65, 1.1, 0],
    [-1, 0.65, 1.1, 0],
  ])("長さ %d に大きさ %d・間隔 %d は %d 個", (available, size, pitch, expected) => {
    expect(countAlong(available, size, pitch)).toBe(expected);
  });
});

describe("classroomLayout の異常値", () => {
  it.each([
    ["幅が壁の厚みちょうど", WALL_THICKNESS, 8],
    ["幅が 0", 0, 8],
    ["幅が負", -8, 8],
    ["幅が NaN", Number.NaN, 8],
    ["奥行きが Infinity", 8, Number.POSITIVE_INFINITY],
    ["奥行きが NaN", 8, Number.NaN],
  ])("%s なら RangeError", (_, w, d) => {
    expect(() => classroomLayout(w, d)).toThrow(RangeError);
  });

  it("壁の厚みをわずかに超えれば作れる（中身は置かない）", () => {
    const layout = classroomLayout(WALL_THICKNESS + 0.01, WALL_THICKNESS + 0.01);
    expect(layout.furnished).toBe(false);
    expect(layout.desks).toEqual([]);
  });
});

describe("classroomLayout の下限（境界値）", () => {
  it("幅・奥行きが下限ちょうどなら中身を置き，机が 1 組以上ある", () => {
    const layout = classroomLayout(2.52, 3.42);
    expect(layout.furnished).toBe(true);
    expect(layout.columns).toBeGreaterThanOrEqual(1);
    expect(layout.rows).toBeGreaterThanOrEqual(1);
    expect(layout.desks.length).toBeGreaterThanOrEqual(1);
    expect(layout.blackboard).not.toBeNull();
    expect(layout.teacherDesk).not.toBeNull();
  });

  it("定数の下限ちょうど（MIN_CLASSROOM_WIDTH・MIN_CLASSROOM_DEPTH）でも机が 1 組以上ある", () => {
    const layout = classroomLayout(MIN_CLASSROOM_WIDTH, MIN_CLASSROOM_DEPTH);
    expect(layout.furnished).toBe(true);
    expect(layout.desks.length).toBeGreaterThanOrEqual(1);
  });

  it.each([
    ["幅", MIN_CLASSROOM_WIDTH - 0.001, 8],
    ["奥行き", 8, MIN_CLASSROOM_DEPTH - 0.001],
  ])("%s が下限をわずかに下回ると中身を置かない", (_, w, d) => {
    const layout = classroomLayout(w, d);
    expect(layout).toMatchObject({
      furnished: false,
      columns: 0,
      rows: 0,
      desks: [],
      blackboard: null,
      teacherDesk: null,
    });
  });

  it("中身を置いた時は必ず机が 1 組以上ある（furnished なのに机が無い状態にならない）", () => {
    for (let w = 2.5; w <= 9; w += 0.01) {
      for (const d of [3.4, 3.42, 3.43, 4.5, 8]) {
        const layout = classroomLayout(w, d);
        if (layout.furnished) expect(layout.desks.length).toBeGreaterThan(0);
      }
    }
  });
});

describe("classroomLayout の中身の有無", () => {
  it("shell は大きな教室でも何も置かない（壁の内側の範囲は同じ）", () => {
    const shell = classroomLayout(8, 8, "shell");
    const furnished = classroomLayout(8, 8, "furnished");
    expect(shell).toMatchObject({
      interior: "shell",
      furnished: false,
      desks: [],
      blackboard: null,
      teacherDesk: null,
    });
    expect(shell.inner).toEqual(furnished.inner);
  });

  it("既定は中身あり", () => {
    expect(classroomLayout(8, 8).interior).toBe("furnished");
    expect(classroomLayout(8, 8).furnished).toBe(true);
  });

  it("壁の内側の範囲は壁の厚みの半分だけ内側", () => {
    expect(classroomLayout(8, 6).inner).toEqual({
      minX: -4 + WALL_THICKNESS / 2,
      maxX: 4 - WALL_THICKNESS / 2,
      minZ: -3 + WALL_THICKNESS / 2,
      maxZ: 3 - WALL_THICKNESS / 2,
    });
  });
});

describe("classroomLayout の机の並び", () => {
  it("列数は幅だけで，行数は奥行きだけで決まり，広いほど増える（減らない）", () => {
    let prevColumns = 0;
    for (const w of [3, 4, 5, 6, 7, 8, 10]) {
      const a = classroomLayout(w, 8);
      const b = classroomLayout(w, 5);
      expect(a.columns).toBe(b.columns);
      expect(a.columns).toBeGreaterThanOrEqual(prevColumns);
      prevColumns = a.columns;
    }
    expect(prevColumns).toBeGreaterThan(classroomLayout(3, 8).columns);
    let prevRows = 0;
    for (const d of [4, 5, 6, 7, 8, 10]) {
      const a = classroomLayout(8, d);
      const b = classroomLayout(5, d);
      expect(a.rows).toBe(b.rows);
      expect(a.rows).toBeGreaterThanOrEqual(prevRows);
      prevRows = a.rows;
    }
    expect(prevRows).toBeGreaterThan(classroomLayout(8, 4).rows);
  });

  it("机の数は列数 × 行数で，id は重ならない", () => {
    const layout = classroomLayout(8, 8);
    expect(layout.desks).toHaveLength(layout.columns * layout.rows);
    expect(new Set(layout.desks.map((d) => d.id)).size).toBe(layout.desks.length);
  });

  it.each([
    [8, 8],
    [7, 9],
    [9, 7],
    [2.52, 3.42],
    [5, 6],
  ])("%d × %d m: 机と椅子は壁の内側で，左右・前・後ろの通路を残す", (w, d) => {
    const layout = classroomLayout(w, d);
    const { inner } = layout;
    for (const desk of layout.desks) {
      expect(desk.x - DESK.width / 2).toBeGreaterThanOrEqual(
        inner.minX + DESK_GRID.sideAisle - EPS,
      );
      expect(desk.x + DESK.width / 2).toBeLessThanOrEqual(inner.maxX - DESK_GRID.sideAisle + EPS);
      expect(desk.z - DESK.depth / 2).toBeGreaterThanOrEqual(
        inner.minZ + DESK_GRID.frontZone - EPS,
      );
      expect(chairZ(desk) + CHAIR.depth / 2).toBeLessThanOrEqual(
        inner.maxZ - DESK_GRID.backZone + EPS,
      );
    }
  });

  it("列は左右の中央にそろう", () => {
    const layout = classroomLayout(8, 8);
    const xs = layout.desks.map((d) => d.x);
    expect(Math.min(...xs) + Math.max(...xs)).toBeCloseTo(0);
  });

  it("1 行目は黒板（-Z）に最も近く，行・列の番号は前・-X から 0 で始まる", () => {
    const layout = classroomLayout(8, 8);
    const first = layout.desks.find((d) => d.row === 0 && d.column === 0);
    const last = layout.desks.find(
      (d) => d.row === layout.rows - 1 && d.column === layout.columns - 1,
    );
    if (!first || !last) throw new Error("机がない");
    expect(first.z).toBeLessThan(last.z);
    expect(first.x).toBeLessThan(last.x);
  });

  it("椅子は机の後ろ（+Z）にあり，座面の前を机の下へ少し入れる（生徒は黒板の側を向く）", () => {
    const [desk] = classroomLayout(8, 8).desks;
    if (!desk) throw new Error("机がない");
    expect(chairZ(desk)).toBeGreaterThan(desk.z);
    const tuck = desk.z + DESK.depth / 2 - (chairZ(desk) - CHAIR.depth / 2);
    expect(tuck).toBeCloseTo(CHAIR.tuck);
  });

  it("机・椅子どうしは重ならない（同じ組の椅子は机の下へ入れるため除く）", () => {
    const obstacles = classroomObstacles(classroomLayout(8, 8), "c");
    for (const [i, a] of obstacles.entries()) {
      for (const b of obstacles.slice(i + 1)) {
        if (b.id === `${a.id}-chair`) continue;
        const overlap =
          a.minX < b.maxX - EPS &&
          b.minX < a.maxX - EPS &&
          a.minZ < b.maxZ - EPS &&
          b.minZ < a.maxZ - EPS &&
          a.minY < b.maxY - EPS &&
          b.minY < a.maxY - EPS;
        expect(overlap, `${a.id} と ${b.id}`).toBe(false);
      }
    }
  });

  it("隣の机との間に体（直径 0.36 m）が通れる通路がある", () => {
    const layout = classroomLayout(8, 8);
    expect(DESK_GRID.pitchX - DESK.width).toBeGreaterThanOrEqual(0.36);
    expect(layout.columns).toBeGreaterThan(1);
  });
});

describe("classroomLayout の黒板・教卓", () => {
  it("黒板は -Z の壁の面に付き，幅は上限 3.6 m・左右の余白を残す", () => {
    for (const [w, d] of [
      [8, 8],
      [3, 8],
      [2.52, 3.42],
    ] as const) {
      const layout = classroomLayout(w, d);
      const board = layout.blackboard;
      if (!board) throw new Error("黒板がない");
      expect(board.face).toBeCloseTo(layout.inner.minZ);
      expect(board.width).toBeLessThanOrEqual(BLACKBOARD.maxWidth);
      expect(board.width).toBeGreaterThanOrEqual(BLACKBOARD.minWidth - EPS);
      expect(board.width / 2).toBeLessThanOrEqual(layout.inner.maxX - BLACKBOARD.sideMargin + EPS);
    }
    expect(classroomLayout(10, 8).blackboard?.width).toBe(BLACKBOARD.maxWidth);
  });

  it("教卓は中央で，黒板と 1 行目の机の間にある", () => {
    const layout = classroomLayout(8, 8);
    const teacher = layout.teacherDesk;
    if (!teacher) throw new Error("教卓がない");
    expect(teacher.x).toBe(0);
    expect(teacher.z - TEACHER_DESK.depth / 2).toBeCloseTo(
      layout.inner.minZ + TEACHER_DESK.distanceFromBoard,
    );
    const frontRow = Math.min(...layout.desks.map((d) => d.z - DESK.depth / 2));
    expect(teacher.z + TEACHER_DESK.depth / 2).toBeLessThan(frontRow);
  });

  it("教卓の前板は生徒の側（+Z）にある", () => {
    const boxes = teacherDeskBoxes({ x: 0, z: 0 });
    const [front] = boxes.panels;
    expect(front?.position[2]).toBeGreaterThan(0);
    expect(boxes.top.position[1] + boxes.top.size[1] / 2).toBeCloseTo(TEACHER_DESK.height);
  });
});

describe("deskSetBoxes", () => {
  it("どの箱も床より上にあり，天板の上面は机の高さ", () => {
    const boxes = deskSetBoxes({ x: 1, z: 2 });
    for (const b of [...boxes.wood, ...boxes.metal, ...boxes.storage]) {
      expect(b.position[1] - b.size[1] / 2).toBeGreaterThanOrEqual(-EPS);
    }
    const [top] = boxes.wood;
    expect((top?.position[1] ?? 0) + (top?.size[1] ?? 0) / 2).toBeCloseTo(DESK.height);
    expect(boxes.metal).toHaveLength(6);
  });
});

describe("classroomObstacles", () => {
  it("机と椅子が 1 組 2 つ，教卓・黒板が 1 つずつ．id は教室の id で始まり重ならない", () => {
    const layout = classroomLayout(8, 8);
    const obstacles = classroomObstacles(layout, "room-1");
    expect(obstacles).toHaveLength(layout.desks.length * 2 + 2);
    expect(obstacles.every((o) => o.id.startsWith("room-1-"))).toBe(true);
    expect(new Set(obstacles.map((o) => o.id)).size).toBe(obstacles.length);
    expect(obstacles.map((o) => o.id)).toEqual(
      expect.arrayContaining(["room-1-teacher-desk", "room-1-blackboard", "room-1-desk-1-1"]),
    );
  });

  it("外側だけの教室・下限より小さい教室は当たり判定を持たない", () => {
    expect(classroomObstacles(classroomLayout(8, 8, "shell"), "c")).toEqual([]);
    expect(classroomObstacles(classroomLayout(2, 2), "c")).toEqual([]);
  });

  it("机の高さは 0〜机の高さ，椅子は背もたれの高さまで", () => {
    const obstacles = classroomObstacles(classroomLayout(8, 8), "c");
    const desk = obstacles.find((o) => o.id === "c-desk-1-1");
    const chair = obstacles.find((o) => o.id === "c-desk-1-1-chair");
    expect(desk).toMatchObject({ minY: 0, maxY: DESK.height });
    expect(chair).toMatchObject({ minY: 0, maxY: CHAIR.backHeight });
  });
});
