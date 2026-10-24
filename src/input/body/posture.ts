// しゃがみ・立ち上がりの判定（experiment_山﨑/05）．
// ① 動作の候補: 静止の後に，ノイズより大きい同じ向きの上下の加速度が約 0.1 秒続く
// ② 短い積分: 候補の始まりから加速度を 2 回積分して沈んだ量 Δh を求める（最長約 1.5 秒）
// ③ ZUPT: 加速度・角速度・積分中の速度が小さい状態が約 0.15 秒続いたら静止とみなし，積分を終える
// ④ 確定: Δh がしゃがみの深さの約 50% を超えたら姿勢を切り替える
// 静止してから確定するため，しゃがみ歩きの揺れ（上へ動いてもすぐ下に戻る）を立ち上がりと取り違えない．
// 立ち上がりを見逃した時の逃げ道は案 A（しゃがんだまま，立っている時の大きさの足踏みが続いたら立つ）
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
  /** 積分が長すぎたので捨てた */
  | "timeout";

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
  /** 静止が続き始めた時刻（ms）．静止していなければ NaN（積分中の ZUPT 用） */
  stillSinceT: number;
  /** 動作の候補の前の静止が続き始めた時刻（ms）．静止していなければ NaN */
  restSinceT: number;
  /** 最後に静止が終わった時刻（ms）と，その静止の長さ（ms） */
  restEndT: number;
  restMs: number;
  /** 静止時の上下の加速度の 2 乗の平均（指数移動平均） */
  noiseVar: number;
  /** 案 A: しゃがんだまま立っている時の大きさの歩が続いた数 */
  escapeCount: number;
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
    stillSinceT: Number.NaN,
    restSinceT: Number.NaN,
    restEndT: Number.NEGATIVE_INFINITY,
    restMs: 0,
    noiseVar: 0,
    escapeCount: 0,
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
  s.stillSinceT = Number.NaN;
  s.restSinceT = Number.NaN;
  s.restEndT = Number.NEGATIVE_INFINITY;
  s.restMs = 0;
  s.escapeCount = 0;
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
>;

/** 加速度・角速度が静止とみなせるほど小さいか（角速度が無い端末では加速度だけで見る） */
function isQuiet(av: number, gyro: number, params: PostureParams): boolean {
  return Math.abs(av) < params.zuptAccel && (!Number.isFinite(gyro) || gyro < params.zuptGyroDps);
}

/**
 * 静止が終わってからこの時間（ms）の間は「静止の後」とみなす．
 * 動作の加速度は 0 から少しずつ大きくなるため，静止の条件を外れてから候補のしきい値を超えるまでに少し間がある
 */
const REST_GRACE_MS = 300;

/** 静止時のノイズの見積もりの時定数（秒） */
const NOISE_TAU_SEC = 2;

/** 動作の候補とみなす加速度の大きさ（m/s^2） */
export function candidateThreshold(s: PostureState, params: PostureParams): number {
  return Math.max(
    params.postureCandidateAccel,
    params.postureNoiseFactor * Math.sqrt(Math.max(0, s.noiseVar)),
  );
}

function setPosture(s: PostureState, posture: Posture, outcome: PostureOutcome, t: number): void {
  if (s.posture !== posture) s.changeCount++;
  s.posture = posture;
  s.lastOutcome = outcome;
  s.lastOutcomeT = t;
  s.escapeCount = 0;
}

/** 静止した時に Δh で姿勢を決める */
function finishMotion(s: PostureState, t: number, params: PostureParams): void {
  const durationSec = Math.max(0, (t - s.startT) / 1000);
  // 速度は静止で 0 のはず．残った速度は一定の偏りが溜まったとみなし，高さから差し引く（0.5 × v × T）
  const dh = s.h - 0.5 * s.v * durationSec;
  const threshold = params.postureConfirmRatio * params.crouchDepthM;
  s.lastDeltaH = dh;
  if (s.posture === "standing" && dh <= -threshold) setPosture(s, "crouching", "crouch", t);
  else if (s.posture === "crouching" && dh >= threshold) setPosture(s, "standing", "stand", t);
  else {
    s.lastOutcome = "small";
    s.lastOutcomeT = t;
  }
  resetPostureMotion(s);
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

  if (s.phase === "idle") {
    // 静止の続いた長さを追う
    if (isQuiet(av, gyro, params)) {
      if (Number.isNaN(s.restSinceT)) s.restSinceT = t;
    } else if (!Number.isNaN(s.restSinceT)) {
      s.restEndT = t;
      s.restMs = t - s.restSinceT;
      s.restSinceT = Number.NaN;
    }
    // 十分な長さの静止の直後か（静止の途中を含む）
    const restedBefore =
      params.postureRestBeforeMs <= 0 ||
      (!Number.isNaN(s.restSinceT) && t - s.restSinceT >= params.postureRestBeforeMs) ||
      (s.restMs >= params.postureRestBeforeMs && t - s.restEndT <= REST_GRACE_MS);
    if (Math.abs(av) < th || !restedBefore) {
      if (Math.abs(av) < th) {
        const k = 1 - Math.exp(-dtSec / NOISE_TAU_SEC);
        s.noiseVar += (av * av - s.noiseVar) * k;
      }
      return false;
    }
    s.phase = "candidate";
    s.sign = av > 0 ? 1 : -1;
    s.startT = t - dtSec * 1000;
    s.v = 0;
    s.h = 0;
    s.stillSinceT = Number.NaN;
  }

  // 積分（半陰的オイラー）
  s.v += av * dtSec;
  s.h += s.v * dtSec;

  if (s.phase === "candidate") {
    // 同じ向きで，しきい値の半分より大きい間だけ候補を続ける（しきい値の上下の揺れで切らない）
    if (av * s.sign < th * 0.5) {
      resetPostureMotion(s);
      return false;
    }
    if (t - s.startT >= params.postureCandidateMs) s.phase = "integrating";
    return false;
  }

  // integrating
  if (t - s.startT > params.postureMaxIntegrateMs) {
    s.lastDeltaH = s.h;
    s.lastOutcome = "timeout";
    s.lastOutcomeT = t;
    resetPostureMotion(s);
    return false;
  }
  const still = isQuiet(av, gyro, params) && Math.abs(s.v) < params.zuptMaxVelocity;
  if (!still) {
    s.stillSinceT = Number.NaN;
    return false;
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
  if (s.phase === "integrating" && Math.abs(s.h) > params.postureStepSuppressM) return true;
  return (
    t - s.lastOutcomeT < params.postureStepSuppressAfterMs &&
    Math.abs(s.lastDeltaH) > params.postureStepSuppressM &&
    s.lastOutcome !== "stand-escape"
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
