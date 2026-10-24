// モック入力の殻．キーボード（window）とポインターのドラッグ（target）を受けて，mockKeys.ts・mockHand.ts の純粋な関数に渡すだけにする．
// 手: マウスの位置が右手の位置，右ボタンか F キーを押している間は握る，ホイールで奥行き．左ドラッグは頭の向き
import { type PlayerInput, UNTRACKED_HAND } from "../../core/types";
import type { InputParams } from "../params";
import {
  applyMockHandPointer,
  applyMockHandWheel,
  INITIAL_MOCK_HAND,
  type MockHandState,
  mockHandState,
} from "./mockHand";
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

/** 握るキー（KeyboardEvent.code．W・S・C・E と重ならないもの） */
const GRIP_KEY = "KeyF";
/** PointerEvent.button の右ボタン・PointerEvent.buttons の右ボタンのビット */
const RIGHT_BUTTON = 2;
const RIGHT_BUTTONS_BIT = 2;

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
  private hand: MockHandState = INITIAL_MOCK_HAND;
  private gripKey = false;
  private gripButton = false;

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
    target.addEventListener("pointerleave", this.onPointerLeave);
    target.addEventListener("contextmenu", this.onContextMenu);
    target.addEventListener("wheel", this.onWheel, { passive: true });
  }

  private hands(): PlayerInput["hands"] {
    if (!this.hand.visible) return HANDS;
    const hand = { ...this.hand, gripping: this.gripKey || this.gripButton };
    return { left: UNTRACKED_HAND, right: mockHandState(hand) };
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
        hands: this.hands(),
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
    this.target.removeEventListener("pointerleave", this.onPointerLeave);
    this.target.removeEventListener("contextmenu", this.onContextMenu);
    this.target.removeEventListener("wheel", this.onWheel);
  }

  private readonly onKeyDown = (e: KeyboardEvent): void => {
    if (isTypingTarget(e.target) || e.ctrlKey || e.metaKey || e.altKey) return;
    if (e.code === GRIP_KEY) {
      e.preventDefault();
      this.gripKey = true;
      return;
    }
    if (interpretMockKey(e.code) === null) return;
    e.preventDefault();
    this.state = applyMockKeyDown(this.state, e.code, e.repeat);
  };

  private readonly onKeyUp = (e: KeyboardEvent): void => {
    if (e.code === GRIP_KEY) this.gripKey = false;
    this.state = applyMockKeyUp(this.state, e.code);
  };

  private readonly onBlur = (): void => {
    this.state = releaseMockKeys(this.state);
    this.gripKey = false;
    this.gripButton = false;
  };

  private readonly onPointerDown = (e: PointerEvent): void => {
    this.updateHandPointer(e);
    if (e.button === RIGHT_BUTTON) {
      this.gripButton = true;
      return;
    }
    if (this.activePointerId !== null) return;
    this.activePointerId = e.pointerId;
    this.lastX = e.clientX;
    this.lastY = e.clientY;
    this.target.setPointerCapture(e.pointerId);
  };

  private readonly onPointerMove = (e: PointerEvent): void => {
    this.updateHandPointer(e);
    // 左ボタンでドラッグ中に右ボタンを押した・離した時は pointerdown・pointerup が来ないため buttons で見る
    if (typeof e.buttons === "number") this.gripButton = (e.buttons & RIGHT_BUTTONS_BIT) !== 0;
    if (e.pointerId !== this.activePointerId) return;
    this.state = applyMockDrag(this.state, e.clientX - this.lastX, e.clientY - this.lastY);
    this.lastX = e.clientX;
    this.lastY = e.clientY;
  };

  private readonly onPointerUp = (e: PointerEvent): void => {
    if (e.button === RIGHT_BUTTON) this.gripButton = false;
    if (e.pointerId !== this.activePointerId) return;
    this.activePointerId = null;
    if (this.target.hasPointerCapture(e.pointerId)) this.target.releasePointerCapture(e.pointerId);
  };

  private readonly onPointerLeave = (): void => {
    // ドラッグ中（ポインターを捕まえている間）は外に出ても手を残す
    if (this.activePointerId !== null) return;
    this.hand = { ...this.hand, visible: false };
    this.gripButton = false;
  };

  private readonly onContextMenu = (e: Event): void => {
    // 右ボタンは握る操作に使うため，メニューを出さない
    e.preventDefault();
  };

  private readonly onWheel = (e: WheelEvent): void => {
    this.hand = applyMockHandWheel(this.hand, e.deltaY);
  };

  /** マウスの位置を手の位置にする（タッチ・ペンでは動かさない．要素の大きさが分からなければ何もしない） */
  private updateHandPointer(e: PointerEvent): void {
    if (e.pointerType !== "mouse" || typeof this.target.getBoundingClientRect !== "function")
      return;
    const rect = this.target.getBoundingClientRect();
    this.hand = applyMockHandPointer(
      this.hand,
      e.clientX - rect.left,
      e.clientY - rect.top,
      rect.width,
      rect.height,
    );
  }
}
