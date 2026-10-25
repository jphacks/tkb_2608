// 見守り画面に何を描き，どの案内を出し，縁を赤くするかを決める（SPEC_01「見守り」の「見守り画面」の表と「切れた時」・「赤い表示」）．
// 判定は sim/ の detectErrorBehaviors を生徒の画面と同じ定義で使う．DOM・three.js には触れない
import type { DrillSample } from "../core/drill";
import type { SchoolPlan } from "../core/schoolPlan";
import { detectErrorBehaviors } from "../sim/errorBehavior";
import type { SpreadMap } from "../sim/spread";
import type { MonitorFrame } from "./monitorSession";
import type { MonitorPose } from "./stateBuffer";

/** 中継との接続の様子．retrying は切れた・つながらなかったのでつなぎ直している間 */
export type RelayStatus = "connecting" | "open" | "retrying";

/** 案内の文 */
export const MONITOR_MESSAGES = {
  waiting: "体験者の接続を待っています",
  preparing: "体験者は準備中です",
  ended: "避難が終わりました",
  stalled: "電波が途切れています",
  relayDown: "中継につながりません．つなぎ直しています",
  mismatch: "見守り画面と違う校舎で始めています．同じ p= の URL で開いてください",
  noRoom: "URL に room= を付けて開いてください",
  noRelay: "中継の住所が設定されていません",
} as const;

/**
 * 描くもの．
 * - blank: 校舎を描かない（接続待ち・違う校舎）
 * - start: 開始地点から開始の向きで描く（火と煙は出さない）
 * - pose: 届いた姿勢で描く
 * - lobby: ロビーの部屋と板を，届いた姿勢（無ければ正面）で描く
 * - result: 届いた記録の結果画面を出す（3D は描かない）
 */
export type MonitorDrawKind = "blank" | "start" | "pose" | "lobby" | "result";

/** 1 フレーム分の見せ方 */
export interface MonitorDisplay {
  readonly draw: MonitorDrawKind;
  /** 画面の真ん中に出す案内（出さなければ null） */
  readonly message: string | null;
}

/**
 * 画面の状態と中継との接続から見せ方を決める．
 * 中継とつながらない間の案内を最優先にし，違う校舎の時は描かない．体験中は文字を出さない（途切れた時だけ出す）
 */
export function resolveMonitorDisplay(frame: MonitorFrame, relay: RelayStatus): MonitorDisplay {
  const { draw, message } = baseDisplay(frame);
  return relay === "retrying" ? { draw, message: MONITOR_MESSAGES.relayDown } : { draw, message };
}

function baseDisplay(frame: MonitorFrame): MonitorDisplay {
  if (frame.mismatch) return { draw: "blank", message: MONITOR_MESSAGES.mismatch };
  const poseOrStart: MonitorDrawKind = frame.pose === null ? "start" : "pose";
  switch (frame.screen) {
    case "waiting":
      return { draw: "blank", message: MONITOR_MESSAGES.waiting };
    case "preparing":
      // ロビーの板が届くまで（ホームの間）は開始地点の校舎と案内を出す
      return (frame.lobby ?? null) === null
        ? { draw: "start", message: MONITOR_MESSAGES.preparing }
        : { draw: "lobby", message: null };
    case "live":
      return { draw: poseOrStart, message: frame.stalled ? MONITOR_MESSAGES.stalled : null };
    case "ended":
      // 記録がそろうまでは最後の目線で止めて案内を出す
      return (frame.track ?? null) === null
        ? { draw: poseOrStart, message: MONITOR_MESSAGES.ended }
        : { draw: "result", message: null };
  }
}

/** 赤い表示の判定に渡す記録の 1 件（毎フレーム作らずに使い回す） */
const sampleScratch: {
  t: number;
  floor: number;
  x: number;
  z: number;
  posture: DrillSample["posture"];
} = { t: 0, floor: 0, x: 0, z: 0, posture: "standing" };

/**
 * 縁を赤くするか．届いた姿勢を描いている時だけ，その姿勢を DrillSample の形にして detectErrorBehaviors に渡す．
 * t が負（非常ベルの前）・有限でない時は赤くしない．止めている間（途切れ・終わり）は止めた姿勢で求めるので最後の表示のままになる
 */
export function isMonitorAlert(
  plan: SchoolPlan,
  spread: SpreadMap,
  display: MonitorDisplay,
  pose: MonitorPose | null,
): boolean {
  if (display.draw !== "pose" || pose === null) return false;
  if (!Number.isFinite(pose.t) || pose.t < 0) return false;
  sampleScratch.t = pose.t;
  sampleScratch.floor = pose.floor;
  sampleScratch.x = pose.x;
  sampleScratch.z = pose.z;
  sampleScratch.posture = pose.posture;
  return detectErrorBehaviors(plan, spread, sampleScratch).any;
}
