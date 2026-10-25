// ロビーのナレーションの仮実装（Web Speech API の読み上げ）．
// audio/ ができたら，Cue の narration と音声ファイルに置き換える．
// 声は share/speechVoice.ts で日本語の質の良い声を選ぶ（無ければ声を指定せず端末の既定で読む）

import { createVoicePicker, toSpeechText, type VoicePicker } from "../share/speechVoice";

/** 読み上げの速さ（SpeechSynthesisUtterance.rate）．速すぎると機械的に聞こえるため等倍 */
export const NARRATION_RATE = 1.0;

/** 読み上げの声の高さ（SpeechSynthesisUtterance.pitch） */
export const NARRATION_PITCH = 1.0;

let voicePicker: VoicePicker<SpeechSynthesisVoice> | null = null;

function synth(): SpeechSynthesis | null {
  return typeof window !== "undefined" && "speechSynthesis" in window
    ? window.speechSynthesis
    : null;
}

/** iOS では最初の読み上げをタップの処理の中で行う必要があるため，開始画面のボタンで空の文を読む */
export function unlockNarration(): void {
  const s = synth();
  if (s === null) return;
  try {
    s.speak(new SpeechSynthesisUtterance(""));
  } catch {
    // 読み上げが使えなくても画面の表示で進められる
  }
}

/**
 * 文を読み上げる．前の読み上げは止める．
 * onEnd は読み上げが終わった（end）か失敗した（error．止めた時も含む）時に 1 回だけ呼ぶ．
 * 読み上げを始められなかった時は false を返し，onEnd は呼ばない（呼ぶ側がすぐ終わった扱いにする）．
 * end が来ない端末もあるため，呼ぶ側は上限の時間でも先へ進むこと（narrationPacing.ts）
 */
export function narrate(text: string, onEnd?: () => void): boolean {
  const s = synth();
  if (s === null) return false;
  try {
    s.cancel();
    const utterance = new SpeechSynthesisUtterance(toSpeechText(text));
    utterance.lang = "ja-JP";
    utterance.rate = NARRATION_RATE;
    utterance.pitch = NARRATION_PITCH;
    voicePicker ??= createVoicePicker<SpeechSynthesisVoice>(s);
    const voice = voicePicker.current();
    if (voice !== null) utterance.voice = voice;
    if (onEnd !== undefined) {
      let called = false;
      const finish = (): void => {
        if (called) return;
        called = true;
        onEnd();
      };
      utterance.addEventListener("end", finish);
      utterance.addEventListener("error", finish);
    }
    s.speak(utterance);
    return true;
  } catch {
    // 同上
    return false;
  }
}

export function stopNarration(): void {
  synth()?.cancel();
}
