// モジュール間で受け渡す基本データ（docs/04_SPEC/SPEC_01「受け渡すデータ」）．
// three.js やブラウザ API に依存させない（input/ や scenario/ からも import するため）．

/** 3 次元ベクトル（単位: m）．three.js の Vector3 に依存しないための素のデータ */
export interface Vec3 {
  readonly x: number;
  readonly y: number;
  readonly z: number;
}

/** 回転（クォータニオン）．three.js の座標系（右手系，y が上，-z が正面）に合わせる */
export interface Quat {
  readonly x: number;
  readonly y: number;
  readonly z: number;
  readonly w: number;
}

/** 姿勢．しゃがみの途中は直前の状態を保つ（判定は input/ が行う） */
export type Posture = "standing" | "crouching";

export type Handedness = "left" | "right";

/** 片手の状態（担当D の input/ が作る） */
export interface HandState {
  /** 手を認識できているか．false の間 position 等は直前の値のまま */
  readonly tracked: boolean;
  /** 手のひらの中心の位置．頭を原点とした頭の座標系（-z が視線の方向） */
  readonly position: Vec3;
  /** 握り具合（0 = 開いている，1 = 握っている） */
  readonly grip: number;
}

/** 1 フレーム分のプレイヤーの入力（input/ → app/ → scenes/・scenario/） */
export interface PlayerInput {
  /** 入力を作った時刻（performance.now() の ms） */
  readonly time: number;
  /** 頭の向き．CalibrationProfile の正面リセットを反映済み */
  readonly head: Quat;
  readonly posture: Posture;
  /** 足踏みしている間 true．進む方向・床の高さ（階段等）は scenes/ が決める */
  readonly walking: boolean;
  /** 足踏みの速さから見積もった前進の速さ（m/s）．walking が false なら 0 */
  readonly walkSpeed: number;
  readonly hands: Readonly<Record<Handedness, HandState>>;
}

/**
 * キャリブレーションの結果（lobby/ が作り，input/ が判定のしきい値に使う）．
 * 項目の意味は input/ の判定方法に合わせて担当C・D で決め，変更は core の専用 PR で行う
 */
export interface CalibrationProfile {
  /** 作成時刻（Date.now() の ms） */
  readonly createdAt: number;
  /** 正面リセット: 体験者の正面を向いた時の頭のヨー角（rad）．以降はこれを差し引く */
  readonly yawOffset: number;
  /** 足踏みとみなす上下加速度の山の大きさ（m/s^2） */
  readonly stepPeakThreshold: number;
  /** 立っている時の基準値（判定方法に依存する値．例: 上下加速度の静止時の平均） */
  readonly standingBaseline: number;
  /** しゃがみとみなすしきい値（判定方法に依存する値） */
  readonly crouchThreshold: number;
}

/** 入力が無い時の手（未認識） */
export const UNTRACKED_HAND: HandState = {
  tracked: false,
  position: { x: 0, y: 0, z: 0 },
  grip: 0,
};

/** 入力が無い時（センサーの許可前・初期化中）の PlayerInput */
export const IDLE_PLAYER_INPUT: PlayerInput = {
  time: 0,
  head: { x: 0, y: 0, z: 0, w: 1 },
  posture: "standing",
  walking: false,
  walkSpeed: 0,
  hands: { left: UNTRACKED_HAND, right: UNTRACKED_HAND },
};
