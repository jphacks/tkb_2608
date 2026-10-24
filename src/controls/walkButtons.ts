// 確認用の仮の入力ボタン（スマホの画面の「歩く」「しゃがむ」と，近くのドアの開閉の切り替え）．
// ボタンは描画の canvas とは別の要素に置くため，ボタンのタッチはドラッグでの視点操作（DragLook）に届かない．
// 本物の検知（担当D の src/input/）が入ったら差し替える

/** ドアのボタンの対象（近くのドア 1 つ）．近くに無ければ null */
export interface DoorButtonTarget {
  readonly id: string;
  readonly open: boolean;
}

export interface WalkButtonsOptions {
  /** ドアの開閉を切り替えるボタンを押した時．切り替えた後の対象を返す（近くにドアが無ければ null） */
  readonly onDoorToggle?: () => DoorButtonTarget | null;
}

const BUTTON_STYLE = [
  "position: fixed",
  "bottom: calc(16px + env(safe-area-inset-bottom))",
  "width: 88px",
  "height: 88px",
  "border-radius: 50%",
  "border: 2px solid rgba(255, 255, 255, 0.8)",
  "background: rgba(0, 0, 0, 0.35)",
  "color: #fff",
  "font: bold 16px sans-serif",
  // 長押しで文字の選択・メニュー・拡大が出ないように
  "touch-action: none",
  "user-select: none",
  "-webkit-user-select: none",
  "-webkit-touch-callout: none",
  "-webkit-tap-highlight-color: transparent",
].join(";");

const ACTIVE_BACKGROUND = "rgba(255, 170, 0, 0.7)";
const IDLE_BACKGROUND = "rgba(0, 0, 0, 0.35)";

function createButton(label: string, side: "left" | "right", offset = 16): HTMLButtonElement {
  const button = document.createElement("button");
  button.type = "button";
  button.textContent = label;
  button.style.cssText = `${BUTTON_STYLE};${side}: calc(${offset}px + env(safe-area-inset-${side}))`;
  button.addEventListener("contextmenu", (event) => event.preventDefault());
  return button;
}

export class WalkButtons {
  private walkPointerId: number | null = null;
  private crouchingState = false;
  private doorTarget: DoorButtonTarget | null = null;
  private readonly walkButton: HTMLButtonElement;
  private readonly crouchButton: HTMLButtonElement;
  private readonly doorButton: HTMLButtonElement;
  private readonly status: HTMLDivElement;

  constructor(
    container: HTMLElement,
    private readonly options: WalkButtonsOptions = {},
  ) {
    // 「歩く」は押している間だけ．指が外へずれても離すまで歩き続ける（pointer capture）
    this.walkButton = createButton("歩く", "left");
    this.walkButton.addEventListener("pointerdown", this.onWalkDown);
    this.walkButton.addEventListener("pointerup", this.onWalkUp);
    this.walkButton.addEventListener("pointercancel", this.onWalkUp);
    this.walkButton.addEventListener("lostpointercapture", this.onWalkUp);

    // 「しゃがむ」は押すたびに切り替え
    this.crouchButton = createButton("しゃがむ", "right");
    this.crouchButton.addEventListener("pointerdown", this.onCrouchDown);

    this.doorButton = createButton("ドア", "right", 120);
    this.doorButton.addEventListener("pointerdown", this.onDoorDown);

    // 今いるエリア等の表示（タッチは透過させ，視点操作の邪魔をしない）
    this.status = document.createElement("div");
    this.status.style.cssText = [
      "position: fixed",
      "top: calc(8px + env(safe-area-inset-top))",
      "left: calc(8px + env(safe-area-inset-left))",
      "padding: 4px 8px",
      "background: rgba(0, 0, 0, 0.5)",
      "color: #fff",
      "font: 12px/1.4 monospace",
      "white-space: pre",
      "pointer-events: none",
    ].join(";");

    container.append(this.walkButton, this.crouchButton, this.doorButton, this.status);
    this.refresh();
  }

  get walking(): boolean {
    return this.walkPointerId !== null;
  }

  get crouching(): boolean {
    return this.crouchingState;
  }

  /** 画面の左上に状態を表示する */
  setStatus(text: string): void {
    if (this.status.textContent !== text) this.status.textContent = text;
  }

  /** ドアのボタンの対象を更新する（表示を対象の開閉の状態に合わせる） */
  setDoorTarget(target: DoorButtonTarget | null): void {
    if (target?.id === this.doorTarget?.id && target?.open === this.doorTarget?.open) return;
    this.doorTarget = target;
    this.refresh();
  }

  dispose(): void {
    this.walkButton.remove();
    this.crouchButton.remove();
    this.doorButton.remove();
    this.status.remove();
  }

  private refresh(): void {
    this.walkButton.style.background = this.walking ? ACTIVE_BACKGROUND : IDLE_BACKGROUND;
    this.crouchButton.style.background = this.crouchingState ? ACTIVE_BACKGROUND : IDLE_BACKGROUND;
    this.crouchButton.textContent = this.crouchingState ? "立つ" : "しゃがむ";
    const door = this.doorTarget;
    this.doorButton.style.background = door?.open ? ACTIVE_BACKGROUND : IDLE_BACKGROUND;
    this.doorButton.style.opacity = door ? "1" : "0.4";
    this.doorButton.textContent = door ? (door.open ? "ドアを閉める" : "ドアを開ける") : "ドアなし";
  }

  private readonly onWalkDown = (event: PointerEvent): void => {
    event.preventDefault();
    if (this.walkPointerId !== null) return;
    this.walkPointerId = event.pointerId;
    this.walkButton.setPointerCapture(event.pointerId);
    this.refresh();
  };

  private readonly onWalkUp = (event: PointerEvent): void => {
    if (event.pointerId !== this.walkPointerId) return;
    this.walkPointerId = null;
    if (this.walkButton.hasPointerCapture(event.pointerId)) {
      this.walkButton.releasePointerCapture(event.pointerId);
    }
    this.refresh();
  };

  private readonly onCrouchDown = (event: PointerEvent): void => {
    event.preventDefault();
    this.crouchingState = !this.crouchingState;
    this.refresh();
  };

  private readonly onDoorDown = (event: PointerEvent): void => {
    event.preventDefault();
    if (!this.options.onDoorToggle) return;
    this.setDoorTarget(this.options.onDoorToggle());
  };
}
