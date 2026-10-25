// トップ（パラメータ無しのホーム画面．portal/）が使う URL と並べる入口を組み立てる純粋な関数（DOM・location に依存しない）

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

/**
 * 「PC で体験する」の行き先．体験の流れ（?app）を PC モード（?pc．マウス・キーボードで，ゴーグルの案内等を飛ばす）で開く．
 * #p= が無いのでデモの校舎で始まる
 */
export function buildPcExperienceHref(pathname: string): string {
  const path = pathname === "" ? "/" : pathname;
  return `${path}?app&pc`;
}

/** 「スマホ＋VR ゴーグルで体験する」の行き先．体験の流れ（?app．入力はスマホのセンサー）をデモの校舎で開く */
export function buildVrExperienceHref(pathname: string): string {
  const path = pathname === "" ? "/" : pathname;
  return `${path}?app`;
}

/** トップに並べる入口の種類．pc = PC で体験，vr = スマホ＋ゴーグルで体験，editor = 校舎を作る */
export type PortalEntryId = "pc" | "vr" | "editor";

/** トップに並べる入口 1 つ */
export interface PortalEntry {
  readonly id: PortalEntryId;
  readonly label: string;
  /** ボタンの下に出す 1 行（何ができるか・何が要るか） */
  readonly note: string;
  readonly href: string;
  /** 一番目立たせるか（並びの先頭に置く） */
  readonly primary: boolean;
}

/**
 * トップに並べる入口（並べる順）．coarsePointer はタッチ主体の端末（スマホ）か．
 * PC で開いた時は「PC で体験する」を，スマホで開いた時は「スマホ＋VR ゴーグルで体験する」を先頭にして目立たせる
 */
export function portalEntries(pathname: string, coarsePointer: boolean): readonly PortalEntry[] {
  const pc: PortalEntry = {
    id: "pc",
    label: "PC で体験する",
    note: "ゴーグル不要．W で歩く・C でしゃがむ・ドラッグで見回す",
    href: buildPcExperienceHref(pathname),
    primary: !coarsePointer,
  };
  const vr: PortalEntry = {
    id: "vr",
    label: "スマホ＋VR ゴーグルで体験する",
    note: "スマホと簡易ゴーグルを使い，足踏みで歩く・しゃがんで避難する",
    href: buildVrExperienceHref(pathname),
    primary: coarsePointer,
  };
  const editor: PortalEntry = {
    id: "editor",
    label: "校舎を作る（エディタ）",
    note: "PC で校舎・火元・開始地点を置き，生徒用の QR コードを出す",
    href: buildEditorHref(pathname),
    primary: false,
  };
  return coarsePointer ? [vr, pc, editor] : [pc, vr, editor];
}
