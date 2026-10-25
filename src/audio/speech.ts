// 端末の読み上げ機能（speechSynthesis）の薄い殻．読み上げが無い端末では speak が false を返す．
// 声は share/speechVoice.ts で日本語の質の良い声を選ぶ（無ければ声を指定せず端末の既定で読む）

import { createVoicePicker, toSpeechText, type VoicePicker } from "../share/speechVoice";

/** 読み上げの口（テスト・dev 用に差し替えられるよう，必要な操作だけにする） */
export interface SpeechPort {
  /**
   * 文を読み上げる（前の読み上げは止める）．onEnd は end か error の時に 1 回だけ呼ぶ．
   * 読み上げを始められなかった時は false を返し，onEnd は呼ばない．pitch は声の高さ（既定 1）
   */
  speak(text: string, rate: number, onEnd: () => void, pitch?: number): boolean;
  cancel(): void;
}

function synth(): SpeechSynthesis | null {
  return typeof window !== "undefined" && "speechSynthesis" in window
    ? window.speechSynthesis
    : null;
}

let voicePicker: VoicePicker<SpeechSynthesisVoice> | null = null;

/** 選んだ日本語の声（一覧がまだ届いていない・日本語の声が無ければ null） */
function pickedVoice(s: SpeechSynthesis): SpeechSynthesisVoice | null {
  voicePicker ??= createVoicePicker<SpeechSynthesisVoice>(s);
  return voicePicker.current();
}

export function createSpeech(): SpeechPort {
  return {
    speak(text, rate, onEnd, pitch = 1) {
      const s = synth();
      if (s === null || typeof SpeechSynthesisUtterance === "undefined") return false;
      try {
        s.cancel();
        const utterance = new SpeechSynthesisUtterance(toSpeechText(text));
        utterance.lang = "ja-JP";
        utterance.rate = rate;
        utterance.pitch = pitch;
        const voice = pickedVoice(s);
        if (voice !== null) utterance.voice = voice;
        let called = false;
        const finish = (): void => {
          if (called) return;
          called = true;
          onEnd();
        };
        utterance.addEventListener("end", finish);
        utterance.addEventListener("error", finish);
        s.speak(utterance);
        return true;
      } catch {
        return false;
      }
    },
    cancel() {
      try {
        synth()?.cancel();
      } catch {
        // 止められなくても次の speak の前にもう一度止める
      }
    },
  };
}

/**
 * iOS では最初の読み上げをタップの処理の中で行う必要があるため，タップの中で空の文を読む
 * （?app では開始画面の lobby/ が行う．dev 用の単独起動で使う）
 */
export function unlockSpeech(): void {
  const s = synth();
  if (s === null || typeof SpeechSynthesisUtterance === "undefined") return;
  try {
    s.speak(new SpeechSynthesisUtterance(""));
  } catch {
    // 読み上げが使えなくても時間で進む
  }
}
