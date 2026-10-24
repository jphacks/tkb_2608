// URL パラメータ（?scene=room 等）から表示する空間を決める（DOM に依存しない純粋な関数）

export const SPACE_IDS = ["room", "train", "elevator", "school-parts"] as const;
export type SpaceId = (typeof SPACE_IDS)[number];

export const DEFAULT_SPACE_ID: SpaceId = "room";

function isSpaceId(value: string): value is SpaceId {
  return (SPACE_IDS as readonly string[]).includes(value);
}

/** クエリ文字列（"?scene=room" 等）から空間の id を取り出す．無い・不正な値なら null */
export function parseSpaceId(search: string): SpaceId | null {
  const value = new URLSearchParams(search).get("scene");
  if (value === null) return null;
  const normalized = value.trim().toLowerCase();
  return isSpaceId(normalized) ? normalized : null;
}

/** 表示する空間を決める．未実装・不正・指定なしは fallback にする */
export function resolveSpaceId(
  search: string,
  available: readonly SpaceId[],
  fallback: SpaceId = DEFAULT_SPACE_ID,
): SpaceId {
  const requested = parseSpaceId(search);
  return requested !== null && available.includes(requested) ? requested : fallback;
}
