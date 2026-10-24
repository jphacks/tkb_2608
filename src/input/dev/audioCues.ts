// dev ページの音の合図（Web Audio のビープ音と speechSynthesis の読み上げ）．
// iOS では音もタップの中で一度鳴らさないと出ないため，unlock() をボタンの click の中で呼ぶ
export class AudioCues {
  private ctx: AudioContext | null = null;

  /** タップの中で呼ぶ．AudioContext を作って再開し，読み上げも空の発話で有効にする */
  unlock(): void {
    try {
      if (this.ctx === null) this.ctx = new AudioContext();
      void this.ctx.resume();
    } catch {
      this.ctx = null;
    }
    if (typeof speechSynthesis !== "undefined") {
      const u = new SpeechSynthesisUtterance("");
      u.lang = "ja-JP";
      speechSynthesis.speak(u);
    }
  }

  /** ビープ音を鳴らす */
  beep(frequency: number, durationMs: number, volume = 0.3): void {
    const ctx = this.ctx;
    if (ctx === null) return;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    const t = ctx.currentTime;
    const end = t + durationMs / 1000;
    osc.frequency.value = frequency;
    // 立ち上がり・終わりを短くなめらかにして，クリック音を避ける
    gain.gain.setValueAtTime(0, t);
    gain.gain.linearRampToValueAtTime(volume, t + 0.01);
    gain.gain.setValueAtTime(volume, Math.max(t + 0.01, end - 0.02));
    gain.gain.linearRampToValueAtTime(0, end);
    osc.connect(gain).connect(ctx.destination);
    osc.start(t);
    osc.stop(end + 0.01);
  }

  /** 読み上げる（前の読み上げは止める） */
  speak(text: string): void {
    if (typeof speechSynthesis === "undefined") return;
    speechSynthesis.cancel();
    const u = new SpeechSynthesisUtterance(text);
    u.lang = "ja-JP";
    u.rate = 1.1;
    speechSynthesis.speak(u);
  }

  cancelSpeech(): void {
    if (typeof speechSynthesis !== "undefined") speechSynthesis.cancel();
  }
}
