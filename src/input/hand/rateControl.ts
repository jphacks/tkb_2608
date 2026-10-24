// 全体の fps に応じて手の認識の頻度を下げ・上げする純粋な関数（experiment_山﨑/07「負荷に応じた頻度の調整」）．
// 下げるのは早く，上げるのはゆっくり（行ったり来たりしない）．熱で遅くなった時も描画の fps を守る

export interface RateControlParams {
  /** 頻度の段階（回/秒．高い順） */
  readonly rateLevelsHz: readonly number[];
  readonly rateDownFps: number;
  readonly rateUpFps: number;
  readonly rateDownHoldMs: number;
  readonly rateUpHoldMs: number;
}

export interface RateControlState {
  /** 今の段階（rateLevelsHz の番号） */
  readonly level: number;
  /** fps の指数移動平均（まだ無ければ NaN） */
  readonly fps: number;
  /** 最後に描画のフレームを受け取った時刻（ms） */
  readonly lastT: number;
  /** 下げる・上げる条件を満たし始めた時刻（ms．満たしていなければ NaN） */
  readonly lowSince: number;
  readonly highSince: number;
}

export const INITIAL_RATE_CONTROL: RateControlState = {
  level: 0,
  fps: Number.NaN,
  lastT: Number.NaN,
  lowSince: Number.NaN,
  highSince: Number.NaN,
};

/** fps の平均の時定数（ms） */
const FPS_TAU_MS = 500;
/** これより長いフレームの間隔（ms）はタブが裏に回った等として数えない */
const MAX_FRAME_GAP_MS = 500;

/** 描画のフレームの時刻 now（ms）を受け取って状態を進める */
export function stepRateControl(
  s: RateControlState,
  now: number,
  p: RateControlParams,
): RateControlState {
  if (!Number.isFinite(now)) return s;
  const dt = now - s.lastT;
  if (!(dt > 0) || dt > MAX_FRAME_GAP_MS) {
    return { ...s, lastT: now, lowSince: Number.NaN, highSince: Number.NaN };
  }
  const inst = 1000 / dt;
  const k = 1 - Math.exp(-dt / FPS_TAU_MS);
  const fps = Number.isNaN(s.fps) ? inst : s.fps + (inst - s.fps) * k;
  const maxLevel = Math.max(0, p.rateLevelsHz.length - 1);
  let level = Math.min(Math.max(0, s.level), maxLevel);
  let lowSince = fps < p.rateDownFps ? (Number.isNaN(s.lowSince) ? now : s.lowSince) : Number.NaN;
  let highSince = fps > p.rateUpFps ? (Number.isNaN(s.highSince) ? now : s.highSince) : Number.NaN;
  if (!Number.isNaN(lowSince) && now - lowSince >= p.rateDownHoldMs && level < maxLevel) {
    level++;
    lowSince = Number.NaN;
  } else if (!Number.isNaN(highSince) && now - highSince >= p.rateUpHoldMs && level > 0) {
    level--;
    highSince = Number.NaN;
  }
  return { level, fps, lastT: now, lowSince, highSince };
}

/** 今の段階の頻度（回/秒）．段階が無ければ 10 */
export function rateHz(s: RateControlState, p: Pick<RateControlParams, "rateLevelsHz">): number {
  const levels = p.rateLevelsHz;
  if (levels.length === 0) return 10;
  return levels[Math.min(Math.max(0, s.level), levels.length - 1)];
}
