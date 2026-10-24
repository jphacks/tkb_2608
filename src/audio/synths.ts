// 効果音の ID → 鳴らし方（Web Audio で合成する関数）の対応表．音声ファイルに差し替える時は，
// この表の関数を「ファイルを読んだ AudioBuffer を鳴らす関数」に置き換える（呼ぶ側は変えなくてよい）

import type { SoundId } from "./audioIds";
import { ANNOUNCEMENT_CHIME, CHIME_DECAY_SECONDS } from "./chime";
import {
  babbleEnvelope,
  bellStrikeEnvelope,
  classroomKnocks,
  createRandom,
  fireCrackles,
  whiteNoise,
} from "./synthData";

/** 合成に使う道具（AudioContext ごとに soundEngine.ts が 1 つ作る） */
export interface SynthKit {
  readonly context: AudioContext;
  /** key ごとに 1 回だけ波形を作って AudioBuffer にする（同じ波形を使い回す） */
  buffer(key: string, make: (sampleRate: number) => Float32Array<ArrayBuffer>): AudioBuffer;
  /** 響き（ディレイ）に送る口．校内放送のチャイムが使う */
  readonly echo: AudioNode;
}

/** 合成した 1 回分の音 */
export interface SynthVoice {
  /** 止める時に stop する音源（LFO 等も含む） */
  readonly sources: readonly AudioScheduledSourceNode[];
  /** ひとりでに終わる時刻（AudioContext の時刻．s）．切れ目の無い音（止めるまで鳴る）は null */
  readonly endTime: number | null;
}

/** out に繋いで t0（s）から鳴らす */
export type SoundSynth = (kit: SynthKit, out: AudioNode, t0: number) => SynthVoice;

/** 非常ベル: 2 つのベル（少しずらした高さでうなりを出す）を 1 秒に 17 回打つ（Hz・s） */
const ALARM = {
  strikeHz: 17,
  strikeDecaySeconds: 0.02,
  /** ベルの響きの高さ（Hz）と大きさ．金属らしく倍音を整数倍にしない */
  partials: [
    [1180, 0.5],
    [1187, 0.35],
    [2630, 0.22],
    [3950, 0.1],
  ],
  /** 打っていない間も少し鳴り続ける大きさ（0〜1） */
  ringFloor: 0.12,
  gain: 0.5,
} as const;

/** 教室の環境音（Hz・s・大きさ）．控えめにする */
const AMBIENCE = {
  seconds: 7,
  knockSeconds: 9.3,
  formantHz: [600, 1400],
  voiceHz: 165,
  gain: 0.22,
  knockGain: 0.5,
} as const;

/** 炎の音（Hz・s・大きさ） */
const FIRE = {
  noiseSeconds: 4,
  crackleSeconds: 5.7,
  roarHz: 380,
  roarGain: 0.6,
  crackleHighpassHz: 1800,
  crackleGain: 0.5,
  flickerHz: 0.4,
  gain: 0.45,
} as const;

/** 火に近づいた時の警告音（Hz・s） */
const WARNING = { hz: 1500, beeps: 3, onSeconds: 0.08, offSeconds: 0.06, gain: 0.3 } as const;

/** チャイムの大きさと倍音（鉄琴らしく 4 倍の音を少し足す） */
const CHIME = { gain: 0.35, overtone: 4, overtoneGain: 0.12 } as const;

const NOISE_KEY = "noise";
const noise = (kit: SynthKit, seconds: number): AudioBuffer =>
  kit.buffer(`${NOISE_KEY}:${seconds}`, (rate) => whiteNoise(rate, seconds, createRandom(11)));

function loopSource(kit: SynthKit, buffer: AudioBuffer): AudioBufferSourceNode {
  const source = kit.context.createBufferSource();
  source.buffer = buffer;
  source.loop = true;
  return source;
}

const fireAlarm: SoundSynth = (kit, out, t0) => {
  const { context } = kit;
  // 打つ強さの波形をループさせて，ベルの響きの大きさ（vca.gain）に足す
  const vca = context.createGain();
  vca.gain.value = ALARM.ringFloor;
  const strike = loopSource(
    kit,
    kit.buffer("bell-strike", (rate) =>
      bellStrikeEnvelope(rate, ALARM.strikeHz, ALARM.strikeDecaySeconds),
    ),
  );
  strike.connect(vca.gain);
  const level = context.createGain();
  level.gain.value = ALARM.gain;
  vca.connect(level);
  level.connect(out);
  const sources: AudioScheduledSourceNode[] = [strike];
  for (const [hz, gain] of ALARM.partials) {
    const osc = context.createOscillator();
    osc.type = "sine";
    osc.frequency.value = hz;
    const g = context.createGain();
    g.gain.value = gain;
    osc.connect(g);
    g.connect(vca);
    sources.push(osc);
  }
  for (const s of sources) s.start(t0);
  return { sources, endTime: null };
};

const classroomAmbience: SoundSynth = (kit, out, t0) => {
  const { context } = kit;
  const level = context.createGain();
  level.gain.value = AMBIENCE.gain;
  level.connect(out);

  // 話し声: 雑音と低い声の高さの音を口の響き（帯域通過）に通し，抑揚の波形で大きさを動かす
  const talk = context.createGain();
  talk.gain.value = 0;
  const envelope = loopSource(
    kit,
    kit.buffer("babble", (rate) => babbleEnvelope(rate, AMBIENCE.seconds, createRandom(23))),
  );
  envelope.connect(talk.gain);
  const breath = loopSource(kit, noise(kit, AMBIENCE.seconds));
  const voice = context.createOscillator();
  voice.type = "sawtooth";
  voice.frequency.value = AMBIENCE.voiceHz;
  // 声の高さをゆっくり揺らす
  const pitchLfo = context.createOscillator();
  pitchLfo.frequency.value = 0.7;
  const pitchDepth = context.createGain();
  pitchDepth.gain.value = 25;
  pitchLfo.connect(pitchDepth);
  pitchDepth.connect(voice.frequency);
  const voiceGain = context.createGain();
  voiceGain.gain.value = 0.15;
  voice.connect(voiceGain);
  for (const hz of AMBIENCE.formantHz) {
    const formant = context.createBiquadFilter();
    formant.type = "bandpass";
    formant.frequency.value = hz;
    formant.Q.value = 1.5;
    breath.connect(formant);
    voiceGain.connect(formant);
    formant.connect(talk);
  }
  talk.connect(level);

  // 物音: 長さの違うループにして，話し声と同じ並びの繰り返しに聞こえにくくする
  const knocks = loopSource(
    kit,
    kit.buffer("knocks", (rate) => classroomKnocks(rate, AMBIENCE.knockSeconds, createRandom(37))),
  );
  const knockFilter = context.createBiquadFilter();
  knockFilter.type = "lowpass";
  knockFilter.frequency.value = 2500;
  const knockGain = context.createGain();
  knockGain.gain.value = AMBIENCE.knockGain;
  knocks.connect(knockFilter);
  knockFilter.connect(knockGain);
  knockGain.connect(level);

  const sources = [envelope, breath, voice, pitchLfo, knocks];
  for (const s of sources) s.start(t0);
  return { sources, endTime: null };
};

const fireBurning: SoundSynth = (kit, out, t0) => {
  const { context } = kit;
  const level = context.createGain();
  level.gain.value = FIRE.gain;
  level.connect(out);

  // ゴーという低いうなり．大きさをゆっくり揺らして炎の揺らぎを出す
  const roarSource = loopSource(kit, noise(kit, FIRE.noiseSeconds));
  const roarFilter = context.createBiquadFilter();
  roarFilter.type = "lowpass";
  roarFilter.frequency.value = FIRE.roarHz;
  const roar = context.createGain();
  roar.gain.value = FIRE.roarGain;
  const flicker = context.createOscillator();
  flicker.frequency.value = FIRE.flickerHz;
  const flickerDepth = context.createGain();
  flickerDepth.gain.value = FIRE.roarGain * 0.4;
  flicker.connect(flickerDepth);
  flickerDepth.connect(roar.gain);
  roarSource.connect(roarFilter);
  roarFilter.connect(roar);
  roar.connect(level);

  // パチパチ
  const crackles = loopSource(
    kit,
    kit.buffer("crackles", (rate) => fireCrackles(rate, FIRE.crackleSeconds, createRandom(51))),
  );
  const crackleFilter = context.createBiquadFilter();
  crackleFilter.type = "highpass";
  crackleFilter.frequency.value = FIRE.crackleHighpassHz;
  const crackleGain = context.createGain();
  crackleGain.gain.value = FIRE.crackleGain;
  crackles.connect(crackleFilter);
  crackleFilter.connect(crackleGain);
  crackleGain.connect(level);

  const sources = [roarSource, flicker, crackles];
  for (const s of sources) s.start(t0);
  return { sources, endTime: null };
};

const nearFireWarning: SoundSynth = (kit, out, t0) => {
  const { context } = kit;
  const osc = context.createOscillator();
  osc.type = "square";
  osc.frequency.value = WARNING.hz;
  // 角の立った音を少し丸める
  const filter = context.createBiquadFilter();
  filter.type = "lowpass";
  filter.frequency.value = 3000;
  const env = context.createGain();
  env.gain.setValueAtTime(0, t0);
  const step = WARNING.onSeconds + WARNING.offSeconds;
  for (let i = 0; i < WARNING.beeps; i++) {
    const start = t0 + i * step;
    env.gain.setValueAtTime(0, start);
    env.gain.linearRampToValueAtTime(WARNING.gain, start + 0.005);
    env.gain.setValueAtTime(WARNING.gain, start + WARNING.onSeconds - 0.005);
    env.gain.linearRampToValueAtTime(0, start + WARNING.onSeconds);
  }
  osc.connect(filter);
  filter.connect(env);
  env.connect(out);
  const end = t0 + WARNING.beeps * step;
  osc.start(t0);
  osc.stop(end);
  return { sources: [osc], endTime: end };
};

function chime(kind: "start" | "end"): SoundSynth {
  return (kit, out, t0) => {
    const { context } = kit;
    const sources: AudioScheduledSourceNode[] = [];
    let end = t0;
    for (const note of ANNOUNCEMENT_CHIME[kind]) {
      const start = t0 + note.at;
      const stop = start + CHIME_DECAY_SECONDS;
      const env = context.createGain();
      env.gain.setValueAtTime(0, start);
      env.gain.linearRampToValueAtTime(CHIME.gain, start + 0.005);
      env.gain.exponentialRampToValueAtTime(0.0005, stop);
      for (const [mult, gain] of [
        [1, 1],
        [CHIME.overtone, CHIME.overtoneGain],
      ] as const) {
        const osc = context.createOscillator();
        osc.type = "sine";
        osc.frequency.value = note.hz * mult;
        const g = context.createGain();
        g.gain.value = gain;
        osc.connect(g);
        g.connect(env);
        osc.start(start);
        osc.stop(stop);
        sources.push(osc);
      }
      // 校内放送らしい響き: スピーカーから廊下に響くように，ディレイにも送る
      env.connect(out);
      env.connect(kit.echo);
      end = Math.max(end, stop);
    }
    return { sources, endTime: end };
  };
}

/** 効果音の ID → 鳴らし方 */
export const SOUND_SYNTHS: Readonly<Record<SoundId, SoundSynth>> = {
  "classroom-ambience": classroomAmbience,
  "fire-alarm": fireAlarm,
  "fire-burning": fireBurning,
  "near-fire-warning": nearFireWarning,
  "announcement-chime-start": chime("start"),
  "announcement-chime-end": chime("end"),
};
