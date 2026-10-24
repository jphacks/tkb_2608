import { defineConfig } from "vitest/config";
import { inputLogPlugin } from "./src/input/dev/inputLogPlugin";

export default defineConfig({
  // 開発サーバーだけで，担当D のフライトレコーダーの記録を logs/input/ に保存する（本番のビルドには影響しない）
  plugins: [inputLogPlugin()],
  // 本番・staging は Cloudflare Pages のドメイン直下で配信するため，base は既定（"/"）のまま（docs/02_ENV/ENV_01）
  // 手の認識の Worker（src/input/hand/handWorker.ts）は @mediapipe/tasks-vision を動的に読み込むため，
  // コードを分けられる ES モジュールの形で出力する（既定の iife では分けられない）．new Worker の type: "module" と合わせる
  worker: {
    format: "es",
  },
  server: {
    // スマホの実機確認は cloudflared の Quick Tunnel 経由で開く（docs/02_ENV/ENV_02）
    allowedHosts: [".trycloudflare.com"],
  },
  test: {
    include: ["src/**/*.test.ts"],
  },
});
