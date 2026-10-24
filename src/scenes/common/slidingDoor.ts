// 引き戸（電車のドア・エレベーターの扉）の扉の配置と開き具合の計算（three に依存しない純粋な関数）．
// 座標はドアの Group のローカル X（壁に沿う向き．原点は開口部の中央）

/** 引き戸の扉 1 枚の配置．closedX・移動はドアの Group のローカル X（壁に沿う向き） */
export interface SlidingLeafDef {
  readonly suffix: "a" | "b";
  readonly width: number;
  /** 閉じた状態の扉の中心（ドアの Group のローカル X） */
  readonly closedX: number;
  /** 開くときに動く向き（ローカル X の符号） */
  readonly slideDirection: 1 | -1;
  /** 全開時の移動量（m） */
  readonly slideDistance: number;
}

/**
 * 開口部の幅 width のドアの扉の配置．2 枚なら中央で合わさり左右へ開く（a は -X，b は +X へ），
 * 1 枚なら開口部をふさぎ +X へ開く．全開で開口部が全幅あく
 */
export function slidingLeaves(width: number, count: 1 | 2): SlidingLeafDef[] {
  if (count === 1) {
    return [{ suffix: "a", width, closedX: 0, slideDirection: 1, slideDistance: width }];
  }
  const w = width / 2;
  return [
    { suffix: "a", width: w, closedX: -w / 2, slideDirection: -1, slideDistance: w },
    { suffix: "b", width: w, closedX: w / 2, slideDirection: 1, slideDistance: w },
  ];
}

/** 開き具合 openAmount（0 で閉，1 で全開．範囲外は切り詰める）のときの扉の中心のローカル X */
export function slidingLeafX(
  leaf: Pick<SlidingLeafDef, "closedX" | "slideDirection" | "slideDistance">,
  openAmount: number,
): number {
  const t = Math.min(1, Math.max(0, openAmount));
  return leaf.closedX + leaf.slideDirection * leaf.slideDistance * t;
}
