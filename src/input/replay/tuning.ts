// 再生と調整のページで決めたしきい値の書き出しと，切り出しのファイル名（DOM に依存しない純粋な関数）
import { INPUT_PARAM_KEYS, type InputParamKey, type InputParams } from "../params";

/** base と違う項目だけを返す（書き出し・URL パラメータ用）．両方とも有限でない値の項目は飛ばす */
export function paramsDiff(
  base: InputParams,
  current: InputParams,
): Partial<Record<InputParamKey, number>> {
  const out: Partial<Record<InputParamKey, number>> = {};
  for (const key of INPUT_PARAM_KEYS) {
    const v = current[key];
    if (Number.isFinite(v) && v !== base[key]) out[key] = v;
  }
  return out;
}

/** 書き出す JSON（変えた項目と全体）．src/input/params.ts の既定値に写す時に使う */
export function paramsExportJson(base: InputParams, current: InputParams): string {
  const all: Record<string, number> = {};
  for (const key of INPUT_PARAM_KEYS) all[key] = current[key];
  return JSON.stringify({ changed: paramsDiff(base, current), params: all }, null, 2);
}

/** 変えた項目を URL パラメータにする（例: "?stepHighStanding=1.3"．同じ設定を QR コードで端末に配る）．無ければ空文字列 */
export function paramsSearchOf(diff: Partial<Record<InputParamKey, number>>): string {
  const q = new URLSearchParams();
  for (const key of INPUT_PARAM_KEYS) {
    const v = diff[key];
    if (v !== undefined && Number.isFinite(v)) q.set(key, String(v));
  }
  const s = q.toString();
  return s === "" ? "" : `?${s}`;
}

/**
 * 切り出しのファイル名（<元の名前>_<始まり>-<終わり>ms.jsonl）．時刻は整数の ms に丸める．
 * 元の名前の .jsonl は外し，英数字・ハイフン・アンダースコア以外は "-" にする（fixtures/ にそのまま置けるように）
 */
export function clipFileName(sourceName: string, fromT: number, toT: number): string {
  const stem = sourceName.replace(/\.jsonl$/i, "").replace(/[^A-Za-z0-9_-]/g, "-") || "record";
  const a = Number.isFinite(fromT) ? Math.round(fromT) : 0;
  const b = Number.isFinite(toT) ? Math.round(toT) : 0;
  return `${stem}_${a}-${b}ms.jsonl`;
}
