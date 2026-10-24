// 操作盤のページのキーと印の種類（DOM に依存しない純粋な関数．experiment_山﨑/10「印の付け方」）

export interface MarkKindSpec {
  /** KeyboardEvent.code */
  readonly code: string;
  /** 画面に出すキーの名前 */
  readonly keyLabel: string;
  /** 記録に書く種類（MARK_KIND_PATTERN に合う文字列） */
  readonly kind: string;
  readonly title: string;
}

/** キーと印の種類の一覧（1〜4 と Space） */
export const MARK_KINDS: readonly MarkKindSpec[] = [
  { code: "Digit1", keyLabel: "1", kind: "false-walk", title: "歩いていないのに進んだ" },
  { code: "Digit2", keyLabel: "2", kind: "missed-walk", title: "歩いたのに進まない" },
  { code: "Digit3", keyLabel: "3", kind: "false-stand", title: "立っていないのに立った" },
  { code: "Digit4", keyLabel: "4", kind: "hand-glitch", title: "手が震えた・消えた" },
  { code: "Space", keyLabel: "Space", kind: "other", title: "その他" },
];

/** 押したキー（KeyboardEvent.code．テンキーの 1〜4 も同じに扱う）の印の種類．印のキーでなければ null */
export function markKindForCode(code: string): MarkKindSpec | null {
  const normalized = /^Numpad[1-4]$/.test(code) ? `Digit${code.slice(-1)}` : code;
  return MARK_KINDS.find((k) => k.code === normalized) ?? null;
}
