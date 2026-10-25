// 教員用のホーム画面（portal/）が使う URL を組み立てる純粋な関数（DOM・location に依存しない）

/** 背景のキービジュアルの置き場所（public/ からの相対） */
export const HERO_IMAGE_PATHS = {
  webp: "home/hero.webp",
  jpg: "home/hero.jpg",
} as const;

/** 背景のキービジュアルの URL（webp と，webp を読めない端末向けの jpg） */
export interface HeroImageUrls {
  readonly webp: string;
  readonly jpg: string;
}

/**
 * base（import.meta.env.BASE_URL）から背景の画像の URL を作る．
 * 配信先が "/" 以外の base でも壊れないよう，base の後ろに public/ からの相対パスをつなぐ
 */
export function resolveHeroImageUrls(base: string): HeroImageUrls {
  const root = base.endsWith("/") ? base : `${base}/`;
  return {
    webp: `${root}${HERO_IMAGE_PATHS.webp}`,
    jpg: `${root}${HERO_IMAGE_PATHS.jpg}`,
  };
}

/**
 * 「エディタを開く」の行き先．今のページのパス（location.pathname）を保ったまま，
 * パラメータを ?editor だけにする（ホームに付いていた他のパラメータ・ハッシュは持ち越さない）
 */
export function buildEditorHref(pathname: string): string {
  const path = pathname === "" ? "/" : pathname;
  return `${path}?editor`;
}
