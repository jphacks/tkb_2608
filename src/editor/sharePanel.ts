// 生徒用の URL と QR コードを出す窓の薄い殻（E6）．URL は share/ の createShareLink が作り，ここは表示とコピーだけを行う．
// QR の模様は qrcode-generator で作り，Canvas 2D に描く（HTML の文字列を差し込まない）
import qrcode from "qrcode-generator";
import { isLoopbackHost } from "../share/shareUrl";

/** 自分の PC だけを指す配信先（localhost 等）で URL を作った時の注意 */
export const LOOPBACK_WARNING =
  "この URL はスマホから開けません．npm run tunnel の公開 URL に ?editor を付けてエディタを開き直してください";

/** QR コードの絵の 1 辺の大きさ（CSS の px．余白を含む） */
const QR_SIZE_PX = 360;

/** QR コードの周りの余白（モジュールの数．規格の推奨は 4） */
const QR_QUIET_ZONE = 4;

/** 窓の中身．ok が false の時は QR を出さず，理由を並べる */
export type ShareView =
  | { readonly ok: true; readonly url: string }
  | { readonly ok: false; readonly reasons: readonly string[] };

/** 生徒用の URL と QR の窓 */
export interface SharePanel {
  /** 画面に置く要素（エディタの上から見た図の上に重ねる） */
  readonly element: HTMLElement;
  /** 作っている途中の表示にして開く */
  showPending(): void;
  /** 結果を出して開く */
  show(view: ShareView): void;
  /** 閉じる */
  hide(): void;
  /** 開いているか */
  isOpen(): boolean;
}

/** 窓を作る（最初は閉じている）．notify はコピーの成否等を画面に知らせる */
export function createSharePanel(notify: (message: string) => void): SharePanel {
  const element = document.createElement("div");
  element.className = "editor__share";
  element.hidden = true;
  element.setAttribute("role", "dialog");
  element.setAttribute("aria-label", "生徒用の QR コード");

  const card = document.createElement("div");
  card.className = "editor__share-card";
  const title = document.createElement("h2");
  title.textContent = "生徒用の QR コード";
  const body = document.createElement("div");
  body.className = "editor__share-body";
  const closeButton = document.createElement("button");
  closeButton.type = "button";
  closeButton.className = "editor__button";
  closeButton.textContent = "閉じる";
  closeButton.addEventListener("click", () => hide());
  const closeRow = document.createElement("div");
  closeRow.className = "editor__row editor__share-actions";
  closeRow.appendChild(closeButton);
  card.append(title, body, closeRow);
  element.appendChild(card);

  function hide(): void {
    element.hidden = true;
    body.replaceChildren();
  }

  function showPending(): void {
    const p = document.createElement("p");
    p.textContent = "作っています…";
    body.replaceChildren(p);
    element.hidden = false;
  }

  function show(view: ShareView): void {
    body.replaceChildren(...(view.ok ? urlView(view.url, notify) : reasonsView(view.reasons)));
    element.hidden = false;
  }

  return { element, showPending, show, hide, isOpen: () => !element.hidden };
}

/** QR コードと URL（コピーボタンつき） */
function urlView(url: string, notify: (message: string) => void): HTMLElement[] {
  const qr = qrCanvas(url);
  const hint = document.createElement("p");
  hint.className = "editor__hint";
  hint.textContent =
    "生徒のスマホのカメラで読み取ると，この校舎・このモードで訓練が始まります．校舎を変えたら出し直してください";

  const row = document.createElement("div");
  row.className = "editor__row";
  const input = document.createElement("input");
  input.type = "text";
  input.readOnly = true;
  input.value = url;
  input.setAttribute("aria-label", "生徒用の URL");
  input.addEventListener("focus", () => input.select());
  const copyButton = document.createElement("button");
  copyButton.type = "button";
  copyButton.className = "editor__button";
  copyButton.textContent = "コピー";
  copyButton.addEventListener("click", () => {
    // http の画面では navigator.clipboard が無いため，その場で投げる例外も失敗の側で受ける
    Promise.resolve()
      .then(() => navigator.clipboard.writeText(url))
      .then(
        () => notify("URL をコピーしました"),
        () => {
          // クリップボードを使えない時は，選んだ状態にして手でコピーしてもらう
          input.focus();
          input.select();
          notify("コピーできませんでした．選んだ URL を Ctrl+C でコピーしてください");
        },
      );
  });
  row.append(input, copyButton);

  const length = document.createElement("p");
  length.className = "editor__hint";
  length.textContent = `URL の長さ: ${url.length} 文字`;
  const views: HTMLElement[] = [qr, hint, row, length];
  // QR と URL は出したまま，スマホから開けない配信先であることを知らせる（PC で開いて確かめる使い方は残す）
  if (isLoopbackHost(hostnameOf(url))) {
    const warning = document.createElement("p");
    warning.className = "editor__hint editor__warning";
    warning.setAttribute("role", "alert");
    warning.textContent = LOOPBACK_WARNING;
    views.splice(1, 0, warning);
  }
  return views;
}

/** URL の host の名前（読めない URL は空の文字列） */
function hostnameOf(url: string): string {
  try {
    return new URL(url).hostname;
  } catch {
    return "";
  }
}

/** QR を出せない理由の一覧 */
function reasonsView(reasons: readonly string[]): HTMLElement[] {
  const head = document.createElement("p");
  head.className = "editor__share-error";
  head.textContent = "QR コードを出せません．次を直してください";
  const list = document.createElement("ul");
  list.className = "editor__share-reasons";
  for (const reason of reasons) {
    const item = document.createElement("li");
    item.textContent = reason;
    list.appendChild(item);
  }
  return [head, list];
}

/** URL の QR コードを描いた Canvas（誤り訂正は M．URL は ASCII だけなので Byte のまま載せる） */
function qrCanvas(text: string): HTMLCanvasElement {
  const qr = qrcode(0, "M");
  qr.addData(text);
  qr.make();
  const modules = qr.getModuleCount();
  const total = modules + QR_QUIET_ZONE * 2;
  // 1 モジュールを整数の px にして，ぼやけない（読み取りやすい）ようにする
  const dpr = window.devicePixelRatio || 1;
  const cell = Math.max(1, Math.floor((QR_SIZE_PX * dpr) / total));
  const canvas = document.createElement("canvas");
  canvas.className = "editor__share-qr";
  canvas.width = cell * total;
  canvas.height = cell * total;
  canvas.style.width = `${(cell * total) / dpr}px`;
  canvas.style.height = `${(cell * total) / dpr}px`;
  canvas.setAttribute("role", "img");
  canvas.setAttribute("aria-label", "生徒用の URL の QR コード");
  const ctx = canvas.getContext("2d");
  if (ctx === null) return canvas;
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = "#000000";
  for (let row = 0; row < modules; row++) {
    for (let col = 0; col < modules; col++) {
      if (qr.isDark(row, col)) {
        ctx.fillRect((col + QR_QUIET_ZONE) * cell, (row + QR_QUIET_ZONE) * cell, cell, cell);
      }
    }
  }
  return canvas;
}
