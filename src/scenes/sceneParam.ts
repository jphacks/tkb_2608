// URL パラメータ（?scene=room 等）から表示する空間を決める（DOM に依存しない純粋な関数）

export const SCENE_IDS = ["room", "train", "elevator"] as const;
export type SceneId = (typeof SCENE_IDS)[number];

export const DEFAULT_SCENE_ID: SceneId = "room";

function isSceneId(value: string): value is SceneId {
  return (SCENE_IDS as readonly string[]).includes(value);
}

/** クエリ文字列（"?scene=room" 等）から空間の id を取り出す．無い・不正な値なら null */
export function parseSceneId(search: string): SceneId | null {
  const value = new URLSearchParams(search).get("scene");
  if (value === null) return null;
  const normalized = value.trim().toLowerCase();
  return isSceneId(normalized) ? normalized : null;
}

/** 表示する空間を決める．未実装・不正・指定なしは fallback にする */
export function resolveSceneId(
  search: string,
  available: readonly SceneId[],
  fallback: SceneId = DEFAULT_SCENE_ID,
): SceneId {
  const requested = parseSceneId(search);
  return requested !== null && available.includes(requested) ? requested : fallback;
}
