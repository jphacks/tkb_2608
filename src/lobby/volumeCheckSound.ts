// 設定の「音量」で流す効果音の例を Web Audio で合成して鳴らす（ブラウザ API の薄い殻．いつ鳴らすかは volumeCheck.ts）．
// 外部の音声ファイルは使わない．audio/ ができたら，そちらの効果音に置き換える

import type { VolumeCueKind } from "./volumeCheck";

/** 効果音の例を鳴らす殻 */
export interface VolumeCheckSound {
  /**
   * kind の音を delaySeconds 秒（s）後から鳴らす（Web Audio の時刻で予定する）．
   * AudioContext が無い・動いていない時は何もしない
   */
  play(kind: VolumeCueKind, delaySeconds?: number): void;
  /** 鳴っている音と，予定した音をすべて止める（何度呼んでもよい） */
  stop(): void;
}

/** 全体の音量（0〜1）．本体の音量を合わせる基準になるため固定にし，大きすぎない値にする */
const MASTER_GAIN = 0.35;

/** 警報: 高い音と低い音を交互に鳴らす（Hz・秒） */
const ALARM = { highHz: 880, lowHz: 660, toneSeconds: 0.18, gapSeconds: 0.06, pairs: 3, gain: 0.5 };

/** 揺れ: 低域だけを通した雑音を，ゆっくり強弱を付けて鳴らす（Hz・秒） */
const RUMBLE = {
  seconds: 2.5,
  attackSeconds: 0.4,
  releaseSeconds: 0.6,
  cutoffHz: 220,
  gain: 0.9,
  wobbleHz: 6,
  wobbleDepth: 0.35,
  /** 雑音に重ねる低い音（スマホのスピーカーでも聞こえる程度の高さ）．Hz */
  toneHz: 90,
  toneGain: 0.25,
};

/**
 * 効果音の例の殻を作る．getContext は開始画面で再開済みの AudioContext を返す（無ければ null）
 */
export function createVolumeCheckSound(getContext: () => AudioContext | null): VolumeCheckSound {
  let master: GainNode | null = null;
  let sources: AudioScheduledSourceNode[] = [];
  let noise: { context: AudioContext; buffer: AudioBuffer } | null = null;

  const runningContext = (): AudioContext | null => {
    const context = getContext();
    if (context === null) return null;
    if (context.state !== "running") {
      // タブの切り替え等で止まっていたら再開を試みる（iOS ではタップの外だと再開できないことがある．その時は案内だけ）
      context.resume().catch(() => undefined);
      return null;
    }
    return context;
  };

  const ensureMaster = (context: AudioContext): GainNode => {
    if (master !== null && master.context === context) return master;
    const gain = context.createGain();
    gain.gain.value = MASTER_GAIN;
    gain.connect(context.destination);
    master = gain;
    return gain;
  };

  const noiseBuffer = (context: AudioContext): AudioBuffer => {
    if (noise !== null && noise.context === context) return noise.buffer;
    const length = Math.ceil(context.sampleRate * RUMBLE.seconds);
    const buffer = context.createBuffer(1, length, context.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < length; i++) data[i] = Math.random() * 2 - 1;
    noise = { context, buffer };
    return buffer;
  };

  const track = (source: AudioScheduledSourceNode): void => {
    sources.push(source);
    source.onended = () => {
      sources = sources.filter((s) => s !== source);
    };
  };

  const playAlarm = (context: AudioContext, out: GainNode, t0: number): void => {
    const osc = context.createOscillator();
    osc.type = "triangle";
    const env = context.createGain();
    env.gain.setValueAtTime(0, t0);
    const step = ALARM.toneSeconds + ALARM.gapSeconds;
    for (let i = 0; i < ALARM.pairs * 2; i++) {
      const start = t0 + i * step;
      osc.frequency.setValueAtTime(i % 2 === 0 ? ALARM.highHz : ALARM.lowHz, start);
      // 切り替えの「ぷつっ」という音を避けるため，短く立ち上げ・立ち下げる
      env.gain.setValueAtTime(0, start);
      env.gain.linearRampToValueAtTime(ALARM.gain, start + 0.01);
      env.gain.setValueAtTime(ALARM.gain, start + ALARM.toneSeconds - 0.01);
      env.gain.linearRampToValueAtTime(0, start + ALARM.toneSeconds);
    }
    osc.connect(env);
    env.connect(out);
    osc.start(t0);
    osc.stop(t0 + ALARM.pairs * 2 * step);
    track(osc);
  };

  const playRumble = (context: AudioContext, out: GainNode, t0: number): void => {
    const end = t0 + RUMBLE.seconds;
    const env = context.createGain();
    env.gain.setValueAtTime(0, t0);
    env.gain.linearRampToValueAtTime(RUMBLE.gain, t0 + RUMBLE.attackSeconds);
    env.gain.setValueAtTime(RUMBLE.gain, end - RUMBLE.releaseSeconds);
    env.gain.linearRampToValueAtTime(0, end);
    // 揺れの強弱: env の後段の gain を 1 ± wobbleDepth で揺らす（大きさに比例した強弱になる）
    const wobble = context.createOscillator();
    wobble.frequency.value = RUMBLE.wobbleHz;
    const wobbleDepth = context.createGain();
    wobbleDepth.gain.value = RUMBLE.wobbleDepth;
    wobble.connect(wobbleDepth);
    const wobbled = context.createGain();
    wobbled.gain.value = 1;
    wobbleDepth.connect(wobbled.gain);

    const source = context.createBufferSource();
    source.buffer = noiseBuffer(context);
    const filter = context.createBiquadFilter();
    filter.type = "lowpass";
    filter.frequency.value = RUMBLE.cutoffHz;
    source.connect(filter);
    filter.connect(env);

    const tone = context.createOscillator();
    tone.type = "sine";
    tone.frequency.value = RUMBLE.toneHz;
    const toneGain = context.createGain();
    toneGain.gain.value = RUMBLE.toneGain;
    tone.connect(toneGain);
    toneGain.connect(env);

    env.connect(wobbled);
    wobbled.connect(out);
    for (const s of [source, tone, wobble]) {
      s.start(t0);
      s.stop(end);
      track(s);
    }
  };

  return {
    play(kind, delaySeconds = 0) {
      const context = runningContext();
      if (context === null) return;
      const delay = Number.isFinite(delaySeconds) && delaySeconds > 0 ? delaySeconds : 0;
      try {
        const out = ensureMaster(context);
        const t0 = context.currentTime + delay;
        if (kind === "alarm") playAlarm(context, out, t0);
        else playRumble(context, out, t0);
      } catch {
        // 音が鳴らせなくても，案内の表示と時間で次へ進める
      }
    },
    stop() {
      for (const s of sources) {
        s.onended = null;
        try {
          s.stop();
        } catch {
          // 始まる前・止めた後の stop は例外になる場合がある
        }
      }
      sources = [];
      if (master !== null) {
        master.disconnect();
        master = null;
      }
    },
  };
}
