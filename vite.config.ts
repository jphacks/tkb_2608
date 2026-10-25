import { defineConfig } from "vitest/config";
import { inputLogPlugin } from "./src/input/dev/inputLogPlugin";

export default defineConfig(({ mode }) => ({
  // 開発サーバーだけで，担当D のフライトレコーダーの記録を logs/input/ に保存する（本番のビルドには影響しない）
  plugins: [inputLogPlugin()],
  // 本番・staging は Cloudflare Pages のドメイン直下で配信するため，base は既定（"/"）のまま（docs/02_ENV/ENV_01）
  // 手の認識の Worker（src/input/hand/handWorker.ts）は @mediapipe/tasks-vision を動的に読み込むため，
  // コードを分けられる ES モジュールの形で出力する（既定の iife では分けられない）．new Worker の type: "module" と合わせる
  worker: {
    format: "es",
  },
  server: {
    // 既定の "localhost" は IPv6（[::1]）だけで待ち受けることがあり，127.0.0.1 につなぐ
    // Dev Container のポート転送・cloudflared から開けなくなるため，IPv4 のループバックに固定する
    host: "127.0.0.1",
    // スマホの実機確認は cloudflared の Quick Tunnel 経由で開く（docs/02_ENV/ENV_02）
    allowedHosts: [".trycloudflare.com"],
    // 動きの記録用（npm run dev:record）は WebSocket を切り，ファイルの変更で記録中のページが再読み込みされないようにする
    // （HMR の full-reload は開いている全ページに届くため，別の人が src/ を編集すると protocol.html が最初に戻っていた）
    ...(mode === "record" ? { ws: false as const } : {}),
  },
  test: {
    // 見守りの中継（relay/．Cloudflare Worker）の純粋な関数のテストも同じ Vitest で実行する
    include: ["src/**/*.test.ts", "relay/src/**/*.test.ts"],
  },
}));
