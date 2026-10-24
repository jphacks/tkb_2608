// ホームの設定（音量の確認）で非常ベルを短く鳴らす殻．app/ が作って lobby/ のホームに渡す

import { SOUND_ID } from "./audioIds";
import { createSoundEngine } from "./soundEngine";

/** 確認用に鳴らす非常ベルの長さ（s） */
export const ALARM_SAMPLE_SECONDS = 2.5;

export interface AlarmSample {
  /** delaySeconds 秒（s）後から非常ベルを ALARM_SAMPLE_SECONDS 秒鳴らす */
  play(delaySeconds: number): void;
  /** 鳴っている・予定した音を止める（何度呼んでもよい） */
  stop(): void;
}

/** getContext は開始画面で再開済みの AudioContext を返す（無ければ null で何も鳴らさない） */
export function createAlarmSample(getContext: () => AudioContext | null): AlarmSample {
  const engine = createSoundEngine(getContext);
  return {
    play(delaySeconds) {
      engine.play(SOUND_ID.fireAlarm, {
        loop: true,
        delaySeconds,
        durationSeconds: ALARM_SAMPLE_SECONDS,
      });
    },
    stop() {
      engine.dispose();
    },
  };
}
