// 効果音を Web Audio で鳴らす殻．全体の音量（固定の GainNode 1 つ）・響き（ディレイ）・
// ナレーションの間に小さくする経路を持ち，ID ごとに鳴っている音を管理して止める

import type { SoundId } from "./audioIds";
import { resolveStopAt, SOUND_DEFINITIONS } from "./soundCatalog";
import { SOUND_SYNTHS, type SynthKit } from "./synths";

/** 全体の音量（0〜1）．本体の音量ボタンで合わせる基準になるため固定にし，大きすぎない値にする */
export const MASTER_GAIN = 0.35;
/** ナレーションの間の効果音の大きさ（倍） */
export const DUCK_GAIN = 0.35;
/** 止める時・小さくする時のなめらかさ（s） */
const FADE_SECONDS = 0.15;
/** 響き: 遅れ（s）・繰り返しの強さ・高い音を落とす周波数（Hz）・大きさ */
const ECHO = { delaySeconds: 0.23, feedback: 0.38, lowpassHz: 2200, wet: 0.5 } as const;

export interface SoundPlayOptions {
  readonly loop: boolean;
  /** 鳴らし始めるまでの秒数（s） */
  readonly delaySeconds?: number;
  /** 長さ（s）．ループでもこの長さで止める（確認用の音等） */
  readonly durationSeconds?: number;
}

export interface SoundEngine {
  /** 鳴らす．AudioContext が無い時は何もしない（止まっていれば再開を試み，再開した時に鳴る） */
  play(id: SoundId, options: SoundPlayOptions): void;
  /** その ID の音をすべて止める */
  stop(id: SoundId): void;
  stopAll(): void;
  /** ナレーションの間は効果音を小さくする */
  setDucked(ducked: boolean): void;
  /** すべて止めて，作った経路を外す（何度呼んでもよい） */
  dispose(): void;
}

interface Voice {
  readonly gain: GainNode;
  readonly sources: readonly AudioScheduledSourceNode[];
  /** 止める予定の時刻（s）．null は止めるまで鳴る */
  readonly stopAt: number | null;
}

interface Graph {
  readonly context: AudioContext;
  readonly master: GainNode;
  readonly duck: GainNode;
  readonly echoNodes: readonly AudioNode[];
  readonly kit: SynthKit;
}

/** getContext は開始画面で再開済みの AudioContext を返す（無ければ null） */
export function createSoundEngine(getContext: () => AudioContext | null): SoundEngine {
  let graph: Graph | null = null;
  const voices = new Map<SoundId, Voice[]>();
  let ducked = false;

  const buildGraph = (context: AudioContext): Graph => {
    const master = context.createGain();
    master.gain.value = MASTER_GAIN;
    master.connect(context.destination);
    const duck = context.createGain();
    duck.gain.value = ducked ? DUCK_GAIN : 1;
    duck.connect(master);

    const echoIn = context.createGain();
    const delay = context.createDelay(1);
    delay.delayTime.value = ECHO.delaySeconds;
    const feedback = context.createGain();
    feedback.gain.value = ECHO.feedback;
    const tone = context.createBiquadFilter();
    tone.type = "lowpass";
    tone.frequency.value = ECHO.lowpassHz;
    const wet = context.createGain();
    wet.gain.value = ECHO.wet;
    echoIn.connect(delay);
    delay.connect(tone);
    tone.connect(feedback);
    feedback.connect(delay);
    tone.connect(wet);
    wet.connect(master);

    const buffers = new Map<string, AudioBuffer>();
    const kit: SynthKit = {
      context,
      echo: echoIn,
      buffer(key, make) {
        const cached = buffers.get(key);
        if (cached !== undefined) return cached;
        const data = make(context.sampleRate);
        const buffer = context.createBuffer(1, data.length, context.sampleRate);
        buffer.copyToChannel(data, 0);
        buffers.set(key, buffer);
        return buffer;
      },
    };
    return { context, master, duck, echoNodes: [echoIn, delay, feedback, tone, wet], kit };
  };

  const currentGraph = (): Graph | null => {
    const context = getContext();
    if (context === null) return null;
    if (graph !== null && graph.context === context) return graph;
    // AudioContext が替わったら作り直す（前の経路の音は止める）
    releaseAll(true);
    graph = buildGraph(context);
    return graph;
  };

  const stopVoice = (voice: Voice, context: AudioContext, immediate: boolean): void => {
    const now = context.currentTime;
    const end = immediate ? now : now + FADE_SECONDS;
    try {
      voice.gain.gain.cancelScheduledValues(now);
      voice.gain.gain.setValueAtTime(voice.gain.gain.value, now);
      voice.gain.gain.linearRampToValueAtTime(0, end);
    } catch {
      // 値の予定が変えられなくても，音源を止めれば消える
    }
    for (const s of voice.sources) {
      try {
        s.stop(end);
      } catch {
        // 始まる前・止めた後の stop は例外になる場合がある
      }
    }
    const disconnect = (): void => voice.gain.disconnect();
    if (immediate) disconnect();
    else globalThis.setTimeout(disconnect, (FADE_SECONDS + 0.05) * 1000);
  };

  /** 鳴り終わった音を一覧から外す */
  const prune = (context: AudioContext): void => {
    const now = context.currentTime;
    for (const [id, list] of voices) {
      const alive = list.filter((v) => {
        if (v.stopAt !== null && v.stopAt <= now) {
          v.gain.disconnect();
          return false;
        }
        return true;
      });
      if (alive.length === 0) voices.delete(id);
      else voices.set(id, alive);
    }
  };

  function releaseAll(immediate: boolean): void {
    if (graph === null) {
      voices.clear();
      return;
    }
    for (const list of voices.values())
      for (const v of list) stopVoice(v, graph.context, immediate);
    voices.clear();
  }

  return {
    play(id, options) {
      const g = currentGraph();
      if (g === null) return;
      const { context } = g;
      if (context.state !== "running") {
        // タブの切り替え等で止まっていたら再開を試みる（iOS ではタップの外だと再開できないことがある）
        context.resume().catch(() => undefined);
      }
      try {
        prune(context);
        const definition = SOUND_DEFINITIONS[id];
        const delay =
          options.delaySeconds !== undefined &&
          Number.isFinite(options.delaySeconds) &&
          options.delaySeconds > 0
            ? options.delaySeconds
            : 0;
        const t0 = context.currentTime + delay;
        const gain = context.createGain();
        gain.connect(definition.duckDuringNarration ? g.duck : g.master);
        const synth = SOUND_SYNTHS[id](g.kit, gain, t0);
        const stopAt = resolveStopAt(
          definition,
          options.loop,
          t0,
          synth.endTime,
          options.durationSeconds,
        );
        if (stopAt !== null) {
          // 終わりの「ぷつっ」を避けるため，止める少し前から小さくする
          const fadeFrom = Math.max(t0, stopAt - FADE_SECONDS);
          gain.gain.setValueAtTime(1, fadeFrom);
          gain.gain.linearRampToValueAtTime(0, stopAt);
          // ひとりでに終わる音は合成の側で止める時刻を決めてあるので，早める時だけ指定し直す
          if (stopAt !== synth.endTime) for (const s of synth.sources) s.stop(stopAt);
        }
        const voice: Voice = { gain, sources: synth.sources, stopAt };
        voices.set(id, [...(voices.get(id) ?? []), voice]);
      } catch {
        // 音が鳴らせなくても，表示と時間でシナリオは進む
      }
    },
    stop(id) {
      const list = voices.get(id);
      if (list === undefined || graph === null) return;
      for (const v of list) stopVoice(v, graph.context, false);
      voices.delete(id);
    },
    stopAll() {
      releaseAll(false);
    },
    setDucked(next) {
      if (ducked === next) return;
      ducked = next;
      if (graph === null) return;
      const now = graph.context.currentTime;
      const param = graph.duck.gain;
      try {
        param.cancelScheduledValues(now);
        param.setValueAtTime(param.value, now);
        param.linearRampToValueAtTime(next ? DUCK_GAIN : 1, now + FADE_SECONDS * 2);
      } catch {
        param.value = next ? DUCK_GAIN : 1;
      }
    },
    dispose() {
      releaseAll(true);
      if (graph !== null) {
        for (const node of graph.echoNodes) node.disconnect();
        graph.duck.disconnect();
        graph.master.disconnect();
        graph = null;
      }
    },
  };
}
