// ロビーのナレーションの仮実装（Web Speech API の読み上げ）．
// audio/ ができたら，Cue の narration と音声ファイルに置き換える

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

/** 文を読み上げる．前の読み上げは止める */
export function narrate(text: string): void {
  const s = synth();
  if (s === null) return;
  try {
    s.cancel();
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.lang = "ja-JP";
    utterance.rate = 1.05;
    s.speak(utterance);
  } catch {
    // 同上
  }
}

export function stopNarration(): void {
  synth()?.cancel();
}
