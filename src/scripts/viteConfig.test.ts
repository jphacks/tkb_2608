// vite.config.ts の mode による切り替え（npm run dev:record = vite --mode record の時だけ WebSocket を切る）
import type { ConfigEnv, UserConfig } from "vite";
import { describe, expect, it } from "vitest";
import config from "../../vite.config";

function resolve(mode: string, command: ConfigEnv["command"] = "serve"): UserConfig {
  expect(typeof config).toBe("function");
  const fn = config as (env: ConfigEnv) => UserConfig;
  return fn({ mode, command, isSsrBuild: false, isPreview: false });
}

describe("vite.config.ts", () => {
  it("--mode record（npm run dev:record）の時は開発サーバーの WebSocket を切る（記録中のページを再読み込みしない）", () => {
    expect(resolve("record").server?.ws).toBe(false);
  });

  it.each(["development", "production", "staging"])(
    "mode %s では WebSocket を切らない（HMR が効く）",
    (mode) => {
      expect(resolve(mode).server).not.toHaveProperty("ws");
    },
  );

  it.each(["development", "record", "production", "staging"])(
    "mode %s でも開発サーバーは IPv4 のループバック（127.0.0.1）で待ち受ける（Issue #99）",
    (mode) => {
      expect(resolve(mode).server?.host).toBe("127.0.0.1");
    },
  );

  it("vite build（command: build）でも server.host は 127.0.0.1 のまま", () => {
    expect(resolve("production", "build").server?.host).toBe("127.0.0.1");
  });

  it("どの mode でもトンネルのホストを許可し，テストの対象は src/**/*.test.ts のまま", () => {
    for (const mode of ["record", "development", "production", "staging"]) {
      const c = resolve(mode) as UserConfig & { test?: { include?: string[] } };
      expect(c.server?.allowedHosts).toEqual([".trycloudflare.com"]);
      expect(c.test?.include).toEqual(["src/**/*.test.ts"]);
    }
  });
});
