import { defineConfig } from "vitest/config";

export default defineConfig({
  // 本番・staging は Cloudflare Pages のドメイン直下で配信するため，base は既定（"/"）のまま（docs/02_ENV/ENV_01）
  server: {
    // スマホの実機確認は cloudflared の Quick Tunnel 経由で開く（docs/02_ENV/ENV_02）
    allowedHosts: [".trycloudflare.com"],
  },
  test: {
    include: ["src/**/*.test.ts"],
  },
});
