import { defineConfig } from "vitest/config";
import { inputLogPlugin } from "./src/input/dev/inputLogPlugin";

export default defineConfig({
  // 開発サーバーだけで，担当D のフライトレコーダーの記録を logs/input/ に保存する（本番のビルドには影響しない）
  plugins: [inputLogPlugin()],
  // 本番・staging は Cloudflare Pages のドメイン直下で配信するため，base は既定（"/"）のまま（docs/02_ENV/ENV_01）
  server: {
    // スマホの実機確認は cloudflared の Quick Tunnel 経由で開く（docs/02_ENV/ENV_02）
    allowedHosts: [".trycloudflare.com"],
  },
  test: {
    include: ["src/**/*.test.ts"],
  },
});
