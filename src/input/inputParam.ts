// ?input=mock|device|replay の解釈と，入力の確認用の表示の文字列（DOM に依存しない純粋な関数）
import type { HandState, PlayerInput } from "../core/types";
import { pitchOfQuat, yawOfQuat } from "./head/quat";
import type { InputKind } from "./inputSource";

/**
 * ?input= の値 → 入力の種類．指定なし・不正な値は null（今までどおりの操作のまま）．大文字小文字は区別しない．
 * replay（記録の再生）は開発サーバーでだけ動く（本番では止まって立ったままの入力になる）
 */
export function parseInputKind(search: string): InputKind | null {
  const v = new URLSearchParams(search).get("input")?.trim().toLowerCase();
  return v === "mock" || v === "device" || v === "replay" ? v : null;
}

function deg(rad: number): string {
  return `${Math.round((rad * 180) / Math.PI)}°`;
}

/** PlayerInput の中身を短い数行にする（画面の隅の表示用） */
export function formatPlayerInput(input: PlayerInput): string {
  return [
    `posture  ${input.posture}`,
    `walking  ${input.walking}  ${input.walkSpeed.toFixed(2)} m/s`,
    `head     yaw ${deg(yawOfQuat(input.head))}  pitch ${deg(pitchOfQuat(input.head))}`,
  ].join("\n");
}

function formatHand(name: string, hand: HandState): string {
  if (!hand.tracked) return `${name} -`;
  const p = hand.position;
  return `${name} (${p.x.toFixed(2)}, ${p.y.toFixed(2)}, ${p.z.toFixed(2)}) grip ${hand.grip.toFixed(2)}`;
}

/** 両手（PlayerInput.hands）を 1 行にする（画面の隅の表示用．認識していない手は "-"） */
export function formatHands(hands: PlayerInput["hands"]): string {
  return `hands    ${formatHand("L", hands.left)}  ${formatHand("R", hands.right)}`;
}
