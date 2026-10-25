// トップ（パラメータ無しの URL）の薄い殻．背景にキービジュアル「ひなんクラフトVR」を敷き，
// 入口「PC で体験する」「スマホ＋VR ゴーグルで体験する」「校舎を作る（エディタ）」を並べる（Issue #205）．
// 開いた端末に合う体験（PC ならマウス・キーボード）を先頭に大きく出す．HTML と CSS だけで組み，three.js は使わない
import { portalEntries, resolveHeroImageUrls } from "./portalLinks";

/** ページの題名（タブ・ブックマークに出る） */
const PAGE_TITLE = "ひなんクラフトVR";

/** 背景の画像の大きさ（px．public/home/hero.webp・hero.jpg と同じ） */
const HERO_SIZE = { width: 1672, height: 941 } as const;

/** 背景の画像の代わりの文（画像に描かれたタイトルは見出しで持つため，絵の中身を短く書く） */
const HERO_ALT = "火と煙が迫る校舎の廊下と，校舎の地図・3D のホログラム";

// 横長（PC）は画面いっぱいに敷く（object-fit: cover）．タイトルは画像の上側にあるため，
// 横に長すぎる画面で上下が切れる時は上を残す．縦長（スマホの縦向き）は cover だと左右が大きく切れて
// タイトルまで欠けるため，画面の幅の 150% で上寄りに置き（タイトルの範囲は残る），周りはぼかした同じ画像で埋める
const STYLE = `
.portal {
  position: fixed; inset: 0; overflow: hidden; background: #050b1a; color: #eaf6ff;
  font: 16px/1.5 system-ui, -apple-system, "Hiragino Sans", sans-serif;
}
.portal__backdrop, .portal__hero { position: absolute; inset: 0; margin: 0; }
.portal__backdrop img {
  width: 100%; height: 100%; object-fit: cover; filter: blur(28px) brightness(0.55); transform: scale(1.15);
}
.portal__hero img {
  display: block; width: 100%; height: 100%; object-fit: cover; object-position: center 12%;
}
.portal__title {
  position: absolute; width: 1px; height: 1px; margin: -1px; padding: 0; overflow: hidden;
  clip: rect(0 0 0 0); clip-path: inset(50%); white-space: nowrap; border: 0;
}
.portal__actions {
  position: absolute; left: 50%; bottom: max(5vh, calc(env(safe-area-inset-bottom) + 12px));
  transform: translateX(-50%); display: flex; flex-direction: column; align-items: center; gap: 10px;
  width: max-content; max-width: calc(100% - 32px);
}
.portal__entry { display: flex; flex-direction: column; align-items: center; gap: 4px; }
.portal__note {
  margin: 0; font-size: 14px; color: #eaf6ff; text-align: center;
  text-shadow: 0 0 6px rgba(0, 0, 0, 0.95), 0 0 2px rgba(0, 0, 0, 0.95);
}
.portal__open {
  display: inline-flex; align-items: center; justify-content: center; min-height: 48px; padding: 10px 36px;
  box-sizing: border-box; border-radius: 999px; border: 2px solid #8fdcff;
  background: rgba(8, 30, 70, 0.85);
  color: #fff; font-size: 18px; font-weight: bold; letter-spacing: 0.06em; text-decoration: none;
  text-shadow: 0 0 8px rgba(120, 210, 255, 0.9);
  box-shadow: 0 0 12px rgba(70, 180, 255, 0.55);
  transition: transform 0.15s, box-shadow 0.15s, background 0.15s;
}
.portal__open:hover {
  transform: translateY(-2px); background: rgba(24, 70, 150, 0.92);
  box-shadow: 0 0 20px rgba(110, 205, 255, 0.9);
}
.portal__open.is-primary {
  min-height: 60px; padding: 14px 56px; font-size: 24px; letter-spacing: 0.08em;
  background: linear-gradient(180deg, rgba(48, 150, 255, 0.92), rgba(12, 60, 170, 0.92));
  box-shadow: 0 0 18px rgba(70, 180, 255, 0.85), 0 0 48px rgba(40, 120, 255, 0.45),
    inset 0 0 14px rgba(160, 230, 255, 0.45);
}
.portal__open.is-primary:hover {
  background: linear-gradient(180deg, rgba(80, 175, 255, 0.95), rgba(24, 80, 200, 0.95));
  box-shadow: 0 0 24px rgba(110, 205, 255, 1), 0 0 64px rgba(60, 150, 255, 0.6),
    inset 0 0 16px rgba(180, 240, 255, 0.55);
}
.portal__open:active { transform: translateY(1px); }
.portal__open:focus-visible { outline: 3px solid #ffffff; outline-offset: 4px; }
@media (max-aspect-ratio: 6/5) {
  .portal__hero { inset: auto; left: 50%; top: max(16%, env(safe-area-inset-top)); width: 150%; transform: translateX(-50%); }
  .portal__hero img {
    height: auto; aspect-ratio: ${HERO_SIZE.width} / ${HERO_SIZE.height};
    -webkit-mask-image: linear-gradient(to bottom, transparent, #000 10%, #000 85%, transparent);
    mask-image: linear-gradient(to bottom, transparent, #000 10%, #000 85%, transparent);
  }
  .portal__actions { bottom: max(6vh, calc(env(safe-area-inset-bottom) + 16px)); }
  .portal__open { padding: 10px 28px; font-size: 17px; }
  .portal__open.is-primary { padding: 14px 32px; font-size: 21px; }
  .portal__note { font-size: 13px; }
}
`;

/** トップの画面を立ち上げる（document.body に画面を置く） */
export function startPortal(): void {
  const style = document.createElement("style");
  style.textContent = STYLE;
  document.head.appendChild(style);
  document.title = PAGE_TITLE;

  const urls = resolveHeroImageUrls(import.meta.env.BASE_URL);

  const root = el("main", "portal");

  // ぼかした背景は飾り（縦長の時に画像の周りを埋める）．読み上げない
  const backdrop = createPicture(urls.webp, urls.jpg, "");
  backdrop.classList.add("portal__backdrop");
  backdrop.setAttribute("aria-hidden", "true");

  const hero = createPicture(urls.webp, urls.jpg, HERO_ALT);
  hero.classList.add("portal__hero");

  // タイトルの文字は画像に描かれているため，見出しは画面に出さず読み上げ・検索のためだけに持つ
  const title = el("h1", "portal__title");
  title.textContent = PAGE_TITLE;

  const actions = el("nav", "portal__actions");
  actions.setAttribute("aria-label", "進む先");
  // タッチ主体の端末（スマホ）か．PC で開いた時は「PC で体験する」を先頭に大きく出す
  const coarsePointer = window.matchMedia("(pointer: coarse)").matches;
  for (const entry of portalEntries(window.location.pathname, coarsePointer)) {
    const item = el("div", "portal__entry");
    const open = el("a", "portal__open");
    open.href = entry.href;
    open.textContent = entry.label;
    open.dataset.entry = entry.id;
    if (entry.primary) open.classList.add("is-primary");
    const note = el("p", "portal__note");
    note.textContent = entry.note;
    item.append(open, note);
    actions.append(item);
  }

  root.append(backdrop, hero, title, actions);
  document.body.appendChild(root);
}

/** webp を優先し，読めない端末では jpg を出す画像 */
function createPicture(webpUrl: string, jpgUrl: string, alt: string): HTMLPictureElement {
  const picture = document.createElement("picture");
  const source = document.createElement("source");
  source.type = "image/webp";
  source.srcset = webpUrl;
  const img = document.createElement("img");
  img.src = jpgUrl;
  img.alt = alt;
  img.width = HERO_SIZE.width;
  img.height = HERO_SIZE.height;
  img.decoding = "async";
  picture.append(source, img);
  return picture;
}

function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className: string,
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  node.className = className;
  return node;
}
