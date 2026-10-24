// dev ページの一覧と「最後に開いたページ」の記憶．
// 入口（src/input/dev/index.html）を開いた時に前回のページへ自動で移る（?stay で止める）
// resolveDevRedirect は DOM に依存しない純粋な関数．localStorage に触れるのは remember・readLast だけ

/** dev ページの一覧（入口からのリンクと，自動で移る先として認める名前） */
export const DEV_PAGES = [
  { file: "sensors.html", title: "センサーの確認", note: "値・グラフ・周期・記録の状態" },
  {
    file: "protocol.html",
    title: "手順の記録",
    note: "手順を音で案内してラベル付きで記録（約 5 分）",
  },
  {
    file: "detect.html",
    title: "判定の確認",
    note: "足踏み・しゃがみの途中の値と状態のグラフ・しきい値のスライダー",
  },
  {
    file: "goggles.html",
    title: "ゴーグルでの確認",
    note: "左右 2 画面の空間で歩く・しゃがむ・見回す（判定の状態を視界に表示）",
  },
] as const;

export type DevPageFile = (typeof DEV_PAGES)[number]["file"];

const STORAGE_KEY = "input-dev:last-page";

function isDevPageFile(v: unknown): v is DevPageFile {
  return DEV_PAGES.some((p) => p.file === v);
}

/**
 * 入口を開いた時に移る先を決める．?stay がある・記憶が無い・一覧に無い名前なら null（入口に留まる）
 * search は location.search，stored は localStorage に残っていた値
 */
export function resolveDevRedirect(search: string, stored: string | null): DevPageFile | null {
  if (new URLSearchParams(search).has("stay")) return null;
  return isDevPageFile(stored) ? stored : null;
}

/** このページを「最後に開いたページ」として覚える（プライベートモード等で使えなくても例外を出さない） */
export function rememberDevPage(file: DevPageFile): void {
  try {
    localStorage.setItem(STORAGE_KEY, file);
  } catch {
    // 記憶できなくても困らない
  }
}

/** 覚えているページ（無い・読めなければ null） */
export function readLastDevPage(): string | null {
  try {
    return localStorage.getItem(STORAGE_KEY);
  } catch {
    return null;
  }
}
