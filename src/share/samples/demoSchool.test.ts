// 同梱のデモの校舎（DEMO_SCHOOL）のテスト．
// 基準は docs/04_SPEC/SPEC_02（型・既定値・座標・壁の自動配置・通れる／燃え広がる・validatePlan で確かめる項目）．
// 壁の規則と延焼の広がりは src/sim/ がまだ無いため，SPEC_02 の表をこのテストの中に小さく書き写して使う
import { describe, expect, it } from "vitest";
import type { CellKind, CellRef, Floor } from "../../core/schoolPlan";
import { DEMO_SCHOOL, DEMO_SCHOOL_ROWS } from "./demoSchool";

const plan = DEMO_SCHOOL;
const { drill } = plan;

const floorOf = (ref: CellRef): Floor => plan.floors[ref.floor];
const inside = (floor: Floor, x: number, z: number): boolean =>
  Number.isInteger(x) &&
  Number.isInteger(z) &&
  x >= 0 &&
  x < floor.width &&
  z >= 0 &&
  z < floor.depth;
const kindAt = (floor: Floor, x: number, z: number): CellKind | undefined =>
  inside(floor, x, z) ? floor.cells[z * floor.width + x] : undefined;
const roomAt = (floor: Floor, x: number, z: number): number => floor.roomOf[z * floor.width + x];
const kindOf = (ref: CellRef): CellKind | undefined => kindAt(floorOf(ref), ref.x, ref.z);
const key = (ref: CellRef): string => `${ref.floor}:${ref.x},${ref.z}`;
const isRefInPlan = (ref: CellRef): boolean =>
  Number.isInteger(ref.floor) &&
  ref.floor >= 0 &&
  ref.floor < plan.floors.length &&
  inside(floorOf(ref), ref.x, ref.z);

// ---- SPEC_02「壁の自動配置」の書き写し ----
/** マスの「空間」．"none" は void・wall・マス目の外，"open" は開口 */
type Space =
  | { readonly type: "room"; readonly room: number }
  | { readonly type: "corridor" | "outdoor" | "open" | "none" };

const spaceAt = (floor: Floor, x: number, z: number): Space => {
  const kind = kindAt(floor, x, z);
  switch (kind) {
    case "classroom":
      return { type: "room", room: roomAt(floor, x, z) };
    case "corridor":
      return { type: "corridor" };
    case "outdoor":
      return { type: "outdoor" };
    case "door":
    case "exit":
    case "shutter":
      return { type: "open" };
    default:
      return { type: "none" }; // void・wall・マス目の外（undefined）
  }
};

/** (x1, z1) と (x2, z2)（上下左右に隣り合う 2 マス）の間に薄い壁を置くか */
const hasWallBetween = (floor: Floor, x1: number, z1: number, x2: number, z2: number): boolean => {
  const a = spaceAt(floor, x1, z1);
  const b = spaceAt(floor, x2, z2);
  if (a.type === "none" && b.type === "none") return false; // 床の無いマスどうし（表の対象外．壁は要らない）
  if (a.type === "none" || b.type === "none") {
    const other = a.type === "none" ? b : a;
    return other.type !== "outdoor"; // 屋外と void・マス目の外は置かない．教室・廊下・開口は置く
  }
  if (a.type === "open" || b.type === "open") return false; // 開口と何か，開口と開口
  if (a.type === "room" && b.type === "room") return a.room !== b.room;
  return a.type !== b.type;
};

const DIRS = [
  [1, 0],
  [-1, 0],
  [0, 1],
  [0, -1],
] as const;

// ---- SPEC_02「通れる・燃え広がる」の書き写し ----
const personCanEnter = (kind: CellKind | undefined): boolean =>
  kind !== undefined && kind !== "void" && kind !== "wall";
const fireCanEnter = (kind: CellKind | undefined): boolean =>
  kind !== undefined &&
  kind !== "void" &&
  kind !== "wall" &&
  kind !== "shutter" &&
  kind !== "outdoor";

/** 火元から火（と煙）が届くマスの一覧（時間を限らず，届きうるすべて） */
const fireReachable = (): Set<string> => {
  const reached = new Set<string>();
  const queue: CellRef[] = [];
  for (const origin of [...drill.fireOrigins, ...drill.spread.extraFires.map((f) => f.cell)]) {
    if (!reached.has(key(origin))) {
      reached.add(key(origin));
      queue.push(origin);
    }
  }
  while (queue.length > 0) {
    const cur = queue.shift() as CellRef;
    const floor = floorOf(cur);
    for (const [dx, dz] of DIRS) {
      const next: CellRef = { floor: cur.floor, x: cur.x + dx, z: cur.z + dz };
      if (!fireCanEnter(kindAt(floor, next.x, next.z))) continue;
      if (hasWallBetween(floor, cur.x, cur.z, next.x, next.z)) continue;
      if (reached.has(key(next))) continue;
      reached.add(key(next));
      queue.push(next);
    }
  }
  return reached;
};

describe("hasWallBetween（テスト内の SPEC_02 の書き写し）", () => {
  // 書き写しの誤りでデモの検査が甘くならないよう，表の各行を小さなマス目で確かめておく
  const tiny = (row: string): Floor => {
    const map: Record<string, CellKind> = {
      ".": "void",
      h: "corridor",
      "#": "wall",
      d: "door",
      e: "exit",
      s: "shutter",
      o: "outdoor",
      "0": "classroom",
      "1": "classroom",
    };
    const cells = [...row].map((c) => map[c]);
    return {
      level: 1,
      width: row.length,
      depth: 1,
      cells,
      roomOf: [...row].map((c) => (c >= "0" && c <= "9" ? Number(c) : -1)),
    };
  };
  it.each([
    ["00", false],
    ["hh", false],
    ["oo", false],
    ["01", true],
    ["0h", true],
    ["ho", true],
    ["0o", true],
    ["d0", false],
    ["eh", false],
    ["so", false],
    ["ds", false],
    ["0#", true],
    ["h.", true],
    ["d#", true],
    ["o.", false],
  ])("%s の間の壁は %s", (row, expected) => {
    expect(hasWallBetween(tiny(row), 0, 0, 1, 0)).toBe(expected);
  });
  it("マス目の外との間: 教室・廊下・開口は置く，屋外は置かない", () => {
    expect(hasWallBetween(tiny("0"), 0, 0, -1, 0)).toBe(true);
    expect(hasWallBetween(tiny("h"), 0, 0, 0, 1)).toBe(true);
    expect(hasWallBetween(tiny("e"), 0, 0, 1, 0)).toBe(true);
    expect(hasWallBetween(tiny("o"), 0, 0, 0, -1)).toBe(false);
  });
});

describe("DEMO_SCHOOL_ROWS", () => {
  it("19 × 13 で，すべての行の長さがそろっている", () => {
    expect(DEMO_SCHOOL_ROWS).toHaveLength(13);
    for (const row of DEMO_SCHOOL_ROWS) expect(row).toHaveLength(19);
  });
});

describe("DEMO_SCHOOL", () => {
  describe("形と既定値", () => {
    it("version は 1，名前は空でない，cellSize は SPEC_02 の既定の 1 m", () => {
      expect(plan.version).toBe(1);
      expect(plan.name.length).toBeGreaterThan(0);
      expect(plan.cellSize).toBe(1);
    });

    it("訓練条件は SPEC_02 の既定値（learn・火 6 秒・煙 2 秒・150 秒）", () => {
      expect(drill.mode).toBe("learn");
      expect(drill.spread.fireSecondsPerCell).toBe(6);
      expect(drill.spread.smokeSecondsPerCell).toBe(2);
      expect(drill.timeLimitSeconds).toBe(150);
      expect(drill.spread.extraFires).toEqual([]);
    });

    it("煙は火より速い（秒数が小さい）", () => {
      expect(drill.spread.smokeSecondsPerCell).toBeLessThan(drill.spread.fireSecondsPerCell);
    });

    it("startYaw は有限の数", () => {
      expect(Number.isFinite(drill.startYaw)).toBe(true);
    });

    it("1 フロアで，level は 1", () => {
      expect(plan.floors).toHaveLength(1);
      expect(plan.floors[0].level).toBe(1);
    });

    it("cells と roomOf の長さは width * depth", () => {
      for (const floor of plan.floors) {
        expect(floor.cells).toHaveLength(floor.width * floor.depth);
        expect(floor.roomOf).toHaveLength(floor.width * floor.depth);
      }
    });

    it("教室は 3 つで，名前は空でない", () => {
      expect(plan.rooms).toHaveLength(3);
      for (const room of plan.rooms) expect(room.name.length).toBeGreaterThan(0);
    });
  });

  describe("roomOf", () => {
    it("教室のマスは rooms の範囲内の添字，教室以外は -1", () => {
      for (const floor of plan.floors) {
        floor.cells.forEach((kind, i) => {
          const room = floor.roomOf[i];
          if (kind === "classroom") {
            expect(Number.isInteger(room)).toBe(true);
            expect(room).toBeGreaterThanOrEqual(0);
            expect(room).toBeLessThan(plan.rooms.length);
          } else {
            expect(room).toBe(-1);
          }
        });
      }
    });

    it("rooms のどの教室にも 1 マス以上ある", () => {
      const used = new Set(plan.floors.flatMap((f) => f.roomOf.filter((r) => r >= 0)));
      plan.rooms.forEach((_room, i) => {
        expect(used.has(i)).toBe(true);
      });
    });
  });

  describe("開始地点・火元・集合場所", () => {
    it("開始地点はマス目の中の教室のマス", () => {
      expect(isRefInPlan(drill.start)).toBe(true);
      expect(kindOf(drill.start)).toBe("classroom");
    });

    it("火元は 1 つ以上で，どれもマス目の中の教室のマス", () => {
      expect(drill.fireOrigins.length).toBeGreaterThanOrEqual(1);
      for (const origin of drill.fireOrigins) {
        expect(isRefInPlan(origin)).toBe(true);
        expect(kindOf(origin)).toBe("classroom");
      }
    });

    it("火元は開始地点と別の教室にある", () => {
      const startRoom = roomAt(floorOf(drill.start), drill.start.x, drill.start.z);
      for (const origin of drill.fireOrigins) {
        expect(roomAt(floorOf(origin), origin.x, origin.z)).not.toBe(startRoom);
      }
    });

    it("集合場所は 1 つ以上で，どれもマス目の中の屋外のマス", () => {
      expect(drill.assembly.length).toBeGreaterThanOrEqual(1);
      for (const cell of drill.assembly) {
        expect(isRefInPlan(cell)).toBe(true);
        expect(kindOf(cell)).toBe("outdoor");
      }
    });
  });

  describe("正解経路 route", () => {
    it("先頭は開始地点", () => {
      expect(drill.route[0]).toEqual(drill.start);
    });

    it("末尾は集合場所のどれか", () => {
      const last = drill.route[drill.route.length - 1];
      expect(drill.assembly.map(key)).toContain(key(last));
    });

    it("すべてマス目の中で，void・wall を通らない", () => {
      for (const cell of drill.route) {
        expect(isRefInPlan(cell)).toBe(true);
        expect(personCanEnter(kindOf(cell))).toBe(true);
      }
    });

    it("続くマスは同じ階で上下左右に隣り合う", () => {
      for (let i = 1; i < drill.route.length; i++) {
        const a = drill.route[i - 1];
        const b = drill.route[i];
        expect(b.floor).toBe(a.floor);
        expect(Math.abs(a.x - b.x) + Math.abs(a.z - b.z)).toBe(1);
      }
    });

    it("続くマスの間に SPEC_02「壁の自動配置」の壁が無い", () => {
      for (let i = 1; i < drill.route.length; i++) {
        const a = drill.route[i - 1];
        const b = drill.route[i];
        expect(hasWallBetween(floorOf(a), a.x, a.z, b.x, b.z), `${key(a)} → ${key(b)}`).toBe(false);
      }
    });

    it("同じマスを 2 度通らない", () => {
      expect(new Set(drill.route.map(key)).size).toBe(drill.route.length);
    });

    it("途中で集合場所に入らない（入った時点で避難完了のため，末尾だけが集合場所）", () => {
      const assembly = new Set(drill.assembly.map(key));
      for (const cell of drill.route.slice(0, -1)) expect(assembly.has(key(cell))).toBe(false);
    });

    it("出口（exit）を通って屋外へ出る", () => {
      expect(drill.route.some((c) => kindOf(c) === "exit")).toBe(true);
    });
  });

  describe("防火シャッターと延焼", () => {
    it("防火シャッターのマスがある", () => {
      expect(plan.floors.some((f) => f.cells.includes("shutter"))).toBe(true);
    });

    it("火は屋外・void・wall・シャッターには届かない", () => {
      const reached = fireReachable();
      for (const k of reached) {
        const [floorIdx, xz] = k.split(":");
        const [x, z] = xz.split(",").map(Number);
        const kind = kindAt(plan.floors[Number(floorIdx)], x, z);
        expect(["outdoor", "void", "wall", "shutter"]).not.toContain(kind);
      }
    });

    it("火元から開始地点の教室のどのマスにも火が届かない", () => {
      const reached = fireReachable();
      const floor = floorOf(drill.start);
      const startRoom = roomAt(floor, drill.start.x, drill.start.z);
      for (let z = 0; z < floor.depth; z++) {
        for (let x = 0; x < floor.width; x++) {
          if (kindAt(floor, x, z) === "classroom" && roomAt(floor, x, z) === startRoom) {
            expect(reached.has(key({ floor: drill.start.floor, x, z })), `(${x}, ${z})`).toBe(
              false,
            );
          }
        }
      }
    });

    it("火元から正解経路のどのマスにも火が届かない", () => {
      const reached = fireReachable();
      for (const cell of drill.route) expect(reached.has(key(cell)), key(cell)).toBe(false);
    });

    it("シャッターが無ければ火が正解経路に届く（シャッターが火を止めている）", () => {
      // シャッターを廊下に置き換えた校舎で同じ広がりを計算する
      const floor = plan.floors[0];
      const opened: Floor = {
        ...floor,
        cells: floor.cells.map((k) => (k === "shutter" ? "corridor" : k)),
      };
      const reached = new Set<string>();
      const queue = drill.fireOrigins.map((o) => ({ x: o.x, z: o.z }));
      for (const o of queue) reached.add(`${o.x},${o.z}`);
      while (queue.length > 0) {
        const cur = queue.shift() as { x: number; z: number };
        for (const [dx, dz] of DIRS) {
          const nx = cur.x + dx;
          const nz = cur.z + dz;
          if (!fireCanEnter(kindAt(opened, nx, nz)) || hasWallBetween(opened, cur.x, cur.z, nx, nz))
            continue;
          if (reached.has(`${nx},${nz}`)) continue;
          reached.add(`${nx},${nz}`);
          queue.push({ x: nx, z: nz });
        }
      }
      expect(drill.route.some((c) => reached.has(`${c.x},${c.z}`))).toBe(true);
    });
  });
});
