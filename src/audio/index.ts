// audio/ の公開窓口（app/ はここから import する）
export { type AlarmSample, createAlarmSample } from "./alarmSample";
export {
  isNarrationId,
  isSoundId,
  NARRATION_ID,
  type NarrationId,
  narrationEndedSignal,
  SOUND_ID,
  type SoundId,
} from "./audioIds";
export { createDrillAudio, type DrillAudio, type DrillAudioOptions } from "./drillAudio";
export { buildNarration, NARRATION_SCRIPTS } from "./narrationText";
export { type SpeechPort, unlockSpeech } from "./speech";
