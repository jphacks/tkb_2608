// ?input=mock|device の時だけ使う，入力の確認用のつなぎ（app/ 相当．main.ts から呼ぶ）．
// input/ の PlayerInput でカメラを回し，仮に動かし，画面の隅に PlayerInput の中身を出す．
// 仮の移動: walkSpeed で頭のヨーの向きへ進み，posture で目の高さを下げる．当たり判定は無い．
// ※ 担当B の Issue #31（プレイヤーの移動）で scenes/ の移動に置き換える前提の仮の実装
import * as THREE from "three";
import { formatPlayerInput } from "./input/inputParam";
import type { InputActivation, InputSource } from "./input/inputSource";

/** しゃがんだ時に目の高さを下げる量（m．立ち 1.6 m → しゃがみ 0.9 m．scenes の EYE_HEIGHT に合わせた仮の値） */
const CROUCH_DROP = 0.7;
/** 目の高さを追う時定数（秒．約 0.3 秒で動き終わる） */
const EYE_TAU = 0.1;

export class InputPreview {
  private readonly startYaw = new THREE.Quaternion();
  private readonly head = new THREE.Quaternion();
  private readonly forward = new THREE.Vector3();
  private readonly base: THREE.Vector3;
  private eyeDrop = 0;
  private lastNow: number | null = null;
  private readonly hud: HTMLPreElement;
  private activation: InputActivation | null = null;
  private readonly onClick = () => {
    void this.input.activate().then((a) => {
      this.activation = a;
    });
  };

  constructor(
    private readonly input: InputSource,
    private readonly camera: THREE.Camera,
    startPosition: THREE.Vector3,
    startYaw: number,
  ) {
    this.base = startPosition.clone();
    this.startYaw.setFromAxisAngle(new THREE.Vector3(0, 1, 0), startYaw);
    this.hud = document.createElement("pre");
    Object.assign(this.hud.style, {
      position: "fixed",
      left: "8px",
      top: "8px",
      margin: "0",
      padding: "6px 8px",
      background: "rgba(0, 0, 0, 0.6)",
      color: "#fff",
      font: "12px ui-monospace, monospace",
      pointerEvents: "none",
    });
    document.body.appendChild(this.hud);
    // iOS のセンサーの許可はタップの中でしか取れない
    if (input.kind === "device") window.addEventListener("click", this.onClick);
  }

  /** 描画の直前に呼ぶ */
  update(now: number): void {
    const p = this.input.read(now);
    const dt = this.lastNow === null ? 0 : Math.min(0.1, Math.max(0, (now - this.lastNow) / 1000));
    this.lastNow = now;

    // カメラの向き = 空間の開始の向き × 頭の向き
    this.head.set(p.head.x, p.head.y, p.head.z, p.head.w);
    this.camera.quaternion.multiplyQuaternions(this.startYaw, this.head);

    // 仮の移動: 視線の水平の向きへ walkSpeed で進む
    if (p.walking && p.walkSpeed > 0) {
      this.forward.set(0, 0, -1).applyQuaternion(this.camera.quaternion);
      this.forward.y = 0;
      if (this.forward.lengthSq() > 1e-6) {
        this.base.addScaledVector(this.forward.normalize(), p.walkSpeed * dt);
      }
    }
    const targetDrop = p.posture === "crouching" ? CROUCH_DROP : 0;
    this.eyeDrop += (targetDrop - this.eyeDrop) * (1 - Math.exp(-dt / EYE_TAU));
    this.camera.position.set(this.base.x, this.base.y - this.eyeDrop, this.base.z);

    const header =
      this.input.kind === "mock"
        ? "input=mock  W: 歩く  S: ゆっくり  C: しゃがむ  ドラッグ: 向き"
        : this.activation === null
          ? "input=device  画面をタップしてセンサーを許可"
          : `input=device  motion ${this.activation.motion} / orientation ${this.activation.orientation}`;
    this.hud.textContent = `${header}\n${formatPlayerInput(p)}`;
  }

  dispose(): void {
    window.removeEventListener("click", this.onClick);
    this.hud.remove();
    this.input.dispose();
  }
}
