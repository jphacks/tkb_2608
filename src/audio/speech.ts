// 端末の読み上げ機能（speechSynthesis）の薄い殻．読み上げが無い端末では speak が false を返す

/** 読み上げの口（テスト・dev 用に差し替えられるよう，必要な操作だけにする） */
export interface SpeechPort {
  /**
   * 文を読み上げる（前の読み上げは止める）．onEnd は end か error の時に 1 回だけ呼ぶ．
   * 読み上げを始められなかった時は false を返し，onEnd は呼ばない
   */
  speak(text: string, rate: number, onEnd: () => void): boolean;
  cancel(): void;
}

function synth(): SpeechSynthesis | null {
  return typeof window !== "undefined" && "speechSynthesis" in window
    ? window.speechSynthesis
    : null;
}

export function createSpeech(): SpeechPort {
  return {
    speak(text, rate, onEnd) {
      const s = synth();
      if (s === null || typeof SpeechSynthesisUtterance === "undefined") return false;
      try {
        s.cancel();
        const utterance = new SpeechSynthesisUtterance(text);
        utterance.lang = "ja-JP";
        utterance.rate = rate;
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
