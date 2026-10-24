// 開発サーバーを cloudflared の Quick Tunnel で公開し，発行された URL を QR コードでも表示する（`npm run tunnel`）．
// cloudflared のログはそのまま流し，URL が出たら 1 回だけ QR コードを描く．手順は docs/02_ENV/ENV_02「スマホの実機で確認する」
// `npm run tunnel -- train` のように空間の id を渡すと，QR コードの URL に `?scene=train` を付ける
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import qrcode from "qrcode-terminal";

const TARGET = "http://localhost:5173";
const URL_PATTERN = /https:\/\/[a-z0-9-]+\.trycloudflare\.com/;
const SCENE_PATTERN = /^[a-z0-9-]+$/;

/** cloudflared のログ 1 行から Quick Tunnel の URL を取り出す（無ければ null） */
export function findTunnelUrl(line) {
  const match = line.match(URL_PATTERN);
  return match ? match[0] : null;
}

/** 空間の id があれば URL に `?scene=<id>` を付ける（id の書式が不正なら null） */
export function withScene(url, scene) {
  if (!scene) return url;
  if (!SCENE_PATTERN.test(scene)) return null;
  return `${url}/?scene=${scene}`;
}

/** URL を QR コード付きで表示する */
export function printTunnelUrl(url, write = (text) => process.stdout.write(text)) {
  qrcode.generate(url, { small: true }, (qr) => {
    write(`\nスマホで開く URL: ${url}\n${qr}\n`);
  });
}

function main() {
  const scene = process.argv[2];
  if (scene && withScene("", scene) === null) {
    console.error(
      `空間の id は英小文字・数字・ハイフンで指定する（例: npm run tunnel -- train）: ${scene}`,
    );
    process.exit(1);
  }
  const child = spawn("cloudflared", ["tunnel", "--url", TARGET], {
    stdio: ["ignore", "pipe", "pipe"],
  });
  let shown = false;
  let buffer = "";
  // cloudflared はログを標準エラーに出す．両方を見て，行単位で URL を探す
  const onData = (chunk, out) => {
    out.write(chunk);
    if (shown) return;
    buffer += chunk.toString();
    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";
    for (const line of lines) {
      const url = findTunnelUrl(line);
      if (url) {
        shown = true;
        printTunnelUrl(withScene(url, scene));
        break;
      }
    }
  };
  child.stdout.on("data", (chunk) => onData(chunk, process.stdout));
  child.stderr.on("data", (chunk) => onData(chunk, process.stderr));
  child.on("error", (err) => {
    console.error(
      `cloudflared を起動できない: ${err.message}（bash .devcontainer/check.sh で確認する）`,
    );
    process.exit(1);
  });
  child.on("exit", (code) => process.exit(code ?? 0));
  // Ctrl+C で cloudflared も止める
  for (const signal of ["SIGINT", "SIGTERM"]) {
    process.on(signal, () => child.kill(signal));
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main();
}
