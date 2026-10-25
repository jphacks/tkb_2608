// 道具箱の「下敷き」の薄い殻（E1）．図面の写真の読み込み（createImageBitmap で非同期に）・表示の切り替え・線の濃さ・
// 位置／縮尺／回転の数値の欄・「下敷きを合わせる」モードと，そのモードのドラッグ・ホイールを持つ．
// 下敷きは校舎（SchoolPlan）にも元に戻すの履歴にも入れない．位置の計算は underlay.ts の純粋な関数で行う
import type { PlanStorageLike } from "./planStorage";
import {
  angleFromCenterDeg,
  clampOpacity,
  drawUnderlayCrop,
  fitUnderlay,
  type GridPoint,
  type GridSize,
  type ImageSize,
  initialUnderlay,
  loadUnderlayMemory,
  MAX_UNDERLAY_WIDTH_CELLS,
  MIN_UNDERLAY_WIDTH_CELLS,
  moveUnderlay,
  rotateUnderlay,
  saveUnderlayMemory,
  scaleUnderlayAt,
  type UnderlayOverlay,
  type UnderlayPlacement,
  underlayCropSize,
  updatePlacement,
} from "./underlay";

/** 描く時の写真の長い辺の上限（px．20 MB の写真等をそのまま毎回描くと重いため，読み込んだ時に縮小する） */
const MAX_DRAW_SIDE_PX = 4096;

/** ホイール 1 目盛り（deltaY 100）あたりの拡大率の指数（約 1.16 倍） */
const WHEEL_ZOOM_PER_DELTA = 0.0015;

/** 道具箱に出す案内 */
export const UNDERLAY_TEXT = {
  noImage: "写真が読み込まれていません",
  storageNote:
    "写真はこのブラウザに保存されず，再読み込みすると消える（同じ写真を選び直すと，位置・大きさ・回転は前回のまま）",
  aligningHint:
    "ドラッグで動かす．Shift+ドラッグで回す．ホイールで大きさを変える．Esc か塗る道具を選ぶと終わる",
  idleHint:
    "「下敷きを合わせる」の間はマスを塗らない．合わせたら塗る道具を選んで，写真を見ながら塗る．Space を押している間は写真だけを見られる",
  opacityHint:
    "写真は白黒にして，図面の線だけをマスの塗りの上に重ねる（紙の白は透ける）．線が薄い時は濃くする",
  notImage: "を画像として読み込めません．PNG・JPEG 等の写真のファイルを選んでください",
  invalidNumber: `位置は数で，幅は ${MIN_UNDERLAY_WIDTH_CELLS}〜${MAX_UNDERLAY_WIDTH_CELLS} マスで入れてください`,
} as const;

/** 操作の受け渡し先 */
export interface UnderlayPanelOptions {
  /** 今のマス目の大きさ（初めて読み込んだ時・「マス目に合わせ直す」で全体に収めるため） */
  readonly gridSize: () => GridSize;
  /** 下敷きの写真・位置・表示が変わった（図を描き直す） */
  readonly onChange: () => void;
  /** 「下敷きを合わせる」モードに入った・出た（道具のボタンの表示を直す） */
  readonly onAligningChange: (aligning: boolean) => void;
  /** 読み込めなかった時等の案内を画面に出す */
  readonly notify: (message: string) => void;
  /** 前回の位置を覚える Storage（使えなければ null） */
  readonly storage: PlanStorageLike | null;
}

/** 下敷きの道具箱 */
export interface UnderlayPanel {
  /** 道具箱に置く要素 */
  readonly element: HTMLElement;
  /** 描く下敷き．写真が無い・表示しない時は null */
  overlay(): UnderlayOverlay | null;
  /** 「下敷きを合わせる」モードか（その間は塗り・置く・経路の操作をしない） */
  isAligning(): boolean;
  /** モードに入る・出る（写真が無い時は入らない） */
  setAligning(aligning: boolean): void;
  /** ドラッグを始める（point はマス目の座標．rotate なら回す）．モードでない時は false */
  beginDrag(point: GridPoint, rotate: boolean): boolean;
  /** ドラッグの途中 */
  dragTo(point: GridPoint): void;
  /** ドラッグを終える（位置を覚える） */
  endDrag(): void;
  /** ホイールで point（マス目の座標）を中心に拡大縮小する．モードでない時は false */
  zoomAt(point: GridPoint, deltaY: number): boolean;
  /**
   * マス目の範囲（grid）に重なる写真を切り出した画像（ES3 の FloorDraftProvider.createDraft の image）．
   * 写真が無い・作れない時は null．段階 1 ではボタンを出さず，下書きを足す時に呼ぶ
   */
  cropToGrid(grid: GridSize): Promise<Blob | null>;
}

/** 読み込んだ写真 */
interface LoadedImage {
  readonly fileName: string;
  /** 描く画像（大きい写真は縮小済み） */
  readonly image: ImageBitmap | HTMLImageElement;
  /** image の大きさ（px） */
  readonly size: ImageSize;
  /** 元の写真の大きさ（px．前回の位置と同じ写真かを確かめる） */
  readonly originalSize: ImageSize;
}

/** ドラッグの途中の記録 */
interface UnderlayDrag {
  readonly rotate: boolean;
  /** 最後のマス目の座標（移動）・中心からの向き（度．回転） */
  readonly last: GridPoint;
  readonly lastAngle: number | null;
}

/** 道具箱を作る（写真は無い状態で始まる） */
export function createUnderlayPanel(options: UnderlayPanelOptions): UnderlayPanel {
  const element = document.createElement("div");
  let loaded: LoadedImage | null = null;
  let placement: UnderlayPlacement | null = null;
  let opacity = clampOpacity(Number.NaN);
  let visible = true;
  let aligning = false;
  let drag: UnderlayDrag | null = null;
  /** 読み込みの番号（続けて選んだ時に，古い写真の読み込みが後から終わっても使わないため） */
  let loadToken = 0;

  element.append(heading("下敷き（図面の写真）"));
  const fileInput = document.createElement("input");
  fileInput.type = "file";
  fileInput.accept = "image/*";
  fileInput.hidden = true;
  const chooseButton = button("写真を選ぶ");
  chooseButton.title = "校舎の図面の写真（PNG・JPEG 等）を選び，マス目の下に敷く";
  chooseButton.addEventListener("click", () => fileInput.click());
  const removeButton = button("外す");
  removeButton.addEventListener("click", () => {
    loadToken++;
    setImage(null);
  });
  fileInput.addEventListener("change", () => {
    const file = fileInput.files?.[0];
    // 同じファイルを続けて選んでも change が起きるよう，選んだ物は消しておく
    fileInput.value = "";
    if (file !== undefined) void readImage(file);
  });
  const fileRow = row();
  fileRow.append(chooseButton, removeButton, fileInput);
  const fileName = hint(UNDERLAY_TEXT.noImage);

  const visibleInput = document.createElement("input");
  visibleInput.type = "checkbox";
  visibleInput.checked = true;
  visibleInput.addEventListener("change", () => {
    visible = visibleInput.checked;
    sync();
    options.onChange();
  });
  const visibleLabel = document.createElement("label");
  visibleLabel.append(visibleInput, " 表示する");
  const opacityInput = document.createElement("input");
  opacityInput.type = "range";
  opacityInput.min = "0";
  opacityInput.max = "1";
  opacityInput.step = "0.05";
  opacityInput.setAttribute("aria-label", "下敷きの図面の線の濃さ");
  opacityInput.addEventListener("input", () => {
    opacity = clampOpacity(opacityInput.valueAsNumber);
    sync();
    remember();
    options.onChange();
  });
  const opacityText = document.createElement("span");
  const viewRow = row();
  viewRow.append(visibleLabel);
  const opacityRow = row();
  opacityRow.append("線の濃さ", opacityInput, opacityText);
  const opacityHint = hint(UNDERLAY_TEXT.opacityHint);

  const alignButton = button("下敷きを合わせる");
  alignButton.setAttribute("aria-pressed", "false");
  alignButton.addEventListener("click", () => setAligning(!aligning));
  const fitButton = button("マス目に合わせ直す");
  fitButton.title = "回転を 0 にし，写真全体がマス目全体に収まる大きさで中央に置く";
  fitButton.addEventListener("click", () => {
    if (loaded === null) return;
    applyPlacement(fitUnderlay(loaded.size, options.gridSize()));
  });
  const alignRow = row();
  alignRow.append(alignButton, fitButton);

  const centerXInput = numberField("写真の中心の x（マス）", "0.1");
  const centerZInput = numberField("写真の中心の z（マス）", "0.1");
  const widthInput = numberField("写真の幅（マス）", "0.1");
  const rotationInput = numberField("写真の回転（度．時計回りが正）", "0.5");
  const fieldRows = [
    labeledRow("中心 x", centerXInput, "マス"),
    labeledRow("中心 z", centerZInput, "マス"),
    labeledRow("幅", widthInput, "マス"),
    labeledRow("回転", rotationInput, "度"),
  ];
  const bindField = (input: HTMLInputElement, key: keyof UnderlayPlacement): void => {
    // 確定（Enter・フォーカスを外す）した時だけ当てはめる
    input.addEventListener("change", () => {
      if (placement === null) return;
      const next = updatePlacement(placement, { [key]: input.valueAsNumber });
      if (next === null) options.notify(UNDERLAY_TEXT.invalidNumber);
      else applyPlacement(next);
      writeFields(true);
    });
    input.addEventListener("keydown", (e) => {
      if (e.key === "Enter") input.blur();
    });
  };
  bindField(centerXInput, "centerX");
  bindField(centerZInput, "centerZ");
  bindField(widthInput, "widthCells");
  bindField(rotationInput, "rotationDeg");

  const modeHint = hint(UNDERLAY_TEXT.idleHint);
  const storageNote = hint(UNDERLAY_TEXT.storageNote);
  element.append(
    fileRow,
    fileName,
    viewRow,
    opacityRow,
    opacityHint,
    alignRow,
    ...fieldRows,
    modeHint,
    storageNote,
  );

  async function readImage(file: File): Promise<void> {
    const token = ++loadToken;
    // 画像でないと分かるファイルは読まずに断る（種類が分からない時は読んでみる）
    if (file.type !== "" && !file.type.startsWith("image/")) {
      options.notify(`「${file.name}」${UNDERLAY_TEXT.notImage}`);
      return;
    }
    fileName.textContent = `「${file.name}」を読み込み中…`;
    const decoded = await decodeImage(file);
    if (token !== loadToken) {
      if (decoded !== null) closeImage(decoded.image);
      return;
    }
    if (decoded === null) {
      options.notify(`「${file.name}」${UNDERLAY_TEXT.notImage}`);
      sync();
      return;
    }
    setImage({ fileName: file.name, ...decoded });
  }

  function setImage(next: LoadedImage | null): void {
    if (loaded !== null) closeImage(loaded.image);
    loaded = next;
    drag = null;
    if (next === null) {
      placement = null;
      setAligning(false);
    } else {
      const init = initialUnderlay(
        loadUnderlayMemory(options.storage),
        next.fileName,
        next.originalSize,
        options.gridSize(),
      );
      placement = init.placement;
      opacity = init.opacity;
      visible = true;
      if (init.restored)
        options.notify("前回と同じ写真なので，前回の位置・大きさ・回転で敷きました");
      remember();
    }
    sync();
    writeFields(true);
    options.onChange();
  }

  function applyPlacement(next: UnderlayPlacement): void {
    if (next === placement) return;
    placement = next;
    writeFields(false);
    options.onChange();
  }

  /** 位置・線の濃さ（不透明度）を覚える（写真そのものは保存しない） */
  function remember(): void {
    if (loaded === null || placement === null) return;
    saveUnderlayMemory(options.storage, {
      fileName: loaded.fileName,
      imageWidth: loaded.originalSize.width,
      imageHeight: loaded.originalSize.height,
      placement,
      opacity,
    });
  }

  function setAligning(next: boolean): void {
    const value = next && loaded !== null;
    if (!value) drag = null;
    if (value === aligning) return;
    aligning = value;
    // 合わせる時は見えないと合わせられないので表示する
    if (aligning && !visible) {
      visible = true;
      options.onChange();
    }
    sync();
    options.onAligningChange(aligning);
  }

  function beginDrag(point: GridPoint, rotate: boolean): boolean {
    if (!aligning || placement === null) return false;
    drag = { rotate, last: point, lastAngle: angleFromCenterDeg(placement, point) };
    return true;
  }

  function dragTo(point: GridPoint): void {
    if (drag === null || placement === null) return;
    if (drag.rotate) {
      const angle = angleFromCenterDeg(placement, point);
      if (angle !== null && drag.lastAngle !== null) {
        applyPlacement(rotateUnderlay(placement, angle - drag.lastAngle));
      }
      drag = { ...drag, last: point, lastAngle: angle ?? drag.lastAngle };
      return;
    }
    applyPlacement(moveUnderlay(placement, point.x - drag.last.x, point.z - drag.last.z));
    drag = { ...drag, last: point };
  }

  function endDrag(): void {
    if (drag === null) return;
    drag = null;
    remember();
  }

  function zoomAt(point: GridPoint, deltaY: number): boolean {
    if (!aligning || placement === null) return false;
    applyPlacement(scaleUnderlayAt(placement, Math.exp(-deltaY * WHEEL_ZOOM_PER_DELTA), point));
    remember();
    return true;
  }

  function overlay(): UnderlayOverlay | null {
    if (loaded === null || placement === null || !visible) return null;
    return { image: loaded.image, size: loaded.size, placement, opacity };
  }

  async function cropToGrid(grid: GridSize): Promise<Blob | null> {
    if (loaded === null || placement === null) return null;
    const crop = underlayCropSize(grid);
    const canvas = document.createElement("canvas");
    canvas.width = crop.width;
    canvas.height = crop.height;
    const ctx = canvas.getContext("2d");
    if (ctx === null) return null;
    drawUnderlayCrop(ctx, { image: loaded.image, size: loaded.size, placement, opacity: 1 }, crop);
    return new Promise((resolve) => canvas.toBlob((blob) => resolve(blob), "image/png"));
  }

  /** 数値の欄に今の位置を書く．force でなければ入力中の欄は書き換えない */
  function writeFields(force: boolean): void {
    const write = (input: HTMLInputElement, value: number | null, digits: number): void => {
      if (!force && document.activeElement === input) return;
      input.value = value === null ? "" : String(Number(value.toFixed(digits)));
    };
    write(centerXInput, placement?.centerX ?? null, 2);
    write(centerZInput, placement?.centerZ ?? null, 2);
    write(widthInput, placement?.widthCells ?? null, 2);
    write(rotationInput, placement?.rotationDeg ?? null, 1);
  }

  function sync(): void {
    const has = loaded !== null;
    fileName.textContent = loaded === null ? UNDERLAY_TEXT.noImage : `「${loaded.fileName}」`;
    removeButton.disabled = !has;
    visibleInput.disabled = !has;
    visibleInput.checked = visible;
    opacityInput.disabled = !has;
    opacityInput.value = String(opacity);
    opacityText.textContent = `${Math.round(opacity * 100)}%`;
    alignButton.disabled = !has;
    fitButton.disabled = !has;
    for (const input of [centerXInput, centerZInput, widthInput, rotationInput]) {
      input.disabled = !has;
    }
    alignButton.textContent = aligning ? "合わせ終える" : "下敷きを合わせる";
    alignButton.setAttribute("aria-pressed", String(aligning));
    modeHint.textContent = aligning ? UNDERLAY_TEXT.aligningHint : UNDERLAY_TEXT.idleHint;
  }

  sync();
  writeFields(true);
  return {
    element,
    overlay,
    isAligning: () => aligning,
    setAligning,
    beginDrag,
    dragTo,
    endDrag,
    zoomAt,
    cropToGrid,
  };
}

/**
 * 写真を非同期に読み込む（大きな写真でも画面が固まらないよう createImageBitmap で読む．無いブラウザでは Image）．
 * 長い辺が MAX_DRAW_SIDE_PX を超える時は縮小する．画像として読めなければ null（例外は投げない）
 */
async function decodeImage(file: File): Promise<{
  image: ImageBitmap | HTMLImageElement;
  size: ImageSize;
  originalSize: ImageSize;
} | null> {
  if (typeof createImageBitmap !== "function") return decodeWithImage(file);
  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(file);
  } catch {
    return null;
  }
  const originalSize = { width: bitmap.width, height: bitmap.height };
  if (originalSize.width <= 0 || originalSize.height <= 0) {
    bitmap.close();
    return null;
  }
  const scale = MAX_DRAW_SIDE_PX / Math.max(originalSize.width, originalSize.height);
  if (scale >= 1) return { image: bitmap, size: originalSize, originalSize };
  const size = {
    width: Math.max(1, Math.round(originalSize.width * scale)),
    height: Math.max(1, Math.round(originalSize.height * scale)),
  };
  try {
    const small = await createImageBitmap(bitmap, {
      resizeWidth: size.width,
      resizeHeight: size.height,
      resizeQuality: "high",
    });
    bitmap.close();
    return { image: small, size, originalSize };
  } catch {
    // 縮小できないブラウザでは元の大きさのまま使う（描くのが少し重いだけ）
    return { image: bitmap, size: originalSize, originalSize };
  }
}

/** createImageBitmap の無いブラウザ向けに Image で読む */
async function decodeWithImage(
  file: File,
): Promise<{ image: HTMLImageElement; size: ImageSize; originalSize: ImageSize } | null> {
  const url = URL.createObjectURL(file);
  const image = new Image();
  image.src = url;
  try {
    await image.decode();
  } catch {
    URL.revokeObjectURL(url);
    return null;
  }
  // 描く時にも URL を使うため，読み終えても解放しない（外す時・差し替える時に closeImage で解放する）
  const size = { width: image.naturalWidth, height: image.naturalHeight };
  if (size.width <= 0 || size.height <= 0) {
    URL.revokeObjectURL(url);
    return null;
  }
  return { image, size, originalSize: size };
}

/** 使い終わった写真のメモリを解放する */
function closeImage(image: ImageBitmap | HTMLImageElement): void {
  if (image instanceof HTMLImageElement) {
    if (image.src.startsWith("blob:")) URL.revokeObjectURL(image.src);
    return;
  }
  image.close();
}

function heading(text: string): HTMLHeadingElement {
  const h = document.createElement("h2");
  h.textContent = text;
  return h;
}

function hint(text: string): HTMLParagraphElement {
  const p = document.createElement("p");
  p.className = "editor__hint";
  p.textContent = text;
  return p;
}

function row(): HTMLDivElement {
  const r = document.createElement("div");
  r.className = "editor__row";
  return r;
}

function button(text: string): HTMLButtonElement {
  const b = document.createElement("button");
  b.type = "button";
  b.className = "editor__button";
  b.textContent = text;
  return b;
}

function numberField(ariaLabel: string, step: string): HTMLInputElement {
  const input = document.createElement("input");
  input.type = "number";
  input.step = step;
  input.setAttribute("aria-label", ariaLabel);
  return input;
}

/** 「名前 [入力欄] 単位」の 1 行（延焼の速さの欄と同じ見た目） */
function labeledRow(name: string, input: HTMLInputElement, unit: string): HTMLDivElement {
  const r = row();
  const l = document.createElement("label");
  l.className = "editor__spread-field";
  const nameSpan = document.createElement("span");
  nameSpan.textContent = name;
  l.append(nameSpan, input, unit);
  r.appendChild(l);
  return r;
}
