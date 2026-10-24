// dev ページのしきい値のスライダー．params の項目ごとに範囲を決め，変えたらすぐ判定に反映する
import type { InputParamKey, InputParams } from "../params";

export interface ParamSliderSpec {
  readonly key: InputParamKey;
  readonly label: string;
  readonly min: number;
  readonly max: number;
  readonly step: number;
}

/** スライダーを出す項目（よく調整するものだけ．他は URL パラメータで変える） */
export const PARAM_SLIDERS: readonly ParamSliderSpec[] = [
  { key: "headPredictionMs", label: "頭の先読み（ms）", min: 0, max: 60, step: 5 },
  { key: "stepHighStanding", label: "立ち T_high（m/s²）", min: 0.2, max: 4, step: 0.05 },
  { key: "stepLowStanding", label: "立ち T_low（m/s²）", min: 0, max: 2, step: 0.05 },
  { key: "stepHighCrouching", label: "しゃがみ T_high（m/s²）", min: 0.1, max: 3, step: 0.05 },
  { key: "stepLowCrouching", label: "しゃがみ T_low（m/s²）", min: 0, max: 1.5, step: 0.05 },
  { key: "stepNoiseFactor", label: "T_high ≥ ノイズ ×", min: 0, max: 8, step: 0.5 },
  { key: "stepRefractoryMs", label: "不応期（ms）", min: 100, max: 500, step: 10 },
  { key: "stepGyroRejectDps", label: "頭の回転で除外（deg/s）", min: 10, max: 400, step: 5 },
  { key: "stepGyroRelaxWalking", label: "歩く間の除外の倍率", min: 1, max: 3, step: 0.1 },
  { key: "tentativeWalkSpeed", label: "仮に歩く速さ（m/s）", min: 0, max: 1, step: 0.05 },
  { key: "strideM", label: "1 歩の距離（m）", min: 0.2, max: 1, step: 0.05 },
  { key: "postureCandidateAccel", label: "動作の候補（m/s²）", min: 0.2, max: 3, step: 0.05 },
  { key: "postureCandidateMs", label: "候補の継続（ms）", min: 20, max: 300, step: 10 },
  { key: "postureRestBeforeMs", label: "動作の前の静止（ms）", min: 0, max: 500, step: 10 },
  { key: "zuptAccel", label: "ZUPT 加速度（m/s²）", min: 0.05, max: 1.5, step: 0.05 },
  { key: "zuptGyroDps", label: "ZUPT 角速度（deg/s）", min: 5, max: 100, step: 5 },
  { key: "zuptMaxVelocity", label: "ZUPT 速度（m/s）", min: 0.05, max: 1, step: 0.05 },
  { key: "zuptMs", label: "ZUPT 継続（ms）", min: 50, max: 500, step: 10 },
  { key: "crouchDepthM", label: "しゃがみの深さ（m）", min: 0.1, max: 0.8, step: 0.02 },
  { key: "postureConfirmRatio", label: "確定の割合", min: 0.2, max: 1, step: 0.05 },
  { key: "standEscapeSteps", label: "逃げ道の歩数（0 で無効）", min: 0, max: 10, step: 1 },
];

/**
 * スライダーを container に作る．変えた時に onChange（項目と値）を呼ぶ．
 * 戻り値の関数で今の params に合わせて表示を直す
 */
export function buildParamSliders(
  container: HTMLElement,
  initial: InputParams,
  onChange: (key: InputParamKey, value: number) => void,
): (params: InputParams) => void {
  const inputs = new Map<InputParamKey, { input: HTMLInputElement; out: HTMLElement }>();
  for (const spec of PARAM_SLIDERS) {
    const row = document.createElement("label");
    row.className = "slider";
    const name = document.createElement("span");
    name.textContent = spec.label;
    const input = document.createElement("input");
    input.type = "range";
    input.min = String(spec.min);
    input.max = String(spec.max);
    input.step = String(spec.step);
    input.value = String(initial[spec.key]);
    const out = document.createElement("output");
    out.textContent = String(initial[spec.key]);
    input.addEventListener("input", () => {
      const v = Number(input.value);
      if (!Number.isFinite(v)) return;
      out.textContent = input.value;
      onChange(spec.key, v);
    });
    row.append(name, input, out);
    container.append(row);
    inputs.set(spec.key, { input, out });
  }
  return (params) => {
    for (const [key, { input, out }] of inputs) {
      input.value = String(params[key]);
      out.textContent = String(params[key]);
    }
  };
}
