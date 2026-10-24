// dev ページの入口（src/input/dev/index.html）．前回のページがあれば自動で移り，無ければ一覧を出す
import { DEV_PAGES, readLastDevPage, resolveDevRedirect } from "./devPages";

const last = readLastDevPage();
const target = resolveDevRedirect(location.search, last);
if (target !== null) {
  // 戻るボタンで入口に戻ってまた移る，を繰り返さないよう replace にする
  location.replace(`./${target}`);
} else {
  const list = document.getElementById("pages");
  for (const page of DEV_PAGES) {
    const a = document.createElement("a");
    a.href = `./${page.file}`;
    a.className = page.file === last ? "page last" : "page";
    const title = document.createElement("span");
    title.className = "title";
    title.textContent = page.file === last ? `${page.title}（前回）` : page.title;
    const note = document.createElement("span");
    note.className = "note";
    note.textContent = page.note;
    a.append(title, note);
    list?.append(a);
  }
}
