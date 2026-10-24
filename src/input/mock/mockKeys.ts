// モック入力の純粋な部分（SPEC_01「開発時の独立性」・experiment_山﨑/10）．キーとドラッグの解釈を DOM なしで行う．
// W: 歩く（1.0 m/s）・S: ゆっくり歩く（0.5 m/s）・C: しゃがみの切り替え・ドラッグ: 頭の向き．
// 足踏みには向きが無い（PlayerInput に後ろ・横へ進む値が無い）ため，S は後ろへ進まずゆっくり前へ進む．A・D は今は使わない
import type { Posture, Quat } from "../../core/types";
import { smoothSpeed } from "../body/locomotion";
import { quatFromYawPitch } from "../head/quat";
import type { InputParams } from "../params";

export type MockKeyAction = "forward" | "slow" | "crouch";

/** KeyboardEvent.code → 操作（キーボードの配列に左右されないよう code で見る）．使わないキーは null */
export function interpretMockKey(code: string): MockKeyAction | null {
  switch (code) {
    case "KeyW":
    case "ArrowUp":
      return "forward";
    case "KeyS":
    case "ArrowDown":
      return "slow";
    case "KeyC":
      return "crouch";
    default:
      // KeyA・KeyD（横へ進む）は PlayerInput で表せないため今は使わない
      return null;
  }
}

export interface MockLook {
  /** rad．0 で -z，正で左（src/controls/lookAngles.ts と同じ向き） */
  readonly yaw: number;
  /** rad．上が正 */
  readonly pitch: number;
}

export interface MockState {
  readonly forward: boolean;
  readonly slow: boolean;
  readonly posture: Posture;
  readonly look: MockLook;
  /** 速さ（m/s）と変化の速さ（バネとダンパー．本物の入力と同じなめらかさにする） */
  readonly speed: number;
  readonly speedRate: number;
  /** 最後に進めた時刻（ms）．まだなら NaN */
  readonly lastT: number;
}

export const INITIAL_MOCK_STATE: MockState = {
  forward: false,
  slow: false,
  posture: "standing",
  look: { yaw: 0, pitch: 0 },
  speed: 0,
  speedRate: 0,
  lastT: Number.NaN,
};

export interface MockOptions {
  /** W の速さ（m/s） */
  readonly walkSpeed: number;
  /** S の速さ（m/s） */
  readonly slowSpeed: number;
  /** 1 px あたりの回転（rad） */
  readonly sensitivity: number;
  /** ピッチの上下の限界（rad） */
  readonly pitchLimit: number;
}

export const DEFAULT_MOCK_OPTIONS: MockOptions = {
  walkSpeed: 1.0,
  slowSpeed: 0.5,
  sensitivity: 0.004,
  pitchLimit: (85 * Math.PI) / 180,
};

/** キーを押した．repeat（押しっぱなしの繰り返し）では C を切り替えない */
export function applyMockKeyDown(s: MockState, code: string, repeat: boolean): MockState {
  switch (interpretMockKey(code)) {
    case "forward":
      return s.forward ? s : { ...s, forward: true };
    case "slow":
      return s.slow ? s : { ...s, slow: true };
    case "crouch":
      if (repeat) return s;
      return { ...s, posture: s.posture === "standing" ? "crouching" : "standing" };
    default:
      return s;
  }
}

/** キーを離した */
export function applyMockKeyUp(s: MockState, code: string): MockState {
  switch (interpretMockKey(code)) {
    case "forward":
      return s.forward ? { ...s, forward: false } : s;
    case "slow":
      return s.slow ? { ...s, slow: false } : s;
    default:
      return s;
  }
}

/** ウィンドウからフォーカスが外れた（キーを離したことが届かないため，歩きを止める） */
export function releaseMockKeys(s: MockState): MockState {
  return s.forward || s.slow ? { ...s, forward: false, slow: false } : s;
}

/** 角度を (-π, π] に収める */
export function wrapMockAngle(angle: number): number {
  const twoPi = Math.PI * 2;
  const wrapped = angle - twoPi * Math.floor((angle + Math.PI) / twoPi);
  return wrapped === -Math.PI ? Math.PI : wrapped;
}

/** ドラッグ量（px）を向きに反映する．右へドラッグで右を向き，上へドラッグで上を向く */
export function applyMockDrag(
  s: MockState,
  dx: number,
  dy: number,
  options: MockOptions = DEFAULT_MOCK_OPTIONS,
): MockState {
  if (!Number.isFinite(dx) || !Number.isFinite(dy)) return s;
  const pitch = s.look.pitch - dy * options.sensitivity;
  return {
    ...s,
    look: {
      yaw: wrapMockAngle(s.look.yaw - dx * options.sensitivity),
      pitch: Math.max(-options.pitchLimit, Math.min(options.pitchLimit, pitch)),
    },
  };
}

/** 押しているキーから目指す速さ（m/s）．W と S を両方押した時は W を優先する */
export function mockTargetSpeed(s: MockState, options: MockOptions = DEFAULT_MOCK_OPTIONS): number {
  if (s.forward) return options.walkSpeed;
  if (s.slow) return options.slowSpeed;
  return 0;
}

/** 速さを今の時刻 now（ms）まで進める．時刻が戻った・飛んだ（0.2 秒超）時は速さを動かさず時刻だけ合わせる */
export function advanceMock(
  s: MockState,
  now: number,
  params: Pick<InputParams, "speedSpringOmega" | "speedMaxAccel" | "speedMaxDecel">,
  options: MockOptions = DEFAULT_MOCK_OPTIONS,
): MockState {
  if (!Number.isFinite(now)) return s;
  const dtSec = Number.isNaN(s.lastT) ? 0 : (now - s.lastT) / 1000;
  if (!(dtSec > 0) || dtSec > 0.2) return { ...s, lastT: now };
  const v = { speed: s.speed, speedRate: s.speedRate };
  smoothSpeed(v, mockTargetSpeed(s, options), dtSec, params);
  return { ...s, speed: v.speed, speedRate: v.speedRate, lastT: now };
}

/** 頭の向き（ヨー → ピッチの順に回す） */
export function mockHead(s: MockState): Quat {
  return quatFromYawPitch(s.look.yaw, s.look.pitch);
}

/** walking とみなす最小の速さ（m/s） */
const MOCK_WALKING_MIN_SPEED = 0.02;

/** 外に出す歩きの状態 */
export function mockWalking(s: MockState): { walking: boolean; walkSpeed: number } {
  const walking = s.forward || s.slow || s.speed > MOCK_WALKING_MIN_SPEED;
  return { walking, walkSpeed: walking ? s.speed : 0 };
}
