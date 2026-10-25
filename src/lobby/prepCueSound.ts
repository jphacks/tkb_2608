// キャリブレーションの準備の合図（3・2・1 と計測の始まり）の短い音を Web Audio で鳴らす（ブラウザ API の薄い殻．
// いつ鳴らすかは calibration.ts の prepSignal）．音を出せない時（AudioContext が無い・止まっている）は何もしない

import type { PrepSignal } from "./calibration";

/** 合図の音の高さ（Hz）・長さ（s）・音量（0〜1）．数字は低め，始まりは高く長めにして聞き分けられるようにする */
const TONE: Readonly<
  Record<PrepSignal, { readonly hz: number; readonly seconds: number; readonly gain: number }>
> = {
  tick: { hz: 880, seconds: 0.1, gain: 0.25 },
  go: { hz: 1320, seconds: 0.35, gain: 0.3 },
};

/** 準備の合図を鳴らす殻 */
export interface PrepCueSound {
  play(signal: PrepSignal): void;
}

/** getContext は開始画面で再開済みの AudioContext を返す（無ければ null） */
export function createPrepCueSound(getContext: () => AudioContext | null): PrepCueSound {
  return {
    play(signal) {
      const context = getContext();
      if (context === null || context.state !== "running") return;
      try {
        const tone = TONE[signal];
        const osc = context.createOscillator();
        const gain = context.createGain();
        const t = context.currentTime;
        const end = t + tone.seconds;
        osc.frequency.value = tone.hz;
        // 立ち上がり・終わりをなめらかにしてクリック音を避ける
        gain.gain.setValueAtTime(0, t);
        gain.gain.linearRampToValueAtTime(tone.gain, t + 0.01);
        gain.gain.setValueAtTime(tone.gain, Math.max(t + 0.01, end - 0.02));
        gain.gain.linearRampToValueAtTime(0, end);
        osc.connect(gain).connect(context.destination);
        osc.start(t);
        osc.stop(end + 0.01);
        osc.addEventListener("ended", () => {
          osc.disconnect();
          gain.disconnect();
        });
      } catch {
        // 音が鳴らなくても指示板の数字で進められる
      }
    },
  };
}
