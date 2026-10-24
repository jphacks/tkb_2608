// 隣り合うマスの間に薄い壁を置くかの規則（SPEC_02「壁の自動配置」）と，人・火・煙が隣のマスへ移れるかの規則
// （SPEC_02「通れる・燃え広がる」）．3D の組み立て・人の当たり判定・延焼の計算はすべてここの関数を使う
import type { CellKind, Floor } from "../core/schoolPlan";
import { type CellXZ, cellIndex, isAdjacent, kindAt } from "./grid";

/** マスの「空間」．教室は教室ごとに別（`room:<添字>`），開口はどの空間ともつながる，null は無し（void・wall・マス目の外） */
type Space = `room:${number}` | "corridor" | "outdoor" | "opening" | null;

function spaceOf(floor: Floor, cell: CellXZ): Space {
  switch (kindAt(floor, cell.x, cell.z)) {
    case "classroom":
      return `room:${floor.roomOf[cellIndex(floor, cell.x, cell.z)]}`;
    case "corridor":
      return "corridor";
    case "outdoor":
      return "outdoor";
    case "door":
    case "exit":
    case "shutter":
      return "opening";
    default:
      return null;
  }
}

/**
 * 隣り合う 2 つのマス a・b の間の辺に薄い壁を置くか（SPEC_02「壁の自動配置」）．
 * どちらかがマス目の外でもよい．上下左右に隣り合わない 2 つを渡した時は RangeError を投げる
 */
export function wallBetween(floor: Floor, a: CellXZ, b: CellXZ): boolean {
  if (!isAdjacent(a, b)) {
    throw new RangeError(`(${a.x}, ${a.z}) と (${b.x}, ${b.z}) は隣り合っていません`);
  }
  const sa = spaceOf(floor, a);
  const sb = spaceOf(floor, b);
  if (sa === null && sb === null) return false;
  if (sa === null || sb === null) {
    // 屋外の端（void・マス目の外）は校庭の端なので壁を置かない．屋外と wall のマスも，
    // wall のマス自体が直方体でふさがるため置かない（仕様に書かれていない組み合わせ）
    return (sa ?? sb) !== "outdoor";
  }
  if (sa === "opening" || sb === "opening") return false;
  return sa !== sb;
}

/** 人がそのマスの種類に入れるか（時刻による火は見ない） */
export function isWalkableKind(kind: CellKind | null): boolean {
  return kind !== null && kind !== "void" && kind !== "wall";
}

/** 火・煙がそのマスの種類に広がれるか（防火シャッターで止まり，屋外へは広がらない） */
export function isSpreadableKind(kind: CellKind | null): boolean {
  return isWalkableKind(kind) && kind !== "shutter" && kind !== "outdoor";
}

/**
 * 人が from から隣の to へ移れるか（間に壁が無く，to が void・wall・マス目の外でない）．
 * to がその時刻に燃えていないかは呼ぶ側が SpreadMap で確かめる
 */
export function canPersonStep(floor: Floor, from: CellXZ, to: CellXZ): boolean {
  return isWalkableKind(kindAt(floor, to.x, to.z)) && !wallBetween(floor, from, to);
}

/** 火・煙が from から隣の to へ広がれるか（間に壁が無く，to が void・wall・shutter・outdoor・マス目の外でない） */
export function canSpreadStep(floor: Floor, from: CellXZ, to: CellXZ): boolean {
  return isSpreadableKind(kindAt(floor, to.x, to.z)) && !wallBetween(floor, from, to);
}
