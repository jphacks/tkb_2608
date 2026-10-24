// 効果音ごとの鳴らし方の約束（ループできるか・1 回だけの時の長さ・ナレーションの間に小さくするか）と，
// Cue の loop から実際の鳴らし方を決める純粋な関数．音の合成そのものは synths.ts

import type { SoundId } from "./audioIds";

/** 1 つの効果音の鳴らし方の約束 */
export interface SoundDefinition {
  /** ループで鳴らせるか（false の音は Cue の loop が true でも 1 回だけ鳴らす） */
  readonly loopable: boolean;
  /** Cue に loop が無い時にループで鳴らすか */
  readonly defaultLoop: boolean;
  /** 切れ目の無い音（環境音・ベル）を 1 回だけ鳴らす時の長さ（s） */
  readonly oneShotSeconds: number;
  /** ナレーションの間は小さくするか（読み上げを聞き取りやすくするため．読み上げ自体の音量は変えられない） */
  readonly duckDuringNarration: boolean;
}

/** 効果音の ID → 鳴らし方の約束 */
export const SOUND_DEFINITIONS: Readonly<Record<SoundId, SoundDefinition>> = {
  "classroom-ambience": {
    loopable: true,
    defaultLoop: true,
    oneShotSeconds: 4,
    duckDuringNarration: true,
  },
  "fire-alarm": { loopable: true, defaultLoop: true, oneShotSeconds: 3, duckDuringNarration: true },
  "fire-burning": {
    loopable: true,
    defaultLoop: true,
    oneShotSeconds: 3,
    duckDuringNarration: true,
  },
  "near-fire-warning": {
    loopable: false,
    defaultLoop: false,
    oneShotSeconds: 0.5,
    duckDuringNarration: false,
  },
  "announcement-chime-start": {
    loopable: false,
    defaultLoop: false,
    oneShotSeconds: 2.5,
    duckDuringNarration: false,
  },
  "announcement-chime-end": {
    loopable: false,
    defaultLoop: false,
    oneShotSeconds: 2.5,
    duckDuringNarration: false,
  },
};

/** Cue の loop（省略可）から，ループで鳴らすかを決める．ループできない音は常に false */
export function resolveLoop(definition: SoundDefinition, cueLoop: boolean | undefined): boolean {
  if (!definition.loopable) return false;
  return cueLoop ?? definition.defaultLoop;
}

/**
 * 音を止める時刻（AudioContext の時刻．s）．null は止めない（stop が来るまで鳴らし続ける）．
 * @param startAt 鳴らし始める時刻（s）
 * @param synthEnd 合成した音がひとりでに終わる時刻（s）．切れ目の無い音は null
 * @param durationSeconds 長さの指定（s．確認用の音等）．有限の正の数の時だけ使う
 */
export function resolveStopAt(
  definition: SoundDefinition,
  loop: boolean,
  startAt: number,
  synthEnd: number | null,
  durationSeconds?: number,
): number | null {
  if (durationSeconds !== undefined && Number.isFinite(durationSeconds) && durationSeconds > 0) {
    const limit = startAt + durationSeconds;
    return synthEnd === null ? limit : Math.min(limit, synthEnd);
  }
  if (synthEnd !== null) return synthEnd;
  return loop ? null : startAt + definition.oneShotSeconds;
}
