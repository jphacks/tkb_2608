// エリア（シナリオの判定に使う床の範囲）の判定（three に依存しない純粋な関数）．
// プレイヤーの体の中心（目の真下）が矩形の中にあれば，そのエリアにいるとみなす

import { rectContains, type XZRect } from "./collision";

/** エリア（XZ の矩形と id．部屋の RoomArea と同じ形） */
export interface FloorArea extends XZRect {
  readonly id: string;
}

/** (x, z) を含むエリアの id（areas の順．重なっていれば複数．境界上は含む） */
export function areasAt(areas: readonly FloorArea[], x: number, z: number): string[] {
  const ids: string[] = [];
  for (const area of areas) {
    if (rectContains(area, x, z)) ids.push(area.id);
  }
  return ids;
}

/** 前後のエリアの id から，入ったエリアと出たエリアを求める（それぞれ元の並びの順） */
export function diffAreaIds(
  previous: readonly string[],
  current: readonly string[],
): { readonly entered: string[]; readonly exited: string[] } {
  return {
    entered: current.filter((id) => !previous.includes(id)),
    exited: previous.filter((id) => !current.includes(id)),
  };
}
