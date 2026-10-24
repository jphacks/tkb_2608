import { defineConfig } from "vitest/config";

export default defineConfig(({ command }) => ({
  // GitHub Pages ではリポジトリ名がパスに入る（docs/02_ENV/ENV_03）
  base: command === "build" ? "/tkb_2608/" : "/",
  server: {
    // スマホの実機確認は cloudflared の Quick Tunnel 経由で開く（docs/02_ENV/ENV_02）
    allowedHosts: [".trycloudflare.com"],
  },
  test: {
    include: ["src/**/*.test.ts"],
  },
}));
