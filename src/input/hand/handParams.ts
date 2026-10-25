// 手の認識・なめらかさ・形の判定のしきい値（experiment_山﨑/07）．足踏み等の InputParams とは分けて持つ．
// 既定値は実機の記録がまだ無いための**仮の値**．hands.html（dev ページ）の表示と記録から決め直す

/** 手のしきい値の全体．単位は項目名の末尾（Ms: ms，Hz，M: m，Deg: 度）か各コメントのとおり */
export interface HandParams {
  // ---- 2D → 3D（背面カメラ） ----
  /** 背面カメラの横の画角（度）．端末により違う（iPhone の広角の 4:3 で約 65〜68°） */
  readonly cameraHfovDeg: number;
  /** 手首から中指の付け根までの実際の長さ（m）．大人でおおよそ 0.09〜0.10 */
  readonly palmLengthM: number;
  /** 奥行きの下限・上限（m）．見積もりの外れ値で手が飛ばないようにする */
  readonly minDepthM: number;
  readonly maxDepthM: number;
  /** 目から見たカメラの位置（m．頭の座標系．x: 右，y: 上，z: 後ろが正）．ゴーグルの中でカメラは目より前にある */
  readonly cameraOffsetXM: number;
  readonly cameraOffsetYM: number;
  readonly cameraOffsetZM: number;
  /**
   * 描く用の 21 点を置く固定の奥行き（m）．手のひらの位置（開始ボタンの判定に使う）とは別に，
   * 奥行きを見積もらずにこの距離に置く（見積もりの揺れで描いた手が跳ねないようにする．rintoHasegawa/VRtest に倣う）
   */
  readonly skeletonDepthM: number;
  /** 描く用の 21 点の奥行きに MediaPipe の相対の z を足す倍率（奥行き = skeletonDepthM × (1 + z × この値)） */
  readonly skeletonDepthScale: number;

  // ---- なめらかさ（One Euro フィルタ＋外挿） ----
  /** 止めた時の遮断周波数（Hz）．小さいほど強く平滑化する */
  readonly oneEuroMinCutoffHz: number;
  /** 速さ（m/s）に応じて遮断周波数を上げる度合い（Hz/(m/s)） */
  readonly oneEuroBeta: number;
  /** 速さの見積もりの遮断周波数（Hz） */
  readonly oneEuroDCutoffHz: number;
  /** 外挿する時間の上限（ms）．認識 1 回分程度 */
  readonly extrapolateMaxMs: number;
  /** 外挿の速さが弱まる時定数（ms）．急に止めた手の行き過ぎを抑える */
  readonly extrapolateDecayMs: number;
  /** 外挿に使う速さの上限（m/s） */
  readonly extrapolateMaxSpeed: number;

  // ---- 認識の有無の安定化 ----
  /** この回数続けて認識したら tracked にする */
  readonly trackAppearCount: number;
  /** 見失ってからこの時間（ms）続けて認識できなければ tracked を外す */
  readonly trackLostMs: number;
  /** 握ったまま見失った時に，握ったまま（tracked のまま）とみなす時間（ms） */
  readonly gripHoldMs: number;
  /**
   * 描く 21 点を，見えなかった認識が続いてもこの時間（ms．映像の時刻）までは出し続ける．過ぎたら landmarks を省き，
   * 描く側が薄くして消す（tracked・position・grip は trackLostMs で決める）
   */
  readonly skeletonHoldMs: number;

  // ---- 手の形 ----
  /** 指の先と手のひらの中心の距離（手の大きさで割った値）がこれ以上なら伸びている（曲がり 0） */
  readonly fingerOpenRatio: number;
  /** これ以下なら曲がりきっている（曲がり 1） */
  readonly fingerClosedRatio: number;
  /** 握ったとみなす握り具合（これを超えたら握った） */
  readonly gripOn: number;
  /** 開いたとみなす握り具合（これを下回ったら開いた） */
  readonly gripOff: number;
  /** 親指と人差し指の先の距離（手の大きさで割った値）がこれより小さければつまんだ */
  readonly pinchOnRatio: number;
  /** これより大きければつまむのをやめた（pinchOnRatio より大きくする） */
  readonly pinchOffRatio: number;
  /** 指を差す: 人差し指の曲がりがこれより小さい */
  readonly pointIndexMaxCurl: number;
  /** 指を差す: 他の 3 本の指の曲がりがこれより大きい */
  readonly pointOthersMinCurl: number;
  /** 指を差す形が何回続いたら確定・解除するか */
  readonly pointConfirmCount: number;

  // ---- 認識に渡す画像 ----
  /**
   * Worker で認識する時に渡す画像の幅（px）．映像（640x480 で取る）の幅より大きければ映像の幅にする．
   * 小さいほど速いが指の点が粗くなる．カメラを付け直した時（attach）に読む
   */
  readonly recognizeWidthPx: number;

  // ---- 認識の頻度（負荷に応じた調整） ----
  /** 認識の頻度の段階（回/秒．高い順）．fps が落ちたら次の段階へ下げる */
  readonly rateLevelsHz: readonly number[];
  /** 全体の fps がこれを下回ったら頻度を下げる */
  readonly rateDownFps: number;
  /** 全体の fps がこれを超えていたら頻度を上げる */
  readonly rateUpFps: number;
  /** 下げる判断に要る継続時間（ms） */
  readonly rateDownHoldMs: number;
  /** 上げる判断に要る継続時間（ms）．下げるより長くし，行ったり来たりしないようにする */
  readonly rateUpHoldMs: number;
}

export const DEFAULT_HAND_PARAMS: HandParams = {
  cameraHfovDeg: 65,
  palmLengthM: 0.095,
  minDepthM: 0.15,
  maxDepthM: 1.0,
  cameraOffsetXM: 0,
  cameraOffsetYM: 0,
  cameraOffsetZM: -0.08,
  skeletonDepthM: 1.2,
  skeletonDepthScale: 1.5,

  oneEuroMinCutoffHz: 1.0,
  oneEuroBeta: 1.5,
  oneEuroDCutoffHz: 1.0,
  extrapolateMaxMs: 80,
  extrapolateDecayMs: 60,
  extrapolateMaxSpeed: 3,

  trackAppearCount: 2,
  trackLostMs: 300,
  gripHoldMs: 800,
  skeletonHoldMs: 120,

  fingerOpenRatio: 1.6,
  fingerClosedRatio: 0.8,
  gripOn: 0.6,
  gripOff: 0.4,
  pinchOnRatio: 0.25,
  pinchOffRatio: 0.4,
  pointIndexMaxCurl: 0.35,
  pointOthersMinCurl: 0.55,
  pointConfirmCount: 2,

  recognizeWidthPx: 640,

  rateLevelsHz: [15, 10, 7],
  rateDownFps: 30,
  rateUpFps: 50,
  rateDownHoldMs: 1000,
  rateUpHoldMs: 5000,
};

/** 数の項目の名前（rateLevelsHz 以外） */
export type HandParamKey = Exclude<keyof HandParams, "rateLevelsHz">;

const HAND_PARAM_KEYS = (Object.keys(DEFAULT_HAND_PARAMS) as (keyof HandParams)[]).filter(
  (k): k is HandParamKey => k !== "rateLevelsHz",
);

/** 既定値に上書きを重ねる．有限の数でない値・知らない項目は無視する（例外を投げない） */
export function mergeHandParams(
  base: HandParams,
  overrides: Readonly<Record<string, unknown>> | null | undefined,
): HandParams {
  if (overrides == null) return base;
  const out: Record<string, unknown> = { ...base };
  for (const key of HAND_PARAM_KEYS) {
    const v = overrides[key];
    if (typeof v === "number" && Number.isFinite(v)) out[key] = v;
  }
  const levels = overrides.rateLevelsHz;
  if (
    Array.isArray(levels) &&
    levels.length > 0 &&
    levels.every((v) => typeof v === "number" && Number.isFinite(v) && v > 0)
  ) {
    out.rateLevelsHz = [...levels];
  }
  return out as unknown as HandParams;
}

/** URL パラメータから手のしきい値の上書きを読む（例: ?cameraHfovDeg=60&oneEuroBeta=2）．数でない値は無視する */
export function handParamsFromSearch(search: string): Partial<Record<HandParamKey, number>> {
  const out: Partial<Record<HandParamKey, number>> = {};
  const query = new URLSearchParams(search);
  for (const key of HAND_PARAM_KEYS) {
    const raw = query.get(key);
    if (raw === null || raw.trim() === "") continue;
    const v = Number(raw);
    if (Number.isFinite(v)) out[key] = v;
  }
  return out;
}
