// audio/ が受け付ける音とナレーションの ID．定義は core/audioIds.ts にあり，ここは audio/ の中で使う判定を足すだけ
import { NARRATION_ID, type NarrationId, SOUND_ID, type SoundId } from "../core/audioIds";

export {
  NARRATION_ID,
  type NarrationId,
  narrationEndedSignal,
  SOUND_ID,
  type SoundId,
} from "../core/audioIds";

const SOUND_IDS: ReadonlySet<string> = new Set(Object.values(SOUND_ID));
const NARRATION_IDS: ReadonlySet<string> = new Set(Object.values(NARRATION_ID));

/** audio/ が鳴らし方を持つ効果音の ID か */
export function isSoundId(id: string): id is SoundId {
  return SOUND_IDS.has(id);
}

/** audio/ が文面を持つナレーションの ID か */
export function isNarrationId(id: string): id is NarrationId {
  return NARRATION_IDS.has(id);
}
