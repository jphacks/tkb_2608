// 校舎データの型（docs/04_SPEC/SPEC_02「型 (Types)」）のテスト．
// 型だけのファイルなので，仕様どおりの値が通り，仕様にない値が型エラーになることを確かめる
import { describe, expect, expectTypeOf, it } from "vitest";
import type {
  CellKind,
  CellRef,
  DrillMode,
  DrillSetup,
  Floor,
  PlanLoadError,
  PlanLoadFailureKind,
  SchoolPlan,
  SpreadSettings,
} from "./schoolPlan";

/** 3 x 2 の 1 階建て．上の段が教室 2 マスとドア，下の段が廊下・出口・屋外 */
const floor = (overrides: Partial<Floor> = {}): Floor => ({
  level: 1,
  width: 3,
  depth: 2,
  cells: ["classroom", "classroom", "door", "corridor", "exit", "outdoor"],
  roomOf: [0, 0, -1, -1, -1, -1],
  ...overrides,
});

const drill = (overrides: Partial<DrillSetup> = {}): DrillSetup => ({
  mode: "learn",
  fireOrigins: [{ floor: 0, x: 1, z: 0 }],
  start: { floor: 0, x: 0, z: 0 },
  startYaw: 0,
  assembly: [{ floor: 0, x: 2, z: 1 }],
  route: [
    { floor: 0, x: 0, z: 0 },
    { floor: 0, x: 0, z: 1 },
    { floor: 0, x: 1, z: 1 },
    { floor: 0, x: 2, z: 1 },
  ],
  spread: { fireSecondsPerCell: 6, smokeSecondsPerCell: 2, extraFires: [] },
  timeLimitSeconds: 150,
  ...overrides,
});

const plan = (overrides: Partial<SchoolPlan> = {}): SchoolPlan => ({
  version: 1,
  name: "テスト校舎",
  cellSize: 2,
  floors: [floor()],
  rooms: [{ name: "3年1組" }],
  drill: drill(),
  ...overrides,
});

describe("SchoolPlan", () => {
  it("仕様どおりの小さな校舎は cells・roomOf の長さが width * depth で，教室以外の roomOf が -1", () => {
    const p = plan();
    for (const f of p.floors) {
      expect(f.cells).toHaveLength(f.width * f.depth);
      expect(f.roomOf).toHaveLength(f.width * f.depth);
      f.cells.forEach((kind, i) => {
        if (kind === "classroom") {
          expect(f.roomOf[i]).toBeGreaterThanOrEqual(0);
          expect(f.roomOf[i]).toBeLessThan(p.rooms.length);
        } else {
          expect(f.roomOf[i]).toBe(-1);
        }
      });
    }
  });

  it("8 種類のマスと 2 つのモードをすべて受け付ける", () => {
    const kinds: CellKind[] = [
      "void",
      "classroom",
      "corridor",
      "wall",
      "door",
      "exit",
      "shutter",
      "outdoor",
    ];
    const p = plan({
      floors: [
        floor({
          width: 8,
          depth: 1,
          cells: kinds,
          roomOf: kinds.map((k) => (k === "classroom" ? 0 : -1)),
        }),
      ],
      drill: drill({
        mode: "test",
        spread: {
          fireSecondsPerCell: 6,
          smokeSecondsPerCell: 2,
          extraFires: [{ cell: { floor: 0, x: 3, z: 0 }, atSeconds: 30 }],
        },
      }),
    });
    expect(p.floors[0]?.cells).toEqual(kinds);
    expect(p.drill.mode).toBe("test");
  });

  it("仕様にない値は型として受け付けない", () => {
    // expectTypeOf は tsc（npm run typecheck）が検査する．受け付けてしまうと typecheck が失敗する
    expectTypeOf<2>().not.toExtend<SchoolPlan["version"]>();
    expectTypeOf<"stairs">().not.toExtend<CellKind>();
    expectTypeOf<"other">().not.toExtend<DrillMode>();
    expectTypeOf<readonly string[]>().not.toExtend<Floor["roomOf"]>();
    expectTypeOf<{ readonly cell: CellRef }>().not.toExtend<SpreadSettings["extraFires"][number]>();
    expectTypeOf<SchoolPlan>().toHaveProperty("name").toEqualTypeOf<string>();
    expectTypeOf<DrillMode>().toEqualTypeOf<"learn" | "test">();
  });
});

// 読み込みの失敗の型（SPEC_02「URL と QR への埋め込み」の kind の表・Issue #86）
describe("PlanLoadError", () => {
  it("失敗の種類は仕様の 3 種類（corrupted・unsupportedVersion・invalidPlan）と完全に一致する", () => {
    expectTypeOf<PlanLoadFailureKind>().toEqualTypeOf<
      "corrupted" | "unsupportedVersion" | "invalidPlan"
    >();
    expectTypeOf<"unknown">().not.toExtend<PlanLoadFailureKind>();
  });

  it("kind と reason（画面に出す理由の文字列）だけを持つ", () => {
    expectTypeOf<PlanLoadError>().toEqualTypeOf<{
      readonly kind: PlanLoadFailureKind;
      readonly reason: string;
    }>();
    const error: PlanLoadError = { kind: "corrupted", reason: "データが壊れています" };
    expect(error).toEqual({ kind: "corrupted", reason: "データが壊れています" });
  });
});
