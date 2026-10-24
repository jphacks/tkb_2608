// ホームの「設定」まわりの判断と文面（DOM に依存しない純粋な関数）．
// 表示は homeSettingsPanel.ts・homeScene.ts，画面の消灯を止める処理は wakeLock.ts

/**
 * 画面の消灯を止める（Screen Wake Lock）の状態．
 * - unsupported: この端末・ブラウザでは使えない
 * - idle: まだ頼んでいない
 * - pending: 頼んで結果を待っている
 * - active: 有効（画面が消えない）
 * - released: 別のアプリへ移った等で外れた（画面に戻ると取り直す）
 * - failed: 頼んだが断られた
 */
export type WakeLockStatus = "unsupported" | "idle" | "pending" | "active" | "released" | "failed";

/** ホームを作り直しても保つ，その回の利用の中の状態（app/ が 1 つだけ作って渡す） */
export interface HomeMemory {
  /** 設定を一度でも開いたか */
  settingsVisited: boolean;
}

export function createHomeMemory(): HomeMemory {
  return { settingsVisited: false };
}

/** 「スタート」を押した時に「音量や画面の明るさは大丈夫ですか？」と聞くか（設定を一度も開いていない時だけ聞く） */
export function shouldConfirmStart(memory: Readonly<HomeMemory>): boolean {
  return !memory.settingsVisited;
}

/** 設定に出す，画面の消灯を止める処理の状態の文面 */
export interface WakeLockDescription {
  readonly label: string;
  /** 自分で設定を変えてもらう時の案内（要らなければ null） */
  readonly help: string | null;
}

/** 設定の「画面の明るさ」に並べる案内（1 つが 1 段落．Web からは明るさを読めず変えられないため，案内だけにする） */
export const BRIGHTNESS_GUIDE: readonly string[] = [
  "ゴーグルの中で見やすい明るさに，コントロールセンター等で合わせてください．" +
    "「暗い灰」と「ほぼ黒」が見分けられる程度が目安です．",
  "明るさは中くらいが目安です．ゴーグルの中では外より明るく感じます．",
  "明るさの自動調節をオフにしてください（設定 → アクセシビリティ → 画面表示とテキストサイズ → 明るさの自動調節）．" +
    "ゴーグルに入れると光のセンサーが覆われ，画面が暗くなるためです．",
];

/** 使えない・断られた時の，端末の設定で自動ロックを止めてもらう案内 */
export const AUTO_LOCK_HELP =
  "設定 → 画面表示と明るさ → 自動ロック を「なし」にしてください（体験の後は元に戻してください）";

export function describeWakeLockStatus(status: WakeLockStatus): WakeLockDescription {
  switch (status) {
    case "active":
      return { label: "有効", help: null };
    case "unsupported":
      return { label: "この端末では使えません", help: AUTO_LOCK_HELP };
    case "failed":
      return { label: "有効にできませんでした", help: AUTO_LOCK_HELP };
    case "released":
      return { label: "一時的に外れています（画面に戻ると有効にし直します）", help: null };
    case "idle":
    case "pending":
      return { label: "確認しています…", help: null };
  }
}
