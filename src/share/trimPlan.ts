// URL に載せる前に，マス目の外側の何もない（void）行・列を切り詰める（SPEC_02「長さの上限」）．
// 切り詰めでずれる位置（火元・開始地点・集合場所・経路・追加の延焼箇所）も同じだけ動かす．エディタで編集中の校舎は変えない
import type { CellKind, CellRef, DrillSetup, Floor, SchoolPlan } from "../core/schoolPlan";

/** 1 つの階で残す範囲（マス．両端を含む） */
interface Bounds {
  readonly minX: number;
  readonly maxX: number;
  readonly minZ: number;
  readonly maxZ: number;
}

/**
 * 各階の外側の void の行・列を切り詰めた校舎を返す．何も切り詰めない時は同じ plan を返す．
 * - 訓練条件の位置が載っているマスは void でも残す（火元はマスの種類を問わず置けるため．位置を落とさない）
 * - すべて void で位置も無い階は切り詰めない（幅・奥行きが 0 になると validatePlan の誤りになるため）
 * - マス目の外を指す位置は範囲に含めず，ずらすだけにする（誤りのまま残し，validatePlan で見えるようにする）
 *
 * 教室の範囲は Floor.roomOf でマスごとに持つため，cells と一緒に切り出せば合う
 */
export function trimVoidMargins(plan: SchoolPlan): SchoolPlan {
  const refsByFloor = plan.floors.map((_, index) => drillRefs(plan.drill, index));
  const bounds = plan.floors.map((floor, index) => keptBounds(floor, refsByFloor[index]));
  const changed = plan.floors.some((floor, index) => {
    const b = bounds[index];
    return (
      b !== null &&
      (b.minX > 0 || b.minZ > 0 || b.maxX < floor.width - 1 || b.maxZ < floor.depth - 1)
    );
  });
  if (!changed) return plan;

  const shift = (ref: CellRef): CellRef => {
    const b = bounds[ref.floor];
    if (b === undefined || b === null) return ref;
    return { floor: ref.floor, x: ref.x - b.minX, z: ref.z - b.minZ };
  };
  const drill = plan.drill;
  return {
    ...plan,
    floors: plan.floors.map((floor, index) => {
      const b = bounds[index];
      return b === null ? floor : cropFloor(floor, b);
    }),
    drill: {
      ...drill,
      fireOrigins: drill.fireOrigins.map(shift),
      start: shift(drill.start),
      assembly: drill.assembly.map(shift),
      route: drill.route.map(shift),
      spread: {
        ...drill.spread,
        extraFires: drill.spread.extraFires.map((fire) => ({ ...fire, cell: shift(fire.cell) })),
        ...(drill.spread.extraSmokes === undefined
          ? {}
          : {
              extraSmokes: drill.spread.extraSmokes.map((smoke) => ({
                ...smoke,
                cell: shift(smoke.cell),
              })),
            }),
      },
    },
  };
}

/** 訓練条件のうち，その階を指す位置のすべて */
function drillRefs(drill: DrillSetup, floor: number): CellRef[] {
  return [
    ...drill.fireOrigins,
    drill.start,
    ...drill.assembly,
    ...drill.route,
    ...drill.spread.extraFires.map((fire) => fire.cell),
    ...(drill.spread.extraSmokes ?? []).map((smoke) => smoke.cell),
  ].filter((ref) => ref.floor === floor);
}

/** void でないマスと，マス目の中の位置をすべて含む最小の範囲．どちらも無ければ null */
function keptBounds(floor: Floor, refs: readonly CellRef[]): Bounds | null {
  let minX = Infinity;
  let maxX = -Infinity;
  let minZ = Infinity;
  let maxZ = -Infinity;
  const include = (x: number, z: number): void => {
    minX = Math.min(minX, x);
    maxX = Math.max(maxX, x);
    minZ = Math.min(minZ, z);
    maxZ = Math.max(maxZ, z);
  };
  for (let z = 0; z < floor.depth; z++) {
    for (let x = 0; x < floor.width; x++) {
      if (floor.cells[z * floor.width + x] !== "void") include(x, z);
    }
  }
  for (const { x, z } of refs) {
    if (
      Number.isInteger(x) &&
      Number.isInteger(z) &&
      x >= 0 &&
      x < floor.width &&
      z >= 0 &&
      z < floor.depth
    ) {
      include(x, z);
    }
  }
  return minX === Infinity ? null : { minX, maxX, minZ, maxZ };
}

/** 範囲のマスだけを切り出した階 */
function cropFloor(floor: Floor, b: Bounds): Floor {
  const cells: CellKind[] = [];
  const roomOf: number[] = [];
  for (let z = b.minZ; z <= b.maxZ; z++) {
    for (let x = b.minX; x <= b.maxX; x++) {
      const i = z * floor.width + x;
      cells.push(floor.cells[i]);
      roomOf.push(floor.roomOf[i]);
    }
  }
  return { ...floor, width: b.maxX - b.minX + 1, depth: b.maxZ - b.minZ + 1, cells, roomOf };
}
