// 開発サーバーを cloudflared の Quick Tunnel で公開し，発行された URL を QR コードでも表示する（`npm run tunnel`）．
// cloudflared のログはそのまま流し，URL が出たら 1 回だけ QR コードを描く．手順は docs/02_ENV/ENV_02「スマホの実機で確認する」
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import qrcode from "qrcode-terminal";

const TARGET = "http://localhost:5173";
const URL_PATTERN = /https:\/\/[a-z0-9-]+\.trycloudflare\.com/;

/** cloudflared のログ 1 行から Quick Tunnel の URL を取り出す（無ければ null） */
export function findTunnelUrl(line) {
  const match = line.match(URL_PATTERN);
  return match ? match[0] : null;
}

/** URL を QR コード付きで表示する */
export function printTunnelUrl(url, write = (text) => process.stdout.write(text)) {
  qrcode.generate(url, { small: true }, (qr) => {
    write(`\nスマホで開く URL: ${url}\n${qr}\n`);
  });
}

function main() {
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
        printTunnelUrl(url);
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
