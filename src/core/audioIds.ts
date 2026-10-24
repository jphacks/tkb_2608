// 音（audio/）が鳴らせる効果音とナレーションの ID の一覧と，それを鳴らす Cue を作る関数．
// どの担当も bus.emit({ type: "cue", cue: soundCue(...) }) のように流せば audio/ が鳴らす（docs/04_SPEC/SPEC_01）
import type { Cue, CueParams } from "./cue";

/** 効果音・環境音の ID（Cue の sound の id） */
export const SOUND_ID = {
  /** 教室の環境音（話し声のざわめきと時々の物音．ループ） */
  classroomAmbience: "classroom-ambience",
  /** 学校の非常ベル（連続したベル．ループ） */
  fireAlarm: "fire-alarm",
  /** 炎の燃える音（低いうなりとパチパチ．ループ） */
  fireBurning: "fire-burning",
  /** 火に近づいた時の警告音（短い「ピピピ」．1 回だけ．loop は無視される） */
  nearFireWarning: "near-fire-warning",
  /** 校内放送の前のチャイム（上がる 4 音．1 回だけ．fire-announcement の前に audio/ が自分で鳴らす） */
  announcementChimeStart: "announcement-chime-start",
  /** 校内放送の後のチャイム（下がる 4 音．1 回だけ．fire-announcement の後に audio/ が自分で鳴らす） */
  announcementChimeEnd: "announcement-chime-end",
} as const;

export type SoundId = (typeof SOUND_ID)[keyof typeof SOUND_ID];

/** ナレーションの ID（Cue の narration の id） */
export const NARRATION_ID = {
  /** ① 授業中の教室の導入 */
  classroomIntro: "classroom-intro",
  /** ② 校内放送（params.roomName に火元の名前．無ければ場所を省いた文） */
  fireAnnouncement: "fire-announcement",
  /** ③ 避難の始まり */
  evacuateStart: "evacuate-start",
  /** 締め */
  ending: "drill-ending",
} as const;

export type NarrationId = (typeof NARRATION_ID)[keyof typeof NARRATION_ID];

/** ナレーションが終わった時に audio/ が流す signal（GameEvent の signal）の名前 */
export function narrationEndedSignal(id: string): string {
  return `narration-ended:${id}`;
}

/**
 * 効果音を鳴らす・止める Cue を作る．loop を省くと音ごとの既定（環境音・ベル・炎はループ）．
 * anchorId は鳴らす物の ID（立体音響．今はまだ使われない）
 */
export function soundCue(
  id: SoundId,
  action: "play" | "stop",
  options: { readonly loop?: boolean; readonly anchorId?: string } = {},
): Cue {
  return {
    type: "sound",
    id,
    action,
    ...(options.loop !== undefined ? { loop: options.loop } : {}),
    ...(options.anchorId !== undefined ? { anchorId: options.anchorId } : {}),
  };
}

/** ナレーションを読む Cue を作る（params は文面に差し込む値．例: { roomName: "3年1組" }） */
export function narrationCue(id: NarrationId, params?: CueParams): Cue {
  return params === undefined ? { type: "narration", id } : { type: "narration", id, params };
}
