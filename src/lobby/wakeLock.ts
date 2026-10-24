// 体験の間に画面が勝手に消えない（自動ロック・消灯しない）ようにする，Screen Wake Lock API の薄い殻．
// 一度頼んだら外さずに保ち，別のアプリから戻った時（visibilitychange）は取り直す．使えない・断られた時は何もしない

import type { WakeLockStatus } from "./homeSettings";

/** 画面の消灯を止める処理（app/ が 1 つだけ作り，許可の画面・ホームのタップで request を呼ぶ） */
export interface ScreenWakeLock {
  /** 今の状態 */
  readonly status: WakeLockStatus;
  /** 画面の消灯を止めるよう頼む．タップの処理の中で呼ぶ（取れている間・頼んでいる最中は何もしない） */
  request(): void;
  /** 状態が変わった時に呼ぶ関数を登録する．戻り値で登録を外す */
  subscribe(listener: (status: WakeLockStatus) => void): () => void;
}

/** 使う範囲だけの型（lib.dom の版によらず書けるようにする） */
interface SentinelLike {
  readonly released: boolean;
  addEventListener(type: "release", listener: () => void): void;
}
interface WakeLockLike {
  request(type: "screen"): Promise<SentinelLike>;
}

function wakeLockApi(): WakeLockLike | null {
  if (typeof navigator === "undefined") return null;
  const api = (navigator as Navigator & { readonly wakeLock?: WakeLockLike }).wakeLock;
  return api !== undefined && typeof api.request === "function" ? api : null;
}

export function createScreenWakeLock(): ScreenWakeLock {
  const api = wakeLockApi();
  let status: WakeLockStatus = api === null ? "unsupported" : "idle";
  /** 一度でも頼んだか（頼んだ後は，外れたら取り直す） */
  let wanted = false;
  const listeners = new Set<(status: WakeLockStatus) => void>();

  const set = (next: WakeLockStatus): void => {
    if (next === status) return;
    status = next;
    for (const listener of listeners) listener(next);
  };

  const acquire = (): void => {
    if (api === null || status === "active" || status === "pending") return;
    if (typeof document !== "undefined" && document.visibilityState !== "visible") return;
    set("pending");
    try {
      api
        .request("screen")
        .then((sentinel) => {
          if (sentinel.released) {
            set("released");
            return;
          }
          set("active");
          // 別のアプリへ移る・画面を消す等でブラウザが外す
          sentinel.addEventListener("release", () => set("released"));
        })
        .catch(() => set("failed"));
    } catch {
      set("failed");
    }
  };

  if (api !== null && typeof document !== "undefined") {
    document.addEventListener("visibilitychange", () => {
      if (wanted && document.visibilityState === "visible") acquire();
    });
  }

  return {
    get status() {
      return status;
    },
    request() {
      wanted = true;
      acquire();
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
}
