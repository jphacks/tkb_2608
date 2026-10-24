// ?input=mock|device の時だけ使う，入力の確認用のつなぎ（app/ 相当．main.ts から呼ぶ）．
// input/ の InputSource から PlayerInput を読み，画面の左上に PlayerInput の中身と歩行の状態を出す．
// 移動・当たり判定は main.ts が PlayerInput を SpaceWalker に渡して行う（このファイルはカメラに触れない）

import type { PlayerInput } from "./core/types";
import { formatPlayerInput } from "./input/inputParam";
import type { InputActivation, InputSource } from "./input/inputSource";

/** 近くのドアを開閉するキー（KeyboardEvent.code．mock の W・S・C と重ならないもの） */
export const DOOR_TOGGLE_KEY = "KeyE";

export interface InputPreviewOptions {
  /** DOOR_TOGGLE_KEY を押した時（確認用のドア開閉．近くにドアが無ければ何もしない） */
  readonly onDoorToggle?: () => void;
}

export class InputPreview {
  private readonly hud: HTMLPreElement;
  private activation: InputActivation | null = null;
  private readonly onClick = () => {
    void this.input.activate().then((a) => {
      this.activation = a;
    });
  };
  private readonly onKeyDown = (event: KeyboardEvent) => {
    if (event.code !== DOOR_TOGGLE_KEY || event.repeat) return;
    this.options.onDoorToggle?.();
  };

  constructor(
    private readonly input: InputSource,
    private readonly options: InputPreviewOptions = {},
  ) {
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
    window.addEventListener("keydown", this.onKeyDown);
  }

  /** 今の入力を読む（描画の直前に呼ぶ）．now は performance.now() の ms */
  read(now: number): PlayerInput {
    return this.input.read(now);
  }

  /** 画面の左上に入力の中身と，呼び出し側の状態（歩行の位置・エリア等）を出す */
  show(input: PlayerInput, statusLines: readonly string[]): void {
    const header =
      this.input.kind === "mock"
        ? "input=mock  W: 歩く  S: ゆっくり  C: しゃがむ  E: ドア  ドラッグ: 向き"
        : this.activation === null
          ? "input=device  画面をタップしてセンサーを許可"
          : `input=device  motion ${this.activation.motion} / orientation ${this.activation.orientation}`;
    const text = [header, formatPlayerInput(input), ...statusLines].join("\n");
    if (this.hud.textContent !== text) this.hud.textContent = text;
  }

  dispose(): void {
    window.removeEventListener("click", this.onClick);
    window.removeEventListener("keydown", this.onKeyDown);
    this.hud.remove();
    this.input.dispose();
  }
}
