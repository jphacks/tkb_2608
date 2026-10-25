// 防火シャッターのくぐり戸が，人が近づくと開き離れると閉じる動きの計算（three に依存しない純粋な関数）．
// 座標はシャッターの Group のローカル（X が辺に沿う向き，Z が辺の法線．原点は辺の中心の床の上）

/** くぐり戸の自動の開閉の定数 */
export const WICKET_AUTO = {
  /** 閉じている時に開き始める，目からくぐり戸の中心までの距離（XZ 平面．m） */
  openDistance: 1.5,
  /** 開いている時に閉じ始める距離（m．openDistance より大きくし，境目で開閉を繰り返さないようにする） */
  closeDistance: 1.9,
  /** 閉から全開まで（全開から閉まで）にかかる時間（s） */
  travelSeconds: 0.4,
  /** 全開の時の扉の回転の大きさ（rad．幕の面から 90° 開く） */
  maxAngle: Math.PI / 2,
} as const;

/** 扉の開く向き．1 は幕の -Z の側へ，-1 は +Z の側へ開く */
export type WicketSwing = 1 | -1;

/**
 * 開くべきか．wasOpen（直前に開くべきだったか）で距離のしきい値を変える（openDistance で開き，closeDistance を超えたら閉じる）．
 * distance が NaN（目の位置が無い等）なら閉じる
 */
export function wicketShouldOpen(wasOpen: boolean, distance: number): boolean {
  if (Number.isNaN(distance)) return false;
  return distance <= (wasOpen ? WICKET_AUTO.closeDistance : WICKET_AUTO.openDistance);
}

/**
 * 開き具合 openAmount（0 で閉，1 で全開）を dt（s）だけ open の向きへ進める．
 * dt が無い・有限でない時は瞬時に切り替える（SpaceFrame.dt が無い時の約束と同じ）．負の dt は 0 として扱う
 */
export function stepWicketOpenAmount(openAmount: number, open: boolean, dt?: number): number {
  const target = open ? 1 : 0;
  if (dt === undefined || !Number.isFinite(dt)) return target;
  const current = Number.isFinite(openAmount) ? Math.min(1, Math.max(0, openAmount)) : target;
  const step = Math.max(0, dt) / WICKET_AUTO.travelSeconds;
  return open ? Math.min(target, current + step) : Math.max(target, current - step);
}

/** 人が来た側（ローカル Z の符号）から，押して開く向き（来た側の反対）を返す．辺の線の上（0）・NaN は -Z の側へ開く */
export function wicketSwingFrom(localZ: number): WicketSwing {
  return localZ < 0 ? -1 : 1;
}

/**
 * 開き具合と向きから，蝶番（くぐり戸の -X の縦の辺）を軸にした扉の回転（Y 軸回り，rad）を返す．
 * 正の回転で扉の +X の端が -Z の側へ動く．動き始めと終わりを緩やかにする（smoothstep）
 */
export function wicketLeafRotationY(openAmount: number, swing: WicketSwing): number {
  const t = Number.isFinite(openAmount) ? Math.min(1, Math.max(0, openAmount)) : 0;
  const eased = t * t * (3 - 2 * t);
  return swing * WICKET_AUTO.maxAngle * eased;
}
