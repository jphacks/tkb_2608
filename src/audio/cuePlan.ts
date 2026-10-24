// Cue を audio/ の指示（効果音を鳴らす・止める，ナレーションを読む）に変える純粋な関数．
// 同じ ID のループを二重に鳴らさないよう，鳴らしているループの ID を状態として持つ

import type { Cue, CueParams } from "../core/cue";
import { isSoundId, type SoundId } from "./audioIds";
import { resolveLoop, SOUND_DEFINITIONS } from "./soundCatalog";

/** Cue から作る audio/ の中の指示 */
export type AudioCommand =
  | { readonly type: "playSound"; readonly id: SoundId; readonly loop: boolean }
  /** その ID の音（ループも 1 回だけの音も）をすべて止める */
  | { readonly type: "stopSound"; readonly id: SoundId }
  /** ナレーションを読む（未知の ID も渡す．読まずに終わった signal だけを流すため） */
  | { readonly type: "narrate"; readonly id: string; readonly params: CueParams };

export interface CuePlanState {
  /** ループで鳴らしている効果音の ID */
  readonly loopingIds: readonly SoundId[];
}

export const INITIAL_CUE_PLAN_STATE: CuePlanState = { loopingIds: [] };

const NO_PARAMS: CueParams = {};

/**
 * Cue を指示に変える．happening と未知の効果音の ID は何もしない．
 * 鳴らしている最中のループをもう一度 play しても鳴らし直さない
 */
export function planCue(
  state: CuePlanState,
  cue: Cue,
): { readonly state: CuePlanState; readonly commands: readonly AudioCommand[] } {
  switch (cue.type) {
    case "happening":
      return { state, commands: [] };
    case "narration":
      return {
        state,
        commands: [{ type: "narrate", id: cue.id, params: cue.params ?? NO_PARAMS }],
      };
    case "sound": {
      if (!isSoundId(cue.id)) return { state, commands: [] };
      const id = cue.id;
      if (cue.action === "stop") {
        return {
          state: { loopingIds: state.loopingIds.filter((x) => x !== id) },
          commands: [{ type: "stopSound", id }],
        };
      }
      const loop = resolveLoop(SOUND_DEFINITIONS[id], cue.loop);
      if (!loop) return { state, commands: [{ type: "playSound", id, loop }] };
      if (state.loopingIds.includes(id)) return { state, commands: [] };
      return {
        state: { loopingIds: [...state.loopingIds, id] },
        commands: [{ type: "playSound", id, loop }],
      };
    }
  }
}
