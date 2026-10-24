// dev ページ共通の殻: センサーの許可 → フライトレコーダーの開始 → センサーの記録，と .jsonl のダウンロード
import { FlightRecorder, type FlightRecorderStatus } from "../recorder/flightRecorder";
import { motionRecord, orientationRecord, screenRecord } from "../recorder/records";
import {
  requestSensorPermission,
  type SensorHandlers,
  startSensors,
} from "../sensors/sensorSource";
import { formatLogTimestamp } from "./logFileName";

export interface DevRecording {
  readonly recorder: FlightRecorder;
  readonly permission: Awaited<ReturnType<typeof requestSensorPermission>>;
  /** センサーの購読と送信をやめる（最後に残りを送る） */
  stop(): void;
}

/**
 * ボタンの click の中で呼ぶ（iOS の許可はタップの中でしか取れない）．
 * 許可が取れなくても記録は始める（許可の結果は meta に残る）
 */
export async function startDevRecording(
  page: string,
  handlers: SensorHandlers = {},
): Promise<DevRecording> {
  const permission = await requestSensorPermission();
  const recorder = new FlightRecorder({
    page,
    extra: { permission, isSecureContext: window.isSecureContext, url: location.pathname },
  });
  const stopSensors = startSensors({
    onMotion: (s) => {
      recorder.record(motionRecord(s));
      handlers.onMotion?.(s);
    },
    onOrientation: (s) => {
      recorder.record(orientationRecord(s));
      handlers.onOrientation?.(s);
    },
    onScreen: (s) => {
      recorder.record(screenRecord(s));
      handlers.onScreen?.(s);
    },
  });
  const onVisibility = (e: Event) => {
    recorder.record({
      type: "visibility",
      t: e.timeStamp,
      state: document.visibilityState === "hidden" ? "hidden" : "visible",
    });
    // 裏に回る時はそれまでの分を送っておく
    if (document.visibilityState === "hidden") void recorder.flushOnExit();
  };
  document.addEventListener("visibilitychange", onVisibility);
  recorder.start();
  // 操作盤（PC）の印を同じ時刻の基準で書き込めるよう，開発サーバーと時刻を合わせる（待たない）
  void recorder.syncClock();
  return {
    recorder,
    permission,
    stop() {
      stopSensors();
      document.removeEventListener("visibilitychange", onVisibility);
      recorder.stop();
      void recorder.flush();
    },
  };
}

/** 残している記録を <日時>_<セッション ID>.jsonl としてダウンロードする */
export function downloadJsonl(recorder: FlightRecorder): void {
  const blob = new Blob([recorder.toJsonl()], { type: "application/x-ndjson" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `${formatLogTimestamp(new Date()) ?? "record"}_${recorder.sessionId}.jsonl`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  // すぐに解放すると Safari でダウンロードが始まらないことがあるため少し待つ
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

/** 記録の状態を 1 行の文字列にする */
export function describeRecorderStatus(s: FlightRecorderStatus, now: number): string {
  const last =
    s.lastOutcome === null
      ? "未送信"
      : `${s.lastOutcome}${s.lastStatus === null ? "（通信失敗）" : `（${s.lastStatus}）`}`;
  const okAgo = s.lastOkAt === null ? "-" : `${((now - s.lastOkAt) / 1000).toFixed(1)} 秒前`;
  const mb = (s.retainedBytes / (1024 * 1024)).toFixed(2);
  const parts = [
    `セッション ${s.sessionId}`,
    `送信済み ${s.sent} 件`,
    `保留 ${s.pending} 件`,
    `最終送信 ${last}`,
    `最終成功 ${okAgo}`,
    `保持 ${s.retained} 件（${mb} MB）`,
  ];
  if (s.rejected > 0) parts.push(`拒否 ${s.rejected} 件`);
  if (s.dropped > 0) parts.push(`上限で破棄 ${s.dropped} 件（未送信 ${s.droppedUnsent}）`);
  return parts.join(" / ");
}
