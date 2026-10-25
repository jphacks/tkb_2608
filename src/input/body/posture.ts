// しゃがみ・立ち上がりの判定（experiment_山﨑/05）．
// ① 動作の候補: 静止の後（または静止の後の速度が小さいうち）に，ノイズより大きい同じ向きの上下の加速度が約 0.1 秒続く．
//    立つ前に一度沈む・しゃがむ前に一度伸びる（反動）と，反動は今の姿勢から切り替わりえない向きなので捨てるが，
//    静止の記録と静止からの速度は残し，続く逆向きの動作を（速度が小さくなくても）静止の後 1 秒の間は候補にする．
//    Δh は反動の底（頂点）から測る（速度の向きが候補の向きに初めて変わった時点から．一度きりで，その後また
//    切り替わりえない向きへ動けば何も残さず捨てる．連続して立つ・しゃがむと反動が入りやすく，以前は両方を見逃した）
// ② 短い積分: 候補の始まりから加速度を 2 回積分して沈んだ量 Δh を求める（最長約 1.5 秒）
// ③ ZUPT: 加速度・角速度（短い RMS）・積分中の速度が小さい状態が約 0.15 秒続いたら静止とみなし，積分を終える
// ④ 確定: Δh がしゃがみの深さの約 50% を超えたら姿勢を切り替える．しゃがみ・立ち上がりの速さ（0.8 m/s 以上）で
//    動いていれば静止を待たずに確定し，速度が 0 付近に戻ったらそこから積分を始め直して，続けて起きる動作を追う
// 静止してから確定するため，しゃがみ歩きの揺れ（上へ動いてもすぐ下に戻る）を立ち上がりと取り違えない．
// その代わり，しゃがみ歩きから止まらずに立ち上がると，足踏みの途中なので①の候補にならず，しゃがんだままになる．
// そのための逃げ道が 2 つある（どちらも既定では使わない）:
// - 案 A（onPostureStep．standEscapeSteps）: しゃがんだまま，立っている時の T_high を超える足踏みが続いたら立つ．
//   しゃがみ歩きの山が立った足踏みより大きい人（20261024-175827_3uehweky: 5〜9 m/s^2 と 1〜2.4）では，
//   しゃがみ歩きのまま数歩で立ったため使っていない
// - 人ごとの境目（updateStandWalk．standWalk*）: キャリブレーションで測った，その人の立った足踏みとしゃがみ歩きの
//   山の大きさの間に境目（幾何平均）を置き，しゃがみ歩きの途中で，山が境目より立った足踏みの側に入った歩が
//   standWalkSteps 歩続いたら立つ．2 つの大きさの差が小さい人・測れなかった人では使わない
import type { Posture } from "../../core/types";
import type { InputParams } from "../params";

export type PosturePhase = "idle" | "candidate" | "integrating";

/** 動作が終わった時の結果（dev ページと記録用） */
export type PostureOutcome =
  | "none"
  /** 静止したが Δh が足りなかった */
  | "small"
  | "crouch"
  | "stand"
  /** 案 A の逃げ道で立った */
  | "stand-escape"
  /** しゃがみ歩きの途中で，山の大きさが立った足踏みの側に変わったので立った（updateStandWalk） */
  | "stand-walk"
  /** 積分が長すぎたので捨てた */
  | "timeout"
  /** 漏れ付きの長い積分（ゆっくりした・静止の無いしゃがみ）でしゃがんだ */
  | "crouch-slow";

export interface PostureState {
  posture: Posture;
  phase: PosturePhase;
  /** 候補の向き（+1: 上，-1: 下） */
  sign: number;
  /** 候補・積分の始まりの時刻（ms） */
  startT: number;
  /** 積分中の速度（m/s）と高さの変化（m．上が正） */
  v: number;
  h: number;
  /** 積分中の速度の大きさの最大（m/s） */
  vPeak: number;
  /** この積分の中で姿勢を切り替えた時刻（ms．早めの確定．experiment_山﨑/05「確定」）．まだなら NaN */
  confirmedT: number;
  /** 確定した動作の後に，静止を待たずに始め直した積分か */
  chained: boolean;
  /** 静止が続き始めた時刻（ms）．静止していなければ NaN（積分中の ZUPT 用） */
  stillSinceT: number;
  /** 動作の候補の前の静止が続き始めた時刻（ms）．静止していなければ NaN */
  restSinceT: number;
  /** 最後に静止が終わった時刻（ms）と，その静止の長さ（ms） */
  restEndT: number;
  restMs: number;
  /** 最後の十分に長い静止が終わってからの速度（m/s．上下の加速度を積分した値．静止の間は 0） */
  restV: number;
  /**
   * 静止の後に，今の姿勢から切り替わりえない向きの動きとして捨てた積分の向き（+1: 上，-1: 下．無ければ 0）．
   * 立つ前の沈み込み・しゃがむ前の伸び上がり（反動）の後に，逆向きの動作を候補にするために使う（updatePosture）
   */
  counterSign: number;
  /** 今の候補・積分が，反動の後の逆向きの動作として始まったか */
  fromCounter: boolean;
  /**
   * 反動の後の候補で，速度の向きが候補の向きに変わったか（反動の底・頂点を過ぎたか）．変わるまでは高さと
   * 速度の最大を 0 に保ち，変わった後は普通に Δh を測る（一度きり．updatePosture）
   */
  counterTurned: boolean;
  /** 静止時の上下の加速度の 2 乗の平均（指数移動平均） */
  noiseVar: number;
  /** 静止の判定に使う，上下の加速度の 2 乗の短い平均（指数移動平均．QUIET_TAU_SEC） */
  quietVar: number;
  /** 静止の判定に使う，角速度の大きさの短い平均（deg/s．角速度が無ければ NaN） */
  quietGyro: number;
  /** 漏れ付きの長い積分の速度（m/s）と高さ（m．上が正）．ゆっくりした・静止の無いしゃがみ用（SLOW_*） */
  slowV: number;
  slowH: number;
  /** 頭の回転の大きさの平均（deg/s．SLOW_GYRO_TAU_SEC．角速度が無ければ 0） */
  slowGyro: number;
  /** 案 A: しゃがんだまま立っている時の大きさの歩が続いた数 */
  escapeCount: number;
  /** updateStandWalk: 帯域通過後の山の途中か，今の山の最大値（m/s^2）とその時刻（ms） */
  walkPeakIn: boolean;
  walkPeakValue: number;
  walkPeakT: number;
  /** updateStandWalk: 最後に見た山の時刻（ms）と大きさ（m/s^2．dev ページ用） */
  walkLastPeakT: number;
  walkLastPeak: number;
  /** updateStandWalk: 山が立った足踏みの側に入った歩が続いた数 */
  walkCount: number;
  /** 最後に終わった動作の Δh（m）と結果，その時刻（ms） */
  lastDeltaH: number;
  lastOutcome: PostureOutcome;
  lastOutcomeT: number;
  /** 姿勢が切り替わった回数（dev ページ用） */
  changeCount: number;
}

export function createPostureState(posture: Posture = "standing"): PostureState {
  return {
    posture,
    phase: "idle",
    sign: 0,
    startT: 0,
    v: 0,
    h: 0,
    vPeak: 0,
    confirmedT: Number.NaN,
    chained: false,
    stillSinceT: Number.NaN,
    restSinceT: Number.NaN,
    restEndT: Number.NEGATIVE_INFINITY,
    restMs: 0,
    restV: 0,
    counterSign: 0,
    fromCounter: false,
    counterTurned: false,
    noiseVar: 0,
    quietVar: 0,
    quietGyro: Number.NaN,
    slowV: 0,
    slowH: 0,
    slowGyro: 0,
    escapeCount: 0,
    walkPeakIn: false,
    walkPeakValue: 0,
    walkPeakT: 0,
    walkLastPeakT: Number.NEGATIVE_INFINITY,
    walkLastPeak: 0,
    walkCount: 0,
    lastDeltaH: 0,
    lastOutcome: "none",
    lastOutcomeT: Number.NEGATIVE_INFINITY,
    changeCount: 0,
  };
}

/** 動作の途中の状態を捨てる．姿勢は保つ（迷ったら直前の姿勢のまま．experiment_山﨑/09） */
export function resetPostureMotion(s: PostureState): void {
  s.phase = "idle";
  s.sign = 0;
  s.v = 0;
  s.h = 0;
  s.vPeak = 0;
  s.confirmedT = Number.NaN;
  s.chained = false;
  s.stillSinceT = Number.NaN;
  s.restSinceT = Number.NaN;
  s.restEndT = Number.NEGATIVE_INFINITY;
  s.restMs = 0;
  s.restV = 0;
  s.counterSign = 0;
  s.fromCounter = false;
  s.counterTurned = false;
  s.escapeCount = 0;
}

/**
 * 動作の途中の状態を捨てるが，その動作の前の十分に長い静止の記録と，静止の後の速度（v．捨てた時点の積分の速度）は残す．
 * 候補・積分の始まりで静止が続いていたなら，静止はその始まり（startT）で終わったとみなす
 */
function resetMotionKeepingRest(s: PostureState, v: number, params: PostureParams): void {
  const inRest = !Number.isNaN(s.restSinceT);
  const restMs = inRest ? s.startT - s.restSinceT : s.restMs;
  const restEndT = inRest ? s.startT : s.restEndT;
  resetPostureMotion(s);
  if (restMs >= params.postureRestBeforeMs) {
    s.restMs = restMs;
    s.restEndT = restEndT;
    s.restV = v;
  }
}

type PostureParams = Pick<
  InputParams,
  | "postureCandidateAccel"
  | "postureNoiseFactor"
  | "postureCandidateMs"
  | "postureRestBeforeMs"
  | "postureMaxIntegrateMs"
  | "zuptAccel"
  | "zuptGyroDps"
  | "zuptMaxVelocity"
  | "zuptMs"
  | "crouchDepthM"
  | "postureConfirmRatio"
  | "postureStepSuppressM"
  | "postureStepSuppressAfterMs"
  | "standEscapeSteps"
  | "postureSlowGyroDps"
  | "standWalkPeakStanding"
  | "standWalkPeakCrouching"
  | "standWalkSteps"
  | "stepRefractoryMs"
  | "stepGyroWindowMs"
  | "stepStopMaxMs"
>;

/**
 * 静止の判定に使う短い平均の時定数（秒）．ゴーグルを付けて立っているだけでも，上下の加速度は
 * 1 サンプルずつ見ると ±0.5 m/s^2 ほど揺れ（20261024-175827_3uehweky の still: |av| の 99% 点 0.93，RMS 0.23），
 * 1 サンプルで静止が途切れると，しゃがむ前の静止を数えられなかった．RMS で見れば揺れの 1 サンプルでは途切れない
 */
const QUIET_TAU_SEC = 0.1;

/** 静止の判定に使う短い平均を進める */
function updateQuiet(s: PostureState, av: number, gyro: number, dtSec: number): void {
  const k = 1 - Math.exp(-dtSec / QUIET_TAU_SEC);
  s.quietVar += (av * av - s.quietVar) * k;
  if (!Number.isFinite(gyro)) s.quietGyro = Number.NaN;
  else if (!Number.isFinite(s.quietGyro)) s.quietGyro = gyro;
  else s.quietGyro += (gyro - s.quietGyro) * k;
}

/**
 * 加速度・角速度が静止とみなせるほど小さいか（短い平均で見る．角速度が無い端末では加速度だけで見る）．
 * 今のサンプルの加速度が大きすぎる時（静止のしきい値の 3 倍）は，平均が小さくても静止とみなさない（動き始めの遅れを抑える）
 */
function isQuiet(s: PostureState, av: number, params: PostureParams): boolean {
  return (
    Math.sqrt(Math.max(0, s.quietVar)) < params.zuptAccel &&
    Math.abs(av) < params.zuptAccel * 3 &&
    (!Number.isFinite(s.quietGyro) || s.quietGyro < params.zuptGyroDps)
  );
}

/**
 * 静止が終わってからこの時間（ms）の間は，静止の後の速度（restV）を積分で追い，それが小さければ「静止の後」とみなす．
 * 積分は速度 0 から始める必要があるが，人はしゃがむ前に少しぐらつく（±1.3 m/s^2 ほど．20261024-175827_3uehweky の
 * squat_stand）．以前は静止が途切れてから 300 ms で打ち切っていたため，ぐらついてからしゃがむと見逃した．
 * 静止の後の速度が分かっていれば，その値から積分を始められる．長く追うと加速度の偏りで速度がずれるため 1 秒で打ち切る
 */
const REST_TRACK_MS = 1000;

/** 静止時のノイズの見積もりの時定数（秒） */
const NOISE_TAU_SEC = 2;

/**
 * 早めの確定に要る速度の最大（m/s）．深さの基準を超えて動き，その間の速度の最大がこれ以上なら，静止を待たずに確定する．
 * ゴーグルを付けたしゃがみ・立ち上がりは動き始めから静止まで 1.5〜1.9 秒かかり（しゃがんだ後に体が揺れて，
 * 静止の条件を満たすのが遅れる），静止を待つと SPEC の 1 秒を超えた（20261024-175827_3uehweky の squat_stand）．
 * 実際のしゃがみ・立ち上がりは 1.2〜1.6 m/s まで速くなる（同じ記録）．一方，加速度の偏りによる積分のずれは
 * 速度がゆっくり増えるだけで，静止の後の 1 秒ほどでは 0.8 m/s に届かない（偏り 0.8 m/s^2 が要る）．
 * 減速に入るまで待つ案（速度が最大の 50%・70%・85% まで下がったら確定）も比べたが，遅れの最大が 1317・1233・1166 ms と
 * SPEC を超え，待たない時（933 ms）と比べて誤検出は減らなかった
 */
const EARLY_CONFIRM_MIN_PEAK_VELOCITY = 0.8;

/**
 * 早めに確定してから，速度が 0 付近に戻るのを待つ最長の時間（ms）．戻らなければ積分がずれたとみなし，
 * 始め直さずに静止を待つ
 */
const SETTLE_MAX_MS = 1500;

/** 確定した動作の後に積分を始め直してよい，上下の加速度の短い RMS の上限（m/s^2） */
const RESTART_ACCEL_RMS = 1.5;

/** 積分中の高さの変化のうち，今の姿勢から切り替わる向き（立っている時は下，しゃがんでいる時は上）の量（m） */
function towardOtherPosture(s: PostureState): number {
  return s.posture === "standing" ? -s.h : s.h;
}

/** 積分を，速度・高さ 0 の今の時刻から始め直す（動作が終わったと速度で分かった時に，次の動作を続けて追う） */
function restartIntegration(s: PostureState, t: number): void {
  s.phase = "integrating";
  s.sign = 0;
  s.startT = t;
  s.v = 0;
  s.h = 0;
  s.vPeak = 0;
  s.confirmedT = Number.NaN;
  s.chained = true;
  s.fromCounter = false;
  s.counterTurned = false;
  s.stillSinceT = Number.NaN;
  s.restSinceT = Number.NaN;
}

/**
 * ゆっくりした・静止の無いしゃがみ用の，漏れ付きの 2 回積分の時定数（秒）．速度は 1 秒，高さは 2 秒で 0 に戻る．
 * 静止の後の短い積分（①〜④）は，しゃがむ前に静止が無いと始まらない．squat_stand から crouch_walk までの準備の間に，
 * 頭を動かしながらゆっくりしゃがむと 4 人中 3 人で見逃した（20261024-175827_3uehweky・183237_curfcrp9・183931_t9tonjf6）．
 * 漏れがあるので加速度の偏りによるずれは溜まらない（偏り b で高さは b × 1 × 2 m まで）．しゃがみ（0.6〜0.8 m）は
 * この積分で 0.36〜0.50 m の下がりになり，足踏みの間は ±0.07 m 以内だった（4 人分）
 */
const SLOW_V_TAU_SEC = 1;
const SLOW_H_TAU_SEC = 2;
/** 頭の回転の平均の時定数（秒） */
const SLOW_GYRO_TAU_SEC = 0.5;

/**
 * 漏れ付きの長い積分を進め，立っている時に下がりが基準を超え，頭がほとんど回っていなければしゃがみとする．
 * 頭を回すと，スマホが回転の中心より前にあるため向心の加速度（ω^2 r．常に中心向き）が出て，漏れ付きの積分でも
 * 高さが ±0.3〜0.5 m ずれる（4 人分の look_around・nod．その時の回転の平均は 84〜95 deg/s）．
 * 準備の間のしゃがみでは回転の平均は 11〜25 deg/s だったため，postureSlowGyroDps 未満の時だけ使う．
 * 立ち上がりには使わない（しゃがみ歩きの揺れで +0.17 m まで上がり，見回しでも上がるため．立つ判定の誤りは危険な行動の誤記録になる）
 */
function updateSlowCrouch(
  s: PostureState,
  t: number,
  dtSec: number,
  av: number,
  gyro: number,
  params: PostureParams,
): void {
  const g = Number.isFinite(gyro) ? gyro : 0;
  s.slowGyro += (g - s.slowGyro) * (1 - Math.exp(-dtSec / SLOW_GYRO_TAU_SEC));
  if (!Number.isNaN(s.confirmedT)) {
    // 確定した動作の残り（減速）の間は 0 に保ち，速度が 0 付近に戻った時から積分する
    // （確定の時に 0 にするだけだと，立ち上がりの減速を下向きの動きとして積分し，しゃがみと取り違えた）
    s.slowV = 0;
    s.slowH = 0;
    return;
  }
  s.slowV += (av - s.slowV / SLOW_V_TAU_SEC) * dtSec;
  s.slowH += (s.slowV - s.slowH / SLOW_H_TAU_SEC) * dtSec;
  if (s.slowGyro >= params.postureSlowGyroDps) {
    // 頭が回っている間の積分は向心の加速度でずれるので捨て，回転が止まってから積分し直す
    // （頷きの後に回転だけ先に収まり，ずれた高さのまま「しゃがんだ」になった．20261024-183237_curfcrp9）
    s.slowV = 0;
    s.slowH = 0;
    return;
  }
  if (
    params.postureSlowGyroDps > 0 &&
    s.posture === "standing" &&
    s.slowH <= -params.postureConfirmRatio * params.crouchDepthM
  ) {
    const dh = s.slowH;
    setPosture(s, "crouching", "crouch-slow", t);
    s.lastDeltaH = dh;
    // 短い積分が途中なら，そこで確定したことにして続ける（速度が 0 付近に戻ったら始め直す．続けて立ち上がっても追える）
    if (s.phase === "integrating") s.confirmedT = t;
  }
}

/**
 * 長い積分を捨てる（歩いている間・サンプルの間隔が飛んだ時）．withGyro が true なら頭の回転の平均も捨てる
 * （歩いている間は回転の平均を残し，止まった直後に頭が回っていればすぐに分かるようにする）
 */
export function resetSlowCrouch(s: PostureState, withGyro = true): void {
  s.slowV = 0;
  s.slowH = 0;
  if (withGyro) s.slowGyro = 0;
}

/** 動作の候補とみなす加速度の大きさ（m/s^2） */
export function candidateThreshold(s: PostureState, params: PostureParams): number {
  return Math.max(
    params.postureCandidateAccel,
    params.postureNoiseFactor * Math.sqrt(Math.max(0, s.noiseVar)),
  );
}

function setPosture(s: PostureState, posture: Posture, outcome: PostureOutcome, t: number): void {
  if (s.posture !== posture) {
    s.changeCount++;
    // 姿勢が変わったら長い積分は 0 から（同じ動作で二重に切り替えない）
    s.slowV = 0;
    s.slowH = 0;
  }
  s.posture = posture;
  s.lastOutcome = outcome;
  s.lastOutcomeT = t;
  s.escapeCount = 0;
  s.walkCount = 0;
}

/** 静止した時に Δh で姿勢を決める */
function finishMotion(s: PostureState, t: number, params: PostureParams): void {
  const durationSec = Math.max(0, (t - s.startT) / 1000);
  // 速度は静止で 0 のはず．残った速度は一定の偏りが溜まったとみなし，高さから差し引く（0.5 × v × T）
  const dh = s.h - 0.5 * s.v * durationSec;
  const threshold = params.postureConfirmRatio * params.crouchDepthM;
  if (!Number.isNaN(s.confirmedT)) {
    // 動作の途中ですでに切り替えた（結果は切り替えた時のまま残す）
    s.lastDeltaH = dh;
  } else if (s.posture === "standing" && dh <= -threshold) {
    s.lastDeltaH = dh;
    setPosture(s, "crouching", "crouch", t);
  } else if (s.posture === "crouching" && dh >= threshold) {
    s.lastDeltaH = dh;
    setPosture(s, "standing", "stand", t);
  } else if (!s.chained) {
    s.lastDeltaH = dh;
    s.lastOutcome = "small";
    s.lastOutcomeT = t;
  }
  // 始め直した積分（確定した動作の後の揺れ）が何も起こさずに静止したなら，直前の動作の結果を残す（上の !s.chained）．
  // ZUPT で静止を確かめた後なので，静止はその時から続いているとみなす（次の動作の「直前の静止」に数える）．
  // しゃがんでから約 0.3 秒で立ち上がる時に，静止を数え直す間に動き始めて見逃さないため
  const stillSinceT = s.stillSinceT;
  resetPostureMotion(s);
  s.restSinceT = stillSinceT;
}

/**
 * 1 サンプル分進める．t は時刻（ms），dtSec は前のサンプルからの時間（秒．0 より大きいこと），
 * av は上下の加速度（m/s^2．上が正．帯域通過はしない値），gyro は角速度の大きさ（deg/s．無ければ NaN）．
 * 戻り値は姿勢が変わったか
 */
export function updatePosture(
  s: PostureState,
  t: number,
  dtSec: number,
  av: number,
  gyro: number,
  params: PostureParams,
): boolean {
  if (!Number.isFinite(av) || !(dtSec > 0)) return false;
  const before = s.posture;
  const th = candidateThreshold(s, params);
  updateQuiet(s, av, gyro, dtSec);
  updateSlowCrouch(s, t, dtSec, av, gyro, params);
  const quiet = isQuiet(s, av, params);

  if (s.phase === "idle") {
    // 静止の続いた長さを追う．十分に長い静止だけを「直前の静止」として残す
    // （しゃがむ前の小さな揺れで短い静止が続いても，その前の長い静止を上書きしない）
    if (quiet) {
      if (Number.isNaN(s.restSinceT)) s.restSinceT = t;
    } else if (!Number.isNaN(s.restSinceT)) {
      const ms = t - s.restSinceT;
      if (ms >= params.postureRestBeforeMs) {
        s.restEndT = t;
        s.restMs = ms;
        s.restV = 0;
        s.counterSign = 0;
      }
      s.restSinceT = Number.NaN;
    }
    // 十分な長さの静止の途中なら速度は 0，その後は積分で追う
    const inLongRest =
      !Number.isNaN(s.restSinceT) && t - s.restSinceT >= params.postureRestBeforeMs;
    if (inLongRest) {
      s.restV = 0;
      s.counterSign = 0;
    } else s.restV += av * dtSec;
    // 十分な長さの静止の途中か，その後 REST_TRACK_MS 以内で速度が小さいか
    const trackingRest =
      s.restMs >= params.postureRestBeforeMs &&
      t - s.restEndT <= REST_TRACK_MS &&
      Math.abs(s.restV) < params.zuptMaxVelocity;
    const restedBefore = params.postureRestBeforeMs <= 0 || inLongRest || trackingRest;
    // 反動の後: 静止の後に切り替わりえない向きへ動いて捨てた積分（立つ前の沈み込み・しゃがむ前の伸び上がり）の後は，
    // 逆向き（今の姿勢から切り替わる向き）の動作を，速度が小さくなくても REST_TRACK_MS の間は候補にする．
    // 反動の底でも速度は 0 に戻りきらず（20261025-033733_ryi6nkay の 108.9 s: 約 -0.9 m/s のまま上へ加速し始めた），
    // 上の trackingRest（速度が小さい）を満たさないため，以前は立ち上がりを見逃した．速度は静止から積分で追っている
    // （restV）ので，その値から積分を始めれば Δh を求められる
    const sign = av > 0 ? 1 : -1;
    const afterCounter =
      s.counterSign !== 0 &&
      sign === -s.counterSign &&
      s.restMs >= params.postureRestBeforeMs &&
      t - s.restEndT <= REST_TRACK_MS;
    if (Math.abs(av) < th || !(restedBefore || afterCounter)) {
      // ノイズの見積もりには，頭が回っていない時の基準のしきい値未満の値だけを入れる．
      // 以前は「今のしきい値」未満の値をすべて入れていたため，頷き・足踏み・しゃがみの揺れでノイズが育ち，
      // しきい値が上がるとさらに大きな値が入る，の繰り返しで候補のしきい値が 3〜11 m/s^2 まで上がり，
      // しゃがみ（下向き 4〜10 m/s^2）を候補にできなかった（20261024-175827_3uehweky の squat_stand）
      if (
        Math.abs(av) < params.postureCandidateAccel &&
        (!Number.isFinite(gyro) || gyro < params.zuptGyroDps)
      ) {
        const k = 1 - Math.exp(-dtSec / NOISE_TAU_SEC);
        s.noiseVar += (av * av - s.noiseVar) * k;
      }
      return s.posture !== before;
    }
    s.phase = "candidate";
    s.sign = sign;
    s.startT = t - dtSec * 1000;
    // 反動の後の候補か（その後にもう一度向きで捨てても，続けて候補にはしない．しゃがみ歩きの揺れで候補が続かないため）
    s.fromCounter = s.counterSign !== 0;
    s.counterTurned = false;
    // 静止の後の速度が分かっていればそこから始める（このサンプルの分は下で足すので差し引く）
    s.v = inLongRest || !(trackingRest || afterCounter) ? 0 : s.restV - av * dtSec;
    s.h = 0;
    s.stillSinceT = Number.NaN;
  }

  // 積分（半陰的オイラー）
  s.v += av * dtSec;
  s.h += s.v * dtSec;
  // 反動の後の候補は，反動の向きの速度が残ったまま始まる（沈み込みの途中で上へ加速し始める）．速度の向きが
  // 候補の向きに初めて変わるまで（反動の底・頂点まで）は高さと速度の最大を 0 に保ち，Δh を反動の底から測る．
  // 候補の始まりから測ると，残りの沈み込みで高さが下がり，下の「切り替わりえない向き」で捨てていた．
  // 0 に保つのは一度きりで，向きが変わった後（counterTurned）は普通に Δh を測る．速度が反動の向きに戻るたびに
  // 測り直すと，しゃがみ歩きの揺れで Δh が切り替わりえない向きにならず，候補が捨てられずに時間切れまで続いて
  // 足踏みを抑止した．確定した後（姿勢が変わった後の減速）も測り直さない
  if (s.fromCounter && !s.counterTurned && s.v * s.sign > 0) s.counterTurned = true;
  const counterTurning = s.fromCounter && !s.counterTurned && Number.isNaN(s.confirmedT);
  if (counterTurning) {
    s.h = 0;
    s.vPeak = 0;
  }

  if (s.phase === "candidate") {
    // 同じ向きで，しきい値の半分より大きい間だけ候補を続ける（しきい値の上下の揺れで切らない）
    if (av * s.sign < th * 0.5) {
      // 候補に届かなかった短い揺れ（しゃがむ前の小さなぐらつき等）．直前の静止を消すと，続けてしゃがんだ時に
      // 静止の後とみなせず見逃したため，静止の記録と，その後の速度（候補の間に積分した値）を残す．
      // 反動の後の候補なら，反動の向きも残す（揺れの後に逆向きの動作が続いても候補にできる）
      const counterSign = s.counterSign;
      resetMotionKeepingRest(s, s.v, params);
      if (s.restMs > 0) s.counterSign = counterSign;
      return false;
    }
    if (t - s.startT >= params.postureCandidateMs) s.phase = "integrating";
    return false;
  }

  // integrating
  // 確定した後は，速度が 0 付近に戻るまでを下の SETTLE_MAX_MS で見る（積分の始まりからの時間では切らない）
  if (Number.isNaN(s.confirmedT) && t - s.startT > params.postureMaxIntegrateMs) {
    if (s.chained) {
      // 始め直した積分が，しゃがんだまま（立ったまま）体が揺れて静止の条件を満たさずに時間切れになった．
      // 速度が 0 付近なら，もう一度始め直して次の動作を追い続ける（静止を求めると，揺れたまま続けて動いた時に見逃す）．
      // 動いている途中（速度が大きい）なら，動作を途中で切らないよう，最長の 2 倍までは続ける．
      // 時間切れで切っていた時は，時間切れの時刻と動作の重なり方で検出が変わり，
      // postureMaxIntegrateMs が 1000・1500・2000・2500 ms で検出率が 60%・80%・60%・100% とぶれた
      if (Math.abs(s.v) < params.zuptMaxVelocity) {
        restartIntegration(s, t);
        return false;
      }
      if (t - s.startT <= 2 * params.postureMaxIntegrateMs) return false;
    }
    s.lastDeltaH = s.h;
    s.lastOutcome = "timeout";
    s.lastOutcomeT = t;
    resetPostureMotion(s);
    return false;
  }
  // 今の姿勢から切り替わりえない向き（立っている時の上，しゃがんでいる時の下）へ動いた積分は，
  // しゃがみ・立ち上がりではない（足踏みの始まり・体の揺れ）ので捨てる．続けると足踏みを数えなくなる
  // （20261024-175827_3uehweky の crouch_walk#2: 上向きの候補の積分が 2.5 秒続き，その間の歩をすべて抑止した）
  // 始め直した積分（chained）は速度の初めの値がずれうるため，向きでは捨てない（静止か時間切れで終える）．
  // 確定した後は姿勢が変わっているので，向きは見ない．
  // ただし，立つ前に一度沈む・しゃがむ前に一度伸びる（反動）と，その沈み込み・伸び上がりがここで捨てられる．
  // 以前は静止の記録も一緒に消していたため，直後の本当の立ち上がり・しゃがみが「静止の後」とみなされず候補に
  // ならなかった（20261025-033733_ryi6nkay の 108〜110 s の立ち上がり．しゃがんだままになったので，続く 111.8 s の
  // しゃがみも切り替わりえない向きとして捨てられ，両方を見逃した）．そこで静止の記録と，静止からの速度（restV）を残し，
  // 反動の向き（counterSign）を覚えて，静止の後 REST_TRACK_MS の間は逆向きの動作を候補にできるようにする
  // （上の idle の afterCounter）．反動の後の候補（fromCounter）は，反動の底・頂点を過ぎた（counterTurned）後に
  // また向きで捨てた時は何も残さない．
  // しゃがみ歩きの始まりの上下の揺れで，候補と捨てるのが繰り返し続かないようにするため（crouch_walk#2 の再発を防ぐ．
  // 反動の後の候補も，数えた歩（onPostureStep）で捨てられ，向きは捨てた時の積分のとおりに見る）
  // 反動の後の候補は Δh を反動の底（頂点）から測るので，しゃがみ歩きの揺れでは底に戻るだけで Δh が切り替わりえない
  // 向きにならない．そこで，底を過ぎた後（counterTurned）に速度がまた反動の向きへはっきり戻った（zuptMaxVelocity を
  // 超えた）ら，確定しないまま頂点（底）を過ぎた揺れとして，同じく向きで捨てる．本当の立ち上がり・しゃがみなら，
  // その前に早めの確定か静止（速度が小さい）で終わる．捨てないと，揺れの間ずっと積分が続いて時間切れまで足踏みを抑止した
  const counterReturned =
    s.fromCounter &&
    s.counterTurned &&
    Number.isNaN(s.confirmedT) &&
    s.v * s.sign < -params.zuptMaxVelocity;
  if (
    !s.chained &&
    !counterTurning &&
    Number.isNaN(s.confirmedT) &&
    (counterReturned || towardOtherPosture(s) < -params.postureStepSuppressM)
  ) {
    if (s.fromCounter) {
      resetPostureMotion(s);
    } else {
      const counterSign = s.sign;
      resetMotionKeepingRest(s, s.v, params);
      if (s.restMs > 0) s.counterSign = counterSign;
    }
    return false;
  }
  const absV = Math.abs(s.v);
  if (absV > s.vPeak) s.vPeak = absV;
  // 加速度が収まりかけているか．速度が 0 を横切るのはしゃがみの底・立ち上がりの頂点で，その時はまだ大きく
  // 減速・跳ね返っている（5 m/s^2 ほど）．そこで始め直すと，残りの加速度で速度が 0.35 m/s ずれたまま積分し，
  // しゃがみ歩きの間に「立った」と取り違えた（20261024-183237_curfcrp9 の crouch_walk）
  const settled = Math.sqrt(Math.max(0, s.quietVar)) < RESTART_ACCEL_RMS;
  if (Number.isNaN(s.confirmedT)) {
    // 早めの確定: 深さの基準を超えて，しゃがみ・立ち上がりの速さで動いたら切り替える
    const threshold = params.postureConfirmRatio * params.crouchDepthM;
    const moved =
      s.posture === "standing" ? s.h <= -threshold : s.posture === "crouching" && s.h >= threshold;
    if (moved && s.vPeak >= EARLY_CONFIRM_MIN_PEAK_VELOCITY) {
      setPosture(
        s,
        s.posture === "standing" ? "crouching" : "standing",
        s.posture === "standing" ? "crouch" : "stand",
        t,
      );
      s.lastDeltaH = s.h;
      s.confirmedT = t;
    }
  } else if (t - s.confirmedT > SETTLE_MAX_MS || (absV < params.zuptMaxVelocity && settled)) {
    // 確定した動作は，速度が 0 付近に戻った時点で終わりとし，そこから積分を始め直す．
    // しゃがんだ後は体が揺れて静止の条件を満たしにくく，静止を待つと続けて立ち上がる動作を見逃した
    // （速度が 0 付近なので，静止を待たずに始め直しても積分の始まりの条件を満たす）．
    // 速度が戻らないまま SETTLE_MAX_MS たったら，積分がずれたとみなして始め直さず，静止を待つ．
    // どちらも，足踏みを数えない時間（postureStepSuppressAfterMs）は確定の時ではなく動作の終わりから数える
    // （確定は動作の途中なので，その後の減速と揺れの山を足踏みと数えないため）
    s.lastOutcomeT = t;
    // 確定した時の Δh は深さの基準を超えたところの値なので，動作の終わりの値で置き換える
    s.lastDeltaH = s.h;
    if (absV < params.zuptMaxVelocity && settled) restartIntegration(s, t);
    else resetPostureMotion(s);
    return s.posture !== before;
  }
  // 始め直した積分は，速度の初めの値が 0 とは限らない（ずれが速度に溜まる）ため，加速度・角速度だけで静止を見る
  const still = quiet && (s.chained || absV < params.zuptMaxVelocity);
  if (!still) {
    s.stillSinceT = Number.NaN;
    return s.posture !== before;
  }
  if (Number.isNaN(s.stillSinceT)) s.stillSinceT = t;
  if (t - s.stillSinceT >= params.zuptMs) finishMotion(s, t, params);
  return s.posture !== before;
}

/**
 * 足踏みの山を数えないべきか．積分中に高さが大きく変わっている（しゃがむ・立つ動作の途中），
 * または高さが大きく変わった動作が終わった直後（帯域通過の遅れで山が後から出る）なら true．t は今の時刻（ms）
 */
export function shouldSuppressSteps(s: PostureState, t: number, params: PostureParams): boolean {
  // 確定した動作の残り（減速）の間は抑止する．確定の前は，今の姿勢から切り替わる向きの変化だけで抑止する
  // （切り替わりえない向きの変化＝始め直した積分のずれ等では，足踏みを止めない）
  if (s.phase === "integrating") {
    if (!Number.isNaN(s.confirmedT)) return true;
    // 始め直した積分は，初めの速度のずれ（0.2 m/s ほど）で高さがゆっくり変わる．しゃがみ・立ち上がりの
    // 速さに届かないうちは動作とみなさない（20261024-182402_ygakcbm7 の crouch_walk: しゃがんだ後の積分が
    // 0.17 m/s で上へずれ続け，しゃがみ歩きの始めの歩を 1.6 秒抑止した）
    // 反動の後の候補は，反動の底（頂点）から測った速度が，しゃがみ・立ち上がりの速さに届くまでは動作とみなさない
    // （しゃがみ歩きの揺れ（±6 cm・2 Hz で約 0.75 m/s）は底から 12 cm 上がるので，高さだけでは抑止してしまう）
    const moving = s.chained
      ? s.vPeak >= EARLY_CONFIRM_MIN_PEAK_VELOCITY * 0.5
      : !s.fromCounter || s.vPeak >= EARLY_CONFIRM_MIN_PEAK_VELOCITY;
    if (moving && towardOtherPosture(s) > params.postureStepSuppressM) return true;
  }
  return (
    t - s.lastOutcomeT < params.postureStepSuppressAfterMs &&
    Math.abs(s.lastDeltaH) > params.postureStepSuppressM &&
    // 姿勢が変わった動作の後だけ（時間切れ・小さすぎた動作の後は抑止しない．しゃがみ歩きの始めに，上向きの候補の
    // 時間切れのたびに 0.8 秒ずつ抑止し，動き出しが 2.7 秒遅れた．20261024-183931_t9tonjf6 の crouch_walk#2）
    (s.lastOutcome === "crouch" || s.lastOutcome === "stand" || s.lastOutcome === "crouch-slow")
  );
}

/**
 * 1 歩を数えた時に呼ぶ（案 A の逃げ道）．peak はその歩の山の大きさ，standingHigh は立っている時の T_high．
 * しゃがんでいる間に，立っている時の大きさの歩が standEscapeSteps 歩続いたら立ったとみなす．
 * 戻り値は姿勢が変わったか
 */
export function onPostureStep(
  s: PostureState,
  t: number,
  peak: number,
  standingHigh: number,
  params: PostureParams,
): boolean {
  // 足踏みとして数えた（＝高さの変化が小さいまま山が来た）なら，積分中の動作は足踏みの揺れとみなして捨てる
  // （experiment_山﨑/05「1 歩の山を足踏みとして数えた区間を姿勢の積分に使わない」）．逃げ道の数は残す
  if (s.phase !== "idle") {
    const escapeCount = s.escapeCount;
    resetPostureMotion(s);
    s.escapeCount = escapeCount;
  }
  if (s.posture !== "crouching" || params.standEscapeSteps <= 0) {
    s.escapeCount = 0;
    return false;
  }
  if (peak >= standingHigh) s.escapeCount++;
  else s.escapeCount = 0;
  if (s.escapeCount >= params.standEscapeSteps) {
    setPosture(s, "standing", "stand-escape", t);
    return true;
  }
  return false;
}

/**
 * updateStandWalk を使う，立った足踏みとしゃがみ歩きの山の大きさの比（大きい方 / 小さい方）の下限．
 * 境目（幾何平均）は，この比が 2 なら各中央値から √2 倍（約 41%）離れる．差が小さいと，しゃがみ歩きの 1 歩ごとの
 * ばらつきで境目を越えるため使わない．20261025-021610_ylu8lb54 は 1.08 と 7.11（比 6.6）
 */
export const STAND_WALK_MIN_RATIO = 2;
/** 山とみなす下限（2 つの中央値の小さい方に対する割合）．これより小さい揺れは歩として見ない */
const STAND_WALK_FLOOR_RATIO = 0.5;
/**
 * 立った足踏みの側の山として数える下限（立った足踏みの山の中央値に対する割合．しゃがみ歩きの山の方が大きい人だけ）．
 * これより小さい山は数えも数え直しもしない．しゃがみ歩きを止める時の弱まっていく山（20261025-021610_ylu8lb54 の
 * crouch_still: 1.61・0.64・1.14 m/s^2．立った足踏みの中央値は 1.08）が 3 歩続き，数えると 4 歩まであと 1 歩だった
 */
const STAND_WALK_MIN_PEAK_RATIO = 0.7;
/** 山から抜けたとみなす値（山に入る値に対する割合．calibration.ts の PEAK_EXIT_RATIO と同じ） */
const STAND_WALK_EXIT_RATIO = 0.3;
/**
 * 歩が続いているかを見る時間（ms）．最後に数えた歩（足踏みの判定）からこの時間の内に来た山からだけ数え始める．
 * しゃがみ歩きから立つと，立った足踏みの山はしゃがんでいる時の T_high（キャリブレーションで 4 m/s^2 ほどになる）に
 * 届かず歩として数えられないため，歩いている状態は立ち上がりの間に止まりうる．止まってから少しの間は数え始めてよい
 */
export const STAND_WALK_RECENT_MS = 2000;

/**
 * 立った足踏みとしゃがみ歩きの山の境目（m/s^2．2 つの中央値の幾何平均）．使わない時（歩数・山の大きさが 0 以下，
 * 比が STAND_WALK_MIN_RATIO 未満）は NaN
 */
export function standWalkBoundary(
  params: Pick<InputParams, "standWalkPeakStanding" | "standWalkPeakCrouching" | "standWalkSteps">,
): number {
  const ps = params.standWalkPeakStanding;
  const pc = params.standWalkPeakCrouching;
  if (!(params.standWalkSteps > 0 && ps > 0 && pc > 0)) return Number.NaN;
  if (Math.max(ps, pc) / Math.min(ps, pc) < STAND_WALK_MIN_RATIO) return Number.NaN;
  return Math.sqrt(ps * pc);
}

/** updateStandWalk の山の途中と数を捨てる（姿勢は保つ．サンプルの間隔が飛んだ時等） */
export function resetStandWalk(s: PostureState): void {
  s.walkPeakIn = false;
  s.walkPeakValue = 0;
  s.walkPeakT = 0;
  s.walkLastPeakT = Number.NEGATIVE_INFINITY;
  s.walkCount = 0;
}

/**
 * しゃがみ歩きから止まらずに立ち上がったことを，帯域通過後の山の大きさの変わり方で見る（1 サンプルごとに呼ぶ）．
 * t は時刻（ms），bp は帯域通過後の上下の加速度（m/s^2），lastStepT は足踏みの判定が最後に歩を数えた時刻（ms），
 * walking は歩いている（仮に歩くを含む）か，gyroHighT は頭が速く回った最後の時刻（ms．足踏みの判定と同じしきい値）．
 * 足踏みの判定の山は使わない（しゃがんでいる時の T_high は立った足踏みの山より大きくなりうるため，立った後の歩を数えない）．
 *
 * 条件（しゃがんでいて，standWalkBoundary が NaN でない時だけ）:
 * - 山: 帯域通過後の値が floor = 0.5 × min(Ps, Pc) を超えてから floor × 0.3 を下回るまでの最大値 P（Ps・Pc は
 *   standWalkPeakStanding・standWalkPeakCrouching）
 * - 境目 B = √(Ps × Pc)．立った足踏みの側は，Pc > Ps なら 0.7 × Ps ≤ P < B（0.7 × Ps 未満の山は見ない），
 *   Pc < Ps なら P > B
 * - しゃがみ歩きの側の山・頭が速く回った山（山の stepGyroWindowMs 前から後）は数を 0 に戻す
 * - 立った足踏みの側の山は，前の山から stepRefractoryMs 未満なら見ない（大きな山の後の揺れ），
 *   前に数えた歩から stepStopMaxMs を超えて空いたら数え直す．数え始めは，歩いている間か，最後に数えた歩から
 *   STAND_WALK_RECENT_MS 以内の時だけ（しゃがんで静止の間の揺れから数え始めない）
 * - 数が standWalkSteps に届いたら立つ（結果は "stand-walk"）
 * 戻り値は姿勢が変わったか
 */
export function updateStandWalk(
  s: PostureState,
  t: number,
  bp: number,
  lastStepT: number,
  walking: boolean,
  gyroHighT: number,
  params: PostureParams,
): boolean {
  const boundary = standWalkBoundary(params);
  if (s.posture !== "crouching" || Number.isNaN(boundary)) {
    if (s.walkPeakIn || s.walkCount !== 0) resetStandWalk(s);
    return false;
  }
  if (!Number.isFinite(bp)) return false;
  const ps = params.standWalkPeakStanding;
  const pc = params.standWalkPeakCrouching;
  const floor = STAND_WALK_FLOOR_RATIO * Math.min(ps, pc);
  if (!s.walkPeakIn) {
    if (bp > floor) {
      s.walkPeakIn = true;
      s.walkPeakValue = bp;
      s.walkPeakT = t;
    }
    return false;
  }
  if (bp > s.walkPeakValue) {
    s.walkPeakValue = bp;
    s.walkPeakT = t;
  }
  if (bp >= floor * STAND_WALK_EXIT_RATIO) return false;

  // 山が終わった
  s.walkPeakIn = false;
  const peak = s.walkPeakValue;
  const peakT = s.walkPeakT;
  const sincePrev = peakT - s.walkLastPeakT;
  s.walkLastPeak = peak;
  const standingSide = pc > ps ? peak < boundary : peak > boundary;
  // しゃがみ歩きの山の方が大きい人では，立った足踏みより十分に小さい山（止まる時の弱まっていく揺れ）は見ない
  if (standingSide && pc > ps && peak < STAND_WALK_MIN_PEAK_RATIO * ps) return false;
  if (!standingSide || gyroHighT >= peakT - params.stepGyroWindowMs) {
    s.walkCount = 0;
    s.walkLastPeakT = peakT;
    return false;
  }
  // 前の山の直後の小さな揺れは歩として見ない（前の山の時刻も動かさない）
  if (sincePrev < params.stepRefractoryMs) return false;
  s.walkLastPeakT = peakT;
  if (s.walkCount > 0 && sincePrev > params.stepStopMaxMs) s.walkCount = 0;
  if (s.walkCount === 0 && !walking && !(t - lastStepT <= STAND_WALK_RECENT_MS)) return false;
  s.walkCount++;
  if (s.walkCount < params.standWalkSteps) return false;
  setPosture(s, "standing", "stand-walk", t);
  // 立った時の動作の途中（積分）は捨てる（同じ動作で立ったことを二重に数えない）
  resetPostureMotion(s);
  return true;
}
