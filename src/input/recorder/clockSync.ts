// 端末（スマホ・PC）と開発サーバーの時刻合わせ（DOM にも Node にも依存しない純粋な関数）．
// 操作盤の PC で押した印を，記録している端末の performance.now() の基準に換算するために使う（experiment_山﨑/10「印の付け方」）．
// 両方の端末が開発サーバーの時計に合わせ，開発サーバーの時刻を介して換算する
import type { ClockRecord } from "./records";

/** 時刻合わせの 1 回の往復（ms） */
export interface ClockPing {
  /** 送った時の端末の時刻 */
  readonly sendT: number;
  /** 応答を受け取った時の端末の時刻 */
  readonly recvT: number;
  /** 応答に入っていた開発サーバーの Date.now() */
  readonly serverTime: number;
}

/** 時刻合わせの結果．serverTime − t が「端末の時刻 → 開発サーバーの時刻」の差 */
export interface ClockEstimate {
  readonly t: number;
  readonly serverTime: number;
  readonly rtt: number;
}

/**
 * 往復の中で最も速く返ってきたもの（ネットワークの待ちが少なく，確か）を選ぶ．
 * 値が有限でない・受け取りが送りより前の往復は捨てる．使えるものが無ければ null
 */
export function pickClockEstimate(pings: readonly ClockPing[]): ClockEstimate | null {
  let best: ClockEstimate | null = null;
  for (const p of pings) {
    if (![p.sendT, p.recvT, p.serverTime].every(Number.isFinite)) continue;
    const rtt = p.recvT - p.sendT;
    if (rtt < 0) continue;
    if (best === null || rtt < best.rtt) {
      best = { t: (p.sendT + p.recvT) / 2, serverTime: p.serverTime, rtt };
    }
  }
  return best;
}

/** 端末の時刻 → 開発サーバーの時刻の差（ms）．serverTime = t + offset */
export function clockOffset(e: Pick<ClockEstimate, "t" | "serverTime">): number {
  return e.serverTime - e.t;
}

/** 端末の時刻を開発サーバーの時刻にする */
export function toServerTime(localT: number, e: ClockEstimate): number {
  return localT + clockOffset(e);
}

export interface DeviceTimeContext {
  /** 記録している端末の時刻合わせの結果（clock レコード）．無ければ null */
  readonly clock: Pick<ClockRecord, "t" | "serverTime"> | null;
  /** 記録している端末の performance.timeOrigin（meta レコード．壁時計の ms）．無ければ null */
  readonly timeOrigin: number | null;
}

/**
 * 開発サーバーの時刻を，記録している端末の performance.now() の基準の時刻にする．
 * 時刻合わせの結果があればそれを使い（"sync"），無ければ meta の timeOrigin（端末の壁時計）で換算する（"wall"．
 * 端末と開発サーバーの壁時計が合っている前提のため，ずれる）．どちらも無い・値が壊れていれば null
 */
export function serverTimeToDeviceT(
  serverTime: number,
  ctx: DeviceTimeContext,
): { readonly t: number; readonly clock: "sync" | "wall" } | null {
  if (!Number.isFinite(serverTime)) return null;
  const c = ctx.clock;
  if (c !== null && Number.isFinite(c.t) && Number.isFinite(c.serverTime)) {
    return { t: serverTime - clockOffset(c), clock: "sync" };
  }
  if (ctx.timeOrigin !== null && Number.isFinite(ctx.timeOrigin)) {
    return { t: serverTime - ctx.timeOrigin, clock: "wall" };
  }
  return null;
}
