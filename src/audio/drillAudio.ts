// イベントバスの cue を受けて効果音とナレーションを鳴らす殻（audio/ の入口）．
// 判断は cuePlan.ts（Cue → 指示）と narrationFlow.ts（ナレーションの進め方）が行い，ここは実行するだけにする

import type { Cue } from "../core/cue";
import type { EventBus } from "../core/event-bus";
import type { AppEvent } from "../core/events";
import { SOUND_ID } from "./audioIds";
import { type AudioCommand, INITIAL_CUE_PLAN_STATE, planCue } from "./cuePlan";
import {
  IDLE_NARRATION,
  isNarrating,
  type NarrationAction,
  type NarrationEvent,
  reduceNarration,
} from "./narrationFlow";
import { buildNarration } from "./narrationText";
import { createSoundEngine } from "./soundEngine";
import { createSpeech, type SpeechPort } from "./speech";

export interface DrillAudioOptions {
  /** cue を購読し，ナレーションの終わりの signal を流すバス */
  readonly bus: EventBus<AppEvent>;
  /** 開始画面で再開済みの AudioContext（無ければ null で，効果音は鳴らさず読み上げと signal だけ行う） */
  readonly audioContext: () => AudioContext | null;
  /** 読み上げの口（省略時は端末の speechSynthesis） */
  readonly speech?: SpeechPort;
}

export interface DrillAudio {
  /** Cue を直接渡して鳴らす（バスの cue と同じ扱い） */
  handleCue(cue: Cue): void;
  /** すべての音と読み上げを止める（購読は続ける．signal は流さない．画面を切り替える時に app/ が呼ぶ） */
  stopAll(): void;
  /** すべて止めて購読をやめ，作った経路を外す（体験を終える時（ページを離れる時）に app/ が呼ぶ．何度呼んでもよい） */
  dispose(): void;
}

export function createDrillAudio(options: DrillAudioOptions): DrillAudio {
  const engine = createSoundEngine(options.audioContext);
  const speech = options.speech ?? createSpeech();
  let planState = INITIAL_CUE_PLAN_STATE;
  let narration = IDLE_NARRATION;
  let nextToken = 1;
  let disposed = false;
  const timers = new Set<ReturnType<typeof setTimeout>>();

  const clearTimers = (): void => {
    for (const t of timers) clearTimeout(t);
    timers.clear();
  };

  const runAction = (action: NarrationAction): void => {
    switch (action.type) {
      case "chime":
        engine.play(
          action.kind === "start" ? SOUND_ID.announcementChimeStart : SOUND_ID.announcementChimeEnd,
          { loop: false },
        );
        return;
      case "speak": {
        const { token } = action;
        const ok = speech.speak(
          action.text,
          action.rate,
          () => dispatch({ type: "speechEnded", token }),
          action.pitch,
        );
        if (!ok) dispatch({ type: "speechUnavailable", token });
        return;
      }
      case "cancelSpeech":
        speech.cancel();
        return;
      case "signal":
        options.bus.emit({ type: "signal", name: action.name });
        return;
      case "wait": {
        const { token, event } = action;
        const timer = setTimeout(
          () => {
            timers.delete(timer);
            dispatch({ type: event, token });
          },
          Math.max(0, action.seconds * 1000),
        );
        timers.add(timer);
        return;
      }
    }
  };

  function dispatch(event: NarrationEvent): void {
    if (disposed) return;
    const step = reduceNarration(narration, event);
    // 指示の実行中に出来事が戻ってきても（signal から次の cue が来る等）新しい状態で受けるよう，先に書き換える
    narration = step.state;
    engine.setDucked(isNarrating(narration));
    for (const action of step.actions) runAction(action);
  }

  const runCommand = (command: AudioCommand): void => {
    switch (command.type) {
      case "playSound":
        engine.play(command.id, { loop: command.loop });
        return;
      case "stopSound":
        engine.stop(command.id);
        return;
      case "narrate": {
        const built = buildNarration(command.id, command.params);
        dispatch({
          type: "request",
          item: {
            token: nextToken++,
            id: command.id,
            text: built?.text ?? null,
            style: built?.style ?? "narration",
          },
        });
        return;
      }
    }
  };

  const handleCue = (cue: Cue): void => {
    if (disposed) return;
    const planned = planCue(planState, cue);
    planState = planned.state;
    for (const command of planned.commands) runCommand(command);
  };

  const unsubscribe = options.bus.on("cue", (event) => handleCue(event.cue));

  const stopAll = (): void => {
    clearTimers();
    // stop の指示で読み上げを止める（signal は流さない）
    dispatch({ type: "stop" });
    planState = INITIAL_CUE_PLAN_STATE;
    engine.stopAll();
  };

  return {
    handleCue,
    stopAll,
    dispose() {
      if (disposed) return;
      stopAll();
      disposed = true;
      unsubscribe();
      engine.dispose();
    },
  };
}
