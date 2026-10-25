// ゴーグルでの確認ページのキャリブレーションの手順（URL パラメータ・手順の定義・しきい値の重ね方・表示の文字列）．
// DOM に依存しない純粋な関数（殻は gogglesPage.ts）．値の計算は body/calibration.ts の calibrateParams
import type { CalibrationSegmentKind } from "../../core/types";
import type { CalibrationMeasurements, CalibrationResult } from "../body/calibration";
import { standWalkBoundary } from "../body/posture";
import type { InputParamKey } from "../params";
import type { ProtocolStep } from "../recorder/protocolSchedule";
import { type CalibrationLengths, DEFAULT_CALIBRATION_LENGTHS } from "../replay/calibrationReplay";

/** キャリブレーションの設定（URL パラメータから読む） */
export interface GogglesCalibrationOptions {
  /** キャリブレーションをするか（?calib=0 でしない） */
  readonly enabled: boolean;
  /** 開始をタップしてから最初の区間の準備に入るまでの待ち時間（ms．スマホをゴーグルに入れて装着する間．0 で待たない） */
  readonly startDelayMs: number;
  /** 区間ごとの前の準備の時間（ms．案内の読み上げと 3・2・1 の合図） */
  readonly prepMs: number;
  /** 区間の長さ（ms） */
  readonly lengths: CalibrationLengths;
  /** 終わった後，立ち上がって正面を向くまでの時間（ms）．この後に求めた値で判定を始める */
  readonly finishMs: number;
}

/** 開始の後の待ち時間の既定値（ms．画面の中央で 10 からカウントダウンする） */
export const DEFAULT_CALIBRATION_START_DELAY_MS = 10000;
/** 準備の時間の既定値（ms）．指示の読み上げ（2〜3 秒）と 3・2・1 の合図が入る長さ */
export const DEFAULT_CALIBRATION_PREP_MS = 3000;
/** 終わった後に立ち上がるまでの時間の既定値（ms） */
export const DEFAULT_CALIBRATION_FINISH_MS = 3000;
/** URL で指定できる長さの上限（ms．打ち間違いで終わらなくならないように） */
const MAX_LENGTH_MS = 60000;

/** 0 より大きく上限以下の数なら ms として使い，それ以外は fallback */
function msOf(query: URLSearchParams, key: string, fallback: number, allowZero = false): number {
  const raw = query.get(key);
  if (raw === null || raw.trim() === "") return fallback;
  const v = Number(raw);
  const ok = Number.isFinite(v) && (allowZero ? v >= 0 : v > 0) && v <= MAX_LENGTH_MS;
  return ok ? Math.round(v) : fallback;
}

/**
 * URL パラメータからキャリブレーションの設定を読む．
 * ?calib=0 でしない．?calibStandMs・calibStepMs・calibCrouchMs・calibCrouchWalkMs で区間の長さ（ms），
 * ?calibStartDelayMs で開始の後の待ち時間（ms．0 も可），?calibPrepMs で準備の時間（ms．0 も可），?calibFinishMs で終わった後の時間（ms．0 も可）．不正な値は既定値
 */
export function gogglesCalibrationFromSearch(search: string): GogglesCalibrationOptions {
  const q = new URLSearchParams(search);
  const d = DEFAULT_CALIBRATION_LENGTHS;
  return {
    enabled: q.get("calib") !== "0",
    startDelayMs: msOf(q, "calibStartDelayMs", DEFAULT_CALIBRATION_START_DELAY_MS, true),
    prepMs: msOf(q, "calibPrepMs", DEFAULT_CALIBRATION_PREP_MS, true),
    finishMs: msOf(q, "calibFinishMs", DEFAULT_CALIBRATION_FINISH_MS, true),
    lengths: {
      standingMs: msOf(q, "calibStandMs", d.standingMs),
      steppingMs: msOf(q, "calibStepMs", d.steppingMs),
      crouchingMs: msOf(q, "calibCrouchMs", d.crouchingMs),
      crouchWalkingMs: msOf(q, "calibCrouchWalkMs", d.crouchWalkingMs),
    },
  };
}

/** 区間ごとの表示と案内（区間は立って静止 → 足踏み → しゃがむ → しゃがみ歩きの順） */
export const CALIBRATION_STEP_TEXT: Readonly<
  Record<CalibrationSegmentKind, { readonly title: string; readonly instruction: string }>
> = {
  standing: { title: "立って静止", instruction: "立ったまま動かずにいてください" },
  stepping: { title: "足踏み", instruction: "その場で足踏みをしてください" },
  crouching: {
    title: "しゃがむ",
    instruction: "立って待ち，合図でしゃがんで動かない",
  },
  crouchWalking: {
    title: "しゃがみ歩き",
    instruction: "しゃがんだまま，その場で足踏みをしてください",
  },
};

/** 開始の後のカウントダウンの添え書き（視界の中央の板に数字と一緒に出す） */
export const CALIBRATION_COUNTDOWN_TEXT = "ゴーグルを付けてください";

const STEP_ORDER: readonly [CalibrationSegmentKind, keyof CalibrationLengths][] = [
  ["standing", "standingMs"],
  ["stepping", "steppingMs"],
  ["crouching", "crouchingMs"],
  ["crouchWalking", "crouchWalkingMs"],
];

/** 手順の並び（protocolSchedule の buildSchedule に渡す．label は CalibrationSegmentKind） */
export function calibrationProtocolSteps(lengths: CalibrationLengths): ProtocolStep[] {
  return STEP_ORDER.map(([kind, key]) => ({
    label: kind,
    title: CALIBRATION_STEP_TEXT[kind].title,
    instruction: CALIBRATION_STEP_TEXT[kind].instruction,
    durationSec: lengths[key] / 1000,
  }));
}

/** 手順のラベルが CalibrationSegmentKind か */
export function isCalibrationKind(label: string): label is CalibrationSegmentKind {
  return Object.hasOwn(CALIBRATION_STEP_TEXT, label);
}

/**
 * 判定に渡す上書き．順序は「既定値 → キャリブレーションで求めた値 → URL のしきい値」で，URL で指定した項目は
 * キャリブレーションの値より優先する（同じ設定を QR コードで配って比べられるように）
 */
export function calibratedOverrides(
  calibration: Partial<Record<InputParamKey, number>>,
  url: Partial<Record<InputParamKey, number>>,
): Partial<Record<InputParamKey, number>> {
  return { ...calibration, ...url };
}

function n(v: number | null | undefined, digits: number): string {
  return v === null || v === undefined || !Number.isFinite(v) ? "-" : v.toFixed(digits);
}

/** 測った値の 1 行（視界の板に出す） */
export function describeMeasurements(m: CalibrationMeasurements): string {
  return `静止 ${n(m.restNoiseAccel, 2)}  山 ${n(m.stepPeakStanding, 2)}(${m.stepCountStanding})  深さ ${n(m.crouchDepth, 2)}m  しゃがみ山 ${n(m.stepPeakCrouching, 2)}(${m.stepCountCrouching})${m.crouchingEstimated ? "見積" : ""}`;
}

/** 判定に使うしきい値の 1 行（視界の板に出す．URL の上書きを重ねた後の値） */
export function describeCalibratedParams(
  params: Readonly<Record<InputParamKey, number>>,
  result: CalibrationResult | null,
): string {
  const mark = (key: InputParamKey) => (result !== null && key in result.overrides ? "*" : "");
  const item = (label: string, key: InputParamKey, digits: number) =>
    `${label}${mark(key)} ${n(params[key], digits)}`;
  return [
    item("T立", "stepHighStanding", 2),
    item("Tし", "stepHighCrouching", 2),
    item("深", "crouchDepthM", 2),
    item("zupt", "zuptAccel", 2),
    // しゃがみ歩きから止まらずに立つ判定の境目（使わない時は -）
    `境${mark("standWalkPeakCrouching")} ${n(standWalkBoundary(params), 2)}`,
  ].join("  ");
}
