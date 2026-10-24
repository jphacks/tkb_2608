// PC 確認用の簡易操作．マウス（タッチ）ドラッグで視点を回す（Pointer Events）

import type { Camera } from "three";
import { applyLookDelta, type LookAngles } from "./lookAngles";

export class DragLook {
  private look: LookAngles;
  private activePointerId: number | null = null;
  private lastX = 0;
  private lastY = 0;

  constructor(
    private readonly element: HTMLElement,
    initial: LookAngles,
  ) {
    this.look = initial;
    // タッチでのスクロール・拡大を止めてドラッグを受け取る
    element.style.touchAction = "none";
    element.addEventListener("pointerdown", this.onPointerDown);
    element.addEventListener("pointermove", this.onPointerMove);
    element.addEventListener("pointerup", this.onPointerUp);
    element.addEventListener("pointercancel", this.onPointerUp);
  }

  get angles(): LookAngles {
    return this.look;
  }

  /** 向きをカメラに反映する（yaw → pitch の順に回す） */
  applyTo(camera: Camera): void {
    camera.rotation.set(this.look.pitch, this.look.yaw, 0, "YXZ");
  }

  dispose(): void {
    this.element.removeEventListener("pointerdown", this.onPointerDown);
    this.element.removeEventListener("pointermove", this.onPointerMove);
    this.element.removeEventListener("pointerup", this.onPointerUp);
    this.element.removeEventListener("pointercancel", this.onPointerUp);
  }

  private readonly onPointerDown = (event: PointerEvent): void => {
    if (this.activePointerId !== null) return;
    this.activePointerId = event.pointerId;
    this.lastX = event.clientX;
    this.lastY = event.clientY;
    this.element.setPointerCapture(event.pointerId);
  };

  private readonly onPointerMove = (event: PointerEvent): void => {
    if (event.pointerId !== this.activePointerId) return;
    this.look = applyLookDelta(this.look, event.clientX - this.lastX, event.clientY - this.lastY);
    this.lastX = event.clientX;
    this.lastY = event.clientY;
  };

  private readonly onPointerUp = (event: PointerEvent): void => {
    if (event.pointerId !== this.activePointerId) return;
    this.activePointerId = null;
    if (this.element.hasPointerCapture(event.pointerId)) {
      this.element.releasePointerCapture(event.pointerId);
    }
  };
}
