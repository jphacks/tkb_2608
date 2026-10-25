// SchoolPlan の中身の検査（SPEC_02「URL と QR への埋め込み」）．URL から読み戻した校舎と，エディタで作った校舎の両方を同じ規則で確かめる．
// 誤りは画面にそのまま出せる日本語の文で返す（生徒の開始画面の「QR コードを読み直してください」の理由，教員のエディタの指摘）
import type { CellKind, CellRef, Floor, SchoolPlan } from "../core/schoolPlan";
import { CELL_KIND_TO_CHAR } from "./cellChars";

/** 人が入れないマス（SPEC_02「通れる・燃え広がる」）．正解経路に含められない */
const IMPASSABLE: ReadonlySet<CellKind> = new Set<CellKind>(["void", "wall"]);

const isPositiveInteger = (value: number): boolean => Number.isInteger(value) && value > 0;
const isPositiveFinite = (value: number): boolean => Number.isFinite(value) && value > 0;

/**
 * SchoolPlan の中身を確かめ，誤りの理由を並べて返す（誤りが無ければ空の配列）．
 * 同じ種類の誤りが多くのマスにある時は，最初のマスと件数だけを 1 文にまとめる（マス 1 つずつ並べると読めないため）
 */
export function validatePlan(plan: SchoolPlan): readonly string[] {
  const errors: string[] = [];

  if (plan.version !== 1) errors.push(`データの版（${String(plan.version)}）に対応していません`);
  if (!isPositiveFinite(plan.cellSize)) errors.push("マスの大きさは 0 より大きい数にしてください");

  if (plan.floors.length === 0) errors.push("階が 1 つもありません");
  plan.floors.forEach((floor, index) => {
    errors.push(...validateFloor(floor, index, plan.rooms.length));
  });
  // 階のマス目が壊れていると，位置の検査が誤った添字でマスを読むため，ここで打ち切る
  if (errors.length > 0) return errors;

  const drill = plan.drill;
  if (drill.mode !== "learn" && drill.mode !== "test") {
    errors.push("訓練のモードは学習かテストにしてください");
  }

  if (drill.fireOrigins.length === 0) errors.push("火元が 1 つもありません");
  drill.fireOrigins.forEach((ref, i) => {
    errors.push(...validateRef(plan, ref, `火元 ${i + 1}`));
  });

  const startErrors = validateRef(plan, drill.start, "開始地点");
  errors.push(...startErrors);
  if (startErrors.length === 0 && kindAt(plan, drill.start) !== "classroom") {
    errors.push(`開始地点 ${describeRef(plan, drill.start)} が教室のマスではありません`);
  }
  if (!Number.isFinite(drill.startYaw)) errors.push("開始時の向きが数ではありません");

  if (drill.assembly.length === 0) errors.push("集合場所が 1 つもありません");
  drill.assembly.forEach((ref, i) => {
    const refErrors = validateRef(plan, ref, `集合場所 ${i + 1}`);
    errors.push(...refErrors);
    if (refErrors.length === 0 && kindAt(plan, ref) !== "outdoor") {
      errors.push(`集合場所 ${describeRef(plan, ref)} が屋外のマスではありません`);
    }
  });

  errors.push(...validateRoute(plan));

  const spread = drill.spread;
  if (!isPositiveFinite(spread.fireSecondsPerCell)) {
    errors.push("火が隣のマスへ移る秒数は 0 より大きい数にしてください");
  }
  if (!isPositiveFinite(spread.smokeSecondsPerCell)) {
    errors.push("煙が隣のマスへ移る秒数は 0 より大きい数にしてください");
  }
  spread.extraFires.forEach((fire, i) => {
    errors.push(...validateRef(plan, fire.cell, `追加の延焼箇所 ${i + 1}`));
    if (!(Number.isFinite(fire.atSeconds) && fire.atSeconds >= 0)) {
      errors.push(`追加の延焼箇所 ${i + 1} の燃え始める時刻は 0 秒以上にしてください`);
    }
  });
  (spread.extraSmokes ?? []).forEach((smoke, i) => {
    errors.push(...validateRef(plan, smoke.cell, `煙の発生源 ${i + 1}`));
    if (!(Number.isFinite(smoke.atSeconds) && smoke.atSeconds >= 0)) {
      errors.push(`煙の発生源 ${i + 1} の煙が出始める時刻は 0 秒以上にしてください`);
    }
  });

  if (!isPositiveFinite(drill.timeLimitSeconds)) {
    errors.push("制限時間は 0 秒より長くしてください");
  }

  return errors;
}

/** 1 つの階のマス目の検査（大きさ・配列の長さ・マスの種類・教室の添字）．エディタの配置の下書き（ES3）の検査にも使う */
export function validateFloor(floor: Floor, index: number, roomCount: number): string[] {
  const label = `${index + 1} つ目の階`;
  const errors: string[] = [];
  if (!isPositiveInteger(floor.level))
    errors.push(`${label}の階の番号は 1 以上の整数にしてください`);
  if (!isPositiveInteger(floor.width) || !isPositiveInteger(floor.depth)) {
    errors.push(`${label}のマス目の幅と奥行きは 1 以上の整数にしてください`);
    return errors;
  }
  const count = floor.width * floor.depth;
  if (floor.cells.length !== count) {
    errors.push(`${label}のマスの数が ${floor.cells.length} です（${count} のはずです）`);
  }
  if (floor.roomOf.length !== count) {
    errors.push(
      `${label}の教室の割り当ての数が ${floor.roomOf.length} です（${count} のはずです）`,
    );
  }
  if (errors.length > 0) return errors;

  const unknownKind = findCells(floor, (i) => !Object.hasOwn(CELL_KIND_TO_CHAR, floor.cells[i]));
  if (unknownKind !== null) {
    errors.push(
      `${label}の ${unknownKind.first} に知らない種類のマスがあります${more(unknownKind.count)}`,
    );
  }
  const badRoom = findCells(floor, (i) => {
    const room = floor.roomOf[i];
    return floor.cells[i] === "classroom"
      ? !(Number.isInteger(room) && room >= 0 && room < roomCount)
      : room !== -1;
  });
  if (badRoom !== null) {
    errors.push(
      `${label}の ${badRoom.first} の教室の割り当てが正しくありません${more(badRoom.count)}`,
    );
  }
  return errors;
}

/** 条件に合うマスの最初の位置（`(x, z)`）と件数．無ければ null */
function findCells(
  floor: Floor,
  matches: (index: number) => boolean,
): { readonly first: string; readonly count: number } | null {
  let first = "";
  let count = 0;
  for (let i = 0; i < floor.cells.length; i++) {
    if (!matches(i)) continue;
    if (count === 0) first = `(${i % floor.width}, ${Math.floor(i / floor.width)})`;
    count++;
  }
  return count === 0 ? null : { first, count };
}

const more = (count: number): string => (count > 1 ? `（ほか ${count - 1} マス）` : "");

/** 位置が階・マス目の範囲に収まる整数か */
function validateRef(plan: SchoolPlan, ref: CellRef, label: string): string[] {
  const { floor, x, z } = ref;
  if (!(Number.isInteger(floor) && floor >= 0 && floor < plan.floors.length)) {
    return [`${label}の階が校舎にありません`];
  }
  const f = plan.floors[floor];
  if (
    !(Number.isInteger(x) && Number.isInteger(z) && x >= 0 && x < f.width && z >= 0 && z < f.depth)
  ) {
    return [`${label}の位置 (${x}, ${z}) がマス目の外です`];
  }
  return [];
}

/**
 * 正解経路の検査（開始地点から始まり，集合場所で終わり，同じ階で上下左右に隣り合う，人が入れるマスの列）．
 * 空は誤りにしない．空なら生徒側で proposeRoute() の提案を使う（SPEC_01「結果の評価」）ので，検査をすべて飛ばす
 */
function validateRoute(plan: SchoolPlan): string[] {
  const { route, start, assembly } = plan.drill;
  if (route.length === 0) return [];

  const errors: string[] = [];
  route.forEach((ref, i) => {
    errors.push(...validateRef(plan, ref, `正解経路の ${i + 1} マス目`));
  });
  // 範囲外のマスがあると種類を読めないため，残りの検査はしない
  if (errors.length > 0) return errors;

  if (!sameRef(route[0], start)) errors.push("正解経路が開始地点から始まっていません");
  if (!assembly.some((ref) => sameRef(ref, route[route.length - 1]))) {
    errors.push("正解経路が集合場所で終わっていません");
  }
  for (let i = 1; i < route.length; i++) {
    const a = route[i - 1];
    const b = route[i];
    if (a.floor !== b.floor || Math.abs(a.x - b.x) + Math.abs(a.z - b.z) !== 1) {
      errors.push(
        `正解経路の ${i} マス目 ${describeRef(plan, a)} と ${i + 1} マス目 ${describeRef(plan, b)} が上下左右に隣り合っていません`,
      );
      break;
    }
  }
  const blocked = route.findIndex((ref) => IMPASSABLE.has(kindAt(plan, ref)));
  if (blocked >= 0) {
    errors.push(
      `正解経路の ${blocked + 1} マス目 ${describeRef(plan, route[blocked])} は人が入れないマスです`,
    );
  }
  return errors;
}

/** 範囲内であることを確かめた位置のマスの種類 */
function kindAt(plan: SchoolPlan, ref: CellRef): CellKind {
  const floor = plan.floors[ref.floor];
  return floor.cells[ref.z * floor.width + ref.x];
}

/** 画面に出す位置の書き方（「1階の (2, 3)」） */
function describeRef(plan: SchoolPlan, ref: CellRef): string {
  return `${plan.floors[ref.floor].level}階の (${ref.x}, ${ref.z})`;
}

const sameRef = (a: CellRef, b: CellRef): boolean =>
  a.floor === b.floor && a.x === b.x && a.z === b.z;
