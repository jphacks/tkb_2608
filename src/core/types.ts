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
  /**
   * 人差し指の先の位置（頭の座標系．position と同じ奥行きの見積もり．m）．手で押すボタンの判定点に使う．
   * 指先を出せない入力（記録の再生等）では省き，判定は position に戻す．tracked が false の間は直前の値のまま
   */
  readonly indexTip?: Vec3;
  /**
   * 手の 21 点の位置（頭の座標系．position と同じ．m）．番号は MediaPipe の HandLandmarker と同じ（0 = 手首，4 = 親指の先，8 = 人差し指の先 等）．
   * 手の形を描くために使う（Issue #160）．形を出せない入力（古い入力・記録の再生等）では省く．tracked が false の間は直前の値のまま
   */
  readonly landmarks?: readonly Vec3[];
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

/** キャリブレーションの手順のうち，input/ が値を求めるのに使う区間の種類 */
export type CalibrationSegmentKind =
  /** 立って静止（静止時の揺れ restNoise 等） */
  | "standing"
  /** 立った姿勢からしゃがんで静止（しゃがみの深さ・しゃがむ時間等） */
  | "crouching"
  /** 立ってその場で足踏み（立った足踏みの山・足踏みの間隔等） */
  | "stepping"
  /** しゃがんだままその場で足踏み（しゃがみ歩きの山等） */
  | "crouchWalking";

/**
 * 区間の終わり方．completed = lobby/ の終わりの判定を満たした，timeout = 制限時間で次へ進んだ，
 * skipped = 開発用の飛ばし（?debug の Enter／Space）で次へ進んだ
 */
export type CalibrationSegmentOutcome = "completed" | "timeout" | "skipped";

/**
 * キャリブレーションの 1 手順の区間（lobby/ が開始と終了を記録する）．
 * 時刻は performance.now() と同じ時計の ms（input/ のセンサーのサンプルの t = イベントの timeStamp と同じ基準）．
 * input/ はためたサンプルを [startMs, endMs] で切り出して値を求める．値の計算（積分・山の集計等）は input/ が行う
 */
export interface CalibrationSegment {
  readonly kind: CalibrationSegmentKind;
  /** 手順に入った時刻（performance.now() の ms） */
  readonly startMs: number;
  /** 手順を終えた時刻（performance.now() の ms）．startMs 以上 */
  readonly endMs: number;
  readonly outcome: CalibrationSegmentOutcome;
}

/**
 * キャリブレーションの結果（lobby/ が作り，input/ が判定のしきい値に使う）．
 * 項目の意味は input/ の判定方法に合わせて担当C・D で決め，変更は core の専用 PR で行う．
 * lobby/ は手順の区間（segments）と正面（yawOffset）を渡し，しきい値の計算は input/ が行う（Issue #58）
 */
export interface CalibrationProfile {
  /** 作成時刻（Date.now() の ms） */
  readonly createdAt: number;
  /** 正面リセット: 体験者の正面を向いた時の頭のヨー角（rad）．以降はこれを差し引く */
  readonly yawOffset: number;
  /**
   * 手順の区間（行った順）．同じ種類は 1 つまで．時間切れ・飛ばした手順も outcome を付けて入れる．
   * 無い（undefined）・空の時は区間が無いものとして既定の判定を使う
   */
  readonly segments?: readonly CalibrationSegment[];
  /**
   * 足踏みとみなす上下加速度の山の大きさ（m/s^2）．
   * 非推奨: 意味が lobby/ と input/ でずれている（#58）．input/ が segments から求める形に移ったら消す
   */
  readonly stepPeakThreshold: number;
  /**
   * 立っている時の基準値（判定方法に依存する値．例: 上下加速度の静止時の平均）．
   * 非推奨: 意味が lobby/ と input/ でずれている（#58）．input/ が segments から求める形に移ったら消す
   */
  readonly standingBaseline: number;
  /**
   * しゃがみとみなすしきい値（判定方法に依存する値）．
   * 非推奨: 意味が lobby/ と input/ でずれている（#58）．input/ が segments から求める形に移ったら消す
   */
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
