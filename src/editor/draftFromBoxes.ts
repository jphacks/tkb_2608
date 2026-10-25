// AI が読み取った部屋の矩形（core/floorDraftApi.ts の DraftRoomBox）を，マス目の下書き（FloorDraft）に変える純粋な関数（ES3）．
// 矩形の端を近いマスの境界に丸めて塗り，教室ごとに廊下等へ出るドアを 1 か所置く．DOM・通信に依存しない
import { DRAFT_BOX_SCALE, type DraftRoomBox, type DraftRoomKind } from "../core/floorDraftApi";
import type { CellKind, FloorDraft, Room } from "../core/schoolPlan";

/** 部屋の種類 → マスの種類（階段は 1 フロアの段階の割り切りで出口，エレベーターは入れないので壁） */
export const DRAFT_KIND_TO_CELL: Readonly<Record<DraftRoomKind, CellKind>> = {
  room: "classroom",
  corridor: "corridor",
  outdoor: "outdoor",
  stairs: "exit",
  elevator: "wall",
};

/** 名前が読めなかった教室の仮の名前（n は 1 から） */
export const draftRoomName = (n: number): string => `教室${n}`;

/** マス目の上の矩形（x0〜x1−1，z0〜z1−1 のマス） */
interface CellRect {
  readonly x0: number;
  readonly z0: number;
  readonly x1: number;
  readonly z1: number;
}

/** 上下左右の隣への差 */
const OFFSETS: readonly { readonly dx: number; readonly dz: number }[] = [
  { dx: 0, dz: -1 },
  { dx: 1, dz: 0 },
  { dx: 0, dz: 1 },
  { dx: -1, dz: 0 },
];

/**
 * 矩形のリストを width × depth のマス目の下書きにする．
 *
 * - 正規化座標（0〜1000）をマス目に換算し，矩形の端を近いマスの境界に丸める（最低 1 マス．マス目の外にははみ出さない）
 * - 矩形が重なったマスは面積の小さい矩形を優先する（大部屋の中の小部屋を描くため．同じ面積なら後の矩形）
 * - どの矩形にも入らないマスは void
 * - 教室は矩形ごとに別の教室にし，全部ほかの矩形に覆われた教室は除いて添字を詰める．名前が空なら「教室1」等
 * - 教室ごとに，廊下と接する辺のうち 1 か所の教室側のマスをドアにする（placeDoors）
 *
 * width・depth は 1 以上の整数を渡す
 */
export function draftFromBoxes(
  boxes: readonly DraftRoomBox[],
  width: number,
  depth: number,
): FloorDraft {
  const count = width * depth;
  const owner = new Array<number>(count).fill(-1);
  const rects = boxes.map((b) => toCellRect(b.box, width, depth));
  const area = (r: CellRect): number => (r.x1 - r.x0) * (r.z1 - r.z0);
  // 大きい順に塗り，小さい矩形で上書きする（sort は安定なので，同じ面積は後の矩形が残る）
  const order = rects.map((_, i) => i).sort((a, b) => area(rects[b]) - area(rects[a]));
  for (const i of order) {
    const r = rects[i];
    for (let z = r.z0; z < r.z1; z++) {
      for (let x = r.x0; x < r.x1; x++) owner[z * width + x] = i;
    }
  }

  // 残った教室の矩形に，元の順で詰めた添字を振る
  const roomIndexOfBox = new Array<number>(boxes.length).fill(-1);
  const usedBoxes = new Set(owner.filter((i) => i >= 0));
  const roomBoxes: DraftRoomBox[] = [];
  boxes.forEach((b, i) => {
    if (b.kind !== "room" || !usedBoxes.has(i)) return;
    roomIndexOfBox[i] = roomBoxes.length;
    roomBoxes.push(b);
  });

  const cells: CellKind[] = owner.map((i) => (i < 0 ? "void" : DRAFT_KIND_TO_CELL[boxes[i].kind]));
  const roomOf: number[] = owner.map((i) => (i < 0 ? -1 : roomIndexOfBox[i]));
  const rooms = nameRooms(roomBoxes);
  placeDoors(cells, roomOf, width, depth, rooms.length);
  return { width, depth, cells, roomOf, rooms };
}

/** 正規化座標の矩形をマスの範囲にする（端は近いマスの境界に丸め，最低 1 マス．逆向きの組は入れ替える） */
function toCellRect(
  box: readonly [number, number, number, number],
  width: number,
  depth: number,
): CellRect {
  const [ymin, xmin, ymax, xmax] = box;
  const [x0, x1] = toSpan(Math.min(xmin, xmax), Math.max(xmin, xmax), width);
  const [z0, z1] = toSpan(Math.min(ymin, ymax), Math.max(ymin, ymax), depth);
  return { x0, z0, x1, z1 };
}

/** 0〜1000 の区間を 0〜size のマスの境界に丸めた区間（最低 1 マス） */
function toSpan(min: number, max: number, size: number): [number, number] {
  const clamp = (v: number): number => Math.min(size, Math.max(0, v));
  let a = clamp(Math.round((min / DRAFT_BOX_SCALE) * size));
  let b = clamp(Math.round((max / DRAFT_BOX_SCALE) * size));
  if (b <= a) {
    // 1 マスより細い矩形は，中心を含むマス 1 つにする
    const center = ((min + max) / 2 / DRAFT_BOX_SCALE) * size;
    a = Math.min(size - 1, Math.max(0, Math.floor(center)));
    b = a + 1;
  }
  return [a, b];
}

/** 教室の名前（空なら「教室n」．n は教室の番号で，ほかの教室と同じ名前にならないものを選ぶ） */
function nameRooms(roomBoxes: readonly DraftRoomBox[]): Room[] {
  const used = new Set(roomBoxes.map((b) => b.name.trim()).filter((n) => n !== ""));
  let next = 1;
  return roomBoxes.map((b) => {
    const name = b.name.trim();
    if (name !== "") return { name };
    while (used.has(draftRoomName(next))) next++;
    const fallback = draftRoomName(next);
    used.add(fallback);
    next++;
    return { name: fallback };
  });
}

/** 教室のマスと，その外側で接するマスの組（ドアの候補の辺） */
interface DoorEdge {
  /** 教室側のマスの添字 */
  readonly index: number;
  readonly x: number;
  readonly z: number;
  /** 外側のマスへの向き（OFFSETS の添字） */
  readonly side: number;
}

/**
 * 教室ごとにドアを 1 か所置く（cells・roomOf を書き換える）．
 * 廊下と接する辺 → 出口・隣の教室と接する辺，の順に探し，見つかった辺の並びの中央に近い辺の教室側のマスをドアにする．
 * 別の教室に接していないマスがあればそちらを選ぶ（ドアはどの空間ともつながるため，別の教室とつながらないように）．
 * どこにも接しない教室・1 マスしかない教室にはドアを置かない（教員が直す）
 */
function placeDoors(
  cells: CellKind[],
  roomOf: number[],
  width: number,
  depth: number,
  roomCount: number,
): void {
  const kindAt = (x: number, z: number): CellKind | null =>
    x >= 0 && x < width && z >= 0 && z < depth ? cells[z * width + x] : null;
  for (let room = 0; room < roomCount; room++) {
    const members: number[] = [];
    roomOf.forEach((r, i) => {
      if (r === room && cells[i] === "classroom") members.push(i);
    });
    if (members.length < 2) continue;

    const edgesTo = (matches: (kind: CellKind | null, x: number, z: number) => boolean) => {
      const edges: DoorEdge[] = [];
      for (const index of members) {
        const x = index % width;
        const z = Math.floor(index / width);
        OFFSETS.forEach(({ dx, dz }, side) => {
          if (matches(kindAt(x + dx, z + dz), x + dx, z + dz)) edges.push({ index, x, z, side });
        });
      }
      return edges;
    };
    const isOtherRoom = (kind: CellKind | null, x: number, z: number): boolean =>
      kind === "classroom" && roomOf[z * width + x] !== room;

    let edges = edgesTo((kind) => kind === "corridor");
    if (edges.length === 0) {
      edges = edgesTo((kind, x, z) => kind === "exit" || isOtherRoom(kind, x, z));
    }
    if (edges.length === 0) continue;

    const touchesOtherRoom = (e: DoorEdge): boolean =>
      OFFSETS.some(({ dx, dz }) => isOtherRoom(kindAt(e.x + dx, e.z + dz), e.x + dx, e.z + dz));
    const apart = edges.filter((e) => !touchesOtherRoom(e));
    const door = middleEdge(edges, apart.length > 0 ? apart : edges);
    cells[door.index] = "door";
    roomOf[door.index] = -1;
  }
}

/**
 * ドアにする辺．preferred（別の教室に接しない辺．無ければ全部）のうち一番多い向きの辺を候補にし，
 * その向きの辺の並び（edges 全体で見る）の中央に一番近い候補を選ぶ（同じ近さなら左・上の辺）
 */
function middleEdge(edges: readonly DoorEdge[], preferred: readonly DoorEdge[]): DoorEdge {
  const bySide = new Map<number, DoorEdge[]>();
  for (const e of preferred) bySide.set(e.side, [...(bySide.get(e.side) ?? []), e]);
  let best: DoorEdge[] = [];
  for (const list of bySide.values()) if (list.length > best.length) best = list;
  const side = best[0].side;
  // 上下の向きの辺は x に沿って，左右の向きの辺は z に沿って並ぶ
  const along = (e: DoorEdge): number => (e.side % 2 === 0 ? e.x : e.z);
  const values = edges.filter((e) => e.side === side).map(along);
  const center = (Math.min(...values) + Math.max(...values)) / 2;
  return best.reduce((a, b) => {
    const da = Math.abs(along(a) - center);
    const db = Math.abs(along(b) - center);
    return db < da || (db === da && along(b) < along(a)) ? b : a;
  });
}
