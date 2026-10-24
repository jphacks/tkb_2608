// モック入力の殻．キーボード（window）とポインターのドラッグ（target）を受けて，mockKeys.ts の純粋な関数に渡すだけにする
import { type PlayerInput, UNTRACKED_HAND } from "../../core/types";
import type { InputParams } from "../params";
import {
  advanceMock,
  applyMockDrag,
  applyMockKeyDown,
  applyMockKeyUp,
  INITIAL_MOCK_STATE,
  interpretMockKey,
  type MockState,
  mockHead,
  mockWalking,
  releaseMockKeys,
} from "./mockKeys";

const HANDS: PlayerInput["hands"] = { left: UNTRACKED_HAND, right: UNTRACKED_HAND };

/** 文字の入力欄にフォーカスがある時はキーを奪わない */
function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return target.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName);
}

export class MockInput {
  private state: MockState = INITIAL_MOCK_STATE;
  private activePointerId: number | null = null;
  private lastX = 0;
  private lastY = 0;

  constructor(
    private readonly target: HTMLElement,
    private readonly getParams: () => InputParams,
  ) {
    target.style.touchAction = "none";
    window.addEventListener("keydown", this.onKeyDown);
    window.addEventListener("keyup", this.onKeyUp);
    window.addEventListener("blur", this.onBlur);
    target.addEventListener("pointerdown", this.onPointerDown);
    target.addEventListener("pointermove", this.onPointerMove);
    target.addEventListener("pointerup", this.onPointerUp);
    target.addEventListener("pointercancel", this.onPointerUp);
  }

  read(now: number): PlayerInput {
    try {
      this.state = advanceMock(this.state, now, this.getParams());
      const { walking, walkSpeed } = mockWalking(this.state);
      return {
        time: now,
        head: mockHead(this.state),
        posture: this.state.posture,
        walking,
        walkSpeed,
        hands: HANDS,
      };
    } catch {
      return {
        time: now,
        head: { x: 0, y: 0, z: 0, w: 1 },
        posture: this.state.posture,
        walking: false,
        walkSpeed: 0,
        hands: HANDS,
      };
    }
  }

  /** 今の向きを正面にする */
  recenter(): void {
    this.state = { ...this.state, look: { yaw: 0, pitch: 0 } };
  }

  dispose(): void {
    window.removeEventListener("keydown", this.onKeyDown);
    window.removeEventListener("keyup", this.onKeyUp);
    window.removeEventListener("blur", this.onBlur);
    this.target.removeEventListener("pointerdown", this.onPointerDown);
    this.target.removeEventListener("pointermove", this.onPointerMove);
    this.target.removeEventListener("pointerup", this.onPointerUp);
    this.target.removeEventListener("pointercancel", this.onPointerUp);
  }

  private readonly onKeyDown = (e: KeyboardEvent): void => {
    if (isTypingTarget(e.target) || e.ctrlKey || e.metaKey || e.altKey) return;
    if (interpretMockKey(e.code) === null) return;
    e.preventDefault();
    this.state = applyMockKeyDown(this.state, e.code, e.repeat);
  };

  private readonly onKeyUp = (e: KeyboardEvent): void => {
    this.state = applyMockKeyUp(this.state, e.code);
  };

  private readonly onBlur = (): void => {
    this.state = releaseMockKeys(this.state);
  };

  private readonly onPointerDown = (e: PointerEvent): void => {
    if (this.activePointerId !== null) return;
    this.activePointerId = e.pointerId;
    this.lastX = e.clientX;
    this.lastY = e.clientY;
    this.target.setPointerCapture(e.pointerId);
  };

  private readonly onPointerMove = (e: PointerEvent): void => {
    if (e.pointerId !== this.activePointerId) return;
    this.state = applyMockDrag(this.state, e.clientX - this.lastX, e.clientY - this.lastY);
    this.lastX = e.clientX;
    this.lastY = e.clientY;
  };

  private readonly onPointerUp = (e: PointerEvent): void => {
    if (e.pointerId !== this.activePointerId) return;
    this.activePointerId = null;
    if (this.target.hasPointerCapture(e.pointerId)) this.target.releasePointerCapture(e.pointerId);
  };
}
