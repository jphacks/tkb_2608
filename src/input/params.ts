// 判定のしきい値（params）．すべて外から渡せるようにし，dev ページのスライダーや記録の再生で変えて比べる
// （experiment_山﨑/02「純粋な関数と薄い殻」）．
// 既定値は記録がまだ無いための**仮の値**．Day 1 の記録（experiment_山﨑/11）から決め直す
import type { CalibrationProfile } from "../core/types";

/** 判定のしきい値の全体．単位は項目名の末尾（Ms: ms，Hz，Dps: deg/s，M: m 等）か各コメントのとおり */
export interface InputParams {
  // ---- 頭の向き（experiment_山﨑/03） ----
  /** ジャイロで先読みする時間（ms）．0 で先読みしない */
  readonly headPredictionMs: number;
  /** これより遅い回転（deg/s）では先読みしない（止めた時の震えを増やさない） */
  readonly headPredictionMinDps: number;
  /** 角速度のサンプルがこれより古い（ms）時は先読みしない */
  readonly headPredictionMaxAgeMs: number;

  // ---- 足踏み: 前処理（experiment_山﨑/04 ①②） ----
  /** 重力の向きを求める低域通過の遮断周波数（Hz） */
  readonly gravityCutoffHz: number;
  /** 帯域通過の下端（高域通過の遮断周波数．Hz） */
  readonly stepBandLowHz: number;
  /** 帯域通過の上端（低域通過の遮断周波数．Hz） */
  readonly stepBandHighHz: number;

  // ---- 足踏み: ピーク検出（③④） ----
  /** 立っている時の上のしきい値 T_high（帯域通過後の上下の加速度．m/s^2） */
  readonly stepHighStanding: number;
  /** 立っている時の下のしきい値 T_low（m/s^2） */
  readonly stepLowStanding: number;
  /** しゃがんでいる時の T_high（しゃがみ歩きは揺れが小さい．m/s^2） */
  readonly stepHighCrouching: number;
  /** しゃがんでいる時の T_low（m/s^2） */
  readonly stepLowCrouching: number;
  /** T_high を静止時のノイズ（RMS）の何倍以上にするか */
  readonly stepNoiseFactor: number;
  /** 1 歩を数えた後，次を数えない時間（ms） */
  readonly stepRefractoryMs: number;
  /** 山の前後でこれより速い頭の回転（deg/s）があれば，その山は数えない */
  readonly stepGyroRejectDps: number;
  /**
   * 仮に歩く・歩くの間は，除外のしきい値を stepGyroRejectDps のこの倍にする（足踏みの振動で頭も揺れるため）．
   * 止まっている状態からの 1 歩目は緩めない
   */
  readonly stepGyroRelaxWalking: number;
  /** 頭の回転を見る山の前の範囲（ms） */
  readonly stepGyroWindowMs: number;

  // ---- 足踏み: 状態機械と速さ（⑤⑥） ----
  /** 仮に歩く → 歩くとみなす 2 歩目の間隔の下限（ms） */
  readonly stepMinIntervalMs: number;
  /** 仮に歩いてから，この時間（ms）に 2 歩目が無ければ止まる */
  readonly stepTentativeTimeoutMs: number;
  /** 直近の周期の何倍の間に山が無ければ止まるか */
  readonly stepStopPeriodFactor: number;
  /** 止まるまでの待ちの上限（ms） */
  readonly stepStopMaxMs: number;
  /** 1 歩あたりに進む距離（m）．1 秒に 2 歩で 1.0 m/s */
  readonly strideM: number;
  /** 速さの上限（m/s） */
  readonly maxWalkSpeed: number;
  /** 仮に歩く時の速さ（m/s．本来の約 40%） */
  readonly tentativeWalkSpeed: number;
  /** 速さのバネの固有角振動数（rad/s．臨界減衰） */
  readonly speedSpringOmega: number;
  /** 加速の上限（m/s^2） */
  readonly speedMaxAccel: number;
  /** 減速の上限（m/s^2．止まる時は少し速めに止める） */
  readonly speedMaxDecel: number;

  // ---- しゃがみ・立ち上がり（experiment_山﨑/05） ----
  /** 動作の候補とみなす上下の加速度の大きさ（m/s^2．帯域通過はしない値） */
  readonly postureCandidateAccel: number;
  /** 候補のしきい値を静止時のノイズ（RMS）の何倍以上にするか */
  readonly postureNoiseFactor: number;
  /** 同じ向きの加速度がこの時間（ms）続いたら動作の候補とする */
  readonly postureCandidateMs: number;
  /**
   * 静止（ZUPT と同じ条件）がこの時間（ms）続いた後でなければ動作の候補にしない．0 で無効．
   * 積分は速度 0 から始めるため，足踏みの途中（速度が 0 でない）から積分すると高さがずれていく．
   * そのため歩いている間はしゃがみ・立ち上がりを確定せず，止まってからの動作だけを見る
   */
  readonly postureRestBeforeMs: number;
  /** 積分を続ける最長の時間（ms）．超えたら確定せずに捨てる */
  readonly postureMaxIntegrateMs: number;
  /** ZUPT: 静止とみなす加速度の大きさ（m/s^2） */
  readonly zuptAccel: number;
  /** ZUPT: 静止とみなす角速度の大きさ（deg/s） */
  readonly zuptGyroDps: number;
  /** ZUPT: 積分中の速度がこれより小さい時だけ静止とみなす（m/s．等速で動く途中を静止と取り違えない） */
  readonly zuptMaxVelocity: number;
  /** ZUPT: 静止がこの時間（ms）続いたら動作の終わりとする */
  readonly zuptMs: number;
  /** しゃがみの深さ（m）．CalibrationProfile.crouchThreshold があればそれを使う */
  readonly crouchDepthM: number;
  /** 沈んだ量がしゃがみの深さの何割を超えたら姿勢を切り替えるか */
  readonly postureConfirmRatio: number;
  /** 積分中の高さの変化がこれ（m）を超えている間は，足踏みの山を数えない（しゃがむ動作の山を歩きと取り違えない） */
  readonly postureStepSuppressM: number;
  /** 高さが大きく変わった動作が終わってから，この時間（ms）は足踏みの山を数えない（帯域通過の遅れと揺れの残り） */
  readonly postureStepSuppressAfterMs: number;
  /** 逃げ道（案 A）: しゃがんだまま，立っている時の大きさの足踏みがこの歩数続いたら立ったとみなす．0 で無効 */
  readonly standEscapeSteps: number;

  // ---- フェイルセーフ（experiment_山﨑/09） ----
  /** 最後のサンプルからこの時間（ms）届かなければ walking を false にする */
  readonly sensorTimeoutMs: number;
  /** サンプルの間隔がこれ（ms）を超えたらフィルタを初期化する */
  readonly maxSampleGapMs: number;
}

/** 既定値（仮．記録が無いため，資料の目安の値をそのまま置いている） */
export const DEFAULT_INPUT_PARAMS: InputParams = {
  headPredictionMs: 30,
  headPredictionMinDps: 5,
  headPredictionMaxAgeMs: 100,

  gravityCutoffHz: 0.3,
  stepBandLowHz: 1.0,
  stepBandHighHz: 3.0,

  // 立ちの T_high は 1.2 だと弱い足踏み（山 1.0〜1.5）を取りこぼし，1.0 だと首振りの誤検出が増えたため 1.1
  // （logs/input/20261024-143537_o0qich1i・143118_keucfuvm・142810_ag8vpdil を流し直して比べた）
  stepHighStanding: 1.1,
  stepLowStanding: 0.35,
  stepHighCrouching: 0.7,
  stepLowCrouching: 0.25,
  stepNoiseFactor: 3,
  stepRefractoryMs: 250,
  // 足踏みの山の前の角速度は 50〜92 deg/s，首振りは 110 以上（20261024-143537_o0qich1i．ラベル無しの推測）．
  // 60 では足踏みを除外しすぎ（143118_keucfuvm），150 × 歩く間 1.5 倍では首振りが通った（143537）ため 110・緩めない
  stepGyroRejectDps: 110,
  stepGyroRelaxWalking: 1.0,
  stepGyroWindowMs: 200,

  stepMinIntervalMs: 300,
  stepTentativeTimeoutMs: 1000,
  // 1 歩見逃しても途切れないよう，周期の 2 倍（最長 1.3 秒）まで待つ（仮に歩く時の 1.0 秒はそのまま）
  stepStopPeriodFactor: 2.0,
  stepStopMaxMs: 1300,
  strideM: 0.5,
  maxWalkSpeed: 1.4,
  tentativeWalkSpeed: 0.4,
  speedSpringOmega: 8,
  speedMaxAccel: 2,
  speedMaxDecel: 4,

  postureCandidateAccel: 0.8,
  postureNoiseFactor: 4,
  postureCandidateMs: 100,
  postureRestBeforeMs: 150,
  postureMaxIntegrateMs: 1500,
  zuptAccel: 0.35,
  zuptGyroDps: 25,
  zuptMaxVelocity: 0.25,
  zuptMs: 150,
  crouchDepthM: 0.4,
  postureConfirmRatio: 0.5,
  postureStepSuppressM: 0.08,
  postureStepSuppressAfterMs: 500,
  standEscapeSteps: 4,

  sensorTimeoutMs: 300,
  maxSampleGapMs: 200,
};

export type InputParamKey = keyof InputParams;

/** params の項目名の一覧（dev ページ・URL パラメータ用） */
export const INPUT_PARAM_KEYS = Object.keys(DEFAULT_INPUT_PARAMS) as InputParamKey[];

function isParamKey(key: string): key is InputParamKey {
  return Object.hasOwn(DEFAULT_INPUT_PARAMS, key);
}

/**
 * 既定値に上書きを重ねる．有限の数でない値・知らない項目は無視する（例外を投げない）
 */
export function mergeParams(
  base: InputParams,
  overrides: Readonly<Record<string, unknown>> | null | undefined,
): InputParams {
  if (overrides == null) return base;
  const out: Record<string, number> = { ...base };
  for (const [key, value] of Object.entries(overrides)) {
    if (isParamKey(key) && typeof value === "number" && Number.isFinite(value)) out[key] = value;
  }
  return out as unknown as InputParams;
}

/** 値が範囲内の有限の数か */
function inRange(v: unknown, min: number, max: number): v is number {
  return typeof v === "number" && Number.isFinite(v) && v >= min && v <= max;
}

/**
 * CalibrationProfile の値をしきい値に反映する．null・範囲外の項目は既定のまま（experiment_山﨑/09）．
 * - stepPeakThreshold（m/s^2）→ 立っている時の T_high．T_low としゃがんでいる時の値は既定の比で決める
 * - crouchThreshold → しゃがみの深さ（m）として扱う（0.1〜1.0 m の時だけ）
 * - standingBaseline は今の判定では使わない
 * yawOffset は頭の向きの側で使う（ここでは扱わない）
 */
export function paramsFromCalibration(
  base: InputParams,
  calibration: CalibrationProfile | null | undefined,
): InputParams {
  if (calibration == null) return base;
  let p = base;
  if (inRange(calibration.stepPeakThreshold, 0.2, 10)) {
    const scale = calibration.stepPeakThreshold / base.stepHighStanding;
    p = {
      ...p,
      stepHighStanding: calibration.stepPeakThreshold,
      stepLowStanding: base.stepLowStanding * scale,
      stepHighCrouching: base.stepHighCrouching * scale,
      stepLowCrouching: base.stepLowCrouching * scale,
    };
  }
  if (inRange(calibration.crouchThreshold, 0.1, 1.0)) {
    p = { ...p, crouchDepthM: calibration.crouchThreshold };
  }
  return p;
}

/**
 * URL パラメータからしきい値の上書きを読む（例: ?stepHighStanding=1.5&headPredictionMs=20）．
 * 同じ設定を QR コードで他の端末に配れるようにする（experiment_山﨑/10）．数でない値は無視する
 */
export function paramsFromSearch(search: string): Partial<Record<InputParamKey, number>> {
  const out: Partial<Record<InputParamKey, number>> = {};
  const query = new URLSearchParams(search);
  for (const key of INPUT_PARAM_KEYS) {
    const raw = query.get(key);
    if (raw === null || raw.trim() === "") continue;
    const v = Number(raw);
    if (Number.isFinite(v)) out[key] = v;
  }
  return out;
}
