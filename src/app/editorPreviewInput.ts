// エディタの view モード（校舎の 3D の確認）のキー操作を，歩く・向きを変える量に直す純粋な関数．
// キーの購読は editorPlanPreview.ts の殻が行い，押している KeyboardEvent.code の集合だけをここに渡す
import { type LookAngles, wrapAngle } from "../controls/lookAngles";

/** 前へ進むキー（KeyboardEvent.code） */
export const FORWARD_KEYS: readonly string[] = ["KeyW", "ArrowUp"];
/** 後ろへ下がるキー */
export const BACKWARD_KEYS: readonly string[] = ["KeyS", "ArrowDown"];
/** 左を向くキー */
export const TURN_LEFT_KEYS: readonly string[] = ["KeyA", "ArrowLeft"];
/** 右を向くキー */
export const TURN_RIGHT_KEYS: readonly string[] = ["KeyD", "ArrowRight"];
/** しゃがむ・立つを切り替えるキー */
export const CROUCH_KEY = "KeyC";

/** view モードで扱うキー（押した時にページのスクロール等を止める） */
export const PREVIEW_KEYS: ReadonlySet<string> = new Set([
  ...FORWARD_KEYS,
  ...BACKWARD_KEYS,
  ...TURN_LEFT_KEYS,
  ...TURN_RIGHT_KEYS,
  CROUCH_KEY,
]);

/** キーで向きを変える速さ（rad/s） */
export const KEY_TURN_SPEED = Math.PI * 0.6;

/** 押しているキーから決めた動き．forward は 1 で前へ，-1 で後ろへ，turn は 1 で左へ，-1 で右へ */
export interface PreviewMove {
  readonly forward: -1 | 0 | 1;
  readonly turn: -1 | 0 | 1;
}

const anyPressed = (pressed: ReadonlySet<string>, keys: readonly string[]): boolean =>
  keys.some((key) => pressed.has(key));

/** 正の向きと負の向きのキーの押し方から -1・0・1 を決める（両方なら打ち消して 0） */
const axis = (positive: boolean, negative: boolean): -1 | 0 | 1 => {
  if (positive === negative) return 0;
  return positive ? 1 : -1;
};

/** 押しているキーの集合から動きを決める（前と後ろ・左と右を同時に押した時は打ち消して 0） */
export function previewMove(pressed: ReadonlySet<string>): PreviewMove {
  return {
    forward: axis(anyPressed(pressed, FORWARD_KEYS), anyPressed(pressed, BACKWARD_KEYS)),
    turn: axis(anyPressed(pressed, TURN_LEFT_KEYS), anyPressed(pressed, TURN_RIGHT_KEYS)),
  };
}

/** キーで向きを変えた量（rad）を dt（s）分進める．yaw と同じく左へ回るのが正．dt が有限の正の数でない時は変えない */
export function advanceKeyTurn(current: number, turn: PreviewMove["turn"], dt: number): number {
  if (turn === 0 || !Number.isFinite(dt) || dt <= 0) return current;
  return wrapAngle(current + turn * KEY_TURN_SPEED * dt);
}

/**
 * 歩行（SpaceWalker）に渡す頭の向き．歩行は頭の yaw の向きへ進むため，後ろへ下がる時は yaw を半回転させて渡す
 * （カメラには元の向きを当てるので，見ている向きは変わらない）．pitch は進む向きに関係しないので 0
 */
export function walkLook(look: LookAngles, forward: PreviewMove["forward"]): LookAngles {
  return { yaw: forward < 0 ? wrapAngle(look.yaw + Math.PI) : look.yaw, pitch: 0 };
}
