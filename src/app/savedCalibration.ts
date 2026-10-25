// ロビーで求めた判定のしきい値（calibrateParams() の上書き）を端末の localStorage に保存し，デモ用の起動（?app&demo）で読み戻す．
// 文字列との変換・検証は純粋な関数，localStorage の読み書きは例外を外へ出さない薄い殻に分ける

import { INPUT_PARAM_KEYS, type InputParamKey } from "../input/params";

/** 保存に使う localStorage のキー（形が変わったら v を上げる） */
export const SAVED_CALIBRATION_KEY = "tkb2608.calibrationParams.v1";

/** 保存するしきい値の上書き（項目名 → 値） */
export type SavedCalibrationOverrides = Partial<Record<InputParamKey, number>>;

/** localStorage のうち使う所だけ（テストで差し替えるため） */
export interface CalibrationStorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

const KNOWN_KEYS: ReadonlySet<string> = new Set<string>(INPUT_PARAM_KEYS);

/** 上書きを保存用の文字列にする（有限の数で，知っている項目だけを残す） */
export function serializeCalibrationOverrides(overrides: SavedCalibrationOverrides): string {
  return JSON.stringify(sanitizeCalibrationOverrides(overrides) ?? {});
}

/**
 * 保存した文字列を上書きに戻す．JSON でない・オブジェクトでない時は null．
 * 数でない・有限でない値と知らない項目は捨てる（残りが空なら空のオブジェクト）
 */
export function parseCalibrationOverrides(text: string | null): SavedCalibrationOverrides | null {
  if (text === null) return null;
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    return null;
  }
  return sanitizeCalibrationOverrides(value);
}

function sanitizeCalibrationOverrides(value: unknown): SavedCalibrationOverrides | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return null;
  const out: SavedCalibrationOverrides = {};
  for (const [key, v] of Object.entries(value)) {
    if (!KNOWN_KEYS.has(key)) continue;
    if (typeof v !== "number" || !Number.isFinite(v)) continue;
    out[key as InputParamKey] = v;
  }
  return out;
}

/** ブラウザの localStorage．使えない（プライベートブラウズ・設定で禁止等で例外になる）時は null */
export function browserCalibrationStorage(): CalibrationStorageLike | null {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

/** しきい値を保存する．保存できなくても（容量・禁止）例外は投げない */
export function saveCalibrationOverrides(
  storage: CalibrationStorageLike | null,
  overrides: SavedCalibrationOverrides,
): void {
  if (storage === null) return;
  try {
    storage.setItem(SAVED_CALIBRATION_KEY, serializeCalibrationOverrides(overrides));
  } catch {
    // 保存できない端末では，デモの起動が既定値で進むだけ
  }
}

/** 保存したしきい値を読む．無い・読めない時は null．例外は投げない */
export function loadCalibrationOverrides(
  storage: CalibrationStorageLike | null,
): SavedCalibrationOverrides | null {
  if (storage === null) return null;
  try {
    return parseCalibrationOverrides(storage.getItem(SAVED_CALIBRATION_KEY));
  } catch {
    return null;
  }
}

/** ?debug の表示用．デモの起動で読み込んだしきい値（null は保存が無い・読めない） */
export function describeSavedCalibration(overrides: SavedCalibrationOverrides | null): string {
  if (overrides === null) return "calibration: 保存なし（既定値のまま．デモの起動）";
  const keys = Object.keys(overrides) as InputParamKey[];
  const body =
    keys.length === 0
      ? "なし（既定値のまま）"
      : keys.map((k) => `${k}=${(overrides[k] ?? 0).toFixed(2)}`).join(" ");
  return `calibration: 保存した値を使用（デモの起動）\noverrides: ${body}`;
}
